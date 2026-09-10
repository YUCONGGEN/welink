package server

import (
	"testing"
	"unicode/utf16"
)

func TestMentionsIdentityPermissionsHistoryAndReadState(t *testing.T) {
	f := setup(t)
	a, b, c := f.register("mention_owner"), f.register("mention_member"), f.register("mention_other")
	cid := f.group(a, b, c)
	path := "/api/conversations/" + cid + "/messages"
	f.request("PATCH", "/api/groups/"+cid+"/members/"+b.User.ID, a.Token, map[string]string{"nickname": "林知夏"}, 200, nil)
	text := "😀 @林知夏 来看设计"
	span := Mention{UserID: b.User.ID, Start: 3, End: 7}
	var m Message
	f.request("POST", path, a.Token, map[string]any{"text": text, "mentions": []Mention{span}, "clientId": "mention-send-001"}, 200, &m)
	if len(m.Mentions) != 1 || m.Mentions[0] != span {
		t.Fatal(m)
	}
	if n, id := f.s.unreadMentions(cid, b.User.ID); n != 1 || id != m.ID {
		t.Fatal(n, id)
	}
	if n, _ := f.s.unreadMentions(cid, c.User.ID); n != 0 {
		t.Fatal("other member notified")
	}
	var history []Message
	f.request("GET", path+"?mentions=me", b.Token, nil, 200, &history)
	if len(history) != 1 || len(history[0].Mentions) != 1 {
		t.Fatal(history)
	}
	f.request("GET", path+"?mentions=me", c.Token, nil, 200, &history)
	if len(history) != 0 {
		t.Fatal("mention filter leaked recipients")
	}
	var retry Message
	f.request("POST", path, a.Token, map[string]any{"text": "retry", "clientId": "mention-send-001"}, 200, &retry)
	if retry.ID != m.ID || len(retry.Mentions) != 1 {
		t.Fatal("retry changed mention")
	}
	f.request("POST", path, b.Token, map[string]any{"text": "@全体成员 开会", "mentions": []Mention{{UserID: "all", Start: 0, End: 5}}, "clientId": "all-not-allowed"}, 403, nil)
	for _, bad := range [][]Mention{{{UserID: b.User.ID, Start: 1, End: 7}}, {{UserID: b.User.ID, Start: 3, End: 4}}, {span, span}, {{UserID: "missing", Start: 3, End: 7}}} {
		f.request("POST", path, a.Token, map[string]any{"text": text, "mentions": bad, "clientId": "invalid-mentions"}, 400, nil)
	}
	// Plain text and forwarded text do not create fresh notifications.
	f.request("POST", path, a.Token, map[string]string{"text": text, "clientId": "plain-mention-001"}, 200, nil)
	f.request("POST", "/api/messages/forward", a.Token, map[string]any{"conversationId": cid, "messageIds": []string{m.ID}, "targets": []string{cid}, "mode": "each", "clientId": "mention-forward-001"}, 200, nil)
	if n, _ := f.s.unreadMentions(cid, b.User.ID); n != 1 {
		t.Fatal("plain/forward notified", n)
	}
	f.request("POST", "/api/conversations/"+cid+"/read", b.Token, map[string]int64{"seq": m.Seq}, 200, nil)
	if n, _ := f.s.unreadMentions(cid, b.User.ID); n != 0 {
		t.Fatal("read still unread")
	}
	// Renaming a group card preserves the original body and structured identity.
	f.request("PATCH", "/api/groups/"+cid+"/members/"+b.User.ID, a.Token, map[string]string{"nickname": "新名片"}, 200, nil)
	f.request("GET", path+"?mentions=me", b.Token, nil, 200, &history)
	if len(history) != 1 || history[0].Text != text || history[0].Mentions[0].UserID != b.User.ID {
		t.Fatal(history)
	}
	f.request("POST", path, a.Token, map[string]any{"text": text, "mentions": []Mention{span}, "clientId": "stale-member-name"}, 400, nil)
	var all Message
	f.request("POST", path, a.Token, map[string]any{"text": "@全体成员 开会", "mentions": []Mention{{UserID: "all", Start: 0, End: 5}}, "clientId": "all-valid-0001"}, 200, &all)
	for _, u := range []account{b, c} {
		if n, _ := f.s.unreadMentions(cid, u.User.ID); n != 1 {
			t.Fatal("all missing", n)
		}
	}
	if n, _ := f.s.unreadMentions(cid, a.User.ID); n != 0 {
		t.Fatal("sender notified")
	}
	f.request("DELETE", "/api/messages/"+all.ID, b.Token, nil, 200, nil)
	if n, _ := f.s.unreadMentions(cid, b.User.ID); n != 0 {
		t.Fatal("deleted still unread")
	}
	f.request("POST", "/api/messages/"+all.ID+"/recall", a.Token, nil, 200, nil)
	if n, _ := f.s.unreadMentions(cid, c.User.ID); n != 0 {
		t.Fatal("recalled still unread")
	}
	f.request("GET", path+"?mentions=me", c.Token, nil, 200, &history)
	if len(history) != 0 {
		t.Fatal("recalled appears in mention search")
	}
	// Direct chat cannot carry a mention to manufacture a reminder.
	direct := f.direct(a, c)
	f.request("POST", "/api/conversations/"+direct+"/messages", a.Token, map[string]any{"text": "@" + c.User.Name, "mentions": []Mention{{UserID: c.User.ID, Start: 0, End: len(utf16.Encode([]rune("@" + c.User.Name)))}}, "clientId": "direct-mention-001"}, 403, nil)
}
