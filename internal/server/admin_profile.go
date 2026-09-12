package server

import (
	"database/sql"
	"net/http"
	"strings"
)

func (s *Server) adminUserProfile(w http.ResponseWriter, r *http.Request) {
	if !s.adminOnly(w, r) {
		return
	}
	id := r.PathValue("id")
	var exists int
	err := s.db.QueryRow("SELECT 1 FROM users WHERE id=? AND NOT EXISTS(SELECT 1 FROM deleted_accounts WHERE user_id=?)", id, id).Scan(&exists)
	if err == sql.ErrNoRows {
		fail(w, 404, "账号不存在")
		return
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	u, err := s.user(id)
	if err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, u)
}

func (s *Server) adminUpdateProfile(w http.ResponseWriter, r *http.Request) {
	if !s.adminOnly(w, r) {
		return
	}
	var p struct {
		profileDetailsPatch
		Name *string `json:"name"`
		Bio  *string `json:"bio"`
	}
	if !decode(w, r, &p) {
		return
	}
	if p.Name != nil {
		*p.Name = strings.TrimSpace(*p.Name)
		if *p.Name == "" || !validText(*p.Name, 32) {
			fail(w, 400, "请填写姓名（昵称），1–32 字")
			return
		}
	}
	if p.Bio != nil && !validText(*p.Bio, 150) {
		fail(w, 400, "个性签名最多 150 字")
		return
	}
	if !p.profileDetailsPatch.validate() {
		fail(w, 400, "请检查手机号、性别或职位格式")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	if err = adminSession(tx, r); err != nil {
		s.dbError(w, err)
		return
	}
	id := r.PathValue("id")
	result, err := tx.Exec("UPDATE users SET name=COALESCE(?,name),bio=COALESCE(?,bio) WHERE id=? AND NOT EXISTS(SELECT 1 FROM deleted_accounts WHERE user_id=?)", p.Name, p.Bio, id, id)
	if err != nil {
		s.dbError(w, err)
		return
	}
	if count, err := result.RowsAffected(); err != nil || count != 1 {
		if err != nil {
			s.dbError(w, err)
		} else {
			fail(w, 404, "账号不存在")
		}
		return
	}
	if err = p.profileDetailsPatch.save(tx, id); err != nil {
		s.dbError(w, err)
		return
	}
	if _, err = tx.Exec("INSERT INTO admin_audit VALUES(?,?,?,?,?)", newID(), uid(r), id, "update-profile", now()); err != nil {
		s.dbError(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	s.profileChanged(id)
	s.directoryChanged()
	s.adminUserProfile(w, r)
}
