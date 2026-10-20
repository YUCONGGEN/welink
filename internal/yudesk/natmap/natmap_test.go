package natmap

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"
)

func TestUPnPDiscoveryOverlapsPCPWithoutRacingMappings(t *testing.T) {
	socket := boundSocket(t)
	synctest.Test(t, func(t *testing.T) {
		started := time.Now()
		var pcpDone bool
		deps := dependencies{
			gateway: func(context.Context) (netip.Addr, error) { return netip.MustParseAddr("192.0.2.1"), nil },
			pcp: func(ctx context.Context, _ *net.UDPConn, _ netip.Addr, _ mapConfig) (Mapping, error) {
				<-ctx.Done()
				pcpDone = true
				return Mapping{}, ctx.Err()
			},
			prepareUPnP: func(context.Context, *net.UDPConn) (func(context.Context, mapConfig) (Mapping, error), error) {
				time.Sleep(550 * time.Millisecond)
				return func(ctx context.Context, _ mapConfig) (Mapping, error) {
					if !pcpDone {
						t.Error("UPnP MAP raced PCP MAP")
					}
					time.Sleep(100 * time.Millisecond)
					if err := ctx.Err(); err != nil {
						return Mapping{}, err
					}
					return testMapping(MethodUPnP), nil
				}, nil
			},
		}
		mapping, err := openUDP(context.Background(), socket, Options{Timeout: 800 * time.Millisecond}, deps)
		if err != nil || mapping.Method != MethodUPnP {
			t.Fatalf("discovery consumed the mapping budget: %v", err)
		}
		if elapsed := time.Since(started); elapsed != 650*time.Millisecond {
			t.Fatalf("discovery was serialized: %s", elapsed)
		}
	})
}

func TestPCPSuccessCancelsAndJoinsUPnPDiscovery(t *testing.T) {
	var joined atomic.Bool
	deps := dependencies{
		gateway: func(context.Context) (netip.Addr, error) { return netip.MustParseAddr("192.0.2.1"), nil },
		pcp: func(context.Context, *net.UDPConn, netip.Addr, mapConfig) (Mapping, error) {
			return testMapping(MethodPCP), nil
		},
		prepareUPnP: func(ctx context.Context, _ *net.UDPConn) (func(context.Context, mapConfig) (Mapping, error), error) {
			<-ctx.Done()
			joined.Store(true)
			return nil, ctx.Err()
		},
	}
	if _, err := openUDP(context.Background(), boundSocket(t), Options{}, deps); err != nil {
		t.Fatal(err)
	}
	if !joined.Load() {
		t.Fatal("discovery survived OpenUDP")
	}
}

func TestNATPMPCompatibilityBeforeUPnPMapping(t *testing.T) {
	deps := dependencies{
		gateway: func(context.Context) (netip.Addr, error) { return netip.MustParseAddr("192.0.2.1"), nil },
		pcp: func(context.Context, *net.UDPConn, netip.Addr, mapConfig) (Mapping, error) {
			return Mapping{}, errors.New("old gateway")
		},
		pmp: func(context.Context, *net.UDPConn, netip.Addr, mapConfig) (Mapping, error) {
			return testMapping(MethodNATPMP), nil
		},
		upnp: func(context.Context, *net.UDPConn, mapConfig) (Mapping, error) {
			t.Fatal("UPnP created a duplicate mapping")
			return Mapping{}, nil
		},
	}
	if mapping, err := openUDP(context.Background(), boundSocket(t), Options{}, deps); err != nil || mapping.Method != MethodNATPMP {
		t.Fatalf("NAT-PMP fallback: %+v %v", mapping, err)
	}
}

func boundSocket(t *testing.T) *net.UDPConn {
	t.Helper()
	socket, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero, Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = socket.Close() })
	return socket
}

func testMapping(method Method) Mapping {
	return Mapping{ExternalIP: netip.MustParseAddr("203.0.113.8"), ExternalPort: 45678, Method: method, Lease: &closeOnce{}}
}

func TestOpenUDPPrefersPCP(t *testing.T) {
	var order []Method
	deps := dependencies{
		gateway: func(context.Context) (netip.Addr, error) { return netip.MustParseAddr("192.0.2.1"), nil },
		pcp: func(context.Context, *net.UDPConn, netip.Addr, mapConfig) (Mapping, error) {
			order = append(order, MethodPCP)
			return testMapping(MethodPCP), nil
		},
		upnp: func(context.Context, *net.UDPConn, mapConfig) (Mapping, error) {
			order = append(order, MethodUPnP)
			return testMapping(MethodUPnP), nil
		},
	}
	mapping, err := openUDP(context.Background(), boundSocket(t), Options{Timeout: time.Second}, deps)
	if err != nil {
		t.Fatal(err)
	}
	if mapping.Method != MethodPCP || len(order) != 1 || order[0] != MethodPCP {
		t.Fatalf("unexpected protocol order: mapping=%+v order=%v", mapping, order)
	}
}

func TestOpenUDPFallsBackToUPnP(t *testing.T) {
	var pcpCalls, upnpCalls atomic.Int32
	deps := dependencies{
		gateway: func(context.Context) (netip.Addr, error) { return netip.MustParseAddr("192.0.2.1"), nil },
		pcp: func(context.Context, *net.UDPConn, netip.Addr, mapConfig) (Mapping, error) {
			pcpCalls.Add(1)
			return Mapping{}, errors.New("PCP unavailable")
		},
		upnp: func(context.Context, *net.UDPConn, mapConfig) (Mapping, error) {
			upnpCalls.Add(1)
			return testMapping(MethodUPnP), nil
		},
	}
	mapping, err := openUDP(context.Background(), boundSocket(t), Options{Timeout: time.Second}, deps)
	if err != nil {
		t.Fatal(err)
	}
	if mapping.Method != MethodUPnP || pcpCalls.Load() != 1 || upnpCalls.Load() != 1 {
		t.Fatalf("fallback not used exactly once: mapping=%+v PCP=%d UPnP=%d", mapping, pcpCalls.Load(), upnpCalls.Load())
	}
}

func TestOpenUDPNoGatewayFailsQuickly(t *testing.T) {
	deps := dependencies{
		gateway: func(context.Context) (netip.Addr, error) { return netip.Addr{}, ErrNoGateway },
		pcp: func(context.Context, *net.UDPConn, netip.Addr, mapConfig) (Mapping, error) {
			t.Fatal("PCP must not run without a gateway")
			return Mapping{}, nil
		},
		upnp: func(context.Context, *net.UDPConn, mapConfig) (Mapping, error) {
			return Mapping{}, errors.New("no IGD")
		},
	}
	started := time.Now()
	_, err := openUDP(context.Background(), boundSocket(t), Options{Timeout: 200 * time.Millisecond}, deps)
	if !errors.Is(err, ErrNoMapping) || !errors.Is(err, ErrNoGateway) {
		t.Fatalf("unexpected error: %v", err)
	}
	if elapsed := time.Since(started); elapsed > 100*time.Millisecond {
		t.Fatalf("no-gateway fallback blocked for %s", elapsed)
	}
}

func TestOpenUDPRejectsUnboundInput(t *testing.T) {
	if _, err := OpenUDP(context.Background(), nil, Options{}); err == nil {
		t.Fatal("nil socket accepted")
	}
}

func TestCloseOnceIsConcurrentAndIdempotent(t *testing.T) {
	var calls atomic.Int32
	want := errors.New("delete failed")
	lease := &closeOnce{fn: func() error { calls.Add(1); return want }}
	done := make(chan error, 8)
	for range 8 {
		go func() { done <- lease.Close() }()
	}
	for range 8 {
		if err := <-done; !errors.Is(err, want) {
			t.Fatalf("Close error = %v", err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("delete called %d times", calls.Load())
	}
}
