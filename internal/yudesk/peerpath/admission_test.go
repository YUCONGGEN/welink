package peerpath

import (
	"context"
	"errors"
	"net"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestBulkAdmissionWaitHonorsCancellationDeadlineAndClose(t *testing.T) {
	for _, mode := range []string{"cancel", "deadline", "close"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var pending atomic.Uint64
			pending.Store(64 << 10)
			entered, done := make(chan struct{}), make(chan struct{})
			var once sync.Once
			p := &bulkAdmission{written: func() uint64 { return 128 << 10 }, sample: func() (uint64, float64) {
				once.Do(func() { close(entered) })
				return pending.Load(), 0
			}, deadline: &connDeadline{}, done: done, limit: 1024, started: time.Now()}
			result := make(chan error, 1)
			go func() { result <- p.WaitBulk(ctx, 512) }()
			select {
			case <-entered:
			case <-time.After(time.Second):
				t.Fatal("bulk waiter did not sample the congested queue")
			}
			want := context.Canceled
			switch mode {
			case "cancel":
				cancel()
			case "deadline":
				want = os.ErrDeadlineExceeded
				p.deadline.set(time.Now().Add(-time.Millisecond))
			case "close":
				want = net.ErrClosed
				close(done)
			}
			select {
			case err := <-result:
				if !errors.Is(err, want) {
					t.Fatalf("got %v, want %v", err, want)
				}
			case <-time.After(time.Second):
				t.Fatal("bulk waiter did not leave promptly")
			}
			if mode == "deadline" {
				p.deadline.set(time.Time{})
				pending.Store(0)
				if err := p.WaitBulk(ctx, 512); err != nil {
					t.Fatal("clearing a deadline did not recover admission:", err)
				}
			}
		})
	}
}

func TestBulkProbeIgnoresShortWritesAndProtectsFreshRTT(t *testing.T) {
	var written atomic.Uint64
	p := &bulkAdmission{written: written.Load, sample: func() (uint64, float64) { return 0, .04 }, deadline: &connDeadline{}, done: make(chan struct{}), limit: 64 << 10, started: time.Now(), draining: true}
	if err := p.WaitBulk(context.Background(), 512); err != nil {
		t.Fatal(err)
	}
	short := []byte{0, 0, 0, 5, 0, 0, 0, 0}
	p.recordWrite(short, len(short), nil, time.Now())
	if !p.probeNext || p.probeEnd != 0 {
		t.Fatal("short audio/control packet consumed the bulk probe")
	}
	bulk := []byte{0x80, 0, 0, 5, 0, 0, 0, 0}
	written.Store(512)
	p.recordWrite(bulk, len(bulk), nil, time.Now().Add(-100*time.Millisecond))
	if err := p.WaitBulk(context.Background(), 512); err != nil {
		t.Fatal(err)
	}
	fresh := p.baseRTT
	if fresh < .1 || p.draining || p.probeEnd != 0 {
		t.Fatal("clean-flight probe did not complete")
	}
	if err := p.WaitBulk(context.Background(), 512); err != nil || p.baseRTT != fresh {
		t.Fatal("stale SCTP estimator replaced the newly probed RTT")
	}
}

func TestBulkAdmissionBacksOffExcessQueueWithoutShrinkingFlightWindow(t *testing.T) {
	// A 200 kB/s path with 40 ms RTT needs 8 kB in flight. Another 10 kB
	// already queued would cost sound at least 50 ms at the same bottleneck.
	// Wait for delivery rather than admitting another picture fragment.
	var pending atomic.Uint64
	pending.Store(18_000)
	entered := make(chan struct{})
	var once sync.Once
	p := &bulkAdmission{
		written: func() uint64 { return 128 << 10 },
		sample: func() (uint64, float64) {
			once.Do(func() { close(entered) })
			return pending.Load(), .04
		},
		deadline: &connDeadline{}, done: make(chan struct{}),
		started: time.Now(), rate: 200_000, baseRTT: .04, limit: 64 << 10,
	}
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() { result <- p.WaitBulk(ctx, 1024) }()
	select {
	case <-entered:
	case <-time.After(time.Second):
		cancel()
		t.Fatal("bulk waiter did not inspect the delivery queue")
	}
	select {
	case err := <-result:
		cancel()
		t.Fatalf("admitted more bulk over the flight and queue budget: %v", err)
	case <-time.After(15 * time.Millisecond):
	}
	// ACK progress must release the same waiter, preserving at least the
	// bandwidth-delay product instead of starving the picture connection.
	pending.Store(8000)
	select {
	case err := <-result:
		cancel()
		if err != nil {
			t.Fatal("delivery did not release bulk admission:", err)
		}
	case <-time.After(time.Second):
		cancel()
		t.Fatal("bulk admission did not recover after delivery")
	}
}
