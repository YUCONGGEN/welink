package remote

import (
	"context"
	"strconv"
	"sync"
	"time"
)

// flightWindow bounds the picture updates that are sent but not yet
// acknowledged by the viewer. Without it a large update over a slow relay
// waits in socket buffers and every later update arrives late by the whole
// queue, which is the lag felt as "the remote side reacts slowly". With it
// the host grabs the screen only when the link can carry the update now, so
// what the viewer receives is the current desktop, not a backlog.
//
// Small updates (typing, a caret, a hover) may pipeline a few deep to hide
// the round trip; a large one waits until the link has drained.
type flightWindow struct {
	mu      sync.Mutex
	next    uint64
	sizes   map[string]int
	oldest  map[string]time.Time
	bytes   int
	changed chan struct{}
}

const (
	flightFrames = 3
	flightBytes  = 256 << 10
	// An update unacknowledged this long no longer holds the window, so a
	// lost acknowledgement can only slow the picture down, never stop it.
	flightStale = 2 * time.Second
)

func newFlightWindow() *flightWindow {
	return &flightWindow{sizes: map[string]int{}, oldest: map[string]time.Time{}, changed: make(chan struct{})}
}

// add records an update of size bytes and returns the ID the viewer echoes.
// A nil window (peer without acknowledgements) returns "".
func (w *flightWindow) add(size int) string {
	if w == nil {
		return ""
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.next++
	id := strconv.FormatUint(w.next, 10)
	w.sizes[id] = size
	w.oldest[id] = time.Now()
	w.bytes += size
	return id
}

func (w *flightWindow) ack(id string) {
	if w == nil {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	size, ok := w.sizes[id]
	if !ok {
		return
	}
	delete(w.sizes, id)
	delete(w.oldest, id)
	w.bytes -= size
	close(w.changed)
	w.changed = make(chan struct{})
}

// expireLocked forgets updates that were never acknowledged in time and
// reports how long until the next one would expire.
func (w *flightWindow) expireLocked(now time.Time) time.Duration {
	next := flightStale
	for id, at := range w.oldest {
		if left := at.Add(flightStale).Sub(now); left <= 0 {
			w.bytes -= w.sizes[id]
			delete(w.sizes, id)
			delete(w.oldest, id)
		} else {
			next = min(next, left)
		}
	}
	return next
}

func (w *flightWindow) openLocked() bool {
	return len(w.sizes) == 0 || (len(w.sizes) < flightFrames && w.bytes < flightBytes)
}

// idle reports whether nothing is in flight.
func (w *flightWindow) idle() bool {
	if w == nil {
		return true
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.expireLocked(time.Now())
	return len(w.sizes) == 0
}

// wait blocks until another update may be sent, and is false once ctx ends.
func (w *flightWindow) wait(ctx context.Context) bool {
	if w == nil {
		return ctx.Err() == nil
	}
	for {
		w.mu.Lock()
		expiry := w.expireLocked(time.Now())
		if w.openLocked() {
			w.mu.Unlock()
			return ctx.Err() == nil
		}
		changed := w.changed
		w.mu.Unlock()
		t := time.NewTimer(expiry)
		select {
		case <-ctx.Done():
			t.Stop()
			return false
		case <-changed:
		case <-t.C:
		}
		t.Stop()
	}
}
