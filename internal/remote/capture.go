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
	"welink/internal/yudesk/stream"
)

// remoteFrame is one encoded picture update waiting to be sent: either a
// whole JPEG ("frame", understood by every LinkMe version) or a set of
// changed tiles ("tiles", only when both sides negotiated it).
type remoteFrame struct {
	method        string
	id            string // echoed by the viewer as frame_ack when negotiated
	params        []byte
	data          []byte
	width, height int
}

// Whole-JPEG frames are refreshed at least this often even when nothing
// changed, so a viewer that missed or failed to decode an image recovers.
// Tile viewers keep every tile in their hub and need no refresh.
const idleRefresh = time.Second

// After remote input the screen is checked far more often than the steady
// rate, as in YuDesk: 120 Hz for the first 100 ms, so the first repaint of a
// click or key is picked up within a few milliseconds, then 60 Hz for the
// rest of a second to follow menus, scrolling and drags. The DXGI grab only
// returns when the desktop was presented, so a fast rate costs nothing idle.
const (
	inputRush          = 100 * time.Millisecond
	inputRushInterval  = time.Second / 120
	inputBurst         = time.Second
	inputBurstInterval = time.Second / 60
)

// An update that changes more than motionTiles 128 px tiles (about two
// screen-widths of text lines, a scroll, a dragged window, video) sends its
// true-color tiles as JPEG at motionQuality: a few hundred KB instead of
// several MB of PNG, encoded several times faster. Text and flat UI tiles
// stay exact PNG. Those JPEG tiles become exact PNG again once they have been
// still for refineDelay, refineTiles at a time, only while nothing else is in
// flight, so a still picture is pixel-exact and refining never delays input.
var motionTiles = 16 // a variable so the latency test can compare without it

const (
	motionQuality = 85
	refineDelay   = 150 * time.Millisecond
	refineTiles   = 16
)

// capture runs grab+encode on this goroutine and the network write on
// another. On Windows the grab is a DXGI duplication that blocks until the
// desktop is presented again, so an idle desktop costs nothing.
//
// With tiles (ported from YuDesk) only the 128 px tiles that changed are
// encoded: text/UI losslessly as PNG, photos as JPEG. Typing becomes a few
// KB instead of a 100 KB full JPEG. Tile updates are deltas, so they are
// never dropped: capture waits for the sender instead. With a viewer that
// acknowledges updates, capture also waits for the flight window, so at most
// a couple of updates are ever on the way. Whole JPEG frames are
// replaceable, so for older peers a one-slot mailbox keeps only the newest.
// openCapture is replaced by the latency test with a synthetic desktop.
var openCapture = desktop.OpenCapture

func (e *Engine) capture(ctx context.Context, pc *protocol.Conn, features transportFeatures) {
	tiles := features.Tiles
	var flight *flightWindow
	if features.Ack {
		flight = newFlightWindow()
	}
	e.mu.Lock()
	e.flight = flight
	e.mu.Unlock()
	controller := e.performance.controller()
	// Never shrink the picture: the viewer rebuilds the desktop pixel for
	// pixel, and a slow network costs frames, not sharpness.
	controller.SetLimits(e.performance.Quality, e.performance.captureWidth(), e.performance.Quality, 1<<16)
	budget := e.performance.interval()
	mailbox := make(chan remoteFrame, 1)
	var writeCost atomic.Int64
	go e.sendFrames(ctx, pc, mailbox, &writeCost)

	grab, closeGrab := openCapture(ctx)
	defer closeGrab()
	sleep := func(d time.Duration) bool {
		if d <= 0 {
			return ctx.Err() == nil
		}
		t := time.NewTimer(d)
		defer t.Stop()
		select {
		case <-ctx.Done():
			return false
		case <-t.C:
			return true
		}
	}
	encoder := &stream.TileEncoder{GridSize: 128, Lossless: true, Motion: motionTiles, MotionQuality: motionQuality, RefineDelay: refineDelay}
	forceReset := true
	var previous, spare *image.RGBA
	var lastQueued, lastStart time.Time
	var lastFrame remoteFrame
	lastQuality, lastWidth := -1, -1
	queue := func(frame remoteFrame) bool {
		frame.id = flight.add(len(frame.data))
		if frame.method == "tiles" {
			select {
			case mailbox <- frame:
			case <-ctx.Done():
				return false
			}
		} else {
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
		}
		lastQueued = time.Now()
		return true
	}
	for {
		interval := budget
		sinceInput := time.Since(time.Unix(0, e.lastInput.Load()))
		if sinceInput < inputRush {
			interval = min(budget, inputRushInterval)
		} else if sinceInput < inputBurst {
			interval = min(budget, inputBurstInterval)
		}
		if !sleep(interval - time.Since(lastStart)) {
			return
		}
		// Grab only when the link can carry the update now, so the picture
		// that arrives is the current desktop rather than a queued old one.
		if !flight.wait(ctx) {
			return
		}
		lastStart = time.Now()
		wait := time.Second
		if !tiles {
			wait = max(16*time.Millisecond, min(time.Second, time.Until(lastQueued.Add(idleRefresh))))
		} else if due, pending := encoder.RefineDue(lastStart); pending {
			if due <= 0 && flight.idle() && sinceInput > inputRush {
				f, data, err := encoder.Refine(lastStart, refineTiles)
				if err == nil && len(f.Tiles) > 0 {
					params, _ := json.Marshal(f)
					if !queue(remoteFrame{method: "tiles", params: params, data: data, width: f.Width, height: f.Height}) {
						return
					}
					continue
				}
			}
			wait = min(wait, max(due, 10*time.Millisecond))
		}
		shot, err := grab(desktop.CaptureOptions{Quality: controller.Quality, MaxWidth: controller.Width, Raw: true, Buffer: spare, WaitChange: wait})
		if err != nil {
			e.mu.Lock()
			e.state.Error = err.Error()
			e.mu.Unlock()
			if !sleep(budget) {
				return
			}
			continue
		}
		if shot.Unchanged {
			// Event-driven backend: nothing was presented while waiting.
			if !tiles && time.Since(lastQueued) >= idleRefresh && len(lastFrame.data) > 0 && !queue(lastFrame) {
				return
			}
			continue
		}
		started := time.Now().Add(-(time.Since(lastStart) - shot.Waited))
		e.mu.Lock()
		e.sourceWidth = shot.SourceWidth
		e.sourceHeight = shot.SourceHeight
		e.state.Error = ""
		e.mu.Unlock()

		frame := remoteFrame{method: "frame", data: shot.JPEG, width: shot.Width, height: shot.Height}
		if pixels := shot.Pixels; pixels != nil && tiles {
			f, data, err := encoder.Encode(pixels, controller.Quality, forceReset)
			if err != nil {
				continue
			}
			previous, spare = pixels, previous // the encoder now references pixels
			if len(f.Tiles) == 0 {
				continue // identical desktop
			}
			forceReset = false
			f.SourceWidth, f.SourceHeight = shot.SourceWidth, shot.SourceHeight
			frame.method, frame.data = "tiles", data
			frame.params, _ = json.Marshal(f)
		} else if pixels != nil {
			settingsChanged := controller.Quality != lastQuality || controller.Width != lastWidth
			if !settingsChanged && previous != nil && previous.Rect == pixels.Rect && bytes.Equal(previous.Pix, pixels.Pix) && time.Since(lastQueued) < idleRefresh {
				spare = pixels // unchanged desktop: reuse the buffer, send nothing
				continue
			}
			var encoded bytes.Buffer
			if err := jpeg.Encode(&encoded, pixels, &jpeg.Options{Quality: controller.Quality}); err != nil {
				continue
			}
			frame.data = encoded.Bytes()
			previous, spare = pixels, previous
		} else if tiles {
			// A backend returned JPEG only: the viewer resets its picture, so
			// the next tile update must be a full keyframe again.
			forceReset = true
		}
		if len(frame.data) == 0 {
			continue
		}
		if frame.params == nil {
			frame.params, _ = json.Marshal(map[string]int{"width": frame.width, "height": frame.height})
		}
		lastQuality, lastWidth = controller.Quality, controller.Width
		if frame.method == "frame" {
			lastFrame = frame
		}
		if !queue(frame) {
			return
		}

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
		if pc.WriteMessageContext(ctx, protocol.Message{Kind: "event", Method: frame.method, ID: frame.id, Params: frame.params, Data: frame.data}) != nil {
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
