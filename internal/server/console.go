package server

import (
	"context"
	"crypto/rand"
	"database/sql"
	"embed"
	"encoding/base64"
	"errors"
	"io/fs"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// The management console is a separate web application on its own listener
// (settings.console.listen) with its own administrator accounts. App users,
// whatever their role, cannot reach it; all user administration happens here.

//go:embed console
var consoleFiles embed.FS

const consoleSchema = `
CREATE TABLE IF NOT EXISTS console_admins(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL COLLATE NOCASE,password BLOB NOT NULL,created INTEGER NOT NULL,last_login INTEGER NOT NULL DEFAULT 0,disabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS console_sessions(token TEXT PRIMARY KEY,admin_id TEXT NOT NULL REFERENCES console_admins(id) ON DELETE CASCADE,created INTEGER NOT NULL,expires INTEGER NOT NULL,ip TEXT NOT NULL DEFAULT '',agent TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS console_audit(id TEXT PRIMARY KEY,admin_id TEXT NOT NULL,username TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL DEFAULT '',detail TEXT NOT NULL DEFAULT '',ip TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS console_audit_created ON console_audit(created);
CREATE TABLE IF NOT EXISTS user_status(user_id TEXT PRIMARY KEY REFERENCES users(id),disabled INTEGER NOT NULL DEFAULT 0,reason TEXT NOT NULL DEFAULT '',updated INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS disabled_session BEFORE INSERT ON sessions WHEN EXISTS(SELECT 1 FROM user_status WHERE user_id=NEW.user_id AND disabled=1) BEGIN SELECT RAISE(ABORT,'account_disabled'); END;
`

const (
	consoleCookie      = "linkme_console"
	consoleSessionLife = 12 * time.Hour
	consoleHeader      = "X-LinkMe-Console"
)

var consoleUsername = regexp.MustCompile(`^[a-zA-Z0-9_.-]{3,32}$`)

type consoleAdminKey struct{}

// consolePrefixKey carries the path the console is mounted under ("" on its
// own listener, "/admin" on the public site) so the session cookie is scoped to it.
type consolePrefixKey struct{}

func consoleCookiePath(r *http.Request) string {
	prefix, _ := r.Context().Value(consolePrefixKey{}).(string)
	return prefix + "/"
}

type consoleActor struct{ ID, Username, IP string }

func validConsolePassword(p string) error {
	if len(p) < 10 || len(p) > 72 {
		return errors.New("后台密码需要 10–72 字节")
	}
	return nil
}

// SetConsoleAdmin creates a console administrator or resets the password of
// an existing one. It is used by the installers and for account recovery
// (`-console-admin NAME -console-password-file FILE`), so it works on a
// stopped server directly against the database.
func SetConsoleAdmin(settings Settings, username, password string) (created bool, err error) {
	username = strings.TrimSpace(username)
	if !consoleUsername.MatchString(username) {
		return false, errors.New("后台用户名需要 3–32 位字母、数字或 _ . -")
	}
	if err = validConsolePassword(password); err != nil {
		return false, err
	}
	db, err := openStore(settings.DataDir)
	if err != nil {
		return false, err
	}
	defer db.Close()
	if _, err = db.Exec(consoleSchema); err != nil {
		return false, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return false, err
	}
	tx, err := db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	var id string
	switch e := tx.QueryRow("SELECT id FROM console_admins WHERE username=?", username).Scan(&id); e {
	case nil:
		if _, err = tx.Exec("UPDATE console_admins SET password=?,disabled=0 WHERE id=?", hash, id); err == nil {
			_, err = tx.Exec("DELETE FROM console_sessions WHERE admin_id=?", id)
		}
	case sql.ErrNoRows:
		id, created = newID(), true
		_, err = tx.Exec("INSERT INTO console_admins(id,username,password,created) VALUES(?,?,?,?)", id, username, hash, now())
	default:
		err = e
	}
	if err == nil {
		action := "cli-reset-password"
		if created {
			action = "cli-create-admin"
		}
		_, err = tx.Exec("INSERT INTO console_audit(id,admin_id,username,action,target,created) VALUES(?,?,?,?,?,?)", newID(), id, username, action, id, now())
	}
	if err != nil {
		return false, err
	}
	return created, tx.Commit()
}

// RestartRequested is closed when a console administrator asks for a
// restart; main shuts down and exits so the service manager starts it again.
func (s *Server) RestartRequested() <-chan struct{} { return s.restart }

// ConsoleHandler serves the console web app and its API on its own listener.
func (s *Server) ConsoleHandler() http.Handler { return s.consoleHandler("") }

// consoleHandler serves the console mounted under prefix (requests arrive with
// the prefix already stripped).
func (s *Server) consoleHandler(prefix string) http.Handler {
	mux := http.NewServeMux()
	assets, _ := fs.Sub(consoleFiles, "console")
	static := http.FileServer(http.FS(assets))
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && !strings.HasPrefix(r.URL.Path, "/assets/") {
			http.NotFound(w, r)
			return
		}
		if r.URL.Path == "/" {
			// FileServer would redirect /index.html back to /; serve it directly.
			page, err := consoleFiles.ReadFile("console/index.html")
			if err != nil {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write(page)
			return
		}
		r.URL.Path = strings.TrimPrefix(r.URL.Path, "/assets")
		static.ServeHTTP(w, r)
	})
	mux.HandleFunc("POST /api/login", s.consoleLogin)
	for pattern, h := range map[string]func(http.ResponseWriter, *http.Request, consoleActor){
		"POST /api/logout": s.consoleLogout, "GET /api/me": s.consoleMe, "POST /api/me/password": s.consoleChangePassword,
		"GET /api/overview": s.consoleOverview, "GET /api/audit": s.consoleAudit,
		"GET /api/admins": s.consoleAdmins, "POST /api/admins": s.consoleCreateAdmin, "PATCH /api/admins/{id}": s.consoleUpdateAdmin, "DELETE /api/admins/{id}": s.consoleDeleteAdmin,
		"GET /api/users": s.consoleUsers, "POST /api/users": s.consoleCreateUser, "GET /api/users/{id}": s.consoleUser, "PATCH /api/users/{id}": s.consoleUpdateUser,
		"POST /api/users/{id}/password": s.consoleResetPassword, "POST /api/users/{id}/status": s.consoleSetUserStatus,
		"POST /api/users/{id}/signout": s.consoleSignOutUser, "DELETE /api/users/{id}/sessions/{session}": s.consoleRevokeSession,
		"DELETE /api/users/{id}/avatar": s.consoleResetAvatar, "DELETE /api/users/{id}": s.consoleDeleteUser,
		"GET /api/settings": s.consoleSettings, "PUT /api/settings": s.consoleSaveSettings,
		"GET /api/files": s.consoleConfigFiles, "PUT /api/files/{kind}": s.consoleSaveConfigFile,
		"GET /api/downloads": s.consoleDownloads, "PUT /api/downloads/{name}": s.consoleUploadDownload, "DELETE /api/downloads/{name}": s.consoleDeleteDownload,
		"POST /api/restart": s.consoleRestart,
	} {
		mux.Handle(pattern, s.consoleAuth(h))
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Cache-Control", "no-store")
		h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		defer func() {
			if e := recover(); e != nil {
				s.logger.Printf("console panic: %v", e)
				fail(w, 500, "服务暂时不可用")
			}
		}()
		// Every state-changing request must carry the console header, which
		// a cross-site form cannot set; the cookie is also SameSite=Strict.
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Header.Get(consoleHeader) != "1" {
			fail(w, 403, "请求来源无效")
			return
		}
		mux.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), consolePrefixKey{}, prefix)))
	})
}

func remoteIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *Server) consoleAuth(next func(http.ResponseWriter, *http.Request, consoleActor)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(consoleCookie)
		if err != nil || c.Value == "" {
			fail(w, 401, "请先登录管理后台")
			return
		}
		var a consoleActor
		err = s.db.QueryRow("SELECT a.id,a.username FROM console_sessions s JOIN console_admins a ON a.id=s.admin_id WHERE s.token=? AND s.expires>? AND a.disabled=0", hashToken(c.Value), now()).Scan(&a.ID, &a.Username)
		if err != nil {
			if err != sql.ErrNoRows {
				s.logger.Printf("console session: %v", err)
			}
			fail(w, 401, "登录已过期，请重新登录")
			return
		}
		a.IP = remoteIP(r)
		next(w, r, a)
	})
}

func (s *Server) consoleAudit(w http.ResponseWriter, r *http.Request, _ consoleActor) {
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	if before <= 0 {
		before = now() + 1
	}
	rows, err := s.db.Query("SELECT id,username,action,target,detail,ip,created FROM console_audit WHERE created<? ORDER BY created DESC LIMIT 100", before)
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer rows.Close()
	type entry struct {
		ID       string `json:"id"`
		Username string `json:"username"`
		Action   string `json:"action"`
		Target   string `json:"target"`
		Detail   string `json:"detail"`
		IP       string `json:"ip"`
		Created  int64  `json:"created"`
		Name     string `json:"targetName,omitempty"`
	}
	out := []entry{}
	for rows.Next() {
		var e entry
		if err = rows.Scan(&e.ID, &e.Username, &e.Action, &e.Target, &e.Detail, &e.IP, &e.Created); err != nil {
			s.dbError(w, err)
			return
		}
		out = append(out, e)
	}
	rows.Close()
	for i := range out {
		_ = s.db.QueryRow("SELECT name FROM users WHERE id=?", out[i].Target).Scan(&out[i].Name)
	}
	ok(w, out)
}

// audit records a console action inside the caller's transaction (or
// directly when tx is nil).
func (s *Server) audit(tx *sql.Tx, a consoleActor, action, target, detail string) error {
	q := "INSERT INTO console_audit(id,admin_id,username,action,target,detail,ip,created) VALUES(?,?,?,?,?,?,?,?)"
	args := []any{newID(), a.ID, a.Username, action, target, detail, a.IP, now()}
	if tx != nil {
		_, err := tx.Exec(q, args...)
		return err
	}
	_, err := s.db.Exec(q, args...)
	return err
}

func (s *Server) consoleLogin(w http.ResponseWriter, r *http.Request) {
	var p struct{ Username, Password string }
	if !decode(w, r, &p) {
		return
	}
	p.Username = strings.TrimSpace(p.Username)
	if !s.rate(r, "console-login", 10, 15*time.Minute) || !s.rate(r, "console-login:"+strings.ToLower(p.Username), 5, 15*time.Minute) {
		fail(w, 429, "登录尝试过多，请 15 分钟后再试")
		return
	}
	var id, username string
	var hash []byte
	var disabled bool
	err := s.db.QueryRow("SELECT id,username,password,disabled FROM console_admins WHERE username=?", p.Username).Scan(&id, &username, &hash, &disabled)
	if err != nil && err != sql.ErrNoRows {
		s.dbError(w, err)
		return
	}
	if err == sql.ErrNoRows {
		// Spend the same time as a real check so usernames cannot be probed.
		_ = bcrypt.CompareHashAndPassword(consoleDummyHash(), []byte(p.Password))
		fail(w, 401, "用户名或密码不正确")
		return
	}
	if bcrypt.CompareHashAndPassword(hash, []byte(p.Password)) != nil {
		fail(w, 401, "用户名或密码不正确")
		return
	}
	if disabled {
		fail(w, 403, "此后台账号已停用")
		return
	}
	var raw [32]byte
	if _, err = rand.Read(raw[:]); err != nil {
		s.dbError(w, err)
		return
	}
	token := base64.RawURLEncoding.EncodeToString(raw[:])
	agent := r.UserAgent()
	if len(agent) > 200 {
		agent = agent[:200]
	}
	a := consoleActor{ID: id, Username: username, IP: remoteIP(r)}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	if _, err = tx.Exec("DELETE FROM console_sessions WHERE expires<?", now()); err == nil {
		if _, err = tx.Exec("INSERT INTO console_sessions(token,admin_id,created,expires,ip,agent) VALUES(?,?,?,?,?,?)", hashToken(token), id, now(), time.Now().Add(consoleSessionLife).UnixMilli(), a.IP, agent); err == nil {
			if _, err = tx.Exec("UPDATE console_admins SET last_login=? WHERE id=?", now(), id); err == nil {
				err = s.audit(tx, a, "login", id, "")
			}
		}
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: consoleCookie, Value: token, Path: consoleCookiePath(r), HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: r.TLS != nil, MaxAge: int(consoleSessionLife / time.Second)})
	ok(w, map[string]any{"id": id, "username": username})
}

func (s *Server) consoleLogout(w http.ResponseWriter, r *http.Request, a consoleActor) {
	if c, err := r.Cookie(consoleCookie); err == nil {
		_, _ = s.db.Exec("DELETE FROM console_sessions WHERE token=?", hashToken(c.Value))
	}
	_ = s.audit(nil, a, "logout", a.ID, "")
	http.SetCookie(w, &http.Cookie{Name: consoleCookie, Value: "", Path: consoleCookiePath(r), HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	ok(w, map[string]bool{"ok": true})
}

func (s *Server) consoleMe(w http.ResponseWriter, r *http.Request, a consoleActor) {
	ok(w, map[string]any{"id": a.ID, "username": a.Username, "version": "0.1.18", "supervised": s.supervised})
}

func (s *Server) consoleChangePassword(w http.ResponseWriter, r *http.Request, a consoleActor) {
	var p struct{ Current, Password string }
	if !decode(w, r, &p) {
		return
	}
	if !s.rate(r, "console-password", 10, 15*time.Minute) {
		fail(w, 429, "操作过于频繁，请稍后再试")
		return
	}
	var hash []byte
	if err := s.db.QueryRow("SELECT password FROM console_admins WHERE id=?", a.ID).Scan(&hash); err != nil {
		s.dbError(w, err)
		return
	}
	if bcrypt.CompareHashAndPassword(hash, []byte(p.Current)) != nil {
		fail(w, 400, "当前密码不正确")
		return
	}
	s.setConsolePassword(w, r, a, a.ID, p.Password, "change-own-password")
}

func (s *Server) setConsolePassword(w http.ResponseWriter, r *http.Request, a consoleActor, target, password, action string) {
	if err := validConsolePassword(password); err != nil {
		fail(w, 400, err.Error())
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
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
	res, err := tx.Exec("UPDATE console_admins SET password=? WHERE id=?", hash, target)
	if err != nil {
		s.dbError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n != 1 {
		fail(w, 404, "后台账号不存在")
		return
	}
	// Sign out every other console session of that administrator.
	current := ""
	if c, e := r.Cookie(consoleCookie); e == nil {
		current = hashToken(c.Value)
	}
	if _, err = tx.Exec("DELETE FROM console_sessions WHERE admin_id=? AND token<>?", target, current); err == nil {
		err = s.audit(tx, a, action, target, "")
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, map[string]bool{"ok": true})
}

type consoleAdminView struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	Created   int64  `json:"created"`
	LastLogin int64  `json:"lastLogin"`
	Disabled  bool   `json:"disabled"`
	Self      bool   `json:"self"`
}

func (s *Server) consoleAdmins(w http.ResponseWriter, r *http.Request, a consoleActor) {
	rows, err := s.db.Query("SELECT id,username,created,last_login,disabled FROM console_admins ORDER BY created")
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer rows.Close()
	out := []consoleAdminView{}
	for rows.Next() {
		var v consoleAdminView
		if err = rows.Scan(&v.ID, &v.Username, &v.Created, &v.LastLogin, &v.Disabled); err != nil {
			s.dbError(w, err)
			return
		}
		v.Self = v.ID == a.ID
		out = append(out, v)
	}
	ok(w, out)
}

func (s *Server) consoleCreateAdmin(w http.ResponseWriter, r *http.Request, a consoleActor) {
	var p struct{ Username, Password string }
	if !decode(w, r, &p) {
		return
	}
	p.Username = strings.TrimSpace(p.Username)
	if !consoleUsername.MatchString(p.Username) {
		fail(w, 400, "用户名需要 3–32 位字母、数字或 _ . -")
		return
	}
	if err := validConsolePassword(p.Password); err != nil {
		fail(w, 400, err.Error())
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(p.Password), 12)
	if err != nil {
		s.dbError(w, err)
		return
	}
	id := newID()
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	if _, err = tx.Exec("INSERT INTO console_admins(id,username,password,created) VALUES(?,?,?,?)", id, p.Username, hash, now()); err != nil {
		fail(w, 409, "该用户名已存在")
		return
	}
	if err = s.audit(tx, a, "create-admin", id, p.Username); err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, consoleAdminView{ID: id, Username: p.Username, Created: now()})
}

func (s *Server) consoleUpdateAdmin(w http.ResponseWriter, r *http.Request, a consoleActor) {
	target := r.PathValue("id")
	var p struct {
		Disabled *bool   `json:"disabled"`
		Password *string `json:"password"`
	}
	if !decode(w, r, &p) {
		return
	}
	if p.Password != nil {
		s.setConsolePassword(w, r, a, target, *p.Password, "reset-admin-password")
		return
	}
	if p.Disabled == nil {
		fail(w, 400, "没有需要修改的内容")
		return
	}
	if target == a.ID {
		fail(w, 409, "不能停用自己的后台账号")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	if *p.Disabled {
		var active int
		if err = tx.QueryRow("SELECT COUNT(*) FROM console_admins WHERE disabled=0 AND id<>?", target).Scan(&active); err != nil {
			s.dbError(w, err)
			return
		}
		if active == 0 {
			fail(w, 409, "至少需要保留一个可用的后台管理员")
			return
		}
	}
	res, err := tx.Exec("UPDATE console_admins SET disabled=? WHERE id=?", *p.Disabled, target)
	if err != nil {
		s.dbError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n != 1 {
		fail(w, 404, "后台账号不存在")
		return
	}
	action := "enable-admin"
	if *p.Disabled {
		action = "disable-admin"
		_, err = tx.Exec("DELETE FROM console_sessions WHERE admin_id=?", target)
	}
	if err == nil {
		err = s.audit(tx, a, action, target, "")
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, map[string]bool{"ok": true})
}

func (s *Server) consoleDeleteAdmin(w http.ResponseWriter, r *http.Request, a consoleActor) {
	target := r.PathValue("id")
	if target == a.ID {
		fail(w, 409, "不能删除自己的后台账号")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	var active int
	if err = tx.QueryRow("SELECT COUNT(*) FROM console_admins WHERE disabled=0 AND id<>?", target).Scan(&active); err != nil {
		s.dbError(w, err)
		return
	}
	if active == 0 {
		fail(w, 409, "至少需要保留一个可用的后台管理员")
		return
	}
	var username string
	if tx.QueryRow("SELECT username FROM console_admins WHERE id=?", target).Scan(&username) != nil {
		fail(w, 404, "后台账号不存在")
		return
	}
	if _, err = tx.Exec("DELETE FROM console_sessions WHERE admin_id=?", target); err == nil {
		if _, err = tx.Exec("DELETE FROM console_admins WHERE id=?", target); err == nil {
			err = s.audit(tx, a, "delete-admin", target, username)
		}
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, map[string]bool{"ok": true})
}

// consoleURL is the website path of the console, or "" when it is not public.
func (s *Server) consoleURL() string {
	if s.settings.Console.Enabled && s.settings.Console.Public {
		return "/admin/"
	}
	return ""
}
