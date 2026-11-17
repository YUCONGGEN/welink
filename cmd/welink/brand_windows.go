//go:build windows

package main

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
	"strings"
	"syscall"
	"unicode/utf8"
	"unsafe"

	xdraw "golang.org/x/image/draw"
)

// The server's branding (console → 品牌与图标) reaches the window from the
// page via welinkBrand(name, base64 PNG): window title, taskbar and tray
// icons, tray tooltip, and the unread breathing animation follow it.

func (h *windowsHost) appTitle() string {
	if h.desktop.appName == "" {
		return "LinkMe"
	}
	return h.desktop.appName
}

// iconFromImage renders src at px×px into an HICON.
func iconFromImage(src image.Image, px int) uintptr {
	img := image.NewNRGBA(image.Rect(0, 0, px, px))
	xdraw.CatmullRom.Scale(img, img.Rect, src, src.Bounds(), xdraw.Over, nil)
	var buf bytes.Buffer
	if png.Encode(&buf, img) != nil {
		return 0
	}
	data := buf.Bytes()
	icon, _, _ := user32.NewProc("CreateIconFromResourceEx").Call(uintptr(unsafe.Pointer(&data[0])), uintptr(len(data)), 1, 0x30000, uintptr(px), uintptr(px), 0)
	return icon
}

func (h *windowsHost) applyBrand(name, iconBase64 string) {
	if h.desktop.closing {
		return
	}
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 24 || strings.ContainsAny(name, "\x00\r\n") {
		name = "LinkMe"
	}
	var src image.Image
	if iconBase64 != "" && len(iconBase64) < 8<<20 {
		if raw, err := base64.StdEncoding.DecodeString(iconBase64); err == nil {
			src, _ = png.Decode(bytes.NewReader(raw))
		}
	}
	sameIcon := (src == nil && h.desktop.brandImage == nil) || (src != nil && iconBase64 == h.desktop.brandIconData)
	if name == h.desktop.appName && sameIcon {
		return
	}
	h.desktop.appName = name
	title, _ := syscall.UTF16PtrFromString(name)
	user32.NewProc("SetWindowTextW").Call(h.hwnd, uintptr(unsafe.Pointer(title)))
	if !sameIcon {
		var icon uintptr
		if src != nil {
			icon = iconFromImage(src, 32)
		} else {
			icon = loadLinkMeIcon(32)
		}
		if icon != 0 {
			if h.desktop.normalIconOwned && h.desktop.normalIcon != 0 {
				defer user32.NewProc("DestroyIcon").Call(h.desktop.normalIcon)
			}
			h.desktop.normalIcon, h.desktop.normalIconOwned = icon, true
		}
		h.desktop.brandImage, h.desktop.brandIconData = src, ""
		if src != nil {
			h.desktop.brandIconData = iconBase64
		}
		// The breathing frames are rebuilt from the new icon on the next tick.
		destroyIcons(h.desktop.breathBig)
		destroyIcons(h.desktop.breathSmall)
		h.desktop.breathBig, h.desktop.breathSmall = nil, nil
		if !h.desktop.breathing {
			h.setUnreadIcons(h.desktop.normalIcon, h.desktop.normalIcon)
		}
	}
	h.refreshTray(0) // tooltip carries the name
}

// breathSource is the image the unread animation is made from.
func (h *windowsHost) breathSource() (image.Image, error) {
	if h.desktop.brandImage != nil {
		return h.desktop.brandImage, nil
	}
	return largestICOImage(linkMeIconICO)
}
