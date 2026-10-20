package peerpath

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pion/ice/v4"
	"github.com/pion/webrtc/v4"
	"welink/internal/yudesk/natmap"
	"welink/internal/yudesk/protocol"
)

func TestCandidateLimitKeepsMappedIPv6STUNAndTURN(t *testing.T) {
	a, err := newAttempt(context.Background(), hostOptions(), 100*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer a.close()
	raw, reason := a.description(context.Background(), true, 100*time.Millisecond)
	if reason != "" {
		t.Fatal(reason)
	}
	var lines []string
	for _, line := range strings.Split(raw, "\r\n") {
		if !strings.HasPrefix(line, "a=candidate:") && line != "" {
			lines = append(lines, line)
		}
	}
	for i := 0; i < 80; i++ {
		lines = append(lines, fmt.Sprintf("a=candidate:nic%d 1 udp 2130706431 10.0.0.%d %d typ host", i, i+1, 20000+i))
	}
	lines = append(lines,
		"a=candidate:mapped 1 udp 2130706431 203.0.113.20 30000 typ host",
		"a=candidate:ipv6 1 udp 2130706431 2001:db8::20 30000 typ host",
		"a=candidate:stun 1 udp 1694498815 203.0.113.30 40000 typ srflx raddr 10.0.0.1 rport 30000",
		"a=candidate:turn 1 udp 16777215 203.0.113.40 50000 typ relay raddr 10.0.0.1 rport 30000",
		"a=candidate:rtcp 2 udp 2130706431 203.0.113.20 30000 typ host")
	a.mapped, a.mappedIP, a.mappedPort = true, netip.MustParseAddr("203.0.113.20"), 45000
	filtered, count := a.signaledSDP(strings.Join(lines, "\r\n") + "\r\n")
	if count != maxCandidates || validateSDP(filtered, true) != nil {
		t.Fatalf("invalid bounded SDP, candidates=%d", count)
	}
	for _, want := range []string{"203.0.113.20 45000 typ host", "2001:db8::20", "typ srflx", "typ relay"} {
		if !strings.Contains(filtered, want) {
			t.Fatalf("useful candidate omitted: %s", want)
		}
	}
	if strings.Contains(filtered, "rtcp") {
		t.Fatal("component 2 survived")
	}
	// Candidate foundations do not make the same transport endpoint distinct.
	filtered, count = a.signaledSDP(filtered + "a=candidate:duplicate 1 udp 2130706431 2001:db8::20 30000 typ host\r\n")
	if count != maxCandidates || strings.Contains(filtered, "duplicate") {
		t.Fatal("duplicate endpoint consumed budget")
	}
}

type advertisedUDP struct {
	*net.UDPConn
	internal net.Addr
}

func (c advertisedUDP) LocalAddr() net.Addr { return c.internal }

type mappingTestLease struct {
	close func()
	calls atomic.Int32
}

func (l *mappingTestLease) Close() error {
	if l.calls.Add(1) == 1 {
		l.close()
	}
	return nil
}

// Model a gateway that preserves the internal socket identity but forwards
// every packet through a different external UDP port. No real router mapping,
// desktop capture, input or public network is used.
func TestAllocatedExternalPortCarriesRealDirectTraffic(t *testing.T) {
	for _, trickle := range []bool{false, true} {
		t.Run(map[bool]string{false: "full-SDP", true: "trickle"}[trickle], func(t *testing.T) {
			allocatedExternalPortTraffic(t, trickle)
		})
	}
}

func allocatedExternalPortTraffic(t *testing.T, trickle bool) {
	allocatedExternalPortTrafficAfter(t, trickle, 0)
}

func TestTrickleLateAllocatedExternalPortCarriesRealDirectTraffic(t *testing.T) {
	allocatedExternalPortTrafficAfter(t, true, 200*time.Millisecond)
}

func allocatedExternalPortTrafficAfter(t *testing.T, trickle bool, delay time.Duration) {
	var address net.IP
	addresses, _ := net.InterfaceAddrs()
	for _, value := range addresses {
		ip, _, _ := net.ParseCIDR(value.String())
		if ip.To4() != nil && !ip.IsLoopback() {
			probe, err := net.ListenUDP("udp4", &net.UDPAddr{IP: ip})
			if err == nil {
				_ = probe.Close()
				address = ip
				break
			}
		}
	}
	if address == nil {
		t.Skip("no IPv4 NIC for isolated socket fixture")
	}
	var options [2]Options
	var leases [2]*mappingTestLease
	var muxes [2]ice.UDPMux
	var internalPorts, externalPorts [2]int
	for i := range options {
		index := i
		o := hostOptions()
		o.TrickleICE = trickle
		o.PortMapping = true
		o.newUDPMux = func() (ice.UDPMux, *net.UDPConn, error) {
			internal, err := net.ListenUDP("udp4", &net.UDPAddr{IP: address})
			if err != nil {
				return nil, nil, err
			}
			t.Cleanup(func() { _ = internal.Close() })
			internalPorts[index] = internal.LocalAddr().(*net.UDPAddr).Port
			public, err := net.ListenUDP("udp4", &net.UDPAddr{IP: address})
			if err != nil {
				return nil, nil, err
			}
			if public.LocalAddr().(*net.UDPAddr).Port == internalPorts[index] {
				_ = public.Close()
				public, err = net.ListenUDP("udp4", &net.UDPAddr{IP: address, Port: 1024 + (internalPorts[index]+1)%64000})
				if err != nil {
					return nil, nil, err
				}
			}
			externalPorts[index] = public.LocalAddr().(*net.UDPAddr).Port
			muxes[index] = ice.NewUDPMuxDefault(ice.UDPMuxParams{UDPConn: advertisedUDP{public, &net.UDPAddr{IP: address, Port: internalPorts[index]}}})
			leases[index] = &mappingTestLease{close: func() { _ = muxes[index].Close() }}
			return muxes[index], internal, nil
		}
		o.mapUDP = func(ctx context.Context, _ *net.UDPConn, _ natmap.Options) (natmap.Mapping, error) {
			if delay != 0 {
				select {
				case <-time.After(delay):
				case <-ctx.Done():
					return natmap.Mapping{}, ctx.Err()
				}
			}
			return natmap.Mapping{ExternalIP: netip.MustParseAddr(address.String()), ExternalPort: uint16(externalPorts[index]), Method: natmap.MethodUPnP, Lease: leases[index]}, nil
		}
		o.configure = func(s *webrtc.SettingEngine) {
			s.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
		}
		options[i] = o
	}
	a, b := encryptedPair(t)
	results := runPair(t, context.Background(), [2]*protocol.Conn{protocol.NewConn(a), protocol.NewConn(b)}, options, [2]func() (protocol.Message, error){})
	for i, result := range results {
		if result.err != nil || result.info.Mode != "p2p" {
			t.Fatalf("different external port could not connect: %+v", result)
		}
		if externalPorts[i] == internalPorts[i] {
			t.Fatal("fixture did not change the port")
		}
		pair, err := result.c.Conn.(*sessionConn).a.pc.SCTP().Transport().ICETransport().GetSelectedCandidatePair()
		if err != nil || pair == nil {
			t.Fatalf("missing selected pair: %+v, %v", pair, err)
		}
		if int(pair.Remote.Port) != externalPorts[1-i] {
			t.Fatalf("did not use allocated external port: %+v, %v; remote port=%d internal=%v external=%v", pair, err, pair.Remote.Port, internalPorts, externalPorts)
		}
	}
	roundTrip(t, results[0].c, results[1].c, 180007)
	roundTrip(t, results[1].c, results[0].c, 130003)
	for _, result := range results {
		_ = result.c.Close()
	}
	for _, lease := range leases {
		if lease.calls.Load() != 1 {
			t.Fatal("mapping not released exactly once")
		}
	}
}
