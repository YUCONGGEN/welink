package server

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const maxUpload = 50 << 20

func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	if !s.rate(r, "upload:"+uid(r), 60, time.Hour) {
		fail(w, 429, "上传过于频繁")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUpload+(1<<20))
	if e := r.ParseMultipartForm(1 << 20); e != nil {
		fail(w, 400, "文件不能超过 50 MB")
		return
	}
	defer r.MultipartForm.RemoveAll()
	cid := r.FormValue("conversationId")
	if !s.member(cid, uid(r)) {
		fail(w, 403, "无法向该会话发送文件")
		return
	}
	f, h, e := r.FormFile("file")
	if e != nil {
		fail(w, 400, "请选择文件")
		return
	}
	defer f.Close()
	name := filepath.Base(strings.ReplaceAll(h.Filename, `\`, "/"))
	if !validText(name, 240) || name == "." || name == "" || strings.ContainsAny(name, "\r\n") {
		fail(w, 400, "文件名无效")
		return
	}
	id := newID()
	path := filepath.Join(s.dir, "uploads", id)
	out, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		s.dbError(w, e)
		return
	}
	committed := false
	defer func() {
		out.Close()
		if !committed {
			_ = os.Remove(path)
		}
	}()
	header := make([]byte, 512)
	n, e := io.ReadFull(f, header)
	if e != nil && e != io.EOF && e != io.ErrUnexpectedEOF {
		fail(w, 400, "读取文件失败")
		return
	}
	typ := http.DetectContentType(header[:n])
	if _, e = out.Write(header[:n]); e != nil {
		s.dbError(w, e)
		return
	}
	rest, e := io.Copy(out, io.LimitReader(f, maxUpload+1))
	size := int64(n) + rest
	if e != nil || size > maxUpload {
		fail(w, 400, "文件上传失败或超过 50 MB")
		return
	}
	if e = out.Close(); e != nil {
		s.dbError(w, e)
		return
	}
	media, typ, e := inspectMedia(path, r.FormValue("mediaKind"), typ, r.PostForm)
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
	if e = tx.Commit(); e != nil {
		s.dbError(w, e)
		return
	}
	committed = true
	ok(w, map[string]any{"id": id, "name": name, "mime": typ, "size": size, "media": media})
}
func (s *Server) download(w http.ResponseWriter, r *http.Request) {
	var cid, name, typ, blob string
	if s.db.QueryRow("SELECT a.conversation_id,a.name,a.mime,COALESCE(b.blob_id,a.id) FROM attachments a LEFT JOIN attachment_blobs b ON b.attachment_id=a.id WHERE a.id=?", r.PathValue("id")).Scan(&cid, &name, &typ, &blob) != nil {
		fail(w, 404, "文件不存在")
		return
	}
	if !s.member(cid, uid(r)) {
		fail(w, 403, "无权下载该文件")
		return
	}
	f, e := os.Open(filepath.Join(s.dir, "uploads", blob))
	if e != nil {
		fail(w, 404, "文件已不可用")
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
