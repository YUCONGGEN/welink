package server

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"
)

// Files in the YzDesk support bridge. Like images they travel as bounded
// base64 inside the authenticated JSON bridge, so the YzDesk relay needs no
// second endpoint, token or URL: a file goes through LinkMe's normal upload
// (storage volumes, safe names, rate limit, idempotent client IDs) and
// becomes an ordinary "file" message that staff see in LinkMe; staff files
// (and voice / video, which YzDesk shows as files) are read back only
// through a visible message of the caller's own support conversation.

// yudeskFileLimit bounds one file in either direction (base64 adds a third;
// the bridge body limit is 18 MiB).
const yudeskFileLimit = 10 << 20

// yudeskBridgeFeatures tells the YzDesk relay and apps what this LinkMe
// understands beyond text and images ("file": send kind file and the file
// action; "receipts": history carries the staff side's read position).
var yudeskBridgeFeatures = []string{"file", "receipts"}

func (s *Server) yudeskSupportFileSend(w http.ResponseWriter, child *http.Request, p yudeskSupportRequest) {
	raw, err := base64.StdEncoding.DecodeString(p.FileData)
	if err != nil || len(raw) == 0 {
		fail(w, 400, "文件数据无效")
		return
	}
	if len(raw) > yudeskFileLimit {
		fail(w, 413, "文件不能超过 10 MB")
		return
	}
	name := filepath.Base(strings.ReplaceAll(p.FileName, "\\", "/"))
	if !safeFileName(name) {
		fail(w, 400, "文件名无效")
		return
	}
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	if err = form.WriteField("conversationId", child.PathValue("id")); err != nil {
		fail(w, 400, "文件请求无效")
		return
	}
	// The upload is idempotent independently from the message: a retry with
	// the same YzDesk client ID reuses the stored attachment.
	if err = form.WriteField("clientId", "yudesk-file-"+p.ClientID); err != nil {
		fail(w, 400, "文件请求无效")
		return
	}
	part, err := form.CreateFormFile("file", name)
	if err != nil {
		fail(w, 400, "文件请求无效")
		return
	}
	if _, err = part.Write(raw); err != nil || form.Close() != nil {
		fail(w, 400, "文件上传失败")
		return
	}
	uploadRequest := child.Clone(child.Context())
	uploadRequest.Method = http.MethodPost
	uploadRequest.Body = io.NopCloser(bytes.NewReader(body.Bytes()))
	uploadRequest.ContentLength = int64(body.Len())
	uploadRequest.Header = child.Header.Clone()
	uploadRequest.Header.Set("Content-Type", form.FormDataContentType())
	capture := &yudeskResponse{header: http.Header{}}
	s.upload(capture, uploadRequest)
	if capture.status >= 400 {
		w.WriteHeader(capture.status)
		_, _ = w.Write(capture.body.Bytes())
		return
	}
	var attachment struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(capture.body.Bytes(), &attachment) != nil || attachment.ID == "" {
		fail(w, 503, "文件上传响应无效")
		return
	}
	message, _ := json.Marshal(map[string]string{"kind": "file", "attachmentId": attachment.ID, "clientId": p.ClientID})
	child.Body = io.NopCloser(bytes.NewReader(message))
	s.sendMessage(w, child)
}

// yudeskSupportFile returns a file of a visible (not recalled, not deleted
// for the caller) file, voice or video message of this support conversation.
func (s *Server) yudeskSupportFile(w http.ResponseWriter, r *http.Request, user, cid, attachment string) {
	var blob, name, typ string
	var size int64
	err := s.db.QueryRow(`SELECT COALESCE(b.blob_id,a.id),a.name,a.mime,a.size FROM attachments a LEFT JOIN attachment_blobs b ON b.attachment_id=a.id WHERE a.id=? AND a.conversation_id=? AND EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=? AND m.attachment_id=a.id AND m.kind IN ('file','voice','video') AND m.recalled=0 AND NOT EXISTS(SELECT 1 FROM message_deletions d WHERE d.message_id=m.id AND d.user_id=?))`, attachment, cid, cid, user).Scan(&blob, &name, &typ, &size)
	if err != nil {
		fail(w, 404, "文件不存在或已撤回")
		return
	}
	if size < 1 || size > yudeskFileLimit {
		fail(w, 413, "文件超过 10 MB，请让客服用其他方式发送")
		return
	}
	f, err := s.openStored("uploads", "", blob)
	if err != nil {
		fail(w, 503, "文件暂不可用")
		return
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, yudeskFileLimit+1))
	if err != nil || len(raw) > yudeskFileLimit {
		fail(w, 413, "文件超过 10 MB，请让客服用其他方式发送")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	ok(w, map[string]any{"ok": true, "data": base64.StdEncoding.EncodeToString(raw), "name": name, "mime": typ, "size": len(raw)})
}

// yudeskPeerReadSeq is how far the staff member has read this conversation
// (members.read_seq, which LinkMe's own receipts use).
func (s *Server) yudeskPeerReadSeq(cid, peer string) (int64, error) {
	var seq int64
	err := s.db.QueryRow(`SELECT read_seq FROM members WHERE conversation_id=? AND user_id=?`, cid, peer).Scan(&seq)
	return seq, err
}
