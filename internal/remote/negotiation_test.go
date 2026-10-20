package remote

import (
	"context"
	"net"
	"sync"
	"testing"
	"time"
	"welink/internal/yudesk/peerpath"
	"welink/internal/yudesk/protocol"
)

func TestNegotiatedTransportAndInput(t *testing.T) {
	for _, fallback := range []bool{false, true} {
		name := "direct"
		if fallback {
			name = "relay"
		}
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			left, right := net.Pipe()
			defer left.Close()
			defer right.Close()
			raw := []net.Conn{left, right}
			var pc [2]*protocol.Conn
			var info [2]peerpath.Info
			var errs [2]error
			options := peerpath.Options{STUNURLs: []string{}, Timeout: 2 * time.Second}
			// A transport initialization failure must keep the authenticated relay.
			if fallback {
				options.STUNURLs = []string{"invalid:stun"}
			}
			var wg sync.WaitGroup
			for i := 0; i < 2; i++ {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					role := "agent"
					if i == 1 {
						role = "viewer"
					}
					pc[i], info[i], errs[i] = negotiateTransport(ctx, protocol.NewConn(raw[i]), role, options)
				}(i)
			}
			wg.Wait()
			for i := range pc {
				if errs[i] != nil {
					t.Fatal(errs[i])
				}
				defer pc[i].Close()
				pc[i].EnableInterleaving()
				if info[i].Mode != map[bool]string{false: "p2p", true: "relay"}[fallback] {
					t.Fatalf("unexpected route: %+v", info[i])
				}
				if !fallback && !pc[i].HasLanes() {
					t.Fatal("P2P input lane missing")
				}
			}
			sent := make(chan error, 1)
			go func() {
				sent <- pc[0].WriteMessage(protocol.Message{Kind: "event", Method: "input", Params: []byte(`[{"type":"key_up","key":"A"}]`)})
			}()
			m, err := pc[1].ReadMessage()
			if err != nil {
				t.Fatal(err)
			}
			if m.Method != "input" {
				t.Fatalf("lost keyboard input: %+v", m)
			}
			if err = <-sent; err != nil {
				t.Fatal(err)
			}
		})
	}
}
