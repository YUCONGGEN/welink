package stream

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math/rand/v2"
	"testing"
)

func assertTilePixels(t *testing.T, original *image.RGBA, data []byte) {
	t.Helper()
	decoded, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	for y := range original.Rect.Dy() {
		for x := range original.Rect.Dx() {
			if color.RGBAModel.Convert(decoded.At(x, y)) != original.RGBAAt(x, y) {
				t.Fatalf("glyph/color pixel changed at %d,%d", x, y)
			}
		}
	}
}

func TestDenseAntialiasedTextNeverFallsBackToJPEG(t *testing.T) {
	im := testScreen(256, 256)
	random := rand.New(rand.NewPCG(91, 573))
	// A dense grayscale antialiasing stress tile: PNG exceeds the former
	// size cutoff even though it is not photographic. Every shade matters.
	for y := range 256 {
		for x := range 256 {
			v := byte(random.Uint32())
			im.SetRGBA(x, y, color.RGBA{v, v, v, 255})
		}
	}
	var baseline bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := encoder.Encode(&baseline, im); err != nil {
		t.Fatal(err)
	}
	if baseline.Len() <= 256*256/3 {
		t.Fatal("fixture no longer exercises the former JPEG cutoff")
	}
	f, data, err := new(TileEncoder).Encode(im, 90, true)
	if err != nil || len(f.Tiles) != 1 || f.Tiles[0].MIME != "image/png" {
		t.Fatalf("dense glyph details lost: %+v %v", f, err)
	}
	assertTilePixels(t, im, data)
	t.Logf("dense 256-shade UI: RGB PNG=%d, exact indexed PNG=%d bytes", baseline.Len(), len(data))
}

func TestExactPaletteRetainsColoredTextAndSubimageEdges(t *testing.T) {
	for _, size := range []image.Point{{1, 1}, {37, 19}, {256, 256}} {
		base := image.NewRGBA(image.Rect(-4, -3, size.X+8, size.Y+7))
		im := base.SubImage(image.Rect(1, 2, size.X+1, size.Y+2)).(*image.RGBA)
		colors := []color.RGBA{{255, 255, 255, 255}, {0, 0, 0, 255}, {255, 17, 31, 255}, {19, 73, 255, 255}, {0, 163, 71, 255}, {121, 109, 173, 255}}
		for y := 2; y < size.Y+2; y++ {
			for x := 1; x < size.X+1; x++ {
				im.SetRGBA(x, y, colors[(x*19+y*37)%len(colors)])
			}
		}
		p := newTilePalette()
		indexed := p.index(im, im.Bounds())
		if indexed == nil {
			t.Fatal("small exact palette rejected")
		}
		for y := range size.Y {
			for x := range size.X {
				if color.RGBAModel.Convert(indexed.At(x, y)) != im.RGBAAt(x+1, y+2) {
					t.Fatalf("palette changed subimage pixel %d,%d", x, y)
				}
			}
		}
	}
}

func TestTrueColorUIStaysLosslessAndPhotoRetainsJPEG(t *testing.T) {
	for _, photo := range []bool{false, true} {
		im := testScreen(256, 256)
		random := rand.New(rand.NewPCG(42, 111))
		for y := range 256 {
			for x := range 256 {
				v := byte(random.Uint32())
				c := color.RGBA{v, v, v, 255}
				if photo {
					c.G, c.B = byte(random.Uint32()), byte(random.Uint32())
				} else if x%16 == 0 {
					c.B = 255 // More than 256 colors, still a grayscale UI with blue glyphs.
				}
				im.SetRGBA(x, y, c)
			}
		}
		f, data, err := new(TileEncoder).Encode(im, 90, true)
		if err != nil {
			t.Fatal(err)
		}
		if photo {
			if f.Tiles[0].MIME != "image/jpeg" {
				t.Fatal("photographic path lost its bounded JPEG encoder")
			}
		} else {
			if f.Tiles[0].MIME != "image/png" {
				t.Fatal("true-color UI text became JPEG")
			}
			assertTilePixels(t, im, data)
		}
	}
}

func TestTextOnColoredGradientRetainsEveryPixel(t *testing.T) {
	im := testScreen(256, 256)
	for y := range 256 {
		for x := range 256 {
			im.SetRGBA(x, y, color.RGBA{byte(80 + x*175/255), byte(80 + y*175/255), 160, 255})
		}
	}
	// Thin stems, horizontal strokes and gray antialiasing on a background
	// with enough colors to enter the photographic classifier.
	for x := 18; x < 232; x += 19 {
		for y := 40; y < 56; y++ {
			im.SetRGBA(x, y, color.RGBA{32, 35, 39, 255})
			im.SetRGBA(x+1, y, color.RGBA{111, 115, 119, 255})
		}
	}
	if !photographic(im, im.Bounds()) {
		t.Fatal("fixture does not exercise mixed content")
	}
	for _, q := range []int{60, 90, 100} {
		f, data, err := new(TileEncoder).Encode(im, q, true)
		if err != nil || len(f.Tiles) != 1 || f.Tiles[0].MIME != "image/png" {
			t.Fatalf("mixed text became lossy: %+v %v", f, err)
		}
		assertTilePixels(t, im, data)
	}
}

func BenchmarkTextPNG(b *testing.B) {
	im := testScreen(256, 256)
	for y := range 256 {
		for x := range 256 {
			v := byte((x*17 + y*11) % 16 * 17)
			im.SetRGBA(x, y, color.RGBA{v, v, v, 255})
		}
	}
	for _, indexed := range []bool{false, true} {
		name := "RGB"
		if indexed {
			name = "ExactPalette"
		}
		b.Run(name, func(b *testing.B) {
			p := newTilePalette()
			pool := new(tilePNGBufferPool)
			encoder := png.Encoder{CompressionLevel: png.BestSpeed, BufferPool: pool}
			var out bytes.Buffer
			b.ReportAllocs()
			b.ResetTimer()
			for range b.N {
				out.Reset()
				var source image.Image = im
				if indexed {
					source = p.index(im, im.Bounds())
				}
				if err := encoder.Encode(&out, source); err != nil {
					b.Fatal(err)
				}
			}
			b.ReportMetric(float64(out.Len()), "bytes/tile")
		})
	}
}

func TestIsoluminantColoredTextRemainsLossless(t *testing.T) {
	im := testScreen(256, 256)
	for y := range 256 {
		for x := range 256 {
			im.SetRGBA(x, y, color.RGBA{byte(40 + x*150/255), byte(70 + y*150/255), 160, 255})
		}
	}
	if !photographic(im, im.Bounds()) {
		t.Fatal("fixture does not exercise mixed content")
	}
	for x := 18; x < 232; x += 19 {
		for y := 40; y < 56; y++ {
			c := im.RGBAAt(x, y)
			c.R += 60
			c.G -= 30
			im.SetRGBA(x, y, c)
		}
	}
	f, data, err := new(TileEncoder).Encode(im, 60, true)
	if err != nil || len(f.Tiles) != 1 || f.Tiles[0].MIME != "image/png" {
		t.Fatalf("colored text was treated as a photograph: %+v %v", f, err)
	}
	assertTilePixels(t, im, data)
}
