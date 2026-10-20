package peerpath

import (
	"context"
	"testing"
	"time"
	"welink/internal/yudesk/protocol"
)

// Force the backpressure case: neither application consumes incoming messages
// until BOTH synchronous candidate writers have finished. The authenticated
// underlying net.Pipe has no TCP send-buffer slack to hide a deadlock.
func TestTrickleBidirectionalFullBurstCannotBlockWriters(t *testing.T) {
	a, b := encryptedPair(t)
	bases := [2]*protocol.Conn{protocol.NewConn(a), protocol.NewConn(b)}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var inbox [2]chan trickleFrame
	var done [2]chan struct{}
	var signals [2]signaling
	for i := range bases {
		inbox[i], done[i] = newTrickleInbox(), make(chan struct{})
		signals[i] = signaling{base: bases[i], read: bases[i].ReadMessage, ctx: ctx, deadline: time.Now().Add(2 * time.Second)}
		go signals[i].trickleReader(ctx, inbox[i], done[i])
	}
	written := make(chan error, 2)
	for i := range signals {
		go func(i int) {
			s := signals[i]
			methods := []string{"offer"}
			for c := 0; c < maxCandidates; c++ {
				methods = append(methods, "candidate")
			}
			methods = append(methods, "end-of-candidates", "ready", "commit", "retire")
			for _, method := range methods {
				if err := s.sendTrickle(method, struct{}{}); err != nil {
					written <- err
					return
				}
			}
			written <- nil
		}(i)
	}
	for range signals {
		if err := <-written; err != nil {
			t.Fatal("simultaneous candidate flush blocked:", err)
		}
	}
	for i := range inbox {
		<-done[i]
		if len(inbox[i]) != maxCandidates+5 {
			t.Fatal("candidate batch lost or reader failed to retire")
		}
		for range maxCandidates + 5 {
			if frame := <-inbox[i]; frame.err != nil {
				t.Fatal(frame.err)
			}
		}
	}
}
