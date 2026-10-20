package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func loginOnDevice(f *fixture, owner account, platform string) account {
	f.t.Helper()
	body, _ := json.Marshal(map[string]string{"account": owner.User.Account, "password": "test-password-937!"})
	req, _ := http.NewRequest("POST", f.url+"/api/auth/login", bytes.NewReader(body))
	req.Header.Set("X-WeLink-Client", platform)
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		f.t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		f.t.Fatalf("device login: %d", response.StatusCode)
	}
	var device account
	if err = json.NewDecoder(response.Body).Decode(&device); err != nil {
		f.t.Fatal(err)
	}
	return device
}
func sessionIDFor(f *fixture, device account) string {
	f.t.Helper()
	var sessions []loginSession
	f.request("GET", "/api/auth/sessions", device.Token, nil, 200, &sessions)
	for _, item := range sessions {
		if item.Current {
			return item.ID
		}
	}
	f.t.Fatal("current session missing")
	return ""
}
func expectSessionClosed(t *testing.T, connection *websocket.Conn) {
	t.Helper()
	connection.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		_, _, err := connection.ReadMessage()
		if err != nil {
			if !websocket.IsCloseError(err, 4001) {
				t.Fatalf("expected revoked login close, got %v", err)
			}
			return
		}
	}
}
func securitySocket(f *fixture, path string, who account) *websocket.Conn {
	f.t.Helper()
	connection, _, err := websocket.DefaultDialer.Dial(strings.Replace(f.url, "http", "ws", 1)+path, http.Header{"Authorization": []string{"Bearer " + who.Token}})
	if err != nil {
		f.t.Fatal(err)
	}
	f.t.Cleanup(func() { connection.Close() })
	return connection
}

func TestDeviceRevokeClosesChatMeetingAndRemote(t *testing.T) {
	f := setup(t)
	phone := f.register("security_owner")
	desktop := loginOnDevice(f, phone, "windows")
	other := f.register("security_friend")
	var sessions []loginSession
	f.request("GET", "/api/auth/sessions", phone.Token, nil, 200, &sessions)
	if len(sessions) != 2 {
		t.Fatalf("got %d devices", len(sessions))
	}
	desktopID := sessionIDFor(f, desktop)
	for _, item := range sessions {
		if len(item.ID) != 32 || item.ID == phone.Token {
			t.Fatal("invalid public device id")
		}
		if item.ID == desktopID && item.Device != "Windows · LinkMe" {
			t.Fatal("client label missing")
		}
	}
	f.request("DELETE", "/api/auth/sessions/"+desktopID, other.Token, nil, 404, nil)
	f.request("GET", "/api/me", desktop.Token, nil, 200, nil)
	desktopChat := f.socket(desktop)
	f.socket(phone)
	f.socket(other)
	var meeting meetingRoom
	f.request("POST", "/api/meetings", desktop.Token, map[string]string{"title": "设备退出验证"}, 200, &meeting)
	meetingSocket := securitySocket(f, "/api/meetings/"+meeting.Code+"/ws", desktop)
	meetingRead(t, meetingSocket, "welcome")
	f.befriend(phone, other)
	cid := f.direct(phone, other)
	var remote Remote
	f.request("POST", "/api/remotes", desktop.Token, map[string]string{"conversationId": cid, "mode": "view", "direction": "request"}, 200, &remote)
	f.request("POST", "/api/remotes/"+remote.ID+"/respond", other.Token, map[string]any{"accept": true, "deviceId": strings.Repeat("a", 24)}, 200, &remote)
	remoteSocket := securitySocket(f, "/api/remotes/"+remote.ID+"/tunnel", desktop)
	f.request("DELETE", "/api/auth/sessions/"+desktopID, phone.Token, nil, 200, nil)
	expectSessionClosed(t, desktopChat)
	expectSessionClosed(t, meetingSocket)
	expectSessionClosed(t, remoteSocket)
	f.request("GET", "/api/me", desktop.Token, nil, 401, nil)
	f.request("GET", "/api/me", phone.Token, nil, 200, nil)
	f.request("GET", "/api/auth/sessions", phone.Token, nil, 200, &sessions)
	if len(sessions) != 1 || !sessions[0].Current {
		t.Fatal("revocation affected the current device")
	}
}

func TestPasswordChangeRevokesOtherDevicesAndPendingQR(t *testing.T) {
	f := setup(t)
	phone := f.register("password_owner")
	desktop := loginOnDevice(f, phone, "windows")
	chat := f.socket(desktop)
	var oldHash []byte
	f.s.db.QueryRow("SELECT password FROM users WHERE id=?", phone.User.ID).Scan(&oldHash)
	q, scan := newQRChallenge(f)
	f.request("POST", "/api/auth/qr/scan", phone.Token, scan, 200, nil)
	f.request("POST", "/api/auth/qr/confirm", phone.Token, map[string]any{"id": q.ID, "key": scan["key"], "accept": true}, 200, nil)
	f.request("POST", "/api/auth/password", phone.Token, map[string]string{"oldPassword": "incorrect-password", "newPassword": "new-test-password-732!"}, 400, nil)
	f.request("GET", "/api/me", desktop.Token, nil, 200, nil)
	f.request("POST", "/api/auth/password", phone.Token, map[string]string{"oldPassword": "test-password-937!", "newPassword": "new-test-password-732!"}, 200, nil)
	expectSessionClosed(t, chat)
	f.request("GET", "/api/me", phone.Token, nil, 200, nil)
	f.request("GET", "/api/me", desktop.Token, nil, 401, nil)
	f.request("POST", "/api/auth/qr/poll", "", map[string]string{"id": q.ID, "pollSecret": q.PollSecret}, 404, nil)
	f.request("POST", "/api/auth/login", "", map[string]string{"account": phone.User.Number, "password": "test-password-937!"}, 401, nil)
	f.request("POST", "/api/auth/login", "", map[string]string{"account": phone.User.Number, "password": "new-test-password-732!"}, 200, nil)
	// A login that finished checking the old password before the change must not
	// issue a new session after the change commits.
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest("POST", "/api/auth/login", nil)
	if f.s.issueSession(recorder, request, phone.User.ID, oldHash) || recorder.Code != 401 {
		t.Fatal("stale password check produced a new session")
	}
}

func TestLogoutAndBulkRevokeInvalidatePhoneApproval(t *testing.T) {
	f := setup(t)
	phone := f.register("logout_owner")
	desktop := loginOnDevice(f, phone, "windows")
	third := loginOnDevice(f, phone, "android")
	q, scan := newQRChallenge(f)
	f.request("POST", "/api/auth/qr/scan", third.Token, scan, 200, nil)
	f.request("POST", "/api/auth/qr/confirm", phone.Token, map[string]any{"id": q.ID, "key": scan["key"], "accept": true}, 403, nil)
	f.request("POST", "/api/auth/qr/confirm", third.Token, map[string]any{"id": q.ID, "key": scan["key"], "accept": true}, 200, nil)
	f.request("POST", "/api/auth/sessions/revoke-others", phone.Token, nil, 200, nil)
	f.request("GET", "/api/me", desktop.Token, nil, 401, nil)
	f.request("GET", "/api/me", third.Token, nil, 401, nil)
	f.request("POST", "/api/auth/qr/poll", "", map[string]string{"id": q.ID, "pollSecret": q.PollSecret}, 404, nil)
	q, scan = newQRChallenge(f)
	f.request("POST", "/api/auth/qr/scan", phone.Token, scan, 200, nil)
	chat := f.socket(phone)
	f.request("POST", "/api/auth/logout", phone.Token, nil, 200, nil)
	expectSessionClosed(t, chat)
	f.request("GET", "/api/me", phone.Token, nil, 401, nil)
	f.request("POST", "/api/auth/qr/poll", "", map[string]string{"id": q.ID, "pollSecret": q.PollSecret}, 404, nil)
}

func TestLegacySessionMetadataSurvivesRestart(t *testing.T) {
	dir := t.TempDir()
	db, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	user, token := newID(), hashToken(newID()+newID())
	expires := now() + 3600000
	if _, err = db.Exec("INSERT INTO users(id,account,name,password,created) VALUES(?,?,?,X'00',?)", user, "legacy_security", "Legacy", now()); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO sessions VALUES(?,?,?)", token, user, expires); err != nil {
		t.Fatal(err)
	}
	db.Close()
	var first string
	for n := 0; n < 2; n++ {
		db, err = openStore(dir)
		if err != nil {
			t.Fatal(err)
		}
		var id, device string
		var seen int64
		err = db.QueryRow("SELECT id,device,last_seen FROM session_info WHERE token=?", token).Scan(&id, &device, &seen)
		db.Close()
		if err != nil {
			t.Fatal(err)
		}
		if len(id) != 32 || device != "旧版客户端" || seen != 0 {
			t.Fatal("legacy session metadata invalid")
		}
		if n == 0 {
			first = id
		} else if id != first {
			t.Fatal("device identifier changed on restart")
		}
	}
}
