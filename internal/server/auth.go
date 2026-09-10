package server

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"golang.org/x/crypto/bcrypt"
	"net/http"
	"regexp"
	"strings"
	"time"
)

var accountPattern = regexp.MustCompile(`^[a-zA-Z0-9_]{5,24}$`)
var numericAccount = regexp.MustCompile(`^[0-9]+$`)

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	if !s.rate(r, "register", 12, time.Hour) {
		fail(w, 429, "注册过于频繁，请稍后再试")
		return
	}
	var p struct{ Account, Name, Password, Avatar string }
	if !decode(w, r, &p) {
		return
	}
	p.Account = strings.ToLower(strings.TrimSpace(p.Account))
	p.Name = strings.TrimSpace(p.Name)
	// An optional alias supplements the automatically assigned WeLink number.
	if p.Account == "" {
		p.Account = "wl_" + newID()[:20]
	}
	if numericAccount.MatchString(p.Account) {
		fail(w, 400, "WeLink 号码由系统自动分配，登录别名请包含字母或下划线")
		return
	}
	if !accountPattern.MatchString(p.Account) || p.Name == "" || !validText(p.Name, 32) || len(p.Password) < 8 || len(p.Password) > 72 {
		fail(w, 400, "账号为 5–24 位字母数字或下划线，昵称 1–32 字，密码 8–72 字节")
		return
	}
	if p.Avatar != "" && !validCartoonAvatar(p.Avatar) {
		fail(w, 400, "请选择头像库中的卡通头像")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(p.Password), 12)
	if err != nil {
		s.dbError(w, err)
		return
	}
	id := newID()
	if p.Avatar == "" {
		p.Avatar = defaultCartoonAvatar(id)
	}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	if _, err = tx.Exec("INSERT INTO users(id,account,name,password,avatar,created) VALUES(?,?,?,?,?,?)", id, p.Account, p.Name, hash, p.Avatar, now()); err != nil {
		fail(w, 409, "账号已被使用")
		return
	}
	if err = assignNumber(tx, id); err != nil {
		s.dbError(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	s.issueSession(w, r, id)
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if !s.rate(r, "login", 30, time.Minute) {
		fail(w, 429, "尝试次数过多，请稍后再试")
		return
	}
	var p struct{ Account, Password string }
	if !decode(w, r, &p) {
		return
	}
	var id string
	var hash []byte
	login := strings.ToLower(strings.TrimSpace(p.Account))
	err := s.db.QueryRow("SELECT u.id,u.password FROM users u JOIN user_numbers n ON n.user_id=u.id WHERE u.account=? OR CAST(n.number AS TEXT)=?", login, login).Scan(&id, &hash)
	if err != nil || bcrypt.CompareHashAndPassword(hash, []byte(p.Password)) != nil {
		fail(w, 401, "账号或密码不正确")
		return
	}
	s.issueSession(w, r, id, hash)
}
func (s *Server) issueSession(w http.ResponseWriter, r *http.Request, id string, expectedPassword ...[]byte) bool {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		s.dbError(w, err)
		return false
	}
	token := hex.EncodeToString(b[:])
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return false
	}
	defer tx.Rollback()
	if len(expectedPassword) > 0 {
		var current []byte
		if tx.QueryRow("SELECT password FROM users WHERE id=?", id).Scan(&current) != nil || !bytes.Equal(current, expectedPassword[0]) {
			fail(w, 401, "密码已变更，请重新登录")
			return false
		}
	}
	if _, err := tx.Exec("INSERT INTO sessions VALUES(?,?,?)", hashToken(token), id, time.Now().Add(30*24*time.Hour).UnixMilli()); err != nil {
		s.dbError(w, err)
		return false
	}
	if _, err = tx.Exec("INSERT INTO session_info VALUES(?,?,?,?,?)", hashToken(token), newID(), loginDevice(r), now(), now()); err != nil {
		s.dbError(w, err)
		return false
	}
	if err = tx.Commit(); err != nil {
		s.dbError(w, err)
		return false
	}
	_, _ = s.db.Exec("DELETE FROM sessions WHERE expires<?", now())
	http.SetCookie(w, &http.Cookie{Name: "welink_session", Value: token, Path: "/", HttpOnly: true, Secure: r.TLS != nil, SameSite: http.SameSiteStrictMode, MaxAge: 30 * 86400})
	u, _ := s.user(id)
	ok(w, map[string]any{"token": token, "user": u})
	return true
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	keys, err := s.removeSessions(uid(r), "", "", sessionHash(r))
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.disconnectSessions(keys)
	http.SetCookie(w, &http.Cookie{Name: "welink_session", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode})
	ok(w, map[string]bool{"ok": true})
}
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	u, e := s.user(uid(r))
	if e != nil {
		s.dbError(w, e)
		return
	}
	ok(w, u)
}
func (s *Server) updateMe(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Name, Bio string
		Avatar    *string
	}
	if !decode(w, r, &p) {
		return
	}
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" || !validText(p.Name, 32) || !validText(p.Bio, 150) {
		fail(w, 400, "个人资料格式错误")
		return
	}
	tx, e := s.db.Begin()
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer tx.Rollback()
	if e = validateProfileAvatar(tx, uid(r), p.Avatar); e != nil {
		s.dbError(w, e)
		return
	}
	if _, e := tx.Exec("UPDATE users SET name=?,avatar=COALESCE(?,avatar),bio=? WHERE id=?", p.Name, p.Avatar, p.Bio, uid(r)); e != nil {
		s.dbError(w, e)
		return
	}
	if e = tx.Commit(); e != nil {
		s.dbError(w, e)
		return
	}
	s.profileChanged(uid(r))
	s.me(w, r)
}
func (s *Server) users(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	out := []User{}
	if len(q) < 2 {
		ok(w, out)
		return
	}
	rows, e := s.db.Query("SELECT u.id,u.account,u.name,u.avatar,u.bio,n.number FROM users u JOIN user_numbers n ON n.user_id=u.id WHERE u.id<>? AND (NOT EXISTS(SELECT 1 FROM contact_privacy p WHERE p.user_id=u.id AND p.searchable=0) OR EXISTS(SELECT 1 FROM friends f WHERE f.user_id=? AND f.peer_id=u.id)) AND NOT EXISTS(SELECT 1 FROM contact_blocks b WHERE (b.user_id=? AND b.peer_id=u.id) OR (b.user_id=u.id AND b.peer_id=?)) AND (u.account=? OR CAST(n.number AS TEXT)=? OR u.name LIKE ? ESCAPE '\\') LIMIT 30", uid(r), uid(r), uid(r), uid(r), strings.ToLower(q), q, "%"+escapeLike(q)+"%")
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var u User
		_ = rows.Scan(&u.ID, &u.Account, &u.Name, &u.Avatar, &u.Bio, &u.Number)
		u.Online = false
		out = append(out, u)
	}
	rows.Close()
	for i := range out {
		out[i].Online = s.online(out[i].ID) && contactAllowed(s.db, uid(r), out[i].ID)
	}
	ok(w, out)
}
func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, "%", `\%`)
	return strings.ReplaceAll(s, "_", `\_`)
}
func (s *Server) friends(w http.ResponseWriter, r *http.Request) {
	rows, e := s.db.Query("SELECT u.id,u.account,u.name,u.avatar,u.bio,f.remark,n.number,COALESCE(p.group_id,''),COALESCE(p.note,'') FROM friends f JOIN users u ON u.id=f.peer_id JOIN user_numbers n ON n.user_id=u.id LEFT JOIN contact_preferences p ON p.user_id=f.user_id AND p.peer_id=f.peer_id WHERE f.user_id=? ORDER BY CASE WHEN f.remark<>'' THEN f.remark ELSE u.name END", uid(r))
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		var u User
		_ = rows.Scan(&u.ID, &u.Account, &u.Name, &u.Avatar, &u.Bio, &u.Remark, &u.Number, &u.ContactGroupID, &u.Note)
		u.Online = s.online(u.ID)
		out = append(out, u)
	}
	ok(w, out)
}
func (s *Server) requests(w http.ResponseWriter, r *http.Request) {
	rows, e := s.db.Query("SELECT q.id,q.sender,q.recipient,q.message,q.status,q.created,u.name,u.avatar,u.account FROM requests q JOIN users u ON u.id=CASE WHEN q.sender=? THEN q.recipient ELSE q.sender END WHERE q.sender=? OR q.recipient=? ORDER BY q.created DESC LIMIT 100", uid(r), uid(r), uid(r))
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, sender, recipient, msg, status, name, avatar, account string
		var created int64
		_ = rows.Scan(&id, &sender, &recipient, &msg, &status, &created, &name, &avatar, &account)
		out = append(out, map[string]any{"id": id, "sender": sender, "recipient": recipient, "message": msg, "status": status, "created": created, "name": name, "avatar": avatar, "account": account})
	}
	ok(w, out)
}
func (s *Server) addRequest(w http.ResponseWriter, r *http.Request) {
	if !s.rate(r, "request:"+uid(r), 20, time.Hour) {
		fail(w, 429, "好友申请过于频繁")
		return
	}
	var p struct{ UserID, Message string }
	if !decode(w, r, &p) {
		return
	}
	if p.UserID == uid(r) || !validText(p.Message, 150) {
		fail(w, 400, "好友申请无效")
		return
	}
	if _, e := s.user(p.UserID); e != nil {
		fail(w, 404, "用户不存在")
		return
	}
	var n int
	if s.db.QueryRow("SELECT 1 FROM friends WHERE user_id=? AND peer_id=?", uid(r), p.UserID).Scan(&n) == nil {
		fail(w, 409, "已经是好友")
		return
	}
	id := newID()
	if _, e := s.db.Exec("INSERT INTO requests(id,sender,recipient,message,created) VALUES(?,?,?,?,?)", id, uid(r), p.UserID, p.Message, now()); e != nil {
		if strings.Contains(e.Error(), "contact_request_forbidden") {
			s.dbError(w, e)
			return
		}
		fail(w, 409, "申请已发送，请等待对方处理")
		return
	}
	s.push([]string{uid(r), p.UserID}, "request", map[string]string{"id": id})
	ok(w, map[string]string{"id": id})
}
func (s *Server) resolveRequest(w http.ResponseWriter, r *http.Request) {
	var p struct{ Accept bool }
	if !decode(w, r, &p) {
		return
	}
	tx, e := s.db.Begin()
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer tx.Rollback()
	var sender, status string
	if tx.QueryRow("SELECT sender,status FROM requests WHERE id=? AND recipient=?", r.PathValue("id"), uid(r)).Scan(&sender, &status) != nil || status != "pending" {
		fail(w, 404, "申请已处理或不存在")
		return
	}
	status = "rejected"
	if p.Accept {
		status = "accepted"
		for _, pair := range [][2]string{{sender, uid(r)}, {uid(r), sender}} {
			if _, e = tx.Exec("INSERT OR IGNORE INTO friends(user_id,peer_id) VALUES(?,?)", pair[0], pair[1]); e != nil {
				s.dbError(w, e)
				return
			}
		}
	}
	if _, e = tx.Exec("UPDATE requests SET status=? WHERE id=?", status, r.PathValue("id")); e != nil {
		s.dbError(w, e)
		return
	}
	if e = tx.Commit(); e != nil {
		s.dbError(w, e)
		return
	}
	s.push([]string{sender, uid(r)}, "request", map[string]string{"id": r.PathValue("id")})
	ok(w, map[string]bool{"ok": true})
}
