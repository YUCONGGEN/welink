package remote

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/color"
	"testing"
	"time"

	"welink/internal/yudesk/stream"
)

func decodeHubBody(t *testing.T, body []byte) (stream.TileFrame, []byte) {
	t.Helper()
	if len(body) < 8 {
		t.Fatalf("short body %d", len(body))
	}
	header, size := binary.BigEndian.Uint32(body[:4]), binary.BigEndian.Uint32(body[4:8])
	var f stream.TileFrame
	if err := json.Unmarshal(body[8:8+header], &f); err != nil {
		t.Fatal(err)
	}
	data := body[8+header:]
	if uint32(len(data)) != size {
		t.Fatalf("payload %d, header says %d", len(data), size)
	}
	return f, data
}

func TestTileHubMergesDeltasForSlowViewers(t *testing.T) {
	screen := image.NewRGBA(image.Rect(0, 0, 300, 200))
	for i := range screen.Pix {
		screen.Pix[i] = 255
	}
	encoder := &stream.TileEncoder{GridSize: 128}
	hub := newTileHub()
	publish := func(force bool) {
		f, data, err := encoder.Encode(screen, 80, force)
		if err != nil {
			t.Fatal(err)
		}
		if len(f.Tiles) > 0 {
			if err := hub.publish(f, data, false); err != nil {
				t.Fatal(err)
			}
		}
		next := image.NewRGBA(screen.Rect)
		copy(next.Pix, screen.Pix)
		screen = next // the encoder keeps the previous image
	}
	publish(true)
	f, _ := decodeHubBody(t, hub.Wait(context.Background(), 0, time.Second))
	if !f.Reset || len(f.Tiles) != 6 || f.Revision != 1 {
		t.Fatalf("keyframe: reset=%v tiles=%d revision=%d", f.Reset, len(f.Tiles), f.Revision)
	}
	// Two separate changes; a viewer still at revision 1 receives both.
	screen.Set(10, 10, color.RGBA{255, 0, 0, 255})
	publish(false)
	screen.Set(290, 190, color.RGBA{0, 0, 255, 255})
	publish(false)
	f, _ = decodeHubBody(t, hub.Wait(context.Background(), 1, time.Second))
	if f.Reset || len(f.Tiles) != 2 || f.Revision != 3 {
		t.Fatalf("delta union: reset=%v tiles=%d revision=%d", f.Reset, len(f.Tiles), f.Revision)
	}
	if body := hub.Wait(context.Background(), 3, 50*time.Millisecond); body != nil {
		t.Fatal("nothing new must time out empty")
	}
	// A whole JPEG from an older peer resets the picture.
	if err := hub.publishJPEG([]byte{0xff, 0xd8, 0xff, 0xd9}, 640, 360); err != nil {
		t.Fatal(err)
	}
	f, data := decodeHubBody(t, hub.Wait(context.Background(), 3, time.Second))
	if !f.Reset || len(f.Tiles) != 1 || f.Tiles[0].MIME != "image/jpeg" || len(data) != 4 || f.Width != 640 {
		t.Fatalf("legacy frame: %+v", f)
	}
}
