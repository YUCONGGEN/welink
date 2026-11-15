package stream

import (
	"image"
	"image/color"
	"image/draw"
	"testing"
)

// Text backgrounds contain long constant runs with isolated antialiased pixels.
// Exercise every boundary, odd row lengths, subrectangles and scratch reuse.
func TestExactPalettePreservesEveryPixelWithinBackgroundRuns(t *testing.T) {
	palette := newTilePalette()
	for _, width := range []int{1, 3, 4, 5, 15, 16, 17, 127, 128, 255, 256} {
		for mark := 0; mark < width; mark++ {
			im := image.NewRGBA(image.Rect(0, 0, width+6, 7))
			draw.Draw(im, im.Bounds(), image.NewUniform(color.RGBA{17, 29, 43, 255}), image.Point{}, draw.Src)
			r := image.Rect(3, 2, width+3, 5)
			im.SetRGBA(r.Min.X+mark, 3, color.RGBA{233, 224, 215, 255})
			indexed := palette.index(im, r)
			if indexed == nil {
				t.Fatalf("opaque run rejected: width=%d mark=%d", width, mark)
			}
			for y := 0; y < r.Dy(); y++ {
				for x := 0; x < r.Dx(); x++ {
					red, green, blue, alpha := indexed.At(x, y).RGBA()
					wantRed, wantGreen, wantBlue, wantAlpha := im.At(x+r.Min.X, y+r.Min.Y).RGBA()
					if red != wantRed || green != wantGreen || blue != wantBlue || alpha != wantAlpha {
						t.Fatalf("pixel changed: width=%d mark=%d at=%d,%d", width, mark, x, y)
					}
				}
			}
			// Even one nonopaque pixel in the middle of a constant RGB run
			// must reject indexing; it cannot be skipped by a run shortcut.
			im.SetRGBA(r.Min.X+mark, 3, color.RGBA{17, 29, 43, 254})
			if palette.index(im, r) != nil {
				t.Fatalf("transparent pixel skipped: width=%d mark=%d", width, mark)
			}
		}
	}
}
