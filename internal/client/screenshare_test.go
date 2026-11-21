package client

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/color"
	"sync/atomic"
	"testing"
	"time"

	"welink/internal/yudesk/desktop"
	"welink/internal/yudesk/stream"
)

func screenBody(t *testing.T, body []byte) stream.TileFrame {
	t.Helper()
	if len(body) < 8 {
		t.Fatalf("short body %d", len(body))
	}
	n := binary.BigEndian.Uint32(body[:4])
	var f stream.TileFrame
	if err := json.Unmarshal(body[8:8+n], &f); err != nil {
		t.Fatal(err)
	}
	if err := f.Validate(body[8+n:]); err != nil {
		t.Fatal(err)
	}
	return f
}

// The feed sends the whole screen first, then only the tiles that changed,
// losslessly and at full resolution; it answers "nothing new" when the screen
// is still and stops capturing once nobody asks for pictures.
func TestScreenFeedTiles(t *testing.T) {
	var captures, closed atomic.Int32
	saved, savedIdle, savedWait := openScreenCapture, screenIdleStop, screenWait
	defer func() { openScreenCapture, screenIdleStop, screenWait = saved, savedIdle, savedWait }()
	screenIdleStop, screenWait = 300*time.Millisecond, 300*time.Millisecond
	const w, h = 2560, 1440 // wider than the old 1920 cap: must not shrink
	openScreenCapture = func(context.Context) (func(desktop.CaptureOptions) (desktop.Screenshot, error), func()) {
		return func(o desktop.CaptureOptions) (desktop.Screenshot, error) {
			n := captures.Add(1)
			time.Sleep(5 * time.Millisecond)
			if o.MaxWidth != 0 && o.MaxWidth < w {
				t.Errorf("screen share scaled to %d", o.MaxWidth)
			}
			if n > 2 {
				time.Sleep(o.WaitChange)
				return desktop.Screenshot{EventDriven: true, Unchanged: true}, nil
			}
			img := o.Buffer
			if img == nil || img.Rect.Dx() != w {
				img = image.NewRGBA(image.Rect(0, 0, w, h))
			}
			for i := range img.Pix {
				img.Pix[i] = 255
			}
			if n == 2 { // a one-pixel black stroke in one tile
				img.Set(300, 200, color.RGBA{A: 255})
			}
			return desktop.Screenshot{EventDriven: true, Pixels: img, Width: w, Height: h, SourceWidth: w, SourceHeight: h}, nil
		}, func() { closed.Add(1) }
	}
	var c Client
	first := c.screen.tiles().Wait(context.Background(), 0, time.Second)
	f := screenBody(t, first)
	if !f.Reset || f.Width != w || f.Height != h || f.Revision == 0 {
		t.Fatalf("first picture: reset=%v %dx%d rev=%d", f.Reset, f.Width, f.Height, f.Revision)
	}
	var change stream.TileFrame
	for rev := f.Revision; ; {
		body := c.screen.tiles().Wait(context.Background(), rev, time.Second)
		if body == nil {
			t.Fatal("the change never arrived")
		}
		change = screenBody(t, body)
		rev = change.Revision
		if !change.Reset {
			break
		}
	}
	if len(change.Tiles) != 1 || change.Tiles[0].X != 256 || change.Tiles[0].Y != 128 || change.Tiles[0].MIME != "image/png" {
		t.Fatalf("change should be one exact tile, got %+v", change.Tiles)
	}
	if body := c.screen.tiles().Wait(context.Background(), change.Revision, 300*time.Millisecond); body != nil {
		t.Fatal("picture without a change")
	}
	time.Sleep(900 * time.Millisecond)
	if closed.Load() != 1 {
		t.Fatal("capture kept running with nobody watching")
	}
}
