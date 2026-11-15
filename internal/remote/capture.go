package remote

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/jpeg"
	"sync/atomic"
	"time"
	"welink/internal/yudesk/desktop"
	"welink/internal/yudesk/protocol"
)

// remoteFrame is one encoded desktop image waiting to be sent.
type remoteFrame struct {
	jpeg          []byte
	width, height int
}

// Frames are refreshed at least this often even when nothing changed, so a
// viewer that missed or failed to decode an image recovers on its own.
const idleRefresh = 2 * time.Second

// capture runs two stages in parallel: grab+encode on one goroutine and the
// (paced) network write on another. A single-slot mailbox always holds the
// newest frame, so a slow link drops stale frames instead of queueing them,
// and capture never waits for the previous write. Identical consecutive
// desktops are skipped before JPEG encoding, which saves CPU and bandwidth
// on mostly static screens and keeps the link free for real changes.
func (e *Engine) capture(ctx context.Context, pc *protocol.Conn) {
	controller := e.performance.controller()
	budget := e.performance.interval()
	mailbox := make(chan remoteFrame, 1)
	var writeCost atomic.Int64
	go e.sendFrames(ctx, pc, mailbox, &writeCost)

	t := time.NewTicker(budget)
	defer t.Stop()
	var previous, spare *image.RGBA
	var lastQueued time.Time
	lastQuality, lastWidth := -1, -1
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		started := time.Now()
		shot, err := desktop.CaptureWithOptions(desktop.CaptureOptions{Quality: controller.Quality, MaxWidth: controller.Width, Raw: true, Buffer: spare})
		if err != nil {
			e.mu.Lock()
			e.state.Error = err.Error()
			e.mu.Unlock()
			continue
		}
		e.mu.Lock()
		e.sourceWidth = shot.SourceWidth
		e.sourceHeight = shot.SourceHeight
		e.state.Error = ""
		e.mu.Unlock()

		frame := remoteFrame{jpeg: shot.JPEG, width: shot.Width, height: shot.Height}
		if pixels := shot.Pixels; pixels != nil {
			settingsChanged := controller.Quality != lastQuality || controller.Width != lastWidth
			if !settingsChanged && previous != nil && previous.Rect == pixels.Rect && bytes.Equal(previous.Pix, pixels.Pix) && time.Since(lastQueued) < idleRefresh {
				spare = pixels // unchanged desktop: reuse the buffer, send nothing
				continue
			}
			var encoded bytes.Buffer
			if err := jpeg.Encode(&encoded, pixels, &jpeg.Options{Quality: controller.Quality}); err != nil {
				continue
			}
			frame.jpeg = encoded.Bytes()
			previous, spare = pixels, previous
		}
		if len(frame.jpeg) == 0 {
			continue
		}
		lastQuality, lastWidth = controller.Quality, controller.Width
		// Latest frame wins: replace an unsent frame rather than queueing.
		select {
		case mailbox <- frame:
		default:
			select {
			case <-mailbox:
			default:
			}
			mailbox <- frame
		}
		lastQueued = time.Now()

		e.mu.Lock()
		rtt := e.state.RTT
		e.mu.Unlock()
		controller.Ack(time.Duration(rtt) * time.Millisecond)
		// The slower stage bounds the frame rate; feed that to the controller.
		cost := max(time.Since(started), time.Duration(writeCost.Load()))
		controller.Update(time.Now(), cost, budget, shot.SourceWidth)
	}
}

func (e *Engine) sendFrames(ctx context.Context, pc *protocol.Conn, mailbox <-chan remoteFrame, writeCost *atomic.Int64) {
	for {
		var frame remoteFrame
		select {
		case <-ctx.Done():
			return
		case frame = <-mailbox:
		}
		started := time.Now()
		params, _ := json.Marshal(map[string]int{"width": frame.width, "height": frame.height})
		if pc.WriteMessageContext(ctx, protocol.Message{Kind: "event", Method: "frame", Params: params, Data: frame.jpeg}) != nil {
			return
		}
		writeCost.Store(int64(time.Since(started)))
		e.mu.Lock()
		e.state.Width = frame.width
		e.state.Height = frame.height
		e.state.Frame++
		e.mu.Unlock()
	}
}
