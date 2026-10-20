package server

import (
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
	"net/http"
	"strings"
)

// Fixed parameters bound memory/CPU. This verifier is accepted only from the
// authenticated YuDesk bridge, never from an editable profile or registration.
func yudeskVerifier(value string) (salt, digest []byte, valid bool) {
	p := strings.Split(value, "$")
	if len(p) != 6 || p[0] != "" || p[1] != "yudesk" || p[2] != "argon2id" || p[3] != "3,65536,2" {
		return nil, nil, false
	}
	salt, e1 := base64.RawStdEncoding.DecodeString(p[4])
	digest, e2 := base64.RawStdEncoding.DecodeString(p[5])
	return salt, digest, e1 == nil && e2 == nil && len(salt) == 16 && len(digest) == 32
}

func storedPasswordMatches(hash []byte, password string) bool {
	if len(password) > 256 {
		return false
	}
	if salt, digest, ok := yudeskVerifier(string(hash)); ok {
		actual := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
		return subtle.ConstantTimeCompare(actual, digest) == 1
	}
	return bcrypt.CompareHashAndPassword(hash, []byte(password)) == nil
}

func (s *Server) yudeskSyncCredential(w http.ResponseWriter, r *http.Request, user, credential string, revision int64) {
	if _, _, ok := yudeskVerifier(credential); !ok || revision < 1 {
		fail(w, 400, "账号同步数据无效")
		return
	}
	// Keep the same lock order as native password changes and QR redemption.
	s.qrLogins.Lock()
	locked := true
	defer func() {
		if locked {
			s.qrLogins.Unlock()
		}
	}()
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	var current int64
	err = tx.QueryRow(`SELECT revision FROM yudesk_credential_versions WHERE user_id=?`, user).Scan(&current)
	if err != nil && err != sql.ErrNoRows {
		s.dbError(w, err)
		return
	}
	if revision <= current {
		ok(w, map[string]any{"ok": true, "revision": current})
		return
	}
	if _, err = tx.Exec(`UPDATE users SET password=? WHERE id=? AND EXISTS(SELECT 1 FROM yudesk_identities WHERE user_id=?)`, []byte(credential), user, user); err != nil {
		s.dbError(w, err)
		return
	}
	if _, err = tx.Exec(`INSERT INTO yudesk_credential_versions(user_id,revision) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision`, user, revision); err != nil {
		s.dbError(w, err)
		return
	}
	keys, err := sessionKeys(tx, user, "", "", "")
	if err != nil {
		s.dbError(w, err)
		return
	}
	if err = deleteSessions(tx, keys); err != nil {
		s.dbError(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	s.forgetQRApprovals(keys, user)
	s.qrLogins.Unlock()
	locked = false
	s.disconnectSessions(keys)
	ok(w, map[string]any{"ok": true, "revision": revision})
}
