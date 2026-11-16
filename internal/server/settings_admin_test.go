package server

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestSettingsDefaultsOverlayAndValidation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	if err := os.WriteFile(path, []byte(`{"drive":{"quota_gb":120},"registration":{"enabled":true},"storage":{"concurrent_uploads":2}}`), 0600); err != nil {
		t.Fatal(err)
	}
	settings, err := LoadSettings(path)
	if err != nil || settings.Drive.QuotaGB != 120 || settings.Storage.ConcurrentUploads != 2 || settings.Chat.MaxAttachmentBytes != 0 || !settings.Registration.Enabled || settings.Meetings.MaxParticipants != 8 {
		t.Fatal("settings overlay failed", err)
	}
	for _, raw := range []string{`{"mistyped":true}`, `{"drive":{"quota_gb":0}}`, `{"public_url":"https://user:pass@host/"}`, `{} {}`, `{"chat":{"max_attachment_bytes":-1}}`} {
		os.WriteFile(path, []byte(raw), 0600)
		if _, err = LoadSettings(path); err == nil {
			t.Fatalf("invalid settings accepted: %s", raw)
		}
	}
	defaults := DefaultSettings()
	if defaults.Registration.Enabled || defaults.driveQuota() != 5<<30 || defaults.Chat.MaxAttachmentBytes != 0 {
		t.Fatal("incorrect product defaults")
	}
}
func TestRegistrationClosedHidesSignup(t *testing.T) {
	f := setupCommunity(t)
	f.s.settings.Registration.Enabled = false
	f.request("POST", "/api/auth/register", "", map[string]string{"name": "unauthorized", "account": "unauthorized", "password": "password-123456"}, 403, nil)
	var config struct{ RegistrationEnabled bool }
	f.request("GET", "/api/public-config", "", nil, 200, &config)
	if config.RegistrationEnabled {
		t.Fatal("public signup appears enabled")
	}
}
func TestBootstrapAdminWritesPrivateCredentialsOnce(t *testing.T) {
	settings := DefaultSettings()
	settings.DataDir = t.TempDir()
	directory := t.TempDir()
	output := filepath.Join(directory, "credentials.json")
	passwordFile := filepath.Join(directory, "initial-password")
	if err := os.WriteFile(passwordFile, []byte("local-bootstrap-test-password!"), 0600); err != nil {
		t.Fatal(err)
	}
	id, err := BootstrapAdmin(settings, "管理员测试", "bootstrap_admin", passwordFile, output)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	var credential map[string]string
	if json.Unmarshal(raw, &credential) != nil || credential["userId"] != id || credential["password"] != "local-bootstrap-test-password!" || credential["number"] == "" {
		t.Fatal("invalid bootstrap credential")
	}
	if _, err = BootstrapAdmin(settings, "another", "another_admin", passwordFile, filepath.Join(directory, "second.json")); err == nil {
		t.Fatal("second bootstrap accepted")
	}
}
func TestMissingStorageMarkerDoesNotFallBack(t *testing.T) {
	settings := DefaultSettings()
	settings.DataDir = t.TempDir()
	settings.Storage.Root = t.TempDir()
	settings.Storage.RequireMarker = true
	if _, err := New(Config{Settings: &settings}); err == nil {
		t.Fatal("missing volume marker accepted")
	}
	marker := filepath.Join(settings.Storage.Root, ".welink-storage")
	os.WriteFile(marker, []byte(storageMarker), 0600)
	s, err := New(Config{Settings: &settings})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	os.Remove(marker)
	if err = s.storageReady(); err == nil {
		t.Fatal("removed volume marker not detected")
	}
}
