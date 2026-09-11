//go:build windows

package main

import (
	"fmt"
	"sort"
	"welink/internal/desktopconfig"
)

type registeredShortcut struct {
	id     uintptr
	action string
}

// Owned by the window thread, just like RegisterHotKey and UnregisterHotKey.
type desktopHotkeys struct {
	hwnd       uintptr
	nextID     uintptr
	registered map[string]registeredShortcut
	errors     map[string]string
	wanted     map[string]string
	register   func(uintptr, desktopconfig.Hotkey) error
	unregister func(uintptr)
}

func newDesktopHotkeys(hwnd uintptr) *desktopHotkeys {
	h := &desktopHotkeys{hwnd: hwnd, nextID: 0x5100, registered: map[string]registeredShortcut{}, errors: map[string]string{}}
	h.register = func(id uintptr, key desktopconfig.Hotkey) error {
		ok, _, err := user32.NewProc("RegisterHotKey").Call(hwnd, id, uintptr(key.Modifiers|0x4000), uintptr(key.Key))
		if ok == 0 {
			return fmt.Errorf("%s 已被其他程序占用或暂不可用：%v", key.Name, err)
		}
		return nil
	}
	h.unregister = func(id uintptr) { user32.NewProc("UnregisterHotKey").Call(hwnd, id) }
	return h
}

func (h *desktopHotkeys) restore(p desktopconfig.Preferences) {
	clear(h.errors)
	h.wanted = p.Shortcuts()
	for name, action := range p.Shortcuts() {
		key, err := desktopconfig.ParseHotkey(name)
		if err == nil {
			h.nextID++
			err = h.register(h.nextID, key)
			if err == nil {
				h.registered[name] = registeredShortcut{h.nextID, action}
			}
		}
		if err != nil {
			h.errors[action] = err.Error()
		}
	}
}

// Keep the old registration until persistence succeeds. A conflict in either
// shortcut rolls back newly acquired keys without disabling the working keys.
func (h *desktopHotkeys) prepare(p desktopconfig.Preferences) (commit, rollback func(), err error) {
	want := p.Shortcuts()
	remainingErrors := map[string]string{}
	added := map[string]registeredShortcut{}
	rollback = func() {
		for _, shortcut := range added {
			h.unregister(shortcut.id)
		}
		clear(added)
	}
	names := make([]string, 0, len(want))
	for name := range want {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if _, exists := h.registered[name]; exists {
			continue
		}
		key, parseErr := desktopconfig.ParseHotkey(name)
		if parseErr != nil {
			rollback()
			return nil, nil, parseErr
		}
		for {
			h.nextID++
			if h.nextID >= 0xbfff {
				h.nextID = 0x5100
			}
			used := false
			for _, v := range h.registered {
				used = used || v.id == h.nextID
			}
			for _, v := range added {
				used = used || v.id == h.nextID
			}
			if !used {
				break
			}
		}
		if err = h.register(h.nextID, key); err != nil {
			// A key already unavailable at startup must not prevent saving
			// unrelated preferences. A newly chosen conflict still rejects save.
			if h.wanted[name] == want[name] && h.errors[want[name]] != "" {
				remainingErrors[want[name]] = err.Error()
				continue
			}
			rollback()
			return nil, nil, err
		}
		added[name] = registeredShortcut{h.nextID, want[name]}
	}
	commit = func() {
		for name, shortcut := range h.registered {
			if _, keep := want[name]; !keep {
				h.unregister(shortcut.id)
				delete(h.registered, name)
			}
		}
		for name, shortcut := range added {
			h.registered[name] = shortcut
		}
		for name, shortcut := range h.registered {
			shortcut.action = want[name]
			h.registered[name] = shortcut
		}
		clear(added)
		h.errors = remainingErrors
		h.wanted = want
	}
	return commit, rollback, nil
}

func (h *desktopHotkeys) action(id uintptr) string {
	for _, shortcut := range h.registered {
		if shortcut.id == id {
			return shortcut.action
		}
	}
	return ""
}

func (h *desktopHotkeys) close() {
	for _, shortcut := range h.registered {
		h.unregister(shortcut.id)
	}
	clear(h.registered)
}
