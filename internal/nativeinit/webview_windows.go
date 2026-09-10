//go:build windows

package nativeinit

import (
	"bytes"
	"github.com/jchv/go-webview2/webviewloader"
	"golang.org/x/sys/windows"
	"os"
	"path/filepath"
	"sync"
)

var once sync.Once
var initError error
var loader *windows.DLL

// Load the bundled Microsoft loader through the OS so its environment and
// activation-context handling matches the native WebView2 SDK.
func Prepare(directory string) error {
	once.Do(func() {
		dir := filepath.Join(directory, "runtime")
		if e := os.MkdirAll(dir, 0700); e != nil {
			initError = e
			return
		}
		path := filepath.Join(dir, "WebView2Loader.dll")
		old, _ := os.ReadFile(path)
		if !bytes.Equal(old, webviewloader.WebView2Loader) {
			if e := os.WriteFile(path, webviewloader.WebView2Loader, 0600); e != nil {
				initError = e
				return
			}
		}
		loader, initError = windows.LoadDLL(path)
	})
	return initError
}
