package stream

import "image"

// Fine strokes are bounded by similar background colors on both sides. This
// protects antialiased UI details without thresholding or rewriting a glyph.
// A detected stroke keeps its entire existing protocol tile lossless. This
// avoids incompatible subtiles and does not invent text through OCR.
func fineDetail(im *image.RGBA, r image.Rectangle) bool {
	stride := im.Stride
	pix := im.Pix
	stroke := func(x, y, delta int) bool {
		i := im.PixOffset(x, y)
		a, b := i-delta, i+delta
		for c := 0; c < 3; c++ {
			if abs(int(pix[a+c])-int(pix[b+c])) > 16 {
				return false
			}
		}
		// Colored glyphs can have nearly the same luminance as their background.
		// Detect their RGB edge too, before JPEG chroma subsampling can erase it.
		for c := 0; c < 3; c++ {
			v, left, right := int(pix[i+c]), int(pix[a+c]), int(pix[b+c])
			if v+12 < min(left, right) || v-12 > max(left, right) {
				return true
			}
		}
		return false
	}
	for y := max(r.Min.Y, 3); y < min(r.Max.Y, im.Rect.Max.Y-3); y++ {
		for x := max(r.Min.X, 3); x < min(r.Max.X, im.Rect.Max.X-3); x++ {
			vertical := (stroke(x, y, 2*4) || stroke(x, y, 3*4)) && (stroke(x, y-1, 2*4) || stroke(x, y-1, 3*4)) && (stroke(x, y+1, 2*4) || stroke(x, y+1, 3*4))
			horizontal := !vertical && (stroke(x, y, 2*stride) || stroke(x, y, 3*stride)) && (stroke(x-1, y, 2*stride) || stroke(x-1, y, 3*stride)) && (stroke(x+1, y, 2*stride) || stroke(x+1, y, 3*stride))
			if !vertical && !horizontal {
				continue
			}
			return true
		}
	}
	return false
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
