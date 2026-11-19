package client

import (
	"context"
	"net/http"
	"strconv"
	"sync"
	"time"

	"welink/internal/yudesk/desktop"
)

// Screen sharing in meetings on the desktop uses the app's own capture (the
// same DXGI duplication as remote assistance) instead of the browser's
// getDisplayMedia, so WebView2 shows no "sharing your screen / hide" bar.
// The page long-polls /local/screen/frame for JPEG frames and paints them
// into a canvas whose stream goes to the meeting. Capture runs only while
// frames are being requested.

// openScreenCapture is replaced in tests, which must not capture the real screen.
var openScreenCapture = desktop.OpenCapture

var (
	screenIdleStop = 5 * time.Second
	screenWait     = time.Second
)

type screenFeed struct {
	mu      sync.Mutex
	running bool
	seq     uint64
	jpeg    []byte
	lastUse time.Time
	changed chan struct{}
}

func (f *screenFeed) start() {
	f.mu.Lock()
	f.lastUse = time.Now()
	if f.changed == nil {
		f.changed = make(chan struct{})
	}
	if f.running {
		f.mu.Unlock()
		return
	}
	f.running = true
	f.mu.Unlock()
	go f.run()
}

func (f *screenFeed) run() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	capture, closeCapture := openScreenCapture(ctx)
	defer closeCapture()
	for {
		f.mu.Lock()
		idle := time.Since(f.lastUse) > screenIdleStop
		if idle {
			f.running = false
			f.jpeg = nil
		}
		f.mu.Unlock()
		if idle {
			return
		}
		shot, err := capture(desktop.CaptureOptions{Quality: 82, MaxWidth: 1920, WaitChange: 500 * time.Millisecond})
		if err != nil {
			time.Sleep(300 * time.Millisecond)
			continue
		}
		if shot.Unchanged || len(shot.JPEG) == 0 {
			if !shot.EventDriven {
				time.Sleep(66 * time.Millisecond)
			}
			continue
		}
		f.mu.Lock()
		f.seq++
		f.jpeg = shot.JPEG
		close(f.changed)
		f.changed = make(chan struct{})
		f.mu.Unlock()
		if !shot.EventDriven {
			// Polling backends: about 15 frames a second.
			time.Sleep(66 * time.Millisecond)
		}
	}
}

// frame waits for a frame newer than after; nil when none came in time.
func (f *screenFeed) frame(ctx context.Context, after uint64) ([]byte, uint64) {
	f.start()
	deadline := time.NewTimer(screenWait)
	defer deadline.Stop()
	for {
		f.mu.Lock()
		seq, data, changed := f.seq, f.jpeg, f.changed
		f.lastUse = time.Now()
		f.mu.Unlock()
		if seq > after && data != nil {
			return data, seq
		}
		select {
		case <-changed:
		case <-deadline.C:
			return nil, seq
		case <-ctx.Done():
			return nil, seq
		}
	}
}

func (c *Client) serveScreenFrame(w http.ResponseWriter, r *http.Request) {
	after, _ := strconv.ParseUint(r.URL.Query().Get("after"), 10, 64)
	data, seq := c.screen.frame(r.Context(), after)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Frame", strconv.FormatUint(seq, 10))
	if data == nil {
		w.WriteHeader(204)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	_, _ = w.Write(data)
}
