//go:build !windows

package main

import (
	"errors"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
)

// browserHost keeps the same local client security boundary on platforms where
// the repository does not bundle a native WebView. macOS opens the local UI in
// the user's default browser, while the Go process remains the notification and
// remote-control owner. This gives us a small, signed arm64 binary without a
// second embedded browser runtime.
type browserHost struct {
	address string
	done    chan struct{}
	once    sync.Once
}

func newWindow(address, dir string) (windowHost, error) {
	if err := exec.Command("open", address).Run(); err != nil {
		return nil, errors.New("无法打开 LinkMe 窗口: " + err.Error())
	}
	return &browserHost{address: address, done: make(chan struct{})}, nil
}
func showError(message string) { log.Print(message) }

func (h *browserHost) Action(action string) {
	if action == "quit" {
		h.Close()
	} else if action == "show" {
		_ = exec.Command("open", h.address).Run()
	}
}
func (h *browserHost) Run()   { <-h.done }
func (h *browserHost) Close() { h.once.Do(func() { close(h.done) }) }

type otherInstance struct{ path string }

func (i *otherInstance) Watch(func()) {}
func (i *otherInstance) Close()       { _ = os.Remove(i.path) }

func acquireInstance(directory string) (instanceGuard, bool, error) {
	path := filepath.Join(directory, "client.lock")
	for attempt := 0; attempt < 2; attempt++ {
		file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err == nil {
			_, writeErr := file.WriteString(strconv.Itoa(os.Getpid()))
			closeErr := file.Close()
			if writeErr != nil || closeErr != nil {
				_ = os.Remove(path)
				return nil, false, errors.Join(writeErr, closeErr)
			}
			return &otherInstance{path: path}, false, nil
		}
		if !os.IsExist(err) {
			return nil, false, err
		}
		raw, readErr := os.ReadFile(path)
		pid, parseErr := strconv.Atoi(strings.TrimSpace(string(raw)))
		if readErr == nil && parseErr == nil && pid > 0 {
			if killErr := syscall.Kill(pid, 0); killErr == nil || !errors.Is(killErr, syscall.ESRCH) {
				return nil, true, nil
			}
		}
		if err = os.Remove(path); err != nil && !os.IsNotExist(err) {
			return nil, false, err
		}
	}
	return nil, false, errors.New("LinkMe 已在运行")
}
