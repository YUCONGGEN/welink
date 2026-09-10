package server

import (
	"database/sql"
	"net/http"
	"sort"
	"strings"
)

const contactSchema = `
CREATE TABLE IF NOT EXISTS contact_groups(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,position INTEGER NOT NULL DEFAULT 0,UNIQUE(user_id,name));
CREATE TABLE IF NOT EXISTS contact_preferences(user_id TEXT NOT NULL,peer_id TEXT NOT NULL,group_id TEXT REFERENCES contact_groups(id) ON DELETE SET NULL,note TEXT NOT NULL DEFAULT '',PRIMARY KEY(user_id,peer_id),FOREIGN KEY(user_id,peer_id) REFERENCES friends(user_id,peer_id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS contact_blocks(user_id TEXT NOT NULL REFERENCES users(id),peer_id TEXT NOT NULL REFERENCES users(id),created INTEGER NOT NULL,PRIMARY KEY(user_id,peer_id));
CREATE TABLE IF NOT EXISTS contact_privacy(user_id TEXT PRIMARY KEY REFERENCES users(id),searchable INTEGER NOT NULL DEFAULT 1,allow_requests INTEGER NOT NULL DEFAULT 1);
CREATE TRIGGER IF NOT EXISTS contact_request_permission BEFORE INSERT ON requests WHEN EXISTS(SELECT 1 FROM contact_blocks WHERE (user_id=NEW.sender AND peer_id=NEW.recipient) OR (user_id=NEW.recipient AND peer_id=NEW.sender)) OR EXISTS(SELECT 1 FROM contact_privacy WHERE user_id=NEW.recipient AND allow_requests=0) BEGIN SELECT RAISE(ABORT,'contact_request_forbidden'); END;
CREATE TRIGGER IF NOT EXISTS contact_friend_permission BEFORE INSERT ON friends WHEN EXISTS(SELECT 1 FROM contact_blocks WHERE (user_id=NEW.user_id AND peer_id=NEW.peer_id) OR (user_id=NEW.peer_id AND peer_id=NEW.user_id)) BEGIN SELECT RAISE(ABORT,'contact_request_forbidden'); END;
CREATE TRIGGER IF NOT EXISTS direct_message_permission BEFORE INSERT ON messages WHEN EXISTS(SELECT 1 FROM conversations WHERE id=NEW.conversation_id AND kind='direct') AND (NOT EXISTS(SELECT 1 FROM members m JOIN friends f ON f.user_id=NEW.sender AND f.peer_id=m.user_id JOIN friends b ON b.user_id=m.user_id AND b.peer_id=NEW.sender WHERE m.conversation_id=NEW.conversation_id AND m.user_id<>NEW.sender) OR EXISTS(SELECT 1 FROM contact_blocks b JOIN members m ON m.conversation_id=NEW.conversation_id AND m.user_id<>NEW.sender WHERE (b.user_id=NEW.sender AND b.peer_id=m.user_id) OR (b.peer_id=NEW.sender AND b.user_id=m.user_id))) BEGIN SELECT RAISE(ABORT,'contact_send_forbidden'); END;
CREATE TRIGGER IF NOT EXISTS remote_contact_insert BEFORE INSERT ON remotes WHEN NOT EXISTS(SELECT 1 FROM friends f JOIN friends b ON b.user_id=f.peer_id AND b.peer_id=f.user_id WHERE f.user_id=NEW.requester AND f.peer_id=NEW.recipient) OR EXISTS(SELECT 1 FROM contact_blocks WHERE (user_id=NEW.requester AND peer_id=NEW.recipient) OR (user_id=NEW.recipient AND peer_id=NEW.requester)) BEGIN SELECT RAISE(ABORT,'contact_send_forbidden'); END;
CREATE TRIGGER IF NOT EXISTS remote_contact_accept BEFORE UPDATE OF state ON remotes WHEN NEW.state='accepted' AND (NOT EXISTS(SELECT 1 FROM friends f JOIN friends b ON b.user_id=f.peer_id AND b.peer_id=f.user_id WHERE f.user_id=NEW.requester AND f.peer_id=NEW.recipient) OR EXISTS(SELECT 1 FROM contact_blocks WHERE (user_id=NEW.requester AND peer_id=NEW.recipient) OR (user_id=NEW.recipient AND peer_id=NEW.requester))) BEGIN SELECT RAISE(ABORT,'contact_send_forbidden'); END;
`

func contactAllowed(q rowQuery, user, peer string) bool {
	var n int
	return q.QueryRow(`SELECT 1 FROM friends f JOIN friends b ON b.user_id=f.peer_id AND b.peer_id=f.user_id WHERE f.user_id=? AND f.peer_id=? AND NOT EXISTS(SELECT 1 FROM contact_blocks WHERE (user_id=? AND peer_id=?) OR (user_id=? AND peer_id=?))`, user, peer, user, peer, peer, user).Scan(&n) == nil
}
func contactBlocked(q rowQuery, user, peer string) bool {
	var n int
	return q.QueryRow("SELECT 1 FROM contact_blocks WHERE (user_id=? AND peer_id=?) OR (user_id=? AND peer_id=?)", user, peer, peer, user).Scan(&n) == nil
}

func (s *Server) orderContactGroups(w http.ResponseWriter, r *http.Request) {
	var p struct{ IDs []string }
	if !decode(w, r, &p) {
		return
	}
	ids, valid := uniqueIDs(p.IDs, 50)
	if !valid || len(ids) != len(p.IDs) {
		fail(w, 400, "分组顺序无效")
		return
	}
	ids = p.IDs // Validation must not replace the user's order with sorted IDs.
	s.groupChange(w, r, func(tx *sql.Tx) (any, []string, error) {
		var count int
		if e := tx.QueryRow("SELECT COUNT(*) FROM contact_groups WHERE user_id=?", uid(r)).Scan(&count); e != nil {
			return nil, nil, e
		}
		if count != len(ids) {
			return nil, nil, groupFail(409, "分组已变化，请刷新后重试")
		}
		for index, id := range ids {
			res, e := tx.Exec("UPDATE contact_groups SET position=? WHERE id=? AND user_id=?", index, id, uid(r))
			if e != nil {
				return nil, nil, e
			}
			if n, _ := res.RowsAffected(); n != 1 {
				return nil, nil, groupFail(403, "不能调整其他人的分组")
			}
		}
		return map[string]bool{"ok": true}, []string{uid(r)}, nil
	})
}

func (s *Server) listContactGroups(w http.ResponseWriter, r *http.Request) {
	rows, e := s.db.Query("SELECT g.id,g.name,g.position,COUNT(p.peer_id) FROM contact_groups g LEFT JOIN contact_preferences p ON p.group_id=g.id AND p.user_id=g.user_id WHERE g.user_id=? GROUP BY g.id ORDER BY g.position,g.id", uid(r))
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name string
		var position, count int
		if e = rows.Scan(&id, &name, &position, &count); e != nil {
			s.dbError(w, e)
			return
		}
		out = append(out, map[string]any{"id": id, "name": name, "position": position, "count": count})
	}
	if e = rows.Err(); e != nil {
		s.dbError(w, e)
		return
	}
	ok(w, out)
}
func (s *Server) saveContactGroup(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Name     string
		Position *int
	}
	if !decode(w, r, &p) {
		return
	}
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" || p.Name == "我的好友" || !validText(p.Name, 24) || p.Position != nil && (*p.Position < 0 || *p.Position > 1000) {
		fail(w, 400, "分组名称应为 1–24 字，且不能使用默认分组名称")
		return
	}
	id := r.PathValue("id")
	s.groupChange(w, r, func(tx *sql.Tx) (any, []string, error) {
		var n int
		if id == "" {
			if e := tx.QueryRow("SELECT COUNT(*) FROM contact_groups WHERE user_id=?", uid(r)).Scan(&n); e != nil {
				return nil, nil, e
			}
			if n >= 50 {
				return nil, nil, groupFail(409, "最多创建 50 个好友分组")
			}
			id = newID()
			if _, e := tx.Exec("INSERT INTO contact_groups(id,user_id,name,position) VALUES(?,?,?,COALESCE((SELECT MAX(position)+1 FROM contact_groups WHERE user_id=?),0))", id, uid(r), p.Name, uid(r)); e != nil {
				return nil, nil, groupFail(409, "分组名称已存在")
			}
		} else {
			if tx.QueryRow("SELECT 1 FROM contact_groups WHERE id=? AND user_id=?", id, uid(r)).Scan(&n) != nil {
				return nil, nil, groupFail(404, "分组不存在")
			}
			if _, e := tx.Exec("UPDATE contact_groups SET name=? WHERE id=? AND user_id=?", p.Name, id, uid(r)); e != nil {
				return nil, nil, groupFail(409, "分组名称已存在")
			}
		}
		if p.Position != nil {
			if _, e := tx.Exec("UPDATE contact_groups SET position=? WHERE id=? AND user_id=?", *p.Position, id, uid(r)); e != nil {
				return nil, nil, e
			}
		}
		return map[string]string{"id": id}, []string{uid(r)}, nil
	})
}
func (s *Server) deleteContactGroup(w http.ResponseWriter, r *http.Request) {
	result, e := s.db.Exec("DELETE FROM contact_groups WHERE id=? AND user_id=?", r.PathValue("id"), uid(r))
	if e != nil {
		s.dbError(w, e)
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		fail(w, 404, "分组不存在")
		return
	}
	s.push([]string{uid(r)}, "contacts", map[string]bool{"ok": true})
	ok(w, map[string]bool{"ok": true})
}
func (s *Server) updateContact(w http.ResponseWriter, r *http.Request) {
	var p struct{ Remark, GroupID, Note *string }
	if !decode(w, r, &p) {
		return
	}
	if p.Remark != nil && !validText(*p.Remark, 32) || p.Note != nil && !validText(*p.Note, 200) {
		fail(w, 400, "备注最多 32 字，描述最多 200 字")
		return
	}
	user, peer := uid(r), r.PathValue("user")
	s.groupChange(w, r, func(tx *sql.Tx) (any, []string, error) {
		if !contactAllowed(tx, user, peer) {
			return nil, nil, groupFail(403, "只能设置当前好友的备注和分组")
		}
		if _, e := tx.Exec("INSERT OR IGNORE INTO contact_preferences(user_id,peer_id) VALUES(?,?)", user, peer); e != nil {
			return nil, nil, e
		}
		if p.GroupID != nil {
			var group any
			if *p.GroupID != "" {
				var n int
				if tx.QueryRow("SELECT 1 FROM contact_groups WHERE id=? AND user_id=?", *p.GroupID, user).Scan(&n) != nil {
					return nil, nil, groupFail(400, "请选择自己的好友分组")
				}
				group = *p.GroupID
			}
			if _, e := tx.Exec("UPDATE contact_preferences SET group_id=? WHERE user_id=? AND peer_id=?", group, user, peer); e != nil {
				return nil, nil, e
			}
		}
		if p.Remark != nil {
			if _, e := tx.Exec("UPDATE friends SET remark=? WHERE user_id=? AND peer_id=?", strings.TrimSpace(*p.Remark), user, peer); e != nil {
				return nil, nil, e
			}
		}
		if p.Note != nil {
			if _, e := tx.Exec("UPDATE contact_preferences SET note=? WHERE user_id=? AND peer_id=?", strings.TrimSpace(*p.Note), user, peer); e != nil {
				return nil, nil, e
			}
		}
		return map[string]bool{"ok": true}, []string{user}, nil
	})
}

func (s *Server) contactDetail(w http.ResponseWriter, r *http.Request) {
	user, peer := uid(r), r.PathValue("user")
	u, e := s.user(peer)
	if e != nil {
		fail(w, 404, "用户不存在")
		return
	}
	friend := contactAllowed(s.db, user, peer)
	var blocked int
	_ = s.db.QueryRow("SELECT 1 FROM contact_blocks WHERE user_id=? AND peer_id=?", user, peer).Scan(&blocked)
	var allow bool = true
	_ = s.db.QueryRow("SELECT allow_requests FROM contact_privacy WHERE user_id=?", peer).Scan(&allow)
	u.Online = u.Online && friend
	if friend {
		_ = s.db.QueryRow("SELECT f.remark,COALESCE(p.group_id,''),COALESCE(p.note,'') FROM friends f LEFT JOIN contact_preferences p ON p.user_id=f.user_id AND p.peer_id=f.peer_id WHERE f.user_id=? AND f.peer_id=?", user, peer).Scan(&u.Remark, &u.ContactGroupID, &u.Note)
	}
	ok(w, map[string]any{"user": u, "friend": friend, "blocked": blocked == 1, "canAdd": allow && !contactBlocked(s.db, user, peer) && peer != user})
}
func (s *Server) listBlocks(w http.ResponseWriter, r *http.Request) {
	rows, e := s.db.Query("SELECT u.id,u.name,u.avatar,n.number,b.created FROM contact_blocks b JOIN users u ON u.id=b.peer_id JOIN user_numbers n ON n.user_id=u.id WHERE b.user_id=? ORDER BY b.created DESC", uid(r))
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name, avatar, number string
		var created int64
		if e = rows.Scan(&id, &name, &avatar, &number, &created); e != nil {
			s.dbError(w, e)
			return
		}
		out = append(out, map[string]any{"id": id, "name": name, "avatar": avatar, "number": number, "created": created})
	}
	if e = rows.Err(); e != nil {
		s.dbError(w, e)
		return
	}
	ok(w, out)
}
func (s *Server) unblockContact(w http.ResponseWriter, r *http.Request) {
	_, e := s.db.Exec("DELETE FROM contact_blocks WHERE user_id=? AND peer_id=?", uid(r), r.PathValue("user"))
	if e != nil {
		s.dbError(w, e)
		return
	}
	s.push([]string{uid(r)}, "contacts", map[string]bool{"ok": true})
	ok(w, map[string]bool{"ok": true})
}
func (s *Server) deleteContact(w http.ResponseWriter, r *http.Request) { s.removeContact(w, r, false) }
func (s *Server) blockContact(w http.ResponseWriter, r *http.Request)  { s.removeContact(w, r, true) }
func (s *Server) removeContact(w http.ResponseWriter, r *http.Request, block bool) {
	user, peer := uid(r), r.PathValue("user")
	if user == peer {
		fail(w, 400, "不能对自己执行此操作")
		return
	}
	tx, e := s.db.Begin()
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer tx.Rollback()
	var n int
	if tx.QueryRow("SELECT 1 FROM users WHERE id=?", peer).Scan(&n) != nil {
		fail(w, 404, "用户不存在")
		return
	}
	if block {
		if _, e = tx.Exec("INSERT OR IGNORE INTO contact_blocks(user_id,peer_id,created) VALUES(?,?,?)", user, peer, now()); e != nil {
			s.dbError(w, e)
			return
		}
	}
	if _, e = tx.Exec("DELETE FROM friends WHERE (user_id=? AND peer_id=?) OR (user_id=? AND peer_id=?)", user, peer, peer, user); e != nil {
		s.dbError(w, e)
		return
	}
	if _, e = tx.Exec("UPDATE requests SET status='cancelled' WHERE status='pending' AND ((sender=? AND recipient=?) OR (sender=? AND recipient=?))", user, peer, peer, user); e != nil {
		s.dbError(w, e)
		return
	}
	rows, e := tx.Query("SELECT id FROM remotes WHERE state IN ('pending','accepted') AND ((requester=? AND recipient=?) OR (requester=? AND recipient=?))", user, peer, peer, user)
	if e != nil {
		s.dbError(w, e)
		return
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			s.dbError(w, e)
			return
		}
		ids = append(ids, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		s.dbError(w, e)
		return
	}
	for _, id := range ids {
		if _, e = tx.Exec("UPDATE remotes SET state='ended',updated=? WHERE id=?", now(), id); e != nil {
			s.dbError(w, e)
			return
		}
	}
	if e = tx.Commit(); e != nil {
		s.dbError(w, e)
		return
	}
	for _, id := range ids {
		s.closeRoom(id)
		if v, e := s.remote(id); e == nil {
			s.publishRemote(v)
		}
	}
	pair := []string{user, peer}
	sort.Strings(pair)
	var cid string
	_ = s.db.QueryRow("SELECT id FROM conversations WHERE direct_key=?", strings.Join(pair, ":")).Scan(&cid)
	s.meetings.Lock()
	if calls, e := s.activeCallRecords(); e == nil {
		for _, call := range calls {
			if call.ConversationID == cid {
				_, _ = s.finishCallLocked(call, "unavailable")
			}
		}
	}
	for code, room := range s.meetings.rooms {
		if cid != "" && room.ConversationID == cid {
			s.finishMeetingLocked(code, "好友关系已变化")
			continue
		}
		if block && !s.isGroupMeeting(room) {
			var removed string
			if room.Owner == user {
				removed = peer
			} else if room.Owner == peer {
				removed = user
			}
			if removed != "" {
				if p := room.Peers[removed]; p != nil {
					p.socket.close()
				}
			}
		}
	}
	s.meetings.Unlock()
	s.push(pair, "contacts", map[string]bool{"ok": true})
	ok(w, map[string]bool{"ok": true})
}
func (s *Server) contactPrivacy(w http.ResponseWriter, r *http.Request) {
	var searchable, allow bool = true, true
	_ = s.db.QueryRow("SELECT searchable,allow_requests FROM contact_privacy WHERE user_id=?", uid(r)).Scan(&searchable, &allow)
	ok(w, map[string]bool{"searchable": searchable, "allowRequests": allow})
}
func (s *Server) updateContactPrivacy(w http.ResponseWriter, r *http.Request) {
	var p struct{ Searchable, AllowRequests *bool }
	if !decode(w, r, &p) {
		return
	}
	if _, e := s.db.Exec("INSERT INTO contact_privacy(user_id,searchable,allow_requests) VALUES(?,COALESCE(?,1),COALESCE(?,1)) ON CONFLICT(user_id) DO UPDATE SET searchable=COALESCE(?,contact_privacy.searchable),allow_requests=COALESCE(?,contact_privacy.allow_requests)", uid(r), p.Searchable, p.AllowRequests, p.Searchable, p.AllowRequests); e != nil {
		s.dbError(w, e)
		return
	}
	s.push([]string{uid(r)}, "contacts", map[string]bool{"ok": true})
	s.contactPrivacy(w, r)
}
