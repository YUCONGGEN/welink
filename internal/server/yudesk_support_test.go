package server

import (
	"fmt"
	"strings"
	"testing"
)

func TestYuDeskSupportBridge(t *testing.T) {
	t.Setenv("WELINK_YUDESK_SECRET", strings.Repeat("s", 40))
	f := setup(t)
	staff := f.register("support_agent")
	other := f.register("other_agent")
	impostor := f.register("same_phone")
	phone := "13800000001"
	f.request("PATCH", "/api/me", impostor.Token, map[string]string{"name": "Same phone", "phone": phone}, 200, nil)
	key := strings.Repeat("s", 40)
	path := "/api/integrations/yudesk/support"
	f.request("POST", path, "", map[string]any{"action": "bootstrap", "phone": phone}, 403, nil)
	f.request("POST", path, key, map[string]any{"action": "validate", "staff": []string{staff.User.Number}}, 200, nil)
	var out struct {
		UserID string `json:"userId"`
		Origin string `json:"origin"`
		Staff  []User `json:"staff"`
	}
	body := map[string]any{"action": "bootstrap", "phone": phone, "staff": []string{staff.User.Number, staff.User.Number}}
	f.request("POST", path, key, body, 200, &out)
	if out.UserID == "" || out.UserID == impostor.User.ID || len(out.Staff) != 1 || out.Origin != "来自 YuDesk" {
		t.Fatalf("identity %+v", out)
	}
	uid := out.UserID
	f.request("POST", path, key, body, 200, &out)
	if out.UserID != uid {
		t.Fatal("provisioning is not idempotent")
	}
	var friends int
	if err := f.s.db.QueryRow("SELECT COUNT(*) FROM friends WHERE (user_id=? AND peer_id=?) OR (user_id=? AND peer_id=?)", uid, staff.User.ID, staff.User.ID, uid).Scan(&friends); err != nil || friends != 2 {
		t.Fatal("contacts", friends, err)
	}
	f.request("POST", path, key, map[string]any{"action": "history", "phone": phone, "staff": []string{staff.User.Number}, "peer": other.User.Number}, 403, nil)
	body["action"] = "send"
	body["peer"] = staff.User.Number
	body["text"] = "客服测试消息"
	body["clientId"] = "support-test-001"
	var sent Message
	f.request("POST", path, key, body, 200, &sent)
	f.request("POST", path, key, body, 200, &sent)
	if sent.Sender != uid {
		t.Fatal("wrong sender")
	}
	var staffHistory []Message
	f.request("GET", "/api/conversations/"+sent.ConversationID+"/messages", staff.Token, nil, 200, &staffHistory)
	if len(staffHistory) != 1 || !strings.Contains(staffHistory[0].Name, "来自YuDesk") {
		t.Fatalf("staff history %+v", staffHistory)
	}
	f.request("POST", "/api/conversations/"+sent.ConversationID+"/messages", staff.Token, map[string]string{"kind": "text", "text": "您好，我来帮您", "clientId": "staff-reply-001"}, 200, nil)
	body["action"] = "history"
	var history struct {
		Messages []Message `json:"messages"`
	}
	f.request("POST", path, key, body, 200, &history)
	if len(history.Messages) != 2 || history.Messages[1].Text != "您好，我来帮您" {
		t.Fatalf("history %+v", history)
	}
	// Configuration updates revoke access to removed staff, including old chats.
	body["staff"] = []string{other.User.Number}
	f.request("POST", path, key, body, 403, nil)
	f.request("POST", path, key, map[string]any{"action": "bootstrap", "phone": phone, "staff": []string{"not-id"}}, 400, nil)
	var count int
	if err := f.s.db.QueryRow("SELECT COUNT(*) FROM yudesk_identities WHERE phone=?", phone).Scan(&count); err != nil || count != 1 {
		t.Fatal(fmt.Sprint(count, err))
	}
}
