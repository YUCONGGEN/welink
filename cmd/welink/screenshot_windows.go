//go:build windows

package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"runtime"
	"syscall"
	"time"
	"unsafe"
)

const screenshotPixelLimit = 32 * 1024 * 1024
const screenshotEncodedLimit = 24 * 1024 * 1024

var screenshotGDI = syscall.NewLazyDLL("gdi32.dll")
var screenshotKernel = syscall.NewLazyDLL("kernel32.dll")
var screenshotClipboardAccess = screenshotDesktopAvailable // Replaced only in an isolated-window-station test.

type screenshotHeader struct {
	Size                   uint32
	Width, Height          int32
	Planes, BitCount       uint16
	Compression, SizeImage uint32
	XPels, YPels           int32
	Colors, Important      uint32
}

type screenshotFrame struct {
	bounds image.Rectangle
	pixels []byte // top-down BGRA, with an owned backing buffer
}

func screenshotDesktopAvailable() error {
	input, _, err := user32.NewProc("OpenInputDesktop").Call(0, 0, 1)
	if input == 0 {
		return fmt.Errorf("当前桌面暂时无法截图：%w", err)
	}
	defer user32.NewProc("CloseDesktop").Call(input)
	tid, _, _ := screenshotKernel.NewProc("GetCurrentThreadId").Call()
	current, _, _ := user32.NewProc("GetThreadDesktop").Call(tid)
	name := func(handle uintptr) string {
		var buffer [256]uint16
		var needed uint32
		ok, _, _ := user32.NewProc("GetUserObjectInformationW").Call(handle, 2, uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)*2), uintptr(unsafe.Pointer(&needed)))
		if ok == 0 {
			return ""
		}
		return syscall.UTF16ToString(buffer[:])
	}
	if name(input) != "Default" || name(current) != "Default" {
		return errors.New("请返回已解锁的桌面后再截图")
	}
	return nil
}

var captureScreenshotFrame = func() (*screenshotFrame, error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err := screenshotDesktopAvailable(); err != nil {
		return nil, err
	}
	metric := func(id uintptr) int {
		value, _, _ := user32.NewProc("GetSystemMetrics").Call(id)
		return int(int32(value))
	}
	x, y, width, height := metric(76), metric(77), metric(78), metric(79)
	if width < 1 || height < 1 || width > 32767 || height > 32767 || int64(width)*int64(height) > screenshotPixelLimit {
		return nil, errors.New("桌面尺寸过大，暂时无法截图")
	}
	dc, _, _ := user32.NewProc("GetDC").Call(0)
	if dc == 0 {
		return nil, errors.New("无法读取桌面画面")
	}
	defer user32.NewProc("ReleaseDC").Call(0, dc)
	memory, _, _ := screenshotGDI.NewProc("CreateCompatibleDC").Call(dc)
	if memory == 0 {
		return nil, errors.New("无法创建截图缓冲区")
	}
	defer screenshotGDI.NewProc("DeleteDC").Call(memory)
	header := screenshotHeader{Size: 40, Width: int32(width), Height: -int32(height), Planes: 1, BitCount: 32}
	var address unsafe.Pointer
	bitmap, _, _ := screenshotGDI.NewProc("CreateDIBSection").Call(dc, uintptr(unsafe.Pointer(&header)), 0, uintptr(unsafe.Pointer(&address)), 0, 0)
	if bitmap == 0 || address == nil {
		return nil, errors.New("无法分配截图内存")
	}
	defer screenshotGDI.NewProc("DeleteObject").Call(bitmap)
	old, _, _ := screenshotGDI.NewProc("SelectObject").Call(memory, bitmap)
	if old == 0 || old == ^uintptr(0) {
		return nil, errors.New("无法创建截图画布")
	}
	defer screenshotGDI.NewProc("SelectObject").Call(memory, old)
	ok, _, _ := screenshotGDI.NewProc("BitBlt").Call(memory, 0, 0, uintptr(width), uintptr(height), dc, uintptr(x), uintptr(y), 0x40cc0020)
	if ok == 0 {
		return nil, errors.New("读取桌面画面失败")
	}
	pixels := append([]byte(nil), unsafe.Slice((*byte)(address), width*height*4)...)
	for at := 3; at < len(pixels); at += 4 {
		pixels[at] = 255
	}
	return &screenshotFrame{bounds: image.Rect(x, y, x+width, y+height), pixels: pixels}, nil
}

func (f *screenshotFrame) encode(rect image.Rectangle) (string, error) {
	width, height := f.bounds.Dx(), f.bounds.Dy()
	if len(f.pixels) != width*height*4 || rect.Empty() || !rect.In(image.Rect(0, 0, width, height)) {
		return "", errors.New("截图选区无效")
	}
	img := image.NewRGBA(image.Rect(0, 0, rect.Dx(), rect.Dy()))
	for y := 0; y < rect.Dy(); y++ {
		for x := 0; x < rect.Dx(); x++ {
			source := ((rect.Min.Y+y)*width + rect.Min.X + x) * 4
			target := y*img.Stride + x*4
			img.Pix[target], img.Pix[target+1], img.Pix[target+2], img.Pix[target+3] = f.pixels[source+2], f.pixels[source+1], f.pixels[source], 255
		}
	}
	var output bytes.Buffer
	if err := png.Encode(&output, img); err != nil {
		return "", err
	}
	if output.Len() > screenshotEncodedLimit {
		return "", errors.New("截图过大，请缩小选区后重试")
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(output.Bytes()), nil
}

func (h *windowsHost) screenshotEvent(name string, value any) {
	if h.desktop.closing {
		return
	}
	encoded, _ := json.Marshal(value)
	h.view.Eval("window.dispatchEvent(new CustomEvent('" + name + "',{detail:" + string(encoded) + "}));")
}

func (h *windowsHost) dispatchScreenshot(work func()) {
	select {
	case <-h.desktop.done:
		return
	default:
	}
	h.view.Dispatch(func() {
		select {
		case <-h.desktop.done:
			return
		default:
			work()
		}
	})
}

func (h *windowsHost) beginScreenshot() {
	if h.desktop.closing || h.desktop.capturePending || h.desktop.capture != nil {
		return
	}
	h.desktop.capturePending = true
	h.desktop.captureVersion++
	version := h.desktop.captureVersion
	if h.desktop.captureCancel != nil {
		close(h.desktop.captureCancel)
	}
	cancel := make(chan struct{})
	h.desktop.captureCancel = cancel
	wasHidden := h.desktop.hidden
	h.desktop.captureWasHidden = wasHidden
	_ = h.view.SetVisible(false)
	user32.NewProc("ShowWindow").Call(h.hwnd, 0)
	h.visibility(true)
	go func() {
		timer := time.NewTimer(160 * time.Millisecond)
		defer timer.Stop()
		select {
		case <-h.desktop.done:
			return
		case <-cancel:
			return
		case <-timer.C:
		}
		frame, err := captureScreenshotFrame()
		h.dispatchScreenshot(func() {
			if version != h.desktop.captureVersion {
				return
			}
			if err == nil {
				err = h.openScreenshotSelection(frame, wasHidden)
			}
			if err != nil {
				h.desktop.capturePending = false
				h.showWindow()
				h.screenshotEvent("welink-screenshot-result", map[string]any{"error": err.Error()})
			}
		})
	}()
}

func (h *windowsHost) cancelScreenshot() {
	wasPending := h.desktop.capturePending
	h.desktop.captureVersion++
	h.desktop.capturePending = false
	if h.desktop.captureCancel != nil {
		close(h.desktop.captureCancel)
		h.desktop.captureCancel = nil
	}
	if h.desktop.capture != nil {
		h.desktop.capture.finish(false)
	} else if wasPending && !h.desktop.captureWasHidden {
		h.showWindow()
	}
}

func copyScreenshot(encoded string) error {
	const prefix = "data:image/png;base64,"
	if len(encoded) < len(prefix) || encoded[:len(prefix)] != prefix || len(encoded) > screenshotEncodedLimit*4/3+len(prefix)+4 {
		return errors.New("无效的截图内容")
	}
	raw, err := base64.StdEncoding.DecodeString(encoded[len(prefix):])
	if err != nil {
		return errors.New("无法读取截图")
	}
	config, err := png.DecodeConfig(bytes.NewReader(raw))
	if err != nil || config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > screenshotPixelLimit {
		return errors.New("截图尺寸无效")
	}
	img, err := png.Decode(bytes.NewReader(raw))
	if err != nil {
		return errors.New("无法解码截图")
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err = screenshotClipboardAccess(); err != nil {
		return err
	}
	size := 40 + config.Width*config.Height*4
	memory, _, _ := screenshotKernel.NewProc("GlobalAlloc").Call(0x42, uintptr(size))
	if memory == 0 {
		return errors.New("无法分配剪贴板内存")
	}
	owned := true
	defer func() {
		if owned {
			screenshotKernel.NewProc("GlobalFree").Call(memory)
		}
	}()
	pointer, _, _ := screenshotKernel.NewProc("GlobalLock").Call(memory)
	if pointer == 0 {
		return errors.New("无法访问剪贴板内存")
	}
	data := unsafe.Slice((*byte)(unsafe.Pointer(pointer)), size)
	header := screenshotHeader{Size: 40, Width: int32(config.Width), Height: int32(config.Height), Planes: 1, BitCount: 32}
	copy(data[:40], unsafe.Slice((*byte)(unsafe.Pointer(&header)), 40))
	for y := 0; y < config.Height; y++ {
		for x := 0; x < config.Width; x++ {
			r, g, b, _ := img.At(x, y).RGBA()
			at := 40 + ((config.Height-1-y)*config.Width+x)*4
			data[at], data[at+1], data[at+2], data[at+3] = byte(b>>8), byte(g>>8), byte(r>>8), 255
		}
	}
	screenshotKernel.NewProc("GlobalUnlock").Call(memory)
	class, _ := syscall.UTF16PtrFromString("STATIC")
	window, _, _ := user32.NewProc("CreateWindowExW").Call(0, uintptr(unsafe.Pointer(class)), 0, 0, 0, 0, 0, 0, ^uintptr(2), 0, 0, 0)
	if window == 0 {
		return errors.New("无法创建剪贴板窗口")
	}
	defer user32.NewProc("DestroyWindow").Call(window)
	opened := false
	for attempt := 0; attempt < 10; attempt++ {
		ok, _, _ := user32.NewProc("OpenClipboard").Call(window)
		if ok != 0 {
			opened = true
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !opened {
		return errors.New("剪贴板正被占用，请稍后重试")
	}
	defer user32.NewProc("CloseClipboard").Call()
	if ok, _, _ := user32.NewProc("EmptyClipboard").Call(); ok == 0 {
		return errors.New("无法更新剪贴板")
	}
	if ok, _, _ := user32.NewProc("SetClipboardData").Call(8, memory); ok == 0 {
		return errors.New("无法复制截图")
	}
	owned = false
	return nil
}
