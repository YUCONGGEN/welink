//go:build windows

package main

import (
	"errors"
	"fmt"
	"image"
	"sync"
	"syscall"
	"unsafe"
)

type screenshotSelection struct {
	host                                          *windowsHost
	frame                                         *screenshotFrame
	window, font, blackDC, blackBitmap, oldBitmap uintptr
	anchor                                        image.Point
	selected                                      image.Rectangle
	dragging, done, wasHidden                     bool
	version                                       uint64
	dpi                                           uintptr
}

var screenshotSelections sync.Map
var screenshotClassOnce sync.Once
var screenshotClassError error
var screenshotClassName, _ = syscall.UTF16PtrFromString("WeLinkScreenshotSelection")

var screenshotCallback = syscall.NewCallback(func(hwnd, message, wp, lp uintptr) uintptr {
	if value, ok := screenshotSelections.Load(hwnd); ok {
		s := value.(*screenshotSelection)
		point := image.Pt(max(0, min(s.frame.bounds.Dx(), int(int16(lp&0xffff)))), max(0, min(s.frame.bounds.Dy(), int(int16(lp>>16&0xffff)))))
		switch message {
		case 0x0f:
			s.paint()
			return 0
		case 0x14:
			return 1 // WM_ERASEBKGND: the frozen screen fills every pixel.
		case 0x201:
			if !s.selected.Empty() {
				buttons := s.buttons()
				for i, button := range buttons {
					if point.In(button) {
						switch i {
						case 0:
							s.selected = image.Rectangle{}
							s.invalidate()
						case 1:
							s.finish(false)
						case 2:
							s.finish(true)
						}
						return 0
					}
				}
			}
			s.anchor = point
			s.selected = image.Rectangle{}
			s.dragging = true
			user32.NewProc("SetCapture").Call(hwnd)
			s.invalidate()
			return 0
		case 0x200:
			if s.dragging {
				s.selected = image.Rect(s.anchor.X, s.anchor.Y, point.X, point.Y)
				s.invalidate()
			}
			return 0
		case 0x202:
			if s.dragging {
				s.selected = image.Rect(s.anchor.X, s.anchor.Y, point.X, point.Y)
				s.dragging = false
				user32.NewProc("ReleaseCapture").Call()
				s.invalidate()
			}
			return 0
		case 0x203:
			if !s.selected.Empty() {
				s.finish(true)
			}
			return 0
		case 0x205, 0x10, 0x7e, 0x02e0:
			s.finish(false)
			return 0 // Cancel, display change, DPI change.
		case 0x100:
			if wp == 27 {
				s.finish(false)
			} else if wp == 13 && !s.selected.Empty() {
				s.finish(true)
			}
			return 0
		case 0x0006:
			if wp&0xffff == 0 && !s.done {
				s.finish(false)
			}
			return 0
		case 0x0215:
			s.dragging = false
			return 0
		case 0x0082:
			screenshotSelections.Delete(hwnd)
		}
	}
	result, _, _ := user32.NewProc("DefWindowProcW").Call(hwnd, message, wp, lp)
	return result
})

func (h *windowsHost) openScreenshotSelection(frame *screenshotFrame, wasHidden bool) error {
	if frame == nil || frame.bounds.Dx() < 1 || frame.bounds.Dy() < 1 || len(frame.pixels) != frame.bounds.Dx()*frame.bounds.Dy()*4 {
		return errors.New("截图画面无效")
	}
	module, _, _ := screenshotKernel.NewProc("GetModuleHandleW").Call(0)
	screenshotClassOnce.Do(func() {
		cursor, _, _ := user32.NewProc("LoadCursorW").Call(0, 32515)
		class := noticeClass{Style: 8, Proc: screenshotCallback, Instance: module, Cursor: cursor, Name: screenshotClassName}
		class.Size = uint32(unsafe.Sizeof(class))
		if atom, _, err := user32.NewProc("RegisterClassExW").Call(uintptr(unsafe.Pointer(&class))); atom == 0 {
			screenshotClassError = fmt.Errorf("无法创建截图窗口：%w", err)
		}
	})
	if screenshotClassError != nil {
		return screenshotClassError
	}
	s := &screenshotSelection{host: h, frame: frame, wasHidden: wasHidden, version: h.desktop.captureVersion}
	title, _ := syscall.UTF16PtrFromString("WeLink 截图 · 拖动框选，Enter 完成，Esc 取消")
	window, _, err := user32.NewProc("CreateWindowExW").Call(0x88, uintptr(unsafe.Pointer(screenshotClassName)), uintptr(unsafe.Pointer(title)), 0x80000000, uintptr(frame.bounds.Min.X), uintptr(frame.bounds.Min.Y), uintptr(frame.bounds.Dx()), uintptr(frame.bounds.Dy()), h.hwnd, 0, module, 0)
	if window == 0 {
		return fmt.Errorf("无法打开截图选区：%w", err)
	}
	s.window = window
	s.blackDC, _, _ = screenshotGDI.NewProc("CreateCompatibleDC").Call(0)
	s.blackBitmap, _, _ = screenshotGDI.NewProc("CreateBitmap").Call(1, 1, 1, 32, 0)
	if s.blackDC == 0 || s.blackBitmap == 0 {
		s.release()
		user32.NewProc("DestroyWindow").Call(window)
		return errors.New("无法创建截图遮罩")
	}
	s.oldBitmap, _, _ = screenshotGDI.NewProc("SelectObject").Call(s.blackDC, s.blackBitmap)
	screenshotGDI.NewProc("PatBlt").Call(s.blackDC, 0, 0, 1, 1, 0x42) // BLACKNESS
	dpi, _, _ := user32.NewProc("GetDpiForWindow").Call(window)
	if dpi == 0 {
		dpi = 96
	}
	s.dpi = dpi
	fontName, _ := syscall.UTF16PtrFromString("Microsoft YaHei")
	fontHeight := -int32(14 * dpi / 96)
	s.font, _, _ = screenshotGDI.NewProc("CreateFontW").Call(uintptr(fontHeight), 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(fontName)))
	h.desktop.capture = s
	screenshotSelections.Store(window, s)
	user32.NewProc("SetWindowPos").Call(window, ^uintptr(0), uintptr(frame.bounds.Min.X), uintptr(frame.bounds.Min.Y), uintptr(frame.bounds.Dx()), uintptr(frame.bounds.Dy()), 0x40)
	user32.NewProc("SetForegroundWindow").Call(window)
	user32.NewProc("SetFocus").Call(window)
	return nil
}

func (s *screenshotSelection) invalidate() { user32.NewProc("InvalidateRect").Call(s.window, 0, 0) }
func (s *screenshotSelection) buttons() []image.Rectangle {
	x := max(0, min(s.frame.bounds.Dx()-s.px(258), s.selected.Max.X-s.px(258)))
	y := s.selected.Max.Y + s.px(10)
	if y+s.px(38) > s.frame.bounds.Dy() {
		y = max(0, s.selected.Max.Y-s.px(48))
	}
	return []image.Rectangle{image.Rect(x, y, x+s.px(78), y+s.px(36)), image.Rect(x+s.px(86), y, x+s.px(164), y+s.px(36)), image.Rect(x+s.px(172), y, x+s.px(258), y+s.px(36))}
}

func (s *screenshotSelection) px(value int) int { return max(1, value*int(s.dpi)/96) }

func (s *screenshotSelection) paint() {
	var ps struct {
		DC                 uintptr
		Erase              int32
		Rect               noticeRect
		Restore, IncUpdate int32
		Reserved           [32]byte
	}
	dc, _, _ := user32.NewProc("BeginPaint").Call(s.window, uintptr(unsafe.Pointer(&ps)))
	if dc == 0 {
		return
	}
	defer user32.NewProc("EndPaint").Call(s.window, uintptr(unsafe.Pointer(&ps)))
	w, h := s.frame.bounds.Dx(), s.frame.bounds.Dy()
	header := screenshotHeader{Size: 40, Width: int32(w), Height: -int32(h), Planes: 1, BitCount: 32}
	screenshotGDI.NewProc("SetDIBitsToDevice").Call(dc, 0, 0, uintptr(w), uintptr(h), 0, 0, 0, uintptr(h), uintptr(unsafe.Pointer(&s.frame.pixels[0])), uintptr(unsafe.Pointer(&header)), 0)
	dim := func(rect image.Rectangle) {
		if !rect.Empty() {
			syscall.NewLazyDLL("msimg32.dll").NewProc("AlphaBlend").Call(dc, uintptr(rect.Min.X), uintptr(rect.Min.Y), uintptr(rect.Dx()), uintptr(rect.Dy()), s.blackDC, 0, 0, 1, 1, 135<<16)
		}
	}
	r := s.selected
	if r.Empty() {
		dim(image.Rect(0, 0, w, h))
	} else {
		dim(image.Rect(0, 0, w, r.Min.Y))
		dim(image.Rect(0, r.Max.Y, w, h))
		dim(image.Rect(0, r.Min.Y, r.Min.X, r.Max.Y))
		dim(image.Rect(r.Max.X, r.Min.Y, w, r.Max.Y))
	}
	fill := func(rect image.Rectangle, color uintptr) {
		brush, _, _ := screenshotGDI.NewProc("CreateSolidBrush").Call(color)
		defer screenshotGDI.NewProc("DeleteObject").Call(brush)
		rr := noticeRect{int32(rect.Min.X), int32(rect.Min.Y), int32(rect.Max.X), int32(rect.Max.Y)}
		user32.NewProc("FillRect").Call(dc, uintptr(unsafe.Pointer(&rr)), brush)
	}
	old, _, _ := screenshotGDI.NewProc("SelectObject").Call(dc, s.font)
	defer screenshotGDI.NewProc("SelectObject").Call(dc, old)
	screenshotGDI.NewProc("SetBkMode").Call(dc, 1)
	text := func(value string, rect image.Rectangle, color uintptr) {
		screenshotGDI.NewProc("SetTextColor").Call(dc, color)
		ptr, _ := syscall.UTF16PtrFromString(value)
		rr := noticeRect{int32(rect.Min.X), int32(rect.Min.Y), int32(rect.Max.X), int32(rect.Max.Y)}
		user32.NewProc("DrawTextW").Call(dc, uintptr(unsafe.Pointer(ptr)), ^uintptr(0), uintptr(unsafe.Pointer(&rr)), 0x825)
	}
	if r.Empty() {
		box := image.Rect(max(0, w/2-s.px(225)), s.px(24), min(w, w/2+s.px(225)), s.px(68))
		fill(box, 0xffffff)
		text("拖动框选 · 双击或 Enter 完成 · Esc 取消", box, 0x443326)
		return
	}
	edge := min(s.px(2), r.Dx(), r.Dy())
	for _, line := range []image.Rectangle{image.Rect(r.Min.X, r.Min.Y, r.Max.X, r.Min.Y+edge), image.Rect(r.Min.X, r.Max.Y-edge, r.Max.X, r.Max.Y), image.Rect(r.Min.X, r.Min.Y, r.Min.X+edge, r.Max.Y), image.Rect(r.Max.X-edge, r.Min.Y, r.Max.X, r.Max.Y)} {
		fill(line, 0xff9900)
	}
	label := image.Rect(r.Min.X, max(0, r.Min.Y-s.px(28)), min(w, r.Min.X+s.px(180)), max(0, r.Min.Y-s.px(28))+s.px(24))
	fill(label, 0xffffff)
	text(fmt.Sprintf("%d × %d", r.Dx(), r.Dy()), label, 0x443326)
	if !s.dragging {
		for i, button := range s.buttons() {
			color := uintptr(0xffffff)
			ink := uintptr(0x443326)
			if i == 2 {
				color = 0xff9900
				ink = 0xffffff
			}
			fill(button, color)
			text([]string{"重选", "取消", "完成"}[i], button, ink)
		}
	}
}

func (s *screenshotSelection) release() {
	if s.blackDC != 0 {
		if s.oldBitmap != 0 {
			screenshotGDI.NewProc("SelectObject").Call(s.blackDC, s.oldBitmap)
		}
		screenshotGDI.NewProc("DeleteDC").Call(s.blackDC)
		s.blackDC = 0
	}
	if s.blackBitmap != 0 {
		screenshotGDI.NewProc("DeleteObject").Call(s.blackBitmap)
		s.blackBitmap = 0
	}
	if s.font != 0 {
		screenshotGDI.NewProc("DeleteObject").Call(s.font)
		s.font = 0
	}
}

func (s *screenshotSelection) finish(accepted bool) {
	if s.done {
		return
	}
	s.done = true
	if accepted && s.selected.Empty() {
		accepted = false
	}
	user32.NewProc("ReleaseCapture").Call()
	screenshotSelections.Delete(s.window)
	user32.NewProc("DestroyWindow").Call(s.window)
	s.release()
	h := s.host
	h.desktop.capture = nil
	frame, rect := s.frame, s.selected
	s.frame = nil
	if h.desktop.closing {
		h.desktop.capturePending = false
		return
	}
	if !accepted {
		h.desktop.capturePending = false
		if !s.wasHidden {
			h.showWindow()
		}
		h.screenshotEvent("welink-screenshot-result", map[string]any{"cancelled": true})
		return
	}
	h.showWindow()
	go func() {
		data, err := frame.encode(rect)
		h.dispatchScreenshot(func() {
			if s.version != h.desktop.captureVersion {
				return
			}
			h.desktop.capturePending = false
			if err != nil {
				h.screenshotEvent("welink-screenshot-result", map[string]any{"error": err.Error()})
			} else {
				h.screenshotEvent("welink-screenshot-result", map[string]any{"image": data, "width": rect.Dx(), "height": rect.Dy()})
			}
		})
	}()
}
