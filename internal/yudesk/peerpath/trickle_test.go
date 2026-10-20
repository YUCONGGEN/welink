package peerpath

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pion/ice/v4"
	"github.com/pion/logging"
	"github.com/pion/transport/v4/vnet"
	"github.com/pion/webrtc/v4"
	"welink/internal/yudesk/protocol"
)

func trickleOptions() Options { o := hostOptions(); o.TrickleICE = true; return o }

func TestTrickleDirectAndFiniteRelayRetireBeforeHandoff(t *testing.T) {
	for _, direct := range []bool{true, false} {
		t.Run(map[bool]string{true: "direct", false: "no-UDP-relay"}[direct], func(t *testing.T) {
			a, b := encryptedPair(t)
			tracked := [2]*instrumentedConn{{Conn: a}, {Conn: b}}
			bases := [2]*protocol.Conn{protocol.NewConn(tracked[0]), protocol.NewConn(tracked[1])}
			var reads, peaks [2]atomic.Int32
			var mu sync.Mutex
			var stages [2][]string
			var readers [2]func() (protocol.Message, error)
			for i := range readers {
				readers[i] = func() (protocol.Message, error) {
					n := reads[i].Add(1)
					defer reads[i].Add(-1)
					for old := peaks[i].Load(); n > old && !peaks[i].CompareAndSwap(old, n); old = peaks[i].Load() {
					}
					m, err := bases[i].ReadMessage()
					mu.Lock()
					stages[i] = append(stages[i], m.Method)
					mu.Unlock()
					return m, err
				}
			}
			o := trickleOptions()
			if !direct {
				o = noUDPOptions()
				o.TrickleICE = true
			}
			started := time.Now()
			results := runPair(t, context.Background(), bases, [2]Options{o, o}, readers)
			want := "p2p"
			if !direct {
				want = "relay"
			}
			for i, r := range results {
				if r.err != nil || r.info.Mode != want || r.info != results[0].info {
					t.Fatalf("trickle path: %+v", r)
				}
				if peaks[i].Load() != 1 {
					t.Fatalf("concurrent relay readers: %d", peaks[i].Load())
				}
				mu.Lock()
				retired := false
				ended, ready, committed := false, false, false
				for _, stage := range stages[i] {
					retired = retired || stage == "retire"
					switch stage {
					case "candidate":
						if ended || ready {
							t.Error("candidate overtook EOC/ready")
						}
					case "end-of-candidates":
						if ended || ready {
							t.Error("duplicate or late EOC")
						}
						ended = true
					case "ready":
						if !ended || ready {
							t.Error("ready before candidate retirement")
						}
						ready = true
					case "commit":
						if !ready {
							t.Error("commit before ready")
						}
						committed = true
					case "retire":
						if !committed {
							t.Error("retire before commit")
						}
					}
				}
				mu.Unlock()
				if !retired {
					t.Fatal("handoff before signaling retirement")
				}
				if !direct && (r.c != bases[i] || reads[i].Load() != 0 || tracked[i].reads.Load() != 0) {
					t.Fatal("relay fallback did not retire its reader/preserve base")
				}
			}
			if time.Since(started) > o.Timeout+signalGrace {
				t.Fatal("ICE fallback exceeded its finite budget")
			}
			roundTrip(t, results[0].c, results[1].c, 70003)
			roundTrip(t, results[1].c, results[0].c, 33001)
			for _, r := range results {
				_ = r.c.Close()
			}
			for i := range tracked {
				if reads[i].Load() != 0 || tracked[i].reads.Load() != 0 {
					t.Fatal("reader leaked after close")
				}
			}
		})
	}
}

func TestAuthenticateTrickleMutualCapabilityAndOldPeerCompatibility(t *testing.T) {
	for _, tc := range []struct {
		name            string
		offer, accepted bool
	}{
		{"new-new", true, true}, {"new-viewer-old-agent", true, false}, {"old-viewer-new-agent", false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a, b := encryptedPair(t)
			agent := protocol.NewConn(b)
			done := make(chan outcome, 1)
			go func() {
				req, err := agent.ReadMessage()
				if err != nil {
					done <- outcome{err: err}
					return
				}
				var params map[string]any
				_ = json.Unmarshal(req.Params, &params)
				if params["p2pTrickleV1"] != tc.offer {
					done <- outcome{err: errors.New("wrong trickle offer")}
					return
				}
				if err = agent.WriteMessage(protocol.Response(req.ID, nil, map[string]any{"p2pV1": true, "p2pTrickleV1": tc.accepted})); err != nil {
					done <- outcome{err: err}
					return
				}
				o := hostOptions()
				o.TrickleICE = tc.offer && tc.accepted
				read := func() (protocol.Message, error) {
					m, err := agent.ReadMessage()
					if err == nil && m.Method == "offer" {
						var value signal
						_ = json.Unmarshal(m.Params, &value)
						if strings.Contains(value.SDP, "a=candidate:") == o.TrickleICE {
							return protocol.Message{}, errors.New("wrong full/trickle SDP wire")
						}
					}
					return m, err
				}
				c, info, err := Negotiate(context.Background(), agent, "agent", read, o)
				done <- outcome{c, info, err}
			}()
			params := map[string]any{}
			if !tc.offer {
				params["p2pTrickleV1"] = false
			}
			pc, auth, info, err := Authenticate(context.Background(), a, params, trickleOptions())
			if err != nil || info.Mode != "p2p" {
				t.Fatalf("auth path: %+v %v", info, err)
			}
			defer pc.Close()
			peer := await(t, done)
			if peer.err != nil || peer.info != info {
				t.Fatalf("agent path: %+v", peer)
			}
			defer peer.c.Close()
			if auth.Meta["p2pTrickleV1"] != tc.accepted {
				t.Fatal("auth capability lost")
			}
			roundTrip(t, pc, peer.c, 10003)
			if tc.offer {
				if _, mutated := params["p2pTrickleV1"]; mutated {
					t.Fatal("mutated caller params")
				}
			}
		})
	}
}

func TestTrickleSDPAndCandidateScopeValidation(t *testing.T) {
	a, err := newAttempt(context.Background(), trickleOptions(), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer a.close()
	desc, q := a.trickleDescription(true)
	if desc.SDP == "" || q == nil {
		t.Fatalf("candidate-less description failed: %+v", desc)
	}
	scope, err := validateTrickleSDP(desc.SDP, false)
	if err != nil {
		t.Fatal(err)
	}
	good := scopedCandidate("candidate:1 1 udp 2130706431 127.0.0.1 12345 typ host", scope)
	if err = validateTrickleCandidate(good, scope, false, false); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*webrtc.ICECandidateInit){
		"wrong-mid":       func(v *webrtc.ICECandidateInit) { s := "1"; v.SDPMid = &s },
		"wrong-index":     func(v *webrtc.ICECandidateInit) { i := uint16(1); v.SDPMLineIndex = &i },
		"stale-ufrag":     func(v *webrtc.ICECandidateInit) { s := "stale"; v.UsernameFragment = &s },
		"missing-scope":   func(v *webrtc.ICECandidateInit) { v.UsernameFragment = nil },
		"ufrag-extension": func(v *webrtc.ICECandidateInit) { v.Candidate += " ufrag stale" },
		"DNS": func(v *webrtc.ICECandidateInit) {
			v.Candidate = strings.ReplaceAll(v.Candidate, "127.0.0.1", "x.local")
		},
		"TCP": func(v *webrtc.ICECandidateInit) {
			v.Candidate = strings.ReplaceAll(v.Candidate, " udp ", " tcp ") + " tcptype passive"
		},
		"unscoped-TURN": func(v *webrtc.ICECandidateInit) {
			v.Candidate = strings.ReplaceAll(v.Candidate, "typ host", "typ relay")
		},
		"zero-port": func(v *webrtc.ICECandidateInit) { v.Candidate = strings.ReplaceAll(v.Candidate, "12345", "0") },
		"oversized": func(v *webrtc.ICECandidateInit) { v.Candidate += strings.Repeat("x", 1024) },
		"multicast": func(v *webrtc.ICECandidateInit) {
			v.Candidate = strings.ReplaceAll(v.Candidate, "127.0.0.1", "224.0.0.1")
		},
		"unspecified": func(v *webrtc.ICECandidateInit) {
			v.Candidate = strings.ReplaceAll(v.Candidate, "127.0.0.1", "0.0.0.0")
		},
	} {
		t.Run(name, func(t *testing.T) {
			v := good
			mutate(&v)
			if validateTrickleCandidate(v, scope, false, false) == nil {
				t.Fatal("accepted invalid candidate")
			}
		})
	}
	if validateTrickleCandidate(scopedCandidate("", scope), scope, false, true) != nil || validateTrickleCandidate(good, scope, false, true) == nil {
		t.Fatal("end-of-candidates validation")
	}
	for name, raw := range map[string]string{
		"embedded-candidate": desc.SDP + "a=" + good.Candidate + "\r\n",
		"embedded-end":       desc.SDP + "a=end-of-candidates\r\n",
		"missing-pwd":        strings.ReplaceAll(desc.SDP, "a=ice-pwd:", "a=removed-pwd:"),
		"missing-mid":        strings.ReplaceAll(desc.SDP, "a=mid:", "a=removed-mid:"),
		"missing-ufrag":      strings.ReplaceAll(desc.SDP, "a=ice-ufrag:", "a=removed-ufrag:"),
		"duplicate-ufrag":    desc.SDP + "a=ice-ufrag:another\r\n",
		"bad-fingerprint":    strings.ReplaceAll(desc.SDP, "fingerprint:sha-256", "fingerprint:sha-1"),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := validateTrickleSDP(raw, false); err == nil {
				t.Fatal("accepted invalid trickle SDP")
			}
		})
	}
}

func TestTrickleLateSTUNEnablesRealDualNATPathMissedByFullSDP(t *testing.T) {
	// Beyond BOTH legacy SDP snapshots: one peer can otherwise advertise
	// srflx in its later answer and rescue the first through peer-reflexive ICE.
	const delay = 2200 * time.Millisecond
	cone := vnet.NATType{MappingBehavior: vnet.EndpointIndependent, FilteringBehavior: vnet.EndpointIndependent}
	for _, trickle := range []bool{false, true} {
		t.Run(map[bool]string{false: "full-SDP-misses-late-candidate", true: "trickle-connects-late-candidate"}[trickle], func(t *testing.T) {
			options := mixedNATOptionsWithDelay(t, [2]vnet.NATType{cone, cone}, delay)
			for i := range options {
				options[i].Timeout = 3500 * time.Millisecond
				options[i].TrickleICE = trickle
			}
			a, b := encryptedPair(t)
			bases := [2]*protocol.Conn{protocol.NewConn(a), protocol.NewConn(b)}
			started := time.Now()
			var firstDescription atomic.Int64
			var lateCandidates atomic.Int32
			var readers [2]func() (protocol.Message, error)
			for i := range readers {
				readers[i] = func() (protocol.Message, error) {
					m, err := bases[i].ReadMessage()
					if err == nil && (m.Method == "offer" || m.Method == "answer") {
						firstDescription.CompareAndSwap(0, int64(time.Since(started)))
					}
					if err == nil && m.Method == "candidate" {
						var value webrtc.ICECandidateInit
						_ = json.Unmarshal(m.Params, &value)
						c, parseErr := ice.UnmarshalCandidate(strings.TrimPrefix(value.Candidate, "candidate:"))
						if parseErr == nil && c.Type() == ice.CandidateTypeServerReflexive {
							lateCandidates.Add(1)
						}
					}
					return m, err
				}
			}
			results := runPair(t, context.Background(), bases, options, readers)
			want := "relay"
			if trickle {
				want = "p2p"
			}
			for _, r := range results {
				if r.err != nil || r.info.Mode != want {
					t.Fatalf("late-STUN topology: %+v want %s", r, want)
				}
				if trickle {
					pair, err := r.c.Conn.(*sessionConn).a.pc.SCTP().Transport().ICETransport().GetSelectedCandidatePair()
					if err != nil || pair == nil || pair.Local.Typ == webrtc.ICECandidateTypeHost && pair.Remote.Typ == webrtc.ICECandidateTypeHost {
						t.Fatalf("fixture bypassed NAT/STUN: %+v %v", pair, err)
					}
				}
			}
			if trickle && (time.Duration(firstDescription.Load()) >= delay/2 || lateCandidates.Load() < 2) {
				t.Fatalf("offer did not precede late STUN or candidates lost: first=%s srflx=%d", time.Duration(firstDescription.Load()), lateCandidates.Load())
			}
			t.Logf("%s after %s, first SDP %s, late srflx=%d", want, time.Since(started).Round(time.Millisecond), time.Duration(firstDescription.Load()).Round(time.Millisecond), lateCandidates.Load())
			roundTrip(t, results[0].c, results[1].c, 70007)
		})
	}
}

type retireTrailerConn struct {
	net.Conn
	trailer  []byte
	appended atomic.Bool
}

func (c *retireTrailerConn) Write(p []byte) (int, error) {
	if len(p) >= 8 {
		h := int(binary.BigEndian.Uint32(p[:4]))
		var m protocol.Message
		if h <= len(p)-8 && json.Unmarshal(p[8:8+h], &m) == nil && m.Method == "retire" {
			wire := append(append([]byte{}, p...), c.trailer...)
			n, err := c.Conn.Write(wire)
			if err != nil {
				return 0, err
			}
			if n != len(wire) {
				return 0, io.ErrShortWrite
			}
			c.appended.Store(true)
			return len(p), nil
		}
	}
	return c.Conn.Write(p)
}

func TestTrickleRetirementPreservesApplicationPrefetchedInSameEncryptedRecord(t *testing.T) {
	a, b := encryptedPair(t)
	app := protocol.Message{Kind: "event", Method: "prefetched-after-retire", Data: []byte{0, 255, 19, 91}}
	wrappers := [2]*retireTrailerConn{{Conn: a, trailer: packet(t, app)}, {Conn: b, trailer: packet(t, app)}}
	bases := [2]*protocol.Conn{protocol.NewConn(wrappers[0]), protocol.NewConn(wrappers[1])}
	o := noUDPOptions()
	o.TrickleICE = true
	results := runPair(t, context.Background(), bases, [2]Options{o, o}, [2]func() (protocol.Message, error){})
	for i, r := range results {
		if r.err != nil || r.info.Mode != "relay" || !wrappers[i].appended.Load() {
			t.Fatalf("retirement fixture: %+v", r)
		}
		_ = r.c.SetReadDeadline(time.Now().Add(time.Second))
		m, err := r.c.ReadMessage()
		if err != nil || m.Method != app.Method || string(m.Data) != string(app.Data) {
			t.Fatalf("application frame swallowed by signaling: %+v %v", m, err)
		}
	}
}

func TestTrickleCandidateBeforeDescriptionBufferedAndFloodBounded(t *testing.T) {
	for _, flood := range []bool{false, true} {
		t.Run(map[bool]string{false: "early-real-candidate", true: "33-early-candidates-rejected"}[flood], func(t *testing.T) {
			a, b := encryptedPair(t)
			tracked := &instrumentedConn{Conn: b}
			bases := [2]*protocol.Conn{protocol.NewConn(a), protocol.NewConn(tracked)}
			var saved *protocol.Message
			var candidate protocol.Message
			remaining := 0
			first := true
			read := func() (protocol.Message, error) {
				if remaining > 0 {
					remaining--
					return candidate, nil
				}
				if saved != nil {
					m := *saved
					saved = nil
					return m, nil
				}
				m, err := bases[1].ReadMessage()
				if err == nil && first {
					first = false
					if m.Method != "offer" {
						return m, errors.New("expected real offer")
					}
					saved = &m
					candidate, err = bases[1].ReadMessage()
					if err != nil || candidate.Method != "candidate" {
						return candidate, errors.New("expected real early candidate")
					}
					if flood {
						remaining = maxCandidates
					}
					return candidate, nil
				}
				return m, err
			}
			results := runPair(t, context.Background(), bases, [2]Options{trickleOptions(), trickleOptions()}, [2]func() (protocol.Message, error){nil, read})
			for _, r := range results {
				if flood {
					if r.err == nil || !errors.Is(r.err, ErrSignaling) || r.c != nil {
						t.Fatalf("early flood accepted: %+v", r)
					}
				} else if r.err != nil || r.info.Mode != "p2p" {
					t.Fatalf("early candidate lost: %+v", r)
				}
			}
			if flood && tracked.reads.Load() != 0 {
				t.Fatal("flood reader leaked")
			}
			if !flood {
				roundTrip(t, results[0].c, results[1].c, 20007)
			}
		})
	}
}

func TestTrickleLostSignalingAndEndOrderingTerminateWithoutReusableFallback(t *testing.T) {
	for _, fault := range []string{"drop-answer", "drop-end", "drop-commit", "drop-retire", "candidate-after-end", "duplicate-end", "wrong-end-scope", "unknown-candidate-field", "trailing-candidate-json", "null-retire"} {
		t.Run(fault, func(t *testing.T) {
			// Exercise the selected signaling failure, independently of physical
			// NIC/VPN enumeration exceeding the short ICE budget on Windows.
			options := virtualTrickleOptions(t, 2*time.Second)
			a, b := encryptedPair(t)
			bases := [2]*protocol.Conn{protocol.NewConn(a), protocol.NewConn(b)}
			var inject *protocol.Message
			var candidate protocol.Message
			mutated := false
			read := func() (protocol.Message, error) {
				if inject != nil {
					m := *inject
					inject = nil
					return m, nil
				}
				for {
					m, err := bases[0].ReadMessage()
					if err != nil {
						return m, err
					}
					if m.Method == "candidate" {
						candidate = m
					}
					if mutated {
						return m, nil
					}
					switch {
					case fault == "drop-answer" && m.Method == "answer", fault == "drop-end" && m.Method == "end-of-candidates", fault == "drop-commit" && m.Method == "commit", fault == "drop-retire" && m.Method == "retire":
						mutated = true
						continue
					case fault == "candidate-after-end" && m.Method == "end-of-candidates":
						mutated = true
						inject = &candidate
					case fault == "duplicate-end" && m.Method == "end-of-candidates":
						mutated = true
						duplicate := m
						inject = &duplicate
					case fault == "wrong-end-scope" && m.Method == "end-of-candidates":
						mutated = true
						var v webrtc.ICECandidateInit
						_ = json.Unmarshal(m.Params, &v)
						wrong := "stale"
						v.UsernameFragment = &wrong
						m.Params, _ = json.Marshal(v)
					case fault == "unknown-candidate-field" && m.Method == "candidate":
						mutated = true
						m.Params = append(append([]byte{}, m.Params[:len(m.Params)-1]...), []byte(",\"unrecognized\":true}")...)
					case fault == "trailing-candidate-json" && m.Method == "candidate":
						mutated = true
						m.Params = append(append([]byte{}, m.Params...), []byte(" {}")...)
					case fault == "null-retire" && m.Method == "retire":
						mutated = true
						m.Params = []byte("null")
					}
					return m, nil
				}
			}
			started := time.Now()
			results := runPair(t, context.Background(), bases, options, [2]func() (protocol.Message, error){read, nil})
			if !mutated {
				t.Fatal("fault fixture did not reach selected signaling stage")
			}
			failed := false
			for _, r := range results {
				if r.err != nil {
					failed = true
					if !errors.Is(r.err, ErrSignaling) || r.c != nil || r.info != (Info{}) {
						t.Fatalf("invalid failed outcome: %+v", r)
					}
				}
				if r.c != nil {
					if r.info.Mode == "relay" {
						t.Fatal("lost signaling returned a unilateral reusable relay")
					}
					session := r.c.Conn.(*sessionConn)
					select {
					case <-session.done:
					case <-time.After(time.Second):
						t.Fatal("peer returned direct survived broken authorization tether")
					}
				}
			}
			if !failed || time.Since(started) > options[0].Timeout+signalGrace+time.Second {
				t.Fatal("lost signaling was not finitely terminated")
			}
		})
	}
}

func TestTrickleCancellationAndSilentPeerJoinReader(t *testing.T) {
	for _, cancelNow := range []bool{true, false} {
		t.Run(map[bool]string{true: "cancel", false: "bounded-silent-peer"}[cancelNow], func(t *testing.T) {
			a, b := encryptedPair(t)
			tracked := &instrumentedConn{Conn: a}
			base, peer := protocol.NewConn(tracked), protocol.NewConn(b)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			o := trickleOptions()
			o.Timeout = 100 * time.Millisecond
			done := make(chan outcome, 1)
			started := time.Now()
			go func() { c, info, err := Negotiate(ctx, base, "viewer", nil, o); done <- outcome{c, info, err} }()
			if _, err := peer.ReadMessage(); err != nil {
				t.Fatal(err)
			}
			if cancelNow {
				cancel()
			}
			r := await(t, done)
			if r.err == nil || r.c != nil || tracked.reads.Load() != 0 || time.Since(started) > o.Timeout+signalGrace+time.Second {
				t.Fatalf("reader lifetime: %+v active=%d", r, tracked.reads.Load())
			}
		})
	}
}

func virtualTrickleOptions(t *testing.T, timeout time.Duration) [2]Options {
	t.Helper()
	wan, err := vnet.NewRouter(&vnet.RouterConfig{CIDR: "192.0.2.0/24", LoggerFactory: logging.NewDefaultLoggerFactory()})
	if err != nil {
		t.Fatal(err)
	}
	var options [2]Options
	for i, address := range []string{"192.0.2.10", "192.0.2.20"} {
		network, err := vnet.NewNet(&vnet.NetConfig{StaticIPs: []string{address}})
		if err != nil {
			t.Fatal(err)
		}
		if err := wan.AddNet(network); err != nil {
			t.Fatal(err)
		}
		options[i] = Options{STUNURLs: []string{}, TrickleICE: true, Timeout: timeout, configure: func(s *webrtc.SettingEngine) {
			s.SetNet(network)
			s.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
		}}
	}
	if err := wan.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = wan.Stop() })
	return options
}

func TestTrickleLostAllCandidateFramesAgreesReusableRelay(t *testing.T) {
	options := virtualTrickleOptions(t, 600*time.Millisecond)
	a, b := encryptedPair(t)
	tracked := [2]*instrumentedConn{{Conn: a}, {Conn: b}}
	bases := [2]*protocol.Conn{protocol.NewConn(tracked[0]), protocol.NewConn(tracked[1])}
	var dropped [2]atomic.Int32
	var readers [2]func() (protocol.Message, error)
	for i := range readers {
		readers[i] = func() (protocol.Message, error) {
			for {
				m, err := bases[i].ReadMessage()
				if err != nil || m.Method != "candidate" {
					return m, err
				}
				dropped[i].Add(1)
			}
		}
	}
	results := runPair(t, context.Background(), bases, options, readers)
	for i, r := range results {
		if r.err != nil || r.c != bases[i] || r.info != (Info{Mode: "relay", Reason: "ice_timeout"}) || dropped[i].Load() == 0 || tracked[i].reads.Load() != 0 {
			t.Fatalf("lost candidates fallback: %+v dropped=%d active=%d", r, dropped[i].Load(), tracked[i].reads.Load())
		}
	}
	roundTrip(t, results[0].c, results[1].c, 32003)
}

func TestTrickleLocalCandidateBoundKeepsLateMappedSTUNTURNAndClosesEOC(t *testing.T) {
	a := &attempt{allowRelay: true, mapped: true, mappedIP: netip.MustParseAddr("203.0.113.20"), mappedPort: 45000}
	scope := iceScope{mid: "0", ufrag: "ownedGeneration"}
	q := newTrickleCandidates(a, scope)
	add := func(kind webrtc.ICECandidateType, address string, port int) {
		candidate := &webrtc.ICECandidate{Foundation: "owned", Priority: 2130706431, Address: address, Port: uint16(port), Protocol: webrtc.ICEProtocolUDP, Typ: kind, Component: 1}
		if kind == webrtc.ICECandidateTypeSrflx || kind == webrtc.ICECandidateTypeRelay {
			candidate.RelatedAddress, candidate.RelatedPort = "10.0.0.1", 12345
		}
		q.add(candidate)
	}
	for i := 0; i < 512; i++ {
		add(webrtc.ICECandidateTypeHost, fmt.Sprintf("10.0.1.%d", i%254+1), 20000+i)
	}
	for i := 0; i < 16; i++ {
		add(webrtc.ICECandidateTypeHost, fmt.Sprintf("2001:db8::%x", i+1), 30000+i)
	}
	add(webrtc.ICECandidateTypeHost, a.mappedIP.String(), 30000)
	for i := 0; i < 16; i++ {
		add(webrtc.ICECandidateTypeSrflx, fmt.Sprintf("203.0.113.%d", 30+i), 40000+i)
		add(webrtc.ICECandidateTypeRelay, fmt.Sprintf("203.0.113.%d", 60+i), 50000+i)
	}
	q.add(nil)
	values, ended := q.drain(false)
	if !ended || len(values) > maxCandidates || len(q.seen) > maxCandidates {
		t.Fatal("local candidate memory/signaling bound failed")
	}
	found := map[ice.CandidateType]bool{}
	mapped := false
	ipv6 := false
	for _, v := range values {
		if err := validateTrickleCandidate(v, scope, true, false); err != nil {
			t.Fatal(err)
		}
		c, err := ice.UnmarshalCandidate(strings.TrimPrefix(v.Candidate, "candidate:"))
		if err != nil {
			t.Fatal(err)
		}
		found[c.Type()] = true
		mapped = mapped || c.Address() == a.mappedIP.String() && c.Port() == int(a.mappedPort)
		ipv6 = ipv6 || strings.Contains(c.Address(), ":")
	}
	if !mapped || !ipv6 || !found[ice.CandidateTypeServerReflexive] || !found[ice.CandidateTypeRelay] {
		t.Fatalf("early host flood crowded out useful late candidates: mapped=%v ipv6=%v kinds=%v", mapped, ipv6, found)
	}
	// Retirement races actual callback conversion, including natural EOC. Its
	// final drain owns all earlier candidates; none may arrive after that end.
	for round := 0; round < 20; round++ {
		q = newTrickleCandidates(a, scope)
		var wg sync.WaitGroup
		for i := 0; i < 16; i++ {
			wg.Add(1)
			go func(i int) { defer wg.Done(); add(webrtc.ICECandidateTypeHost, "127.0.0.1", 20000+i) }(i)
		}
		wg.Add(1)
		go func() { defer wg.Done(); q.add(nil) }()
		before, end := q.drain(true)
		wg.Wait()
		after, _ := q.drain(false)
		if !end || len(before) > maxCandidates || len(after) != 0 {
			t.Fatal("callback emitted candidates after EOC retirement")
		}
	}
}

func TestTrickleRealNATConnectivityAndHonestSymmetricFallback(t *testing.T) {
	cone := vnet.NATType{MappingBehavior: vnet.EndpointIndependent, FilteringBehavior: vnet.EndpointIndependent}
	symmetric := vnet.NATType{MappingBehavior: vnet.EndpointAddrPortDependent, FilteringBehavior: vnet.EndpointAddrPortDependent}
	for _, tc := range []struct {
		name  string
		types [2]vnet.NATType
		mode  string
	}{
		{"cone-cone", [2]vnet.NATType{cone, cone}, "p2p"},
		{"cone-symmetric-prflx", [2]vnet.NATType{cone, symmetric}, "p2p"},
		{"dual-symmetric-relay", [2]vnet.NATType{symmetric, symmetric}, "relay"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			options := mixedNATOptions(t, tc.types)
			for i := range options {
				options[i].TrickleICE = true
			}
			a, b := encryptedPair(t)
			bases := [2]*protocol.Conn{protocol.NewConn(a), protocol.NewConn(b)}
			results := runPair(t, context.Background(), bases, options, [2]func() (protocol.Message, error){})
			for i, r := range results {
				if r.err != nil || r.info.Mode != tc.mode || r.info != results[0].info {
					t.Fatalf("real NAT result: %+v", r)
				}
				if tc.mode == "relay" && r.c != bases[i] {
					t.Fatal("symmetric fallback did not preserve original relay")
				}
			}
			roundTrip(t, results[0].c, results[1].c, 70007)
		})
	}
}

func TestTrickleRTCUnavailableMutuallyCommitsFallback(t *testing.T) {
	for side := 0; side < 2; side++ {
		t.Run(fmt.Sprint(side), func(t *testing.T) {
			a, b := encryptedPair(t)
			bases := [2]*protocol.Conn{protocol.NewConn(a), protocol.NewConn(b)}
			options := [2]Options{trickleOptions(), trickleOptions()}
			options[side].STUNURLs = []string{"invalid:owned"}
			results := runPair(t, context.Background(), bases, options, [2]func() (protocol.Message, error){})
			for i, r := range results {
				if r.err != nil || r.c != bases[i] || r.info.Mode != "relay" || r.info != results[0].info {
					t.Fatalf("unavailable RTC fallback: %+v", r)
				}
			}
			roundTrip(t, results[0].c, results[1].c, 33007)
		})
	}
}
