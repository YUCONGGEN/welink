package server

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"golang.org/x/crypto/bcrypt"
	"welink/internal/emailaddress"
)

// User administration for the management console: everything about an
// account (profile, email, password, status, devices, deletion) is managed
// here. The apps no longer have any administrator features.

type consoleUserRow struct {
	ID        string `json:"id"`
	Number    string `json:"number"`
	Name      string `json:"name"`
	Avatar    string `json:"avatar"`
	Email     string `json:"email"`
	Phone     string `json:"phone"`
	JobTitle  string `json:"jobTitle"`
	Created   int64  `json:"created"`
	LastSeen  int64  `json:"lastSeen"`
	Sessions  int    `json:"sessions"`
	Disabled  bool   `json:"disabled"`
	Reason    string `json:"reason,omitempty"`
	Online    bool   `json:"online"`
	AI        bool   `json:"ai,omitempty"`
	DriveUsed int64  `json:"driveUsed"`
}

const consoleUserSelect = `SELECT u.id,CAST(n.number AS TEXT),u.name,u.avatar,u.created,
 COALESCE(e.email,''),COALESCE(d.phone,''),COALESCE(d.job_title,''),
 COALESCE(st.disabled,0),COALESCE(st.reason,''),
 (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND s.expires>?),
 COALESCE((SELECT MAX(i.last_seen) FROM session_info i JOIN sessions s ON s.token=i.token WHERE s.user_id=u.id),0),
 COALESCE((SELECT SUM(size) FROM drive_files f WHERE f.owner=u.id),0)
FROM users u JOIN user_numbers n ON n.user_id=u.id
LEFT JOIN user_emails e ON e.user_id=u.id
LEFT JOIN user_profile_details d ON d.user_id=u.id
LEFT JOIN user_status st ON st.user_id=u.id
WHERE NOT EXISTS(SELECT 1 FROM deleted_accounts x WHERE x.user_id=u.id)`

func (s *Server) scanConsoleUser(row interface{ Scan(...any) error }) (consoleUserRow, error) {
	var u consoleUserRow
	err := row.Scan(&u.ID, &u.Number, &u.Name, &u.Avatar, &u.Created, &u.Email, &u.Phone, &u.JobTitle, &u.Disabled, &u.Reason, &u.Sessions, &u.LastSeen, &u.DriveUsed)
	if err == nil {
		u.Online = s.online(u.ID)
		u.AI = s.isAI(u.ID)
	}
	return u, err
}

func (s *Server) consoleUsers(w http.ResponseWriter, r *http.Request, _ consoleActor) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if !validText(q, 120) {
		fail(w, 400, "搜索内容过长")
		return
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if offset < 0 {
		offset = 0
	}
	query := consoleUserSelect
	args := []any{now()}
	if q != "" {
		like := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q) + "%"
		query += ` AND (u.name LIKE ? ESCAPE '\' OR CAST(n.number AS TEXT) LIKE ? ESCAPE '\' OR e.email LIKE ? ESCAPE '\' OR d.phone LIKE ? ESCAPE '\' OR d.job_title LIKE ? ESCAPE '\')`
		args = append(args, like, like, like, like, like)
	}
	switch r.URL.Query().Get("status") {
	case "disabled":
		query += " AND COALESCE(st.disabled,0)=1"
	case "active":
		query += " AND COALESCE(st.disabled,0)=0"
	}
	var total int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM ("+query+")", args...).Scan(&total); err != nil {
		s.dbError(w, err)
		return
	}
	rows, err := s.db.Query(query+" ORDER BY n.number LIMIT 50 OFFSET ?", append(args, offset)...)
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer rows.Close()
	items := []consoleUserRow{}
	for rows.Next() {
		u, err := s.scanConsoleUser(rows)
		if err != nil {
			s.dbError(w, err)
			return
		}
		items = append(items, u)
	}
	if err = rows.Err(); err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, map[string]any{"items": items, "total": total, "offset": offset})
}

type consoleDevice struct {
	ID       string `json:"id"`
	Device   string `json:"device"`
	Created  int64  `json:"created"`
	LastSeen int64  `json:"lastSeen"`
	Expires  int64  `json:"expires"`
}

func (s *Server) consoleUserDetail(id string) (map[string]any, error) {
	u, err := s.scanConsoleUser(s.db.QueryRow(consoleUserSelect+" AND u.id=?", now(), id))
	if err != nil {
		return nil, err
	}
	var bio, gender string
	_ = s.db.QueryRow("SELECT bio FROM users WHERE id=?", id).Scan(&bio)
	_ = s.db.QueryRow("SELECT gender FROM user_profile_details WHERE user_id=?", id).Scan(&gender)
	stats := map[string]int64{}
	for key, query := range map[string]string{
		"friends":         "SELECT COUNT(*) FROM friends WHERE user_id=?",
		"groups":          "SELECT COUNT(*) FROM members m JOIN conversations c ON c.id=m.conversation_id WHERE m.user_id=? AND c.kind='group'",
		"ownedGroups":     "SELECT COUNT(*) FROM conversations WHERE kind='group' AND owner=?",
		"messages":        "SELECT COUNT(*) FROM messages WHERE sender=?",
		"driveFiles":      "SELECT COUNT(*) FROM drive_files WHERE owner=?",
		"attachmentBytes": "SELECT COALESCE(SUM(size),0) FROM attachments WHERE owner=?",
	} {
		var n int64
		if e := s.db.QueryRow(query, id).Scan(&n); e == nil {
			stats[key] = n
		}
	}
	rows, err := s.db.Query("SELECT i.id,i.device,i.created,i.last_seen,s.expires FROM sessions s JOIN session_info i ON i.token=s.token WHERE s.user_id=? AND s.expires>? ORDER BY i.last_seen DESC", id, now())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	devices := []consoleDevice{}
	for rows.Next() {
		var d consoleDevice
		if err = rows.Scan(&d.ID, &d.Device, &d.Created, &d.LastSeen, &d.Expires); err != nil {
			return nil, err
		}
		devices = append(devices, d)
	}
	return map[string]any{"user": u, "bio": bio, "gender": gender, "stats": stats, "devices": devices, "driveQuota": s.settings.driveQuota()}, rows.Err()
}

func (s *Server) consoleUser(w http.ResponseWriter, r *http.Request, _ consoleActor) {
	detail, err := s.consoleUserDetail(r.PathValue("id"))
	if err == sql.ErrNoRows {
		fail(w, 404, "账号不存在")
		return
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, detail)
}

type consoleUserInput struct {
	profileDetailsPatch
	Name     *string `json:"name"`
	Bio      *string `json:"bio"`
	Email    *string `json:"email"`
	Password string  `json:"password"`
}

// normalize validates the editable fields; email "" removes the address.
func (p *consoleUserInput) normalize() error {
	if p.Name != nil {
		*p.Name = strings.TrimSpace(*p.Name)
		if *p.Name == "" || !validText(*p.Name, 32) {
			return errors.New("请填写姓名，1–32 字")
		}
	}
	if p.Bio != nil && !validText(*p.Bio, 150) {
		return errors.New("个性签名最多 150 字")
	}
	if !p.profileDetailsPatch.validate() {
		return errors.New("请检查手机号、性别或职位格式")
	}
	if p.Email != nil && strings.TrimSpace(*p.Email) != "" {
		email, err := emailaddress.Normalize(*p.Email)
		if err != nil {
			return errors.New("请填写有效的邮箱地址")
		}
		*p.Email = email
	} else if p.Email != nil {
		*p.Email = ""
	}
	return nil
}

func saveUserEmail(tx *sql.Tx, id, email string) error {
	if email == "" {
		_, err := tx.Exec("DELETE FROM user_emails WHERE user_id=?", id)
		return err
	}
	var owner string
	switch err := tx.QueryRow("SELECT user_id FROM user_emails WHERE email=?", email).Scan(&owner); {
	case err == nil && owner != id:
		return groupFail(409, "此邮箱已被其他账号使用")
	case err != nil && err != sql.ErrNoRows:
		return err
	}
	_, err := tx.Exec("INSERT INTO user_emails(user_id,email,verified) VALUES(?,?,1) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,verified=1", id, email)
	return err
}

func (s *Server) consoleCreateUser(w http.ResponseWriter, r *http.Request, a consoleActor) {
	var p consoleUserInput
	if !decode(w, r, &p) {
		return
	}
	if p.Name == nil {
		fail(w, 400, "请填写姓名")
		return
	}
	if err := p.normalize(); err != nil {
		fail(w, 400, err.Error())
		return
	}
	email := ""
	if p.Email != nil {
		email = *p.Email
	}
	if s.settings.EmailAuth.Enabled && email == "" {
		fail(w, 400, "已启用邮箱登录，请填写员工邮箱")
		return
	}
	generated := p.Password == ""
	if generated {
		var err error
		if p.Password, err = temporaryPassword(); err != nil {
			s.dbError(w, err)
			return
		}
	}
	u, err := createAccountInDB(s.db, *p.Name, "", p.Password, false, func(tx *sql.Tx, user User) error {
		if email != "" {
			if err := saveUserEmail(tx, user.ID, email); err != nil {
				return err
			}
		}
		if p.Bio != nil {
			if _, err := tx.Exec("UPDATE users SET bio=? WHERE id=?", *p.Bio, user.ID); err != nil {
				return err
			}
		}
		if err := p.profileDetailsPatch.save(tx, user.ID); err != nil {
			return err
		}
		return s.audit(tx, a, "create-user", user.ID, user.Name)
	})
	if err != nil {
		var known *groupError
		if errors.As(err, &known) {
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

// liveUser fails the transaction when the account does not exist or was deleted.
func liveUser(tx *sql.Tx, id string) error {
	var exists int
	if tx.QueryRow("SELECT 1 FROM users WHERE id=? AND NOT EXISTS(SELECT 1 FROM deleted_accounts WHERE user_id=?)", id, id).Scan(&exists) != nil {
		return groupFail(404, "账号不存在")
	}
	return nil
}

func (s *Server) consoleUpdateUser(w http.ResponseWriter, r *http.Request, a consoleActor) {
	id := r.PathValue("id")
	var p consoleUserInput
	if !decode(w, r, &p) {
		return
	}
	if err := p.normalize(); err != nil {
		fail(w, 400, err.Error())
		return
	}
	if p.Email != nil && *p.Email == "" && s.settings.EmailAuth.Enabled {
		fail(w, 400, "已启用邮箱登录，邮箱不能为空")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	err = liveUser(tx, id)
	if err == nil {
		_, err = tx.Exec("UPDATE users SET name=COALESCE(?,name),bio=COALESCE(?,bio) WHERE id=?", p.Name, p.Bio, id)
	}
	if err == nil {
		err = p.profileDetailsPatch.save(tx, id)
	}
	if err == nil && p.Email != nil {
		err = saveUserEmail(tx, id, *p.Email)
	}
	if err == nil {
		err = s.audit(tx, a, "update-user", id, "")
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.profileChanged(id)
	s.directoryChanged()
	s.consoleUser(w, r, a)
}

// dropSessions signs a user out everywhere (every session row, with or
// without device details) and closes their live connections.
func (s *Server) dropSessions(tx *sql.Tx, id string) (map[string]bool, error) {
	rows, err := tx.Query("SELECT token FROM sessions WHERE user_id=?", id)
	if err != nil {
		return nil, err
	}
	keys := map[string]bool{}
	for rows.Next() {
		var key string
		if rows.Scan(&key) == nil {
			keys[key] = true
		}
	}
	rows.Close()
	return keys, deleteSessions(tx, keys)
}

// userChange runs fn in a transaction that holds the QR lock (like every
// credential change), then disconnects the sessions fn removed.
func (s *Server) userChange(id string, fn func(tx *sql.Tx) (map[string]bool, error)) error {
	s.qrLogins.Lock()
	tx, err := s.db.Begin()
	if err != nil {
		s.qrLogins.Unlock()
		return err
	}
	defer tx.Rollback()
	keys, err := fn(tx)
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.qrLogins.Unlock()
		return err
	}
	s.forgetQRApprovals(keys, id)
	s.qrLogins.Unlock()
	s.disconnectSessions(keys)
	return nil
}

func (s *Server) consoleResetPassword(w http.ResponseWriter, r *http.Request, a consoleActor) {
	id := r.PathValue("id")
	var p struct{ Password string }
	if !decode(w, r, &p) {
		return
	}
	generated := p.Password == ""
	if generated {
		var err error
		if p.Password, err = temporaryPassword(); err != nil {
			s.dbError(w, err)
			return
		}
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
	signedOut := 0
	err = s.userChange(id, func(tx *sql.Tx) (map[string]bool, error) {
		if err := liveUser(tx, id); err != nil {
			return nil, err
		}
		if _, err := tx.Exec("UPDATE users SET password=? WHERE id=?", hash, id); err != nil {
			return nil, err
		}
		keys, err := s.dropSessions(tx, id)
		if err == nil {
			signedOut = len(keys)
			err = s.audit(tx, a, "reset-password", id, "")
		}
		return keys, err
	})
	if err != nil {
		s.dbError(w, err)
		return
	}
	result := map[string]any{"ok": true, "signedOut": signedOut}
	if generated {
		result["password"] = p.Password
	}
	ok(w, result)
}

func (s *Server) consoleSetUserStatus(w http.ResponseWriter, r *http.Request, a consoleActor) {
	id := r.PathValue("id")
	var p struct {
		Disabled bool   `json:"disabled"`
		Reason   string `json:"reason"`
	}
	if !decode(w, r, &p) {
		return
	}
	p.Reason = strings.TrimSpace(p.Reason)
	if !validText(p.Reason, 120) {
		fail(w, 400, "停用原因最多 120 字")
		return
	}
	if s.isAI(id) {
		fail(w, 409, "Me 助手请在“系统设置 → Me 助手”中停用")
		return
	}
	err := s.userChange(id, func(tx *sql.Tx) (map[string]bool, error) {
		if err := liveUser(tx, id); err != nil {
			return nil, err
		}
		if _, err := tx.Exec("INSERT INTO user_status(user_id,disabled,reason,updated) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET disabled=excluded.disabled,reason=excluded.reason,updated=excluded.updated", id, p.Disabled, p.Reason, now()); err != nil {
			return nil, err
		}
		action, keys := "enable-user", map[string]bool{}
		var err error
		if p.Disabled {
			action = "disable-user"
			keys, err = s.dropSessions(tx, id)
		}
		if err == nil {
			err = s.audit(tx, a, action, id, p.Reason)
		}
		return keys, err
	})
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.directoryChanged()
	s.consoleUser(w, r, a)
}

func (s *Server) consoleSignOutUser(w http.ResponseWriter, r *http.Request, a consoleActor) {
	id := r.PathValue("id")
	count := 0
	err := s.userChange(id, func(tx *sql.Tx) (map[string]bool, error) {
		if err := liveUser(tx, id); err != nil {
			return nil, err
		}
		keys, err := s.dropSessions(tx, id)
		count = len(keys)
		if err == nil {
			err = s.audit(tx, a, "sign-out-user", id, strconv.Itoa(count))
		}
		return keys, err
	})
	if err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, map[string]any{"ok": true, "signedOut": count})
}

func (s *Server) consoleRevokeSession(w http.ResponseWriter, r *http.Request, a consoleActor) {
	id, session := r.PathValue("id"), r.PathValue("session")
	keys, err := s.removeSessions(id, "", session, "")
	if err != nil {
		s.dbError(w, err)
		return
	}
	if len(keys) == 0 {
		fail(w, 404, "登录设备不存在或已退出")
		return
	}
	s.disconnectSessions(keys)
	_ = s.audit(nil, a, "revoke-device", id, session)
	ok(w, map[string]bool{"ok": true})
}

func (s *Server) consoleResetAvatar(w http.ResponseWriter, r *http.Request, a consoleActor) {
	id := r.PathValue("id")
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	err = liveUser(tx, id)
	if err == nil {
		_, err = tx.Exec("UPDATE users SET avatar=? WHERE id=?", defaultCartoonAvatar(id), id)
	}
	if err == nil {
		_, err = tx.Exec("DELETE FROM avatar_images WHERE scope=?", "user:"+id)
	}
	if err == nil {
		err = s.audit(tx, a, "reset-avatar", id, "")
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.profileChanged(id)
	s.directoryChanged()
	s.consoleUser(w, r, a)
}

func (s *Server) consoleDeleteUser(w http.ResponseWriter, r *http.Request, a consoleActor) {
	target := r.PathValue("id")
	if s.isAI(target) {
		fail(w, 409, "Me 助手请在“系统设置 → Me 助手”中停用")
		return
	}
	var p struct{ ConfirmNumber string }
	if !decode(w, r, &p) {
		return
	}
	var remoteIDs []string
	err := s.userChange(target, func(tx *sql.Tx) (map[string]bool, error) {
		var number, name string
		if tx.QueryRow("SELECT CAST(n.number AS TEXT),u.name FROM user_numbers n JOIN users u ON u.id=n.user_id WHERE n.user_id=? AND NOT EXISTS(SELECT 1 FROM deleted_accounts WHERE user_id=?)", target, target).Scan(&number, &name) != nil {
			return nil, groupFail(404, "账号不存在")
		}
		if p.ConfirmNumber != number {
			return nil, groupFail(400, "请输入被删除账号的 LinkMe 号码确认")
		}
		keys, err := s.dropSessions(tx, target)
		if err != nil {
			return nil, err
		}
		remoteIDs, err = deleteAccountData(tx, target)
		if err == nil {
			err = s.audit(tx, a, "delete-user", target, name+" ("+number+")")
		}
		return keys, err
	})
	if err != nil {
		s.dbError(w, err)
		return
	}
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

// deleteAccountData removes a user's private data and leaves a tombstone so
// conversations and messages stay readable for everyone else. Owned groups
// pass to the longest-standing live member, or are dissolved when empty.
// It returns the remote-assistance rooms to close after commit.
func deleteAccountData(tx *sql.Tx, target string) ([]string, error) {
	remoteIDs := []string{}
	rows, err := tx.Query("SELECT id FROM remotes WHERE state IN ('pending','accepted') AND (requester=? OR recipient=?)", target, target)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			remoteIDs = append(remoteIDs, id)
		}
	}
	rows.Close()
	rows, err = tx.Query("SELECT id FROM conversations WHERE kind='group' AND owner=?", target)
	if err != nil {
		return nil, err
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
			return nil, err
		}
	}
	for _, st := range []struct {
		sql  string
		args []any
	}{
		{"DELETE FROM drive_files WHERE owner=?", []any{target}},
		{"DELETE FROM drive_folders WHERE owner=?", []any{target}},
		{"DELETE FROM user_profile_details WHERE user_id=?", []any{target}},
		{"DELETE FROM user_emails WHERE user_id=?", []any{target}},
		{"DELETE FROM user_status WHERE user_id=?", []any{target}},
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
		// deleted_accounts.admin_id references users; console administrators
		// are not users, so the console audit log records who did it.
		{"INSERT INTO deleted_accounts VALUES(?,?,?)", []any{target, target, now()}},
	} {
		if _, err = tx.Exec(st.sql, st.args...); err != nil {
			return nil, err
		}
	}
	return remoteIDs, nil
}

var dummyHashOnce sync.Once
var dummyHash []byte

// consoleDummyHash is compared against for unknown usernames so a failed
// login takes the same time whether or not the account exists.
func consoleDummyHash() []byte {
	dummyHashOnce.Do(func() { dummyHash, _ = bcrypt.GenerateFromPassword([]byte("linkme-console-dummy"), 12) })
	return dummyHash
}
