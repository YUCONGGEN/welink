package server

import (
	"database/sql"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

func (s *Server) conversations(w http.ResponseWriter, r *http.Request) {
	rows, e := s.db.Query(`SELECT c.id,c.kind,c.name,c.owner,c.announcement,c.created,x.pinned,x.muted,(SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.seq>x.read_seq AND m.sender<>x.user_id AND m.recalled=0 AND NOT EXISTS(SELECT 1 FROM message_deletions md WHERE md.message_id=m.id AND md.user_id=x.user_id)),COALESCE((SELECT MAX(m.created) FROM messages m WHERE m.conversation_id=c.id AND NOT EXISTS(SELECT 1 FROM message_deletions md WHERE md.message_id=m.id AND md.user_id=x.user_id)),c.created) FROM conversations c JOIN members x ON x.conversation_id=c.id WHERE x.user_id=? ORDER BY x.pinned DESC,10 DESC`, uid(r))
	if e != nil {
		s.dbError(w, e)
		return
	}
	out := []map[string]any{}
	for rows.Next() {
		var id, kind, name, owner, notice string
		var created, updated int64
		var pin, mute bool
		var unread int
		_ = rows.Scan(&id, &kind, &name, &owner, &notice, &created, &pin, &mute, &unread, &updated)
		out = append(out, map[string]any{"id": id, "kind": kind, "name": name, "owner": owner, "announcement": notice, "created": created, "updated": updated, "pinned": pin, "muted": mute, "unread": unread})
	}
	rows.Close()
	for _, c := range out {
		cid := c["id"].(string)
		if c["kind"] == "direct" {
			var peer string
			_ = s.db.QueryRow("SELECT user_id FROM members WHERE conversation_id=? AND user_id<>?", cid, uid(r)).Scan(&peer)
			u, _ := s.user(peer)
			c["peer"] = u
			c["name"] = u.Name
			c["avatar"] = u.Avatar
		}
		last, e := scanMessage(s.db.QueryRow(messageQuery+"WHERE m.conversation_id=? AND "+messageVisible+"ORDER BY m.seq DESC LIMIT 1", cid, uid(r)))
		if e == nil {
			c["last"] = last
		}
	}
	ok(w, out)
}
func (s *Server) createConversation(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Kind, Name string
		Members    []string
	}
	if !decode(w, r, &p) {
		return
	}
	if p.Kind != "direct" && p.Kind != "group" {
		fail(w, 400, "会话类型错误")
		return
	}
	set := map[string]bool{uid(r): true}
	for _, id := range p.Members {
		set[id] = true
	}
	if len(set) < 2 || len(set) > 200 || (p.Kind == "direct" && len(set) != 2) || (p.Kind == "group" && (strings.TrimSpace(p.Name) == "" || !validText(p.Name, 60))) {
		fail(w, 400, "请选择成员并填写有效的群名称")
		return
	}
	ids := []string{}
	for id := range set {
		ids = append(ids, id)
		if id != uid(r) {
			var n int
			if s.db.QueryRow("SELECT 1 FROM friends WHERE user_id=? AND peer_id=?", uid(r), id).Scan(&n) != nil {
				fail(w, 403, "只能与已添加的好友创建会话")
				return
			}
		}
	}
	sort.Strings(ids)
	var direct any
	if p.Kind == "direct" {
		direct = strings.Join(ids, ":")
		var old string
		if s.db.QueryRow("SELECT id FROM conversations WHERE direct_key=?", direct).Scan(&old) == nil {
			ok(w, map[string]string{"id": old})
			return
		}
	}
	tx, e := s.db.Begin()
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer tx.Rollback()
	id := newID()
	if _, e = tx.Exec("INSERT INTO conversations(id,kind,name,owner,direct_key,created) VALUES(?,?,?,?,?,?)", id, p.Kind, strings.TrimSpace(p.Name), uid(r), direct, now()); e != nil {
		s.dbError(w, e)
		return
	}
	for _, user := range ids {
		if _, e = tx.Exec("INSERT INTO members(conversation_id,user_id) VALUES(?,?)", id, user); e != nil {
			s.dbError(w, e)
			return
		}
	}
	if e = tx.Commit(); e != nil {
		s.dbError(w, e)
		return
	}
	s.push(ids, "conversation", map[string]string{"id": id})
	ok(w, map[string]string{"id": id})
}
func (s *Server) conversationDetail(w http.ResponseWriter, r *http.Request) {
	if !s.requireMember(w, r) {
		return
	}
	id := r.PathValue("id")
	var kind, name, owner, notice string
	_ = s.db.QueryRow("SELECT kind,name,owner,announcement FROM conversations WHERE id=?", id).Scan(&kind, &name, &owner, &notice)
	rows, e := s.db.Query("SELECT u.id,u.account,u.name,u.avatar,u.bio,n.number FROM users u JOIN members m ON u.id=m.user_id JOIN user_numbers n ON n.user_id=u.id WHERE m.conversation_id=? ORDER BY u.name", id)
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer rows.Close()
	members := []User{}
	for rows.Next() {
		var u User
		_ = rows.Scan(&u.ID, &u.Account, &u.Name, &u.Avatar, &u.Bio, &u.Number)
		u.Online = s.online(u.ID)
		members = append(members, u)
	}
	ok(w, map[string]any{"id": id, "kind": kind, "name": name, "owner": owner, "announcement": notice, "members": members})
}
func (s *Server) updateConversation(w http.ResponseWriter, r *http.Request) {
	if !s.requireMember(w, r) {
		return
	}
	var p struct {
		Name, Announcement *string
		Pinned, Muted      *bool
	}
	if !decode(w, r, &p) {
		return
	}
	id := r.PathValue("id")
	if p.Name != nil || p.Announcement != nil {
		var owner, kind string
		_ = s.db.QueryRow("SELECT owner,kind FROM conversations WHERE id=?", id).Scan(&owner, &kind)
		if owner != uid(r) || kind != "group" {
			fail(w, 403, "只有群主可以修改群资料")
			return
		}
		if p.Name != nil {
			if strings.TrimSpace(*p.Name) == "" || !validText(*p.Name, 60) {
				fail(w, 400, "群名称格式错误")
				return
			}
			if _, e := s.db.Exec("UPDATE conversations SET name=? WHERE id=?", strings.TrimSpace(*p.Name), id); e != nil {
				s.dbError(w, e)
				return
			}
		}
		if p.Announcement != nil {
			if !validText(*p.Announcement, 2000) {
				fail(w, 400, "公告最多 2000 字")
				return
			}
			if _, e := s.db.Exec("UPDATE conversations SET announcement=? WHERE id=?", *p.Announcement, id); e != nil {
				s.dbError(w, e)
				return
			}
		}
	}
	if p.Pinned != nil {
		_, _ = s.db.Exec("UPDATE members SET pinned=? WHERE conversation_id=? AND user_id=?", *p.Pinned, id, uid(r))
	}
	if p.Muted != nil {
		_, _ = s.db.Exec("UPDATE members SET muted=? WHERE conversation_id=? AND user_id=?", *p.Muted, id, uid(r))
	}
	s.pushConversation(id, "conversation", map[string]string{"id": id})
	ok(w, map[string]bool{"ok": true})
}
func (s *Server) addMembers(w http.ResponseWriter, r *http.Request) {
	if !s.requireMember(w, r) {
		return
	}
	var kind string
	_ = s.db.QueryRow("SELECT kind FROM conversations WHERE id=?", r.PathValue("id")).Scan(&kind)
	if kind != "group" {
		fail(w, 400, "单聊不能添加成员")
		return
	}
	var p struct{ Members []string }
	if !decode(w, r, &p) {
		return
	}
	if len(p.Members) == 0 || len(p.Members) > 100 {
		fail(w, 400, "请选择 1–100 个好友")
		return
	}
	for _, id := range p.Members {
		var n int
		if s.db.QueryRow("SELECT 1 FROM friends WHERE user_id=? AND peer_id=?", uid(r), id).Scan(&n) != nil {
			fail(w, 403, "只能邀请自己的好友")
			return
		}
	}
	tx, e := s.db.Begin()
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer tx.Rollback()
	for _, id := range p.Members {
		if _, e = tx.Exec("INSERT OR IGNORE INTO members(conversation_id,user_id) VALUES(?,?)", r.PathValue("id"), id); e != nil {
			s.dbError(w, e)
			return
		}
	}
	if e = tx.Commit(); e != nil {
		s.dbError(w, e)
		return
	}
	s.pushConversation(r.PathValue("id"), "conversation", map[string]string{"id": r.PathValue("id")})
	ok(w, map[string]bool{"ok": true})
}
func (s *Server) removeMember(w http.ResponseWriter, r *http.Request) {
	if !s.requireMember(w, r) {
		return
	}
	var owner, kind string
	_ = s.db.QueryRow("SELECT owner,kind FROM conversations WHERE id=?", r.PathValue("id")).Scan(&owner, &kind)
	target := r.PathValue("user")
	if kind != "group" || target == owner || (uid(r) != owner && uid(r) != target) {
		fail(w, 403, "无法移除该成员，群主不能直接退群")
		return
	}
	audience := s.audience(r.PathValue("id"))
	if _, e := s.db.Exec("DELETE FROM members WHERE conversation_id=? AND user_id=?", r.PathValue("id"), target); e != nil {
		s.dbError(w, e)
		return
	}
	s.push(audience, "conversation", map[string]string{"id": r.PathValue("id")})
	ok(w, map[string]bool{"ok": true})
}
func (s *Server) messages(w http.ResponseWriter, r *http.Request) {
	if !s.requireMember(w, r) {
		return
	}
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	if before <= 0 {
		before = 1 << 62
	}
	query := messageQuery + "WHERE m.conversation_id=? AND m.seq<? AND " + messageVisible
	args := []any{r.PathValue("id"), before, uid(r)}
	if around := r.URL.Query().Get("around"); around != "" {
		var seq int64
		if s.db.QueryRow("SELECT m.seq FROM messages m WHERE m.id=? AND m.conversation_id=? AND "+messageVisible, around, r.PathValue("id"), uid(r)).Scan(&seq) != nil {
			fail(w, 404, "消息已删除或不可访问")
			return
		}
		// Select by visible rows, so hidden messages do not leave gaps in the context window.
		query += `AND m.seq IN (SELECT seq FROM (SELECT m.seq FROM messages m WHERE m.conversation_id=? AND m.seq<=? AND ` + messageVisible + `ORDER BY m.seq DESC LIMIT 31) UNION ALL SELECT seq FROM (SELECT m.seq FROM messages m WHERE m.conversation_id=? AND m.seq>? AND ` + messageVisible + `ORDER BY m.seq ASC LIMIT 30)) `
		args = append(args, r.PathValue("id"), seq, uid(r), r.PathValue("id"), seq, uid(r))
	}
	if after > 0 {
		query += "AND m.seq>? "
		args = append(args, after)
	}
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		if !validText(q, 200) {
			fail(w, 400, "搜索内容最多 200 字")
			return
		}
		query += "AND m.recalled=0 AND (m.text LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\') "
		args = append(args, "%"+escapeLike(q)+"%", "%"+escapeLike(q)+"%")
	}
	if kind := r.URL.Query().Get("kind"); kind != "" {
		if kind != "text" && kind != "image" && kind != "file" && kind != "meeting" && kind != "forward" && kind != "voice" && kind != "video" {
			fail(w, 400, "消息类型错误")
			return
		}
		query += "AND m.kind=? AND m.recalled=0 "
		args = append(args, kind)
	}
	if sender := r.URL.Query().Get("sender"); sender != "" {
		query += "AND m.sender=? "
		args = append(args, sender)
	}
	for _, field := range []string{"from", "to"} {
		if value := r.URL.Query().Get(field); value != "" {
			date, err := strconv.ParseInt(value, 10, 64)
			if err != nil || date < 0 {
				fail(w, 400, "搜索日期错误")
				return
			}
			if field == "from" {
				query += "AND m.created>=? "
			} else {
				query += "AND m.created<? "
			}
			args = append(args, date)
		}
	}
	order := "DESC"
	if after > 0 {
		order = "ASC"
	}
	limit := "60"
	if r.URL.Query().Get("around") != "" {
		limit = "61"
	}
	rows, e := s.db.Query(query+"ORDER BY m.seq "+order+" LIMIT "+limit, args...)
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []Message{}
	for rows.Next() {
		m, e := scanMessage(rows)
		if e != nil {
			s.dbError(w, e)
			return
		}
		out = append(out, m)
	}
	if e = rows.Err(); e != nil {
		s.dbError(w, e)
		return
	}
	if after <= 0 {
		for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
			out[i], out[j] = out[j], out[i]
		}
	}
	ok(w, out)
}
func (s *Server) sendMessage(w http.ResponseWriter, r *http.Request) {
	if !s.requireMember(w, r) {
		return
	}
	if !s.rate(r, "message:"+uid(r), 180, time.Minute) {
		fail(w, 429, "发送太快，请稍后再试")
		return
	}
	var p struct{ Kind, Text, AttachmentID, ReplyID, ClientID string }
	if !decode(w, r, &p) {
		return
	}
	if p.Kind == "" {
		p.Kind = "text"
	}
	if !validText(p.Text, 6000) || len(p.ClientID) < 8 || len(p.ClientID) > 100 || (p.Kind != "text" && p.Kind != "image" && p.Kind != "file" && p.Kind != "voice" && p.Kind != "video") || (p.Kind == "text" && strings.TrimSpace(p.Text) == "") {
		fail(w, 400, "消息内容无效或超过 6000 字")
		return
	}
	cid := r.PathValue("id")
	if p.Kind != "text" {
		var mime string
		if s.db.QueryRow("SELECT mime FROM attachments WHERE id=? AND owner=? AND conversation_id=?", p.AttachmentID, uid(r), cid).Scan(&mime) != nil {
			fail(w, 400, "附件不存在")
			return
		}
		if p.Kind == "image" && !strings.HasPrefix(mime, "image/") {
			fail(w, 400, "该附件不是图片")
			return
		}
		if p.Kind == "voice" || p.Kind == "video" {
			var kind string
			if s.db.QueryRow("SELECT kind FROM attachment_media WHERE attachment_id=?", p.AttachmentID).Scan(&kind) != nil || kind != p.Kind {
				fail(w, 400, "请上传有效的语音或视频后发送")
				return
			}
			p.Text = ""
		}
	} else {
		p.AttachmentID = ""
	}
	if p.ReplyID != "" {
		var n int
		if s.db.QueryRow("SELECT 1 FROM messages m WHERE m.id=? AND m.conversation_id=? AND m.recalled=0 AND "+messageVisible, p.ReplyID, cid, uid(r)).Scan(&n) != nil {
			fail(w, 400, "引用消息不存在")
			return
		}
	}
	id := newID()
	_, e := s.db.Exec("INSERT INTO messages(id,conversation_id,sender,kind,text,attachment_id,reply_id,client_id,created) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(sender,client_id) DO NOTHING", id, cid, uid(r), p.Kind, p.Text, p.AttachmentID, p.ReplyID, p.ClientID, now())
	if e != nil {
		s.dbError(w, e)
		return
	}
	m, e := scanMessage(s.db.QueryRow(messageQuery+"WHERE m.sender=? AND m.client_id=?", uid(r), p.ClientID))
	if e != nil {
		s.dbError(w, e)
		return
	}
	if m.ConversationID != cid {
		fail(w, 409, "消息标识重复，请重试")
		return
	}
	if m.ID == id {
		s.pushConversation(cid, "message", m)
	}
	ok(w, m)
}
func (s *Server) readConversation(w http.ResponseWriter, r *http.Request) {
	if !s.requireMember(w, r) {
		return
	}
	var p struct{ Seq int64 }
	if !decode(w, r, &p) {
		return
	}
	var maxSeq sql.NullInt64
	_ = s.db.QueryRow("SELECT MAX(seq) FROM messages WHERE conversation_id=?", r.PathValue("id")).Scan(&maxSeq)
	p.Seq = min(max(0, p.Seq), maxSeq.Int64)
	_, e := s.db.Exec("UPDATE members SET read_seq=MAX(read_seq,?) WHERE conversation_id=? AND user_id=?", p.Seq, r.PathValue("id"), uid(r))
	if e != nil {
		s.dbError(w, e)
		return
	}
	s.pushConversation(r.PathValue("id"), "read", map[string]any{"conversationId": r.PathValue("id"), "userId": uid(r), "seq": p.Seq})
	ok(w, map[string]bool{"ok": true})
}
func (s *Server) recall(w http.ResponseWriter, r *http.Request) {
	m, e := scanMessage(s.db.QueryRow(messageQuery+"WHERE m.id=?", r.PathValue("id")))
	if e != nil || m.Sender != uid(r) || !s.member(m.ConversationID, uid(r)) {
		fail(w, 403, "无法撤回该消息")
		return
	}
	if now()-m.Created > 120000 {
		fail(w, 400, "只能撤回两分钟内的消息")
		return
	}
	if _, e = s.db.Exec("UPDATE messages SET recalled=1,text='',attachment_id='' WHERE id=?", m.ID); e != nil {
		s.dbError(w, e)
		return
	}
	m.Recalled = true
	m.Text = ""
	m.AttachmentID = ""
	m.FileName = ""
	m.FileSize = 0
	m.MIME = ""
	m.DurationMS = 0
	m.Width = 0
	m.Height = 0
	m.Reply = nil
	s.pushConversation(m.ConversationID, "recall", m)
	ok(w, m)
}

// Deleting a message only hides this record for the authenticated account.
// Other participants and separately saved favorites retain their copies.
func (s *Server) deleteMessage(w http.ResponseWriter, r *http.Request) {
	var cid string
	if s.db.QueryRow("SELECT conversation_id FROM messages WHERE id=?", r.PathValue("id")).Scan(&cid) != nil || !s.member(cid, uid(r)) {
		fail(w, 404, "消息不存在或不可访问")
		return
	}
	if _, err := s.db.Exec("INSERT OR IGNORE INTO message_deletions VALUES(?,?,?)", uid(r), r.PathValue("id"), now()); err != nil {
		s.dbError(w, err)
		return
	}
	data := map[string]string{"id": r.PathValue("id"), "conversationId": cid}
	s.push([]string{uid(r)}, "message-deleted", data)
	ok(w, data)
}
func (s *Server) favorites(w http.ResponseWriter, r *http.Request) {
	rows, e := s.db.Query(messageQuery+"JOIN favorites f ON f.message_id=m.id JOIN members x ON x.conversation_id=m.conversation_id AND x.user_id=f.user_id WHERE f.user_id=? AND m.recalled=0 ORDER BY f.created DESC LIMIT 200", uid(r))
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []Message{}
	for rows.Next() {
		m, e := scanMessage(rows)
		if e != nil {
			s.dbError(w, e)
			return
		}
		out = append(out, m)
	}
	ok(w, out)
}
func (s *Server) favorite(w http.ResponseWriter, r *http.Request) {
	var cid string
	if s.db.QueryRow("SELECT conversation_id FROM messages WHERE id=? AND recalled=0", r.PathValue("id")).Scan(&cid) != nil || !s.member(cid, uid(r)) {
		fail(w, 403, "无法收藏该消息")
		return
	}
	if _, e := s.db.Exec("INSERT OR IGNORE INTO favorites VALUES(?,?,?)", uid(r), r.PathValue("id"), now()); e != nil {
		s.dbError(w, e)
		return
	}
	ok(w, map[string]bool{"ok": true})
}
func (s *Server) unfavorite(w http.ResponseWriter, r *http.Request) {
	_, e := s.db.Exec("DELETE FROM favorites WHERE user_id=? AND message_id=?", uid(r), r.PathValue("id"))
	if e != nil {
		s.dbError(w, e)
		return
	}
	ok(w, map[string]bool{"ok": true})
}
