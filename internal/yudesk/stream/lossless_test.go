package stream

import (
	"bytes"
	"image"
	"image/png"
	"math/rand"
	"testing"
	"time"
)

// A photographic desktop (random noise defeats every palette) must still be
// rebuilt pixel for pixel when the encoder is lossless.
func TestLosslessTilesRebuildEveryPixel(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 300, 200))
	rng := rand.New(rand.NewSource(1))
	for i := range img.Pix {
		img.Pix[i] = byte(rng.Intn(256))
		if i%4 == 3 {
			img.Pix[i] = 255
		}
	}
	e := &TileEncoder{GridSize: 128, Lossless: true}
	f, data, err := e.Encode(img, 90, true)
	if err != nil || f.Validate(data) != nil {
		t.Fatal(err)
	}
	rebuilt := image.NewRGBA(img.Rect)
	offset := 0
	for _, tile := range f.Tiles {
		if tile.MIME != "image/png" {
			t.Fatalf("lossless encoder produced %s", tile.MIME)
		}
		decoded, err := png.Decode(bytes.NewReader(data[offset : offset+tile.Size]))
		if err != nil {
			t.Fatal(err)
		}
		offset += tile.Size
		for y := 0; y < tile.Height; y++ {
			for x := 0; x < tile.Width; x++ {
				rebuilt.Set(tile.X+x, tile.Y+y, decoded.At(decoded.Bounds().Min.X+x, decoded.Bounds().Min.Y+y))
			}
		}
	}
	if !bytes.Equal(rebuilt.Pix, img.Pix) {
		t.Fatal("rebuilt desktop differs from the source")
	}
	// The default (lossy) encoder still uses JPEG for photo regions.
	f, _, _ = (&TileEncoder{GridSize: 128}).Encode(img, 90, true)
	if f.Tiles[0].MIME != "image/jpeg" {
		t.Fatal("photo tiles should stay JPEG unless lossless is requested")
	}
}

func TestLatencyControllerNeverShrinksOriginalResolution(t *testing.T) {
	c := NewLatencyController(Options{Quality: 90, MaxWidth: 1920})
	c.SetLimits(90, 0, 90, 1<<16)
	now := time.Now()
	for i := 0; i < 50; i++ {
		c.Ack(time.Duration(10+i*20) * time.Millisecond) // a growing network queue
		c.Update(now.Add(time.Duration(i)*1100*time.Millisecond), time.Second, 33*time.Millisecond, 2560)
	}
	if (c.Width != 0 && c.Width != 2560) || c.Quality != 90 {
		t.Fatalf("original picture degraded: width=%d quality=%d", c.Width, c.Quality)
	}
}
