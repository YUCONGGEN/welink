//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
	"unsafe"
	"welink/internal/client"
)

func TestNativeMessageNotificationClickWhileHidden(t *testing.T) {
	if os.Getenv("WELINK_NATIVE_DESKTOP_TEST") != "1" {
		t.Skip("opt-in native window test")
	}
	_ = os.MkdirAll(".local/native-desktop-tests", 0700)
	dir, err := os.MkdirTemp(".local/native-desktop-tests", "message-")
	if err != nil {
		t.Fatal(err)
	}
	w, err := newWindow("about:blank", dir)
	if err != nil {
		t.Fatal(err)
	}
	h := w.(*windowsHost)
	n := client.Notification{Type: "message", UserID: strings.Repeat("1", 32), ConversationID: strings.Repeat("2", 32), MessageID: strings.Repeat("3", 32), Title: "林知夏", Body: "下午三点开会"}
	done := make(chan error, 1)
	go func() {
		time.Sleep(200 * time.Millisecond)
		h.view.Dispatch(func() { h.closeWindow(); h.desktop.preferences.MessageSound = false })
		h.Notify(n)
		h.view.Dispatch(func() {
			var failure error
			defer func() { done <- failure; h.exitDesktop() }()
			var popup uintptr
			meetingNotices.Range(func(key, value any) bool {
				v := value.(*meetingNotice)
				if v.host == h && v.message != nil {
					popup = key.(uintptr)
				}
				return true
			})
			visible, _, _ := user32.NewProc("IsWindowVisible").Call(popup)
			if popup == 0 || visible == 0 {
				failure = fmt.Errorf("message popup absent while main window hidden")
				return
			}
			var rect, work noticeRect
			user32.NewProc("GetWindowRect").Call(popup, uintptr(unsafe.Pointer(&rect)))
			user32.NewProc("SystemParametersInfoW").Call(0x30, 0, uintptr(unsafe.Pointer(&work)), 0)
			if rect.Right > work.Right || rect.Bottom > work.Bottom || work.Right-rect.Right > 80 || work.Bottom-rect.Bottom > 80 {
				failure = fmt.Errorf("message popup outside bottom-right work area")
				return
			}
			user32.NewProc("SendMessageW").Call(popup, 0x111, 101, 0)
			var pending client.Notification
			if json.Unmarshal([]byte(h.desktop.pendingMessage), &pending) != nil || pending.ConversationID != n.ConversationID || pending.UserID != n.UserID {
				failure = fmt.Errorf("notification click did not target its conversation")
				return
			}
			visible, _, _ = user32.NewProc("IsWindowVisible").Call(h.hwnd)
			if visible == 0 {
				failure = fmt.Errorf("notification click did not restore main window")
			}
			if _, exists := meetingNotices.Load(popup); exists {
				failure = fmt.Errorf("clicked notification remained")
			}
		})
	}()
	h.Run()
	h.Close()
	if err = <-done; err != nil {
		t.Fatal(err)
	}
}
