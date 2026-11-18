package remote

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"

	"welink/internal/yudesk/protocol"
	"welink/internal/yudesk/stream"
)

// tileHub is the viewer-side picture cache, ported from YuDesk
// internal/viewerapp/tiles.go. It keeps the newest version of every tile with
// a revision number, so the local browser long-polls for "everything changed
// since revision N" and a slow page skips obsolete tile versions without ever
// losing an update elsewhere on the screen.
type cachedTile struct {
	tile     stream.Tile
	data     []byte
	revision uint64
}

type tileHub struct {
	mu                sync.Mutex
	frame             stream.TileFrame
	tiles             map[[2]int]cachedTile
	revision, resetAt uint64
	bytes             int
	changed           chan struct{}
}

func newTileHub() *tileHub {
	return &tileHub{tiles: map[[2]int]cachedTile{}, changed: make(chan struct{})}
}

// publish stores a tile frame. legacy frames are whole JPEG images from peers
// without tile support (or the Android host), wrapped as one reset tile.
func (h *tileHub) publish(f stream.TileFrame, data []byte, legacy bool) error {
	if err := f.Validate(data); err != nil {
		return err
	}
	if !legacy {
		grid := f.GridSize()
		for _, t := range f.Tiles {
			if t.X%grid != 0 || t.Y%grid != 0 || t.Width != min(grid, f.Width-t.X) || t.Height != min(grid, f.Height-t.Y) {
				return errors.New("invalid tile grid")
			}
		}
		if f.Reset && len(f.Tiles) != ((f.Width+grid-1)/grid)*((f.Height+grid-1)/grid) {
			return errors.New("incomplete keyframe")
		}
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if !f.Reset && (h.revision == 0 || f.GridSize() != h.frame.GridSize() || f.Width != h.frame.Width || f.Height != h.frame.Height) {
		return errors.New("missing tile keyframe")
	}
	retained := h.bytes
	if f.Reset {
		retained = 0
	}
	for _, t := range f.Tiles {
		if !f.Reset {
			retained -= len(h.tiles[[2]int{t.X, t.Y}].data)
		}
		retained += t.Size
	}
	if retained > protocol.MaxDataSize {
		return errors.New("tile cache exceeds frame payload limit")
	}
	h.bytes = retained
	h.revision++
	if f.Reset {
		clear(h.tiles)
		h.resetAt = h.revision
	}
	h.frame = f
	h.frame.Tiles = nil
	offset := 0
	for _, t := range f.Tiles {
		h.tiles[[2]int{t.X, t.Y}] = cachedTile{tile: t, data: append([]byte(nil), data[offset:offset+t.Size]...), revision: h.revision}
		offset += t.Size
	}
	close(h.changed)
	h.changed = make(chan struct{})
	return nil
}

// imageMIME tells PNG (Android's lossless still frame) from JPEG.
func imageMIME(data []byte) string {
	if bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")) {
		return "image/png"
	}
	return "image/jpeg"
}

// publishJPEG wraps one complete JPEG (or PNG) picture as a reset frame.
func (h *tileHub) publishJPEG(data []byte, width, height int) error {
	f := stream.TileFrame{Width: width, Height: height, SourceWidth: width, SourceHeight: height, Reset: true,
		Tiles: []stream.Tile{{X: 0, Y: 0, Width: width, Height: height, Size: len(data), MIME: imageMIME(data)}}}
	return h.publish(f, data, true)
}

// snapshot returns the union of tiles changed since after (or everything
// after a reset), the current revision and a channel closed on the next change.
func (h *tileHub) snapshot(after uint64) (stream.TileFrame, []byte, uint64, <-chan struct{}) {
	h.mu.Lock()
	f := h.frame
	f.Tiles = []stream.Tile{}
	f.Reset = after < h.resetAt
	var selected []cachedTile
	for _, t := range h.tiles {
		if t.revision > after || f.Reset {
			selected = append(selected, t)
		}
	}
	revision, changed := h.revision, h.changed
	h.mu.Unlock() // encoded tile data is immutable once published
	sort.Slice(selected, func(i, j int) bool {
		if selected[i].tile.Y == selected[j].tile.Y {
			return selected[i].tile.X < selected[j].tile.X
		}
		return selected[i].tile.Y < selected[j].tile.Y
	})
	size := 0
	for _, t := range selected {
		size += len(t.data)
	}
	data := make([]byte, 0, size)
	for _, t := range selected {
		f.Tiles = append(f.Tiles, t.tile)
		data = append(data, t.data...)
	}
	return f, data, revision, changed
}

// Wait blocks until the hub has a revision newer than after, or timeout/ctx
// ends. It returns the binary body for the local browser (big-endian JSON
// length + payload length, JSON, concatenated tile bytes), or nil when there
// is nothing new.
func (h *tileHub) Wait(ctx context.Context, after uint64, timeout time.Duration) []byte {
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	for {
		f, data, next, changed := h.snapshot(after)
		if next < after {
			after = 0 // the hub restarted (new session): resend everything
			continue
		}
		if next == after {
			select {
			case <-ctx.Done():
				return nil
			case <-deadline.C:
				return nil
			case <-changed:
				continue
			}
		}
		f.Revision = next
		header, err := json.Marshal(f)
		if err != nil {
			return nil
		}
		body := make([]byte, 8, 8+len(header)+len(data))
		binary.BigEndian.PutUint32(body[:4], uint32(len(header)))
		binary.BigEndian.PutUint32(body[4:], uint32(len(data)))
		body = append(body, header...)
		return append(body, data...)
	}
}
