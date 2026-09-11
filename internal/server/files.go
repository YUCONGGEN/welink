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
	rows, e := s.db.Query("SELECT a.id,a.name,a.mime,a.size,a.created,c.name FROM attachments a JOIN members m ON m.conversation_id=a.conversation_id JOIN conversations c ON c.id=a.conversation_id WHERE m.user_id=? ORDER BY a.created DESC LIMIT 200", uid(r))
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name, typ, conversation string
		var size, created int64
		_ = rows.Scan(&id, &name, &typ, &size, &created, &conversation)
		out = append(out, map[string]any{"id": id, "name": name, "mime": typ, "size": size, "created": created, "conversation": conversation})
	}
	ok(w, out)
}
func (s *Server) landing(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/downloads/") && s.downloads != "" {
		name := strings.TrimPrefix(r.URL.Path, "/downloads/")
		if name != "WeLink-Windows.exe" && name != "WeLink-Android.apk" && name != "SHA256SUMS.txt" && name != "WeLink-Setup.exe" {
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
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WeLink · 让沟通更近一步</title><style>*{box-sizing:border-box}body{margin:0;color:#182b46;background:linear-gradient(140deg,#fff5f7,#eaf4ff 45%,#e9fbfb);font:16px system-ui;min-height:100vh;display:grid;place-items:center}.wrap{max-width:820px;padding:72px 28px}b{color:#0099ff}h1{font-size:68px;margin:20px 0}p{line-height:1.9;color:#63748a}.links{display:flex;gap:16px;flex-wrap:wrap;margin-top:40px}a{background:#0099ff;color:white;padding:16px 26px;border-radius:12px;text-decoration:none}small{display:block;margin-top:48px;color:#7c8c9f}</style><main class="wrap"><b>WeLink</b><h1>每一句，都有回应。</h1><p>熟悉的聊天方式，连接身边的人。<br>专属数字号码，消息、群聊、文件、会议与远程协助，在一个窗口里。</p><div class="links"><a href="/downloads/WeLink-Setup.exe">下载 Windows 版</a><a href="/downloads/WeLink-Android.apk">下载 Android 版</a></div><small>WeLink 0.1.0 预览版 · Windows 10/11、Android 8 及以上</small></main></html>`)
}
