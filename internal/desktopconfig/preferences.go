package desktopconfig

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

type Preferences struct {
	CloseToTray    bool   `json:"closeToTray"`
	MessageSound   bool   `json:"messageSound"`
	MessageAlerts  bool   `json:"messageAlerts"`
	AutoStart      bool   `json:"autoStart"`
	StartMinimized bool   `json:"startMinimized"`
	HotkeysEnabled bool   `json:"hotkeysEnabled"`
	ShowHotkey     string `json:"showHotkey"`
	CaptureHotkey  string `json:"captureHotkey"`
}

func Defaults() Preferences {
	return Preferences{CloseToTray: true, MessageAlerts: true, MessageSound: true, StartMinimized: true, HotkeysEnabled: true, ShowHotkey: "Ctrl+Alt+W", CaptureHotkey: "Ctrl+Alt+A"}
}

type Hotkey struct {
	Name      string
	Modifiers uint32
	Key       uint32
}

func ParseHotkey(value string) (Hotkey, error) {
	var result Hotkey
	if value == "" {
		return result, nil
	}
	if len(value) > 40 {
		return result, errors.New("快捷键格式无效")
	}
	parts := strings.Split(strings.ToUpper(strings.TrimSpace(value)), "+")
	if len(parts) < 2 {
		return result, errors.New("全局快捷键必须包含 Ctrl 或 Alt")
	}
	for _, part := range parts[:len(parts)-1] {
		var modifier uint32
		switch strings.TrimSpace(part) {
		case "CTRL":
			modifier = 2
		case "ALT":
			modifier = 1
		case "SHIFT":
			modifier = 4
		default:
			return result, errors.New("快捷键仅支持 Ctrl、Alt 和 Shift 修饰键")
		}
		if result.Modifiers&modifier != 0 {
			return result, errors.New("快捷键包含重复修饰键")
		}
		result.Modifiers |= modifier
	}
	if result.Modifiers&3 == 0 {
		return result, errors.New("全局快捷键必须包含 Ctrl 或 Alt")
	}
	key := strings.TrimSpace(parts[len(parts)-1])
	if len(key) == 1 && (key[0] >= 'A' && key[0] <= 'Z' || key[0] >= '0' && key[0] <= '9') {
		result.Key = uint32(key[0])
	} else if strings.HasPrefix(key, "F") {
		number, err := strconv.Atoi(key[1:])
		if err != nil || number < 1 || number > 24 || number == 12 {
			return result, errors.New("请选择字母、数字或功能键；F12 为系统保留键")
		}
		result.Key = uint32(111 + number)
		key = "F" + strconv.Itoa(number)
	} else {
		return result, errors.New("快捷键主键须为字母、数字或功能键")
	}
	for _, modifier := range []struct {
		value uint32
		name  string
	}{{2, "Ctrl"}, {1, "Alt"}, {4, "Shift"}} {
		if result.Modifiers&modifier.value != 0 {
			result.Name += modifier.name + "+"
		}
	}
	result.Name += key
	return result, nil
}

func (p Preferences) Normalize() (Preferences, error) {
	show, err := ParseHotkey(p.ShowHotkey)
	if err != nil {
		return p, fmt.Errorf("显示主界面：%w", err)
	}
	capture, err := ParseHotkey(p.CaptureHotkey)
	if err != nil {
		return p, fmt.Errorf("截图：%w", err)
	}
	p.ShowHotkey, p.CaptureHotkey = show.Name, capture.Name
	if p.HotkeysEnabled && show.Name != "" && show.Name == capture.Name {
		return p, errors.New("显示主界面和截图不能使用同一个快捷键")
	}
	return p, nil
}

func (p Preferences) Shortcuts() map[string]string {
	if !p.HotkeysEnabled {
		return map[string]string{}
	}
	result := make(map[string]string)
	if p.ShowHotkey != "" {
		result[p.ShowHotkey] = "show"
	}
	if p.CaptureHotkey != "" {
		result[p.CaptureHotkey] = "capture"
	}
	return result
}
