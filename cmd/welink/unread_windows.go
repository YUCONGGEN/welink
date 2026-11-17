//go:build windows

package main

import (
	"bytes"
	"image/png"
	"unsafe"
)

const (
	unreadTimer    = 0x4c4d
	breathInterval = 90 // ms per frame; one breath ≈ 1.8 s
)

// needsAttention: the user is not looking at LinkMe — the window is
// minimised, closed to the tray, or another window is in front.
func (h *windowsHost) needsAttention() bool {
	if h.desktop.hidden {
		return true
	}
	if minimized, _, _ := user32.NewProc("IsIconic").Call(h.hwnd); minimized != 0 {
		return true
	}
	if visible, _, _ := user32.NewProc("IsWindowVisible").Call(h.hwnd); visible == 0 {
		return true
	}
	foreground, _, _ := user32.NewProc("GetForegroundWindow").Call()
	return foreground != h.hwnd
}

// unreadPulse runs on the unread timer. With unread messages and nobody
// looking, the taskbar and tray icons breathe; otherwise they stay normal.
func (h *windowsHost) unreadPulse() {
	if h.desktop.unread == 0 || h.desktop.closing {
		return
	}
	if !h.needsAttention() {
		if h.desktop.breathing {
			h.desktop.breathing = false
			h.setUnreadIcons(h.desktop.normalIcon, h.desktop.normalIcon)
		}
		return
	}
	if !h.ensureBreathFrames() {
		return
	}
	h.desktop.breathing = true
	h.desktop.breathFrame = (h.desktop.breathFrame + 1) % len(h.desktop.breathBig)
	i := h.desktop.breathFrame
	h.setUnreadIcons(h.desktop.breathBig[i], h.desktop.breathSmall[i])
}

// ensureBreathFrames renders the animation once, at the sizes Windows uses
// for this display's taskbar (SM_CXICON) and notification area (SM_CXSMICON).
func (h *windowsHost) ensureBreathFrames() bool {
	if len(h.desktop.breathBig) > 0 {
		return true
	}
	src, err := h.breathSource()
	if err != nil {
		return false
	}
	metric := func(index uintptr, fallback int) int {
		v, _, _ := user32.NewProc("GetSystemMetrics").Call(index)
		if int(v) < 16 || int(v) > 256 {
			return fallback
		}
		return int(v)
	}
	icons := func(px int) []uintptr {
		out := []uintptr{}
		for _, frame := range renderBreathFrames(src, px, breathFrameCount) {
			var buf bytes.Buffer
			if png.Encode(&buf, frame) != nil {
				break
			}
			data := buf.Bytes()
			icon, _, _ := user32.NewProc("CreateIconFromResourceEx").Call(uintptr(unsafe.Pointer(&data[0])), uintptr(len(data)), 1, 0x30000, uintptr(px), uintptr(px), 0)
			if icon == 0 {
				break
			}
			out = append(out, icon)
		}
		return out
	}
	big, small := icons(metric(11, 32)), icons(metric(49, 16)) // SM_CXICON, SM_CXSMICON
	if len(big) != breathFrameCount || len(small) != breathFrameCount {
		destroyIcons(big)
		destroyIcons(small)
		return false
	}
	h.desktop.breathBig, h.desktop.breathSmall = big, small
	return true
}

func destroyIcons(icons []uintptr) {
	for _, icon := range icons {
		user32.NewProc("DestroyIcon").Call(icon)
	}
}

// setUnreadIcons sets the taskbar/window icons and the notification-area
// icon. When the window is closed to the tray the taskbar button is gone, so
// the tray icon is the only place the user can notice unread messages.
func (h *windowsHost) setUnreadIcons(big, small uintptr) {
	if big == 0 || small == 0 {
		return
	}
	user32.NewProc("SendMessageW").Call(h.hwnd, 0x80, 1, big)   // WM_SETICON, ICON_BIG
	user32.NewProc("SendMessageW").Call(h.hwnd, 0x80, 0, small) // ICON_SMALL
	h.refreshTray(small)
}

// refreshTray updates the tray icon and tooltip in place (NIM_MODIFY).
func (h *windowsHost) refreshTray(icon uintptr) {
	if !h.desktop.trayAvailable || h.desktop.closing {
		return
	}
	d := &h.desktop.icon
	if icon != 0 {
		d.Icon = icon
	}
	h.trayTip()
	d.Flags = 0x86 // NIF_ICON | NIF_TIP | NIF_SHOWTIP
	shellNotify.Call(1, uintptr(unsafe.Pointer(d)))
	d.Flags = 0x87
}

func (h *windowsHost) startUnreadPulse() {
	h.unreadPulse()
	user32.NewProc("SetTimer").Call(h.hwnd, unreadTimer, breathInterval, 0)
}

func (h *windowsHost) stopUnreadPulse() {
	user32.NewProc("KillTimer").Call(h.hwnd, unreadTimer)
	h.desktop.breathing = false
	h.desktop.breathFrame = 0
	h.setUnreadIcons(h.desktop.normalIcon, h.desktop.normalIcon)
}

func (h *windowsHost) destroyUnreadIcon() {
	h.stopUnreadPulse()
	destroyIcons(h.desktop.breathBig)
	destroyIcons(h.desktop.breathSmall)
	h.desktop.breathBig, h.desktop.breathSmall = nil, nil
}

// flashInfo is FLASHWINFO. FLASHW_TRAY|FLASHW_TIMERNOFG highlights the
// taskbar button (like WeChat) until the window comes to the foreground; the
// breathing icon keeps animating on top of it.
type flashInfo struct {
	Size    uint32
	Window  uintptr
	Flags   uint32
	Count   uint32
	Timeout uint32
}

func (h *windowsHost) flashTaskbar(on bool) {
	info := flashInfo{Window: h.hwnd}
	if on {
		info.Flags = 0x2 | 0xC // FLASHW_TRAY | FLASHW_TIMERNOFG
	}
	info.Size = uint32(unsafe.Sizeof(info))
	user32.NewProc("FlashWindowEx").Call(uintptr(unsafe.Pointer(&info)))
}
