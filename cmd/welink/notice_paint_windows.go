//go:build windows

package main

import (
	"sync"
	"sync/atomic"
	"syscall"
	"unicode/utf8"
	"unsafe"
)

// Incoming call / remote / meeting cards are painted by hand instead of using
// stock STATIC and BUTTON controls, so they match the in-app call dialog:
// rounded card, avatar disc, YaHei text and pill buttons, in light or dark.

// noticeDarkTheme mirrors the app theme reported by the WebView.
var noticeDarkTheme atomic.Bool

var (
	noticeGDI      = syscall.NewLazyDLL("gdi32.dll")
	noticeGDIPlus  = syscall.NewLazyDLL("gdiplus.dll")
	gdiplusOnce    sync.Once
	gdiplusReady   bool
	noticeDWM      = syscall.NewLazyDLL("dwmapi.dll")
	noticeHandCurs uintptr
)

// Card geometry in 96-DPI units.
const (
	noticeWidth  = 360
	noticeHeight = 150
)

type noticeRectI struct{ left, top, right, bottom int32 }

var (
	noticeAcceptRect = noticeRectI{220, 102, 340, 136}
	noticeRejectRect = noticeRectI{92, 102, 212, 136}
)

type noticePalette struct {
	background, border, ink, muted uint32 // 0xRRGGBB
}

func currentNoticePalette() noticePalette {
	if noticeDarkTheme.Load() {
		return noticePalette{background: 0x1f232a, border: 0x363c47, ink: 0xe8ecf1, muted: 0x9aa4b2}
	}
	return noticePalette{background: 0xffffff, border: 0xe1e4ec, ink: 0x1e2430, muted: 0x6d7584}
}

// colorRef converts 0xRRGGBB to a GDI COLORREF (0x00BBGGRR).
func colorRef(rgb uint32) uintptr {
	return uintptr((rgb>>16)&0xff | (rgb & 0xff00) | (rgb&0xff)<<16)
}

func startGDIPlus() bool {
	gdiplusOnce.Do(func() {
		input := struct {
			Version                  uint32
			Callback                 uintptr
			SuppressBackgroundThread int32
			SuppressExternalCodecs   int32
		}{Version: 1}
		var token uintptr
		if noticeGDIPlus.Load() == nil {
			r, _, _ := noticeGDIPlus.NewProc("GdiplusStartup").Call(uintptr(unsafe.Pointer(&token)), uintptr(unsafe.Pointer(&input)), 0)
			gdiplusReady = r == 0
		}
	})
	return gdiplusReady
}

type noticeFonts struct{ caption, title, detail, button uintptr }

func createNoticeFonts(dpi uintptr) noticeFonts {
	name, _ := syscall.UTF16PtrFromString("Microsoft YaHei UI")
	font := func(px, weight int32) uintptr {
		h := -px * int32(dpi) / 96
		f, _, _ := noticeGDI.NewProc("CreateFontW").Call(uintptr(h), 0, 0, 0, uintptr(weight), 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(name)))
		return f
	}
	return noticeFonts{caption: font(12, 400), title: font(17, 700), detail: font(13, 400), button: font(14, 600)}
}

func (f noticeFonts) release() {
	for _, h := range []uintptr{f.caption, f.title, f.detail, f.button} {
		if h != 0 {
			noticeGDI.NewProc("DeleteObject").Call(h)
		}
	}
}

// roundNoticeWindow asks DWM for Windows 11 rounded corners and falls back to
// a window region on Windows 10.
func roundNoticeWindow(hwnd uintptr, w, h, radius uintptr) {
	preference := int32(2) // DWMWCP_ROUND
	if r, _, _ := noticeDWM.NewProc("DwmSetWindowAttribute").Call(hwnd, 33, uintptr(unsafe.Pointer(&preference)), 4); r == 0 {
		return
	}
	region, _, _ := noticeGDI.NewProc("CreateRoundRectRgn").Call(0, 0, w+1, h+1, radius, radius)
	if region != 0 {
		user32.NewProc("SetWindowRgn").Call(hwnd, region, 1)
	}
}

func (n *meetingNotice) scale(v int32) int32 { return v * int32(n.dpi) / 96 }

func (n *meetingNotice) scaled(r noticeRectI) noticeRect {
	return noticeRect{n.scale(r.left), n.scale(r.top), n.scale(r.right), n.scale(r.bottom)}
}

// hit maps a client-area point to the accept (101) or reject (102) button.
func (n *meetingNotice) hit(x, y int32) uintptr {
	in := func(r noticeRect) bool { return x >= r.Left && x < r.Right && y >= r.Top && y < r.Bottom }
	if in(n.scaled(noticeAcceptRect)) {
		return 101
	}
	if in(n.scaled(noticeRejectRect)) {
		return 102
	}
	return 0
}

func (n *meetingNotice) cursorHit() uintptr {
	var p struct{ X, Y int32 }
	user32.NewProc("GetCursorPos").Call(uintptr(unsafe.Pointer(&p)))
	user32.NewProc("ScreenToClient").Call(n.window, uintptr(unsafe.Pointer(&p)))
	return n.hit(p.X, p.Y)
}

func (n *meetingNotice) setHandCursor() {
	if noticeHandCurs == 0 {
		noticeHandCurs, _, _ = user32.NewProc("LoadCursorW").Call(0, 32649) // IDC_HAND
	}
	user32.NewProc("SetCursor").Call(noticeHandCurs)
}

type gdipGraphics struct{ g uintptr }

func (g gdipGraphics) fill(argb uint32, draw func(brush uintptr)) {
	var brush uintptr
	noticeGDIPlus.NewProc("GdipCreateSolidFill").Call(uintptr(argb), uintptr(unsafe.Pointer(&brush)))
	if brush == 0 {
		return
	}
	draw(brush)
	noticeGDIPlus.NewProc("GdipDeleteBrush").Call(brush)
}

func (g gdipGraphics) ellipse(argb uint32, x, y, w, h int32) {
	g.fill(argb, func(brush uintptr) {
		noticeGDIPlus.NewProc("GdipFillEllipseI").Call(g.g, brush, uintptr(x), uintptr(y), uintptr(w), uintptr(h))
	})
}

func (g gdipGraphics) roundRect(argb uint32, r noticeRect, radius int32) {
	d := min(radius*2, r.Bottom-r.Top, r.Right-r.Left)
	var path uintptr
	noticeGDIPlus.NewProc("GdipCreatePath").Call(0, uintptr(unsafe.Pointer(&path)))
	if path == 0 {
		return
	}
	defer noticeGDIPlus.NewProc("GdipDeletePath").Call(path)
	arc := noticeGDIPlus.NewProc("GdipAddPathArcI")
	f32 := func(v float32) uintptr { return uintptr(*(*uint32)(unsafe.Pointer(&v))) }
	arc.Call(path, uintptr(r.Left), uintptr(r.Top), uintptr(d), uintptr(d), f32(180), f32(90))
	arc.Call(path, uintptr(r.Right-d-1), uintptr(r.Top), uintptr(d), uintptr(d), f32(270), f32(90))
	arc.Call(path, uintptr(r.Right-d-1), uintptr(r.Bottom-d-1), uintptr(d), uintptr(d), f32(0), f32(90))
	arc.Call(path, uintptr(r.Left), uintptr(r.Bottom-d-1), uintptr(d), uintptr(d), f32(90), f32(90))
	noticeGDIPlus.NewProc("GdipClosePathFigure").Call(path)
	g.fill(argb, func(brush uintptr) { noticeGDIPlus.NewProc("GdipFillPath").Call(g.g, brush, path) })
}

func (n *meetingNotice) paint() {
	var ps struct {
		DC                 uintptr
		Erase              int32
		Rect               noticeRect
		Restore, IncUpdate int32
		Reserved           [32]byte
	}
	windowDC, _, _ := user32.NewProc("BeginPaint").Call(n.window, uintptr(unsafe.Pointer(&ps)))
	if windowDC == 0 {
		return
	}
	defer user32.NewProc("EndPaint").Call(n.window, uintptr(unsafe.Pointer(&ps)))
	var client noticeRect
	user32.NewProc("GetClientRect").Call(n.window, uintptr(unsafe.Pointer(&client)))
	n.render(windowDC, client.Right, client.Bottom)
}

// render draws the whole card off-screen and copies it to target.
func (n *meetingNotice) render(windowDC uintptr, w, h int32) {
	client := noticeRect{0, 0, w, h}
	dc, _, _ := noticeGDI.NewProc("CreateCompatibleDC").Call(windowDC)
	bitmap, _, _ := noticeGDI.NewProc("CreateCompatibleBitmap").Call(windowDC, uintptr(w), uintptr(h))
	if dc == 0 || bitmap == 0 {
		return
	}
	defer noticeGDI.NewProc("DeleteDC").Call(dc)
	defer noticeGDI.NewProc("DeleteObject").Call(bitmap)
	oldBitmap, _, _ := noticeGDI.NewProc("SelectObject").Call(dc, bitmap)
	defer noticeGDI.NewProc("SelectObject").Call(dc, oldBitmap)

	p := currentNoticePalette()
	fillRect := func(r noticeRect, rgb uint32) {
		brush, _, _ := noticeGDI.NewProc("CreateSolidBrush").Call(colorRef(rgb))
		user32.NewProc("FillRect").Call(dc, uintptr(unsafe.Pointer(&r)), brush)
		noticeGDI.NewProc("DeleteObject").Call(brush)
	}
	// 1px border, then the card surface.
	fillRect(client, p.border)
	fillRect(noticeRect{1, 1, w - 1, h - 1}, p.background)

	accent := uint32(0x1fb67a) // answer
	if n.notice.Type != "call" {
		accent = 0x1677ff
	}
	avatar := noticeRect{n.scale(20), n.scale(44), n.scale(66), n.scale(90)}
	if startGDIPlus() {
		var graphics uintptr
		noticeGDIPlus.NewProc("GdipCreateFromHDC").Call(dc, uintptr(unsafe.Pointer(&graphics)))
		if graphics != 0 {
			noticeGDIPlus.NewProc("GdipSetSmoothingMode").Call(graphics, 4) // AntiAlias
			g := gdipGraphics{graphics}
			g.ellipse(0xff000000|accent, n.scale(20), n.scale(21), n.scale(7), n.scale(7))
			g.ellipse(0xff1677ff, avatar.Left, avatar.Top, avatar.Right-avatar.Left, avatar.Bottom-avatar.Top)
			g.roundRect(0xfff04f5b, n.scaled(noticeRejectRect), n.scale(17))
			g.roundRect(0xff000000|accent, n.scaled(noticeAcceptRect), n.scale(17))
			noticeGDIPlus.NewProc("GdipDeleteGraphics").Call(graphics)
		}
	} else {
		fillRect(avatar, 0x1677ff)
		fillRect(n.scaled(noticeRejectRect), 0xf04f5b)
		fillRect(n.scaled(noticeAcceptRect), accent)
	}

	noticeGDI.NewProc("SetBkMode").Call(dc, 1)
	text := func(value string, font uintptr, rgb uint32, r noticeRect, format uintptr) {
		if value == "" {
			return
		}
		ptr, _ := syscall.UTF16PtrFromString(value)
		noticeGDI.NewProc("SelectObject").Call(dc, font)
		noticeGDI.NewProc("SetTextColor").Call(dc, colorRef(rgb))
		user32.NewProc("DrawTextW").Call(dc, uintptr(unsafe.Pointer(ptr)), ^uintptr(0), uintptr(unsafe.Pointer(&r)), format)
	}
	const left, center, ellipsis = 0x0 | 0x4 | 0x20 | 0x800, 0x1 | 0x4 | 0x20 | 0x800, 0x8000
	initial := "L"
	if r, size := utf8.DecodeRuneInString(n.heading); size > 0 && r != utf8.RuneError {
		initial = string(r)
	}
	text(n.caption, n.fonts.caption, p.muted, noticeRect{n.scale(34), n.scale(14), n.scale(340), n.scale(34)}, left|ellipsis)
	text(initial, n.fonts.title, 0xffffff, avatar, center)
	text(n.heading, n.fonts.title, p.ink, noticeRect{n.scale(80), n.scale(44), n.scale(340), n.scale(68)}, left|ellipsis)
	text(n.detail, n.fonts.detail, p.muted, noticeRect{n.scale(80), n.scale(68), n.scale(340), n.scale(90)}, left|ellipsis)
	text(n.reject, n.fonts.button, 0xffffff, n.scaled(noticeRejectRect), center)
	text(n.accept, n.fonts.button, 0xffffff, n.scaled(noticeAcceptRect), center)

	noticeGDI.NewProc("BitBlt").Call(windowDC, 0, 0, uintptr(w), uintptr(h), dc, 0, 0, 0x00cc0020)
}
