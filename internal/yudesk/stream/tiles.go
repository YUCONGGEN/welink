package stream

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math/bits"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"welink/internal/yudesk/mediabudget"
)

const TileSize = 256
const MaxPixels = 3840 * 2160 * 4

// Tiles are independently decodable absolute rectangles, not a chain of video
// deltas. Receivers may merge newer versions of the same tile without losing
// changes elsewhere, even when a browser is slow or reconnects.
type Tile struct {
	X      int    `json:"x"`
	Y      int    `json:"y"`
	Width  int    `json:"w"`
	Height int    `json:"h"`
	Size   int    `json:"size"`
	MIME   string `json:"mime"`
	// Solid is an exact opaque RGBA color, never a sampled approximation.
	// The PNG remains present for compatibility and normal decode validation.
	Solid *uint32 `json:"solid,omitempty"`
}

type TileFrame struct {
	TileSize     int    `json:"tileSize,omitempty"` // zero is the original 256-pixel grid
	Revision     uint64 `json:"revision,omitempty"` // local viewer/browser cursor; not a media timestamp
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	SourceWidth  int    `json:"sourceWidth"`
	SourceHeight int    `json:"sourceHeight"`
	DisplayID    string `json:"displayID,omitempty"`
	Generation   string `json:"generation,omitempty"`
	LayoutID     string `json:"layoutID,omitempty"` // native input rectangle and source pixels of this frame
	Reset        bool   `json:"reset"`
	Tiles        []Tile `json:"tiles"`
}

func (f TileFrame) GridSize() int {
	if f.TileSize == 128 {
		return 128
	}
	return TileSize
}

func (f TileFrame) Validate(data []byte) error {
	if f.TileSize != 0 && f.TileSize != 128 && f.TileSize != TileSize {
		return errors.New("invalid tile grid size")
	}
	if len(f.DisplayID) > 512 || len(f.Generation) > 512 || len(f.LayoutID) > 512 {
		return errors.New("invalid frame binding")
	}
	if f.Width < 1 || f.Height < 1 || f.Width > 16384 || f.Height > 16384 || f.Width*f.Height > MaxPixels || len(f.Tiles) > 1024 {
		return errors.New("invalid tile frame dimensions")
	}
	size := 0
	seen := make(map[[2]int]bool, len(f.Tiles))
	for _, t := range f.Tiles {
		position := [2]int{t.X, t.Y}
		if seen[position] {
			return errors.New("duplicate tile")
		}
		seen[position] = true
		if t.Solid != nil && (*t.Solid&255 != 255 || t.MIME != "image/png") {
			return errors.New("invalid solid tile")
		}
		if t.X < 0 || t.Y < 0 || t.Width < 1 || t.Height < 1 || t.X+t.Width > f.Width || t.Y+t.Height > f.Height || t.Size < 1 || t.Size > len(data)-size || (t.MIME != "image/png" && t.MIME != "image/jpeg") {
			return errors.New("invalid tile frame payload")
		}
		size += t.Size
	}
	if size != len(data) {
		return errors.New("tile payload length mismatch")
	}
	return nil
}

type TileEncoder struct {
	GridSize     int // negotiated 128 grid; large surfaces fall back to 256 to bound tile count
	previousGrid int
	previous     *image.RGBA
	pngBuffers   tilePNGBufferPool
	palettes     sync.Pool
}

// A PNG compressor owns roughly a megabyte of scratch storage even for a
// tiny desktop change. Reuse it across workers/frames instead of continually
// allocating it and causing GC jitter during pointer movement and typing.
type tilePNGBufferPool struct{ sync.Pool }

func (p *tilePNGBufferPool) Get() *png.EncoderBuffer {
	buffer, _ := p.Pool.Get().(*png.EncoderBuffer)
	return buffer
}

func (p *tilePNGBufferPool) Put(buffer *png.EncoderBuffer) { p.Pool.Put(buffer) }

// Encode compares raw pixels first. Unchanged tiles do not enter an encoder.
// Flat UI/text uses lossless PNG; photographic tiles use the requested JPEG
// quality when PNG would be expensive. This is a desktop codec, not H.264.
func (e *TileEncoder) Encode(img *image.RGBA, quality int, force bool) (TileFrame, []byte, error) {
	return e.encode(img, quality, force, mediabudget.CPUsForScreen(runtime.GOMAXPROCS(0)))
}

// One caller owns the reference image. Workers operate on disjoint output slots
// and join before that reference can be recycled by capture.
func (e *TileEncoder) encode(img *image.RGBA, quality int, force bool, cpus int) (TileFrame, []byte, error) {
	if img == nil || img.Rect.Min != (image.Point{}) || img.Rect.Dx() < 1 || img.Rect.Dy() < 1 || img.Rect.Dx()*img.Rect.Dy() > MaxPixels {
		return TileFrame{}, nil, errors.New("invalid captured pixels")
	}
	f := TileFrame{Width: img.Rect.Dx(), Height: img.Rect.Dy()}
	grid := TileSize
	if e.GridSize == 128 && ((f.Width+127)/128)*((f.Height+127)/128) <= 1024 {
		grid = 128
		f.TileSize = grid
	}
	f.Reset = force || e.previous == nil || e.previous.Rect != img.Rect || e.previousGrid != grid
	// Idle desktops are common between pointer/keyboard actions. A single
	// optimized whole-surface comparison is cheaper than allocating one task
	// slot per tile and repeating the same row comparisons in every tile. Keep
	// the current image as the reference because capture buffers are owned by
	// the caller and may be recycled after this call.
	if !f.Reset && img.Stride == e.previous.Stride {
		pixelBytes := img.Rect.Dy() * img.Stride
		if pixelBytes <= len(img.Pix) && pixelBytes <= len(e.previous.Pix) && bytes.Equal(img.Pix[:pixelBytes], e.previous.Pix[:pixelBytes]) {
			e.previous = img
			return f, nil, nil
		}
	}
	columns := (f.Width + grid - 1) / grid
	tasks := columns * ((f.Height + grid - 1) / grid)
	f.Tiles = make([]Tile, tasks)
	encoded := make([][]byte, tasks)
	errs := make([]error, tasks)
	encode := func(i int) {
		x, y := i%columns*grid, i/columns*grid
		r := image.Rect(x, y, min(x+grid, f.Width), min(y+grid, f.Height))
		classification := r.Inset(-3).Intersect(img.Rect)
		// The detector itself reads up to three pixels beyond its scan area.
		comparison := r.Inset(-6).Intersect(img.Rect)
		changed := f.Reset
		// Classification also depends on the small halo: a new adjacent stem
		// must upgrade a formerly JPEG boundary even if this tile is unchanged.
		for row := comparison.Min.Y; !changed && row < comparison.Max.Y; row++ {
			a, b := img.PixOffset(comparison.Min.X, row), e.previous.PixOffset(comparison.Min.X, row)
			changed = !bytes.Equal(img.Pix[a:a+comparison.Dx()*4], e.previous.Pix[b:b+comparison.Dx()*4])
		}
		if !changed {
			return
		}
		encoder := png.Encoder{CompressionLevel: png.BestSpeed, BufferPool: &e.pngBuffers}
		var out bytes.Buffer
		mime := "image/png"
		// Exact indexing compresses UI/text without chroma subsampling or
		// quantizing antialiased glyphs. Photo tiles abandon the scan as soon
		// as a 257th color is found; workers reuse the bounded scratch space.
		palette, _ := e.palettes.Get().(*tilePalette)
		if palette == nil {
			palette = newTilePalette()
		}
		defer e.palettes.Put(palette)
		indexed := palette.index(img, r)
		// Include neighboring pixels when classifying a boundary glyph: its
		// antialiasing must not become JPEG merely because a stem crosses tiles.
		photo := indexed == nil && photographic(img, r) && !fineDetail(img, classification)
		if !photo {
			var pixels image.Image = img.SubImage(r)
			if indexed != nil {
				pixels = indexed
			}
			errs[i] = encoder.Encode(&out, pixels)
		}
		// A dense page of small glyphs can exceed the former size threshold.
		// Its byte count must never silently turn lossless text into JPEG.
		if photo && errs[i] == nil {
			out.Reset()
			errs[i] = jpeg.Encode(&out, img.SubImage(r), &jpeg.Options{Quality: quality})
			mime = "image/jpeg"
		}
		encoded[i] = out.Bytes()
		f.Tiles[i] = Tile{X: r.Min.X, Y: r.Min.Y, Width: r.Dx(), Height: r.Dy(), Size: out.Len(), MIME: mime}
		if indexed != nil && len(indexed.Palette) == 1 {
			c := palette.colors[0]
			value := uint32(c.R)<<24 | uint32(c.G)<<16 | uint32(c.B)<<8 | 255
			f.Tiles[i].Solid = &value
		}
	}
	// Keep the audio handoff budget per source pixel, not per tile: four
	// 128px tiles must not introduce four times as many scheduler parks.
	yieldScreen := func(processed *int, i int) {
		x, y := i%columns*grid, i/columns*grid
		*processed += min(grid, f.Width-x) * min(grid, f.Height-y)
		if *processed >= TileSize*TileSize {
			if mediabudget.AudioActive() {
				time.Sleep(100 * time.Microsecond)
			}
			*processed = 0
		}
	}
	workers := tileWorkerCount(tasks, cpus)
	if workers <= 1 {
		leaveScheduling := mediabudget.FrameWorker()
		defer leaveScheduling()
		// Small surfaces and single-core hosts avoid goroutine handoff.
		processed := 0
		for i := range tasks {
			encode(i)
			yieldScreen(&processed, i)
		}
	} else {
		// Claim work directly: neither dirty-pixel comparisons nor dispatching
		// every tile through one unbuffered channel serializes a large frame.
		var next atomic.Int32
		var wg sync.WaitGroup
		for range workers {
			wg.Add(1)
			go func() {
				defer wg.Done()
				leaveScheduling := mediabudget.FrameWorker()
				defer leaveScheduling()
				processed := 0
				for {
					i := int(next.Add(1)) - 1
					if i >= tasks {
						return
					}
					encode(i)
					yieldScreen(&processed, i)
				}
			}()
		}
		wg.Wait()
	}
	size := 0
	for _, b := range encoded {
		size += len(b)
	}
	data := make([]byte, 0, size)
	tiles := f.Tiles[:0]
	for i, b := range encoded {
		if errs[i] != nil {
			return TileFrame{}, nil, errs[i]
		}
		data = append(data, b...)
		if f.Tiles[i].Size != 0 {
			tiles = append(tiles, f.Tiles[i])
		}
	}
	f.Tiles = tiles
	// Capture returns an owned immutable image. Retain it until the next frame.
	e.previous = img
	e.previousGrid = grid
	return f, data, nil
}

// A palette is a reversible byte index, never a nearest-color approximation.
// The hash table is kept at <=25% occupancy and the source alpha must be opaque.
type tilePalette struct {
	keys    [1024]uint32
	values  [1024]uint16
	pixels  [TileSize * TileSize]byte
	colors  [256]color.RGBA
	entries color.Palette
}

func newTilePalette() *tilePalette {
	p := &tilePalette{entries: make(color.Palette, 256)}
	for i := range p.colors {
		p.entries[i] = &p.colors[i]
	}
	return p
}

func (p *tilePalette) index(img *image.RGBA, r image.Rectangle) *image.Paletted {
	clear(p.values[:])
	n, at := 0, 0
	var previous uint32
	var previousIndex byte
	var previousPair uint64
	for y := r.Min.Y; y < r.Max.Y; y++ {
		row := img.Pix[img.PixOffset(r.Min.X, y):img.PixOffset(r.Max.X, y)]
		for x := 0; x < len(row); x += 4 {
			// A single word load covers RGBA; BigEndian preserves the existing
			// RGB key on every architecture. This is the hottest part of exact
			// palette conversion, including long runs of unchanged background.
			rgba := binary.BigEndian.Uint32(row[x : x+4])
			if rgba&255 != 255 {
				return nil
			}
			key := rgba >> 8
			if at != 0 && key == previous && x+16 <= len(row) &&
				binary.BigEndian.Uint64(row[x+4:x+12]) == previousPair && binary.BigEndian.Uint32(row[x+12:x+16]) == rgba {
				// Four proven-identical opaque pixels share an exact palette
				// index. UI backgrounds contain long runs; skip repeated hash
				// probes and byte stores without sampling or changing any color.
				binary.LittleEndian.PutUint32(p.pixels[at:at+4], uint32(previousIndex)*0x01010101)
				x += 12
				at += 4
				continue
			}
			if at == 0 || key != previous {
				slot := (key * 0x9e3779b1) >> 22
				for p.values[slot] != 0 && p.keys[slot] != key {
					slot = (slot + 1) & 1023
				}
				if p.values[slot] == 0 {
					if n == len(p.colors) {
						return nil
					}
					p.keys[slot], p.values[slot] = key, uint16(n+1)
					p.colors[n] = color.RGBA{row[x], row[x+1], row[x+2], 255}
					n++
				}
				previous, previousIndex = key, byte(p.values[slot]-1)
				previousPair = uint64(rgba)<<32 | uint64(rgba)
			}
			p.pixels[at] = previousIndex
			at++
		}
	}
	return &image.Paletted{Pix: p.pixels[:at], Stride: r.Dx(), Rect: image.Rect(0, 0, r.Dx(), r.Dy()), Palette: p.entries[:n]}
}

func tileWorkerCount(tasks, cpus int) int {
	// Leave scheduler capacity for input, capture and network handling on
	// multicore hosts. More workers than CPU capacity just add contention.
	return min(tasks, max(1, min(8, cpus-1)))
}

// Sampling a coarse color histogram is much cheaper than trying PNG on every
// photographic tile. Gray text/antialiased UI retains the lossless path.
func photographic(img *image.RGBA, r image.Rectangle) bool {
	var colors [64]uint64
	for y := r.Min.Y; y < r.Max.Y; y += 8 {
		for x := r.Min.X; x < r.Max.X; x += 8 {
			i := img.PixOffset(x, y)
			c := int(img.Pix[i]>>4)<<8 | int(img.Pix[i+1]>>4)<<4 | int(img.Pix[i+2]>>4)
			colors[c/64] |= 1 << uint(c%64)
		}
	}
	n := 0
	for _, word := range colors {
		n += bits.OnesCount64(word)
	}
	return n > 96
}
