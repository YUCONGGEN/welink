//go:build windows

package main

import (
	"errors"
	webview "github.com/jchv/go-webview2"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"unsafe"
	"welink/internal/nativeinit"
)

var user32 = syscall.NewLazyDLL("user32.dll")

type windowsHost struct {
	view    webview.WebView
	hwnd    uintptr
	desktop desktopState
}

func newWindow(address, dir string) (windowHost, error) {
	runtime.LockOSThread()
	if err := nativeinit.Prepare(dir); err != nil {
		return nil, err
	}
	log.Print("initializing WebView2 window")
	dpi, _, _ := user32.NewProc("GetDpiForSystem").Call()
	if dpi == 0 {
		dpi = 96
	}
	v := webview.NewWithOptions(webview.WebViewOptions{Debug: os.Getenv("WELINK_DEBUG") == "1", DataPath: filepath.Join(dir, "webview"), AutoFocus: true, WindowOptions: webview.WindowOptions{Title: "WeLink", Width: uint(1100 * dpi / 96), Height: uint(740 * dpi / 96), IconId: 1, Center: true}})
	if v == nil {
		return nil, errors.New("无法启动 WebView2，请安装 Microsoft Edge WebView2 Runtime")
	}
	log.Printf("WebView2 window initialized: %v", v.Window() != nil)
	h := &windowsHost{view: v, hwnd: uintptr(v.Window())}
	get := user32.NewProc("GetWindowLongW")
	set := user32.NewProc("SetWindowLongW")
	index := int32(-16)
	style, _, _ := get.Call(h.hwnd, uintptr(index))
	set.Call(h.hwnd, uintptr(index), style&^uintptr(0x00c00000))
	user32.NewProc("SetWindowPos").Call(h.hwnd, 0, 0, 0, 0, 0, 0x0027)
	v.SetSize(760, 540, webview.HintMin)
	if err := h.installDesktop(dir); err != nil {
		v.Destroy()
		return nil, err
	}
	v.Bind("welinkDrag", func() {
		user32.NewProc("ReleaseCapture").Call()
		user32.NewProc("SendMessageW").Call(h.hwnd, 0x00A1, 2, 0)
	})
	v.Navigate(address)
	// StartupInfo from a launcher may request SW_HIDE. Show the user window
	// explicitly after WebView initialization so installation launches are visible.
	user32.NewProc("ShowWindow").Call(h.hwnd, 5)
	if os.Getenv("WELINK_DEBUG") == "1" {
		v.Bind("welinkDiagnostic", func(report string) {
			_ = os.WriteFile(filepath.Join(dir, "native-diagnostic.json"), []byte(report), 0600)
		})
		v.Init(`addEventListener('DOMContentLoaded',()=>{const t=setInterval(async()=>{if(!document.querySelector('#auth-form'))return;clearInterval(t);try{const cfg=await fetch('/local/config').then(r=>r.json());const status=(await fetch('/api/me')).status;document.querySelector('[data-action=register]').click();const registration=!!document.querySelector('[name=name]');document.querySelector('[data-action=login]').click();await welinkDiagnostic(JSON.stringify({ready:true,server:cfg.server,status,registration,width:innerWidth,height:innerHeight}));}catch(e){await welinkDiagnostic(JSON.stringify({error:String(e)}))}},200)});`)
		// Bind/Init must also cover the first document if its load already started.
		v.Navigate(address)
	}
	return h, nil
}
func (h *windowsHost) Run() { h.view.Run() }
func (h *windowsHost) Close() {
	h.removeDesktop()
	user32.NewProc("DestroyWindow").Call(h.hwnd)
	runtime.UnlockOSThread()
}
func (h *windowsHost) Action(action string) {
	h.view.Dispatch(func() {
		switch action {
		case "min":
			user32.NewProc("ShowWindow").Call(h.hwnd, 6)
		case "max":
			zoom, _, _ := user32.NewProc("IsZoomed").Call(h.hwnd)
			if zoom != 0 {
				user32.NewProc("ShowWindow").Call(h.hwnd, 9)
			} else {
				user32.NewProc("ShowWindow").Call(h.hwnd, 3)
			}
		case "close":
			h.closeWindow()
		case "show":
			h.showWindow()
		case "quit":
			h.exitDesktop()
		}
	})
}
func showError(message string) {
	text, _ := syscall.UTF16PtrFromString(message)
	title, _ := syscall.UTF16PtrFromString("WeLink")
	user32.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), 0x10)
}
