package server

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"welink/internal/publicweb"
)

const spaceSchema = `
CREATE TABLE IF NOT EXISTS space_profiles(owner TEXT PRIMARY KEY REFERENCES users(id),visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public','selected')));
CREATE TABLE IF NOT EXISTS space_readers(owner TEXT NOT NULL REFERENCES users(id),reader TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(owner,reader));
CREATE TABLE IF NOT EXISTS space_documents(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,blob TEXT NOT NULL,size INTEGER NOT NULL,revision INTEGER NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS space_docs_owner ON space_documents(owner,updated DESC);
`

type spaceDocument struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Size     int64  `json:"size"`
	Revision int64  `json:"revision"`
	Created  int64  `json:"created"`
	Updated  int64  `json:"updated"`
	Content  string `json:"content,omitempty"`
}

func canReadSpace(q rowQuery, owner, viewer string) bool {
	if owner == viewer && owner != "" {
		return true
	}
	var n int
	return q.QueryRow("SELECT 1 FROM space_profiles p WHERE owner=? AND (visibility='public' OR (visibility='selected' AND EXISTS(SELECT 1 FROM space_readers WHERE owner=p.owner AND reader=?)))", owner, viewer).Scan(&n) == nil
}
func (s *Server) spaceOwner(value string) (string, error) {
	if value == "me" {
		return "", sql.ErrNoRows
	}
	var id string
	err := s.db.QueryRow("SELECT u.id FROM users u JOIN user_numbers n ON n.user_id=u.id WHERE u.id=? OR CAST(n.number AS TEXT)=?", value, value).Scan(&id)
	return id, err
}
func (s *Server) resolveSpace(r *http.Request) (string, error) {
	if r.PathValue("user") == "me" {
		return uid(r), nil
	}
	return s.spaceOwner(r.PathValue("user"))
}
func (s *Server) spacePath(owner, blob string) string {
	return s.storedPath("spaces", owner, blob)
}
func (s *Server) listSpace(w http.ResponseWriter, r *http.Request) {
	owner, err := s.resolveSpace(r)
	if err != nil {
		fail(w, 404, "空间不存在")
		return
	}
	if !canReadSpace(s.db, owner, uid(r)) {
		fail(w, 403, "这个空间未向你开放")
		return
	}
	visibility := "private"
	_ = s.db.QueryRow("SELECT visibility FROM space_profiles WHERE owner=?", owner).Scan(&visibility)
	readers := []string{}
	if owner == uid(r) {
		rows, e := s.db.Query("SELECT reader FROM space_readers WHERE owner=? ORDER BY reader", owner)
		if e != nil {
			s.dbError(w, e)
			return
		}
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil {
				readers = append(readers, id)
			}
		}
		rows.Close()
	}
	rows, err := s.db.Query("SELECT id,title,size,revision,created,updated FROM space_documents WHERE owner=? ORDER BY updated DESC,id", owner)
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer rows.Close()
	docs := []spaceDocument{}
	for rows.Next() {
		var d spaceDocument
		if err = rows.Scan(&d.ID, &d.Title, &d.Size, &d.Revision, &d.Created, &d.Updated); err != nil {
			s.dbError(w, err)
			return
		}
		docs = append(docs, d)
	}
	if err = rows.Err(); err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, map[string]any{"owner": owner, "visibility": visibility, "viewers": readers, "documents": docs, "maxDocumentBytes": s.settings.Spaces.MaxDocumentBytes, "publicURL": strings.TrimRight(s.settings.PublicURL, "/") + "/space/" + owner})
}
func (s *Server) setSpaceAccess(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Visibility string
		Viewers    []string
	}
	if !decode(w, r, &p) {
		return
	}
	if p.Visibility != "private" && p.Visibility != "public" && p.Visibility != "selected" {
		fail(w, 400, "请选择空间可见范围")
		return
	}
	readers := []string{}
	if p.Visibility == "selected" {
		var valid bool
		readers, valid = uniqueIDs(p.Viewers, 200)
		if !valid {
			fail(w, 400, "请选择 1–200 位可见用户")
			return
		}
	}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	for _, id := range readers {
		var n int
		if id == uid(r) || tx.QueryRow("SELECT 1 FROM users WHERE id=?", id).Scan(&n) != nil {
			fail(w, 400, "可见用户无效")
			return
		}
	}
	if _, err = tx.Exec("INSERT INTO space_profiles(owner,visibility) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET visibility=excluded.visibility", uid(r), p.Visibility); err != nil {
		s.dbError(w, err)
		return
	}
	if _, err = tx.Exec("DELETE FROM space_readers WHERE owner=?", uid(r)); err != nil {
		s.dbError(w, err)
		return
	}
	for _, id := range readers {
		if _, err = tx.Exec("INSERT INTO space_readers VALUES(?,?)", uid(r), id); err != nil {
			s.dbError(w, err)
			return
		}
	}
	if err = tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	s.push([]string{uid(r)}, "space", map[string]bool{"ok": true})
	ok(w, map[string]bool{"ok": true})
}
func (s *Server) readSpaceDocument(w http.ResponseWriter, r *http.Request) {
	owner, err := s.resolveSpace(r)
	if err != nil || !canReadSpace(s.db, owner, uid(r)) {
		fail(w, 404, "文档不存在或不可访问")
		return
	}
	var d spaceDocument
	var blob string
	err = s.db.QueryRow("SELECT id,title,size,revision,created,updated,blob FROM space_documents WHERE id=? AND owner=?", r.PathValue("id"), owner).Scan(&d.ID, &d.Title, &d.Size, &d.Revision, &d.Created, &d.Updated, &blob)
	if err != nil {
		fail(w, 404, "文档不存在")
		return
	}
	if err = s.storageReady(); err != nil {
		fail(w, 503, err.Error())
		return
	}
	file, err := s.openStored("spaces", owner, blob)
	if err != nil {
		fail(w, 503, "文档所在磁盘暂不可用")
		return
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, s.settings.Spaces.MaxDocumentBytes+1))
	if err != nil {
		fail(w, 503, "文档存储暂不可用")
		return
	}
	d.Content = string(raw)
	ok(w, d)
}
func (s *Server) saveSpaceDocument(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Title, Content string
		Revision       int64
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.settings.Spaces.MaxDocumentBytes*6+8192)
	if json.NewDecoder(r.Body).Decode(&p) != nil {
		fail(w, 400, "文档数据无效或过大")
		return
	}
	p.Title = strings.TrimSpace(p.Title)
	if p.Title == "" || !validText(p.Title, 120) || !validText(p.Content, int(s.settings.Spaces.MaxDocumentBytes)) || int64(len(p.Content)) > s.settings.Spaces.MaxDocumentBytes {
		fail(w, 400, "标题或文档内容超过配置限制")
		return
	}
	if !s.uploadSlot(w, r) {
		return
	}
	defer func() { <-s.uploadSlots }()
	id := r.PathValue("id")
	if id == "" {
		id = newID()
	}
	blob := newID()
	volume, err := s.selectStorage(int64(len(p.Content)))
	if err != nil {
		s.dbError(w, err)
		return
	}
	path := objectPath(volume, "spaces", uid(r), blob)
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
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
	_, err = s.copyUpload(volume, file, strings.NewReader(p.Content), s.settings.Spaces.MaxDocumentBytes)
	closeErr := file.Close()
	if err != nil || closeErr != nil {
		fail(w, 507, "文档未能写入存储磁盘")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	var oldBlob string
	var oldRevision, created int64
	err = tx.QueryRow("SELECT blob,revision,created FROM space_documents WHERE id=? AND owner=?", id, uid(r)).Scan(&oldBlob, &oldRevision, &created)
	fresh := r.PathValue("id") == ""
	if fresh {
		var count int
		if tx.QueryRow("SELECT COUNT(*) FROM space_documents WHERE owner=?", uid(r)).Scan(&count) != nil || count >= s.settings.Spaces.MaxDocuments {
			fail(w, 409, "空间文档数量已达上限")
			return
		}
		created = now()
	} else {
		if err != nil {
			fail(w, 404, "文档不存在")
			return
		}
		if p.Revision != oldRevision {
			fail(w, 409, "文档已在其他设备修改，请重新打开后保存")
			return
		}
	}
	updated := now()
	revision := oldRevision + 1
	if fresh {
		_, err = tx.Exec("INSERT INTO space_documents VALUES(?,?,?,?,?,?,?,?)", id, uid(r), p.Title, blob, len(p.Content), revision, created, updated)
	} else {
		_, err = tx.Exec("UPDATE space_documents SET title=?,blob=?,size=?,revision=?,updated=? WHERE id=? AND owner=?", p.Title, blob, len(p.Content), revision, updated, id, uid(r))
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	if err = storeLocation(tx, "spaces", uid(r), blob, volume); err != nil {
		s.dbError(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	committed = true
	s.cleanStorage()
	s.push([]string{uid(r)}, "space", map[string]string{"id": id})
	ok(w, spaceDocument{ID: id, Title: p.Title, Size: int64(len(p.Content)), Revision: revision, Created: created, Updated: updated, Content: p.Content})
}
func (s *Server) deleteSpaceDocument(w http.ResponseWriter, r *http.Request) {
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	id := r.PathValue("id")
	var blob string
	if tx.QueryRow("SELECT blob FROM space_documents WHERE id=? AND owner=?", id, uid(r)).Scan(&blob) != nil {
		fail(w, 404, "文档不存在")
		return
	}
	if _, err = tx.Exec("DELETE FROM space_documents WHERE id=? AND owner=?", id, uid(r)); err != nil {
		s.dbError(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	s.cleanStorage()
	s.push([]string{uid(r)}, "space", map[string]bool{"ok": true})
	ok(w, map[string]bool{"ok": true})
}
func (s *Server) publicSpace(w http.ResponseWriter, r *http.Request) {
	owner, err := s.spaceOwner(r.PathValue("user"))
	if err != nil || !canReadSpace(s.db, owner, "") {
		http.NotFound(w, r)
		return
	}
	var name string
	_ = s.db.QueryRow("SELECT name FROM users WHERE id=?", owner).Scan(&name)
	page := publicweb.Page{Kind: "space", Title: "WeLink 空间", Name: name + " 的 WeLink 空间", DownloadURL: strings.TrimRight(s.settings.DownloadURL, "/")}
	id := r.URL.Query().Get("doc")
	if id != "" {
		var title, blob string
		if s.db.QueryRow("SELECT title,blob FROM space_documents WHERE id=? AND owner=?", id, owner).Scan(&title, &blob) != nil {
			http.NotFound(w, r)
			return
		}
		if err = s.storageReady(); err != nil {
			fail(w, 503, err.Error())
			return
		}
		f, e := s.openStored("spaces", owner, blob)
		if e != nil {
			fail(w, 503, "文档所在磁盘暂不可用")
			return
		}
		raw, e := io.ReadAll(io.LimitReader(f, s.settings.Spaces.MaxDocumentBytes+1))
		f.Close()
		if e != nil {
			fail(w, 503, "文档读取失败")
			return
		}
		page.Name = title + " · " + name + " 的 WeLink 空间"
		page.Content = string(raw)
		page.DocumentOpen = true
	} else {
		rows, e := s.db.Query("SELECT id,title FROM space_documents WHERE owner=? ORDER BY updated DESC,id", owner)
		if e != nil {
			s.dbError(w, e)
			return
		}
		for rows.Next() {
			var doc, title string
			if rows.Scan(&doc, &title) == nil {
				page.Documents = append(page.Documents, publicweb.Document{ID: doc, Title: title})
			}
		}
		rows.Close()
	}
	if err := publicweb.Render(w, page); err != nil {
		s.logger.Printf("render public space: %v", err)
	}
}
