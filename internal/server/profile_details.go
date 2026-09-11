package server

import (
	"database/sql"
	"errors"
	"net/http"
	"regexp"
	"strings"
)

const profileDetailsSchema = `CREATE TABLE IF NOT EXISTS user_profile_details(user_id TEXT PRIMARY KEY REFERENCES users(id),phone TEXT NOT NULL DEFAULT '',gender TEXT NOT NULL DEFAULT '',job_title TEXT NOT NULL DEFAULT '');`

type profileDetailsPatch struct {
	Phone    *string `json:"phone"`
	Gender   *string `json:"gender"`
	JobTitle *string `json:"jobTitle"`
}

func (p profileDetailsPatch) validate() bool {
	if p.Phone != nil {
		*p.Phone = strings.TrimSpace(*p.Phone)
		if *p.Phone != "" && !regexp.MustCompile(`^\+?[0-9 ()-]{3,32}$`).MatchString(*p.Phone) {
			return false
		}
	}
	if p.Gender != nil && *p.Gender != "" && *p.Gender != "male" && *p.Gender != "female" && *p.Gender != "other" {
		return false
	}
	if p.JobTitle != nil {
		*p.JobTitle = strings.TrimSpace(*p.JobTitle)
		if !validText(*p.JobTitle, 64) {
			return false
		}
	}
	return true
}
func (p profileDetailsPatch) save(tx *sql.Tx, id string) error {
	if p.Phone == nil && p.Gender == nil && p.JobTitle == nil {
		return nil
	}
	if _, err := tx.Exec("INSERT OR IGNORE INTO user_profile_details(user_id) VALUES(?)", id); err != nil {
		return err
	}
	_, err := tx.Exec("UPDATE user_profile_details SET phone=COALESCE(?,phone),gender=COALESCE(?,gender),job_title=COALESCE(?,job_title) WHERE user_id=?", p.Phone, p.Gender, p.JobTitle, id)
	return err
}
func (s *Server) userProfile(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var active int
	if s.db.QueryRow("SELECT 1 FROM users WHERE id=? AND NOT EXISTS(SELECT 1 FROM deleted_accounts WHERE user_id=?)", id, id).Scan(&active) != nil {
		fail(w, 404, "用户资料不存在")
		return
	}
	if id != uid(r) && !contactAllowed(s.db, uid(r), id) {
		fail(w, 403, "无法查看该用户资料")
		return
	}
	u, err := s.user(id)
	if err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, u)
}
func (s *Server) fillProfileDetails(u *User) error {
	err := s.db.QueryRow("SELECT phone,gender,job_title FROM user_profile_details WHERE user_id=?", u.ID).Scan(&u.Phone, &u.Gender, &u.JobTitle)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	return err
}
