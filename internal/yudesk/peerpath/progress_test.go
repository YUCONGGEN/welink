package peerpath

import (
	"context"
	"sync"
	"testing"
	"time"

	"welink/internal/yudesk/protocol"
)

func TestFifteenSecondProbeFallbackAndProgress(t *testing.T) {
	a, b := encryptedPair(t)
	bases := [2]*protocol.Conn{protocol.NewConn(a), protocol.NewConn(b)}
	ctx, cancel := context.WithTimeout(context.Background(), 19*time.Second)
	defer cancel()
	var mu sync.Mutex
	var events []Progress
	results := make(chan outcome, 2)
	started := time.Now()
	for i, role := range []string{"viewer", "agent"} {
		go func() {
			o := trickleOptions()
			o.Timeout = 30 * time.Second // Must be capped at 15 seconds.
			o.OnProgress = func(event Progress) { mu.Lock(); events = append(events, event); mu.Unlock() }
			read := func() (protocol.Message, error) {
				for {
					m, err := bases[i].ReadMessage()
					if err != nil || m.Method != "candidate" {
						return m, err
					}
				}
			}
			c, info, err := Negotiate(ctx, bases[i], role, read, o)
			results <- outcome{c, info, err}
		}()
	}
	var pair [2]*protocol.Conn
	for i := range pair {
		select {
		case result := <-results:
			if result.err != nil || result.info != (Info{Mode: "relay", Reason: "ice_timeout"}) {
				t.Fatalf("15-second fallback: %+v", result)
			}
			pair[i] = result.c
		case <-ctx.Done():
			t.Fatal("failed to finish bounded probe")
		}
	}
	elapsed := time.Since(started)
	if elapsed < 14900*time.Millisecond || elapsed > 17*time.Second {
		t.Fatalf("unexpected probe duration: %s", elapsed)
	}
	mu.Lock()
	defer mu.Unlock()
	starts, relays := 0, 0
	for _, event := range events {
		if event.TimeoutMS != 15000 {
			t.Fatal("progress reports a different ICE deadline")
		}
		if event.Stage == "started" {
			starts++
		}
		if event.Stage == "relay" {
			relays++
		}
	}
	if starts != 2 || relays != 2 {
		t.Fatalf("missing actual start/fallback progress: %d/%d", starts, relays)
	}
	t.Logf("both peers committed reusable relay after %s", elapsed.Round(time.Millisecond))
	roundTrip(t, pair[0], pair[1], 32003)
}

func TestProbeBudgetLegacyAndRelayWait(t *testing.T) {
	if DefaultOptions().WithProbe15(false).Timeout != 4500*time.Millisecond || DefaultOptions().WithProbe15(true).Timeout != 15*time.Second {
		t.Fatal("15-second probing was not mutually negotiated")
	}
	if relayAcceptanceWait(15*time.Second) != 14*time.Second || relayAcceptanceWait(600*time.Millisecond) != 0 {
		t.Fatal("relay nomination does not fit the attempt budget")
	}
}
