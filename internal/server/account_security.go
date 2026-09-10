package server

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/bcrypt"
)

type loginSession struct {
	ID       string `json:"id"`
	Device   string `json:"device"`
	Created  int64  `json:"created"`
	LastSeen int64  `json:"lastSeen"`
	Expires  int64  `json:"expires"`
	Current  bool   `json:"current"`
}

func loginDevice(r *http.Request) string {
	platform := strings.ToLower(r.Header.Get("X-WeLink-Client"))
	switch platform {
	case "windows":
		return "Windows · WeLink"
	case "android":
		return "Android · WeLink"
	}
	agent := strings.ToLower(r.UserAgent())
	if strings.Contains(agent, "android") {
		return "Android 客户端"
	}
	if strings.Contains(agent, "windows") {
		return "Windows 客户端"
	}
	return "其他客户端"
}

func (s *Server) listSessions(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query("SELECT i.id,i.device,i.created,i.last_seen,s.expires,s.token FROM sessions s JOIN session_info i ON i.token=s.token WHERE s.user_id=? AND s.expires>? ORDER BY i.last_seen DESC,i.created DESC", uid(r), now())
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer rows.Close()
	items := []loginSession{}
	for rows.Next() {
		var item loginSession
		var key string
		if err = rows.Scan(&item.ID, &item.Device, &item.Created, &item.LastSeen, &item.Expires, &key); err != nil {
			s.dbError(w, err)
			return
		}
		item.Current = key == sessionHash(r)
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, items)
}

func sessionKeys(tx *sql.Tx, user, except, targetID, onlyHash string) (map[string]bool, error) {
	rows, err := tx.Query("SELECT s.token FROM sessions s JOIN session_info i ON i.token=s.token WHERE s.user_id=? AND s.token<>? AND (?='' OR i.id=?) AND (?='' OR s.token=?)", user, except, targetID, targetID, onlyHash, onlyHash)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := map[string]bool{}
	for rows.Next() {
		var key string
		if err = rows.Scan(&key); err != nil {
			return nil, err
		}
		keys[key] = true
	}
	return keys, rows.Err()
}
func deleteSessions(tx *sql.Tx, keys map[string]bool) error {
	for key := range keys {
		if _, err := tx.Exec("DELETE FROM sessions WHERE token=?", key); err != nil {
			return err
		}
	}
	return nil
}

// All credential changes take the QR lock before a database transaction, matching
// QR redemption. A pending approval cannot race a password change or phone logout.
func (s *Server) removeSessions(user, except, targetID, onlyHash string) (map[string]bool, error) {
	s.qrLogins.Lock()
	defer s.qrLogins.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	keys, err := sessionKeys(tx, user, except, targetID, onlyHash)
	if err != nil {
		return nil, err
	}
	if err = deleteSessions(tx, keys); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	s.forgetQRApprovals(keys, "")
	return keys, nil
}
func (s *Server) forgetQRApprovals(keys map[string]bool, user string) {
	for id, q := range s.qrLogins.items {
		if keys[q.UserSession] || (user != "" && q.UserID == user) {
			delete(s.qrLogins.items, id)
		}
	}
}
func (s *Server) revokeDevice(w http.ResponseWriter, r *http.Request) {
	keys, err := s.removeSessions(uid(r), "", r.PathValue("id"), "")
	if err != nil {
		s.dbError(w, err)
		return
	}
	if len(keys) == 0 {
		fail(w, 404, "登录设备不存在")
		return
	}
	s.disconnectSessions(keys)
	ok(w, map[string]any{"ok": true, "current": keys[sessionHash(r)]})
}
func (s *Server) revokeOtherDevices(w http.ResponseWriter, r *http.Request) {
	keys, err := s.removeSessions(uid(r), sessionHash(r), "", "")
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.disconnectSessions(keys)
	ok(w, map[string]int{"signedOut": len(keys)})
}
func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	if !s.rate(r, "password:"+uid(r), 8, time.Hour) {
		fail(w, 429, "修改密码过于频繁，请稍后再试")
		return
	}
	var input struct{ OldPassword, NewPassword string }
	if !decode(w, r, &input) {
		return
	}
	if len(input.NewPassword) < 8 || len(input.NewPassword) > 72 || input.OldPassword == input.NewPassword {
		fail(w, 400, "请使用不同于旧密码的 8–72 字节新密码")
		return
	}
	var oldHash []byte
	if s.db.QueryRow("SELECT password FROM users WHERE id=?", uid(r)).Scan(&oldHash) != nil || bcrypt.CompareHashAndPassword(oldHash, []byte(input.OldPassword)) != nil {
		fail(w, 400, "原密码不正确")
		return
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), 12)
	if err != nil {
		s.dbError(w, err)
		return
	}
	keys, err := s.replacePassword(uid(r), sessionHash(r), oldHash, newHash)
	if errors.Is(err, errPasswordChanged) {
		fail(w, 409, "密码或登录状态已变化，请重新登录后修改")
		return
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.disconnectSessions(keys)
	ok(w, map[string]any{"ok": true, "signedOut": len(keys)})
}

var errPasswordChanged = errors.New("password or session changed")

func (s *Server) replacePassword(user, current string, oldHash, newHash []byte) (map[string]bool, error) {
	s.qrLogins.Lock()
	defer s.qrLogins.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := tx.Exec("UPDATE users SET password=? WHERE id=? AND password=? AND EXISTS(SELECT 1 FROM sessions WHERE token=? AND user_id=? AND expires>?)", newHash, user, oldHash, current, user, now())
	if err != nil {
		return nil, err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return nil, errPasswordChanged
	}
	keys, err := sessionKeys(tx, user, current, "", "")
	if err != nil {
		return nil, err
	}
	if err = deleteSessions(tx, keys); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	s.forgetQRApprovals(keys, user)
	return keys, nil
}

func (s *Server) sessionAlive(c *socket) bool {
	var value int
	err := s.db.QueryRow("SELECT 1 FROM sessions WHERE token=? AND expires>?", c.session, now()).Scan(&value)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			closeLoginSocket(c)
		} else {
			c.close()
		}
		return false
	}
	_, _ = s.db.Exec("UPDATE session_info SET last_seen=? WHERE token=? AND last_seen<?", now(), c.session, now()-60000)
	return true
}
func closeLoginSocket(c *socket) {
	_ = c.c.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(4001, "登录已失效，请重新登录"), time.Now().Add(100*time.Millisecond))
	c.close()
}
func (s *Server) disconnectSessions(keys map[string]bool) {
	if len(keys) == 0 {
		return
	}
	sockets := map[*socket]bool{}
	s.mu.Lock()
	for _, clients := range s.clients {
		for c := range clients {
			if keys[c.session] {
				sockets[c] = true
			}
		}
	}
	for _, room := range s.rooms {
		for _, c := range room {
			if keys[c.session] {
				sockets[c] = true
			}
		}
	}
	s.mu.Unlock()
	s.meetings.Lock()
	for _, room := range s.meetings.rooms {
		for _, p := range room.Peers {
			if keys[p.socket.session] {
				sockets[p.socket] = true
			}
		}
	}
	s.meetings.Unlock()
	for c := range sockets {
		closeLoginSocket(c)
	}
}
