package peerpath

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pion/ice/v4"
	"github.com/pion/stun/v4"
	"github.com/pion/webrtc/v4"
	"welink/internal/yudesk/natmap"
	"welink/internal/yudesk/protocol"
)

// A router that never answers a mapping request must not consume the ICE
// deadline before otherwise reachable LAN peers can exchange candidates.
func TestTrickleUnresponsiveMappingDoesNotPreventDirectConnection(t *testing.T) {
	var options [2]Options
	var checks [2]atomic.Int32
	var mappingDone [2]atomic.Bool
	for index := range options {
		index := index
		o := trickleOptions()
		o.PortMapping = true
		o.Timeout = 600 * time.Millisecond
		o.newUDPMux = func() (ice.UDPMux, *net.UDPConn, error) {
			socket, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
			if err != nil {
				return nil, nil, err
			}
			return ice.NewUDPMuxDefault(ice.UDPMuxParams{UDPConn: socket}), socket, nil
		}
		o.mapUDP = func(ctx context.Context, _ *net.UDPConn, _ natmap.Options) (natmap.Mapping, error) {
			<-ctx.Done()
			mappingDone[index].Store(true)
			return natmap.Mapping{}, ctx.Err()
		}
		o.configure = func(s *webrtc.SettingEngine) {
			s.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
			s.SetIncludeLoopbackCandidate(true)
			s.SetIPFilter(func(ip net.IP) bool { return ip.IsLoopback() })
			s.SetICEBindingRequestHandler(func(_ *stun.Message, _, _ ice.Candidate, _ *ice.CandidatePair) bool {
				if !mappingDone[index].Load() {
					checks[index].Add(1)
				}
				return false
			})
		}
		options[index] = o
	}
	a, b := encryptedPair(t)
	started := time.Now()
	results := runPair(t, context.Background(), [2]*protocol.Conn{protocol.NewConn(a), protocol.NewConn(b)}, options, [2]func() (protocol.Message, error){})
	for _, result := range results {
		if result.err != nil || result.info.Mode != "p2p" {
			t.Fatalf("router discovery blocked otherwise reachable direct path: %+v; checks=%d/%d", result, checks[0].Load(), checks[1].Load())
		}
	}
	for side := range checks {
		if checks[side].Load() == 0 {
			t.Fatal("both peers must receive authenticated connectivity checks while router discovery is pending")
		}
	}
	t.Logf("direct connection in %s; incoming checks while mapping pending: viewer=%d agent=%d", time.Since(started).Round(time.Millisecond), checks[0].Load(), checks[1].Load())
	roundTrip(t, results[0].c, results[1].c, 150_007)
	roundTrip(t, results[1].c, results[0].c, 90_003)
}

func TestTricklePendingMappingOrdersEndAndRetirement(t *testing.T) {
	for _, order := range []string{"mapping-first", "mapping-last", "retired"} {
		t.Run(order, func(t *testing.T) {
			a := &attempt{mapDone: make(chan struct{})}
			q := newTrickleCandidates(a, iceScope{mid: "0", ufrag: "ownedGeneration"})
			mappedIP := netip.MustParseAddr("203.0.113.20")
			if order == "mapping-first" {
				q.mappingReady(mappedIP, 45001)
			}
			q.add(&webrtc.ICECandidate{Foundation: "host", Priority: 2130706431, Address: "10.0.0.1", Port: 31001, Protocol: webrtc.ICEProtocolUDP, Typ: webrtc.ICECandidateTypeHost, Component: 1})
			q.add(nil)
			before, ended := q.drain(order == "retired")
			if order == "mapping-last" && ended {
				t.Fatal("EOC preceded pending mapped candidate")
			}
			if order != "mapping-first" {
				q.mappingReady(mappedIP, 45001)
			}
			after, end := q.drain(false)
			if !end {
				t.Fatal("mapping completion/retirement did not release EOC")
			}
			if order == "retired" {
				if len(after) != 0 {
					t.Fatal("mapped candidate was emitted after retirement")
				}
				return
			}
			mapped, internal := 0, 0
			for _, value := range append(before, after...) {
				if strings.Contains(value.Candidate, "203.0.113.20 45001 typ host") {
					mapped++
				}
				if strings.Contains(value.Candidate, "10.0.0.1 31001 typ host") {
					internal++
				}
			}
			if mapped != 1 || internal != 1 {
				t.Fatalf("internal endpoint was replaced or mapped endpoint duplicated: internal=%d mapped=%d", internal, mapped)
			}
		})
	}
}

func TestTrickleCanceledMapperReleasesLateLease(t *testing.T) {
	for _, resultError := range []bool{false, true} {
		t.Run(map[bool]string{false: "late-success", true: "lease-with-error"}[resultError], func(t *testing.T) {
			o := trickleOptions()
			o.PortMapping = true
			started := make(chan struct{})
			lease := &mappingTestLease{close: func() {}}
			o.mapUDP = func(ctx context.Context, _ *net.UDPConn, _ natmap.Options) (natmap.Mapping, error) {
				close(started)
				<-ctx.Done()
				var err error
				if resultError {
					err = errors.New("late mapping error")
				}
				return natmap.Mapping{ExternalIP: netip.MustParseAddr("203.0.113.20"), ExternalPort: 45001, Lease: lease}, err
			}
			a, err := newAttempt(context.Background(), o, time.Second)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(a.close)
			await(t, started)
			a.close()
			if lease.calls.Load() != 1 || a.mapping != nil {
				t.Fatal("canceled mapping leaked a late lease")
			}
		})
	}
}

func TestTrickleIPv6DirectWhileMappingPending(t *testing.T) {
	probe, err := net.ListenUDP("udp6", &net.UDPAddr{IP: net.IPv6loopback})
	if err != nil {
		t.Skip("IPv6 is unavailable")
	}
	_ = probe.Close()
	o := trickleOptions()
	o.PortMapping, o.pathV2 = true, true
	o.newUDPMux = func() (ice.UDPMux, *net.UDPConn, error) {
		socket, err := net.ListenUDP("udp6", &net.UDPAddr{IP: net.IPv6loopback})
		if err != nil {
			return nil, nil, err
		}
		return ice.NewUDPMuxDefault(ice.UDPMuxParams{UDPConn: socket}), socket, nil
	}
	o.mapUDP = func(ctx context.Context, _ *net.UDPConn, _ natmap.Options) (natmap.Mapping, error) {
		<-ctx.Done()
		return natmap.Mapping{}, ctx.Err()
	}
	o.configure = func(s *webrtc.SettingEngine) {
		s.SetIncludeLoopbackCandidate(true)
		s.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP6})
	}
	a, b := encryptedPair(t)
	results := runPair(t, context.Background(), [2]*protocol.Conn{protocol.NewConn(a), protocol.NewConn(b)}, [2]Options{o, o}, [2]func() (protocol.Message, error){})
	for _, result := range results {
		if result.err != nil || result.info != (Info{Mode: "p2p", Reason: "ipv6_direct"}) {
			t.Fatalf("IPv6 direct negotiation: %+v", result)
		}
	}
	roundTrip(t, results[0].c, results[1].c, 150007)
	roundTrip(t, results[1].c, results[0].c, 90003)
}
