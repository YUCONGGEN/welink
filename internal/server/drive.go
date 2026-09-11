package server

import (
	"database/sql"
	"errors"
	"fmt"
	"html/template"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const driveSchema = `
CREATE TABLE IF NOT EXISTS drive_files(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,size INTEGER NOT NULL CHECK(size>=0),mime TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS drive_owner ON drive_files(owner,created DESC,id);
CREATE TABLE IF NOT EXISTS drive_shares(token TEXT PRIMARY KEY,file_id TEXT NOT NULL REFERENCES drive_files(id) ON DELETE CASCADE,created INTEGER NOT NULL,expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS drive_share_file ON drive_shares(file_id);
`

type driveFile struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	MIME    string `json:"mime"`
	Created int64  `json:"created"`
	Updated int64  `json:"updated"`
}

func driveUsage(q rowQuery, user string) (int64, int, error) {
	var used int64
	var count int
	err := q.QueryRow("SELECT COALESCE(SUM(size),0),COUNT(*) FROM drive_files WHERE owner=?", user).Scan(&used, &count)
	return used, count, err
}
func (s *Server) drivePath(user, id string) string {
	return s.storedPath("yunpan", user, id)
}
func (s *Server) listDrive(w http.ResponseWriter, r *http.Request) {
	used, count, err := driveUsage(s.db, uid(r))
	if err != nil {
		s.dbError(w, err)
		return
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if offset < 0 {
		offset = 0
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if !validText(query, 240) {
		fail(w, 400, "搜索内容过长")
		return
	}
	rows, err := s.db.Query("SELECT id,name,size,mime,created,updated FROM drive_files WHERE owner=? AND name LIKE ? ESCAPE '\\' ORDER BY created DESC,id LIMIT 101 OFFSET ?", uid(r), "%"+escapeLike(query)+"%", offset)
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer rows.Close()
	files := []driveFile{}
	for rows.Next() {
		var f driveFile
		if err = rows.Scan(&f.ID, &f.Name, &f.Size, &f.MIME, &f.Created, &f.Updated); err != nil {
			s.dbError(w, err)
			return
		}
		files = append(files, f)
	}
	if err = rows.Err(); err != nil {
		s.dbError(w, err)
		return
	}
	more := len(files) > 100
	if more {
		files = files[:100]
	}
	ok(w, map[string]any{"files": files, "used": used, "quota": s.settings.driveQuota(), "count": count, "hasMore": more, "storageAvailable": s.storageReady() == nil})
}
func (s *Server) uploadDrive(w http.ResponseWriter, r *http.Request) {
	if !s.uploadSlot(w, r) {
		return
	}
	defer func() { <-s.uploadSlots }()
	used, count, err := driveUsage(s.db, uid(r))
	if err != nil {
		s.dbError(w, err)
		return
	}
	quota := s.settings.driveQuota()
	if used >= quota || count >= s.settings.Drive.MaxFiles {
		fail(w, 409, "网盘容量或文件数量已满")
		return
	}
	reader, err := r.MultipartReader()
	if err != nil {
		fail(w, 400, "请选择文件")
		return
	}
	part, err := reader.NextPart()
	if err != nil {
		fail(w, 400, "请选择文件")
		return
	}
	defer part.Close()
	name := part.FileName()
	if part.FormName() != "file" || !safeFileName(name) {
		fail(w, 400, "文件名无效")
		return
	}
	id := newID()
	volume, err := s.selectStorage(r.ContentLength)
	if err != nil {
		s.dbError(w, err)
		return
	}
	path := objectPath(volume, "yunpan", uid(r), id)
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		s.dbError(w, err)
		return
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		s.dbError(w, err)
		return
	}
	committed := false
	defer func() {
		file.Close()
		if !committed {
			os.Remove(path)
		}
	}()
	size, err := s.copyUpload(volume, file, part, quota-used)
	closeErr := file.Close()
	if err != nil {
		fail(w, 507, "上传失败："+err.Error())
		return
	}
	if closeErr != nil {
		s.dbError(w, closeErr)
		return
	}
	if extra, e := reader.NextPart(); e != io.EOF {
		if extra != nil {
			extra.Close()
		}
		fail(w, 400, "每次上传一个文件")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	used, count, err = driveUsage(tx, uid(r))
	if err != nil {
		s.dbError(w, err)
		return
	}
	if used+size > quota || count >= s.settings.Drive.MaxFiles {
		fail(w, 409, "网盘容量不足，请删除文件后重试")
		return
	}
	f := driveFile{ID: id, Name: name, Size: size, MIME: "application/octet-stream", Created: now(), Updated: now()}
	if _, err = tx.Exec("INSERT INTO drive_files VALUES(?,?,?,?,?,?,?)", id, uid(r), name, size, f.MIME, f.Created, f.Updated); err != nil {
		s.dbError(w, err)
		return
	}
	if err = storeLocation(tx, "yunpan", uid(r), id, volume); err != nil {
		s.dbError(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	committed = true
	s.push([]string{uid(r)}, "drive", map[string]string{"id": id})
	ok(w, f)
}
func (s *Server) renameDrive(w http.ResponseWriter, r *http.Request) {
	var p struct{ Name string }
	if !decode(w, r, &p) {
		return
	}
	p.Name = strings.TrimSpace(p.Name)
	if !safeFileName(p.Name) {
		fail(w, 400, "文件名无效")
		return
	}
	result, err := s.db.Exec("UPDATE drive_files SET name=?,updated=? WHERE id=? AND owner=?", p.Name, now(), r.PathValue("id"), uid(r))
	if err != nil {
		s.dbError(w, err)
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		fail(w, 404, "文件不存在")
		return
	}
	s.push([]string{uid(r)}, "drive", map[string]bool{"ok": true})
	ok(w, map[string]bool{"ok": true})
}
func (s *Server) deleteDrive(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	result, err := s.db.Exec("DELETE FROM drive_files WHERE id=? AND owner=?", id, uid(r))
	if err != nil {
		s.dbError(w, err)
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		fail(w, 404, "文件不存在")
		return
	}
	s.cleanStorage()
	s.push([]string{uid(r)}, "drive", map[string]bool{"ok": true})
	ok(w, map[string]bool{"ok": true})
}
func (s *Server) serveDriveFile(w http.ResponseWriter, r *http.Request, id, owner, name string) {
	if err := s.storageReady(); err != nil {
		fail(w, 503, err.Error())
		return
	}
	f, err := s.openStored("yunpan", owner, id)
	if err != nil {
		fail(w, 503, "文件所在磁盘暂不可用，请恢复磁盘挂载")
		return
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		s.dbError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
	http.ServeContent(w, r, name, stat.ModTime(), f)
}
func (s *Server) downloadDrive(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var name string
	if err := s.db.QueryRow("SELECT name FROM drive_files WHERE id=? AND owner=?", id, uid(r)).Scan(&name); err != nil {
		fail(w, 404, "文件不存在")
		return
	}
	s.serveDriveFile(w, r, id, uid(r), name)
}
func (s *Server) shareDrive(w http.ResponseWriter, r *http.Request) {
	var p struct{ Days int }
	if !decode(w, r, &p) {
		return
	}
	if p.Days == 0 {
		p.Days = 7
	}
	if p.Days < 1 || p.Days > 365 {
		fail(w, 400, "分享有效期应为 1–365 天")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	id := r.PathValue("id")
	var exists int
	if tx.QueryRow("SELECT 1 FROM drive_files WHERE id=? AND owner=?", id, uid(r)).Scan(&exists) != nil {
		fail(w, 404, "文件不存在")
		return
	}
	// Keep one current capability per file. Creating a new link revokes the old.
	if _, err = tx.Exec("DELETE FROM drive_shares WHERE file_id=?", id); err != nil {
		s.dbError(w, err)
		return
	}
	token := newID() + newID()
	expires := now() + int64(p.Days)*int64(24*time.Hour/time.Millisecond)
	if _, err = tx.Exec("INSERT INTO drive_shares VALUES(?,?,?,?)", token, id, now(), expires); err != nil {
		s.dbError(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, map[string]any{"url": strings.TrimRight(s.settings.PublicURL, "/") + "/share/" + token, "expires": expires})
}
func (s *Server) revokeDriveShare(w http.ResponseWriter, r *http.Request) {
	result, err := s.db.Exec("DELETE FROM drive_shares WHERE file_id IN (SELECT id FROM drive_files WHERE id=? AND owner=?)", r.PathValue("id"), uid(r))
	_ = result
	if err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, map[string]bool{"ok": true})
}
func (s *Server) publicDriveShare(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	if len(token) != 64 {
		http.NotFound(w, r)
		return
	}
	var id, owner, name string
	var size, expires int64
	err := s.db.QueryRow("SELECT f.id,f.owner,f.name,f.size,s.expires FROM drive_shares s JOIN drive_files f ON f.id=s.file_id WHERE s.token=? AND s.expires>?", token, now()).Scan(&id, &owner, &name, &size, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	if r.URL.Query().Get("download") == "1" {
		s.serveDriveFile(w, r, id, owner, name)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
	fmt.Fprintf(w, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WeLink 网盘分享</title><style>body{margin:0;background:#f1f7ff;color:#31435a;font:16px system-ui;display:grid;min-height:100vh;place-items:center}main{box-sizing:border-box;background:white;border-radius:20px;padding:36px;width:min(92vw,520px)}h1{font-size:22px;overflow-wrap:anywhere}p{color:#8191a5}a{display:block;padding:14px;text-align:center;background:#0099ff;color:white;text-decoration:none;border-radius:8px}</style><main><b>WeLink 网盘</b><h1>%s</h1><p>%.2f MB · 链接有效至 %s</p><a href="?download=1">下载文件</a></main></html>`, template.HTMLEscapeString(name), float64(size)/(1<<20), time.UnixMilli(expires).Format("2006-01-02"))
}
