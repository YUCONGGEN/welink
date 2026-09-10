package server

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
)

const groupSchema = `
CREATE TABLE IF NOT EXISTS group_profiles(number INTEGER PRIMARY KEY AUTOINCREMENT,conversation_id TEXT UNIQUE NOT NULL REFERENCES conversations(id),description TEXT NOT NULL DEFAULT '',discoverable INTEGER NOT NULL DEFAULT 0,join_mode TEXT NOT NULL DEFAULT 'approval',members_invite INTEGER NOT NULL DEFAULT 1,all_muted INTEGER NOT NULL DEFAULT 0,dissolved INTEGER NOT NULL DEFAULT 0);
INSERT INTO sqlite_sequence(name,seq) SELECT 'group_profiles',200000000 WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='group_profiles');
INSERT INTO group_profiles(conversation_id) SELECT id FROM conversations WHERE kind='group' AND id NOT IN(SELECT conversation_id FROM group_profiles) ORDER BY created,id;
CREATE TABLE IF NOT EXISTS group_members(conversation_id TEXT NOT NULL,user_id TEXT NOT NULL,admin INTEGER NOT NULL DEFAULT 0,nickname TEXT NOT NULL DEFAULT '',mute_until INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(conversation_id,user_id),FOREIGN KEY(conversation_id,user_id) REFERENCES members(conversation_id,user_id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS group_requests(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),user_id TEXT NOT NULL REFERENCES users(id),inviter TEXT NOT NULL DEFAULT '',message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created INTEGER NOT NULL,resolved INTEGER NOT NULL DEFAULT 0,resolver TEXT NOT NULL DEFAULT '');
CREATE UNIQUE INDEX IF NOT EXISTS group_request_pending ON group_requests(conversation_id,user_id) WHERE status='pending';
CREATE TRIGGER IF NOT EXISTS group_message_permission BEFORE INSERT ON messages WHEN EXISTS(SELECT 1 FROM group_profiles g WHERE g.conversation_id=NEW.conversation_id) BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members WHERE conversation_id=NEW.conversation_id AND user_id=NEW.sender) OR EXISTS(SELECT 1 FROM group_profiles g JOIN conversations c ON c.id=g.conversation_id LEFT JOIN group_members m ON m.conversation_id=g.conversation_id AND m.user_id=NEW.sender WHERE g.conversation_id=NEW.conversation_id AND (g.dissolved<>0 OR (c.owner<>NEW.sender AND COALESCE(m.admin,0)=0 AND (g.all_muted=1 OR COALESCE(m.mute_until,0)>CAST(unixepoch('subsec')*1000 AS INTEGER))))) THEN RAISE(ABORT,'group_send_forbidden') END;
END;
`

type groupInfo struct {
	Avatar        string `json:"avatar"`
	Number        string `json:"number"`
	Description   string `json:"description"`
	Discoverable  bool   `json:"discoverable"`
	JoinMode      string `json:"joinMode"`
	MembersInvite bool   `json:"membersInvite"`
	AllMuted      bool   `json:"allMuted"`
	Count         int    `json:"count"`
	Role          string `json:"role"`
	MuteUntil     int64  `json:"muteUntil"`
	Owner         string `json:"-"`
}
type rowQuery interface{ QueryRow(string, ...any) *sql.Row }

func readGroup(q rowQuery, cid, user string) (g groupInfo, err error) {
	err = q.QueryRow(`SELECT g.number,g.description,g.discoverable,g.join_mode,g.members_invite,g.all_muted,c.owner,(SELECT COUNT(*) FROM members WHERE conversation_id=c.id),CASE WHEN x.user_id IS NULL THEN '' WHEN c.owner=? THEN 'owner' WHEN COALESCE(m.admin,0)=1 THEN 'admin' ELSE 'member' END,COALESCE(m.mute_until,0),COALESCE((SELECT 'image:'||id FROM avatar_images WHERE scope='group:'||c.id),'group') FROM group_profiles g JOIN conversations c ON c.id=g.conversation_id LEFT JOIN members x ON x.conversation_id=c.id AND x.user_id=? LEFT JOIN group_members m ON m.conversation_id=c.id AND m.user_id=? WHERE c.id=? AND g.dissolved=0`, user, user, user, cid).Scan(&g.Number, &g.Description, &g.Discoverable, &g.JoinMode, &g.MembersInvite, &g.AllMuted, &g.Owner, &g.Count, &g.Role, &g.MuteUntil, &g.Avatar)
	return
}
func (g groupInfo) manager() bool { return g.Role == "owner" || g.Role == "admin" }
func (s *Server) canSpeak(cid, user string) bool {
	if !s.member(cid, user) {
		return false
	}
	g, err := readGroup(s.db, cid, user)
	if err == sql.ErrNoRows {
		var peer string
		return s.db.QueryRow("SELECT m.user_id FROM members m JOIN conversations c ON c.id=m.conversation_id WHERE c.id=? AND c.kind='direct' AND m.user_id<>?", cid, user).Scan(&peer) == nil && contactAllowed(s.db, user, peer)
	}
	return err == nil && (g.manager() || (!g.AllMuted && g.MuteUntil <= now()))
}

type groupError struct {
	status int
	text   string
}

func (e *groupError) Error() string           { return e.text }
func groupFail(status int, text string) error { return &groupError{status, text} }
func groupRequired(tx *sql.Tx, cid, user string) (groupInfo, error) {
	g, e := readGroup(tx, cid, user)
	if e == sql.ErrNoRows || e == nil && g.Role == "" {
		return g, groupFail(403, "你已不在该群或群已解散")
	}
	return g, e
}

// Every membership, role, capacity and configuration decision shares its write transaction.
func (s *Server) groupChange(w http.ResponseWriter, r *http.Request, fn func(*sql.Tx) (any, []string, error)) {
	tx, e := s.db.Begin()
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer tx.Rollback()
	result, recipients, e := fn(tx)
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		var known *groupError
		if errors.As(e, &known) {
			fail(w, known.status, known.text)
		} else {
			s.dbError(w, e)
		}
		return
	}
	s.reconcileGroupMeetings(r.PathValue("id"))
	s.push(recipients, "group-updated", map[string]string{"id": r.PathValue("id")})
	ok(w, result)
}

func (s *Server) reconcileGroupMeetings(cid string) {
	if cid == "" {
		return
	}
	var dissolved int
	if s.db.QueryRow("SELECT dissolved FROM group_profiles WHERE conversation_id=?", cid).Scan(&dissolved) != nil {
		return
	}
	s.meetings.Lock()
	defer s.meetings.Unlock()
	for code, room := range s.meetings.rooms {
		if room.ConversationID != cid {
			continue
		}
		if dissolved != 0 {
			s.finishMeetingLocked(code, "群已解散")
			continue
		}
		for id, p := range room.Peers {
			if !s.member(cid, id) {
				p.socket.close()
			}
		}
	}
}
func groupAudience(tx *sql.Tx, cid string) ([]string, error) {
	rows, e := tx.Query("SELECT user_id FROM members WHERE conversation_id=?", cid)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			return nil, e
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
func addGroupMember(tx *sql.Tx, cid, user string) error {
	var count, exists int
	if e := tx.QueryRow("SELECT COUNT(*),COALESCE(SUM(user_id=?),0) FROM members WHERE conversation_id=?", user, cid).Scan(&count, &exists); e != nil {
		return e
	}
	if exists > 0 {
		return nil
	}
	if count >= 200 {
		return groupFail(409, "群成员已满（200 人）")
	}
	if _, e := tx.Exec("INSERT INTO members(conversation_id,user_id,read_seq) VALUES(?,?,COALESCE((SELECT MAX(seq) FROM messages WHERE conversation_id=?),0))", cid, user, cid); e != nil {
		return e
	}
	_, e := tx.Exec("UPDATE group_requests SET status='accepted',resolved=? WHERE conversation_id=? AND user_id=? AND status='pending'", now(), cid, user)
	return e
}

func (s *Server) searchGroups(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		ok(w, []any{})
		return
	}
	if !validText(q, 60) {
		fail(w, 400, "搜索内容最多 60 字")
		return
	}
	rows, e := s.db.Query(`SELECT c.id,c.name,g.number,g.description,g.join_mode,(SELECT COUNT(*) FROM members WHERE conversation_id=c.id),EXISTS(SELECT 1 FROM members WHERE conversation_id=c.id AND user_id=?),COALESCE((SELECT 'image:'||id FROM avatar_images WHERE scope='group:'||c.id),'group') FROM group_profiles g JOIN conversations c ON c.id=g.conversation_id WHERE g.dissolved=0 AND (g.discoverable=1 OR EXISTS(SELECT 1 FROM members WHERE conversation_id=c.id AND user_id=?)) AND (CAST(g.number AS TEXT)=? OR c.name LIKE ? ESCAPE '\') ORDER BY CAST(g.number AS TEXT)=? DESC,g.number LIMIT 30`, uid(r), uid(r), q, "%"+escapeLike(q)+"%", q)
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name, number, description, mode, avatar string
		var count int
		var joined bool
		if e = rows.Scan(&id, &name, &number, &description, &mode, &count, &joined, &avatar); e != nil {
			s.dbError(w, e)
			return
		}
		out = append(out, map[string]any{"id": id, "name": name, "number": number, "description": description, "joinMode": mode, "count": count, "joined": joined, "avatar": avatar})
	}
	if e = rows.Err(); e != nil {
		s.dbError(w, e)
		return
	}
	ok(w, out)
}
func (s *Server) joinGroup(w http.ResponseWriter, r *http.Request) {
	var p struct{ Message string }
	if !decode(w, r, &p) {
		return
	}
	if !validText(p.Message, 200) {
		fail(w, 400, "验证消息最多 200 字")
		return
	}
	if !s.rate(r, "join-group:"+uid(r), 30, time.Hour) {
		fail(w, 429, "加群申请过于频繁")
		return
	}
	cid, user := r.PathValue("id"), uid(r)
	s.groupChange(w, r, func(tx *sql.Tx) (any, []string, error) {
		g, e := readGroup(tx, cid, user)
		if e != nil || !g.Discoverable && g.Role == "" {
			return nil, nil, groupFail(404, "未找到该群")
		}
		if g.Role != "" {
			return map[string]string{"status": "joined"}, nil, nil
		}
		if g.JoinMode == "closed" {
			return nil, nil, groupFail(403, "该群暂不接受加群申请")
		}
		if g.Count >= 200 {
			return nil, nil, groupFail(409, "群成员已满（200 人）")
		}
		status := "pending"
		if g.JoinMode == "open" {
			e = addGroupMember(tx, cid, user)
			status = "joined"
		} else {
			_, e = tx.Exec("INSERT OR IGNORE INTO group_requests(id,conversation_id,user_id,message,created) VALUES(?,?,?,?,?)", newID(), cid, user, strings.TrimSpace(p.Message), now())
		}
		if e != nil {
			return nil, nil, e
		}
		ids, e := groupAudience(tx, cid)
		return map[string]string{"status": status}, append(ids, user), e
	})
}
func (s *Server) groupRequests(w http.ResponseWriter, r *http.Request) {
	rows, e := s.db.Query(`SELECT q.id,q.conversation_id,q.user_id,q.inviter,q.message,q.status,q.created,q.resolved,c.name,g.number,u.name,u.avatar,COALESCE(i.name,''),CASE WHEN c.owner=? OR COALESCE(m.admin,0)=1 THEN 1 ELSE 0 END FROM group_requests q JOIN conversations c ON c.id=q.conversation_id JOIN group_profiles g ON g.conversation_id=c.id JOIN users u ON u.id=q.user_id LEFT JOIN users i ON i.id=q.inviter LEFT JOIN members x ON x.conversation_id=c.id AND x.user_id=? LEFT JOIN group_members m ON m.conversation_id=c.id AND m.user_id=? WHERE (q.user_id=? OR q.inviter=? OR (x.user_id IS NOT NULL AND (c.owner=? OR COALESCE(m.admin,0)=1))) ORDER BY q.created DESC LIMIT 100`, uid(r), uid(r), uid(r), uid(r), uid(r), uid(r))
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, cid, user, inviter, message, status, name, number, userName, avatar, inviterName string
		var created, resolved int64
		var canReview bool
		if e = rows.Scan(&id, &cid, &user, &inviter, &message, &status, &created, &resolved, &name, &number, &userName, &avatar, &inviterName, &canReview); e != nil {
			s.dbError(w, e)
			return
		}
		out = append(out, map[string]any{"id": id, "conversationId": cid, "userId": user, "inviter": inviter, "message": message, "status": status, "created": created, "resolved": resolved, "groupName": name, "number": number, "name": userName, "avatar": avatar, "inviterName": inviterName, "canReview": canReview})
	}
	if e = rows.Err(); e != nil {
		s.dbError(w, e)
		return
	}
	ok(w, out)
}
func (s *Server) resolveGroupRequest(w http.ResponseWriter, r *http.Request) {
	var p struct{ Accept bool }
	if !decode(w, r, &p) {
		return
	}
	s.groupChange(w, r, func(tx *sql.Tx) (any, []string, error) {
		var cid, user, inviter, status string
		if e := tx.QueryRow("SELECT conversation_id,user_id,inviter,status FROM group_requests WHERE id=?", r.PathValue("request")).Scan(&cid, &user, &inviter, &status); e != nil {
			return nil, nil, groupFail(404, "加群申请不存在")
		}
		g, e := groupRequired(tx, cid, uid(r))
		if e != nil {
			return nil, nil, e
		}
		if !g.manager() {
			return nil, nil, groupFail(403, "只有群主和管理员可以审核")
		}
		if status != "pending" {
			return nil, nil, groupFail(409, "该申请已经处理")
		}
		status = "rejected"
		if p.Accept {
			if e = addGroupMember(tx, cid, user); e != nil {
				return nil, nil, e
			}
			status = "accepted"
		}
		if _, e = tx.Exec("UPDATE group_requests SET status=?,resolved=?,resolver=? WHERE id=?", status, now(), uid(r), r.PathValue("request")); e != nil {
			return nil, nil, e
		}
		ids, e := groupAudience(tx, cid)
		return map[string]string{"status": status}, append(ids, user, inviter), e
	})
}
func (s *Server) updateGroup(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Name, Announcement, Description, JoinMode *string
		Discoverable, MembersInvite, AllMuted     *bool
	}
	if !decode(w, r, &p) {
		return
	}
	if p.Name != nil && (strings.TrimSpace(*p.Name) == "" || !validText(*p.Name, 60)) || p.Announcement != nil && !validText(*p.Announcement, 2000) || p.Description != nil && !validText(*p.Description, 200) || p.JoinMode != nil && *p.JoinMode != "open" && *p.JoinMode != "approval" && *p.JoinMode != "closed" {
		fail(w, 400, "群资料格式错误")
		return
	}
	cid := r.PathValue("id")
	s.groupChange(w, r, func(tx *sql.Tx) (any, []string, error) {
		g, e := groupRequired(tx, cid, uid(r))
		if e != nil {
			return nil, nil, e
		}
		if !g.manager() {
			return nil, nil, groupFail(403, "只有群主和管理员可以管理群")
		}
		for _, v := range []struct {
			table, key string
			value      any
		}{{"conversations", "name", p.Name}, {"conversations", "announcement", p.Announcement}, {"group_profiles", "description", p.Description}, {"group_profiles", "join_mode", p.JoinMode}, {"group_profiles", "discoverable", p.Discoverable}, {"group_profiles", "members_invite", p.MembersInvite}, {"group_profiles", "all_muted", p.AllMuted}} {
			switch x := v.value.(type) {
			case *string:
				if x == nil {
					continue
				}
			case *bool:
				if x == nil {
					continue
				}
			}
			column := "conversation_id"
			if v.table == "conversations" {
				column = "id"
			}
			if _, e = tx.Exec("UPDATE "+v.table+" SET "+v.key+"=? WHERE "+column+"=?", v.value, cid); e != nil {
				return nil, nil, e
			}
		}
		ids, e := groupAudience(tx, cid)
		return map[string]bool{"ok": true}, ids, e
	})
}
func (s *Server) updateGroupMember(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Admin       *bool
		MuteMinutes *int64
		Nickname    *string
	}
	if !decode(w, r, &p) {
		return
	}
	if p.MuteMinutes != nil && (*p.MuteMinutes < 0 || *p.MuteMinutes > 43200) || p.Nickname != nil && !validText(*p.Nickname, 32) {
		fail(w, 400, "名片最多 32 字，禁言最长 30 天")
		return
	}
	cid, user, target := r.PathValue("id"), uid(r), r.PathValue("user")
	s.groupChange(w, r, func(tx *sql.Tx) (any, []string, error) {
		g, e := groupRequired(tx, cid, user)
		if e != nil {
			return nil, nil, e
		}
		other, e := groupRequired(tx, cid, target)
		if e != nil {
			return nil, nil, e
		}
		if p.Admin != nil && (g.Role != "owner" || target == g.Owner) {
			return nil, nil, groupFail(403, "只有群主可以设置其他成员为管理员")
		}
		if p.MuteMinutes != nil && (!g.manager() || target == user || other.Role == "owner" || g.Role == "admin" && other.Role == "admin") {
			return nil, nil, groupFail(403, "无权禁言该成员")
		}
		if p.Nickname != nil && user != target && (!g.manager() || other.Role == "owner" || g.Role == "admin" && other.Role == "admin") {
			return nil, nil, groupFail(403, "无权修改该成员的群名片")
		}
		if _, e = tx.Exec("INSERT OR IGNORE INTO group_members(conversation_id,user_id) VALUES(?,?)", cid, target); e != nil {
			return nil, nil, e
		}
		if p.Admin != nil {
			if *p.Admin {
				var n int
				if e = tx.QueryRow("SELECT COUNT(*) FROM group_members WHERE conversation_id=? AND admin=1 AND user_id<>?", cid, target).Scan(&n); e != nil {
					return nil, nil, e
				}
				if n >= 10 {
					return nil, nil, groupFail(409, "最多设置 10 位管理员")
				}
			}
			if _, e = tx.Exec("UPDATE group_members SET admin=?,mute_until=0 WHERE conversation_id=? AND user_id=?", *p.Admin, cid, target); e != nil {
				return nil, nil, e
			}
		}
		if p.MuteMinutes != nil {
			until := int64(0)
			if *p.MuteMinutes > 0 {
				until = now() + *p.MuteMinutes*60000
			}
			if _, e = tx.Exec("UPDATE group_members SET mute_until=? WHERE conversation_id=? AND user_id=?", until, cid, target); e != nil {
				return nil, nil, e
			}
		}
		if p.Nickname != nil {
			if _, e = tx.Exec("UPDATE group_members SET nickname=? WHERE conversation_id=? AND user_id=?", strings.TrimSpace(*p.Nickname), cid, target); e != nil {
				return nil, nil, e
			}
		}
		ids, e := groupAudience(tx, cid)
		return map[string]bool{"ok": true}, ids, e
	})
}
func (s *Server) transferGroup(w http.ResponseWriter, r *http.Request) {
	var p struct{ UserID string }
	if !decode(w, r, &p) {
		return
	}
	cid := r.PathValue("id")
	s.groupChange(w, r, func(tx *sql.Tx) (any, []string, error) {
		g, e := groupRequired(tx, cid, uid(r))
		if e != nil {
			return nil, nil, e
		}
		if g.Role != "owner" || p.UserID == uid(r) {
			return nil, nil, groupFail(403, "只有群主可以转让给其他成员")
		}
		if _, e = groupRequired(tx, cid, p.UserID); e != nil {
			return nil, nil, e
		}
		if _, e = tx.Exec("UPDATE conversations SET owner=? WHERE id=?", p.UserID, cid); e != nil {
			return nil, nil, e
		}
		if _, e = tx.Exec("UPDATE group_members SET admin=0,mute_until=0 WHERE conversation_id=? AND user_id IN (?,?)", cid, uid(r), p.UserID); e != nil {
			return nil, nil, e
		}
		ids, e := groupAudience(tx, cid)
		return map[string]bool{"ok": true}, ids, e
	})
}
func (s *Server) dissolveGroup(w http.ResponseWriter, r *http.Request) {
	cid := r.PathValue("id")
	s.groupChange(w, r, func(tx *sql.Tx) (any, []string, error) {
		g, e := groupRequired(tx, cid, uid(r))
		if e != nil {
			return nil, nil, e
		}
		if g.Role != "owner" {
			return nil, nil, groupFail(403, "只有群主可以解散群")
		}
		ids, e := groupAudience(tx, cid)
		if e != nil {
			return nil, nil, e
		}
		rows, e := tx.Query("SELECT user_id,inviter FROM group_requests WHERE conversation_id=? AND status='pending'", cid)
		if e != nil {
			return nil, nil, e
		}
		for rows.Next() {
			var user, inviter string
			if e = rows.Scan(&user, &inviter); e != nil {
				rows.Close()
				return nil, nil, e
			}
			ids = append(ids, user, inviter)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, nil, e
		}
		if _, e = tx.Exec("UPDATE group_profiles SET dissolved=?,discoverable=0 WHERE conversation_id=?", now(), cid); e != nil {
			return nil, nil, e
		}
		if _, e = tx.Exec("DELETE FROM members WHERE conversation_id=?", cid); e != nil {
			return nil, nil, e
		}
		_, e = tx.Exec("UPDATE group_requests SET status='cancelled',resolved=?,resolver=? WHERE conversation_id=? AND status='pending'", now(), uid(r), cid)
		return map[string]bool{"ok": true}, ids, e
	})
}
