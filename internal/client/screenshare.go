package client

import (
	"context"
	"image"
	"net/http"
	"strconv"
	"sync"
	"time"

	"welink/internal/remote"
	"welink/internal/yudesk/desktop"
	"welink/internal/yudesk/stream"
)

// Screen sharing in meetings on the desktop uses the app's own capture (the
// same DXGI duplication as remote assistance) instead of the browser's
// getDisplayMedia, so WebView2 shows no "sharing your screen / hide" bar.
//
// The picture reaches the page the way the remote viewer's does: lossless
// 128 px tiles at the screen's own resolution, only the tiles that changed.
// Text and UI arrive pixel-exact; large motion (scrolling, video) goes out
// as high-quality JPEG tiles and is resent losslessly once it is still. The
// page long-polls /local/screen/tiles and paints into the canvas whose
// stream goes to the meeting, so WebRTC encodes the real pixels instead of
// a JPEG of them. Capture runs only while the page asks for pictures.

// openScreenCapture is replaced in tests, which must not capture the real screen.
var openScreenCapture = desktop.OpenCapture

var (
	screenIdleStop = 5 * time.Second
	screenWait     = time.Second
)

const (
	screenFrameInterval = time.Second / 30
	screenMotionTiles   = 24
	screenMotionQuality = 92 // local only: no network to save
	screenRefineDelay   = 120 * time.Millisecond
	screenRefineTiles   = 48
)

type screenFeed struct {
	mu      sync.Mutex
	running bool
	lastUse time.Time
	hub     *remote.TileHub
}

func (f *screenFeed) tiles() *remote.TileHub {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lastUse = time.Now()
	if f.hub == nil {
		f.hub = remote.NewTileHub()
	}
	if !f.running {
		f.running = true
		go f.run(f.hub)
	}
	return f.hub
}

func (f *screenFeed) idle() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if time.Since(f.lastUse) > screenIdleStop {
		f.running = false
		f.hub = nil // the next share starts from a fresh picture
		return true
	}
	return false
}

func (f *screenFeed) run(hub *remote.TileHub) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	capture, closeCapture := openScreenCapture(ctx)
	defer closeCapture()
	encoder := &stream.TileEncoder{GridSize: 128, Lossless: true, Motion: screenMotionTiles, MotionQuality: screenMotionQuality, RefineDelay: screenRefineDelay}
	force := true
	var previous, spare *image.RGBA
	var last time.Time
	for !f.idle() {
		if pause := screenFrameInterval - time.Since(last); pause > 0 {
			time.Sleep(pause)
		}
		now := time.Now()
		wait := 500 * time.Millisecond
		if due, pending := encoder.RefineDue(now); pending {
			if due <= 0 {
				if fr, data, err := encoder.Refine(now, screenRefineTiles); err == nil && len(fr.Tiles) > 0 {
					_ = hub.Publish(fr, data)
					continue
				}
			}
			wait = min(wait, max(due, 10*time.Millisecond))
		}
		shot, err := capture(desktop.CaptureOptions{Quality: screenMotionQuality, Raw: true, Buffer: spare, WaitChange: wait})
		if err != nil {
			time.Sleep(300 * time.Millisecond)
			continue
		}
		if shot.Unchanged {
			continue
		}
		last = now
		if shot.Pixels == nil {
			// A backend that only returns JPEG: show it whole.
			if len(shot.JPEG) > 0 && hub.PublishImage(shot.JPEG, shot.Width, shot.Height) == nil {
				force = true
			}
			continue
		}
		fr, data, err := encoder.Encode(shot.Pixels, screenMotionQuality, force)
		if err != nil {
			continue
		}
		previous, spare = shot.Pixels, previous // the encoder now references the new pixels
		if len(fr.Tiles) == 0 {
			continue
		}
		fr.SourceWidth, fr.SourceHeight = shot.SourceWidth, shot.SourceHeight
		if hub.Publish(fr, data) == nil {
			force = false
		} else {
			force = true
		}
	}
}

// serveScreenTiles answers with the tiles changed since ?after=N in the
// remote viewer's binary format, or 204 when the screen did not change.
func (c *Client) serveScreenTiles(w http.ResponseWriter, r *http.Request) {
	after, _ := strconv.ParseUint(r.URL.Query().Get("after"), 10, 64)
	body := c.screen.tiles().Wait(r.Context(), after, screenWait)
	w.Header().Set("Cache-Control", "no-store")
	if body == nil {
		w.WriteHeader(204)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	_, _ = w.Write(body)
}
