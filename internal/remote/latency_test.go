package remote

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"net"
	"os"
	"sort"
	"sync"
	"testing"
	"time"

	"welink/internal/yudesk/desktop"
	"welink/internal/yudesk/protocol"
	"welink/internal/yudesk/stream"
)

// shapedLink is one direction of a link with a fixed bandwidth and one-way
// delay, and a send buffer of buffer bytes (socket buffers plus the relay's
// queue) that Write fills without waiting, as a real TCP socket does.
type shapedLink struct {
	mu       sync.Mutex
	cond     *sync.Cond
	bytesPer time.Duration // serialization time per byte
	delay    time.Duration
	buffer   int
	queued   int
	lastDone time.Time
	packets  []shapedPacket
	pending  []byte
	closed   bool
}
type shapedPacket struct {
	data []byte
	at   time.Time
	done time.Time
}

func newShapedLink(mbps int, delay time.Duration, buffer int) *shapedLink {
	l := &shapedLink{bytesPer: time.Second * 8 / time.Duration(mbps*1_000_000), delay: delay, buffer: buffer}
	l.cond = sync.NewCond(&l.mu)
	return l
}

func (l *shapedLink) write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for !l.closed && l.queued > l.buffer {
		l.cond.Wait()
	}
	if l.closed {
		return 0, io.ErrClosedPipe
	}
	start := time.Now()
	if l.lastDone.After(start) {
		start = l.lastDone
	}
	done := start.Add(time.Duration(len(p)) * l.bytesPer)
	l.lastDone = done
	l.queued += len(p)
	l.packets = append(l.packets, shapedPacket{data: append([]byte(nil), p...), at: done.Add(l.delay), done: done})
	l.cond.Broadcast()
	return len(p), nil
}

func (l *shapedLink) read(p []byte) (int, error) {
	l.mu.Lock()
	for len(l.pending) == 0 {
		if l.closed {
			l.mu.Unlock()
			return 0, io.EOF
		}
		if len(l.packets) == 0 {
			l.cond.Wait()
			continue
		}
		next := l.packets[0]
		if wait := time.Until(next.at); wait > 0 {
			l.mu.Unlock()
			time.Sleep(min(wait, 2*time.Millisecond))
			l.mu.Lock()
			continue
		}
		l.packets = l.packets[1:]
		l.queued -= len(next.data)
		l.pending = next.data
		l.cond.Broadcast()
	}
	n := copy(p, l.pending)
	l.pending = l.pending[n:]
	l.mu.Unlock()
	return n, nil
}

func (l *shapedLink) close() {
	l.mu.Lock()
	l.closed = true
	l.cond.Broadcast()
	l.mu.Unlock()
}

type shapedConn struct {
	in, out *shapedLink
}

func (c shapedConn) Read(p []byte) (int, error)     { return c.in.read(p) }
func (c shapedConn) Write(p []byte) (int, error)    { return c.out.write(p) }
func (c shapedConn) Close() error                   { c.in.close(); c.out.close(); return nil }
func (shapedConn) LocalAddr() net.Addr              { return &net.TCPAddr{} }
func (shapedConn) RemoteAddr() net.Addr             { return &net.TCPAddr{} }
func (shapedConn) SetDeadline(time.Time) error      { return nil }
func (shapedConn) SetReadDeadline(time.Time) error  { return nil }
func (shapedConn) SetWriteDeadline(time.Time) error { return nil }

// scrollingDesktop presents a new 60 Hz frame of a page that scrolls without
// pause. The first 128x128 tile is flat black and white (always exact PNG)
// and carries the frame number as 32 bit cells, so the viewer can tell how
// old the picture it shows is.
type scrollingDesktop struct {
	mu      sync.Mutex
	page    *image.RGBA
	start   time.Time
	shown   map[uint32]time.Time
	w, h    int
	pending map[*image.RGBA]bool
}

func newScrollingDesktop(w, h int) *scrollingDesktop {
	page := image.NewRGBA(image.Rect(0, 0, w, h*4))
	for y := 0; y < page.Rect.Dy(); y++ {
		for x := 0; x < w; x++ {
			c := color.RGBA{250, 250, 250, 255}
			if x < w/2 {
				c = color.RGBA{uint8(x*255/w) + uint8(x*y%13), uint8(y) + uint8(x%7), uint8((x + y) / 5), 255}
			} else if (y/18)%2 == 0 && (x/7+y/3)%5 == 0 {
				c = color.RGBA{30, 30, 30, 255}
			}
			page.SetRGBA(x, y, c)
		}
	}
	return &scrollingDesktop{page: page, start: time.Now(), shown: map[uint32]time.Time{}, w: w, h: h}
}

func (d *scrollingDesktop) open(ctx context.Context) (func(desktop.CaptureOptions) (desktop.Screenshot, error), func()) {
	return func(o desktop.CaptureOptions) (desktop.Screenshot, error) {
		// Wait for the next 60 Hz presentation, as DXGI duplication does.
		frame := uint32(time.Since(d.start)/(time.Second/60)) + 1
		next := d.start.Add(time.Duration(frame) * time.Second / 60)
		select {
		case <-ctx.Done():
			return desktop.Screenshot{}, ctx.Err()
		case <-time.After(time.Until(next)):
		}
		img := o.Buffer
		if img == nil || img.Rect.Dx() != d.w || img.Rect.Dy() != d.h {
			img = image.NewRGBA(image.Rect(0, 0, d.w, d.h))
		}
		offset := int(frame*6) % (d.page.Rect.Dy() - d.h)
		copy(img.Pix, d.page.Pix[offset*d.page.Stride:(offset+d.h)*d.page.Stride])
		for y := 0; y < 128; y++ {
			for x := 0; x < 128; x++ {
				bit := y/32*4 + x/32
				v := uint8(0)
				if bit < 16 && frame&(1<<bit) != 0 {
					v = 255
				}
				i := img.PixOffset(x, y)
				img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = v, v, v, 255
			}
		}
		d.mu.Lock()
		d.shown[frame&0xffff] = next
		d.mu.Unlock()
		return desktop.Screenshot{Pixels: img, Width: d.w, Height: d.h, SourceWidth: d.w, SourceHeight: d.h, EventDriven: true}, nil
	}, func() {}
}

func (d *scrollingDesktop) frameOf(tile []byte) (time.Time, bool) {
	img, err := png.Decode(bytes.NewReader(tile))
	if err != nil {
		return time.Time{}, false
	}
	var frame uint32
	for bit := 0; bit < 16; bit++ {
		r, _, _, _ := img.At(bit%4*32+16, bit/4*32+16).RGBA()
		if r > 0x8000 {
			frame |= 1 << bit
		}
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	at, ok := d.shown[frame]
	return at, ok
}

// TestScrollLatencyOverSlowLink measures how old the picture is when it
// reaches the viewer while the shared screen scrolls nonstop, over a link
// with a large send buffer. Run with LINKME_REMOTE_LATENCY=1.
func TestScrollLatencyOverSlowLink(t *testing.T) {
	if os.Getenv("LINKME_REMOTE_LATENCY") != "1" {
		t.Skip("set LINKME_REMOTE_LATENCY=1")
	}
	type setup struct {
		name   string
		motion int
		ack    bool
	}
	for _, s := range []setup{{"before (lossless, no ack)", 0, false}, {"after (motion + ack)", 16, true}} {
		t.Run(s.name, func(t *testing.T) {
			saved, savedMotion := openCapture, motionTiles
			defer func() { openCapture, motionTiles = saved, savedMotion }()
			d := newScrollingDesktop(1920, 1080)
			openCapture = d.open
			motionTiles = s.motion
			// 30 Mbps each way, 40 ms round trip, 2 MB of buffering.
			up, down := newShapedLink(30, 20*time.Millisecond, 2<<20), newShapedLink(30, 20*time.Millisecond, 2<<20)
			host := protocol.NewConn(shapedConn{in: down, out: up})
			viewer := protocol.NewConn(shapedConn{in: up, out: down})
			host.EnableInterleaving()
			viewer.EnableInterleaving()
			e, err := New(t.TempDir(), false)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
			defer cancel()
			features := transportFeatures{Tiles: true, Ack: s.ack}
			go e.capture(ctx, host, features)
			go func() {
				for {
					m, err := host.ReadMessage()
					if err != nil {
						return
					}
					if m.Method == "frame_ack" {
						e.mu.Lock()
						flight := e.flight
						e.mu.Unlock()
						flight.ack(m.ID)
					}
				}
			}()
			var ages []time.Duration
			updates, bytes := 0, 0
			go func() { <-ctx.Done(); up.close(); down.close() }()
			warm := time.Now().Add(time.Second)
			for {
				m, err := viewer.ReadMessage()
				if err != nil {
					break
				}
				if m.Method != "tiles" {
					continue
				}
				acknowledge(viewer, features, m)
				var f stream.TileFrame
				if json.Unmarshal(m.Params, &f) != nil {
					t.Fatal("tiles header")
				}
				offset := 0
				for _, tile := range f.Tiles {
					if tile.X == 0 && tile.Y == 0 && time.Now().After(warm) {
						if at, ok := d.frameOf(m.Data[offset : offset+tile.Size]); ok {
							ages = append(ages, time.Since(at))
						}
					}
					offset += tile.Size
				}
				if time.Now().After(warm) {
					updates++
					bytes += len(m.Data)
				}
			}
			if len(ages) == 0 {
				t.Fatal("no picture arrived")
			}
			sort.Slice(ages, func(i, j int) bool { return ages[i] < ages[j] })
			t.Logf("picture age P50 %v, P95 %v, max %v; %d updates in 5 s, %d KB each",
				ages[len(ages)/2].Round(time.Millisecond), ages[len(ages)*95/100].Round(time.Millisecond), ages[len(ages)-1].Round(time.Millisecond), updates, bytes/max(1, updates)/1024)
		})
	}
}
