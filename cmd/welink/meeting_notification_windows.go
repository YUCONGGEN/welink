//go:build windows

package main

import (
	_ "embed"
	"encoding/json"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
	"welink/internal/client"
)

//go:embed resources/ringtone.wav
var inviteRingWAV []byte

type meetingNotice struct {
	window  uintptr
	host    *windowsHost
	key     string
	code    string
	created int64
	notice  client.Notification
}

var meetingNotices sync.Map
var noticeClassOnce sync.Once
var noticeClassName, _ = syscall.UTF16PtrFromString("LinkMeIncomingInvitation")

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
		case 0x111:
			id := wp & 0xffff
			if id == 101 || id == 102 {
				n.host.handleIncomingNotice(n.notice, id == 101)
				destroyMeetingNotice(hwnd)
				return 0
			}
		case 0x10: // Closing the card is an explicit reject/ignore action.
			n.host.handleIncomingNotice(n.notice, false)
			destroyMeetingNotice(hwnd)
			return 0
		case 0x113:
			destroyMeetingNotice(hwnd)
			return 0
		case 0x21:
			return 3
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
		n := value.(*meetingNotice)
		n.host.layoutMeetingNotices()
		stopInviteRingIfIdle()
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

func (h *windowsHost) closeMessageNotices() {}

func (h *windowsHost) closeIncomingNotice(key string) {
	meetingNotices.Range(func(hwnd, value any) bool {
		n := value.(*meetingNotice)
		if n.host == h && n.key == key {
			destroyMeetingNotice(hwnd.(uintptr))
		}
		return true
	})
}

func (h *windowsHost) layoutMeetingNotices() {
	var notices []*meetingNotice
	meetingNotices.Range(func(_, value any) bool {
		n := value.(*meetingNotice)
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
	scale := func(v int32) uintptr { return uintptr(v * int32(dpi) / 96) }
	w, height, gap, margin := scale(336), scale(132), scale(10), scale(14)
	workHeight := uintptr(max(int32(1), area.Bottom-area.Top))
	usableHeight := workHeight
	if workHeight > margin*2 {
		usableHeight -= margin * 2
	} else {
		usableHeight = height
	}
	maxVisible := int((usableHeight + gap) / (height + gap))
	if maxVisible < 1 {
		maxVisible = 1
	}
	for i, n := range notices {
		if i >= maxVisible {
			user32.NewProc("ShowWindow").Call(n.window, 0)
			continue
		}
		x := uintptr(area.Right) - w - margin
		y := uintptr(area.Bottom) - margin - height - uintptr(i)*(height+gap)
		user32.NewProc("SetWindowPos").Call(n.window, ^uintptr(0), x, y, w, height, 0x10)
		user32.NewProc("ShowWindow").Call(n.window, 4)
	}
}

func (h *windowsHost) showMeetingNotice(code, title string, expires int64) bool {
	return h.showNotice(code, title, expires, nil)
}

// Keep the existing bridge, but never show ordinary chat messages in a desktop popup.
func (h *windowsHost) showNotice(code, title string, expires int64, message *client.Notification) bool {
	if message != nil || !meetingCodePattern.MatchString(code) {
		return false
	}
	return h.showIncomingNotice(client.Notification{Type: "meeting", State: "pending", Code: code, Title: title, Expires: expires})
}

func (h *windowsHost) showIncomingNotice(notice client.Notification) bool {
	pending := notice.State == "pending" || notice.Type == "call" && notice.State == "ringing"
	key := notice.Type + "/"
	switch notice.Type {
	case "meeting":
		key += notice.Code
	default:
		key += notice.ID
	}
	if h.desktop.closing || key == notice.Type+"/" {
		return false
	}
	var existing uintptr
	meetingNotices.Range(func(hwnd, value any) bool {
		old := value.(*meetingNotice)
		if old.host == h && old.key == key {
			existing = hwnd.(uintptr)
			return false
		}
		return true
	})
	if existing != 0 && pending {
		return true
	}
	if existing != 0 {
		destroyMeetingNotice(existing)
		return false
	}
	if !pending {
		return false
	}

	module, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetModuleHandleW").Call(0)
	noticeClassOnce.Do(func() {
		cursor, _, _ := user32.NewProc("LoadCursorW").Call(0, 32512)
		c := noticeClass{Proc: noticeCallback, Instance: module, Cursor: cursor, Background: 6, Name: noticeClassName}
		c.Size = uint32(unsafe.Sizeof(c))
		user32.NewProc("RegisterClassExW").Call(uintptr(unsafe.Pointer(&c)))
	})
	dpi, _, _ := user32.NewProc("GetDpiForSystem").Call()
	if dpi == 0 {
		dpi = 96
	}
	scale := func(v int32) uintptr { return uintptr(v * int32(dpi) / 96) }
	var area noticeRect
	if ok, _, _ := user32.NewProc("SystemParametersInfoW").Call(0x30, 0, uintptr(unsafe.Pointer(&area)), 0); ok == 0 {
		return false
	}
	w, height := scale(336), scale(132)
	x, y := uintptr(area.Right)-w-scale(14), uintptr(area.Bottom)-height-scale(14)
	caption, heading, detail, accept := "LinkMe 邀请", notice.Title, "", "接听"
	switch notice.Type {
	case "call":
		caption = "LinkMe 来电"
		if notice.Mode == "video" {
			detail = "邀请你进行视频通话"
		} else {
			detail = "邀请你进行语音通话"
		}
	case "remote":
		caption, detail, accept = "LinkMe 远程协助", "邀请你进行远程协助", "同意"
		if notice.Mode == "control" {
			detail = "请求观看并控制你的设备"
		} else if notice.Host == notice.UserID {
			detail = "请求共享屏幕以进行远程协助"
		}
	case "meeting":
		caption, detail, accept = "LinkMe 会议邀请", "会议号 "+notice.Code, "进入会议"
	}
	heading = strings.ReplaceAll(strings.ReplaceAll(heading, "\x00", ""), "\r", " ")
	detail = strings.ReplaceAll(strings.ReplaceAll(detail, "\x00", ""), "\r", " ")
	class, _ := syscall.UTF16PtrFromString("LinkMeIncomingInvitation")
	title, _ := syscall.UTF16PtrFromString(caption)
	hwnd, _, _ := user32.NewProc("CreateWindowExW").Call(0x08000088, uintptr(unsafe.Pointer(class)), uintptr(unsafe.Pointer(title)), 0x80800000, x, y, w, height, 0, 0, module, 0)
	if hwnd == 0 {
		return false
	}
	n := &meetingNotice{window: hwnd, host: h, key: key, code: notice.Code, created: time.Now().UnixNano(), notice: notice}
	meetingNotices.Store(hwnd, n)
	child := func(className, text string, id uintptr, left, top, width, height int32, style uintptr) {
		c, _ := syscall.UTF16PtrFromString(className)
		t, _ := syscall.UTF16PtrFromString(text)
		control, _, _ := user32.NewProc("CreateWindowExW").Call(0, uintptr(unsafe.Pointer(c)), uintptr(unsafe.Pointer(t)), 0x50000000|style, scale(left), scale(top), scale(width), scale(height), hwnd, id, module, 0)
		font, _, _ := syscall.NewLazyDLL("gdi32.dll").NewProc("GetStockObject").Call(17)
		user32.NewProc("SendMessageW").Call(control, 0x30, font, 1)
	}
	child("STATIC", caption, 0, 17, 12, 300, 20, 0x80)
	child("STATIC", heading, 0, 17, 39, 300, 22, 0x0c)
	child("STATIC", detail, 0, 17, 64, 300, 19, 0x0c)
	child("BUTTON", accept, 101, 177, 91, 140, 29, 0x10000)
	child("BUTTON", "拒绝", 102, 84, 91, 82, 29, 0x10000)
	if notice.Type == "call" && notice.Expires > 0 {
		ms := min(notice.Expires-time.Now().UnixMilli(), int64(7200000))
		if ms > 0 {
			user32.NewProc("SetTimer").Call(hwnd, 1, uintptr(ms), 0)
		}
	}
	user32.NewProc("ShowWindow").Call(hwnd, 4)
	user32.NewProc("SetWindowPos").Call(hwnd, ^uintptr(0), x, y, w, height, 0x10|0x40)
	h.layoutMeetingNotices()
	playInviteRing()
	return true
}

func (h *windowsHost) handleIncomingNotice(notice client.Notification, accept bool) {
	action := "reject"
	if accept {
		action = "accept"
	}
	key := notice.Type + "/" + notice.ID
	if notice.Type == "meeting" {
		key = "meeting/" + notice.Code
	}
	h.setActivityUnread(key, false)
	if notice.Type == "meeting" {
		if accept && saveMeetingInvite(h.desktop.directory, notice.Code) == nil {
			h.showWindow()
			h.view.Eval("window.dispatchEvent(new CustomEvent('welink-open-meeting'))")
		}
		return
	}
	raw, err := json.Marshal(map[string]any{"action": action, "notification": notice})
	if err != nil {
		return
	}
	h.desktop.pendingInviteAction = string(raw)
	h.showWindow()
	h.view.Eval("window.dispatchEvent(new CustomEvent('welink-native-invite-action'))")
}

func playInviteRing() {
	if len(inviteRingWAV) == 0 {
		return
	}
	syscall.NewLazyDLL("winmm.dll").NewProc("PlaySoundW").Call(uintptr(unsafe.Pointer(&inviteRingWAV[0])), 0, 0x1|0x4|0x8)
}

func stopInviteRingIfIdle() {
	active := false
	meetingNotices.Range(func(_, value any) bool {
		n := value.(*meetingNotice)
		if n.notice.State == "pending" || n.notice.Type == "call" && n.notice.State == "ringing" {
			active = true
			return false
		}
		return true
	})
	if !active {
		syscall.NewLazyDLL("winmm.dll").NewProc("PlaySoundW").Call(0, 0, 0x40)
	}
}
