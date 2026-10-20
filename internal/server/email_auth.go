package server

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"welink/internal/emailaddress"
	"welink/internal/emailauth"
)

type EmailAuthSettings struct {
	Enabled         bool   `json:"enabled"`
	CredentialsFile string `json:"credentials_file"`
}
type emailSender interface {
	SendOTP(context.Context, string, string) error
}

const emailSchema = `
CREATE TABLE IF NOT EXISTS user_emails(user_id TEXT PRIMARY KEY REFERENCES users(id),email TEXT UNIQUE NOT NULL,verified INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS email_challenges(id TEXT PRIMARY KEY,email TEXT NOT NULL,purpose TEXT NOT NULL,code_hash BLOB NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,ready INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS email_challenge_limit ON email_challenges(email,created);
`

func (s *Server) initEmail(sender emailSender) error {
	if !s.settings.EmailAuth.Enabled {
		return nil
	}
	if sender != nil {
		s.emailSender = sender
		return nil
	}
	c, err := emailauth.LoadConfig(s.settings.EmailAuth.CredentialsFile)
	if err != nil {
		return err
	}
	p, err := emailauth.New(c)
	if err != nil {
		return err
	}
	if !p.Enabled() {
		return errors.New("email authentication requires an enabled Tencent SES configuration")
	}
	s.emailSender = p
	return nil
}

type emailInput struct{ Email, Password, Name, Avatar, ChallengeID, Code string }

func (s *Server) emailAvailable(w http.ResponseWriter) bool {
	if !s.settings.EmailAuth.Enabled || s.emailSender == nil {
		fail(w, 503, "邮箱验证暂不可用，请联系管理员")
		return false
	}
	return true
}
func normalizeEmail(w http.ResponseWriter, value string) (string, bool) {
	email, err := emailaddress.Normalize(value)
	if err != nil {
		fail(w, 400, "请填写有效的邮箱地址")
		return "", false
	}
	return email, true
}
func (s *Server) emailCode(w http.ResponseWriter, r *http.Request) {
	if !s.emailAvailable(w) {
		return
	}
	if !s.rate(r, "email-code", 12, time.Hour) {
		fail(w, 429, "验证码请求过于频繁，请稍后再试")
		return
	}
	var p struct{ Email, Purpose string }
	if !decode(w, r, &p) {
		return
	}
	email, valid := normalizeEmail(w, p.Email)
	if !valid {
		return
	}
	if p.Purpose != "register" && p.Purpose != "reset" && p.Purpose != "admin-register" {
		fail(w, 400, "验证码用途无效")
		return
	}
	if p.Purpose == "admin-register" {
		actor, _ := r.Context().Value(userKey{}).(string)
		if actor == "" || !s.isAdmin(actor) {
			fail(w, 403, "仅管理员可执行此操作")
			return
		}
	}
	if p.Purpose == "register" && !s.settings.Registration.Enabled {
		fail(w, 403, "暂未开放自助注册，请联系管理员")
		return
	}
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		s.dbError(w, err)
		return
	}
	code := fmt.Sprintf("%06d", n.Int64())
	hash, err := bcrypt.GenerateFromPassword([]byte(code), 10)
	if err != nil {
		s.dbError(w, err)
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	_, err = tx.Exec("DELETE FROM email_challenges WHERE created<?", now()-86400000)
	if err != nil {
		s.dbError(w, err)
		return
	}
	var recent, hourly, total int
	err = tx.QueryRow("SELECT COALESCE(SUM(created>?),0),COUNT(*) FROM email_challenges WHERE email=? AND created>?", now()-60000, email, now()-3600000).Scan(&recent, &hourly)
	if err == nil {
		err = tx.QueryRow("SELECT COUNT(*) FROM email_challenges WHERE created>?", now()-3600000).Scan(&total)
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	if recent > 0 || hourly >= 6 || total >= 120 {
		w.Header().Set("Retry-After", "60")
		fail(w, 429, "请稍后再获取验证码")
		return
	}
	id := newID()
	created := now()
	_, err = tx.Exec("INSERT INTO email_challenges(id,email,purpose,code_hash,created,expires) VALUES(?,?,?,?,?,?)", id, email, p.Purpose, hash, created, created+300000)
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	// Keep unknown-email password recovery indistinguishable at the API boundary.
	deliver := true
	if p.Purpose == "reset" {
		var count int
		err = s.db.QueryRow("SELECT COUNT(*) FROM user_emails e WHERE email=? AND NOT EXISTS(SELECT 1 FROM deleted_accounts d WHERE d.user_id=e.user_id)", email).Scan(&count)
		if err != nil {
			s.dbError(w, err)
			return
		}
		deliver = count > 0
	}
	if deliver {
		if err = s.emailSender.SendOTP(r.Context(), email, code); err != nil {
			s.logger.Print("email provider could not deliver verification code")
			fail(w, 503, "验证码发送失败，请稍后重试")
			return
		}
		_, err = s.db.Exec("UPDATE email_challenges SET ready=1 WHERE id=?", id)
		if err != nil {
			s.dbError(w, err)
			return
		}
	}
	ok(w, map[string]any{"challengeId": id, "retryAfter": 60, "expiresIn": 300})
}

var errEmailCode = errors.New("验证码错误或已过期，请重新获取")

// Failed attempts commit their counter; successful consumption belongs to the
// same transaction as account creation/reset, so a code can succeed only once.
func verifyEmailCode(tx *sql.Tx, p emailInput, purpose string) error {
	var hash []byte
	var expires int64
	var attempts, ready int
	err := tx.QueryRow("SELECT code_hash,expires,attempts,ready FROM email_challenges WHERE id=? AND email=? AND purpose=?", p.ChallengeID, p.Email, purpose).Scan(&hash, &expires, &attempts, &ready)
	if errors.Is(err, sql.ErrNoRows) {
		return errEmailCode
	}
	if err != nil {
		return err
	}
	if expires <= now() || attempts >= 6 || ready != 1 {
		return errEmailCode
	}
	if len(p.Code) != 6 || strings.Trim(p.Code, "0123456789") != "" || bcrypt.CompareHashAndPassword(hash, []byte(p.Code)) != nil {
		if _, err = tx.Exec("UPDATE email_challenges SET attempts=attempts+1 WHERE id=?", p.ChallengeID); err != nil {
			return err
		}
		if err = tx.Commit(); err != nil {
			return err
		}
		return errEmailCode
	}
	_, err = tx.Exec("UPDATE email_challenges SET ready=0 WHERE id=?", p.ChallengeID)
	return err
}
func (s *Server) emailRegister(w http.ResponseWriter, r *http.Request) {
	s.createEmailUser(w, r, false)
}
func (s *Server) createEmailUser(w http.ResponseWriter, r *http.Request, admin bool) {
	if admin && !s.adminOnly(w, r) {
		return
	}
	if !admin && !s.settings.Registration.Enabled {
		fail(w, 403, "暂未开放自助注册，请联系管理员")
		return
	}
	if !s.emailAvailable(w) {
		return
	}
	if !s.rate(r, "register", 12, time.Hour) {
		fail(w, 429, "注册过于频繁，请稍后再试")
		return
	}
	var p emailInput
	if !decode(w, r, &p) {
		return
	}
	var valid bool
	p.Email, valid = normalizeEmail(w, p.Email)
	if !valid {
		return
	}
	generated := admin && p.Password == ""
	if generated {
		var err error
		p.Password, err = temporaryPassword()
		if err != nil {
			s.dbError(w, err)
			return
		}
	}
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" || !validText(p.Name, 32) || len(p.Password) < 8 || len(p.Password) > 72 {
		fail(w, 400, "姓名 1–32 字，密码 8–72 字节")
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
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	purpose := "register"
	if admin {
		purpose = "admin-register"
		if err = adminSession(tx, r); err != nil {
			s.dbError(w, err)
			return
		}
	}
	if err = verifyEmailCode(tx, p, purpose); err != nil {
		s.emailError(w, err)
		return
	}
	var count int
	if err = tx.QueryRow("SELECT COUNT(*) FROM user_emails WHERE email=?", p.Email).Scan(&count); err != nil {
		s.dbError(w, err)
		return
	}
	if count > 0 {
		fail(w, 409, "此邮箱已注册，请登录或找回密码")
		return
	}
	id := newID()
	if p.Avatar == "" {
		p.Avatar = defaultCartoonAvatar(id)
	}
	_, err = tx.Exec("INSERT INTO users(id,account,name,password,avatar,created) VALUES(?,?,?,?,?,?)", id, "wl_"+newID()[:20], p.Name, hash, p.Avatar, now())
	if err == nil {
		err = assignNumber(tx, id)
	}
	if err == nil {
		_, err = tx.Exec("INSERT INTO user_emails VALUES(?,?,?)", id, p.Email, now())
	}
	if err == nil {
		if admin {
			_, err = tx.Exec("INSERT INTO admin_audit VALUES(?,?,?,?,?)", newID(), uid(r), id, "create-account", now())
		}
		if err == nil {
			err = tx.Commit()
		}
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	if admin {
		u, _ := s.user(id)
		u.Email = p.Email
		result := map[string]any{"user": u}
		if generated {
			result["initialPassword"] = p.Password
		}
		ok(w, result)
	} else {
		s.issueSession(w, r, id)
	}
	s.directoryChanged()
}
func (s *Server) emailError(w http.ResponseWriter, err error) {
	if errors.Is(err, errEmailCode) {
		fail(w, 400, err.Error())
	} else {
		s.dbError(w, err)
	}
}
func (s *Server) emailLogin(w http.ResponseWriter, r *http.Request) {
	if !s.rate(r, "login", 30, time.Minute) {
		fail(w, 429, "尝试次数过多，请稍后再试")
		return
	}
	var p emailInput
	if !decode(w, r, &p) {
		return
	}
	email, err := emailaddress.Normalize(p.Email)
	var id string
	var hash []byte
	if err == nil {
		err = s.db.QueryRow("SELECT u.id,u.password FROM users u JOIN user_emails e ON e.user_id=u.id WHERE e.email=? AND NOT EXISTS(SELECT 1 FROM deleted_accounts d WHERE d.user_id=u.id)", email).Scan(&id, &hash)
	}
	if err != nil || !storedPasswordMatches(hash, p.Password) {
		fail(w, 401, "邮箱或密码不正确")
		return
	}
	s.issueSession(w, r, id, hash)
}
func (s *Server) emailReset(w http.ResponseWriter, r *http.Request) {
	if !s.emailAvailable(w) {
		return
	}
	if !s.rate(r, "email-reset", 20, time.Hour) {
		fail(w, 429, "尝试次数过多，请稍后再试")
		return
	}
	var p emailInput
	if !decode(w, r, &p) {
		return
	}
	var valid bool
	p.Email, valid = normalizeEmail(w, p.Email)
	if !valid {
		return
	}
	if len(p.Password) < 8 || len(p.Password) > 72 {
		fail(w, 400, "密码需要 8–72 字节")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(p.Password), 12)
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.qrLogins.Lock()
	defer s.qrLogins.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	if err = verifyEmailCode(tx, p, "reset"); err != nil {
		s.emailError(w, err)
		return
	}
	var user string
	err = tx.QueryRow("SELECT user_id FROM user_emails e WHERE email=? AND NOT EXISTS(SELECT 1 FROM deleted_accounts d WHERE d.user_id=e.user_id)", p.Email).Scan(&user)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 400, errEmailCode.Error())
		return
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	keys, err := sessionKeys(tx, user, "", "", "")
	if err == nil {
		_, err = tx.Exec("UPDATE users SET password=? WHERE id=?", hash, user)
	}
	if err == nil {
		err = deleteSessions(tx, keys)
	}
	if err == nil {
		_, err = tx.Exec("UPDATE email_challenges SET ready=0 WHERE email=? AND purpose='reset'", p.Email)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.forgetQRApprovals(keys, user)
	s.disconnectSessions(keys)
	ok(w, map[string]bool{"ok": true})
}
