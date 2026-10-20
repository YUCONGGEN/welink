//go:build windows

package main

import (
	_ "embed"
	"unsafe"
)

//go:embed resources/unread.png
var unreadIconPNG []byte

const unreadTimer = 0x4c4d

func (h *windowsHost) unreadPulse() {
	if h.desktop.unread == 0 || h.desktop.closing {
		return
	}
	if h.desktop.greenIcon == 0 {
		icon, _, _ := user32.NewProc("CreateIconFromResourceEx").Call(uintptr(unsafe.Pointer(&unreadIconPNG[0])), uintptr(len(unreadIconPNG)), 1, 0x30000, 32, 32, 0)
		h.desktop.greenIcon = icon
	}
	h.desktop.greenPhase = !h.desktop.greenPhase
	icon := h.desktop.normalIcon
	if h.desktop.greenPhase && h.desktop.greenIcon != 0 {
		icon = h.desktop.greenIcon
	}
	h.setUnreadIcon(icon)
}
func (h *windowsHost) setUnreadIcon(icon uintptr) {
	if icon == 0 {
		return
	}
	h.desktop.icon.Icon = icon
	// WM_SETICON changes the actual taskbar icon as well as the window icon.
	user32.NewProc("SendMessageW").Call(h.hwnd, 0x80, 0, icon)
	user32.NewProc("SendMessageW").Call(h.hwnd, 0x80, 1, icon)
	if h.desktop.trayAvailable {
		d := h.desktop.icon
		d.Flags = 2
		shellNotify.Call(1, uintptr(unsafe.Pointer(&d)))
	}
}
func (h *windowsHost) stopUnreadPulse() {
	user32.NewProc("KillTimer").Call(h.hwnd, unreadTimer)
	h.desktop.greenPhase = false
	h.setUnreadIcon(h.desktop.normalIcon)
}
func (h *windowsHost) destroyUnreadIcon() {
	h.stopUnreadPulse()
	if h.desktop.greenIcon != 0 {
		user32.NewProc("DestroyIcon").Call(h.desktop.greenIcon)
		h.desktop.greenIcon = 0
	}
}
