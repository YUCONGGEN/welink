package server

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"
)

// Files both ways through the YzDesk bridge, and the staff side's read
// position in history (已读 / 未读 in YzDesk).
func TestYuDeskSupportFilesAndReceipts(t *testing.T) {
	key := strings.Repeat("f", 40)
	t.Setenv("WELINK_YUDESK_SECRET", key)
	f := setup(t)
	staff := f.register("file_support")
	path := "/api/integrations/yudesk/support"
	body := map[string]any{"action": "bootstrap", "email": "file-bridge@example.com", "staff": []string{staff.User.Number}}
	var bootstrap struct {
		UserID   string
		Features []string
	}
	f.request("POST", path, key, body, 200, &bootstrap)
	if strings.Join(bootstrap.Features, ",") != "file,receipts" {
		t.Fatal("features not announced", bootstrap.Features)
	}
	cid, err := f.s.yudeskConversation(bootstrap.UserID, staff.User.ID)
	if err != nil {
		t.Fatal(err)
	}

	// The customer sends a file: an ordinary LinkMe file message staff can
	// download; a retry with the same client ID does not duplicate it.
	content := []byte("2026-11-21 12:00:01 error: something failed\n")
	send := map[string]any{"action": "send", "kind": "file", "email": "file-bridge@example.com", "staff": []string{staff.User.Number}, "peer": staff.User.Number,
		"fileData": base64.StdEncoding.EncodeToString(content), "fileName": `C:\logs\yzdesk.log`, "fileMime": "text/plain", "clientId": "yzdesk-file-0001"}
	var sent Message
	f.request("POST", path, key, send, 200, &sent)
	if sent.Kind != "file" || sent.AttachmentID == "" {
		t.Fatalf("file message: %+v", sent)
	}
	f.request("POST", path, key, send, 200, &sent)
	checkForwardDownload(t, f, sent.AttachmentID, staff, 200, content)
	history := map[string]any{"action": "history", "email": "file-bridge@example.com", "staff": []string{staff.User.Number}, "peer": staff.User.Number}
	var h struct {
		Messages    []Message
		PeerReadSeq *int64
	}
	f.request("POST", path, key, history, 200, &h)
	if len(h.Messages) != 1 || h.Messages[0].FileName != "yzdesk.log" || h.Messages[0].FileSize != int64(len(content)) {
		t.Fatalf("history: %+v", h.Messages)
	}
	// Receipts: unread by staff, then read.
	if h.PeerReadSeq == nil || *h.PeerReadSeq >= h.Messages[0].Seq {
		t.Fatal("staff read position missing or ahead", h.PeerReadSeq)
	}
	f.request("POST", "/api/conversations/"+cid+"/read", staff.Token, map[string]any{}, 200, nil)
	f.request("POST", path, key, history, 200, &h)
	if h.PeerReadSeq == nil || *h.PeerReadSeq < h.Messages[0].Seq {
		t.Fatal("staff read not reported", h.PeerReadSeq)
	}

	// Refused: too large, no name, bad data.
	big := map[string]any{}
	for k, v := range send {
		big[k] = v
	}
	big["clientId"] = "yzdesk-file-0002"
	big["fileData"] = base64.StdEncoding.EncodeToString(bytes.Repeat([]byte("x"), yudeskFileLimit+1))
	f.request("POST", path, key, big, 413, nil)
	big["fileData"] = base64.StdEncoding.EncodeToString(content)
	big["fileName"] = ""
	f.request("POST", path, key, big, 400, nil)
	big["fileName"] = "a.txt"
	big["fileData"] = "%%%"
	f.request("POST", path, key, big, 400, nil)

	// Staff send a file: the customer reads it through the file action, only
	// in their own conversation, never once recalled, never an image.
	staffFile := []byte("%PDF-1.4 support manual")
	m := forwardAttachment(t, f, cid, staff, "manual.pdf", "file", "application/pdf", staffFile)
	get := map[string]any{"action": "file", "email": "file-bridge@example.com", "staff": []string{staff.User.Number}, "peer": staff.User.Number, "attachmentId": m.AttachmentID}
	var got struct {
		Data, Name, Mime string
		Size             int
	}
	f.request("POST", path, key, get, 200, &got)
	data, err := base64.StdEncoding.DecodeString(got.Data)
	if err != nil || !bytes.Equal(data, staffFile) || got.Name != "manual.pdf" || got.Mime != "application/pdf" || got.Size != len(staffFile) {
		t.Fatalf("file action: %+v %v", got, err)
	}
	get["email"] = "other-file-bridge@example.com"
	f.request("POST", path, key, get, 404, nil)
	get["email"] = "file-bridge@example.com"
	img := forwardAttachment(t, f, cid, staff, "x.png", "image", "image/png", []byte("\x89PNG\r\n\x1a\n"))
	get["attachmentId"] = img.AttachmentID
	f.request("POST", path, key, get, 404, nil)
	get["attachmentId"] = m.AttachmentID
	f.request("POST", "/api/messages/"+m.ID+"/recall", staff.Token, nil, 200, nil)
	f.request("POST", path, key, get, 404, nil)
	// Without the bridge secret nothing is served.
	f.request("POST", path, strings.Repeat("z", 40), get, 403, nil)
}
