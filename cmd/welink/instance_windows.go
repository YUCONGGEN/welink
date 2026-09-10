//go:build windows

package main

import (
	"crypto/sha256"
	"fmt"
	"path/filepath"
	"strings"
	"sync/atomic"

	"golang.org/x/sys/windows"
)

type desktopInstance struct {
	mutex, event windows.Handle
	stopping     atomic.Bool
	done         chan struct{}
}

// Kernel object lifetime follows the process, so a crash cannot leave a stale lock.
func acquireInstance(directory string) (instanceGuard, bool, error) {
	absolute, err := filepath.Abs(directory)
	if err != nil {
		return nil, false, err
	}
	if resolved, e := filepath.EvalSymlinks(absolute); e == nil {
		absolute = resolved
	}
	name := fmt.Sprintf(`Local\WeLink.%x`, sha256.Sum256([]byte(strings.ToLower(filepath.Clean(absolute)))))
	eventName, _ := windows.UTF16PtrFromString(name + ".Activate")
	// Create the event first: a second launch can signal while the first is starting.
	event, err := windows.CreateEvent(nil, 0, 0, eventName)
	if err != nil && err != windows.ERROR_ALREADY_EXISTS {
		return nil, false, err
	}
	mutexName, _ := windows.UTF16PtrFromString(name)
	mutex, err := windows.CreateMutex(nil, false, mutexName)
	if err == windows.ERROR_ALREADY_EXISTS {
		err = windows.SetEvent(event)
		windows.CloseHandle(event)
		windows.CloseHandle(mutex)
		return nil, true, err
	}
	if err != nil {
		windows.CloseHandle(event)
		return nil, false, err
	}
	return &desktopInstance{mutex: mutex, event: event}, false, nil
}

func (d *desktopInstance) Watch(activate func()) {
	d.done = make(chan struct{})
	go func() {
		defer close(d.done)
		for {
			status, err := windows.WaitForSingleObject(d.event, windows.INFINITE)
			if err != nil || status != windows.WAIT_OBJECT_0 || d.stopping.Load() {
				return
			}
			activate()
		}
	}()
}

func (d *desktopInstance) Close() {
	if d.stopping.Swap(true) {
		return
	}
	if d.done != nil {
		windows.SetEvent(d.event)
		<-d.done
	}
	windows.CloseHandle(d.event)
	windows.CloseHandle(d.mutex)
}
