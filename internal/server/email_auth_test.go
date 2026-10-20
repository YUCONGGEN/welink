package server

import (
	"context"
	"errors"
	"net/http/httptest"
	"sync"
	"testing"
)

type testEmailSender struct {
	mu    sync.Mutex
	code  string
	calls int
	fail  bool
}

func (m *testEmailSender) SendOTP(_ context.Context, _ string, code string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.code = code
	m.calls++
	if m.fail {
		return errors.New("provider failure")
	}
	return nil
}
func setupEmail(t *testing.T) (*fixture, *testEmailSender) {
	cfg := DefaultSettings()
	cfg.Registration.Enabled = true
	cfg.EmailAuth = EmailAuthSettings{Enabled: true, CredentialsFile: "test-injected"}
	sender := &testEmailSender{}
	s, e := New(Config{DataDir: t.TempDir(), Settings: &cfg, EmailSender: sender})
	if e != nil {
		t.Fatal(e)
	}
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(func() { srv.Close(); s.Close() })
	return &fixture{t: t, s: s, url: srv.URL, server: srv}, sender
}
func emailChallenge(f *fixture, m *testEmailSender, email, purpose string) emailInput {
	var out struct{ ChallengeID string }
	f.request("POST", "/api/auth/email/code", "", map[string]string{"email": email, "purpose": purpose}, 200, &out)
	m.mu.Lock()
	code := m.code
	m.mu.Unlock()
	return emailInput{Email: email, Password: "Test-email-password!", Name: "邮箱用户", Code: code, ChallengeID: out.ChallengeID}
}
func TestEmailRegistrationLoginRecovery(t *testing.T) {
	f, m := setupEmail(t)
	p := emailChallenge(f, m, "person@example.com", "register")
	f.request("POST", "/api/auth/email/code", "", map[string]string{"email": p.Email, "purpose": "register"}, 429, nil)
	wrong := p
	wrong.Code = "bad"
	f.request("POST", "/api/auth/register", "", wrong, 400, nil)
	var a account
	f.request("POST", "/api/auth/register", "", p, 200, &a)
	if a.User.Email != p.Email || a.User.Name != p.Name || len(a.User.Number) != 6 {
		t.Fatal("incorrect account identity")
	}
	f.request("POST", "/api/auth/register", "", p, 400, nil)
	f.request("POST", "/api/auth/login", "", map[string]string{"account": a.User.Number, "password": p.Password}, 401, nil)
	f.request("POST", "/api/auth/login", "", map[string]string{"email": "PERSON@EXAMPLE.COM", "password": p.Password}, 200, nil)
	f.request("POST", "/api/auth/login", "", map[string]string{"email": p.Name, "password": p.Password}, 401, nil)
	f.s.db.Exec("UPDATE email_challenges SET created=created-61000")
	reset := emailChallenge(f, m, p.Email, "reset")
	reset.Password = "New-email-password!"
	f.request("POST", "/api/auth/register", "", reset, 400, nil)
	f.request("POST", "/api/auth/email/reset", "", reset, 200, nil)
	f.request("GET", "/api/me", a.Token, nil, 401, nil)
	f.request("POST", "/api/auth/email/reset", "", reset, 400, nil)
	f.request("POST", "/api/auth/login", "", p, 401, nil)
	f.request("POST", "/api/auth/login", "", reset, 200, nil)
}
func TestEmailCodeExpiryAttemptsAndProviderFailure(t *testing.T) {
	f, m := setupEmail(t)
	p := emailChallenge(f, m, "expire@example.com", "register")
	f.s.db.Exec("UPDATE email_challenges SET expires=0 WHERE id=?", p.ChallengeID)
	f.request("POST", "/api/auth/register", "", p, 400, nil)
	p = emailChallenge(f, m, "attempts@example.com", "register")
	wrong := p
	wrong.Code = "invalid"
	for i := 0; i < 6; i++ {
		f.request("POST", "/api/auth/register", "", wrong, 400, nil)
	}
	f.request("POST", "/api/auth/register", "", p, 400, nil)
	var count int
	f.s.db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if count != 0 {
		t.Fatal("failed verification created user")
	}
	m.fail = true
	f.request("POST", "/api/auth/email/code", "", map[string]string{"email": "failed@example.com", "purpose": "register"}, 503, nil)
	f.s.db.QueryRow("SELECT COUNT(*) FROM email_challenges WHERE email='failed@example.com' AND ready=1").Scan(&count)
	if count != 0 {
		t.Fatal("failed delivery became usable")
	}
	f.request("POST", "/api/auth/email/code", "", map[string]string{"email": "unknown@example.com", "purpose": "reset"}, 200, nil)
	f.request("POST", "/api/auth/email/code", "", map[string]string{"email": "a@example.com", "purpose": "admin-register"}, 403, nil)
}
func TestEmailAdminRegistrationWithPublicRegistrationDisabled(t *testing.T) {
	f, m := setupEmail(t)
	p := emailChallenge(f, m, "admin@example.com", "register")
	var admin account
	f.request("POST", "/api/auth/register", "", p, 200, &admin)
	f.s.settings.Admin.Users = []string{admin.User.ID}
	f.s.settings.Registration.Enabled = false
	f.request("POST", "/api/auth/email/code", "", map[string]string{"email": "new@example.com", "purpose": "register"}, 403, nil)
	var out struct{ ChallengeID string }
	f.request("POST", "/api/admin/users/email-code", admin.Token, map[string]string{"email": "new@example.com", "purpose": "admin-register"}, 200, &out)
	input := emailInput{Email: "new@example.com", Name: "员工", ChallengeID: out.ChallengeID, Code: m.code}
	wrong := input
	wrong.Code = "invalid"
	f.request("POST", "/api/admin/users", admin.Token, wrong, 400, nil)
	var result struct {
		User            User
		InitialPassword string
	}
	f.request("POST", "/api/admin/users", admin.Token, input, 200, &result)
	if result.User.Email != input.Email || result.InitialPassword == "" {
		t.Fatal("admin registration missing email/password")
	}
	f.request("POST", "/api/auth/login", "", map[string]string{"email": input.Email, "password": result.InitialPassword}, 200, nil)
	var count int
	f.s.db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if count != 2 {
		t.Fatal("invalid admin verification leaked account")
	}
}
