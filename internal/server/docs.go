package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Roles a user can hold on a document, highest wins: a direct grant, a grant
// to a chat they are in, or the document's link setting.
const (
	docNone = iota
	docView
	docEdit
	docManage
	docOwner
)

var docRoleNames = map[int]string{docView: "view", docEdit: "edit", docManage: "manage", docOwner: "owner"}

const docSchema = `
CREATE TABLE IF NOT EXISTS docs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0,link_role INTEGER NOT NULL DEFAULT 0,viewer_export INTEGER NOT NULL DEFAULT 1,created INTEGER NOT NULL,updated INTEGER NOT NULL,updated_by TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS docs_owner ON docs(owner,updated);
CREATE TABLE IF NOT EXISTS doc_members(doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,user_id TEXT NOT NULL,role INTEGER NOT NULL,added INTEGER NOT NULL,PRIMARY KEY(doc_id,user_id));
CREATE INDEX IF NOT EXISTS doc_members_user ON doc_members(user_id);
CREATE TABLE IF NOT EXISTS doc_groups(doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,conversation_id TEXT NOT NULL,role INTEGER NOT NULL,added INTEGER NOT NULL,PRIMARY KEY(doc_id,conversation_id));
CREATE TABLE IF NOT EXISTS doc_recents(doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,user_id TEXT NOT NULL,opened INTEGER NOT NULL,PRIMARY KEY(doc_id,user_id));
CREATE INDEX IF NOT EXISTS doc_recents_user ON doc_recents(user_id,opened);
CREATE TABLE IF NOT EXISTS doc_versions(id INTEGER PRIMARY KEY AUTOINCREMENT,doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,version INTEGER NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,author TEXT NOT NULL,created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS doc_versions_doc ON doc_versions(doc_id,id);
`

const (
	docVersionEvery = 5 * time.Minute
	docVersionsKept = 200
	docsPerUser     = 2000
)

// docHub holds who has each document open (for live operations and the
// collaborator avatars) and recent batch results, so a retried batch is
// answered instead of applied twice.
type docHub struct {
	mu      sync.Mutex
	viewers map[string]map[string]*docViewer
	batches map[string]docBatchResult
}
type docViewer struct {
	UserID string `json:"userId"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
	Client string `json:"clientId"`
	Where  string `json:"where"`
	seen   time.Time
}
type docBatchResult struct {
	at   time.Time
	resp map[string]any
}

type docRecord struct {
	ID, Owner, Kind, Title, Content, UpdatedBy string
	Version                                    int64
	LinkRole                                   int
	ViewerExport                               bool
	Created, Updated                           int64
}

func scanDoc(q rowQuery, id string) (docRecord, error) {
	var d docRecord
	err := q.QueryRow("SELECT id,owner,kind,title,content,version,link_role,viewer_export,created,updated,updated_by FROM docs WHERE id=?", id).Scan(&d.ID, &d.Owner, &d.Kind, &d.Title, &d.Content, &d.Version, &d.LinkRole, &d.ViewerExport, &d.Created, &d.Updated, &d.UpdatedBy)
	return d, err
}

// docRole is what user may do with document id; kind is "" if it is missing.
func docRole(q rowQuery, id, user string) (role int, kind string) {
	var owner string
	var link, direct, group int
	if q.QueryRow(`SELECT owner,kind,link_role,COALESCE((SELECT role FROM doc_members WHERE doc_id=d.id AND user_id=?),0),COALESCE((SELECT MAX(g.role) FROM doc_groups g JOIN members m ON m.conversation_id=g.conversation_id AND m.user_id=? WHERE g.doc_id=d.id),0) FROM docs d WHERE id=?`, user, user, id).Scan(&owner, &kind, &link, &direct, &group) != nil {
		return docNone, ""
	}
	if owner == user {
		return docOwner, kind
	}
	return max(link, direct, group), kind
}

// requireDoc answers 404/403 itself and returns the caller's role.
func (s *Server) requireDoc(w http.ResponseWriter, r *http.Request, need int) (int, string, bool) {
	role, kind := docRole(s.db, r.PathValue("id"), uid(r))
	if kind == "" {
		fail(w, 404, "文档不存在或已删除")
		return 0, "", false
	}
	if role < need {
		if role == docNone {
			fail(w, 403, "你没有该文档的访问权限，请联系所有者分享")
		} else if need == docEdit {
			fail(w, 403, "你只有阅读权限，无法编辑")
		} else {
			fail(w, 403, "只有文档所有者或管理者可以执行此操作")
		}
		return role, kind, false
	}
	return role, kind, true
}

func docTitle(kind, title string) (string, bool) {
	title = strings.TrimSpace(title)
	if title == "" {
		if kind == "sheet" {
			return "未命名表格", true
		}
		return "未命名文档", true
	}
	return title, validText(title, 100) && !strings.ContainsAny(title, "\r\n")
}

func (s *Server) createDocRecord(owner, kind, title, content string) (string, error) {
	var n int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM docs WHERE owner=?", owner).Scan(&n); err != nil {
		return "", err
	}
	if n >= docsPerUser {
		return "", groupFail(409, "文档数量已达上限，请先删除不需要的文档")
	}
	id, t := newID(), now()
	_, err := s.db.Exec("INSERT INTO docs(id,owner,kind,title,content,created,updated,updated_by) VALUES(?,?,?,?,?,?,?,?)", id, owner, kind, title, content, t, t, owner)
	if err == nil {
		_, err = s.db.Exec("INSERT INTO doc_recents(doc_id,user_id,opened) VALUES(?,?,?)", id, owner, t)
	}
	return id, err
}

func (s *Server) createDoc(w http.ResponseWriter, r *http.Request) {
	var p struct{ Kind, Title string }
	if !decode(w, r, &p) {
		return
	}
	title, valid := docTitle(p.Kind, p.Title)
	if (p.Kind != "doc" && p.Kind != "sheet") || !valid {
		fail(w, 400, "标题最多 100 字")
		return
	}
	var body any = newDocBody()
	if p.Kind == "sheet" {
		body = newSheetBody()
	}
	raw, _ := json.Marshal(body)
	id, err := s.createDocRecord(uid(r), p.Kind, title, string(raw))
	if err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, map[string]string{"id": id})
}

type docSummary struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Title     string `json:"title"`
	Owner     string `json:"ownerId"`
	OwnerName string `json:"ownerName"`
	Updated   int64  `json:"updated"`
	UpdatedBy string `json:"updatedByName"`
	Opened    int64  `json:"opened,omitempty"`
	Role      string `json:"role"`
}

func (s *Server) listDocs(w http.ResponseWriter, r *http.Request) {
	me := uid(r)
	scope, q := r.URL.Query().Get("scope"), strings.TrimSpace(r.URL.Query().Get("q"))
	if !validText(q, 100) {
		fail(w, 400, "搜索内容最多 100 字")
		return
	}
	query := `SELECT d.id,d.kind,d.title,d.owner,COALESCE(o.name,''),d.updated,COALESCE(u.name,''),COALESCE((SELECT opened FROM doc_recents WHERE doc_id=d.id AND user_id=?),0) FROM docs d LEFT JOIN users o ON o.id=d.owner LEFT JOIN users u ON u.id=d.updated_by WHERE `
	args := []any{me}
	order := "d.updated DESC"
	switch scope {
	case "shared":
		query += `d.owner<>? AND (EXISTS(SELECT 1 FROM doc_members WHERE doc_id=d.id AND user_id=?) OR EXISTS(SELECT 1 FROM doc_groups g JOIN members m ON m.conversation_id=g.conversation_id AND m.user_id=? WHERE g.doc_id=d.id)) `
		args = append(args, me, me, me)
	case "recent":
		query += `EXISTS(SELECT 1 FROM doc_recents WHERE doc_id=d.id AND user_id=?) `
		args = append(args, me)
		order = "8 DESC"
	default:
		query += "d.owner=? "
		args = append(args, me)
	}
	if q != "" {
		query += "AND d.title LIKE ? ESCAPE '\\' "
		args = append(args, "%"+escapeLike(q)+"%")
	}
	rows, err := s.db.Query(query+"ORDER BY "+order+" LIMIT 300", args...)
	if err != nil {
		s.dbError(w, err)
		return
	}
	out := []docSummary{}
	for rows.Next() {
		var d docSummary
		if err = rows.Scan(&d.ID, &d.Kind, &d.Title, &d.Owner, &d.OwnerName, &d.Updated, &d.UpdatedBy, &d.Opened); err != nil {
			rows.Close()
			s.dbError(w, err)
			return
		}
		out = append(out, d)
	}
	rows.Close()
	// Recents may include documents whose access was since withdrawn.
	kept := out[:0]
	for _, d := range out {
		if role, _ := docRole(s.db, d.ID, me); role > docNone {
			d.Role = docRoleNames[role]
			kept = append(kept, d)
		}
	}
	ok(w, kept)
}

func (s *Server) docView(d docRecord, role int) map[string]any {
	var ownerName, ownerAvatar string
	_ = s.db.QueryRow("SELECT name,avatar FROM users WHERE id=?", d.Owner).Scan(&ownerName, &ownerAvatar)
	return map[string]any{"id": d.ID, "kind": d.Kind, "title": d.Title, "content": json.RawMessage(d.Content), "version": d.Version, "role": docRoleNames[role],
		"owner": map[string]string{"id": d.Owner, "name": ownerName, "avatar": ownerAvatar}, "linkRole": docRoleNames[d.LinkRole], "viewerExport": d.ViewerExport,
		"updated": d.Updated, "created": d.Created, "canExport": role >= docEdit || d.ViewerExport, "aiEnabled": s.ai != nil}
}

func (s *Server) getDoc(w http.ResponseWriter, r *http.Request) {
	role, _, allowed := s.requireDoc(w, r, docView)
	if !allowed {
		return
	}
	d, err := scanDoc(s.db, r.PathValue("id"))
	if err != nil {
		s.dbError(w, err)
		return
	}
	_, _ = s.db.Exec("INSERT INTO doc_recents(doc_id,user_id,opened) VALUES(?,?,?) ON CONFLICT(doc_id,user_id) DO UPDATE SET opened=excluded.opened", d.ID, uid(r), now())
	ok(w, s.docView(d, role))
}

func (s *Server) updateDoc(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Title        *string
		LinkRole     *string
		ViewerExport *bool
	}
	if !decode(w, r, &p) {
		return
	}
	need := docEdit
	if p.LinkRole != nil || p.ViewerExport != nil {
		need = docManage
	}
	_, kind, allowed := s.requireDoc(w, r, need)
	if !allowed {
		return
	}
	id := r.PathValue("id")
	if p.Title != nil {
		title, valid := docTitle(kind, *p.Title)
		if !valid {
			fail(w, 400, "标题最多 100 字")
			return
		}
		if _, err := s.db.Exec("UPDATE docs SET title=?,updated=?,updated_by=? WHERE id=?", title, now(), uid(r), id); err != nil {
			s.dbError(w, err)
			return
		}
		s.pushDocViewers(id, "doc-meta", map[string]any{"docId": id, "title": title})
	}
	if p.LinkRole != nil {
		link := map[string]int{"": docNone, "none": docNone, "view": docView, "edit": docEdit}
		role, known := link[*p.LinkRole]
		if !known {
			fail(w, 400, "链接权限无效")
			return
		}
		if _, err := s.db.Exec("UPDATE docs SET link_role=? WHERE id=?", role, id); err != nil {
			s.dbError(w, err)
			return
		}
	}
	if p.ViewerExport != nil {
		if _, err := s.db.Exec("UPDATE docs SET viewer_export=? WHERE id=?", *p.ViewerExport, id); err != nil {
			s.dbError(w, err)
			return
		}
	}
	if p.LinkRole != nil || p.ViewerExport != nil {
		s.pushDocViewers(id, "doc-access", map[string]any{"docId": id})
	}
	ok(w, map[string]bool{"ok": true})
}

func (s *Server) deleteDoc(w http.ResponseWriter, r *http.Request) {
	if _, _, allowed := s.requireDoc(w, r, docOwner); !allowed {
		return
	}
	id := r.PathValue("id")
	viewers := s.docViewerUsers(id)
	if err := deleteDocRows(s.db, "id=?", id); err != nil {
		s.dbError(w, err)
		return
	}
	s.push(viewers, "doc-access", map[string]any{"docId": id, "deleted": true})
	ok(w, map[string]bool{"ok": true})
}

type execer interface {
	Exec(string, ...any) (sql.Result, error)
}

// deleteDocRows removes documents matching where (on docs) with everything
// that belongs to them.
func deleteDocRows(db execer, where string, args ...any) error {
	for _, table := range []string{"doc_members", "doc_groups", "doc_recents", "doc_versions"} {
		if _, err := db.Exec("DELETE FROM "+table+" WHERE doc_id IN (SELECT id FROM docs WHERE "+where+")", args...); err != nil {
			return err
		}
	}
	_, err := db.Exec("DELETE FROM docs WHERE "+where, args...)
	return err
}

// Sharing -------------------------------------------------------------------

func (s *Server) docMembers(w http.ResponseWriter, r *http.Request) {
	role, _, allowed := s.requireDoc(w, r, docView)
	if !allowed {
		return
	}
	id := r.PathValue("id")
	d, err := scanDoc(s.db, id)
	if err != nil {
		s.dbError(w, err)
		return
	}
	type person struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		Avatar string `json:"avatar"`
		Number string `json:"number"`
		Role   string `json:"role"`
	}
	people := []person{}
	var owner person
	_ = s.db.QueryRow("SELECT u.id,u.name,u.avatar,COALESCE((SELECT CAST(number AS TEXT) FROM user_numbers WHERE user_id=u.id),'') FROM users u WHERE u.id=?", d.Owner).Scan(&owner.ID, &owner.Name, &owner.Avatar, &owner.Number)
	owner.Role = "owner"
	people = append(people, owner)
	rows, err := s.db.Query("SELECT u.id,u.name,u.avatar,COALESCE((SELECT CAST(number AS TEXT) FROM user_numbers WHERE user_id=u.id),''),m.role FROM doc_members m JOIN users u ON u.id=m.user_id WHERE m.doc_id=? ORDER BY m.added", id)
	if err != nil {
		s.dbError(w, err)
		return
	}
	for rows.Next() {
		var p person
		var level int
		if rows.Scan(&p.ID, &p.Name, &p.Avatar, &p.Number, &level) == nil {
			p.Role = docRoleNames[level]
			people = append(people, p)
		}
	}
	rows.Close()
	type chat struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Count int    `json:"count"`
		Role  string `json:"role"`
	}
	chats := []chat{}
	rows, err = s.db.Query("SELECT c.id,c.name,(SELECT COUNT(*) FROM members WHERE conversation_id=c.id),g.role FROM doc_groups g JOIN conversations c ON c.id=g.conversation_id WHERE g.doc_id=? ORDER BY g.added", id)
	if err != nil {
		s.dbError(w, err)
		return
	}
	for rows.Next() {
		var c chat
		var level int
		if rows.Scan(&c.ID, &c.Name, &c.Count, &level) == nil {
			c.Role = docRoleNames[level]
			chats = append(chats, c)
		}
	}
	rows.Close()
	ok(w, map[string]any{"people": people, "chats": chats, "linkRole": docRoleNames[d.LinkRole], "viewerExport": d.ViewerExport, "role": docRoleNames[role]})
}

func parseDocRole(name string) (int, bool) {
	switch name {
	case "view":
		return docView, true
	case "edit":
		return docEdit, true
	case "manage":
		return docManage, true
	}
	return 0, false
}

func (s *Server) setDocMember(w http.ResponseWriter, r *http.Request) {
	if _, _, allowed := s.requireDoc(w, r, docManage); !allowed {
		return
	}
	var p struct{ Role string }
	if !decode(w, r, &p) {
		return
	}
	role, valid := parseDocRole(p.Role)
	if !valid {
		fail(w, 400, "权限无效")
		return
	}
	id, target := r.PathValue("id"), r.PathValue("user")
	var owner string
	_ = s.db.QueryRow("SELECT owner FROM docs WHERE id=?", id).Scan(&owner)
	var exists int
	if s.db.QueryRow("SELECT 1 FROM users WHERE id=? AND password<>'!'", target).Scan(&exists) != nil {
		fail(w, 404, "用户不存在")
		return
	}
	if target == owner {
		fail(w, 400, "所有者始终拥有全部权限")
		return
	}
	if _, err := s.db.Exec("INSERT INTO doc_members(doc_id,user_id,role,added) VALUES(?,?,?,?) ON CONFLICT(doc_id,user_id) DO UPDATE SET role=excluded.role", id, target, role, now()); err != nil {
		s.dbError(w, err)
		return
	}
	s.push([]string{target}, "doc-access", map[string]any{"docId": id})
	s.pushDocViewers(id, "doc-access", map[string]any{"docId": id})
	ok(w, map[string]bool{"ok": true})
}

func (s *Server) removeDocMember(w http.ResponseWriter, r *http.Request) {
	id, target := r.PathValue("id"), r.PathValue("user")
	// Anyone may leave a document shared with them.
	if target != uid(r) {
		if _, _, allowed := s.requireDoc(w, r, docManage); !allowed {
			return
		}
	}
	if _, err := s.db.Exec("DELETE FROM doc_members WHERE doc_id=? AND user_id=?", id, target); err != nil {
		s.dbError(w, err)
		return
	}
	if target == uid(r) {
		_, _ = s.db.Exec("DELETE FROM doc_recents WHERE doc_id=? AND user_id=?", id, target)
	}
	s.push([]string{target}, "doc-access", map[string]any{"docId": id})
	s.pushDocViewers(id, "doc-access", map[string]any{"docId": id})
	ok(w, map[string]bool{"ok": true})
}

func (s *Server) setDocChat(w http.ResponseWriter, r *http.Request) {
	if _, _, allowed := s.requireDoc(w, r, docManage); !allowed {
		return
	}
	var p struct{ Role string }
	if !decode(w, r, &p) {
		return
	}
	role, valid := parseDocRole(p.Role)
	if !valid || role == docManage {
		fail(w, 400, "群聊只能设置为可阅读或可编辑")
		return
	}
	cid := r.PathValue("cid")
	if !s.member(cid, uid(r)) {
		fail(w, 403, "只能分享到你所在的聊天")
		return
	}
	if err := grantDocChat(s.db, r.PathValue("id"), cid, role); err != nil {
		s.dbError(w, err)
		return
	}
	s.push(s.audience(cid), "doc-access", map[string]any{"docId": r.PathValue("id")})
	ok(w, map[string]bool{"ok": true})
}

func grantDocChat(db execer, id, cid string, role int) error {
	_, err := db.Exec("INSERT INTO doc_groups(doc_id,conversation_id,role,added) VALUES(?,?,?,?) ON CONFLICT(doc_id,conversation_id) DO UPDATE SET role=excluded.role", id, cid, role, now())
	return err
}

func (s *Server) removeDocChat(w http.ResponseWriter, r *http.Request) {
	if _, _, allowed := s.requireDoc(w, r, docManage); !allowed {
		return
	}
	id, cid := r.PathValue("id"), r.PathValue("cid")
	if _, err := s.db.Exec("DELETE FROM doc_groups WHERE doc_id=? AND conversation_id=?", id, cid); err != nil {
		s.dbError(w, err)
		return
	}
	s.push(s.audience(cid), "doc-access", map[string]any{"docId": id})
	s.pushDocViewers(id, "doc-access", map[string]any{"docId": id})
	ok(w, map[string]bool{"ok": true})
}

// docMessageMarker is how a shared document appears in a text message; the
// app turns it into a card, older clients still show a readable line.
const docMessageMarker = "linkme-doc:"

// sendDoc posts a document card into a chat, optionally granting the chat
// access at the same time (which needs manage rights).
func (s *Server) sendDoc(w http.ResponseWriter, r *http.Request) {
	role, kind, allowed := s.requireDoc(w, r, docView)
	if !allowed {
		return
	}
	var p struct {
		ConversationID, Grant, ClientID string
	}
	if !decode(w, r, &p) {
		return
	}
	cid, id := p.ConversationID, r.PathValue("id")
	if !s.member(cid, uid(r)) {
		fail(w, 403, "只能发送到你所在的聊天")
		return
	}
	if len(p.ClientID) < 8 || len(p.ClientID) > 100 {
		p.ClientID = "doc-" + newID()
	}
	grant := docNone
	if p.Grant != "" && p.Grant != "none" {
		var valid bool
		grant, valid = parseDocRole(p.Grant)
		if !valid || grant == docManage {
			fail(w, 400, "群聊只能设置为可阅读或可编辑")
			return
		}
		if role < docManage {
			fail(w, 403, "只有文档所有者或管理者可以给聊天成员授权")
			return
		}
	}
	var title string
	_ = s.db.QueryRow("SELECT title FROM docs WHERE id=?", id).Scan(&title)
	label := "文档"
	if kind == "sheet" {
		label = "表格"
	}
	text := "[" + label + "] " + title + "\n" + docMessageMarker + id
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	if grant > docNone {
		if err = grantDocChat(tx, id, cid, grant); err != nil {
			s.dbError(w, err)
			return
		}
	}
	if _, err = tx.Exec("INSERT INTO messages(id,conversation_id,sender,kind,text,attachment_id,reply_id,client_id,created) VALUES(?,?,?,'text',?,'','',?,?)", newID(), cid, uid(r), text, p.ClientID, now()); err != nil {
		s.dbError(w, err)
		return
	}
	m, err := scanMessage(tx.QueryRow(messageQuery+"WHERE m.sender=? AND m.client_id=?", uid(r), p.ClientID))
	if err != nil {
		s.dbError(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	s.pushConversation(cid, "message", m)
	if grant > docNone {
		s.push(s.audience(cid), "doc-access", map[string]any{"docId": id})
	}
	ok(w, m)
}

// Live editing ----------------------------------------------------------------

func (s *Server) docViewerUsers(id string) []string {
	s.docs.mu.Lock()
	defer s.docs.mu.Unlock()
	seen := map[string]bool{}
	users := []string{}
	for _, v := range s.docs.viewers[id] {
		if !seen[v.UserID] {
			seen[v.UserID] = true
			users = append(users, v.UserID)
		}
	}
	return users
}

func (s *Server) pushDocViewers(id, kind string, data any) {
	if users := s.docViewerUsers(id); len(users) > 0 {
		s.push(users, kind, data)
	}
}

func (s *Server) presentViewers(id string) []docViewer {
	list := []docViewer{}
	for _, v := range s.docs.viewers[id] {
		list = append(list, *v)
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].seen.Before(list[j].seen) || (list[i].seen.Equal(list[j].seen) && list[i].Client < list[j].Client)
	})
	return list
}

// docPresence is the heartbeat of an open document: it keeps the viewer on
// the list that receives live operations and shows where they are working.
func (s *Server) docPresence(w http.ResponseWriter, r *http.Request) {
	var p struct {
		ClientID, Where string
		Leave           bool
	}
	if !decode(w, r, &p) {
		return
	}
	if len(p.ClientID) < 8 || len(p.ClientID) > 64 || len(p.Where) > 80 {
		fail(w, 400, "请求格式错误")
		return
	}
	id := r.PathValue("id")
	if !p.Leave {
		if _, _, allowed := s.requireDoc(w, r, docView); !allowed {
			return
		}
	}
	var name, avatar string
	_ = s.db.QueryRow("SELECT name,avatar FROM users WHERE id=?", uid(r)).Scan(&name, &avatar)
	h := &s.docs
	h.mu.Lock()
	if h.viewers == nil {
		h.viewers = map[string]map[string]*docViewer{}
	}
	changed := false
	for doc, clients := range h.viewers {
		for client, v := range clients {
			if time.Since(v.seen) > 45*time.Second {
				delete(clients, client)
				if doc == id {
					changed = true
				}
			}
		}
		if len(clients) == 0 {
			delete(h.viewers, doc)
		}
	}
	key := uid(r) + "/" + p.ClientID
	if p.Leave {
		if _, was := h.viewers[id][key]; was {
			delete(h.viewers[id], key)
			changed = true
		}
	} else {
		if h.viewers[id] == nil {
			h.viewers[id] = map[string]*docViewer{}
		}
		v := h.viewers[id][key]
		if v == nil || v.Where != p.Where {
			changed = true
		}
		if v == nil {
			v = &docViewer{UserID: uid(r), Client: p.ClientID, seen: time.Now()}
			h.viewers[id][key] = v
		}
		v.Name, v.Avatar, v.Where = name, avatar, p.Where
		v.seen = time.Now()
	}
	list := s.presentViewers(id)
	h.mu.Unlock()
	if changed {
		s.pushDocViewers(id, "doc-presence", map[string]any{"docId": id, "viewers": list})
	}
	ok(w, map[string]any{"viewers": list})
}

func (s *Server) docOps(w http.ResponseWriter, r *http.Request) {
	role, kind, allowed := s.requireDoc(w, r, docEdit)
	if !allowed {
		return
	}
	_ = role
	var p struct {
		ClientID, Batch string
		Ops             []docOp
	}
	r.Body = http.MaxBytesReader(w, r.Body, docMaxBytes)
	if json.NewDecoder(r.Body).Decode(&p) != nil || len(p.ClientID) < 8 || len(p.ClientID) > 64 || len(p.Batch) < 1 || len(p.Batch) > 64 || len(p.Ops) == 0 || len(p.Ops) > 5000 {
		fail(w, 400, "请求格式错误")
		return
	}
	id := r.PathValue("id")
	key := id + "/" + uid(r) + "/" + p.ClientID + "/" + p.Batch
	h := &s.docs
	h.mu.Lock()
	if h.batches == nil {
		h.batches = map[string]docBatchResult{}
	}
	for k, b := range h.batches {
		if time.Since(b.at) > 10*time.Minute {
			delete(h.batches, k)
		}
	}
	done, repeated := h.batches[key]
	h.mu.Unlock()
	if repeated {
		ok(w, done.resp)
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	d, err := scanDoc(tx, id)
	if err != nil {
		s.dbError(w, err)
		return
	}
	if err = snapshotDoc(tx, d, false); err != nil {
		s.dbError(w, err)
		return
	}
	resp := map[string]any{}
	var content []byte
	if kind == "sheet" {
		var body sheetBody
		if err = json.Unmarshal([]byte(d.Content), &body); err != nil {
			s.dbError(w, err)
			return
		}
		out, applyErr := applySheetOps(&body, p.Ops)
		if applyErr != nil {
			fail(w, 400, applyErr.Error())
			return
		}
		resp["ops"] = out
		content, _ = json.Marshal(body)
	} else {
		var body docBody
		if err = json.Unmarshal([]byte(d.Content), &body); err != nil {
			s.dbError(w, err)
			return
		}
		out, reordered, applyErr := applyDocOps(&body, p.Ops)
		if applyErr != nil {
			fail(w, 400, applyErr.Error())
			return
		}
		resp["ops"] = out
		if reordered {
			resp["order"] = body.order()
		}
		content, _ = json.Marshal(body)
	}
	if len(content) > docMaxBytes {
		fail(w, 413, "文档内容过大，请拆分成多个文档")
		return
	}
	version := d.Version + 1
	if _, err = tx.Exec("UPDATE docs SET content=?,version=?,updated=?,updated_by=? WHERE id=?", string(content), version, now(), uid(r), id); err != nil {
		s.dbError(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	resp["version"] = version
	resp["docId"] = id
	resp["clientId"] = p.ClientID
	resp["userId"] = uid(r)
	h.mu.Lock()
	h.batches[key] = docBatchResult{at: time.Now(), resp: resp}
	h.mu.Unlock()
	s.pushDocViewers(id, "doc-ops", resp)
	ok(w, resp)
}

// snapshotDoc keeps the state before a stretch of editing as a version, at
// most every few minutes, or always when force is set (before a restore).
func snapshotDoc(tx *sql.Tx, d docRecord, force bool) error {
	if !force {
		var last int64
		_ = tx.QueryRow("SELECT COALESCE(MAX(created),0) FROM doc_versions WHERE doc_id=?", d.ID).Scan(&last)
		if now()-last < docVersionEvery.Milliseconds() {
			return nil
		}
	}
	if _, err := tx.Exec("INSERT INTO doc_versions(doc_id,version,title,content,author,created) VALUES(?,?,?,?,?,?)", d.ID, d.Version, d.Title, d.Content, d.UpdatedBy, now()); err != nil {
		return err
	}
	_, err := tx.Exec("DELETE FROM doc_versions WHERE doc_id=? AND id NOT IN (SELECT id FROM doc_versions WHERE doc_id=? ORDER BY id DESC LIMIT ?)", d.ID, d.ID, docVersionsKept)
	return err
}

// History -------------------------------------------------------------------

func (s *Server) docVersions(w http.ResponseWriter, r *http.Request) {
	if _, _, allowed := s.requireDoc(w, r, docView); !allowed {
		return
	}
	rows, err := s.db.Query("SELECT v.id,v.version,v.title,COALESCE(u.name,''),v.created FROM doc_versions v LEFT JOIN users u ON u.id=v.author WHERE v.doc_id=? ORDER BY v.id DESC LIMIT 200", r.PathValue("id"))
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer rows.Close()
	type version struct {
		ID      int64  `json:"id"`
		Version int64  `json:"version"`
		Title   string `json:"title"`
		Author  string `json:"authorName"`
		Created int64  `json:"created"`
	}
	out := []version{}
	for rows.Next() {
		var v version
		if rows.Scan(&v.ID, &v.Version, &v.Title, &v.Author, &v.Created) == nil {
			out = append(out, v)
		}
	}
	ok(w, out)
}

func (s *Server) docVersion(w http.ResponseWriter, r *http.Request) {
	if _, _, allowed := s.requireDoc(w, r, docView); !allowed {
		return
	}
	var title, content string
	var created int64
	if s.db.QueryRow("SELECT title,content,created FROM doc_versions WHERE id=? AND doc_id=?", r.PathValue("version"), r.PathValue("id")).Scan(&title, &content, &created) != nil {
		fail(w, 404, "历史版本不存在")
		return
	}
	ok(w, map[string]any{"title": title, "content": json.RawMessage(content), "created": created})
}

func (s *Server) restoreDocVersion(w http.ResponseWriter, r *http.Request) {
	if _, _, allowed := s.requireDoc(w, r, docEdit); !allowed {
		return
	}
	id := r.PathValue("id")
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	var title, content string
	if tx.QueryRow("SELECT title,content FROM doc_versions WHERE id=? AND doc_id=?", r.PathValue("version"), id).Scan(&title, &content) != nil {
		fail(w, 404, "历史版本不存在")
		return
	}
	d, err := scanDoc(tx, id)
	if err == nil {
		err = snapshotDoc(tx, d, true)
	}
	if err == nil {
		_, err = tx.Exec("UPDATE docs SET title=?,content=?,version=version+1,updated=?,updated_by=? WHERE id=?", title, content, now(), uid(r), id)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.pushDocViewers(id, "doc-reload", map[string]any{"docId": id})
	ok(w, map[string]bool{"ok": true})
}

// Import and export ---------------------------------------------------------

func (s *Server) importDoc(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 21<<20)
	file, header, err := r.FormFile("file")
	if err != nil {
		fail(w, 400, "请选择 20 MB 以内的文件")
		return
	}
	defer file.Close()
	raw, err := io.ReadAll(file)
	if err != nil {
		fail(w, 400, "请选择 20 MB 以内的文件")
		return
	}
	kind, title, body, err := docFromFile(header.Filename, raw)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	content, _ := json.Marshal(body)
	if len(content) > docMaxBytes {
		fail(w, 413, "文件内容过多，请拆分后导入")
		return
	}
	id, err := s.createDocRecord(uid(r), kind, title, string(content))
	if err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, map[string]string{"id": id, "kind": kind})
}

// docFromFile turns an uploaded Markdown, Word, Excel or CSV file into a
// document body, named after the file.
func docFromFile(filename string, raw []byte) (kind, title string, body any, err error) {
	ext := strings.ToLower(filepath.Ext(filename))
	title, _ = docTitle("doc", strings.TrimSuffix(filepath.Base(filename), filepath.Ext(filename)))
	if r := []rune(title); len(r) > 100 {
		title = string(r[:100])
	}
	switch ext {
	case ".md", ".markdown", ".txt":
		return "doc", title, markdownToDoc(string(raw)), nil
	case ".docx":
		body, err = docxToDoc(raw)
		kind = "doc"
	case ".xlsx":
		body, err = xlsxToSheet(raw)
		kind = "sheet"
	case ".csv":
		body, err = csvToSheet(raw)
		kind = "sheet"
	default:
		return "", "", nil, errors.New("支持导入 .md .txt .docx .xlsx .csv 文件")
	}
	if err != nil {
		err = errors.New("无法读取该文件：" + err.Error())
	}
	return
}

// importAttachment opens a file sent in a chat as a cloud document.
func (s *Server) importAttachment(w http.ResponseWriter, r *http.Request) {
	var p struct{ AttachmentID string }
	if !decode(w, r, &p) {
		return
	}
	var cid, name, blob string
	var size int64
	if s.db.QueryRow("SELECT a.conversation_id,a.name,a.size,COALESCE(b.blob_id,a.id) FROM attachments a LEFT JOIN attachment_blobs b ON b.attachment_id=a.id WHERE a.id=?", p.AttachmentID).Scan(&cid, &name, &size, &blob) != nil || !s.member(cid, uid(r)) {
		fail(w, 404, "文件不存在")
		return
	}
	if size > 20<<20 {
		fail(w, 400, "文件超过 20 MB，无法转为在线文档")
		return
	}
	f, err := s.openStored("uploads", "", blob)
	if err != nil {
		fail(w, 503, "文件所在磁盘暂不可用")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(f, 21<<20))
	f.Close()
	if err != nil {
		s.dbError(w, err)
		return
	}
	kind, title, body, err := docFromFile(name, raw)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	content, _ := json.Marshal(body)
	if len(content) > docMaxBytes {
		fail(w, 413, "文件内容过多")
		return
	}
	id, err := s.createDocRecord(uid(r), kind, title, string(content))
	if err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, map[string]string{"id": id, "kind": kind})
}

func (s *Server) exportDoc(w http.ResponseWriter, r *http.Request) {
	role, kind, allowed := s.requireDoc(w, r, docView)
	if !allowed {
		return
	}
	d, err := scanDoc(s.db, r.PathValue("id"))
	if err != nil {
		s.dbError(w, err)
		return
	}
	if role < docEdit && !d.ViewerExport {
		fail(w, 403, "所有者已禁止阅读者导出")
		return
	}
	format := r.URL.Query().Get("format")
	var data []byte
	var mime, ext string
	if kind == "sheet" {
		var body sheetBody
		if err = json.Unmarshal([]byte(d.Content), &body); err != nil {
			s.dbError(w, err)
			return
		}
		switch format {
		case "csv":
			page := body.find(r.URL.Query().Get("sheet"))
			if page < 0 {
				page = 0
			}
			data, mime, ext = sheetToCSV(body.Sheets[page]), "text/csv; charset=utf-8", ".csv"
		case "", "xlsx":
			data, err = sheetToXLSX(body)
			mime, ext = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"
		default:
			fail(w, 400, "表格可导出为 xlsx 或 csv")
			return
		}
	} else {
		var body docBody
		if err = json.Unmarshal([]byte(d.Content), &body); err != nil {
			s.dbError(w, err)
			return
		}
		switch format {
		case "md":
			data, mime, ext = []byte(docToMarkdown(d.Title, body)), "text/markdown; charset=utf-8", ".md"
		case "", "docx":
			data, err = docToDocx(d.Title, body)
			mime, ext = "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"
		default:
			fail(w, 400, "文档可导出为 docx 或 md")
			return
		}
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	name := strings.NewReplacer("/", "_", "\\", "_", "\"", "_", ":", "_").Replace(d.Title) + ext
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Disposition", "attachment; filename=\"document"+ext+"\"; filename*=UTF-8''"+url.PathEscape(name))
	_, _ = w.Write(data)
}
