//go:build windows

package desktop

import (
	"context"
	"errors"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"welink/internal/yudesk/winhost"
)

// Ported from YuDesk internal/desktop/capture_session_windows.go and trimmed
// to LinkMe's primary-display capture. DXGI Desktop Duplication returns the
// image DWM already composed and wakes on the next present, instead of a
// full-screen GDI BitBlt every tick (~5 ms instead of ~45 ms at 1080p, and no
// work at all while the desktop is idle).

const (
	duplicationRetry  = 2 * time.Second
	maxChangeWaitMs   = 1000
	scanProbeInterval = time.Second
)

var errCaptureClosed = errors.New("desktop capture session closed")

// OpenCapture keeps one DXGI duplication for a screen stream. Protected
// desktops, the privileged worker and unsupported drivers keep the GDI path.
// LINKME_CAPTURE=gdi forces GDI for comparison or diagnosis.
func OpenCapture(context.Context) (func(CaptureOptions) (Screenshot, error), func()) {
	if winhost.IsWorker() || strings.EqualFold(os.Getenv("LINKME_CAPTURE"), "gdi") {
		return CaptureWithOptions, func() {}
	}
	s := &duplicationSession{}
	return s.capture, s.close
}

type duplicationSession struct {
	mu      sync.Mutex
	current *duplicator
	closed  bool
	retryAt time.Time
	// dark: the monitor is not refreshing, so no present can wake a wait.
	dark bool
}

func (s *duplicationSession) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	s.reset()
}

func (s *duplicationSession) reset() {
	if s.current != nil {
		s.current.close()
		s.current = nil
	}
}

func (s *duplicationSession) captureFallback(options CaptureOptions) (Screenshot, error) {
	return capturePlatform(options)
}

func (s *duplicationSession) capture(options CaptureOptions) (Screenshot, error) {
	options.Quality = min(95, max(20, options.Quality))
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return Screenshot{}, errCaptureClosed
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	// UAC and the lock screen are separate desktops: duplication reports
	// access lost there, and GDI hands the request to the desktop service.
	if interactiveDesktopAvailable() != nil || time.Now().Before(s.retryAt) {
		s.reset()
		return s.captureFallback(options)
	}
	d := s.current
	if d == nil || !d.display.Primary {
		s.reset()
		displays, err := enumerateWindowsDisplays()
		if err != nil {
			return s.captureFallback(options)
		}
		display, err := selectDisplay(displays, "")
		if err != nil {
			return s.captureFallback(options)
		}
		if d, err = newDuplicator(display); err != nil {
			s.retryAt = time.Now().Add(duplicationRetry)
			return s.captureFallback(options)
		}
		s.current = d
	}
	dark := d.monitor.dark.Load()
	if dark && !s.dark {
		d.hasFrame = false
	}
	if s.dark = dark; dark {
		return s.captureFallback(options)
	}
	wait := uint32(0)
	if options.WaitChange > 0 {
		wait = uint32((min(options.WaitChange, maxChangeWaitMs*time.Millisecond) + time.Millisecond - 1) / time.Millisecond)
	}
	started := time.Now()
	updated, err := d.acquire(wait)
	waited := time.Since(started)
	if err != nil {
		s.reset()
		// A desktop switch or mode change invalidates the duplication; it can
		// be recreated at once. Other failures retry later and use GDI meanwhile.
		var failure hresultError
		if !errors.As(err, &failure) || failure.code != dxgiErrorAccessLost {
			s.retryAt = time.Now().Add(duplicationRetry)
		}
		return s.captureFallback(options)
	}
	if !updated && options.WaitChange > 0 {
		return Screenshot{Display: d.display, SourceWidth: d.display.Width, SourceHeight: d.display.Height, EventDriven: true, Unchanged: true, Waited: waited}, nil
	}
	if !d.hasFrame {
		// DWM hands out the first duplicated image only at the next present.
		// A static desktop is read once through GDI; the duplication still
		// wakes the stream for every later change.
		shot, err := s.captureFallback(options)
		shot.EventDriven, shot.Waited = err == nil, waited
		return shot, err
	}
	// Never publish pixels with a stale geometry after a hotplug, primary
	// change or scaling change: input mapping depends on it.
	current, err := enumerateWindowsDisplays()
	if err != nil {
		return Screenshot{}, err
	}
	if still, err := selectDisplay(current, ""); err != nil || still != d.display {
		s.reset()
		return s.captureFallback(options)
	}
	sourceW, sourceH := d.display.Width, d.display.Height
	w, h := sourceW, sourceH
	if options.MaxWidth > 0 && w > options.MaxWidth {
		w = options.MaxWidth
		h = max(1, sourceH*w/sourceW)
	}
	pixels := reusableCaptureBuffer(options.Buffer, w, h)
	if err := d.read(pixels); err != nil {
		s.reset()
		s.retryAt = time.Now().Add(duplicationRetry)
		return s.captureFallback(options)
	}
	shot := Screenshot{Pixels: pixels, Width: w, Height: h, SourceWidth: sourceW, SourceHeight: sourceH, Display: d.display, EventDriven: true, Waited: waited}
	if options.Raw {
		return shot, nil
	}
	options.MaxWidth = 0
	encoded, err := encodeScreen(pixels, options)
	encoded.SourceWidth, encoded.SourceHeight, encoded.Display = sourceW, sourceH, d.display
	encoded.EventDriven, encoded.Waited = true, waited
	return encoded, err
}
