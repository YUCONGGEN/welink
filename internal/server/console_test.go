package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type consoleClient struct {
	f      *fixture
	url    string
	cookie *http.Cookie
}

const consoleTestPassword = "console-test-password-1!"

// addConsoleAdmin inserts a console administrator directly (cheap bcrypt cost).
func (f *fixture) addConsoleAdmin(username string) string {
	f.t.Helper()
	hash, _ := bcrypt.GenerateFromPassword([]byte(consoleTestPassword), bcrypt.MinCost)
	id := newID()
	if _, err := f.s.db.Exec("INSERT INTO console_admins(id,username,password,created) VALUES(?,?,?,?)", id, username, hash, now()); err != nil {
		f.t.Fatal(err)
	}
	return id
}

// console starts the console listener for the fixture and signs in.
func (f *fixture) console() *consoleClient {
	f.t.Helper()
	srv := httptest.NewServer(f.s.ConsoleHandler())
	f.t.Cleanup(srv.Close)
	c := &consoleClient{f: f, url: srv.URL}
	f.addConsoleAdmin("root")
	c.login("root", consoleTestPassword, 200)
	return c
}

func (c *consoleClient) raw(method, path string, body io.Reader, header bool) (*http.Response, []byte) {
	c.f.t.Helper()
	req, _ := http.NewRequest(method, c.url+path, body)
	req.Header.Set("Content-Type", "application/json")
	if header {
		req.Header.Set(consoleHeader, "1")
	}
	if c.cookie != nil {
		req.AddCookie(c.cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.f.t.Fatal(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return resp, data
}

func (c *consoleClient) do(method, path string, body any, status int, out any) {
	c.f.t.Helper()
	var input io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		input = bytes.NewReader(b)
	}
	resp, data := c.raw(method, path, input, true)
	if resp.StatusCode != status {
		c.f.t.Fatalf("%s %s: status %d, want %d: %s", method, path, resp.StatusCode, status, data)
	}
	if out != nil {
		if err := json.Unmarshal(data, out); err != nil {
			c.f.t.Fatal(err, string(data))
		}
	}
}

func (c *consoleClient) login(username, password string, status int) {
	c.f.t.Helper()
	b, _ := json.Marshal(map[string]string{"username": username, "password": password})
	resp, data := c.raw("POST", "/api/login", bytes.NewReader(b), true)
	if resp.StatusCode != status {
		c.f.t.Fatalf("console login %d, want %d: %s", resp.StatusCode, status, data)
	}
	for _, ck := range resp.Cookies() {
		if ck.Name == consoleCookie {
			c.cookie = ck
		}
	}
}

type consoleDetail struct {
	User    consoleUserRow
	Bio     string
	Gender  string
	Devices []consoleDevice
	Stats   map[string]int64
}

func TestConsoleAuthenticationIsSeparateFromApp(t *testing.T) {
	f := setupCommunity(t)
	user := f.register("console_app_user")
	srv := httptest.NewServer(f.s.ConsoleHandler())
	defer srv.Close()
	anon := &consoleClient{f: f, url: srv.URL}
	anon.do("GET", "/api/users", nil, 401, nil)
	// An app session is not a console session.
	req, _ := http.NewRequest("GET", srv.URL+"/api/users", nil)
	req.Header.Set("Authorization", "Bearer "+user.Token)
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatal("app token opened the console", resp.StatusCode)
	}
	f.addConsoleAdmin("ops")
	anon.login("ops", "wrong-password-000", 401)
	anon.login("nobody", consoleTestPassword, 401)
	anon.login("ops", consoleTestPassword, 200)
	anon.do("GET", "/api/me", nil, 200, nil)
	// State-changing requests need the console header (CSRF guard).
	r, _ := anon.raw("POST", "/api/users", strings.NewReader(`{"name":"x"}`), false)
	if r.StatusCode != 403 {
		t.Fatal("missing console header accepted", r.StatusCode)
	}
	// The app no longer has administrator endpoints.
	f.request("GET", "/api/admin/users", user.Token, nil, 404, nil)
	var config map[string]any
	f.request("GET", "/api/config", user.Token, nil, 200, &config)
	if _, has := config["admin"]; has {
		t.Fatal("app config still advertises an admin role")
	}
	anon.do("POST", "/api/logout", nil, 200, nil)
	anon.do("GET", "/api/me", nil, 401, nil)
	// Repeated failures for one username are throttled.
	// (the limit counts every attempt for the username, including the two above).
	for i := 0; i < 3; i++ {
		anon.login("ops", "wrong-password-000", 401)
	}
	anon.login("ops", consoleTestPassword, 429)
}

func TestConsoleCreatesUsersWithRequiredName(t *testing.T) {
	f := setupCommunity(t)
	f.s.settings.Registration.Enabled = false
	c := f.console()
	var made struct {
		User            User
		InitialPassword string
	}
	c.do("POST", "/api/users", map[string]string{}, 400, nil)
	c.do("POST", "/api/users", map[string]string{"name": " ", "password": "explicit-password-123!"}, 400, nil)
	c.do("POST", "/api/users", map[string]string{"name": "姓名", "password": "short"}, 400, nil)
	c.do("POST", "/api/users", map[string]string{"name": "注册人员", "jobTitle": "设计", "email": "staff@example.com"}, 200, &made)
	if made.User.Name != "注册人员" || len(made.User.Number) != 6 || made.InitialPassword == "" {
		t.Fatal("missing usable generated credentials", made)
	}
	f.request("POST", "/api/auth/login", "", map[string]string{"account": made.User.Number, "password": made.InitialPassword}, 200, nil)
	f.request("POST", "/api/auth/register", "", map[string]string{}, 403, nil)
	var list struct {
		Items []consoleUserRow
		Total int
	}
	c.do("GET", "/api/users?q=staff@example", nil, 200, &list)
	if list.Total != 1 || list.Items[0].JobTitle != "设计" || list.Items[0].Email != "staff@example.com" {
		t.Fatal("search by email/details", list)
	}
	c.do("POST", "/api/users", map[string]string{"name": "重复邮箱", "email": "STAFF@example.com"}, 409, nil)
}

func TestConsoleEditsEveryProfileField(t *testing.T) {
	f := setupCommunity(t)
	a, b := f.register("profile_peer"), f.register("profile_target")
	c := f.console()
	path := "/api/users/" + b.User.ID
	f.request("POST", "/api/contact-blocks/"+a.User.ID, b.Token, nil, 200, nil)
	var d consoleDetail
	c.do("GET", path, nil, 200, &d)
	c.do("PATCH", path, map[string]string{"name": "  林晓  ", "phone": "13800000000", "gender": "female", "jobTitle": "工程师", "bio": "签名", "email": "lin@example.com"}, 200, &d)
	var u User
	f.request("GET", "/api/me", b.Token, nil, 200, &u)
	if u.Name != "林晓" || u.Number != b.User.Number || u.Phone != "13800000000" || u.Gender != "female" || u.JobTitle != "工程师" || u.Bio != "签名" {
		t.Fatal("profile not saved", u)
	}
	if d.User.Email != "lin@example.com" || d.Gender != "female" {
		t.Fatal("console detail", d)
	}
	c.do("PATCH", path, map[string]string{"name": "新姓名"}, 200, nil)
	f.request("GET", "/api/me", b.Token, nil, 200, &u)
	if u.Phone != "13800000000" || u.Bio != "签名" || u.Avatar != b.User.Avatar {
		t.Fatal("partial edit erased fields", u)
	}
	for _, body := range []map[string]string{{"name": " "}, {"name": "不应保存", "phone": "bad"}, {"name": "不应保存", "gender": "bad"}, {"name": "不应保存", "email": "not-an-email"}} {
		c.do("PATCH", path, body, 400, nil)
	}
	f.request("GET", "/api/me", b.Token, nil, 200, &u)
	if u.Name != "新姓名" {
		t.Fatal("invalid edit partially saved", u)
	}
	c.do("PATCH", path, map[string]string{"phone": "", "gender": "", "jobTitle": "", "bio": "", "email": ""}, 200, &d)
	if d.User.Phone != "" || d.Gender != "" || d.User.JobTitle != "" || d.Bio != "" || d.User.Email != "" {
		t.Fatal("could not clear optional fields", d)
	}
	var audits int
	f.s.db.QueryRow("SELECT COUNT(*) FROM console_audit WHERE target=? AND action='update-user'", b.User.ID).Scan(&audits)
	if audits != 3 {
		t.Fatal("invalid edit recorded or successful edit missing", audits)
	}
	c.do("DELETE", path+"/avatar", nil, 200, nil)
	c.do("PATCH", "/api/users/nonexistent", map[string]string{"name": "不存在"}, 404, nil)
}

func TestConsoleResetsPasswordsAndSignsOutEverywhere(t *testing.T) {
	f := setupCommunity(t)
	target := f.register("reset_target")
	c := f.console()
	q, scan := newQRChallenge(f)
	f.request("POST", "/api/auth/qr/scan", target.Token, scan, 200, nil)
	f.request("POST", "/api/auth/qr/confirm", target.Token, map[string]any{"id": q.ID, "key": scan["key"], "accept": true}, 200, nil)
	var reset struct {
		SignedOut int
		Password  string
	}
	c.do("POST", "/api/users/"+target.User.ID+"/password", map[string]string{"password": "short"}, 400, nil)
	c.do("POST", "/api/users/"+target.User.ID+"/password", map[string]string{"password": "reset-password-876!"}, 200, &reset)
	if reset.SignedOut != 1 || reset.Password != "" {
		t.Fatal("reset result", reset)
	}
	f.request("POST", "/api/auth/qr/poll", "", map[string]string{"id": q.ID, "pollSecret": q.PollSecret}, 404, nil)
	f.request("GET", "/api/me", target.Token, nil, 401, nil)
	f.request("POST", "/api/auth/login", "", map[string]string{"account": target.User.Number, "password": "test-password-937!"}, 401, nil)
	var fresh account
	f.request("POST", "/api/auth/login", "", map[string]string{"account": target.User.Number, "password": "reset-password-876!"}, 200, &fresh)
	f.request("POST", "/api/auth/password", fresh.Token, map[string]string{"oldPassword": "reset-password-876!", "newPassword": "self-change-password-234!"}, 200, nil)
	// A generated password is returned once.
	c.do("POST", "/api/users/"+target.User.ID+"/password", map[string]string{}, 200, &reset)
	if len(reset.Password) < 16 {
		t.Fatal("generated password missing")
	}
	f.request("POST", "/api/auth/login", "", map[string]string{"account": target.User.Number, "password": reset.Password}, 200, &fresh)
	var d consoleDetail
	c.do("GET", "/api/users/"+target.User.ID, nil, 200, &d)
	if len(d.Devices) != 1 {
		t.Fatal("device list", d.Devices)
	}
	c.do("DELETE", "/api/users/"+target.User.ID+"/sessions/"+d.Devices[0].ID, nil, 200, nil)
	f.request("GET", "/api/me", fresh.Token, nil, 401, nil)
	c.do("DELETE", "/api/users/"+target.User.ID+"/sessions/"+d.Devices[0].ID, nil, 404, nil)
	f.request("POST", "/api/auth/login", "", map[string]string{"account": target.User.Number, "password": reset.Password}, 200, &fresh)
	var out struct{ SignedOut int }
	c.do("POST", "/api/users/"+target.User.ID+"/signout", nil, 200, &out)
	if out.SignedOut != 1 {
		t.Fatal("sign out everywhere", out)
	}
	f.request("GET", "/api/me", fresh.Token, nil, 401, nil)
}

func TestConsoleDisableBlocksEveryLoginPath(t *testing.T) {
	f := setupCommunity(t)
	target := f.register("disable_target")
	c := f.console()
	c.do("POST", "/api/users/"+target.User.ID+"/status", map[string]any{"disabled": true, "reason": "离职"}, 200, nil)
	f.request("GET", "/api/me", target.Token, nil, 401, nil)
	f.request("POST", "/api/auth/login", "", map[string]string{"account": target.User.Number, "password": "test-password-937!"}, 403, nil)
	var list struct {
		Items []consoleUserRow
		Total int
	}
	c.do("GET", "/api/users?status=disabled", nil, 200, &list)
	if list.Total != 1 || list.Items[0].Reason != "离职" {
		t.Fatal("disabled filter", list)
	}
	c.do("POST", "/api/users/"+target.User.ID+"/status", map[string]any{"disabled": false}, 200, nil)
	f.request("POST", "/api/auth/login", "", map[string]string{"account": target.User.Number, "password": "test-password-937!"}, 200, nil)
}

func TestConsoleDeletionRevokesAccessButPreservesChat(t *testing.T) {
	f := setupCommunity(t)
	ordinary := f.register("ordinary_user")
	c := f.console()
	var created struct {
		User            User
		InitialPassword string
	}
	c.do("POST", "/api/users", map[string]string{"name": "被管理账号"}, 200, &created)
	var target account
	f.request("POST", "/api/auth/login", "", map[string]string{"account": created.User.Number, "password": created.InitialPassword}, 200, &target)
	cid := f.direct(ordinary, target)
	f.request("POST", "/api/conversations/"+cid+"/messages", target.Token, map[string]string{"text": "历史保留", "clientId": "admin-retained-history"}, 200, nil)
	var folder driveFolder
	f.request("POST", "/api/drive/folders", target.Token, map[string]string{"name": "账号文件夹"}, 200, &folder)
	status, raw := storageUpload(t, f, "/api/drive/files?folder="+folder.ID, target.Token, "private.txt", strings.NewReader("private"), "")
	if status != 200 {
		t.Fatalf("%d %s", status, raw)
	}
	var file driveFile
	json.Unmarshal(raw, &file)
	var share map[string]any
	f.request("POST", "/api/drive/files/"+file.ID+"/share", target.Token, map[string]int{"days": 7}, 200, &share)
	c.do("DELETE", "/api/users/"+target.User.ID, map[string]string{"confirmNumber": "wrong"}, 400, nil)
	q, scan := newQRChallenge(f)
	f.request("POST", "/api/auth/qr/scan", target.Token, scan, 200, nil)
	f.request("POST", "/api/auth/qr/confirm", target.Token, map[string]any{"id": q.ID, "key": scan["key"], "accept": true}, 200, nil)
	c.do("DELETE", "/api/users/"+target.User.ID, map[string]string{"confirmNumber": target.User.Number}, 200, nil)
	f.request("POST", "/api/auth/qr/poll", "", map[string]string{"id": q.ID, "pollSecret": q.PollSecret}, 404, nil)
	f.request("GET", "/api/me", target.Token, nil, 401, nil)
	f.request("POST", "/api/auth/login", "", map[string]string{"account": created.User.Number, "password": created.InitialPassword}, 401, nil)
	var history []Message
	f.request("GET", "/api/conversations/"+cid+"/messages", ordinary.Token, nil, 200, &history)
	if len(history) != 1 || history[0].Text != "历史保留" || history[0].Name != "已注销用户" {
		t.Fatal("historical chat corrupted")
	}
	u := share["url"].(string)
	response, err := http.Get(f.url + u[strings.Index(u, "/share/"):])
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 404 {
		t.Fatal("deleted user's share is live")
	}
	if _, err = os.Stat(f.s.drivePath(target.User.ID, file.ID)); !os.IsNotExist(err) {
		t.Fatal("private cloud file survived deletion")
	}
	c.do("GET", "/api/users/"+target.User.ID, nil, 404, nil)
	var audit []map[string]any
	c.do("GET", "/api/audit", nil, 200, &audit)
	if len(audit) == 0 || audit[0]["action"] != "delete-user" {
		t.Fatal("deletion not audited", audit)
	}
}

func TestConsoleAdministratorAccounts(t *testing.T) {
	f := setupCommunity(t)
	c := f.console()
	var admins []consoleAdminView
	c.do("GET", "/api/admins", nil, 200, &admins)
	if len(admins) != 1 || !admins[0].Self {
		t.Fatal("admin list", admins)
	}
	self := admins[0].ID
	c.do("DELETE", "/api/admins/"+self, nil, 409, nil)
	c.do("PATCH", "/api/admins/"+self, map[string]bool{"disabled": true}, 409, nil)
	var second consoleAdminView
	c.do("POST", "/api/admins", map[string]string{"username": "x", "password": consoleTestPassword}, 400, nil)
	c.do("POST", "/api/admins", map[string]string{"username": "helper", "password": "short"}, 400, nil)
	c.do("POST", "/api/admins", map[string]string{"username": "helper", "password": consoleTestPassword}, 200, &second)
	c.do("POST", "/api/admins", map[string]string{"username": "HELPER", "password": consoleTestPassword}, 409, nil)
	other := &consoleClient{f: f, url: c.url}
	other.login("helper", consoleTestPassword, 200)
	c.do("PATCH", "/api/admins/"+second.ID, map[string]bool{"disabled": true}, 200, nil)
	other.do("GET", "/api/me", nil, 401, nil)
	other.login("helper", consoleTestPassword, 403)
	c.do("DELETE", "/api/admins/"+second.ID, nil, 200, nil)
	c.do("POST", "/api/me/password", map[string]string{"current": "wrong", "password": "new-console-password-2!"}, 400, nil)
	c.do("POST", "/api/me/password", map[string]string{"current": consoleTestPassword, "password": "new-console-password-2!"}, 200, nil)
	c.do("GET", "/api/me", nil, 200, nil)
	// Command-line recovery resets the password and signs out sessions.
	if created, err := SetConsoleAdmin(f.s.settings, "root", "recovered-password-3!"); err != nil || created {
		t.Fatal(created, err)
	}
	c.do("GET", "/api/me", nil, 401, nil)
	c.login("root", "recovered-password-3!", 200)
}

func TestConsoleSettingsFilesPackagesAndRestart(t *testing.T) {
	f := setupCommunity(t)
	dir := t.TempDir()
	f.s.configPath = filepath.Join(dir, "config.json")
	f.s.downloads = filepath.Join(dir, "downloads")
	if err := f.s.saveSettingsFile(f.s.settings); err != nil {
		t.Fatal(err)
	}
	c := f.console()
	var got struct {
		Settings       Settings
		Editable       bool
		RestartPending bool
	}
	c.do("GET", "/api/settings", nil, 200, &got)
	if !got.Editable || got.RestartPending {
		t.Fatal("settings view", got.Editable, got.RestartPending)
	}
	next := got.Settings
	next.Drive.QuotaGB = 0
	c.do("PUT", "/api/settings", next, 400, nil)
	next.Drive.QuotaGB = 9
	next.Registration.Enabled = true
	c.do("PUT", "/api/settings", next, 200, nil)
	saved, err := LoadSettings(f.s.configPath)
	if err != nil || saved.Drive.QuotaGB != 9 || !saved.Registration.Enabled {
		t.Fatal("settings not written", err)
	}
	if f.s.settings.Drive.QuotaGB == 9 {
		t.Fatal("running settings changed before restart")
	}
	c.do("GET", "/api/settings", nil, 200, &got)
	if !got.RestartPending {
		t.Fatal("pending restart not reported")
	}
	backups, _ := os.ReadDir(filepath.Join(dir, "config-backups"))
	if len(backups) != 1 {
		t.Fatal("previous config not backed up", len(backups))
	}
	// Credential files: secrets are write-only and kept when left blank.
	c.do("PUT", "/api/files/email", map[string]any{"secretId": "id"}, 400, nil)
	email := map[string]any{"secretId": "AKID", "secretKey": "secret-value", "region": "ap-guangzhou", "from": "LinkMe <no-reply@example.com>", "templateId": 12345, "subject": "验证码"}
	c.do("PUT", "/api/files/email", email, 200, nil)
	email["secretKey"] = ""
	email["subject"] = "新的主题"
	c.do("PUT", "/api/files/email", email, 200, nil)
	var files []configFileView
	c.do("GET", "/api/files", nil, 200, &files)
	if files[0].Kind != "email" || !files[0].Secrets["secretKey"] || files[0].Values["subject"] != "新的主题" {
		t.Fatal("email credentials view", files[0])
	}
	if strings.Contains(mustRead(t, files[0].Path), "secret-value") == false {
		t.Fatal("secret lost when left blank")
	}
	saved, _ = LoadSettings(f.s.configPath)
	if saved.EmailAuth.CredentialsFile != files[0].Path {
		t.Fatal("settings not pointed at the new credentials file")
	}
	c.do("PUT", "/api/files/media", map[string]any{"generate": true}, 200, nil)
	c.do("PUT", "/api/files/ai", map[string]any{"base_url": "ftp://x", "token": "short"}, 400, nil)
	// Packages: the signature must match the slot; SHA256SUMS follows.
	upload := func(name string, body []byte) int {
		resp, _ := c.raw("PUT", "/api/downloads/"+name, bytes.NewReader(body), true)
		return resp.StatusCode
	}
	exe := append([]byte("MZ"), bytes.Repeat([]byte{1}, 4096)...)
	if upload("LinkMe-Setup.exe", append([]byte("PK\x03\x04"), exe...)) != 400 || upload("evil.sh", exe) != 400 || upload("LinkMe-Setup.exe", exe) != 200 {
		t.Fatal("package validation")
	}
	if !strings.Contains(mustRead(t, filepath.Join(f.s.downloads, "SHA256SUMS.txt")), "LinkMe-Setup.exe") {
		t.Fatal("checksums not updated")
	}
	c.do("DELETE", "/api/downloads/LinkMe-Setup.exe", nil, 200, nil)
	if strings.Contains(mustRead(t, filepath.Join(f.s.downloads, "SHA256SUMS.txt")), "LinkMe-Setup.exe") {
		t.Fatal("checksums kept a deleted package")
	}
	// Restart needs a service manager.
	c.do("POST", "/api/restart", nil, 409, nil)
	f.s.supervised = true
	c.do("POST", "/api/restart", nil, 200, nil)
	select {
	case <-f.s.RestartRequested():
	case <-time.After(3 * time.Second):
		t.Fatal("restart not signalled")
	}
}

func mustRead(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestServerInstallersAreServedFromDownloads(t *testing.T) {
	f := setupCommunity(t)
	f.s.downloads = t.TempDir()
	dir := filepath.Join(f.s.downloads, "server")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"install.sh", "install.ps1", "linkme-server-linux-amd64.tar.gz", "secret.txt"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("#!/bin/sh\necho 中文\n"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	get := func(path string) (int, string) {
		resp, err := http.Get(f.url + path)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode, resp.Header.Get("Content-Type")
	}
	if code, ctype := get("/downloads/server/install.sh"); code != 200 || !strings.Contains(ctype, "charset=utf-8") {
		t.Fatal("install.sh", code, ctype)
	}
	if code, _ := get("/downloads/server/linkme-server-linux-amd64.tar.gz"); code != 200 {
		t.Fatal("bundle", code)
	}
	for _, bad := range []string{"/downloads/server/secret.txt", "/downloads/server/../config.json", "/downloads/server/"} {
		if code, _ := get(bad); code != 404 {
			t.Fatal(bad, code)
		}
	}
}

func TestConsoleIsServedOnTheWebsiteUnderAdmin(t *testing.T) {
	f := setupCommunity(t)
	f.addConsoleAdmin("site")
	noRedirect := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := noRedirect.Get(f.url + "/admin")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 302 || resp.Header.Get("Location") != "/admin/" {
		t.Fatal("/admin redirect", resp.StatusCode, resp.Header.Get("Location"))
	}
	page := mustGet(t, f.url+"/admin/")
	if !strings.Contains(page, `href="assets/style.css"`) || !strings.Contains(mustGet(t, f.url+"/admin/assets/app.js"), "const API") {
		t.Fatal("console page or assets missing under /admin/")
	}
	c := &consoleClient{f: f, url: f.url + "/admin"}
	b, _ := json.Marshal(map[string]string{"username": "site", "password": consoleTestPassword})
	resp, _ = c.raw("POST", "/api/login", bytes.NewReader(b), true)
	var cookie *http.Cookie
	for _, ck := range resp.Cookies() {
		if ck.Name == consoleCookie {
			cookie = ck
		}
	}
	if resp.StatusCode != 200 || cookie == nil || cookie.Path != "/admin/" {
		t.Fatal("login under /admin", resp.StatusCode, cookie)
	}
	c.cookie = cookie
	c.do("GET", "/api/me", nil, 200, nil)
	if home := mustGet(t, f.url+"/"); !strings.Contains(home, `href="/admin/"`) {
		t.Fatal("download page has no console link")
	}
	// Turning the public entry off removes both the mount and the link.
	f.s.settings.Console.Public = false
	f.s.mux = http.NewServeMux()
	f.s.routes()
	if home := mustGet(t, f.url+"/"); strings.Contains(home, `href="/admin/"`) {
		t.Fatal("link shown while console is not public")
	}
	resp, _ = http.Get(f.url + "/admin/")
	resp.Body.Close()
	if resp.StatusCode != 404 {
		t.Fatal("console still public", resp.StatusCode)
	}
}

func mustGet(t *testing.T, url string) string {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return string(b)
}

func TestLoginAcceptsNumberOrEmailInEitherField(t *testing.T) {
	for _, emailAuth := range []bool{false, true} {
		f := setupCommunity(t)
		f.s.settings.EmailAuth.Enabled = emailAuth
		c := f.console()
		var made struct {
			User            User
			InitialPassword string
		}
		c.do("POST", "/api/users", map[string]string{"name": "登录测试", "email": "Login.Test@Example.com", "password": "login-test-password-1"}, 200, &made)
		for _, body := range []map[string]string{
			{"account": made.User.Number, "password": "login-test-password-1"},
			{"email": made.User.Number, "password": "login-test-password-1"},
			{"email": "login.test@example.com", "password": "login-test-password-1"},
			{"account": "LOGIN.TEST@example.com", "password": "login-test-password-1"},
		} {
			f.request("POST", "/api/auth/login", "", body, 200, nil)
		}
		f.request("POST", "/api/auth/login", "", map[string]string{"email": "login.test@example.com", "password": "wrong-password-000"}, 401, nil)
		f.request("POST", "/api/auth/login", "", map[string]string{"email": "not an address", "password": "login-test-password-1"}, 401, nil)
		// An account created without an email still signs in with its number.
		c.do("POST", "/api/users", map[string]string{"name": "无邮箱", "password": "login-test-password-2"}, map[bool]int{false: 200, true: 400}[emailAuth], &made)
		if !emailAuth {
			f.request("POST", "/api/auth/login", "", map[string]string{"email": made.User.Number, "password": "login-test-password-2"}, 200, nil)
		}
	}
}

func TestDeployGuideOnlyOnTheInstallerSite(t *testing.T) {
	f := setupCommunity(t)
	f.s.downloads = t.TempDir()
	if strings.Contains(mustGet(t, f.url+"/"), `id="deploy"`) {
		t.Fatal("self-hosted site shows the deployment guide")
	}
	os.MkdirAll(filepath.Join(f.s.downloads, "server"), 0755)
	os.WriteFile(filepath.Join(f.s.downloads, "server", "install.sh"), []byte("#!/bin/sh\n"), 0644)
	if !strings.Contains(mustGet(t, f.url+"/"), `id="deploy"`) {
		t.Fatal("installer site lost the deployment guide")
	}
}
