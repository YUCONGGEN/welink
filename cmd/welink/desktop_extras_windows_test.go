//go:build windows

package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"golang.org/x/sys/windows/registry"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
	"unsafe"
	"welink/internal/desktopconfig"
)

func TestDesktopHotkeyTransaction(t *testing.T) {
	h := newDesktopHotkeys(0)
	registered := map[uintptr]string{}
	occupied := ""
	h.register = func(id uintptr, key desktopconfig.Hotkey) error {
		if key.Name == occupied {
			return errors.New("occupied")
		}
		registered[id] = key.Name
		return nil
	}
	h.unregister = func(id uintptr) { delete(registered, id) }
	p := desktopconfig.Defaults()
	h.restore(p)
	if len(registered) != 2 {
		t.Fatal("initial registration")
	}
	oldShow := h.registered[p.ShowHotkey].id
	p.ShowHotkey = "Ctrl+Alt+X"
	p.CaptureHotkey = "Ctrl+Alt+Y"
	occupied = p.CaptureHotkey
	if _, _, err := h.prepare(p); err == nil {
		t.Fatal("occupied key accepted")
	}
	if len(registered) != 2 || h.action(oldShow) != "show" {
		t.Fatal("failed save disabled old keys")
	}
	occupied = ""
	commit, rollback, err := h.prepare(p)
	if err != nil {
		t.Fatal(err)
	}
	rollback()
	if len(registered) != 2 {
		t.Fatal("persistence failure leaked staged registration")
	}
	commit, rollback, err = h.prepare(p)
	if err != nil {
		t.Fatal(err)
	}
	commit()
	rollback()
	if len(registered) != 2 || h.action(oldShow) != "" {
		t.Fatal("commit did not replace old keys")
	}
	p.ShowHotkey, p.CaptureHotkey = p.CaptureHotkey, p.ShowHotkey
	commit, _, err = h.prepare(p)
	if err != nil {
		t.Fatal(err)
	}
	commit()
	if h.action(h.registered[p.ShowHotkey].id) != "show" {
		t.Fatal("swapping keys left old action")
	}
	p.HotkeysEnabled = false
	commit, _, err = h.prepare(p)
	if err != nil {
		t.Fatal(err)
	}
	commit()
	if len(registered) != 0 {
		t.Fatal("disabled keys still registered")
	}
	p.HotkeysEnabled = true
	occupied = p.CaptureHotkey
	h.restore(p)
	commit, _, err = h.prepare(p)
	if err != nil {
		t.Fatal("unchanged startup conflict blocked other preferences", err)
	}
	commit()
	if h.errors["capture"] == "" || len(registered) != 1 {
		t.Fatal("startup conflict was hidden")
	}
	h.close()
	if len(registered) != 0 {
		t.Fatal("closing leaked hotkeys")
	}
}

func TestDesktopStartupRegistryRollbackAndQuoting(t *testing.T) {
	command, err := startupCommand(`C:\Program Files\WeLink\WeLink-Windows.exe`, `C:\Users\名字\我的 资料`)
	if err != nil || command != `"C:\Program Files\WeLink\WeLink-Windows.exe" -data "C:\Users\名字\我的 资料" -startup` {
		t.Fatal("startup command quoting", command, err)
	}
	if _, err = startupCommand(`C:\WeLink.exe`, `C:\`+strings.Repeat("x", 260)); err == nil {
		t.Fatal("oversized Run command accepted")
	}
	if _, err = startupCommand(`C:\invalid"name.exe`, `C:\profile`); err == nil {
		t.Fatal("invalid executable accepted")
	}
	path := fmt.Sprintf(`Software\WeLink\DesktopExtrasTests\Run-%d`, time.Now().UnixNano())
	defer registry.DeleteKey(registry.CURRENT_USER, path)
	s := registryStartup(path, "TestProfile", command)
	undo, err := s.prepare(true)
	if err != nil {
		t.Fatal(err)
	}
	if !s.registered() {
		t.Fatal("startup entry missing")
	}
	if err = undo(); err != nil {
		t.Fatal(err)
	}
	if _, exists, err := s.read(); err != nil || exists {
		t.Fatal("rollback did not remove new entry", err)
	}
	if _, err = s.prepare(true); err != nil {
		t.Fatal(err)
	}
	undo, err = s.prepare(false)
	if err != nil {
		t.Fatal(err)
	}
	if s.registered() {
		t.Fatal("disable failed")
	}
	if err = undo(); err != nil {
		t.Fatal(err)
	}
	if !s.registered() {
		t.Fatal("disable rollback lost original value")
	}
}

func testScreenshotFrame(width, height int) *screenshotFrame {
	frame := &screenshotFrame{bounds: image.Rect(-100, 20, width-100, height+20), pixels: make([]byte, width*height*4)}
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			at := (y*width + x) * 4
			frame.pixels[at], frame.pixels[at+1], frame.pixels[at+2], frame.pixels[at+3] = byte(x), byte(y), 180, 255
		}
	}
	return frame
}

func TestScreenshotCropPixelsAndBounds(t *testing.T) {
	frame := testScreenshotFrame(12, 10)
	encoded, err := frame.encode(image.Rect(3, 2, 9, 7))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(encoded, "data:image/png;base64,"))
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds() != image.Rect(0, 0, 6, 5) {
		t.Fatal("crop dimensions", img.Bounds())
	}
	r, g, b, a := img.At(0, 0).RGBA()
	if r != 180*257 || g != 2*257 || b != 3*257 || a != 65535 {
		t.Fatal("BGRA crop color conversion")
	}
	for _, rect := range []image.Rectangle{{}, image.Rect(-1, 0, 3, 3), image.Rect(0, 0, 99, 3)} {
		if _, err = frame.encode(rect); err == nil {
			t.Fatal("invalid crop accepted")
		}
	}
	if err = copyScreenshot("not a PNG"); err == nil {
		t.Fatal("invalid clipboard payload accepted")
	}
}

func TestNativeScreenshotSelectionAndHotkey(t *testing.T) {
	if os.Getenv("WELINK_NATIVE_DESKTOP_TEST") != "1" {
		t.Skip("opt-in own-window tests with synthetic pixels; no desktop capture or real key injection")
	}
	directory, err := os.MkdirTemp(".local", "screenshot-native-")
	if err != nil {
		t.Fatal(err)
	}
	directory, _ = filepath.Abs(directory)
	w, err := newWindow("about:blank", directory)
	if err != nil {
		t.Fatal(err)
	}
	h := w.(*windowsHost)
	h.desktop.hotkeys.close()
	p := desktopconfig.Defaults()
	p.ShowHotkey = "Ctrl+Alt+F23"
	p.CaptureHotkey = ""
	h.desktop.hotkeys.restore(p)
	if len(h.desktop.hotkeys.errors) != 0 {
		h.Close()
		t.Fatal(h.desktop.hotkeys.errors)
	}
	result := make(chan error, 1)
	go func() {
		run := func(work func() error) error {
			done := make(chan error, 1)
			h.view.Dispatch(func() { done <- work() })
			select {
			case err := <-done:
				return err
			case <-time.After(10 * time.Second):
				return errors.New("native dispatch timed out")
			}
		}
		err := run(func() error {
			h.closeWindow()
			id := h.desktop.hotkeys.registered[p.ShowHotkey].id
			user32.NewProc("SendMessageW").Call(h.hwnd, 0x0312, id, 0)
			return nil
		})
		for attempt := 0; err == nil && attempt < 100; attempt++ {
			var ready bool
			err = run(func() error { ready = !h.desktop.hidden && h.browserVisible(); return nil })
			if ready {
				break
			}
			if attempt == 99 {
				err = errors.New("global hotkey did not restore actual window")
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
		if err == nil {
			err = run(func() error {
				h.desktop.capturePending = true
				h.desktop.captureVersion++
				if err := h.openScreenshotSelection(testScreenshotFrame(800, 450), false); err != nil {
					return err
				}
				s := h.desktop.capture
				if s == nil {
					return errors.New("selection window missing")
				}
				point := func(x, y int) uintptr { return uintptr(uint32(uint16(x)) | uint32(uint16(y))<<16) }
				user32.NewProc("SendMessageW").Call(s.window, 0x201, 1, point(50, 60))
				user32.NewProc("SendMessageW").Call(s.window, 0x200, 1, point(220, 180))
				user32.NewProc("SendMessageW").Call(s.window, 0x202, 0, point(220, 180))
				if s.selected != image.Rect(50, 60, 220, 180) {
					return fmt.Errorf("selection coordinates: %v", s.selected)
				}
				user32.NewProc("UpdateWindow").Call(s.window)
				user32.NewProc("SendMessageW").Call(s.window, 0x100, 27, 0)
				if h.desktop.capture != nil || h.desktop.capturePending || s.blackDC != 0 || s.blackBitmap != 0 || s.font != 0 {
					return errors.New("cancel did not release selection resources")
				}
				if h.desktop.hidden {
					return errors.New("cancel did not restore visible caller")
				}
				h.closeWindow()
				h.desktop.capturePending = true
				if err := h.openScreenshotSelection(testScreenshotFrame(800, 450), true); err != nil {
					return err
				}
				h.desktop.capture.finish(false)
				if !h.desktop.hidden {
					return errors.New("cancelling global screenshot should preserve hidden main window")
				}
				return nil
			})
		}
		result <- err
		h.Action("quit")
	}()
	h.Run()
	h.Close()
	if err = <-result; err != nil {
		t.Fatal(err)
	}
}

// Use a private window station: the user's real clipboard is never read or changed.
func TestScreenshotClipboardInPrivateStation(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	previous, _, _ := user32.NewProc("GetProcessWindowStation").Call()
	station, _, err := user32.NewProc("CreateWindowStationW").Call(0, 0, 0x000f037f, 0)
	if station == 0 {
		t.Fatal(err)
	}
	defer user32.NewProc("CloseWindowStation").Call(station)
	if ok, _, err := user32.NewProc("SetProcessWindowStation").Call(station); ok == 0 {
		t.Fatal(err)
	}
	defer user32.NewProc("SetProcessWindowStation").Call(previous)
	name, _ := syscall.UTF16PtrFromString("WeLinkScreenshotClipboardTest")
	desk, _, err := user32.NewProc("CreateDesktopW").Call(uintptr(unsafe.Pointer(name)), 0, 0, 0, 0x10000000, 0)
	if desk == 0 {
		t.Fatal(err)
	}
	defer user32.NewProc("CloseDesktop").Call(desk)
	tid, _, _ := screenshotKernel.NewProc("GetCurrentThreadId").Call()
	oldDesktop, _, _ := user32.NewProc("GetThreadDesktop").Call(tid)
	if ok, _, err := user32.NewProc("SetThreadDesktop").Call(desk); ok == 0 {
		t.Fatal(err)
	}
	defer user32.NewProc("SetThreadDesktop").Call(oldDesktop)
	check := screenshotClipboardAccess
	screenshotClipboardAccess = func() error { return nil }
	defer func() { screenshotClipboardAccess = check }()
	encoded, err := testScreenshotFrame(12, 10).encode(image.Rect(3, 2, 9, 7))
	if err != nil {
		t.Fatal(err)
	}
	if err = copyScreenshot(encoded); err != nil {
		t.Fatal(err)
	}
	if ok, _, _ := user32.NewProc("OpenClipboard").Call(0); ok == 0 {
		t.Fatal("private clipboard unavailable")
	}
	defer user32.NewProc("CloseClipboard").Call()
	handle, _, _ := user32.NewProc("GetClipboardData").Call(8)
	if handle == 0 {
		t.Fatal("CF_DIB image missing")
	}
	pointer, _, _ := screenshotKernel.NewProc("GlobalLock").Call(handle)
	if pointer == 0 {
		t.Fatal("private bitmap unavailable")
	}
	defer screenshotKernel.NewProc("GlobalUnlock").Call(handle)
	header := *(*screenshotHeader)(unsafe.Pointer(pointer))
	if header.Size != 40 || header.Width != 6 || header.Height != 5 || header.BitCount != 32 {
		t.Fatal("clipboard bitmap geometry", header)
	}
	pixels := unsafe.Slice((*byte)(unsafe.Pointer(pointer+40)), 6*5*4)
	if !bytes.Equal(pixels[:4], []byte{3, 6, 180, 255}) || !bytes.Equal(pixels[4*6*4:4*6*4+4], []byte{3, 2, 180, 255}) {
		t.Fatal("clipboard bitmap orientation or channel order")
	}
}

func TestNativeScreenshotCapturePipeline(t *testing.T) {
	if os.Getenv("WELINK_NATIVE_DESKTOP_TEST") != "1" {
		t.Skip("opt-in native capture pipeline with synthetic screen source")
	}
	var captured atomic.Int32
	original := captureScreenshotFrame
	captureScreenshotFrame = func() (*screenshotFrame, error) { captured.Add(1); return testScreenshotFrame(800, 450), nil }
	defer func() { captureScreenshotFrame = original }()
	directory, err := os.MkdirTemp(".local", "screenshot-flow-")
	if err != nil {
		t.Fatal(err)
	}
	directory, _ = filepath.Abs(directory)
	w, err := newWindow("about:blank", directory)
	if err != nil {
		t.Fatal(err)
	}
	h := w.(*windowsHost)
	messages := make(chan string, 8)
	h.view.Bind("testScreenshotReport", func(message string) {
		select {
		case messages <- message:
		default:
		}
	})
	script := `if(typeof window.testScreenshotReport==='function'&&!window.screenshotPipelineReady){window.screenshotPipelineReady=true;window.addEventListener('welink-screenshot-result',event=>testScreenshotReport(JSON.stringify(event.detail)));testScreenshotReport('ready')}`
	h.view.Init(script)
	h.view.Navigate("about:blank")
	h.startupWindow()
	result := make(chan error, 1)
	go func() {
		run := func(work func() error) error {
			done := make(chan error, 1)
			h.view.Dispatch(func() { done <- work() })
			select {
			case e := <-done:
				return e
			case <-time.After(10 * time.Second):
				return errors.New("native pipeline dispatch timed out")
			}
		}
		check := func() error {
			time.Sleep(300 * time.Millisecond)
			if e := run(func() error { h.view.Eval(script); return nil }); e != nil {
				return e
			}
			select {
			case value := <-messages:
				if value != "ready" {
					return errors.New("unexpected initial bridge result")
				}
			case <-time.After(10 * time.Second):
				return errors.New("native screenshot bridge not ready")
			}
			if e := run(func() error {
				if !h.desktop.hidden {
					return errors.New("startup minimization failed")
				}
				h.beginScreenshot()
				h.cancelScreenshot()
				return nil
			}); e != nil {
				return e
			}
			time.Sleep(230 * time.Millisecond)
			if captured.Load() != 0 {
				return errors.New("capture proceeded after cancellation")
			}
			if e := run(func() error { h.beginScreenshot(); return nil }); e != nil {
				return e
			}
			found := false
			for attempt := 0; attempt < 100; attempt++ {
				if e := run(func() error { found = h.desktop.capture != nil; return nil }); e != nil {
					return e
				}
				if found {
					break
				}
				time.Sleep(20 * time.Millisecond)
			}
			if !found {
				return errors.New("capture did not open native selector")
			}
			if e := run(func() error {
				s := h.desktop.capture
				s.selected = image.Rect(20, 30, 180, 90)
				user32.NewProc("SendMessageW").Call(s.window, 0x100, 13, 0)
				return nil
			}); e != nil {
				return e
			}
			var payload struct {
				Image         string `json:"image"`
				Width, Height int
				Error         string `json:"error"`
			}
			select {
			case value := <-messages:
				if e := json.Unmarshal([]byte(value), &payload); e != nil {
					return e
				}
			case <-time.After(10 * time.Second):
				return errors.New("PNG did not reach native WebView")
			}
			if payload.Error != "" || payload.Width != 160 || payload.Height != 60 {
				return fmt.Errorf("native screenshot metadata: %dx%d %s", payload.Width, payload.Height, payload.Error)
			}
			raw, e := base64.StdEncoding.DecodeString(strings.TrimPrefix(payload.Image, "data:image/png;base64,"))
			if e != nil {
				return e
			}
			config, e := png.DecodeConfig(bytes.NewReader(raw))
			if e != nil || config.Width != 160 || config.Height != 60 {
				return errors.New("native screenshot PNG geometry changed")
			}
			return run(func() error {
				if h.desktop.hidden || h.desktop.capture != nil || h.desktop.capturePending {
					return errors.New("accepted screenshot did not restore preview window and release selector")
				}
				return nil
			})
		}
		result <- check()
		h.Action("quit")
	}()
	h.Run()
	h.Close()
	if err = <-result; err != nil {
		t.Fatal(err)
	}
}
