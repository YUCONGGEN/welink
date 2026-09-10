package server

import (
	"bytes"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func forwardAttachment(t *testing.T, f *fixture, cid string, owner account, name, kind, mime string, data []byte) Message {
	t.Helper()
	id := newID()
	if err := os.WriteFile(filepath.Join(f.s.dir, "uploads", id), data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.db.Exec("INSERT INTO attachments VALUES(?,?,?,?,?,?,?)", id, owner.User.ID, cid, name, mime, len(data), now()); err != nil {
		t.Fatal(err)
	}
	var m Message
	f.request("POST", "/api/conversations/"+cid+"/messages", owner.Token, map[string]string{"kind": kind, "attachmentId": id, "clientId": newID()}, 200, &m)
	return m
}
func checkForwardDownload(t *testing.T, f *fixture, id string, who account, status int, want []byte) {
	t.Helper()
	req, _ := http.NewRequest("GET", f.url+"/api/files/"+id, nil)
	req.Header.Set("Authorization", "Bearer "+who.Token)
	r, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	data, _ := io.ReadAll(r.Body)
	if r.StatusCode != status {
		t.Fatalf("download got %d want %d: %s", r.StatusCode, status, data)
	}
	if status == 200 && !bytes.Equal(data, want) {
		t.Fatal("forwarded file bytes changed")
	}
}

func TestForwardSnapshotsFilesAuthorizationAndNestedReshare(t *testing.T) {
	f := setup(t)
	a, b, c, d := f.register("forward_alice"), f.register("forward_bobby"), f.register("forward_carol"), f.register("forward_danny")
	f.befriend(a, b)
	f.befriend(a, c)
	f.befriend(c, d)
	source, target, third := f.direct(a, b), f.direct(a, c), f.direct(c, d)
	text := sendTestMessage(f, source, b, "周六上午九点出发", "")
	imageBytes := []byte("test-image-bytes")
	image := forwardAttachment(t, f, source, b, "照片.png", "image", "image/png", imageBytes)
	fileBytes := []byte("WeLink forward document")
	file := forwardAttachment(t, f, source, b, "行程.txt", "file", "text/plain", fileBytes)
	request := forwardRequest{ConversationID: source, MessageIDs: []string{file.ID, text.ID, image.ID}, Targets: []string{target}, Mode: "merge", ClientID: newID(), Note: "一起看看行程"}
	var result forwardResult
	f.request("POST", "/api/messages/forward", a.Token, request, 200, &result)
	if result.Count != 2 || len(result.IDs) != 2 {
		t.Fatal("merged card/note not delivered")
	}
	var doc forwardDocument
	f.request("GET", "/api/messages/"+result.IDs[0]+"/forward", c.Token, nil, 200, &doc)
	if len(doc.Items) != 3 || doc.Items[0].Text != text.Text || doc.Items[0].Name != b.User.Name {
		t.Fatal("snapshot order/author mismatch")
	}
	if doc.Items[1].AttachmentID == image.AttachmentID || doc.Items[2].AttachmentID == file.AttachmentID {
		t.Fatal("source attachment identifiers were reused")
	}
	checkForwardDownload(t, f, doc.Items[1].AttachmentID, c, 200, imageBytes)
	checkForwardDownload(t, f, doc.Items[2].AttachmentID, c, 200, fileBytes)
	checkForwardDownload(t, f, file.AttachmentID, c, 403, nil)
	checkForwardDownload(t, f, doc.Items[2].AttachmentID, d, 403, nil)
	f.request("GET", "/api/messages/"+result.IDs[0]+"/forward", d.Token, nil, 404, nil)
	var again forwardResult
	f.request("POST", "/api/messages/forward", a.Token, request, 200, &again)
	if again.Count != result.Count || again.IDs[0] != result.IDs[0] {
		t.Fatal("retry duplicated forward")
	}
	var count int
	f.s.db.QueryRow("SELECT COUNT(*) FROM messages WHERE conversation_id=?", target).Scan(&count)
	if count != 2 {
		t.Fatal("retry inserted extra messages")
	}
	request.Note = "changed"
	f.request("POST", "/api/messages/forward", a.Token, request, 409, nil)
	// A recipient may merge an existing record again; every nested file must be re-scoped.
	reshare := forwardRequest{ConversationID: target, MessageIDs: []string{result.IDs[0]}, Targets: []string{third}, Mode: "merge", ClientID: newID()}
	var nestedResult forwardResult
	f.request("POST", "/api/messages/forward", c.Token, reshare, 200, &nestedResult)
	var nested forwardDocument
	f.request("GET", "/api/messages/"+nestedResult.IDs[0]+"/forward", d.Token, nil, 200, &nested)
	if len(nested.Items) != 1 || nested.Items[0].Record == nil {
		t.Fatal("nested record missing")
	}
	nestedFile := nested.Items[0].Record.Items[2].AttachmentID
	if nestedFile == doc.Items[2].AttachmentID {
		t.Fatal("nested attachment not re-scoped")
	}
	checkForwardDownload(t, f, nestedFile, d, 200, fileBytes)
	checkForwardDownload(t, f, nestedFile, b, 403, nil)
	// Original recall and deletion never mutate copies already sent elsewhere.
	f.request("POST", "/api/messages/"+text.ID+"/recall", b.Token, nil, 200, nil)
	f.request("DELETE", "/api/messages/"+file.ID, a.Token, nil, 200, nil)
	f.request("GET", "/api/messages/"+result.IDs[0]+"/forward", c.Token, nil, 200, &doc)
	if doc.Items[0].Text != text.Text {
		t.Fatal("source recall mutated snapshot")
	}
	f.request("POST", "/api/favorites/"+result.IDs[0], c.Token, nil, 200, nil)
	f.request("DELETE", "/api/messages/"+result.IDs[0], c.Token, nil, 200, nil)
	f.request("GET", "/api/messages/"+result.IDs[0]+"/forward", c.Token, nil, 200, &doc)
	f.request("DELETE", "/api/favorites/"+result.IDs[0], c.Token, nil, 200, nil)
	f.request("GET", "/api/messages/"+result.IDs[0]+"/forward", c.Token, nil, 404, nil)
	f.request("POST", "/api/messages/"+result.IDs[0]+"/recall", a.Token, nil, 200, nil)
	f.request("GET", "/api/messages/"+result.IDs[0]+"/forward", c.Token, nil, 404, nil)
	f.request("GET", "/api/messages/"+nestedResult.IDs[0]+"/forward", d.Token, nil, 200, &nested)
	if nested.Items[0].Record.Items[0].Text != text.Text {
		t.Fatal("parent card recall mutated nested copy")
	}
	checkForwardDownload(t, f, nestedFile, d, 200, fileBytes)
}

func TestForwardEachValidatesEntireBatchAndBulkDelete(t *testing.T) {
	f := setup(t)
	a, b, c := f.register("batch_alice"), f.register("batch_bobby"), f.register("batch_carol")
	f.befriend(a, b)
	f.befriend(a, c)
	f.befriend(b, c)
	source, target, foreign := f.direct(a, b), f.direct(a, c), f.direct(b, c)
	one, two := sendTestMessage(f, source, b, "第一条", ""), sendTestMessage(f, source, a, "第二条", "")
	foreignMessage := sendTestMessage(f, foreign, b, "不可访问的消息", "")
	request := forwardRequest{ConversationID: source, MessageIDs: []string{two.ID, one.ID}, Targets: []string{target, foreign}, Mode: "each", ClientID: newID()}
	f.request("POST", "/api/messages/forward", a.Token, request, 403, nil)
	var rows []Message
	f.request("GET", "/api/conversations/"+target+"/messages", a.Token, nil, 200, &rows)
	if len(rows) != 0 {
		t.Fatal("invalid destination caused partial delivery")
	}
	request.Targets = []string{target}
	request.MessageIDs = []string{one.ID, foreignMessage.ID}
	f.request("POST", "/api/messages/forward", a.Token, request, 400, nil)
	request.MessageIDs = []string{one.ID, two.ID}
	var sent forwardResult
	f.request("POST", "/api/messages/forward", a.Token, request, 200, &sent)
	f.request("GET", "/api/conversations/"+target+"/messages", c.Token, nil, 200, &rows)
	if len(rows) != 2 || rows[0].Text != one.Text || rows[1].Text != two.Text || rows[0].Sender != a.User.ID {
		t.Fatal("individual forward order/sender mismatch")
	}
	f.request("POST", "/api/conversations/"+source+"/messages/delete", a.Token, map[string]any{"messageIds": []string{one.ID, foreignMessage.ID}}, 400, nil)
	f.request("GET", "/api/conversations/"+source+"/messages", a.Token, nil, 200, &rows)
	if len(rows) != 2 {
		t.Fatal("invalid selection partially deleted history")
	}
	f.request("POST", "/api/conversations/"+source+"/messages/delete", c.Token, map[string]any{"messageIds": []string{one.ID}}, 403, nil)
	f.request("POST", "/api/conversations/"+source+"/messages/delete", a.Token, map[string]any{"messageIds": []string{one.ID, two.ID, one.ID}}, 200, nil)
	f.request("GET", "/api/conversations/"+source+"/messages", a.Token, nil, 200, &rows)
	if len(rows) != 0 {
		t.Fatal("bulk deletion incomplete")
	}
	f.request("GET", "/api/conversations/"+source+"/messages", b.Token, nil, 200, &rows)
	if len(rows) != 2 {
		t.Fatal("bulk deletion changed peer history")
	}
	request.ClientID = newID()
	f.request("POST", "/api/messages/forward", a.Token, request, 400, nil)
	request.MessageIDs = make([]string, 101)
	for i := range request.MessageIDs {
		request.MessageIDs[i] = one.ID
	}
	f.request("POST", "/api/messages/forward", a.Token, request, 400, nil)
}
