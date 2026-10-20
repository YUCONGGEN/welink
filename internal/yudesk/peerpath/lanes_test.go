package peerpath

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"net"
	"testing"
	"time"

	"welink/internal/yudesk/protocol"
)

func assertRealtimePassesPartial(t *testing.T, left, right *protocol.Conn) {
	t.Helper()
	if !left.HasLanes() || !right.HasLanes() {
		t.Fatal("independent transports were not enabled")
	}
	header, _ := json.Marshal(protocol.Message{Kind: "event", Method: "frame"})
	prefix := make([]byte, 8)
	binary.BigEndian.PutUint32(prefix, uint32(len(header)))
	binary.BigEndian.PutUint32(prefix[4:], 4096)
	if _, err := left.Conn.Write(append(prefix, header...)); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{"input", "audio_opus", "input_release"} {
		if err := left.WriteMessage(protocol.Message{Kind: "event", Method: method, Data: []byte{1, 2}}); err != nil {
			t.Fatal(err)
		}
		done := make(chan error, 1)
		go func() {
			m, err := right.ReadMessage()
			if err == nil && m.Method != method {
				err = net.ErrClosed
			}
			done <- err
		}()
		select {
		case err := <-done:
			if err != nil {
				t.Fatal(method, err)
			}
		case <-time.After(time.Second):
			t.Fatal(method, "was blocked by incomplete frame")
		}
	}
	done := make(chan error, 1)
	go func() { _, err := left.Conn.Write(bytes.Repeat([]byte{91}, 4096)); done <- err }()
	m, err := right.ReadMessage()
	if err != nil || m.Method != "frame" || len(m.Data) != 4096 {
		t.Fatal("frame not retained", err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestIndependentP2PLanes(t *testing.T) {
	a, b := encryptedPair(t)
	seed := bytes.Repeat([]byte{7}, 32)
	o := hostOptions().WithSessionLanes(seed)
	r := runPair(t, context.Background(), [2]*protocol.Conn{protocol.NewConn(a), protocol.NewConn(b)}, [2]Options{o, o}, [2]func() (protocol.Message, error){})
	for _, result := range r {
		if result.err != nil || result.info.Mode != "p2p" {
			t.Fatalf("P2P setup: %v %s", result.err, result.info.Mode)
		}
	}
	assertRealtimePassesPartial(t, r[0].c, r[1].c)
}

func TestRelayLaneBindingAndLegacyFallback(t *testing.T) {
	for _, mismatch := range []bool{false, true} {
		t.Run(map[bool]string{false: "bound", true: "wrong_session_secret"}[mismatch], func(t *testing.T) {
			a, b := encryptedPair(t)
			bases := [2]*protocol.Conn{protocol.NewConn(a), protocol.NewConn(b)}
			var options [2]Options
			raw := [2][2]net.Conn{}
			for i := 0; i < 2; i++ {
				raw[0][i], raw[1][i] = net.Pipe()
				defer raw[0][i].Close()
				defer raw[1][i].Close()
			}
			for side := range options {
				seed := bytes.Repeat([]byte{7}, 32)
				if mismatch && side == 1 {
					seed[0]++
				}
				options[side] = Options{}.WithSessionLanes(seed)
				options[side].RelayLane = func(_ context.Context, name string) (net.Conn, error) {
					index := 0
					if name == "audio" {
						index = 1
					}
					return raw[side][index], nil
				}
			}
			done := make(chan error, 2)
			for side, role := range []string{"viewer", "agent"} {
				go func() {
					done <- EnableRelayLanes(context.Background(), bases[side], role, bases[side].ReadMessage, options[side])
				}()
			}
			for i := 0; i < 2; i++ {
				if err := await(t, done); err != nil {
					t.Fatal(err)
				}
			}
			defer bases[0].Close()
			defer bases[1].Close()
			if mismatch {
				if bases[0].HasLanes() || bases[1].HasLanes() {
					t.Fatal("unbound lane accepted")
				}
				roundTrip(t, bases[0], bases[1], 4096)
			} else {
				assertRealtimePassesPartial(t, bases[0], bases[1])
			}
		})
	}
}
