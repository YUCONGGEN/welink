package server

import (
	"database/sql"
	"golang.org/x/crypto/bcrypt"
	"net/http"
)

func adminSession(tx *sql.Tx, r *http.Request) error {
	var exists int
	err := tx.QueryRow("SELECT 1 FROM sessions WHERE token=? AND user_id=? AND expires>?", sessionHash(r), uid(r), now()).Scan(&exists)
	if err == sql.ErrNoRows {
		return groupFail(401, "管理员登录状态已失效")
	}
	return err
}

func (s *Server) adminResetPassword(w http.ResponseWriter, r *http.Request) {
	if !s.adminOnly(w, r) {
		return
	}
	var p struct{ Password string }
	if !decode(w, r, &p) {
		return
	}
	if len(p.Password) < 8 || len(p.Password) > 72 {
		fail(w, 400, "新密码需要 8–72 字节")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(p.Password), 12)
	if err != nil {
		s.dbError(w, err)
		return
	}
	keys, err := s.resetPasswordAsAdmin(r, hash)
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.disconnectSessions(keys)
	ok(w, map[string]any{"ok": true, "signedOut": len(keys)})
}
func (s *Server) resetPasswordAsAdmin(r *http.Request, hash []byte) (map[string]bool, error) {
	s.qrLogins.Lock()
	defer s.qrLogins.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var exists int
	if err = adminSession(tx, r); err != nil {
		return nil, err
	}
	target := r.PathValue("id")
	if tx.QueryRow("SELECT 1 FROM users WHERE id=? AND NOT EXISTS(SELECT 1 FROM deleted_accounts WHERE user_id=?)", target, target).Scan(&exists) != nil {
		return nil, groupFail(404, "账号不存在")
	}
	if _, err = tx.Exec("UPDATE users SET password=? WHERE id=?", hash, target); err != nil {
		return nil, err
	}
	except := ""
	if target == uid(r) {
		except = sessionHash(r)
	}
	keys, err := sessionKeys(tx, target, except, "", "")
	if err != nil {
		return nil, err
	}
	if err = deleteSessions(tx, keys); err != nil {
		return nil, err
	}
	if _, err = tx.Exec("INSERT INTO admin_audit VALUES(?,?,?,?,?)", newID(), uid(r), target, "reset-password", now()); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	s.forgetQRApprovals(keys, target)
	return keys, nil
}
