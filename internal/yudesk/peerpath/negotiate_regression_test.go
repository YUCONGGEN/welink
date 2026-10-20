package peerpath

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/pion/ice/v4"
	"github.com/pion/stun/v4"
	"github.com/pion/transport/v4"
	"github.com/pion/transport/v4/stdnet"
	"github.com/pion/webrtc/v4"
	"welink/internal/yudesk/protocol"
)

// Model a shared local STUN endpoint while retaining real host sockets for
// connectivity. Only wildcard IPv4 sockets (STUN gathering) report this base;
// interface-bound host sockets keep their real addresses and ports.
type symmetricSTUNNet struct{ transport.Net }
type symmetricSTUNConn struct{ transport.UDPConn }

func (n symmetricSTUNNet) ListenUDP(network string, address *net.UDPAddr) (transport.UDPConn, error) {
	c, err := n.Net.ListenUDP(network, address)
	if err == nil && network == "udp4" && (address == nil || len(address.IP) == 0 || address.IP.IsUnspecified()) {
		return symmetricSTUNConn{c}, nil
	}
	return c, err
}

func (c symmetricSTUNConn) LocalAddr() net.Addr {
	return &net.UDPAddr{IP: net.IPv4(192, 168, 1, 8), Port: 52000}
}

func symmetricSTUNOptions(t *testing.T) Options {
	t.Helper()
	o := hostOptions()
	for _, port := range []int{41000, 41001} {
		server, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
		if err != nil {
			t.Fatal(err)
		}
		o.STUNURLs = append(o.STUNURLs, "stun:"+server.LocalAddr().String())
		done := make(chan struct{})
		go func() {
			defer close(done)
			buf := make([]byte, 1500)
			for {
				n, address, err := server.ReadFromUDP(buf)
				if err != nil {
					return
				}
				request := &stun.Message{Raw: buf[:n]}
				if request.Decode() != nil || request.Type != stun.BindingRequest {
					continue
				}
				response, err := stun.Build(stun.NewTransactionIDSetter(request.TransactionID), stun.BindingSuccess,
					&stun.XORMappedAddress{IP: net.IPv4(203, 0, 113, 10), Port: port})
				if err == nil {
					_, _ = server.WriteToUDP(response.Raw, address)
				}
			}
		}()
		t.Cleanup(func() { _ = server.Close(); await(t, done) })
	}
	network, err := stdnet.NewNet()
	if err != nil {
		t.Fatal(err)
	}
	o.configure = func(s *webrtc.SettingEngine) {
		s.SetIncludeLoopbackCandidate(true)
		s.SetNet(symmetricSTUNNet{network})
	}
	return o
}

func TestSymmetricNATSignaturePreservesDirectCandidates(t *testing.T) {
	for _, family := range []string{"LAN", "IPv6"} {
		for side, role := range []string{"viewer", "agent"} {
			t.Run(family+"/"+role, func(t *testing.T) {
				if family == "LAN" {
					addresses, err := net.InterfaceAddrs()
					private := false
					for _, address := range addresses {
						ip, _, _ := net.ParseCIDR(address.String())
						private = private || ip.To4() != nil && ip.IsPrivate()
					}
					if err != nil || !private {
						t.Skip("no private IPv4 interface")
					}
				}
				if family == "IPv6" {
					probe, err := net.ListenUDP("udp6", &net.UDPAddr{IP: net.IPv6loopback})
					if err != nil {
						t.Skipf("IPv6 unavailable: %v", err)
					}
					_ = probe.Close()
				}
				options := [2]Options{hostOptions(), hostOptions()}
				options[side] = symmetricSTUNOptions(t)
				if family == "LAN" {
					configure := options[side].configure
					options[side].configure = func(s *webrtc.SettingEngine) {
						configure(s)
						s.SetIncludeLoopbackCandidate(false)
					}
				}
				options[1-side].configure = func(s *webrtc.SettingEngine) {
					s.SetIncludeLoopbackCandidate(true)
					kind := webrtc.NetworkTypeUDP4
					if family == "IPv6" {
						kind = webrtc.NetworkTypeUDP6
					}
					s.SetNetworkTypes([]webrtc.NetworkType{kind})
					if family == "LAN" {
						s.SetIPFilter(func(ip net.IP) bool { return ip.IsPrivate() })
					}
				}
				options[0].pathV2, options[1].pathV2 = true, true
				if family == "IPv6" {
					// Pion's interface enumeration excludes ::1; explicit muxes
					// exercise real IPv6 UDP without requiring a global interface.
					for i := range options {
						socket, err := net.ListenUDP("udp6", &net.UDPAddr{IP: net.IPv6loopback})
						if err != nil {
							t.Fatal(err)
						}
						mux := ice.NewUDPMuxDefault(ice.UDPMuxParams{UDPConn: socket})
						t.Cleanup(func() { _ = mux.Close() })
						configure := options[i].configure
						options[i].configure = func(s *webrtc.SettingEngine) {
							configure(s)
							s.SetICEUDPMux(mux)
						}
					}
				}
				a, b := encryptedPair(t)
				bases := [2]*protocol.Conn{protocol.NewConn(a), protocol.NewConn(b)}
				var readers [2]func() (protocol.Message, error)
				readers[1-side] = func() (protocol.Message, error) {
					m, err := bases[1-side].ReadMessage()
					if err == nil && (m.Method == "offer" || m.Method == "answer") {
						var value signal
						if err := json.Unmarshal(m.Params, &value); err != nil {
							t.Error(err)
						}
						if !endpointDependentMapping(value.SDP) || !strings.Contains(value.SDP, "typ host") {
							t.Errorf("symmetric signature and host candidates must survive signaling: %+v", value)
						}
					}
					return m, err
				}
				results := runPair(t, context.Background(), bases, options, readers)
				want := Info{Mode: "p2p", Reason: "udp_direct"}
				if family == "IPv6" {
					want.Reason = "ipv6_direct"
				}
				for _, r := range results {
					if r.err != nil || r.info != want {
						t.Fatalf("direct candidate discarded: %+v, want %+v", r, want)
					}
					if family == "LAN" {
						pair, err := r.c.Conn.(*sessionConn).a.pc.SCTP().Transport().ICETransport().GetSelectedCandidatePair()
						if err != nil || pair == nil || !net.ParseIP(pair.Local.Address).IsPrivate() || !net.ParseIP(pair.Remote.Address).IsPrivate() {
							t.Fatalf("expected private LAN pair, got %+v: %v", pair, err)
						}
					}
				}
				roundTrip(t, results[0].c, results[1].c, 1234)
				roundTrip(t, results[1].c, results[0].c, 4321)
			})
		}
	}
}

func TestNegotiationSilentPeerDeadline(t *testing.T) {
	for _, parentDeadline := range []bool{false, true} {
		t.Run(map[bool]string{false: "signaling-grace", true: "parent-deadline"}[parentDeadline], func(t *testing.T) {
			a, b := encryptedPair(t)
			tracked := &instrumentedConn{Conn: a}
			base, peer := protocol.NewConn(tracked), protocol.NewConn(b)
			ctx := context.Background()
			if parentDeadline {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, 100*time.Millisecond)
				defer cancel()
			}
			o := hostOptions()
			o.Timeout = 100 * time.Millisecond
			started := time.Now()
			done := make(chan outcome, 1)
			go func() {
				c, info, err := Negotiate(ctx, base, "viewer", nil, o)
				done <- outcome{c, info, err}
			}()
			// A caller's 100 ms deadline may expire while ICE initializes,
			// before an offer can be sent. Closing the base in that case is
			// correct; continue checking the deadline and reader cleanup.
			if _, err := peer.ReadMessage(); err != nil {
				deadline, hasDeadline := ctx.Deadline()
				// A socket deadline may close the stream before the context
				// timer publishes ctx.Err. Accept EOF only at/after the actual
				// caller deadline, then check ctx.Done below; early EOF fails.
				if !parentDeadline || !errors.Is(err, io.EOF) || !hasDeadline || time.Now().Before(deadline) {
					t.Fatal(err)
				}
			}
			r := await(t, done)
			budget := o.Timeout + signalGrace
			if parentDeadline {
				budget = o.Timeout
			}
			if r.err == nil || r.c != nil || r.info != (Info{}) || time.Since(started) > budget+time.Second {
				t.Fatalf("silent peer not bounded: %+v elapsed=%s", r, time.Since(started))
			}
			// The socket deadline and context timer share the same instant.
			// A read timeout may win that race before ctx.Done is scheduled.
			// Do not mistake that correctly bounded failure for a leaked timer.
			if parentDeadline {
				select {
				case <-ctx.Done():
				case <-time.After(time.Second):
					t.Fatal("caller deadline was not reached")
				}
				if !errors.Is(ctx.Err(), context.DeadlineExceeded) {
					t.Fatalf("caller deadline was not reached: %v", ctx.Err())
				}
			}
			if tracked.reads.Load() != 0 {
				t.Fatal("signaling reader leaked")
			}
			if _, err := peer.ReadMessage(); err == nil {
				t.Fatal("expired negotiation left base open")
			}
		})
	}
}
