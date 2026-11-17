package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/png"
	"math"

	xdraw "golang.org/x/image/draw"
)

// Unread "breathing light": while messages are unread and the window is
// minimised or in the background, the M icon pulses slowly — a green halo
// swells and fades around a slightly smaller icon, which brightens with it.
// These helpers render the frames; the Windows host turns them into icons.

const breathFrameCount = 20 // one breath = breathFrameCount × breathInterval

var breathGlow = color.NRGBA{R: 0x2f, G: 0xd0, B: 0x8a, A: 0xff}

// largestICOImage decodes the biggest PNG image stored in an .ico file.
func largestICOImage(ico []byte) (image.Image, error) {
	if len(ico) < 6 {
		return nil, errors.New("icon too short")
	}
	count := int(binary.LittleEndian.Uint16(ico[4:6]))
	best, bestSize := -1, 0
	for i := 0; i < count; i++ {
		entry := 6 + i*16
		if entry+16 > len(ico) {
			break
		}
		size := int(ico[entry])
		if size == 0 {
			size = 256
		}
		if size > bestSize {
			best, bestSize = i, size
		}
	}
	if best < 0 {
		return nil, errors.New("icon has no images")
	}
	entry := 6 + best*16
	length := int(binary.LittleEndian.Uint32(ico[entry+8 : entry+12]))
	offset := int(binary.LittleEndian.Uint32(ico[entry+12 : entry+16]))
	if length <= 0 || offset < 0 || offset+length > len(ico) {
		return nil, errors.New("icon entry out of range")
	}
	return png.Decode(bytes.NewReader(ico[offset : offset+length]))
}

// breathLevel is the halo strength of frame k: a smooth 0→1→0 cosine wave.
func breathLevel(k, n int) float64 {
	return (1 - math.Cos(2*math.Pi*float64(k)/float64(n))) / 2
}

// renderBreathFrames renders n square frames of px pixels: the icon hops up
// and settles back while a green halo swells and fades around it, in step
// with a smooth breathing curve.
func renderBreathFrames(src image.Image, px, n int) []*image.NRGBA {
	inner := int(math.Round(float64(px) * 0.80))
	if inner < 8 {
		inner = px
	}
	offset := (px - inner) / 2
	scaled := image.NewNRGBA(image.Rect(0, 0, inner, inner))
	xdraw.CatmullRom.Scale(scaled, scaled.Rect, src, src.Bounds(), xdraw.Over, nil)
	// How far the icon rises at the top of a breath (uses the top margin).
	bounce := math.Max(1, math.Round(float64(px)*0.09))
	radius := max(2, px/9)
	frames := make([]*image.NRGBA, n)
	for k := range frames {
		level := breathLevel(k, n)
		dy := -int(math.Round(bounce * level))
		icon := image.NewNRGBA(image.Rect(0, 0, px, px))
		xdraw.Copy(icon, image.Pt(offset, offset+dy), scaled, scaled.Rect, xdraw.Src, nil)
		// The halo is the icon's silhouette, spread and softened; it moves with it.
		halo := make([]float64, px*px)
		for y := 0; y < px; y++ {
			for x := 0; x < px; x++ {
				halo[y*px+x] = float64(icon.NRGBAAt(x, y).A) / 255
			}
		}
		for pass := 0; pass < 3; pass++ {
			halo = boxBlur(halo, px, radius)
		}
		frame := image.NewNRGBA(icon.Rect)
		for y := 0; y < px; y++ {
			for x := 0; x < px; x++ {
				// Halo underneath: faint at rest, bright at the top of a breath.
				glowA := math.Min(1, halo[y*px+x]*1.8) * (0.18 + 0.82*level)
				c := icon.NRGBAAt(x, y)
				iconA := float64(c.A) / 255
				// The icon itself brightens a little as it breathes in.
				lift := 0.22 * level
				r := float64(c.R) + (255-float64(c.R))*lift
				g := float64(c.G) + (255-float64(c.G))*lift
				b := float64(c.B) + (255-float64(c.B))*lift
				// Composite icon over halo (straight alpha).
				outA := iconA + glowA*(1-iconA)
				if outA <= 0 {
					continue
				}
				mix := func(fg, bg float64) uint8 {
					return uint8(math.Round((fg*iconA + bg*glowA*(1-iconA)) / outA))
				}
				frame.SetNRGBA(x, y, color.NRGBA{
					R: mix(r, float64(breathGlow.R)),
					G: mix(g, float64(breathGlow.G)),
					B: mix(b, float64(breathGlow.B)),
					A: uint8(math.Round(outA * 255)),
				})
			}
		}
		frames[k] = frame
	}
	return frames
}

// boxBlur is one horizontal + vertical box blur pass over a px×px field.
func boxBlur(in []float64, px, r int) []float64 {
	tmp := make([]float64, len(in))
	out := make([]float64, len(in))
	for y := 0; y < px; y++ {
		for x := 0; x < px; x++ {
			sum, count := 0.0, 0
			for d := -r; d <= r; d++ {
				if xx := x + d; xx >= 0 && xx < px {
					sum += in[y*px+xx]
				}
				count++
			}
			tmp[y*px+x] = sum / float64(count)
		}
	}
	for y := 0; y < px; y++ {
		for x := 0; x < px; x++ {
			sum, count := 0.0, 0
			for d := -r; d <= r; d++ {
				if yy := y + d; yy >= 0 && yy < px {
					sum += tmp[yy*px+x]
				}
				count++
			}
			out[y*px+x] = sum / float64(count)
		}
	}
	return out
}
