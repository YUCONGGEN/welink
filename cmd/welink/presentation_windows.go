//go:build windows

package main

import (
	"errors"
	"golang.org/x/sys/windows"
	"syscall"
	"unsafe"
)

type windowPlacement struct {
	Length, Flags, Show uint32
	Min, Max            [2]int32
	Normal              noticeRect
}
type windowPresentation struct {
	full      bool
	style     uintptr
	placement windowPlacement
}
type monitorBounds struct {
	Size          uint32
	Monitor, Work noticeRect
	Flags         uint32
}

func (h *windowsHost) monitorBounds() monitorBounds {
	m, _, _ := user32.NewProc("MonitorFromWindow").Call(h.hwnd, 2)
	info := monitorBounds{}
	info.Size = uint32(unsafe.Sizeof(info))
	user32.NewProc("GetMonitorInfoW").Call(m, uintptr(unsafe.Pointer(&info)))
	return info
}

func (h *windowsHost) meetingFullscreen(enabled bool) error {
	if enabled == h.presentation.full {
		return nil
	}
	index := int32(-16)
	if enabled {
		bounds := h.monitorBounds().Monitor
		if bounds.Right <= bounds.Left || bounds.Bottom <= bounds.Top {
			return errors.New("无法读取显示器尺寸")
		}
		p := windowPlacement{}
		p.Length = uint32(unsafe.Sizeof(p))
		ok, _, _ := user32.NewProc("GetWindowPlacement").Call(h.hwnd, uintptr(unsafe.Pointer(&p)))
		if ok == 0 {
			return errors.New("无法保存窗口位置")
		}
		style, _, _ := user32.NewProc("GetWindowLongW").Call(h.hwnd, uintptr(index))
		h.presentation = windowPresentation{full: true, style: style, placement: p}
		user32.NewProc("SetWindowLongW").Call(h.hwnd, uintptr(index), style&^uintptr(0x00c40000))
		user32.NewProc("ShowWindow").Call(h.hwnd, 9)
		ok, _, _ = user32.NewProc("SetWindowPos").Call(h.hwnd, 0, uintptr(bounds.Left), uintptr(bounds.Top), uintptr(bounds.Right-bounds.Left), uintptr(bounds.Bottom-bounds.Top), 0x0024)
		if ok == 0 {
			_ = h.meetingFullscreen(false)
			return errors.New("无法进入全屏")
		}
	} else {
		saved := h.presentation
		h.presentation.full = false
		user32.NewProc("SetWindowLongW").Call(h.hwnd, uintptr(index), saved.style)
		user32.NewProc("SetWindowPlacement").Call(h.hwnd, uintptr(unsafe.Pointer(&saved.placement)))
		user32.NewProc("SetWindowPos").Call(h.hwnd, 0, 0, 0, 0, 0, 0x0037)
	}
	return nil
}

// Let the web client paint the complete frame; otherwise Windows leaves a
// light non-client strip above a captionless, resizable window.
func (h *windowsHost) clientFrame(wp, lp uintptr) bool {
	if wp == 0 || lp == 0 {
		return false
	}
	zoom, _, _ := user32.NewProc("IsZoomed").Call(h.hwnd)
	if zoom != 0 && !h.presentation.full {
		bounds := h.monitorBounds().Work
		if bounds.Right > bounds.Left {
			return windows.WriteProcessMemory(windows.CurrentProcess(), lp, (*byte)(unsafe.Pointer(&bounds)), unsafe.Sizeof(bounds), nil) == nil
		}
	}
	return true
}
func (h *windowsHost) frameHit(lp uintptr) uintptr {
	zoom, _, _ := user32.NewProc("IsZoomed").Call(h.hwnd)
	if zoom != 0 || h.presentation.full {
		return 0
	}
	var r noticeRect
	user32.NewProc("GetWindowRect").Call(h.hwnd, uintptr(unsafe.Pointer(&r)))
	x, y := int32(int16(lp&0xffff)), int32(int16((lp>>16)&0xffff))
	dpi, _, _ := user32.NewProc("GetDpiForWindow").Call(h.hwnd)
	if dpi == 0 {
		dpi = 96
	}
	edge := int32(6 * dpi / 96)
	left, right, top, bottom := x < r.Left+edge, x >= r.Right-edge, y < r.Top+edge, y >= r.Bottom-edge
	switch {
	case top && left:
		return 13
	case top && right:
		return 14
	case bottom && left:
		return 16
	case bottom && right:
		return 17
	case left:
		return 10
	case right:
		return 11
	case top:
		return 12
	case bottom:
		return 15
	}
	return 0
}
func (h *windowsHost) theme(dark bool) {
	var enabled int32
	if dark {
		enabled = 1
	}
	proc := syscall.NewLazyDLL("dwmapi.dll").NewProc("DwmSetWindowAttribute")
	proc.Call(h.hwnd, 20, uintptr(unsafe.Pointer(&enabled)), 4)
	color := uint32(0xffffffff)
	if dark {
		color = 0x002b2522
	}
	proc.Call(h.hwnd, 34, uintptr(unsafe.Pointer(&color)), 4)
}
