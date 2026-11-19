package client

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"welink/internal/yudesk/desktop"
)

// The feed hands out new frames to waiting viewers, answers "nothing new"
// after the wait, and stops capturing once nobody asks for frames.
func TestScreenFeed(t *testing.T) {
	var captures, closed atomic.Int32
	saved, savedIdle, savedWait := openScreenCapture, screenIdleStop, screenWait
	defer func() { openScreenCapture, screenIdleStop, screenWait = saved, savedIdle, savedWait }()
	screenIdleStop, screenWait = 300*time.Millisecond, 200*time.Millisecond
	openScreenCapture = func(context.Context) (func(desktop.CaptureOptions) (desktop.Screenshot, error), func()) {
		return func(o desktop.CaptureOptions) (desktop.Screenshot, error) {
			n := captures.Add(1)
			time.Sleep(20 * time.Millisecond)
			if n > 3 {
				return desktop.Screenshot{EventDriven: true, Unchanged: true}, nil
			}
			return desktop.Screenshot{EventDriven: true, JPEG: []byte{0xff, 0xd8, byte(n)}}, nil
		}, func() { closed.Add(1) }
	}
	var f screenFeed
	data, seq := f.frame(context.Background(), 0)
	if data == nil || seq == 0 {
		t.Fatal("no first frame")
	}
	next, seq2 := f.frame(context.Background(), seq)
	if next == nil || seq2 <= seq {
		t.Fatalf("no newer frame: %v %d", next, seq2)
	}
	// The screen stops changing: the wait ends with nothing new.
	for i := 0; i < 5; i++ {
		if d, s := f.frame(context.Background(), seq2); d == nil {
			break
		} else {
			seq2 = s
		}
	}
	if d, _ := f.frame(context.Background(), seq2); d != nil {
		t.Fatal("frame without a change")
	}
	time.Sleep(700 * time.Millisecond)
	if closed.Load() != 1 {
		t.Fatal("capture kept running with nobody watching")
	}
}
