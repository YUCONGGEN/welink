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
	// Flash both the taskbar/window icon and the notification-area icon. When
	// the window is closed to the tray the taskbar button is gone, so the tray
	// icon is the only place the user can notice unread messages.
	user32.NewProc("SendMessageW").Call(h.hwnd, 0x80, 0, icon)
	user32.NewProc("SendMessageW").Call(h.hwnd, 0x80, 1, icon)
	h.refreshTray(icon)
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
