package server

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"golang.org/x/crypto/bcrypt"
	"os"
	"strings"
	"welink/internal/emailaddress"
)

const adminSchema = `
CREATE TABLE IF NOT EXISTS admin_audit(id TEXT PRIMARY KEY,actor TEXT NOT NULL,target TEXT NOT NULL,action TEXT NOT NULL,created INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS deleted_session BEFORE INSERT ON sessions WHEN EXISTS(SELECT 1 FROM deleted_accounts WHERE user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
CREATE TRIGGER IF NOT EXISTS deleted_profile BEFORE UPDATE ON users WHEN EXISTS(SELECT 1 FROM deleted_accounts WHERE user_id=NEW.id) BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
CREATE TRIGGER IF NOT EXISTS deleted_message BEFORE INSERT ON messages WHEN EXISTS(SELECT 1 FROM deleted_accounts WHERE user_id=NEW.sender) BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
CREATE TRIGGER IF NOT EXISTS deleted_attachment BEFORE INSERT ON attachments WHEN EXISTS(SELECT 1 FROM deleted_accounts WHERE user_id=NEW.owner) BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
CREATE TRIGGER IF NOT EXISTS deleted_drive BEFORE INSERT ON drive_files WHEN EXISTS(SELECT 1 FROM deleted_accounts WHERE user_id=NEW.owner) BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
CREATE TRIGGER IF NOT EXISTS deleted_space_doc BEFORE INSERT ON space_documents WHEN EXISTS(SELECT 1 FROM deleted_accounts WHERE user_id=NEW.owner) BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
CREATE TRIGGER IF NOT EXISTS deleted_space_profile BEFORE INSERT ON space_profiles WHEN EXISTS(SELECT 1 FROM deleted_accounts WHERE user_id=NEW.owner) BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
`

func (s *Server) directoryChanged() {
	s.mu.Lock()
	ids := make([]string, 0, len(s.clients))
	for id := range s.clients {
		ids = append(ids, id)
	}
	s.mu.Unlock()
	s.push(ids, "contacts", map[string]bool{"ok": true})
}
func newAccount(db *sql.DB, name, alias, password string) (User, error) {
	return createAccountInDB(db, name, alias, password, false, nil)
}
func createAccountInDB(db *sql.DB, name, alias, password string, requireEmpty bool, beforeCommit func(*sql.Tx, User) error) (User, error) {
	name = strings.TrimSpace(name)
	alias = strings.ToLower(strings.TrimSpace(alias))
	if alias == "" {
		alias = "wl_" + newID()[:20]
	}
	if name == "" || !validText(name, 32) {
		return User{}, errors.New("请填写姓名，1–32 字，请勿包含控制字符")
	}
	if !accountPattern.MatchString(alias) || numericAccount.MatchString(alias) {
		return User{}, errors.New("内部账号标识无效")
	}
	if len(password) < 8 || len(password) > 72 {
		return User{}, errors.New("密码需要 8–72 字节；也可以留空自动生成")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return User{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback()
	if requireEmpty {
		var count int
		if err = tx.QueryRow("SELECT COUNT(*) FROM users").Scan(&count); err != nil {
			return User{}, err
		}
		if count != 0 {
			return User{}, errors.New("bootstrap requires an empty database")
		}
	}
	id := newID()
	avatar := defaultCartoonAvatar(id)
	if _, err = tx.Exec("INSERT INTO users(id,account,name,password,avatar,created) VALUES(?,?,?,?,?,?)", id, alias, name, hash, avatar, now()); err != nil {
		return User{}, errors.New("登录账号已存在")
	}
	if err = assignNumber(tx, id); err != nil {
		return User{}, err
	}
	var number string
	if err = tx.QueryRow("SELECT number FROM user_numbers WHERE user_id=?", id).Scan(&number); err != nil {
		return User{}, err
	}
	user := User{ID: id, Account: number, Name: name, Avatar: avatar, Number: number}
	if beforeCommit != nil {
		if err = beforeCommit(tx, user); err != nil {
			return User{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return User{}, err
	}
	return user, nil
}
func temporaryPassword() (string, error) {
	var raw [18]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

// Bootstrap is deliberately limited to an empty database and writes credentials
// to a private file, never stdout or the public configuration.
func BootstrapAdmin(settings Settings, name, alias, passwordFile, output string, email ...string) (string, error) {
	if output == "" {
		return "", errors.New("bootstrap credential output is required")
	}
	f, err := os.OpenFile(output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return "", err
	}
	defer f.Close()
	complete := false
	defer func() {
		if !complete {
			os.Remove(output)
		}
	}()
	db, err := openStore(settings.DataDir)
	if err != nil {
		return "", err
	}
	defer db.Close()
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count); err != nil {
		return "", err
	}
	if count != 0 {
		return "", errors.New("bootstrap requires an empty database; configure an existing immutable user ID instead")
	}
	adminEmail := ""
	if len(email) > 0 {
		adminEmail = strings.TrimSpace(email[0])
	}
	if settings.EmailAuth.Enabled && adminEmail == "" {
		return "", errors.New("email is required when bootstrapping an email-authenticated administrator")
	}
	if adminEmail != "" {
		adminEmail, err = emailaddress.Normalize(adminEmail)
		if err != nil {
			return "", errors.New("invalid bootstrap administrator email")
		}
		if _, err = db.Exec(emailSchema); err != nil {
			return "", err
		}
	}
	password, err := temporaryPassword()
	if err != nil {
		return "", err
	}
	if passwordFile != "" {
		raw, e := os.ReadFile(passwordFile)
		if e != nil {
			return "", e
		}
		password = strings.TrimRight(string(raw), "\r\n")
	}
	u, err := createAccountInDB(db, name, alias, password, true, func(tx *sql.Tx, user User) error {
		if adminEmail != "" {
			if _, e := tx.Exec("INSERT INTO user_emails(user_id,email,verified) VALUES(?,?,1)", user.ID, adminEmail); e != nil {
				return e
			}
		}
		if e := json.NewEncoder(f).Encode(map[string]string{"userId": user.ID, "number": user.Number, "name": user.Name, "account": user.Account, "password": password, "server": settings.PublicURL}); e != nil {
			return e
		}
		return f.Sync()
	})
	if err != nil {
		return "", err
	}
	complete = true
	return u.ID, nil
}
