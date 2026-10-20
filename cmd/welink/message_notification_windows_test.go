//go:build windows

package main

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
	"welink/internal/client"
)

func TestNativeMessageDoesNotPopupAndUnreadPulsesTaskbar(t *testing.T) {
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
		h.Notify(client.Notification{Type: "unread", Unread: 1})
		h.view.Dispatch(func() {
			var failure error
			defer func() { done <- failure; h.exitDesktop() }()
			count := 0
			meetingNotices.Range(func(key, value any) bool {
				if value.(*meetingNotice).host == h {
					count++
				}
				return true
			})
			if count != 0 {
				failure = fmt.Errorf("ordinary message created %d desktop popup(s)", count)
				return
			}
			if h.desktop.unread != 1 || !h.desktop.greenPhase || h.desktop.greenIcon == 0 {
				failure = fmt.Errorf("unread message did not pulse the taskbar icon: %+v", h.desktop)
			}
		})
	}()
	h.Run()
	h.Close()
	if err = <-done; err != nil {
		t.Fatal(err)
	}
}
