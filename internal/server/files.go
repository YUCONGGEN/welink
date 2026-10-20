package server

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"welink/internal/publicweb"
)

func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	if s.settings.Chat.UploadsPerHour > 0 && !s.rate(r, "upload:"+uid(r), s.settings.Chat.UploadsPerHour, time.Hour) {
		fail(w, 429, "上传过于频繁")
		return
	}
	if !s.uploadSlot(w, r) {
		return
	}
	defer func() { <-s.uploadSlots }()
	reader, e := r.MultipartReader()
	if e != nil {
		fail(w, 400, "请选择文件")
		return
	}
	fields := url.Values{}
	id := newID()
	volume, e := s.selectStorage(r.ContentLength)
	if e != nil {
		s.dbError(w, e)
		return
	}
	path := objectPath(volume, "uploads", "", id)
	if e = os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		s.dbError(w, e)
		return
	}
	var name, typ string
	var size int64
	var digestValue string
	seenFile, committed := false, false
	defer func() {
		if !committed {
			_ = os.Remove(path)
		}
	}()
	for parts := 0; ; parts++ {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil || parts >= 20 {
			fail(w, 400, "文件数据不完整")
			return
		}
		if part.FormName() == "file" && part.FileName() != "" {
			if seenFile {
				part.Close()
				fail(w, 400, "每次上传一个文件")
				return
			}
			seenFile = true
			name = filepath.Base(strings.ReplaceAll(part.FileName(), "\\", "/"))
			if !safeFileName(name) {
				part.Close()
				fail(w, 400, "文件名无效")
				return
			}
			// The app puts conversationId before the file. Reject before writing when
			// provided, and always recheck permissions after the complete body.
			if cid := fields.Get("conversationId"); cid != "" && !s.canSpeak(cid, uid(r)) {
				part.Close()
				fail(w, 403, "无法向该会话发送文件")
				return
			}
			out, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
			if err != nil {
				part.Close()
				s.dbError(w, err)
				return
			}
			header := make([]byte, 512)
			n, err := io.ReadFull(part, header)
			if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
				out.Close()
				part.Close()
				fail(w, 400, "读取文件失败")
				return
			}
			typ = http.DetectContentType(header[:n])
			digest := sha256.New()
			size, e = s.copyUpload(volume, io.MultiWriter(out, digest), io.MultiReader(bytes.NewReader(header[:n]), part), s.settings.Chat.MaxAttachmentBytes)
			closeErr := out.Close()
			part.Close()
			if e != nil || closeErr != nil {
				fail(w, 507, "上传未完成，请检查文件、网络或服务器可用空间")
				return
			}
			digestValue = fmt.Sprintf("%x", digest.Sum(nil))
		} else {
			raw, err := io.ReadAll(io.LimitReader(part, 8193))
			part.Close()
			if err != nil || len(raw) > 8192 {
				fail(w, 400, "上传字段过长")
				return
			}
			fields.Set(part.FormName(), string(raw))
		}
	}
	if !seenFile {
		fail(w, 400, "请选择文件")
		return
	}
	cid, clientID := fields.Get("conversationId"), fields.Get("clientId")
	if clientID != "" && (len(clientID) < 8 || len(clientID) > 100) {
		fail(w, 400, "上传标识无效")
		return
	}
	if !s.canSpeak(cid, uid(r)) {
		fail(w, 403, "无法向该会话发送文件")
		return
	}
	media, typ, e := inspectMedia(path, fields.Get("mediaKind"), typ, fields)
	if e != nil {
		fail(w, 400, e.Error())
		return
	}
	tx, e := s.db.Begin()
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer tx.Rollback()
	// Recheck after reading the body: membership or contact permissions may have changed.
	if !canSpeak(tx, cid, uid(r)) {
		fail(w, 403, "无法向该会话发送文件")
		return
	}
	identity, _ := json.Marshal([]any{cid, name, typ, size, media, digestValue})
	fingerprint := fmt.Sprintf("%x", sha256.Sum256(identity))
	if clientID != "" {
		var previousID, previousFingerprint string
		e = tx.QueryRow("SELECT attachment_id,fingerprint FROM upload_requests WHERE user_id=? AND client_id=?", uid(r), clientID).Scan(&previousID, &previousFingerprint)
		if e == nil {
			if previousFingerprint != fingerprint {
				fail(w, 409, "该上传标识已用于其他内容")
				return
			}
			ok(w, map[string]any{"id": previousID, "name": name, "mime": typ, "size": size, "media": media})
			return
		}
		if e != sql.ErrNoRows {
			s.dbError(w, e)
			return
		}
	}
	if _, e = tx.Exec("INSERT INTO attachments VALUES(?,?,?,?,?,?,?)", id, uid(r), cid, name, typ, size, now()); e != nil {
		s.dbError(w, e)
		return
	}
	if media != nil {
		if _, e = tx.Exec("INSERT INTO attachment_media VALUES(?,?,?,?,?)", id, media.Kind, media.DurationMS, media.Width, media.Height); e != nil {
			s.dbError(w, e)
			return
		}
	}
	if clientID != "" {
		if _, e = tx.Exec("INSERT INTO upload_requests VALUES(?,?,?,?)", uid(r), clientID, id, fingerprint); e != nil {
			s.dbError(w, e)
			return
		}
	}
	if e = storeLocation(tx, "uploads", "", id, volume); e != nil {
		s.dbError(w, e)
		return
	}
	if e = tx.Commit(); e != nil {
		s.dbError(w, e)
		return
	}
	committed = true
	ok(w, map[string]any{"id": id, "name": name, "mime": typ, "size": size, "media": media})
}
func (s *Server) download(w http.ResponseWriter, r *http.Request) {
	if err := s.storageReady(); err != nil {
		fail(w, 503, err.Error())
		return
	}
	var cid, name, typ, blob string
	if s.db.QueryRow("SELECT a.conversation_id,a.name,a.mime,COALESCE(b.blob_id,a.id) FROM attachments a LEFT JOIN attachment_blobs b ON b.attachment_id=a.id WHERE a.id=?", r.PathValue("id")).Scan(&cid, &name, &typ, &blob) != nil {
		fail(w, 404, "文件不存在")
		return
	}
	if !s.member(cid, uid(r)) {
		fail(w, 403, "无权下载该文件")
		return
	}
	f, e := s.openStored("uploads", "", blob)
	if e != nil {
		fail(w, 503, "文件所在磁盘暂不可用，请恢复磁盘挂载")
		return
	}
	defer f.Close()
	stat, e := f.Stat()
	if e != nil {
		s.dbError(w, e)
		return
	}
	disposition := "attachment"
	if typ == "image/png" || typ == "image/jpeg" || typ == "image/gif" || typ == "image/webp" || typ == "audio/wav" || typ == "video/mp4" || typ == "video/webm" {
		disposition = "inline"
	}
	w.Header().Set("Content-Type", typ)
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": name}))
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
	http.ServeContent(w, r, name, stat.ModTime(), f)
}
func (s *Server) files(w http.ResponseWriter, r *http.Request) {
	rows, e := s.db.Query("SELECT a.id,a.name,a.mime,a.size,m.created,c.name,m.id,c.id FROM messages m JOIN attachments a ON a.id=m.attachment_id JOIN members member ON member.conversation_id=m.conversation_id JOIN conversations c ON c.id=m.conversation_id WHERE member.user_id=? AND m.recalled=0 AND NOT EXISTS(SELECT 1 FROM message_deletions d WHERE d.message_id=m.id AND d.user_id=member.user_id) ORDER BY m.created DESC,m.seq DESC LIMIT 200", uid(r))
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name, typ, conversation, messageID, conversationID string
		var size, created int64
		if e = rows.Scan(&id, &name, &typ, &size, &created, &conversation, &messageID, &conversationID); e != nil {
			s.dbError(w, e)
			return
		}
		out = append(out, map[string]any{"id": id, "name": name, "mime": typ, "size": size, "created": created, "conversation": conversation, "messageId": messageID, "conversationId": conversationID})
	}
	ok(w, out)
}
func (s *Server) landing(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/downloads/") && s.downloads != "" {
		name := strings.TrimPrefix(r.URL.Path, "/downloads/")
		// New public filenames serve the same versioned binaries as existing links.
		switch name {
		case "LinkMe-Windows.exe":
			name = "WeLink-Windows.exe"
		case "LinkMe-Setup.exe":
			name = "WeLink-Setup.exe"
		case "LinkMe-Android.apk":
			name = "WeLink-Android.apk"
		}
		if name != "LinkMe-Windows.exe" && name != "LinkMe-Android.apk" && name != "LinkMe-Setup.exe" && name != "LinkMe-macOS-arm64.zip" && name != "SHA256SUMS.txt" && name != "WeLink-Windows.exe" && name != "WeLink-Android.apk" && name != "WeLink-Setup.exe" {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(s.downloads, name))
		return
	}
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	if err := publicweb.Render(w, publicweb.Page{Kind: "download", Title: "LinkMe · 即时通讯", DownloadURL: strings.TrimRight(s.settings.DownloadURL, "/"), DriveGB: s.settings.Drive.QuotaGB}); err != nil {
		s.logger.Printf("render download page: %v", err)
	}
}
