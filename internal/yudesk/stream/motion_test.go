package stream

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"math/rand"
	"os"
	"testing"
	"time"
)

// desktop draws a photo-like half (true color) beside a text-like half
// (two colors), scrolled by shift rows.
func motionDesktop(w, h, shift int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	rng := rand.New(rand.NewSource(1))
	for y := 0; y < h; y++ {
		yy := y + shift
		for x := 0; x < w; x++ {
			c := color.RGBA{250, 250, 250, 255}
			if x < w/2 {
				n := uint8(rng.Intn(12))
				c = color.RGBA{uint8(x*255/w) + n, uint8(yy) + n, uint8((x+yy)/5) + n, 255}
			} else if (yy/18)%2 == 0 && (x/7+yy/3)%5 == 0 {
				c = color.RGBA{30, 30, 30, 255}
			}
			img.SetRGBA(x, y, c)
		}
	}
	return img
}

func applyTiles(t *testing.T, dst *image.RGBA, f TileFrame, data []byte) {
	t.Helper()
	if err := f.Validate(data); err != nil {
		t.Fatal(err)
	}
	offset := 0
	for _, tile := range f.Tiles {
		part := bytes.NewReader(data[offset : offset+tile.Size])
		offset += tile.Size
		var decoded image.Image
		var err error
		if tile.MIME == "image/png" {
			decoded, err = png.Decode(part)
		} else {
			decoded, err = jpeg.Decode(part)
		}
		if err != nil {
			t.Fatal(err)
		}
		draw.Draw(dst, image.Rect(tile.X, tile.Y, tile.X+tile.Width, tile.Y+tile.Height), decoded, decoded.Bounds().Min, draw.Src)
	}
}

// A scroll sends true-color tiles as JPEG at once; once still, Refine makes
// the viewer's picture pixel-exact again. Small changes stay lossless.
func TestMotionTilesRefineToExactPixels(t *testing.T) {
	e := &TileEncoder{GridSize: 128, Lossless: true, Motion: 16, RefineDelay: time.Millisecond}
	viewer := image.NewRGBA(image.Rect(0, 0, 1024, 768))
	f, data, err := e.Encode(motionDesktop(1024, 768, 0), 90, true)
	if err != nil {
		t.Fatal(err)
	}
	applyTiles(t, viewer, f, data)
	jpegTiles := 0
	for _, tile := range f.Tiles {
		if tile.MIME == "image/jpeg" {
			jpegTiles++
		}
	}
	if jpegTiles == 0 || jpegTiles == len(f.Tiles) {
		t.Fatalf("keyframe: %d of %d tiles JPEG; want photo half JPEG, text half PNG", jpegTiles, len(f.Tiles))
	}
	current := motionDesktop(1024, 768, 40)
	f, data, err = e.Encode(current, 90, false)
	if err != nil {
		t.Fatal(err)
	}
	applyTiles(t, viewer, f, data)
	if _, ok := e.RefineDue(time.Now()); !ok {
		t.Fatal("motion left no tiles to refine")
	}
	time.Sleep(2 * time.Millisecond)
	for range 100 {
		f, data, err = e.Refine(time.Now(), 8)
		if err != nil {
			t.Fatal(err)
		}
		if len(f.Tiles) > 8 {
			t.Fatalf("refine sent %d tiles, limit 8", len(f.Tiles))
		}
		if len(f.Tiles) == 0 {
			break
		}
		for _, tile := range f.Tiles {
			if tile.MIME != "image/png" {
				t.Fatal("refine sent a lossy tile")
			}
		}
		applyTiles(t, viewer, f, data)
	}
	if _, ok := e.RefineDue(time.Now()); ok {
		t.Fatal("tiles still pending after refine")
	}
	if !bytes.Equal(viewer.Pix, current.Pix) {
		t.Fatal("refined picture is not pixel-exact")
	}
	// Typing-sized change on the photo half: lossless immediately.
	next := image.NewRGBA(current.Rect)
	copy(next.Pix, current.Pix)
	for y := 10; y < 30; y++ {
		for x := 10; x < 40; x++ {
			next.SetRGBA(x, y, color.RGBA{1, 2, 3, 255})
		}
	}
	f, data, _ = e.Encode(next, 90, false)
	for _, tile := range f.Tiles {
		if tile.MIME != "image/png" {
			t.Fatal("small change was sent lossy")
		}
	}
	applyTiles(t, viewer, f, data)
	if !bytes.Equal(viewer.Pix, next.Pix) {
		t.Fatal("small change not exact")
	}
}

// Run with LINKME_REMOTE_LATENCY=1 to compare scroll encode cost.
func TestMotionEncodeCost(t *testing.T) {
	if os.Getenv("LINKME_REMOTE_LATENCY") != "1" {
		t.Skip("set LINKME_REMOTE_LATENCY=1")
	}
	for _, motion := range []int{0, 16} {
		e := &TileEncoder{GridSize: 128, Lossless: true, Motion: motion}
		e.Encode(motionDesktop(2560, 1440, 0), 90, true)
		var total time.Duration
		size := 0
		for i := 1; i <= 5; i++ {
			img := motionDesktop(2560, 1440, i*40)
			start := time.Now()
			_, data, _ := e.Encode(img, 90, false)
			total += time.Since(start)
			size += len(data)
		}
		t.Logf("motion=%d scroll frame: %v encode, %d KB", motion, total/5, size/5/1024)
	}
}
