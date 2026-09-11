package desktopconfig

import (
	"encoding/json"
	"testing"
)

func TestHotkeyNormalizationAndReservedKeys(t *testing.T) {
	for _, input := range []string{"alt+ctrl+w", " Ctrl + Alt + w "} {
		key, err := ParseHotkey(input)
		if err != nil || key.Name != "Ctrl+Alt+W" || key.Modifiers != 3 || key.Key != 'W' {
			t.Fatalf("normalization: %+v %v", key, err)
		}
	}
	for _, input := range []string{"A", "Shift+A", "Win+A", "Ctrl+Ctrl+A", "Ctrl+Alt+F12", "Ctrl+F25", "Ctrl+", "Ctrl+A+B", "Ctrl+Alt+Delete"} {
		if _, err := ParseHotkey(input); err == nil {
			t.Fatal("invalid global shortcut accepted", input)
		}
	}
	key, err := ParseHotkey("Ctrl+F24")
	if err != nil || key.Key != 135 {
		t.Fatal("F24 mapping", key, err)
	}
}

func TestOldPreferencesKeepNewDefaultsAndHotkeysCanBeDisabled(t *testing.T) {
	p := Defaults()
	if err := json.Unmarshal([]byte(`{"closeToTray":false,"messageAlerts":false}`), &p); err != nil {
		t.Fatal(err)
	}
	if p.CloseToTray || p.MessageAlerts || p.AutoStart || !p.HotkeysEnabled || p.ShowHotkey == "" {
		t.Fatal("old desktop settings migration", p)
	}
	p.CaptureHotkey = "alt+ctrl+w"
	if _, err := p.Normalize(); err == nil {
		t.Fatal("duplicate shortcuts accepted")
	}
	p.HotkeysEnabled = false
	p, err := p.Normalize()
	if err != nil || len(p.Shortcuts()) != 0 {
		t.Fatal("disable shortcuts", err)
	}
}
