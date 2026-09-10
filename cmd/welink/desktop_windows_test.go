//go:build windows

package main

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
	"unsafe"
)

func TestDesktopInstanceActivationAndRelease(t *testing.T) {
	dir := t.TempDir()
	first, existing, err := acquireInstance(dir)
	if err != nil || existing {
		t.Fatalf("first: %v %v", existing, err)
	}
	defer first.Close()
	_, existing, err = acquireInstance(strings.ToUpper(dir))
	if err != nil || !existing {
		t.Fatalf("duplicate: %v %v", existing, err)
	}
	activated := make(chan struct{}, 1)
	first.Watch(func() { activated <- struct{}{} })
	select {
	case <-activated:
	case <-time.After(3 * time.Second):
		t.Fatal("startup activation was lost")
	}
	other, existing, err := acquireInstance(t.TempDir())
	if err != nil || existing {
		t.Fatalf("separate profile: %v %v", existing, err)
	}
	other.Close()
	first.Close()
	again, existing, err := acquireInstance(dir)
	if err != nil || existing {
		t.Fatalf("released profile: %v %v", existing, err)
	}
	again.Close()
}

func TestNativeDesktopLifecycle(t *testing.T) {
	if os.Getenv("WELINK_NATIVE_DESKTOP_TEST") != "1" {
		t.Skip("opt-in native WebView and tray; no keyboard or mouse injection")
	}
	if err := os.MkdirAll(".local/native-desktop-tests", 0700); err != nil {
		t.Fatal(err)
	}
	directory, err := os.MkdirTemp(".local/native-desktop-tests", "run-")
	if err != nil {
		t.Fatal(err)
	}
	// The process-wide WebView loader stays mapped until this test executable exits.
	w, err := newWindow("about:blank", directory)
	if err != nil {
		t.Fatal(err)
	}
	h := w.(*windowsHost)
	registered := func() bool {
		probe := notifyIconData{Window: h.hwnd, ID: 1}
		probe.Size = uint32(unsafe.Sizeof(probe))
		result, _, _ := shellNotify.Call(1, uintptr(unsafe.Pointer(&probe)))
		return result != 0
	}
	if unsafe.Sizeof(notifyIconData{}) != 976 {
		h.Close()
		t.Fatal("unexpected 64-bit NOTIFYICONDATAW layout")
	}
	result := make(chan error, 1)
	go func() {
		invoke := func(f func() error) error {
			var last error
			deadline := time.Now().Add(4 * time.Second)
			for time.Now().Before(deadline) {
				done := make(chan error, 1)
				h.view.Dispatch(func() { done <- f() })
				select {
				case last = <-done:
					if last == nil {
						return nil
					}
				case <-time.After(5 * time.Second):
					return fmt.Errorf("native dispatch timed out")
				}
				time.Sleep(20 * time.Millisecond)
			}
			return last
		}
		check := func() error {
			if err := invoke(func() error {
				if !registered() {
					return fmt.Errorf("tray not registered")
				}
				return nil
			}); err != nil {
				return err
			}
			user32.NewProc("PostMessageW").Call(h.hwnd, 0x10, 0, 0)
			if err := invoke(func() error {
				visible, _, _ := user32.NewProc("IsWindowVisible").Call(h.hwnd)
				if visible != 0 || !registered() {
					return fmt.Errorf("close must hide window and retain tray")
				}
				h.desktop.preferences.MessageAlerts = false
				h.setUnread(3)
				if h.desktop.unread != 3 {
					return fmt.Errorf("unread count")
				}
				return nil
			}); err != nil {
				return err
			}
			user32.NewProc("PostMessageW").Call(h.hwnd, desktopTrayMessage, 0, uintptr(1<<16|0x401))
			if err := invoke(func() error {
				visible, _, _ := user32.NewProc("IsWindowVisible").Call(h.hwnd)
				if visible == 0 || h.desktop.hidden {
					return fmt.Errorf("keyboard tray activation did not restore window")
				}
				shellNotify.Call(2, uintptr(unsafe.Pointer(&h.desktop.icon)))
				return nil
			}); err != nil {
				return err
			}
			user32.NewProc("PostMessageW").Call(h.hwnd, uintptr(h.desktop.taskbarCreated), 0, 0)
			if err := invoke(func() error {
				if !registered() {
					return fmt.Errorf("tray not restored after TaskbarCreated")
				}
				shellNotify.Call(2, uintptr(unsafe.Pointer(&h.desktop.icon)))
				h.desktop.trayAvailable = false
				h.closeWindow()
				visible, _, _ := user32.NewProc("IsWindowVisible").Call(h.hwnd)
				minimized, _, _ := user32.NewProc("IsIconic").Call(h.hwnd)
				if visible == 0 || minimized == 0 {
					return fmt.Errorf("missing tray must minimize instead of hiding")
				}
				h.showWindow()
				h.addTray()
				h.desktop.preferences.CloseToTray = false
				return nil
			}); err != nil {
				return err
			}
			return nil
		}
		err := check()
		result <- err
		if err != nil {
			h.Action("quit")
		} else {
			user32.NewProc("PostMessageW").Call(h.hwnd, 0x10, 0, 0)
		}
	}()
	h.Run()
	if err = <-result; err != nil {
		t.Error(err)
	}
	if registered() {
		t.Error("exit left a registered tray icon")
	}
	h.Close()
}
