package peerpath

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pion/logging"
	"github.com/pion/stun/v4"
	"github.com/pion/transport/v4/vnet"
	"github.com/pion/webrtc/v4"
	"welink/internal/yudesk/protocol"
)

// Drop only the owned virtual UDP network. The encrypted authorization tether
// remains live, just as when a NAT/Wi-Fi interruption loses the direct path but
// TCP to the relay survives. No physical interface or real endpoint is used.
func outagePair(t *testing.T, ctx context.Context) ([2]*sessionConn, [2]*protocol.Conn, *atomic.Bool, *atomic.Uint64, *atomic.Uint32) {
	t.Helper()
	wan, err := vnet.NewRouter(&vnet.RouterConfig{CIDR: "192.0.2.0/24", LoggerFactory: logging.NewDefaultLoggerFactory()})
	if err != nil {
		t.Fatal(err)
	}
	var drop atomic.Bool
	var dropped atomic.Uint64
	wan.AddChunkFilter(func(chunk vnet.Chunk) bool {
		if drop.Load() {
			// Distinguish an actual dropped application/DTLS packet from
			// the STUN keepalives which triggered Disconnected.
			if !stun.IsMessage(chunk.UserData()) {
				dropped.Add(1)
			}
			return false
		}
		return true
	})
	var options [2]Options
	for i, address := range []string{"192.0.2.10", "192.0.2.20"} {
		network, err := vnet.NewNet(&vnet.NetConfig{StaticIPs: []string{address}})
		if err != nil {
			t.Fatal(err)
		}
		if err = wan.AddNet(network); err != nil {
			t.Fatal(err)
		}
		options[i] = Options{STUNURLs: []string{}, Timeout: 2 * time.Second, configure: func(s *webrtc.SettingEngine) {
			s.SetNet(network)
			s.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
			// Compress the real ICE disconnect/failed/keepalive clocks rather
			// than injecting a state callback. State transitions, DTLS, SCTP
			// retransmission and cleanup still execute the production code.
			s.SetICETimeouts(120*time.Millisecond, 1200*time.Millisecond, 40*time.Millisecond)
		}}
	}
	if err = wan.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = wan.Stop() })
	a, b := encryptedPair(t)
	bases := [2]*protocol.Conn{protocol.NewConn(a), protocol.NewConn(b)}
	var descriptions atomic.Uint32
	var readers [2]func() (protocol.Message, error)
	for i := range readers {
		readers[i] = func() (protocol.Message, error) {
			m, err := bases[i].ReadMessage()
			if m.Method == "offer" || m.Method == "answer" {
				descriptions.Add(1)
			}
			return m, err
		}
	}
	results := runPair(t, ctx, bases, options, readers)
	var sessions [2]*sessionConn
	for i, result := range results {
		if result.err != nil || result.info.Mode != "p2p" {
			t.Fatalf("virtual direct negotiation: %+v", result)
		}
		sessions[i] = result.c.Conn.(*sessionConn)
	}
	if descriptions.Load() != 2 {
		t.Fatal("fixture did not exchange a single offer/answer")
	}
	return sessions, bases, &drop, &dropped, &descriptions
}

func awaitPathState(t *testing.T, sessions [2]*sessionConn, state webrtc.PeerConnectionState) {
	t.Helper()
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		if sessions[0].a.pc.ConnectionState() == state && sessions[1].a.pc.ConnectionState() == state {
			return
		}
		select {
		case <-timer.C:
			t.Fatalf("wanted %s, got %s / %s", state, sessions[0].a.pc.ConnectionState(), sessions[1].a.pc.ConnectionState())
		case <-ticker.C:
		}
	}
}

func assertOutageStillRecoverable(t *testing.T, sessions [2]*sessionConn) {
	t.Helper()
	for i, session := range sessions {
		select {
		case <-session.a.failed:
			t.Fatalf("endpoint %d made a temporary ICE disconnect permanent", i)
		default:
		}
		select {
		case <-session.done:
			t.Fatalf("endpoint %d tore down its authenticated session: %v", i, session.err)
		default:
		}
	}
}

func TestDirectPathRecoversFromRepeatedUDPOutagesWithoutNewSession(t *testing.T) {
	sessions, _, drop, dropped, descriptions := outagePair(t, context.Background())
	pcs := [2]*protocol.Conn{protocol.NewConn(sessions[0]), protocol.NewConn(sessions[1])}
	for round := range 2 {
		drop.Store(true)
		awaitPathState(t, sessions, webrtc.PeerConnectionStateDisconnected)
		assertOutageStillRecoverable(t, sessions)
		// An application deadline remains authoritative during recovery. It
		// returns a timeout without turning that recoverable stream terminal.
		_ = sessions[1].SetReadDeadline(time.Now().Add(30 * time.Millisecond))
		if _, err := sessions[1].Read(make([]byte, 1)); !errors.Is(err, os.ErrDeadlineExceeded) {
			t.Fatalf("outage read deadline: %v", err)
		}
		_ = sessions[1].SetReadDeadline(time.Time{})
		assertOutageStillRecoverable(t, sessions)

		// Queue distinct ordered records before restoring UDP. The read must
		// resume on this SCTP stream, with no lost/duplicated/reordered bytes.
		before := dropped.Load()
		writeDone := make(chan error, 1)
		go func() {
			for n := range 3 {
				data := bytes.Repeat([]byte{byte(round), byte(n), 17, 255}, 4300)
				if err := pcs[0].WriteMessage(protocol.Message{Kind: "request", Method: "owned-fixture", ID: fmt.Sprint(n), Data: data}); err != nil {
					writeDone <- err
					return
				}
			}
			writeDone <- nil
		}()
		// Do not restore the network before the scheduled writer actually
		// sends: otherwise a passing test might never lose application data.
		lossDeadline := time.NewTimer(300 * time.Millisecond)
		lossTick := time.NewTicker(time.Millisecond)
		for dropped.Load() == before {
			select {
			case <-lossDeadline.C:
				lossTick.Stop()
				t.Fatal("virtual outage did not drop application data")
			case <-lossTick.C:
			}
		}
		lossDeadline.Stop()
		lossTick.Stop()
		drop.Store(false)
		awaitPathState(t, sessions, webrtc.PeerConnectionStateConnected)
		_ = pcs[1].SetReadDeadline(time.Now().Add(3 * time.Second))
		for n := range 3 {
			m, err := pcs[1].ReadMessage()
			want := bytes.Repeat([]byte{byte(round), byte(n), 17, 255}, 4300)
			if err != nil || m.ID != fmt.Sprint(n) || !bytes.Equal(m.Data, want) {
				t.Fatalf("record %d after outage %d: id=%q len=%d err=%v", n, round, m.ID, len(m.Data), err)
			}
		}
		_ = pcs[1].SetReadDeadline(time.Time{})
		if err := await(t, writeDone); err != nil {
			t.Fatal(err)
		}
		roundTrip(t, pcs[1], pcs[0], 90003)
	}
	if descriptions.Load() != 2 {
		t.Fatal("temporary outage replaced the already-authorized session")
	}
}

func TestPermanentUDPOutageEndsAfterBoundedICERecovery(t *testing.T) {
	sessions, _, drop, _, _ := outagePair(t, context.Background())
	drop.Store(true)
	awaitPathState(t, sessions, webrtc.PeerConnectionStateDisconnected)
	assertOutageStillRecoverable(t, sessions)
	started := time.Now()
	for _, session := range sessions {
		await(t, session.closed)
		if _, err := session.Write([]byte("must not replay")); !errors.Is(err, ErrDirectLost) && !errors.Is(err, ErrRelayLost) {
			t.Fatalf("permanent outage remained usable: %v", err)
		}
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("configured recovery window was not bounded: %s", elapsed)
	}
}

func TestOutageDoesNotDelayRevocationCancellationOrClose(t *testing.T) {
	for _, event := range []string{"tether-close", "context-cancel", "concurrent-close"} {
		t.Run(event, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			sessions, bases, drop, _, _ := outagePair(t, ctx)
			drop.Store(true)
			awaitPathState(t, sessions, webrtc.PeerConnectionStateDisconnected)
			assertOutageStillRecoverable(t, sessions)
			started := time.Now()
			switch event {
			case "tether-close":
				_ = bases[0].Close()
			case "context-cancel":
				cancel()
			case "concurrent-close":
				var wg sync.WaitGroup
				for range 12 {
					wg.Add(1)
					go func() { defer wg.Done(); _ = sessions[0].Close() }()
				}
				closed := make(chan struct{})
				go func() { wg.Wait(); close(closed) }()
				await(t, closed)
			}
			for _, session := range sessions {
				await(t, session.closed)
				if n, err := session.Write([]byte{1}); n != 0 || err == nil {
					t.Fatalf("ended session accepted bytes: n=%d err=%v", n, err)
				}
			}
			if elapsed := time.Since(started); elapsed > time.Second {
				t.Fatalf("%s waited for the ICE recovery window: %s", event, elapsed)
			}
		})
	}
}
