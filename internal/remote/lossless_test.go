package remote

import (
	"bytes"
	"image"
	"image/png"
	"testing"
)

func TestWholeFramePNGKeepsItsType(t *testing.T) {
	var b bytes.Buffer
	png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 4, 4)))
	if imageMIME(b.Bytes()) != "image/png" || imageMIME([]byte{0xff, 0xd8, 0xff}) != "image/jpeg" {
		t.Fatal("whole-frame image type")
	}
	h := newTileHub()
	if err := h.publishJPEG(b.Bytes(), 4, 4); err != nil {
		t.Fatal(err)
	}
	if f, _, _, _ := h.snapshot(0); len(f.Tiles) != 1 || f.Tiles[0].MIME != "image/png" {
		t.Fatalf("hub frame %+v", f)
	}
}
