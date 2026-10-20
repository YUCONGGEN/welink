package server

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBootstrapAdminBindsEmailForEmailLogin(t *testing.T) {
	dir := t.TempDir()
	settings := DefaultSettings()
	settings.DataDir = filepath.Join(dir, "data")
	settings.EmailAuth = EmailAuthSettings{Enabled: true, CredentialsFile: filepath.Join(dir, "email.json")}
	password := filepath.Join(dir, "password")
	if err := os.WriteFile(password, []byte("temporary-bootstrap-password"), 0600); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(dir, "credentials.json")
	id, err := BootstrapAdmin(settings, "郁从根", "", password, output, "1516933915@qq.com")
	if err != nil {
		t.Fatal(err)
	}
	db, err := openStore(settings.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var email string
	var verified int
	if err = db.QueryRow("SELECT email,verified FROM user_emails WHERE user_id=?", id).Scan(&email, &verified); err != nil {
		t.Fatal(err)
	}
	if email != "1516933915@qq.com" || verified != 1 {
		t.Fatalf("unexpected bootstrap email binding: %q, verified=%d", email, verified)
	}
}
