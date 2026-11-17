package main

import (
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestBreathingFramesPulseSmoothly(t *testing.T) {
	ico, err := os.ReadFile(filepath.Join("resources", "linkme.ico"))
	if err != nil {
		t.Fatal(err)
	}
	src, err := largestICOImage(ico)
	if err != nil || src.Bounds().Dx() != 256 {
		t.Fatal("largest icon image", err)
	}
	for _, px := range []int{16, 20, 24, 32, 40, 48} {
		frames := renderBreathFrames(src, px, breathFrameCount)
		if len(frames) != breathFrameCount {
			t.Fatal("frame count", len(frames))
		}
		// The icon hops: its top edge rises one pixel at most per frame to the
		// middle of the breath, then settles back to where it started.
		top := func(i int) int {
			for y := 0; y < px; y++ {
				for x := 0; x < px; x++ {
					if frames[i].NRGBAAt(x, y).A > 230 {
						return y
					}
				}
			}
			return px
		}
		mid := breathFrameCount / 2
		if top(mid) >= top(0) || top(0)-top(mid) > max(2, px/8) || top(breathFrameCount-1) < top(0)-1 {
			t.Fatalf("%dpx bounce: top %d -> %d -> %d", px, top(0), top(mid), top(breathFrameCount-1))
		}
		for i := 1; i < breathFrameCount; i++ {
			if d := top(i) - top(i-1); d > 1 || d < -1 {
				t.Fatalf("%dpx frame %d jumps %d px", px, i, d)
			}
		}
		// The soft green halo is strongest half way through the breath.
		glow := func(i int) int {
			sum := 0
			for y := 0; y < px; y++ {
				for x := 0; x < px; x++ {
					c := frames[i].NRGBAAt(x, y)
					if c.A > 0 && c.A < 200 && c.G > c.R && c.G > c.B {
						sum += int(c.A)
					}
				}
			}
			return sum
		}
		if glow(mid) <= glow(0)*2 {
			t.Fatalf("%dpx halo does not breathe: %d -> %d", px, glow(0), glow(mid))
		}
	}
	if dir := os.Getenv("LINKME_BREATH_PREVIEW"); dir != "" {
		for i, f := range renderBreathFrames(src, 96, breathFrameCount) {
			out, _ := os.Create(filepath.Join(dir, "breath-"+string(rune('a'+i))+".png"))
			png.Encode(out, f)
			out.Close()
		}
	}
}
