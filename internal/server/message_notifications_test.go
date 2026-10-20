package server

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
	"welink/internal/client"
)

func TestMessageNotificationPermissionsAndMute(t *testing.T) {
	f := setupCommunity(t)
	a, b, outsider := f.register("notice_a"), f.register("notice_b"), f.register("notice_c")
	cid := f.direct(a, b)
	var m Message
	f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, map[string]string{"text": "你好通知", "clientId": "notice-one"}, 200, &m)
	path := "/api/messages/" + m.ID + "/notification"
	var n client.Notification
	f.request("GET", path, "", nil, 401, nil)
	f.request("GET", path, outsider.Token, nil, 204, nil)
	f.request("GET", path, a.Token, nil, 204, nil)
	f.request("GET", path, b.Token, nil, 200, &n)
	if n.Title != a.User.Name || n.Body != m.Text || n.ConversationID != cid {
		t.Fatalf("incorrect alert: %+v", n)
	}
	f.request("PATCH", "/api/conversations/"+cid, b.Token, map[string]bool{"muted": true}, 200, nil)
	f.request("GET", path, b.Token, nil, 204, nil)
	f.request("PATCH", "/api/conversations/"+cid, b.Token, map[string]bool{"muted": false}, 200, nil)
	f.request("PATCH", "/api/contacts/"+a.User.ID, b.Token, map[string]bool{"messageBlocked": true}, 200, nil)
	f.request("GET", path, b.Token, nil, 204, nil)
	f.request("PATCH", "/api/contacts/"+a.User.ID, b.Token, map[string]bool{"messageBlocked": false}, 200, nil)
	f.request("POST", "/api/messages/"+m.ID+"/recall", a.Token, nil, 200, nil)
	f.request("GET", path, b.Token, nil, 204, nil)
	var group map[string]string
	f.request("POST", "/api/conversations", a.Token, map[string]any{"kind": "group", "name": "项目小组", "members": []string{b.User.ID}}, 200, &group)
	g := group["id"]
	f.request("PATCH", "/api/conversations/"+g, b.Token, map[string]bool{"muted": true}, 200, nil)
	f.request("POST", "/api/conversations/"+g+"/messages", a.Token, map[string]any{"text": "@notice_b 开会", "clientId": "mention-alert", "mentions": []map[string]any{{"userId": b.User.ID, "start": 0, "end": 9}}}, 200, &m)
	f.request("GET", "/api/messages/"+m.ID+"/notification", b.Token, nil, 200, &n)
	if n.Title != "项目小组" || !strings.Contains(n.Body, "有人 @你") || !strings.Contains(n.Body, a.User.Name) {
		t.Fatalf("missing mention/name: %+v", n)
	}
}

func TestProcessNotificationsPresenceAndLogout(t *testing.T) {
	f := setupCommunity(t)
	a, b := f.register("native_sender"), f.register("native_receiver")
	cid := f.direct(a, b)
	c, err := client.New(client.Options{Directory: t.TempDir(), Listen: "127.0.0.1:0", Server: f.url})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	notices := make(chan client.Notification, 32)
	c.SetNotificationHandler(func(n client.Notification) { notices <- n })
	if err = c.SetNotificationSession(b.Token); err != nil {
		t.Fatal(err)
	}
	wait := func(kind string) client.Notification {
		t.Helper()
		timer := time.NewTimer(8 * time.Second)
		defer timer.Stop()
		for {
			select {
			case n := <-notices:
				if n.Type == kind {
					return n
				}
			case <-timer.C:
				t.Fatal("no " + kind + " notification")
				return client.Notification{}
			}
		}
	}
	wait("connected")
	presenceDeadline := time.Now().Add(2 * time.Second)
	for !f.s.online(b.User.ID) && time.Now().Before(presenceDeadline) {
		time.Sleep(5 * time.Millisecond)
	}
	// There is no WebView/socket from the UI in this test.
	if !f.s.online(b.User.ID) {
		t.Fatal("native process did not keep account online")
	}
	_ = c.SetNotificationSession(b.Token)
	f.s.mu.Lock()
	connections := len(f.s.clients[b.User.ID])
	f.s.mu.Unlock()
	if connections != 1 {
		t.Fatal("page reload duplicated native connections")
	}
	var m Message
	f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, map[string]string{"text": "后台消息", "clientId": "background-1"}, 200, &m)
	n := wait("message")
	if n.Body != "后台消息" || n.UserID != b.User.ID || n.MessageID != m.ID {
		t.Fatalf("wrong native alert: %+v", n)
	}
	// Duplicate WebSocket delivery must not make another alert.
	f.s.push([]string{b.User.ID}, "message", m)
	select {
	case n := <-notices:
		if n.Type == "message" {
			t.Fatal("duplicate message alerted twice")
		}
	case <-time.After(150 * time.Millisecond):
	}
	// Close just the native socket to exercise reconnect and restored presence.
	f.s.mu.Lock()
	for socket := range f.s.clients[b.User.ID] {
		socket.close()
	}
	f.s.mu.Unlock()
	wait("connected")
	f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, map[string]string{"text": "重连消息", "clientId": "background-2"}, 200, &m)
	if wait("message").MessageID != m.ID {
		t.Fatal("reconnect failed")
	}
	if !testing.Short() {
		// Exceeds the server's 70-second receive deadline; native pong keeps it alive.
		time.Sleep(72 * time.Second)
		if !f.s.online(b.User.ID) {
			t.Fatal("background connection lost presence after heartbeat")
		}
	}
	_ = c.SetNotificationSession("")
	deadline := time.Now().Add(3 * time.Second)
	for f.s.online(b.User.ID) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if f.s.online(b.User.ID) {
		t.Fatal("logout left a ghost online session")
	}
	if raw, _ := json.Marshal(n); strings.Contains(string(raw), b.Token) {
		t.Fatal("credential in notification")
	}
}
