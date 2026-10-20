package peerpath

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/pion/ice/v4"
	"github.com/pion/webrtc/v4"
	"welink/internal/yudesk/protocol"
	"welink/internal/yudesk/secureconn"
)

// An operator-owned SSH tunnel carries only the bootstrap/tether, never the
// selected UDP path. The listener is loopback-only, the ephemeral public device
// ID must be pinned via that SSH session, and no production device, capture,
// input, account or TURN credential is used. A relay outcome is measured as
// such, not counted as a successful Internet hole punch.
func TestInternetP2PProbe(t *testing.T) {
	role := os.Getenv("YUDESK_P2P_WAN_ROLE")
	if role == "" {
		t.Skip("operator-owned, two-host opt-in diagnostic")
	}
	if role != "agent" && role != "viewer" {
		t.Fatal("probe role must be agent or viewer")
	}
	address := os.Getenv("YUDESK_P2P_WAN_ADDRESS")
	host, _, err := net.SplitHostPort(address)
	if err != nil || host != "127.0.0.1" {
		t.Fatal("bootstrap must use an explicitly forwarded loopback address")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var raw net.Conn
	if role == "agent" {
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		listener, err := net.Listen("tcp4", address)
		if err != nil {
			t.Fatal(err)
		}
		defer listener.Close()
		_ = listener.(*net.TCPListener).SetDeadline(time.Now().Add(25 * time.Second))
		ready, _ := json.Marshal(map[string]string{"address": listener.Addr().String(), "deviceID": secureconn.DeviceID(pub)})
		readyPath := os.Getenv("YUDESK_P2P_WAN_READY")
		if readyPath == "" {
			t.Fatal("agent requires an explicit readiness file")
		}
		file, err := os.OpenFile(readyPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Remove(readyPath) })
		_, writeErr := file.Write(ready)
		closeErr := file.Close()
		if writeErr != nil || closeErr != nil {
			t.Fatalf("readiness write: %v, close: %v", writeErr, closeErr)
		}
		incoming, err := listener.Accept()
		if err != nil {
			t.Fatal(err)
		}
		defer incoming.Close()
		_ = incoming.SetDeadline(time.Now().Add(5 * time.Second))
		raw, err = secureconn.Accept(incoming, priv)
		if err != nil {
			t.Fatal(err)
		}
	} else {
		if os.Getenv("YUDESK_P2P_WAN_ID") == "" {
			t.Fatal("viewer requires the SSH-pinned ephemeral device ID")
		}
		outgoing, err := net.DialTimeout("tcp4", address, 5*time.Second)
		if err != nil {
			t.Fatal(err)
		}
		defer outgoing.Close()
		_ = outgoing.SetDeadline(time.Now().Add(5 * time.Second))
		raw, err = secureconn.Connect(outgoing, os.Getenv("YUDESK_P2P_WAN_ID"))
		if err != nil {
			t.Fatal(err)
		}
	}
	defer raw.Close()
	lanes := os.Getenv("YUDESK_P2P_WAN_LANES")
	if lanes != "" && lanes != "1" {
		t.Fatal("unknown independent-lane probe setting")
	}
	var laneSeed []byte
	if lanes == "1" {
		// This is a diagnostic secret on the SSH-pinned E2E bootstrap, never
		// a production account/device credential. Both probe roles must opt in.
		laneSeed = make([]byte, 32)
		if role == "agent" {
			if _, err := rand.Read(laneSeed); err != nil {
				t.Fatal(err)
			}
			if n, err := raw.Write(laneSeed); err != nil || n != len(laneSeed) {
				t.Fatalf("probe lane bootstrap write: %v", err)
			}
		} else if _, err := io.ReadFull(raw, laneSeed); err != nil {
			t.Fatalf("probe lane bootstrap read: %v", err)
		}
	}
	_ = raw.SetDeadline(time.Time{})
	o := DefaultOptions().WithSessionLanes(laneSeed)
	o.TrickleICE = true
	family := os.Getenv("YUDESK_P2P_WAN_FAMILY")
	switch family {
	case "", "dual", "ipv4", "ipv6":
	default:
		t.Fatal("unknown address family")
	}
	if family == "ipv4" {
		// Pion's mux host gatherer advertises every mux listen address, even
		// with UDP4-only NetworkTypes. Supply a genuinely IPv4-only mux.
		o.newUDPMux = func() (ice.UDPMux, *net.UDPConn, error) {
			socket, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero})
			if err != nil {
				return nil, nil, err
			}
			return ice.NewUDPMuxDefault(ice.UDPMuxParams{UDPConn: socket}), socket, nil
		}
	} else if family == "ipv6" {
		// Pure IPv6 does not require the IPv4 gateway mapping socket.
		o.PortMapping = false
	}
	o.configure = func(s *webrtc.SettingEngine) {
		if family == "ipv4" {
			s.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
		} else if family == "ipv6" {
			s.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP6})
		}
	}
	o.OnProgress = func(p Progress) { t.Logf("phase=%s elapsed_ms=%d", p.Stage, p.ElapsedMS) }
	started := time.Now()
	c, info, err := Negotiate(ctx, protocol.NewConn(raw), role, nil, o)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.EnableInterleaving()
	_ = c.SetDeadline(time.Now().Add(30 * time.Second))
	t.Logf("path=%s reason=%s setup_ms=%.2f family=%s", info.Mode, info.Reason, float64(time.Since(started))/float64(time.Millisecond), family)
	var pc *webrtc.PeerConnection
	if session, ok := c.Conn.(*sessionConn); ok {
		pc = session.a.pc
		pair, err := session.a.pc.SCTP().Transport().ICETransport().GetSelectedCandidatePair()
		if err != nil || pair == nil {
			t.Fatalf("missing selected pair: %v", err)
		}
		local, remote := net.ParseIP(pair.Local.Address), net.ParseIP(pair.Remote.Address)
		t.Logf("selected_local=%s selected_remote=%s local_ipv6=%t remote_ipv6=%t", pair.Local.Typ, pair.Remote.Typ, local != nil && local.To4() == nil, remote != nil && remote.To4() == nil)
		if family == "ipv4" && (local == nil || remote == nil || local.To4() == nil || remote.To4() == nil) || family == "ipv6" && (local == nil || remote == nil || local.To4() != nil || remote.To4() != nil) {
			t.Fatal("probe bypassed the requested address family")
		}
	}
	if lanes == "1" {
		if info.Mode != "p2p" {
			t.Fatalf("independent UDP lanes were not exercised: path=%s reason=%s", info.Mode, info.Reason)
		}
		probeRealtimePartialFrame(t, c, role)
	}
	// Echo independently generated bytes in both directions. Wall clocks between
	// hosts need not match: latency is a viewer-side round trip.
	for i := range 24 {
		payload := bytes.Repeat([]byte{byte(i), 0x59, 0xab, 0x07}, 16)
		if i == 22 || i == 23 {
			payload = bytes.Repeat(payload, 8192) // 512 KiB, byte-exact bulk transfer.
		}
		if role == "viewer" {
			start := time.Now()
			if err := c.WriteMessage(protocol.Message{Kind: "request", ID: strconv.Itoa(i), Method: "probe", Data: payload}); err != nil {
				t.Fatal(err)
			}
			m, err := c.ReadMessage()
			if err != nil || m.Kind != "response" || m.ID != strconv.Itoa(i) || !bytes.Equal(m.Data, payload) {
				t.Fatalf("corrupt/missing echo %d: %v", i, err)
			}
			t.Logf("echo_bytes=%d rtt_ms=%.2f", len(payload), float64(time.Since(start))/float64(time.Millisecond))
		} else {
			m, err := c.ReadMessage()
			if err != nil || m.Kind != "request" || m.ID != strconv.Itoa(i) || !bytes.Equal(m.Data, payload) {
				t.Fatalf("corrupt/missing request %d: %v", i, err)
			}
			if err := c.WriteMessage(protocol.Message{Kind: "response", ID: m.ID, Data: payload}); err != nil {
				t.Fatal(err)
			}
		}
	}
	if pc != nil {
		stats, _ := json.Marshal(pc.SCTP().Stats())
		t.Logf("sctp_stats=%s", stats)
	}
	if role == "viewer" {
		if err := c.WriteMessage(protocol.Message{Kind: "event", Method: "probe_done"}); err != nil {
			t.Fatal(err)
		}
		m, err := c.ReadMessage()
		if err != nil || m.Kind != "event" || m.Method != "probe_ack" {
			t.Fatalf("agent did not confirm completion: %v", err)
		}
	} else {
		// Do not close the SCTP association while the last response is queued.
		m, err := c.ReadMessage()
		if err != nil || m.Kind != "event" || m.Method != "probe_done" {
			t.Fatalf("viewer did not verify the final response: %v", err)
		}
		if err := c.WriteMessage(protocol.Message{Kind: "event", Method: "probe_ack"}); err != nil {
			t.Fatal(err)
		}
		// The viewer closes only after reading this acknowledgement.
		if _, err := c.ReadMessage(); err == nil {
			t.Fatal("unexpected data after probe completion")
		}
	}
	t.Logf("verified_synthetic_bytes=%d", 22*64+2*(512<<10))
}

// An intentionally incomplete primary frame proves that lane reads do not wait
// for a complete frame. This measures protocol round trips, not audible audio or
// OS input application. The source bytes and echo replies are checked exactly.
func probeRealtimePartialFrame(t *testing.T, c *protocol.Conn, role string) {
	t.Helper()
	if !c.HasLanes() {
		t.Fatal("three independent transports were not committed")
	}
	frame := bytes.Repeat([]byte{0x59, 0x75, 0xab, 0x07}, 1024)
	for _, sender := range []string{"viewer", "agent"} {
		if role == sender {
			header, err := json.Marshal(protocol.Message{Kind: "event", Method: "frame"})
			if err != nil {
				t.Fatal(err)
			}
			prefix := make([]byte, 8)
			binary.BigEndian.PutUint32(prefix, uint32(len(header)))
			binary.BigEndian.PutUint32(prefix[4:], uint32(len(frame)))
			if _, err := c.Conn.Write(append(prefix, header...)); err != nil {
				t.Fatal(err)
			}
		}
		for i := range 12 {
			for _, method := range []string{"input", "audio_opus", "input_release"} {
				id := "lane-" + sender + "-" + method + "-" + strconv.Itoa(i)
				payload := bytes.Repeat([]byte{byte(i), 0x31, 0xa5, 0x07}, 16)
				if role == sender {
					start := time.Now()
					if err := c.WriteMessage(protocol.Message{Kind: "request", ID: id, Method: method, Data: payload}); err != nil {
						t.Fatal(err)
					}
					m, err := c.ReadMessage()
					if err != nil || m.Kind != "response" || m.ID != id || !bytes.Equal(m.Data, payload) {
						t.Fatalf("lane response %s: %v", id, err)
					}
					t.Logf("lane=%s sender=%s partial_frame=true rtt_ms=%.2f", method, sender, float64(time.Since(start))/float64(time.Millisecond))
				} else {
					m, err := c.ReadMessage()
					if err != nil || m.Kind != "request" || m.Method != method || m.ID != id || !bytes.Equal(m.Data, payload) {
						t.Fatalf("lane request %s blocked/corrupt: %v", id, err)
					}
					if err := c.WriteMessage(protocol.Message{Kind: "response", ID: id, Data: payload}); err != nil {
						t.Fatal(err)
					}
				}
			}
		}
		if role == sender {
			if _, err := c.Conn.Write(frame); err != nil {
				t.Fatal(err)
			}
			m, err := c.ReadMessage()
			if err != nil || m.Kind != "event" || m.Method != "probe_frame_ack" {
				t.Fatalf("incomplete frame did not finish: %v", err)
			}
			// Primary-frame acknowledgement and the next phase's input travel
			// on independent lanes. Confirm receipt before reversing roles so
			// a new input request cannot overtake the acknowledgement.
			if err := c.WriteMessage(protocol.Message{Kind: "event", Method: "probe_phase_ready"}); err != nil {
				t.Fatal(err)
			}
		} else {
			m, err := c.ReadMessage()
			if err != nil || m.Method != "frame" || !bytes.Equal(m.Data, frame) {
				t.Fatalf("frame payload changed/lost: %v", err)
			}
			if err := c.WriteMessage(protocol.Message{Kind: "event", Method: "probe_frame_ack"}); err != nil {
				t.Fatal(err)
			}
			m, err = c.ReadMessage()
			if err != nil || m.Kind != "event" || m.Method != "probe_phase_ready" {
				t.Fatalf("phase receipt not confirmed: message=%s error=%v", m.Method, err)
			}
		}
	}
	t.Log("independent_lanes_verified=true partial_frames=2 synthetic_requests=72 exact_payloads=true")
}

func TestP2PProbeRealtimePartialFrame(t *testing.T) {
	a, b := encryptedPair(t)
	o := hostOptions().WithSessionLanes(bytes.Repeat([]byte{7}, 32))
	r := runPair(t, context.Background(), [2]*protocol.Conn{protocol.NewConn(a), protocol.NewConn(b)}, [2]Options{o, o}, [2]func() (protocol.Message, error){})
	for _, result := range r {
		if result.err != nil || result.info.Mode != "p2p" {
			t.Fatalf("P2P setup: %v %s", result.err, result.info.Mode)
		}
		if err := result.c.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
			t.Fatal(err)
		}
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		probeRealtimePartialFrame(t, r[1].c, "agent")
	}()
	probeRealtimePartialFrame(t, r[0].c, "viewer")
	<-done
}
