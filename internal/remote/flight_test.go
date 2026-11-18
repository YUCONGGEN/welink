package remote

import (
	"context"
	"testing"
	"time"
)

func TestFlightWindowBoundsUpdatesInFlight(t *testing.T) {
	w := newFlightWindow()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	// Small updates pipeline up to flightFrames deep.
	ids := []string{}
	for range flightFrames {
		if !w.wait(ctx) {
			t.Fatal("window closed early")
		}
		ids = append(ids, w.add(1000))
	}
	if w.openLocked() {
		t.Fatal("window open beyond flightFrames")
	}
	done := make(chan bool)
	go func() { done <- w.wait(ctx) }()
	select {
	case <-done:
		t.Fatal("wait returned while full")
	case <-time.After(30 * time.Millisecond):
	}
	w.ack(ids[0])
	if !<-done {
		t.Fatal("ack did not open the window")
	}
	for _, id := range ids[1:] {
		w.ack(id)
	}
	if !w.idle() {
		t.Fatal("not idle after every ack")
	}
	// One large update holds the window until acknowledged.
	big := w.add(flightBytes)
	if w.openLocked() {
		t.Fatal("large update must be alone in flight")
	}
	w.ack(big)
	w.ack(big) // a duplicate ack is harmless
	if !w.idle() || w.bytes != 0 {
		t.Fatalf("bytes %d after acks", w.bytes)
	}
	// A nil window (peer without acks) never blocks.
	var none *flightWindow
	if none.add(5) != "" || !none.wait(ctx) || !none.idle() {
		t.Fatal("nil window")
	}
}

func TestFlightWindowForgetsLostAcks(t *testing.T) {
	w := newFlightWindow()
	w.add(flightBytes)
	w.oldest["1"] = time.Now().Add(-flightStale - time.Millisecond)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if !w.wait(ctx) || !w.idle() {
		t.Fatal("stale update still holds the window")
	}
}
