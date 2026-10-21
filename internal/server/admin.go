package server

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"golang.org/x/crypto/bcrypt"
	"net/http"
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

func (s *Server) isAdmin(id string) bool {
	for _, allowed := range s.settings.Admin.Users {
		if allowed == id {
			return true
		}
	}
	return false
}
func (s *Server) adminOnly(w http.ResponseWriter, r *http.Request) bool {
	if !s.isAdmin(uid(r)) {
		fail(w, 403, "仅管理员可执行此操作")
		return false
	}
	return true
}
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

func (s *Server) adminUsers(w http.ResponseWriter, r *http.Request) {
	if !s.adminOnly(w, r) {
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if !validText(q, 120) {
		fail(w, 400, "搜索内容过长")
		return
	}
	rows, err := s.db.Query("SELECT u.id,u.name,u.account,n.number,u.created FROM users u JOIN user_numbers n ON n.user_id=u.id WHERE NOT EXISTS(SELECT 1 FROM deleted_accounts d WHERE d.user_id=u.id) AND (u.name LIKE ? ESCAPE '\\' OR CAST(n.number AS TEXT)=? OR u.id=?) ORDER BY u.created DESC LIMIT 100", "%"+escapeLike(q)+"%", q, q)
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name, alias, number string
		var created int64
		if err = rows.Scan(&id, &name, &alias, &number, &created); err != nil {
			s.dbError(w, err)
			return
		}
		out = append(out, map[string]any{"id": id, "name": name, "account": number, "number": number, "created": created, "admin": s.isAdmin(id)})
	}
	if err = rows.Err(); err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, out)
}
func (s *Server) adminCreateUser(w http.ResponseWriter, r *http.Request) {
	if s.settings.EmailAuth.Enabled {
		s.createEmailUser(w, r, true)
		return
	}
	if !s.adminOnly(w, r) {
		return
	}
	var p struct{ Name, Account, Password string }
	if !decode(w, r, &p) {
		return
	}
	generated := p.Password == ""
	var err error
	if generated {
		p.Password, err = temporaryPassword()
		if err != nil {
			s.dbError(w, err)
			return
		}
	}
	u, err := createAccountInDB(s.db, p.Name, "", p.Password, false, func(tx *sql.Tx, user User) error {
		if err := adminSession(tx, r); err != nil {
			return err
		}
		_, err := tx.Exec("INSERT INTO admin_audit VALUES(?,?,?,?,?)", newID(), uid(r), user.ID, "create-account", now())
		return err
	})
	if err != nil {
		var permission *groupError
		if errors.As(err, &permission) {
			s.dbError(w, err)
			return
		}
		fail(w, 400, err.Error())
		return
	}
	s.directoryChanged()
	result := map[string]any{"user": u}
	if generated {
		result["initialPassword"] = p.Password
	}
	ok(w, result)
}
func (s *Server) adminDeleteUser(w http.ResponseWriter, r *http.Request) {
	if !s.adminOnly(w, r) {
		return
	}
	target := r.PathValue("id")
	if s.isAI(target) {
		fail(w, 409, "请在配置文件中停用 Me 助手")
		return
	}
	if target == uid(r) || s.isAdmin(target) {
		fail(w, 409, "不能在此删除管理员账号")
		return
	}
	var p struct{ ConfirmNumber string }
	if !decode(w, r, &p) {
		return
	}
	// Match QR redemption and all password changes: QR lock before DB lock.
	s.qrLogins.Lock()
	qrLocked := true
	defer func() {
		if qrLocked {
			s.qrLogins.Unlock()
		}
	}()
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
	var number string
	if tx.QueryRow("SELECT number FROM user_numbers WHERE user_id=? AND NOT EXISTS(SELECT 1 FROM deleted_accounts WHERE user_id=?)", target, target).Scan(&number) != nil {
		fail(w, 404, "账号不存在")
		return
	}
	if p.ConfirmNumber != number {
		fail(w, 400, "请输入被删除账号的 LinkMe 号码确认")
		return
	}
	keys := map[string]bool{}
	rows, err := tx.Query("SELECT token FROM sessions WHERE user_id=?", target)
	if err != nil {
		s.dbError(w, err)
		return
	}
	for rows.Next() {
		var key string
		if rows.Scan(&key) == nil {
			keys[key] = true
		}
	}
	rows.Close()
	remoteIDs := []string{}
	rows, err = tx.Query("SELECT id FROM remotes WHERE state IN ('pending','accepted') AND (requester=? OR recipient=?)", target, target)
	if err != nil {
		s.dbError(w, err)
		return
	}
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			remoteIDs = append(remoteIDs, id)
		}
	}
	rows.Close()
	// Preserve conversations and their messages. Transfer owned groups to a live
	// member, or dissolve an empty group; the deleted profile becomes a tombstone.
	rows, err = tx.Query("SELECT id FROM conversations WHERE kind='group' AND owner=?", target)
	if err != nil {
		s.dbError(w, err)
		return
	}
	groups := []string{}
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			groups = append(groups, id)
		}
	}
	rows.Close()
	for _, id := range groups {
		var successor string
		e := tx.QueryRow("SELECT m.user_id FROM members m JOIN users u ON u.id=m.user_id WHERE m.conversation_id=? AND m.user_id<>? AND NOT EXISTS(SELECT 1 FROM deleted_accounts d WHERE d.user_id=m.user_id) ORDER BY u.created,u.id LIMIT 1", id, target).Scan(&successor)
		if e == nil {
			_, err = tx.Exec("UPDATE conversations SET owner=? WHERE id=?", successor, id)
		} else if e == sql.ErrNoRows {
			_, err = tx.Exec("UPDATE group_profiles SET dissolved=1 WHERE conversation_id=?", id)
		} else {
			err = e
		}
		if err != nil {
			s.dbError(w, err)
			return
		}
	}
	statements := []struct {
		sql  string
		args []any
	}{
		{"DELETE FROM sessions WHERE user_id=?", []any{target}},
		{"DELETE FROM drive_files WHERE owner=?", []any{target}},
		{"DELETE FROM drive_folders WHERE owner=?", []any{target}},
		{"DELETE FROM user_profile_details WHERE user_id=?", []any{target}},
		{"DELETE FROM space_documents WHERE owner=?", []any{target}},
		{"DELETE FROM space_profiles WHERE owner=?", []any{target}},
		{"DELETE FROM space_readers WHERE owner=? OR reader=?", []any{target, target}},
		{"DELETE FROM friends WHERE user_id=? OR peer_id=?", []any{target, target}},
		{"DELETE FROM message_blocks WHERE user_id=? OR peer_id=?", []any{target, target}},
		{"DELETE FROM avatar_images WHERE scope=?", []any{"user:" + target}},
		{"DELETE FROM favorites WHERE user_id=?", []any{target}},
		{"DELETE FROM group_members WHERE user_id=?", []any{target}},
		{"DELETE FROM members WHERE user_id=? AND conversation_id IN (SELECT id FROM conversations WHERE kind='group')", []any{target}},
		{"UPDATE remotes SET state='ended',updated=? WHERE requester=? OR recipient=?", []any{now(), target, target}},
		{"UPDATE requests SET status='cancelled' WHERE sender=? OR recipient=?", []any{target, target}},
		{"UPDATE users SET name='已注销用户',account=?,password=X'',bio='',avatar='gray' WHERE id=?", []any{"deleted_" + target[:16], target}},
		{"INSERT INTO deleted_accounts VALUES(?,?,?)", []any{target, uid(r), now()}},
		{"INSERT INTO admin_audit VALUES(?,?,?,?,?)", []any{newID(), uid(r), target, "delete-account", now()}},
	}
	for _, statement := range statements {
		if _, err = tx.Exec(statement.sql, statement.args...); err != nil {
			s.dbError(w, err)
			return
		}
	}
	if err = tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	s.forgetQRApprovals(keys, target)
	s.qrLogins.Unlock()
	qrLocked = false
	s.disconnectSessions(keys)
	for _, id := range remoteIDs {
		s.closeRoom(id)
	}
	s.meetings.Lock()
	for code, room := range s.meetings.rooms {
		if room.Owner == target {
			s.finishMeetingLocked(code, "账号已注销")
		}
	}
	s.meetings.Unlock()
	s.cleanStorage()
	s.directoryChanged()
	ok(w, map[string]bool{"ok": true})
}
