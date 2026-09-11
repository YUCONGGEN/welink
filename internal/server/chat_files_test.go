package server

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestChatFilesRespectPersonalDeletionRecallAndMembership(t *testing.T) {
	f := setupCommunity(t)
	a, b, c := f.register("files_alice"), f.register("files_bobby"), f.register("files_carol")
	cid := f.direct(a, b)
	status, raw := storageUpload(t, f, "/api/files", a.Token, "聊天附件.txt", strings.NewReader("retained for the peer"), cid)
	if status != 200 {
		t.Fatalf("upload %d %s", status, raw)
	}
	var upload struct{ ID string }
	json.Unmarshal(raw, &upload)
	var list []map[string]any
	f.request("GET", "/api/files", a.Token, nil, 200, &list)
	if len(list) != 0 {
		t.Fatal("unsent uploads exposed in chat files")
	}
	var first, second Message
	for _, message := range []*Message{&first, &second} {
		f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, map[string]string{"kind": "file", "attachmentId": upload.ID, "clientId": newID()}, 200, message)
	}
	f.request("GET", "/api/files", b.Token, nil, 200, &list)
	if len(list) != 2 || list[0]["messageId"] != second.ID || list[0]["conversationId"] != cid {
		t.Fatal("file references not listed", list)
	}
	f.request("GET", "/api/files", c.Token, nil, 200, &list)
	if len(list) != 0 {
		t.Fatal("outsider saw chat files")
	}
	f.request("POST", "/api/favorites/"+first.ID, b.Token, nil, 200, nil)
	f.request("DELETE", "/api/messages/"+first.ID, b.Token, nil, 200, nil)
	f.request("GET", "/api/files", b.Token, nil, 200, &list)
	if len(list) != 1 || list[0]["messageId"] != second.ID {
		t.Fatal("deleted file remains in personal list")
	}
	f.request("GET", "/api/files", a.Token, nil, 200, &list)
	if len(list) != 2 {
		t.Fatal("personal deletion removed peer file")
	}
	f.request("GET", "/api/files/"+upload.ID, a.Token, nil, 200, nil)
	f.request("POST", "/api/messages/"+second.ID+"/recall", a.Token, nil, 200, nil)
	f.request("GET", "/api/files", b.Token, nil, 200, &list)
	if len(list) != 0 {
		t.Fatal("recalled file remains in list")
	}
	var favorites []Message
	f.request("GET", "/api/favorites", b.Token, nil, 200, &favorites)
	if len(favorites) != 1 {
		t.Fatal("personal deletion removed favorite")
	}
}
