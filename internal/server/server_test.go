package server

import (
	"bytes"
	"encoding/json"
	"github.com/gorilla/websocket"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"welink/internal/remote"
	"welink/internal/yudesk/desktop"
)

type fixture struct {
	t      *testing.T
	s      *Server
	url    string
	server *httptest.Server
}
type account struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}

func setup(t *testing.T) *fixture {
	t.Helper()
	s, e := New(Config{DataDir: t.TempDir()})
	if e != nil {
		t.Fatal(e)
	}
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(func() { s.Close(); srv.Close() })
	return &fixture{t: t, s: s, url: srv.URL, server: srv}
}
func (f *fixture) request(method, path, token string, body any, status int, out any) {
	f.t.Helper()
	var input io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		input = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, f.url+path, input)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, e := http.DefaultClient.Do(req)
	if e != nil {
		f.t.Fatal(e)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != status {
		f.t.Fatalf("%s %s: got %d want %d: %s", method, path, resp.StatusCode, status, data)
	}
	if out != nil {
		if e = json.Unmarshal(data, out); e != nil {
			f.t.Fatalf("decode %s: %v", data, e)
		}
	}
}
func (f *fixture) register(name string) account {
	var a account
	f.request("POST", "/api/auth/register", "", map[string]string{"account": name, "name": name, "password": "test-password-937!"}, 200, &a)
	return a
}
func (f *fixture) befriend(a, b account) {
	var req map[string]string
	f.request("POST", "/api/requests", a.Token, map[string]string{"userId": b.User.ID, "message": "test friend"}, 200, &req)
	f.request("POST", "/api/requests/"+req["id"], b.Token, map[string]bool{"accept": true}, 200, nil)
}
func (f *fixture) direct(a, b account) string {
	var c map[string]string
	f.request("POST", "/api/conversations", a.Token, map[string]any{"kind": "direct", "members": []string{b.User.ID}}, 200, &c)
	return c["id"]
}
func (f *fixture) socket(a account) *websocket.Conn {
	c, _, e := websocket.DefaultDialer.Dial(strings.Replace(f.url, "http", "ws", 1)+"/api/ws", http.Header{"Authorization": []string{"Bearer " + a.Token}})
	if e != nil {
		f.t.Fatal(e)
	}
	f.t.Cleanup(func() { c.Close() })
	deadline := time.Now().Add(time.Second)
	for !f.s.online(a.User.ID) && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	return c
}
func TestChatAuthorizationPersistenceAndIdempotence(t *testing.T) {
	f := setup(t)
	a, b, c := f.register("alice01"), f.register("bobby01"), f.register("carol01")
	f.request("POST", "/api/auth/login", "", map[string]string{"account": "alice01", "password": "wrongpass"}, 401, nil)
	f.request("GET", "/api/me", "", nil, 401, nil)
	f.befriend(a, b)
	cid := f.direct(a, b)
	if f.direct(a, b) != cid {
		t.Fatal("direct conversation duplicated")
	}
	f.request("GET", "/api/conversations/"+cid+"/messages", c.Token, nil, 403, nil)
	ws := f.socket(b)
	var msg Message
	payload := map[string]any{"text": "你好，WeLink 👋", "kind": "text", "clientId": "idempotent-001"}
	f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, payload, 200, &msg)
	_ = ws.SetReadDeadline(time.Now().Add(time.Second))
	var event struct {
		Type string
		Data Message
	}
	for {
		if e := ws.ReadJSON(&event); e != nil {
			t.Fatal(e)
		}
		if event.Type == "message" {
			break
		}
	}
	if event.Data.Text != msg.Text {
		t.Fatal("realtime mismatch")
	}
	var again Message
	f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, payload, 200, &again)
	if msg.ID != again.ID {
		t.Fatal("retry duplicated message")
	}
	f.request("POST", "/api/messages/"+msg.ID+"/recall", b.Token, nil, 403, nil)
	f.request("POST", "/api/favorites/"+msg.ID, c.Token, nil, 403, nil)
	f.request("POST", "/api/favorites/"+msg.ID, b.Token, nil, 200, nil)
	f.request("POST", "/api/messages/"+msg.ID+"/recall", a.Token, nil, 200, nil)
	var history []Message
	f.request("GET", "/api/conversations/"+cid+"/messages", b.Token, nil, 200, &history)
	if len(history) != 1 || !history[0].Recalled || history[0].Text != "" {
		t.Fatal("recall did not redact history")
	}
	f.request("POST", "/api/conversations/"+cid+"/read", b.Token, map[string]int64{"seq": 1 << 60}, 200, nil)
	f.request("POST", "/api/auth/logout", a.Token, nil, 200, nil)
	f.request("GET", "/api/me", a.Token, nil, 401, nil)
}
func TestGroupPermissionsAndFiles(t *testing.T) {
	f := setup(t)
	a, b, c := f.register("owner01"), f.register("member01"), f.register("outsider01")
	f.befriend(a, b)
	var group map[string]string
	f.request("POST", "/api/conversations", a.Token, map[string]any{"kind": "group", "name": "测试群", "members": []string{b.User.ID}}, 200, &group)
	cid := group["id"]
	f.request("PATCH", "/api/conversations/"+cid, b.Token, map[string]string{"announcement": "not owner"}, 403, nil)
	f.request("PATCH", "/api/conversations/"+cid, a.Token, map[string]string{"announcement": "群公告"}, 200, nil)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("conversationId", cid)
	part, _ := writer.CreateFormFile("file", "hello.txt")
	_, _ = part.Write([]byte("hello attachment"))
	_ = writer.Close()
	req, _ := http.NewRequest("POST", f.url+"/api/files", &body)
	req.Header.Set("Authorization", "Bearer "+a.Token)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp, e := http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		data, _ := io.ReadAll(resp.Body)
		t.Fatalf("upload %d %s", resp.StatusCode, data)
	}
	var file map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&file)
	id := file["id"].(string)
	f.request("GET", "/api/files/"+id, c.Token, nil, 403, nil)
	f.request("POST", "/api/conversations/"+cid+"/messages", b.Token, map[string]string{"kind": "file", "attachmentId": id, "clientId": "file-forgery-0001"}, 400, nil)
	f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, map[string]string{"kind": "file", "attachmentId": id, "clientId": "file-owner-0001"}, 200, nil)
	f.request("DELETE", "/api/conversations/"+cid+"/members/"+a.User.ID, a.Token, nil, 403, nil)
	f.request("DELETE", "/api/conversations/"+cid+"/members/"+b.User.ID, b.Token, nil, 200, nil)
	f.request("GET", "/api/files/"+id, b.Token, nil, 403, nil)
}
func TestRemoteRequiresConsentAndEncryptedTransport(t *testing.T) {
	f := setup(t)
	a, b, c := f.register("viewer01"), f.register("hostuser01"), f.register("stranger01")
	f.befriend(a, b)
	cid := f.direct(a, b)
	f.socket(b)
	var invite Remote
	f.request("POST", "/api/remotes", a.Token, map[string]string{"conversationId": cid, "mode": "control", "direction": "request"}, 200, &invite)
	f.request("GET", "/api/remotes/"+invite.ID+"/tunnel", a.Token, nil, 403, nil)
	f.request("POST", "/api/remotes/"+invite.ID+"/respond", c.Token, map[string]bool{"accept": true}, 403, nil)
	host, e := remote.New(t.TempDir(), true)
	if e != nil {
		t.Fatal(e)
	}
	defer host.Stop()
	viewer, e := remote.New(t.TempDir(), true)
	if e != nil {
		t.Fatal(e)
	}
	defer viewer.Stop()
	host.SetSharing(true)
	f.request("POST", "/api/remotes/"+invite.ID+"/respond", b.Token, map[string]any{"accept": true, "deviceId": host.State().DeviceID}, 200, &invite)
	v := remote.Invitation{ID: invite.ID, Host: invite.Host, Requester: invite.Requester, Recipient: invite.Recipient, Mode: invite.Mode, State: invite.State, DeviceID: invite.DeviceID}
	if e = host.Start(v, b.User.ID, b.Token, f.url, nil); e != nil {
		t.Fatal(e)
	}
	if e = viewer.Start(v, a.User.ID, a.Token, f.url, nil); e != nil {
		t.Fatal(e)
	}
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) && viewer.State().Status != "connected" {
		time.Sleep(40 * time.Millisecond)
	}
	if viewer.State().Status != "connected" {
		t.Fatalf("connect failed: viewer=%+v host=%+v", viewer.State(), host.State())
	}
	jpeg := []byte{255, 216, 255, 224, 10, 20, 30, 255, 217}
	if e = host.SubmitJPEG(jpeg, 640, 480); e != nil {
		t.Fatal(e)
	}
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && viewer.State().Frame == 0 {
		time.Sleep(10 * time.Millisecond)
	}
	got, _ := viewer.Frame()
	if !bytes.Equal(got, jpeg) {
		t.Fatal("encrypted frame transport failed")
	}
	if e = viewer.SendInput([]desktop.InputEvent{{Type: "move", X: 24, Y: 36}}); e != nil {
		t.Fatal(e)
	}
	if got := host.NextInput(1000); !strings.Contains(got, `"x":24`) {
		t.Fatalf("input missing: %s", got)
	}
	f.request("POST", "/api/remotes/"+invite.ID+"/end", b.Token, nil, 200, nil)
	deadline = time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) && viewer.State().Status != "ended" {
		time.Sleep(20 * time.Millisecond)
	}
	if viewer.State().Status != "ended" {
		t.Fatal("end failed to close remote")
	}
	f.request("GET", "/api/remotes/"+invite.ID+"/tunnel", a.Token, nil, 403, nil)
}
