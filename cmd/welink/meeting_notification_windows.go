//go:build windows

package main

import (
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

type meetingNotice struct {
	window  uintptr
	host    *windowsHost
	code    string
	created int64
}

var meetingNotices sync.Map
var noticeClassOnce sync.Once
var noticeClassName, _ = syscall.UTF16PtrFromString("WeLinkMeetingInvitation")

type noticeClass struct {
	Size, Style                        uint32
	Proc                               uintptr
	ClassExtra, WindowExtra            int32
	Instance, Icon, Cursor, Background uintptr
	Menu, Name                         *uint16
	SmallIcon                          uintptr
}
type noticeRect struct{ Left, Top, Right, Bottom int32 }

var noticeCallback = syscall.NewCallback(func(hwnd, msg, wp, lp uintptr) uintptr {
	if value, ok := meetingNotices.Load(hwnd); ok {
		n := value.(*meetingNotice)
		switch msg {
		case 0x111: // WM_COMMAND from Enter / Dismiss buttons.
			if wp&0xffff == 101 {
				if saveMeetingInvite(n.host.desktop.directory, n.code) == nil {
					n.host.showWindow()
					n.host.view.Eval(`window.dispatchEvent(new CustomEvent('welink-open-meeting'))`)
				}
			}
			if wp&0xffff == 101 || wp&0xffff == 102 {
				destroyMeetingNotice(hwnd)
				return 0
			}
		case 0x10, 0x113:
			destroyMeetingNotice(hwnd)
			return 0 // close / expiration
		case 0x21:
			return 3 // MA_NOACTIVATE; don't steal focus while receiving an invite.
		case 0x138:
			syscall.NewLazyDLL("gdi32.dll").NewProc("SetBkColor").Call(wp, 0xffffff)
			brush, _, _ := user32.NewProc("GetSysColorBrush").Call(5)
			return brush
		case 0x82:
			meetingNotices.Delete(hwnd)
		}
	}
	r, _, _ := user32.NewProc("DefWindowProcW").Call(hwnd, msg, wp, lp)
	return r
})

func destroyMeetingNotice(hwnd uintptr) {
	value, ok := meetingNotices.LoadAndDelete(hwnd)
	user32.NewProc("KillTimer").Call(hwnd, 1)
	user32.NewProc("DestroyWindow").Call(hwnd)
	if ok {
		value.(*meetingNotice).host.layoutMeetingNotices()
	}
}
func (h *windowsHost) closeMeetingNotices() {
	meetingNotices.Range(func(key, value any) bool {
		if value.(*meetingNotice).host == h {
			destroyMeetingNotice(key.(uintptr))
		}
		return true
	})
}
func (h *windowsHost) layoutMeetingNotices() {
	var notices []*meetingNotice
	meetingNotices.Range(func(_, v any) bool {
		n := v.(*meetingNotice)
		if n.host == h {
			notices = append(notices, n)
		}
		return true
	})
	sort.Slice(notices, func(i, j int) bool { return notices[i].created > notices[j].created })
	dpi, _, _ := user32.NewProc("GetDpiForSystem").Call()
	if dpi == 0 {
		dpi = 96
	}
	var area noticeRect
	user32.NewProc("SystemParametersInfoW").Call(0x30, 0, uintptr(unsafe.Pointer(&area)), 0)
	w, height, gap := 360*dpi/96, 166*dpi/96, 16*dpi/96
	for i, n := range notices {
		user32.NewProc("SetWindowPos").Call(n.window, ^uintptr(0), uintptr(area.Right)-w-gap, uintptr(area.Bottom)-gap-height-uintptr(i)*(height+gap), w, height, 0x10)
	}
}

func (h *windowsHost) showMeetingNotice(code, title string, expires int64) bool {
	if !meetingCodePattern.MatchString(code) || expires <= time.Now().UnixMilli() || h.desktop.closing {
		return false
	}
	if len([]rune(title)) > 60 {
		title = string([]rune(title)[:60])
	}
	title = strings.ReplaceAll(title, "\x00", "")
	module, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetModuleHandleW").Call(0)
	noticeClassOnce.Do(func() {
		cursor, _, _ := user32.NewProc("LoadCursorW").Call(0, 32512)
		c := noticeClass{Proc: noticeCallback, Instance: module, Cursor: cursor, Background: 6, Name: noticeClassName}
		c.Size = uint32(unsafe.Sizeof(c))
		user32.NewProc("RegisterClassExW").Call(uintptr(unsafe.Pointer(&c)))
	})
	count := 0
	var oldest *meetingNotice
	duplicate := false
	meetingNotices.Range(func(_, value any) bool {
		n := value.(*meetingNotice)
		if n.host == h {
			if n.code == code {
				duplicate = true
			}
			count++
			if oldest == nil || n.created < oldest.created {
				oldest = n
			}
		}
		return true
	})
	if duplicate {
		return true
	}
	if count >= 3 && oldest != nil {
		destroyMeetingNotice(oldest.window)
		count--
	}
	dpi, _, _ := user32.NewProc("GetDpiForSystem").Call()
	if dpi == 0 {
		dpi = 96
	}
	scale := func(v int32) uintptr { return uintptr(v * int32(dpi) / 96) }
	var area noticeRect
	if ok, _, _ := user32.NewProc("SystemParametersInfoW").Call(0x30, 0, uintptr(unsafe.Pointer(&area)), 0); ok == 0 {
		return false
	}
	w, hgt := scale(360), scale(166)
	x := uintptr(area.Right) - w - scale(16)
	y := uintptr(area.Bottom) - hgt - scale(16) - uintptr(count)*(hgt+scale(10))
	label, _ := syscall.UTF16PtrFromString("WeLink 会议邀请")
	hwnd, _, _ := user32.NewProc("CreateWindowExW").Call(0x08000088, uintptr(unsafe.Pointer(noticeClassName)), uintptr(unsafe.Pointer(label)), 0x80800000, x, y, w, hgt, 0, 0, module, 0)
	if hwnd == 0 {
		return false
	}
	n := &meetingNotice{window: hwnd, host: h, code: code, created: time.Now().UnixNano()}
	meetingNotices.Store(hwnd, n)
	child := func(class, text string, id uintptr, left, top, width, height int32, style uintptr) {
		c, _ := syscall.UTF16PtrFromString(class)
		t, _ := syscall.UTF16PtrFromString(text)
		v, _, _ := user32.NewProc("CreateWindowExW").Call(0, uintptr(unsafe.Pointer(c)), uintptr(unsafe.Pointer(t)), 0x50000000|style, scale(left), scale(top), scale(width), scale(height), hwnd, id, module, 0)
		font, _, _ := syscall.NewLazyDLL("gdi32.dll").NewProc("GetStockObject").Call(17)
		user32.NewProc("SendMessageW").Call(v, 0x30, font, 1)
	}
	child("STATIC", "WeLink · 会议邀请", 0, 18, 14, 320, 23, 0)
	child("STATIC", title, 0, 18, 43, 320, 23, 0x0c)
	child("STATIC", "会议号 "+code[:3]+" "+code[3:6]+" "+code[6:], 0, 18, 72, 320, 22, 0)
	child("BUTTON", "进入会议", 101, 216, 111, 122, 34, 0x10000)
	child("BUTTON", "忽略", 102, 118, 111, 84, 34, 0x10000)
	user32.NewProc("SetTimer").Call(hwnd, 1, uintptr(min(expires-time.Now().UnixMilli(), 7200000)), 0)
	user32.NewProc("ShowWindow").Call(hwnd, 4)
	user32.NewProc("SetWindowPos").Call(hwnd, ^uintptr(0), x, y, w, hgt, 0x10|0x40)
	user32.NewProc("MessageBeep").Call(0x40)
	h.layoutMeetingNotices()
	return true
}
