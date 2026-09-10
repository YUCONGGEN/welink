//go:build windows

package main

import (
	"fmt"
	"os"
	"testing"
	"time"
	"unsafe"
)

func TestNativeMeetingNotificationWhileHidden(t *testing.T) {
	if os.Getenv("WELINK_NATIVE_DESKTOP_TEST") != "1" {
		t.Skip("opt-in native meeting notification")
	}
	dir := t.TempDir()
	window, err := newWindow("about:blank", dir)
	if err != nil {
		t.Fatal(err)
	}
	h := window.(*windowsHost)
	done := make(chan error, 1)
	go func() {
		time.Sleep(200 * time.Millisecond)
		h.view.Dispatch(func() {
			var failure error
			defer func() { done <- failure; h.exitDesktop() }()
			h.closeWindow()
			user32.NewProc("ShowWindow").Call(h.hwnd, 0)
			if !h.showMeetingNotice("123456789", "摄影交流邀请", time.Now().Add(time.Minute).UnixMilli()) {
				failure = fmt.Errorf("native popup was not created")
				return
			}
			var notice uintptr
			meetingNotices.Range(func(key, value any) bool {
				if value.(*meetingNotice).host == h {
					notice = key.(uintptr)
				}
				return true
			})
			visible, _, _ := user32.NewProc("IsWindowVisible").Call(notice)
			if notice == 0 || visible == 0 {
				failure = fmt.Errorf("popup hidden with main window")
				return
			}
			h.showMeetingNotice("123456789", "摄影交流邀请", time.Now().Add(time.Minute).UnixMilli())
			duplicates := 0
			meetingNotices.Range(func(_, value any) bool {
				if value.(*meetingNotice).host == h {
					duplicates++
				}
				return true
			})
			if duplicates != 1 {
				failure = fmt.Errorf("repeated invitation created %d popups", duplicates)
				return
			}
			var rect, work noticeRect
			user32.NewProc("GetWindowRect").Call(notice, uintptr(unsafe.Pointer(&rect)))
			user32.NewProc("SystemParametersInfoW").Call(0x30, 0, uintptr(unsafe.Pointer(&work)), 0)
			if rect.Right > work.Right || rect.Bottom > work.Bottom || work.Right-rect.Right > 80 || work.Bottom-rect.Bottom > 80 {
				failure = fmt.Errorf("popup is not at work-area bottom right: %+v %+v", rect, work)
				return
			}
			user32.NewProc("SendMessageW").Call(notice, 0x111, 101, 0)
			if takeMeetingInvite(dir) != "123456789" {
				failure = fmt.Errorf("click did not transfer invitation")
				return
			}
			visible, _, _ = user32.NewProc("IsWindowVisible").Call(h.hwnd)
			if visible == 0 {
				failure = fmt.Errorf("click did not restore main window")
			}
			if _, exists := meetingNotices.Load(notice); exists {
				failure = fmt.Errorf("clicked popup was not removed")
			}
			for _, code := range []string{"234567891", "345678912", "456789123", "567891234"} {
				h.showMeetingNotice(code, "其他会议邀请", time.Now().Add(time.Minute).UnixMilli())
			}
			count := 0
			meetingNotices.Range(func(_, v any) bool {
				if v.(*meetingNotice).host == h {
					count++
				}
				return true
			})
			if count != 3 {
				failure = fmt.Errorf("notification stack count %d", count)
			}
			h.closeMeetingNotices()
			meetingNotices.Range(func(_, v any) bool {
				if v.(*meetingNotice).host == h {
					failure = fmt.Errorf("notifications retained after clearing")
				}
				return true
			})
		})
	}()
	h.Run()
	h.Close()
	if err = <-done; err != nil {
		t.Fatal(err)
	}
}
