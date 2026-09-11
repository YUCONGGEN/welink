package server

import (
	"strings"
	"testing"
)

func TestMessageBlockingIsReversibleAndKeepsHistory(t *testing.T) {
	f := setupCommunity(t)
	a, b := f.register("block_messages_a"), f.register("block_messages_b")
	cid := f.direct(a, b)
	f.request("POST", "/api/conversations/"+cid+"/messages", b.Token, map[string]string{"text": "before blocking", "clientId": "before-blocking"}, 200, nil)
	f.request("PATCH", "/api/contacts/"+b.User.ID, a.Token, map[string]any{"messageBlocked": true}, 200, nil)
	var detail struct{ Friend, MessageBlocked bool }
	f.request("GET", "/api/contacts/"+b.User.ID, a.Token, nil, 200, &detail)
	if !detail.Friend || !detail.MessageBlocked {
		t.Fatal("message blocking removed the contact")
	}
	var contacts []User
	f.request("GET", "/api/friends", a.Token, nil, 200, &contacts)
	if len(contacts) != 1 || !contacts[0].MessageBlocked {
		t.Fatal("block setting did not sync")
	}
	f.request("POST", "/api/conversations/"+cid+"/messages", b.Token, map[string]string{"text": "blocked", "clientId": "blocked-message"}, 403, nil)
	status, _ := storageUpload(t, f, "/api/files", b.Token, "blocked.txt", strings.NewReader("blocked file"), cid)
	if status != 403 {
		t.Fatal("blocked sender uploaded private attachment")
	}
	var history []Message
	f.request("GET", "/api/conversations/"+cid+"/messages", a.Token, nil, 200, &history)
	if len(history) != 1 || history[0].Text != "before blocking" {
		t.Fatal("message blocking erased history")
	}
	f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, map[string]string{"text": "outgoing remains allowed", "clientId": "outgoing-allowed"}, 200, nil)
	f.request("PATCH", "/api/contacts/"+b.User.ID, a.Token, map[string]any{"messageBlocked": false}, 200, nil)
	f.request("POST", "/api/conversations/"+cid+"/messages", b.Token, map[string]string{"text": "after unblock", "clientId": "after-unblock"}, 200, nil)
	f.request("GET", "/api/conversations/"+cid+"/messages", a.Token, nil, 200, &history)
	if len(history) != 3 {
		t.Fatal("unblocking did not restore messaging")
	}
}
