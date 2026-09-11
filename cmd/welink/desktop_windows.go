//go:build windows

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
	"unsafe"
	"welink/internal/desktopconfig"
)

var shellNotify = syscall.NewLazyDLL("shell32.dll").NewProc("Shell_NotifyIconW")
var commonControls = syscall.NewLazyDLL("comctl32.dll")
var desktopWindows sync.Map

const desktopTrayMessage = 0x803c

// NOTIFYICONDATAW layout follows the Windows SDK (also used by YuDesk's tray).
type notifyIconData struct {
	Size                uint32
	Window              uintptr
	ID, Flags, Callback uint32
	Icon                uintptr
	Tip                 [128]uint16
	State, StateMask    uint32
	Info                [256]uint16
	Version             uint32
	InfoTitle           [64]uint16
	InfoFlags           uint32
	GUID                [16]byte
	BalloonIcon         uintptr
}

type desktopPreferences = desktopconfig.Preferences

// All fields belong to the WebView's UI thread. Other goroutines use Dispatch.
type desktopState struct {
	directory                      string
	preferences                    desktopPreferences
	icon                           notifyIconData
	trayAvailable, hidden, closing bool
	taskbarCreated                 uint32
	unread                         int
	lastAlert                      time.Time
	hotkeys                        *desktopHotkeys
	startup                        *desktopStartup
	done                           chan struct{}
	capture                        *screenshotSelection
	capturePending                 bool
	captureVersion                 uint64
	captureCancel                  chan struct{}
	captureWasHidden               bool
}

var desktopSubclass = syscall.NewCallback(func(hwnd, message, wp, lp, id, ref uintptr) uintptr {
	if value, ok := desktopWindows.Load(hwnd); ok {
		h := value.(*windowsHost)
		switch message {
		case 0x0312: // WM_HOTKEY
			if h.desktop.hotkeys != nil {
				switch h.desktop.hotkeys.action(wp) {
				case "show":
					h.showWindow()
				case "capture":
					h.view.Eval(`window.dispatchEvent(new CustomEvent('welink-screenshot-request'));`)
				}
			}
			return 0
		case 0x10: // WM_CLOSE, including Alt+F4 and the system menu.
			h.closeWindow()
			return 0
		case 0x18: // WM_SHOWWINDOW
			h.visibility(wp == 0)
		case 0x05: // WM_SIZE
			visible, _, _ := user32.NewProc("IsWindowVisible").Call(hwnd)
			h.visibility(wp == 1 || visible == 0)
		case 0x11: // WM_QUERYENDSESSION: never obstruct sign-out or shutdown.
			return 1
		case 0x16: // WM_ENDSESSION
			if wp != 0 {
				h.exitDesktop()
			}
			return 0
		case desktopTrayMessage:
			switch uint32(lp) & 0xffff {
			case 0x203, 0x400, 0x401, 0x405: // double click, select, keyboard, balloon click
				h.showWindow()
			case 0x7b: // WM_CONTEXTMENU, mouse or keyboard
				h.trayMenu()
			}
			return 0
		}
		if uint32(message) == h.desktop.taskbarCreated && h.desktop.taskbarCreated != 0 {
			h.desktop.trayAvailable = false
			h.addTray()
			if !h.desktop.trayAvailable && h.desktop.hidden {
				h.showWindow()
			}
			return 0
		}
	}
	r, _, _ := commonControls.NewProc("DefSubclassProc").Call(hwnd, message, wp, lp)
	return r
})

func (h *windowsHost) installDesktop(directory string) error {
	h.desktop = desktopState{directory: directory, preferences: desktopconfig.Defaults(), done: make(chan struct{})}
	if raw, err := os.ReadFile(filepath.Join(directory, "desktop.json")); err == nil {
		preferences := h.desktop.preferences
		if err = json.Unmarshal(raw, &preferences); err != nil {
			log.Printf("desktop preferences: %v", err)
		} else {
			h.desktop.preferences = preferences
		}
	}
	if p, err := h.desktop.preferences.Normalize(); err == nil {
		h.desktop.preferences = p
	} else {
		log.Print("desktop shortcuts invalid; using defaults")
		h.desktop.preferences.ShowHotkey = desktopconfig.Defaults().ShowHotkey
		h.desktop.preferences.CaptureHotkey = desktopconfig.Defaults().CaptureHotkey
	}
	desktopWindows.Store(h.hwnd, h)
	result, _, err := commonControls.NewProc("SetWindowSubclass").Call(h.hwnd, desktopSubclass, 1, 0)
	if result == 0 {
		desktopWindows.Delete(h.hwnd)
		return fmt.Errorf("初始化桌面窗口失败: %v", err)
	}
	module, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetModuleHandleW").Call(0)
	icon, _, _ := user32.NewProc("LoadImageW").Call(module, windowsIconResource, 1, 32, 32, 0x8000) // resource icon, LR_SHARED
	if icon == 0 {
		icon, _, _ = user32.NewProc("LoadIconW").Call(0, 32512)
	}
	h.desktop.icon = notifyIconData{Window: h.hwnd, ID: 1, Flags: 0x87, Callback: desktopTrayMessage, Icon: icon}
	h.desktop.icon.Size = uint32(unsafe.Sizeof(h.desktop.icon))
	name, _ := syscall.UTF16PtrFromString("TaskbarCreated")
	restart, _, _ := user32.NewProc("RegisterWindowMessageW").Call(uintptr(unsafe.Pointer(name)))
	h.desktop.taskbarCreated = uint32(restart)
	h.addTray()
	h.desktop.hotkeys = newDesktopHotkeys(h.hwnd)
	h.desktop.hotkeys.restore(h.desktop.preferences)
	h.desktop.startup = newDesktopStartup(directory)
	h.view.Bind("welinkDesktopSettings", func() map[string]any {
		raw, _ := json.Marshal(h.desktop.preferences)
		result := map[string]any{}
		_ = json.Unmarshal(raw, &result)
		result["trayAvailable"] = h.desktop.trayAvailable
		result["hotkeyErrors"] = h.desktop.hotkeys.errors
		result["autoStartRegistered"] = h.desktop.startup.registered()
		return result
	})
	h.view.Bind("welinkDesktopSave", func(p desktopPreferences) error {
		var err error
		p, err = p.Normalize()
		if err != nil {
			return err
		}
		commit, rollback, err := h.desktop.hotkeys.prepare(p)
		if err != nil {
			return err
		}
		defer rollback()
		undoStartup, err := h.desktop.startup.prepare(p.AutoStart)
		if err != nil {
			return err
		}
		if err = h.persistDesktopPreferences(p); err != nil {
			return errors.Join(err, undoStartup())
		}
		commit()
		h.desktop.preferences = p
		return nil
	})
	h.view.Bind("welinkScreenshotCapture", func() bool {
		if h.desktop.closing || h.desktop.capturePending {
			return false
		}
		h.beginScreenshot()
		return true
	})
	h.view.Bind("welinkScreenshotCancel", h.cancelScreenshot)
	h.view.Bind("welinkScreenshotCopy", func(encoded string) error { return copyScreenshot(encoded) })
	h.view.Bind("welinkDesktopUnread", func(count int) { h.setUnread(count) })
	h.view.Bind("welinkDesktopExit", func() { h.Action("quit") })
	h.view.Bind("welinkMeetingInvitation", func() string { return takeMeetingInvite(directory) })
	h.view.Bind("welinkMeetingNotify", func(code, title string, expires int64) bool { return h.showMeetingNotice(code, title, expires) })
	h.view.Bind("welinkMeetingClear", func() { h.closeMeetingNotices() })
	h.view.Init(`window.welinkNativeHidden=false;`)
	return nil
}

func (h *windowsHost) persistDesktopPreferences(p desktopPreferences) error {
	raw, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(h.desktop.directory, "desktop.json")
	if err = os.WriteFile(path+".tmp", raw, 0600); err != nil {
		return fmt.Errorf("无法保存桌面设置: %w", err)
	}
	if err = os.Rename(path+".tmp", path); err != nil {
		_ = os.Remove(path + ".tmp")
		return fmt.Errorf("无法保存桌面设置: %w", err)
	}
	return nil
}

func (h *windowsHost) addTray() {
	if h.desktop.closing {
		return
	}
	d := &h.desktop.icon
	h.trayTip()
	d.Flags = 0x87 // NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_SHOWTIP
	result, _, _ := shellNotify.Call(0, uintptr(unsafe.Pointer(d)))
	h.desktop.trayAvailable = result != 0
	if result != 0 {
		d.Version = 4
		shellNotify.Call(4, uintptr(unsafe.Pointer(d)))
	} else {
		log.Print("tray unavailable; close will minimize the window")
	}
}

func (h *windowsHost) trayTip() {
	text := "WeLink · 双击打开，右键退出"
	if h.desktop.unread > 0 {
		text = fmt.Sprintf("WeLink · %d 条未读消息", h.desktop.unread)
	}
	h.desktop.icon.Tip = [128]uint16{}
	copy(h.desktop.icon.Tip[:], syscall.StringToUTF16(text))
}

func (h *windowsHost) setUnread(count int) {
	count = max(0, min(99999, count))
	before := h.desktop.unread
	h.desktop.unread = count
	if !h.desktop.trayAvailable {
		return
	}
	h.trayTip()
	d := h.desktop.icon
	d.Flags = 0x84 // tooltip; balloon text never includes private message content
	if count == 0 {
		d.Flags |= 0x10
	} // Empty NIF_INFO dismisses a previous balloon.
	if count > before && h.desktop.hidden && h.desktop.preferences.MessageAlerts && time.Since(h.desktop.lastAlert) > 5*time.Second {
		d.Flags |= 0x10
		d.InfoFlags = 0x81 // NIIF_INFO | NIIF_RESPECT_QUIET_TIME
		copy(d.InfoTitle[:], syscall.StringToUTF16("WeLink"))
		copy(d.Info[:], syscall.StringToUTF16(fmt.Sprintf("你有 %d 条未读消息，点击打开 WeLink。", count)))
		h.desktop.lastAlert = time.Now()
	}
	shellNotify.Call(1, uintptr(unsafe.Pointer(&d)))
}

func (h *windowsHost) visibility(hidden bool) {
	if h.desktop.hidden == hidden || h.desktop.closing {
		return
	}
	h.desktop.hidden = hidden
	h.view.Dispatch(func() {
		if h.desktop.closing {
			return
		}
		h.view.Eval(fmt.Sprintf(`window.welinkNativeHidden=%t;window.dispatchEvent(new CustomEvent('welink-native-visibility',{detail:{hidden:%t}}));`, h.desktop.hidden, h.desktop.hidden))
	})
}

func (h *windowsHost) showWindow() {
	if h.desktop.closing {
		return
	}
	minimized, _, _ := user32.NewProc("IsIconic").Call(h.hwnd)
	if minimized != 0 {
		user32.NewProc("ShowWindow").Call(h.hwnd, 9)
	} else {
		user32.NewProc("ShowWindow").Call(h.hwnd, 5)
	}
	user32.NewProc("SetForegroundWindow").Call(h.hwnd)
	if err := h.view.SetVisible(true); err != nil {
		log.Printf("restore WebView2 controller: %v", err)
	}
	h.visibility(false)
}

func (h *windowsHost) closeWindow() {
	if h.desktop.closing {
		return
	}
	if !h.desktop.preferences.CloseToTray {
		h.exitDesktop()
		return
	}
	if h.desktop.trayAvailable {
		if err := h.view.SetVisible(false); err != nil {
			log.Printf("hide WebView2 controller: %v", err)
		}
		user32.NewProc("ShowWindow").Call(h.hwnd, 0)
	} else {
		user32.NewProc("ShowWindow").Call(h.hwnd, 6)
	}
	h.visibility(true)
}

func (h *windowsHost) trayMenu() {
	menu, _, _ := user32.NewProc("CreatePopupMenu").Call()
	if menu == 0 {
		return
	}
	defer user32.NewProc("DestroyMenu").Call(menu)
	show, _ := syscall.UTF16PtrFromString("打开 WeLink")
	quit, _ := syscall.UTF16PtrFromString("退出 WeLink")
	user32.NewProc("AppendMenuW").Call(menu, 0, 1, uintptr(unsafe.Pointer(show)))
	user32.NewProc("AppendMenuW").Call(menu, 0x800, 0, 0)
	user32.NewProc("AppendMenuW").Call(menu, 0, 2, uintptr(unsafe.Pointer(quit)))
	var point struct{ X, Y int32 }
	user32.NewProc("GetCursorPos").Call(uintptr(unsafe.Pointer(&point)))
	user32.NewProc("SetForegroundWindow").Call(h.hwnd)
	command, _, _ := user32.NewProc("TrackPopupMenu").Call(menu, 0x102, uintptr(point.X), uintptr(point.Y), 0, h.hwnd, 0)
	user32.NewProc("PostMessageW").Call(h.hwnd, 0, 0, 0)
	if command == 1 {
		h.showWindow()
	} else if command == 2 {
		h.exitDesktop()
	}
}

func (h *windowsHost) exitDesktop() {
	if h.desktop.closing {
		return
	}
	h.desktop.closing = true
	h.stopDesktopExtras()
	h.closeMeetingNotices()
	if h.desktop.trayAvailable {
		shellNotify.Call(2, uintptr(unsafe.Pointer(&h.desktop.icon)))
		h.desktop.trayAvailable = false
	}
	h.view.Terminate()
}

func (h *windowsHost) removeDesktop() {
	h.stopDesktopExtras()
	h.closeMeetingNotices()
	if h.desktop.trayAvailable {
		shellNotify.Call(2, uintptr(unsafe.Pointer(&h.desktop.icon)))
	}
	h.desktop.closing = true
	commonControls.NewProc("RemoveWindowSubclass").Call(h.hwnd, desktopSubclass, 1)
	desktopWindows.Delete(h.hwnd)
}

func (h *windowsHost) stopDesktopExtras() {
	if h.desktop.hotkeys != nil {
		h.desktop.hotkeys.close()
	}
	if h.desktop.done != nil {
		select {
		case <-h.desktop.done:
		default:
			close(h.desktop.done)
		}
	}
	if h.desktop.capture != nil {
		h.desktop.capture.finish(false)
	}
}

func (h *windowsHost) startupWindow() {
	if !h.desktop.preferences.StartMinimized {
		return
	}
	if h.desktop.trayAvailable {
		_ = h.view.SetVisible(false)
		user32.NewProc("ShowWindow").Call(h.hwnd, 0)
	} else {
		user32.NewProc("ShowWindow").Call(h.hwnd, 6)
	}
	h.visibility(true)
}
