package server

import (
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"fmt"
	"net/http"
	"regexp"
)

var cartoonAvatarPattern = regexp.MustCompile(`^cartoon:(00[1-9]|0[1-9][0-9]|100)$`)

func validCartoonAvatar(value string) bool { return cartoonAvatarPattern.MatchString(value) }

// The default stays the same when a user resets an uploaded photo.
func defaultCartoonAvatar(user string) string {
	hash := sha256.Sum256([]byte(user))
	return fmt.Sprintf("cartoon:%03d", 1+binary.BigEndian.Uint32(hash[:4])%100)
}

func migrateCartoonAvatars(db *sql.DB) error {
	rows, err := db.Query("SELECT id FROM users WHERE avatar='blue'")
	if err != nil {
		return err
	}
	var users []string
	for rows.Next() {
		var user string
		if err = rows.Scan(&user); err != nil {
			rows.Close()
			return err
		}
		users = append(users, user)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if len(users) == 0 {
		return nil
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, user := range users {
		if _, err = tx.Exec("UPDATE users SET avatar=? WHERE id=? AND avatar='blue'", defaultCartoonAvatar(user), user); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Server) selectCartoonAvatar(w http.ResponseWriter, r *http.Request) {
	var p struct{ Avatar string }
	if !decode(w, r, &p) {
		return
	}
	if !validCartoonAvatar(p.Avatar) {
		fail(w, 400, "请选择头像库中的卡通头像")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	if err = validateProfileAvatar(tx, uid(r), &p.Avatar); err != nil {
		s.dbError(w, err)
		return
	}
	if _, err = tx.Exec("UPDATE users SET avatar=? WHERE id=?", p.Avatar, uid(r)); err != nil {
		s.dbError(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	s.avatarChanged("user:" + uid(r))
	ok(w, map[string]string{"avatar": p.Avatar})
}
