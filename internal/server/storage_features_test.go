package server

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setupCommunity(t *testing.T) *fixture {
	t.Helper()
	settings := DefaultSettings()
	settings.Registration.Enabled = true
	settings.DataDir = t.TempDir()
	settings.Storage.Root = t.TempDir()
	settings.Storage.ReserveBytes = 0
	s, err := New(Config{Settings: &settings})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(func() { s.Close(); srv.Close() })
	return &fixture{t: t, s: s, url: srv.URL, server: srv}
}
func storageUpload(t *testing.T, f *fixture, path, token, name string, source io.Reader, cid string) (int, []byte) {
	t.Helper()
	reader, writer := io.Pipe()
	multipartWriter := multipart.NewWriter(writer)
	go func() {
		var err error
		if cid != "" {
			err = multipartWriter.WriteField("conversationId", cid)
		}
		var part io.Writer
		if err == nil {
			part, err = multipartWriter.CreateFormFile("file", name)
		}
		if err == nil {
			_, err = io.Copy(part, source)
		}
		if err == nil {
			err = multipartWriter.Close()
		}
		writer.CloseWithError(err)
	}()
	req, err := http.NewRequest("POST", f.url+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", multipartWriter.FormDataContentType())
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, raw
}
func TestCommunityChatHidePreservesHistory(t *testing.T) {
	f := setupCommunity(t)
	a, b, c := f.register("direct_alice"), f.register("direct_bobby"), f.register("direct_carol")
	cid := f.direct(a, b)
	f.request("GET", "/api/users?q="+a.User.ID, b.Token, nil, 200, nil)
	f.request("GET", "/api/users?q="+a.User.Number, b.Token, nil, 200, nil)
	var message Message
	f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, map[string]string{"text": "保留的历史", "clientId": "directory-old-history"}, 200, &message)
	f.request("DELETE", "/api/contacts/"+b.User.ID, a.Token, nil, 200, nil)
	var list []map[string]any
	f.request("GET", "/api/conversations", a.Token, nil, 200, &list)
	if len(list) != 0 {
		t.Fatal("hidden chat remains in list")
	}
	var history []Message
	f.request("GET", "/api/conversations/"+cid+"/messages", a.Token, nil, 200, &history)
	if len(history) != 1 || history[0].Text != "保留的历史" {
		t.Fatal("hiding removed history")
	}
	f.request("POST", "/api/conversations/"+cid+"/messages", b.Token, map[string]string{"text": "新的消息", "clientId": "directory-new-history"}, 200, nil)
	f.request("GET", "/api/conversations", a.Token, nil, 200, &list)
	if len(list) != 1 {
		t.Fatal("incoming message did not restore chat")
	}
	f.request("DELETE", "/api/conversations/"+cid, a.Token, nil, 200, nil)
	if f.direct(a, b) != cid {
		t.Fatal("direct chat duplicated")
	}
	f.request("GET", "/api/conversations", a.Token, nil, 200, &list)
	if len(list) != 1 {
		t.Fatal("starting chat did not restore it")
	}
	f.request("GET", "/api/conversations/"+cid+"/messages", c.Token, nil, 403, nil)
	var friends []User
	f.request("GET", "/api/friends", a.Token, nil, 200, &friends)
	if len(friends) != 2 {
		t.Fatal("directory missing users")
	}
	f.request("PATCH", "/api/contacts/"+b.User.ID, a.Token, map[string]string{"remark": "同事"}, 200, nil)
}

type zeroSource struct{}

func (zeroSource) Read(p []byte) (int, error) { clear(p); return len(p), nil }
func TestChatStreamsBeyondOldLimitOntoConfiguredDisk(t *testing.T) {
	f := setupCommunity(t)
	a, b := f.register("large_alice"), f.register("large_bobby")
	cid := f.direct(a, b)
	const size = 65 << 20
	status, raw := storageUpload(t, f, "/api/files", a.Token, "大文件.bin", io.LimitReader(zeroSource{}, size), cid)
	if status != 200 {
		t.Fatalf("stream upload status %d: %s", status, raw)
	}
	var result struct {
		ID   string
		Size int64
	}
	if json.Unmarshal(raw, &result) != nil || result.Size != size {
		t.Fatal("incorrect upload receipt")
	}
	stat, err := os.Stat(filepath.Join(f.s.storage, "uploads", result.ID))
	if err != nil || stat.Size() != size {
		t.Fatal("file not stored on configured disk")
	}
	if _, err = os.Stat(filepath.Join(f.s.dir, "uploads", result.ID)); !os.IsNotExist(err) {
		t.Fatal("unexpected internal disk copy")
	}
	used, _, _ := driveUsage(f.s.db, a.User.ID)
	if used != 0 {
		t.Fatal("chat attachment charged to drive")
	}
}
func TestDriveOwnershipQuotaShareAndCleanup(t *testing.T) {
	f := setupCommunity(t)
	a, b := f.register("drive_alice"), f.register("drive_bobby")
	status, raw := storageUpload(t, f, "/api/drive/files", a.Token, "原始文件.txt", strings.NewReader("hello cloud"), "")
	if status != 200 {
		t.Fatalf("%d %s", status, raw)
	}
	var file driveFile
	if json.Unmarshal(raw, &file) != nil {
		t.Fatal("receipt")
	}
	f.request("GET", "/api/drive/files/"+file.ID, b.Token, nil, 404, nil)
	f.request("PATCH", "/api/drive/files/"+file.ID, b.Token, map[string]string{"name": "偷改"}, 404, nil)
	f.request("DELETE", "/api/drive/files/"+file.ID, b.Token, nil, 404, nil)
	f.request("PATCH", "/api/drive/files/"+file.ID, a.Token, map[string]string{"name": "../bad"}, 400, nil)
	f.request("PATCH", "/api/drive/files/"+file.ID, a.Token, map[string]string{"name": "报告.txt"}, 200, nil)
	var share map[string]any
	f.request("POST", "/api/drive/files/"+file.ID+"/share", a.Token, map[string]int{"days": 7}, 200, &share)
	u, _ := url.Parse(share["url"].(string))
	response, err := http.Get(f.url + u.Path + "?download=1")
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 200 || string(data) != "hello cloud" {
		t.Fatal("shared content mismatch")
	}
	f.request("DELETE", "/api/drive/files/"+file.ID+"/share", a.Token, nil, 200, nil)
	response, err = http.Get(f.url + u.Path)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 404 {
		t.Fatal("revoked share remained accessible")
	}
	quota := f.s.settings.driveQuota()
	fake := newID()
	_, err = f.s.db.Exec("INSERT INTO drive_files VALUES(?,?,?,?,'application/octet-stream',1,1)", fake, a.User.ID, "quota-used", quota-file.Size-512)
	if err != nil {
		t.Fatal(err)
	}
	status, _ = storageUpload(t, f, "/api/drive/files", a.Token, "too-large.bin", bytes.NewReader(make([]byte, 513)), "")
	if status != 507 {
		t.Fatalf("quota status %d", status)
	}
	entries, _ := os.ReadDir(filepath.Join(f.s.storage, "yunpan", a.User.ID))
	if len(entries) != 1 {
		t.Fatal("failed upload was not cleaned")
	}
	f.request("DELETE", "/api/drive/files/"+file.ID, a.Token, nil, 200, nil)
	if _, err = os.Stat(f.s.drivePath(a.User.ID, file.ID)); !os.IsNotExist(err) {
		t.Fatal("deleted file retained")
	}
}
func TestSpacesAccessConflictAndPrivatePublicSwitch(t *testing.T) {
	f := setupCommunity(t)
	a, b, c := f.register("space_alice"), f.register("space_bobby"), f.register("space_carol")
	var d spaceDocument
	f.request("POST", "/api/spaces/me/documents", a.Token, map[string]string{"title": "日记.md", "content": "# 我的日记\n<script>danger</script>"}, 200, &d)
	f.request("GET", "/api/spaces/"+a.User.ID, b.Token, nil, 403, nil)
	f.request("PATCH", "/api/spaces/me/access", a.Token, map[string]any{"visibility": "selected", "viewers": []string{b.User.ID}}, 200, nil)
	f.request("GET", "/api/spaces/"+a.User.ID, b.Token, nil, 200, nil)
	f.request("GET", "/api/spaces/"+a.User.ID+"/documents/"+d.ID, c.Token, nil, 404, nil)
	f.request("GET", "/api/spaces/"+a.User.ID+"/documents/"+d.ID, b.Token, nil, 200, nil)
	f.request("PUT", "/api/spaces/me/documents/"+d.ID, b.Token, map[string]any{"title": "forged", "content": "bad", "revision": 1}, 404, nil)
	f.request("PUT", "/api/spaces/me/documents/"+d.ID, a.Token, map[string]any{"title": "更新.md", "content": "# 第二版", "revision": 0}, 409, nil)
	f.request("PUT", "/api/spaces/me/documents/"+d.ID, a.Token, map[string]any{"title": "更新.md", "content": "# 第二版 <script>danger</script>", "revision": 1}, 200, nil)
	f.request("PATCH", "/api/spaces/me/access", a.Token, map[string]string{"visibility": "public"}, 200, nil)
	response, err := http.Get(f.url + "/space/" + a.User.Number + "?doc=" + d.ID)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 200 || bytes.Contains(data, []byte("<script>danger")) {
		t.Fatal("public markdown rendered unsafe HTML")
	}
	f.request("PATCH", "/api/spaces/me/access", a.Token, map[string]string{"visibility": "private"}, 200, nil)
	response, err = http.Get(f.url + "/space/" + a.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 404 {
		t.Fatal("private space exposed")
	}
	f.request("GET", "/api/spaces/"+a.User.ID+"/documents/"+d.ID, b.Token, nil, 404, nil)
	files, _ := os.ReadDir(filepath.Join(f.s.storage, "spaces", a.User.ID))
	if len(files) != 1 {
		t.Fatal("old or rejected revision retained")
	}
}
func TestAdminDeletionRevokesAccessButPreservesChat(t *testing.T) {
	f := setupCommunity(t)
	admin, ordinary := f.register("root_admin"), f.register("ordinary_user")
	f.s.settings.Admin.Users = []string{admin.User.ID}
	f.request("GET", "/api/admin/users", ordinary.Token, nil, 403, nil)
	var created struct {
		User            User
		InitialPassword string
	}
	f.request("POST", "/api/admin/users", admin.Token, map[string]string{"name": "被管理账号"}, 200, &created)
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
	f.request("DELETE", "/api/admin/users/"+target.User.ID, ordinary.Token, map[string]string{"confirmNumber": target.User.Number}, 403, nil)
	f.request("DELETE", "/api/admin/users/"+target.User.ID, admin.Token, map[string]string{"confirmNumber": "wrong"}, 400, nil)
	q, scan := newQRChallenge(f)
	f.request("POST", "/api/auth/qr/scan", target.Token, scan, 200, nil)
	f.request("POST", "/api/auth/qr/confirm", target.Token, map[string]any{"id": q.ID, "key": scan["key"], "accept": true}, 200, nil)
	f.request("DELETE", "/api/admin/users/"+target.User.ID, admin.Token, map[string]string{"confirmNumber": target.User.Number}, 200, nil)
	f.request("POST", "/api/auth/qr/poll", "", map[string]string{"id": q.ID, "pollSecret": q.PollSecret}, 404, nil)
	f.request("GET", "/api/me", target.Token, nil, 401, nil)
	f.request("POST", "/api/auth/login", "", map[string]string{"account": created.User.Number, "password": created.InitialPassword}, 401, nil)
	var history []Message
	f.request("GET", "/api/conversations/"+cid+"/messages", ordinary.Token, nil, 200, &history)
	if len(history) != 1 || history[0].Text != "历史保留" || history[0].Name != "已注销用户" {
		t.Fatal("historical chat corrupted")
	}
	u, _ := url.Parse(share["url"].(string))
	response, err := http.Get(f.url + u.Path)
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
	f.request("DELETE", "/api/admin/users/"+admin.User.ID, admin.Token, map[string]string{"confirmNumber": admin.User.Number}, 409, nil)
}
