//go:build windows

package main

import (
	"image"
	"os"
	"runtime"
	"syscall"
	"testing"
	"unsafe"
)

// Exercise the production GDI path against our own painted window. Only compare
// its client pixels; never save or publish other windows from the desktop frame.
func TestNativeScreenshotRealPixels(t *testing.T) {
	if os.Getenv("WELINK_NATIVE_DESKTOP_TEST") != "1" {
		t.Skip("opt-in real desktop capture of a controlled test window")
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	user32.NewProc("SetThreadDpiAwarenessContext").Call(^uintptr(3))
	class, _ := syscall.UTF16PtrFromString("STATIC")
	hwnd, _, err := user32.NewProc("CreateWindowExW").Call(0x88, uintptr(unsafe.Pointer(class)), 0, 0x80000000, 80, 80, 385, 257, 0, 0, 0, 0)
	if hwnd == 0 {
		t.Fatal(err)
	}
	defer user32.NewProc("DestroyWindow").Call(hwnd)
	user32.NewProc("ShowWindow").Call(hwnd, 4)
	user32.NewProc("UpdateWindow").Call(hwnd)
	dc, _, _ := user32.NewProc("GetDC").Call(hwnd)
	defer user32.NewProc("ReleaseDC").Call(hwnd, dc)
	colors := []uintptr{0x2020e0, 0x20c020, 0xe02020, 0xffffff, 0x303030}
	for round := 0; round < 3; round++ {
		for y := 0; y < 257; y += 17 {
			for x := 0; x < 385; x += 19 {
				color := colors[(x/19+y/17+round)%len(colors)]
				brush, _, _ := screenshotGDI.NewProc("CreateSolidBrush").Call(color)
				r := noticeRect{int32(x), int32(y), int32(min(x+19, 385)), int32(min(y+17, 257))}
				user32.NewProc("FillRect").Call(dc, uintptr(unsafe.Pointer(&r)), brush)
				screenshotGDI.NewProc("DeleteObject").Call(brush)
			}
		}
		screenshotGDI.NewProc("GdiFlush").Call()
		syscall.NewLazyDLL("dwmapi.dll").NewProc("DwmFlush").Call()
		frame, err := captureScreenshotFrame()
		if err != nil {
			t.Fatal(err)
		}
		var origin struct{ X, Y int32 }
		user32.NewProc("ClientToScreen").Call(hwnd, uintptr(unsafe.Pointer(&origin)))
		for y := 3; y < 254; y++ {
			for x := 3; x < 382; x++ {
				at := ((int(origin.Y)+y-frame.bounds.Min.Y)*frame.bounds.Dx() + int(origin.X) + x - frame.bounds.Min.X) * 4
				want := colors[(x/19+y/17+round)%len(colors)]
				p := frame.pixels[at : at+4]
				got := uintptr(p[2]) | uintptr(p[1])<<8 | uintptr(p[0])<<16
				if got != want || p[3] != 255 {
					t.Fatalf("capture round %d pixel %d,%d: %#06x, want %#06x", round, x, y, got, want)
				}
			}
		}
		crop := image.Rect(int(origin.X)-frame.bounds.Min.X, int(origin.Y)-frame.bounds.Min.Y, int(origin.X)+385-frame.bounds.Min.X, int(origin.Y)+257-frame.bounds.Min.Y)
		if _, err := frame.encode(crop); err != nil {
			t.Fatal(err)
		}
	}
}
