package server

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/gorilla/websocket"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type Config struct {
	DataDir, DownloadsDir string
	Logger                *log.Logger
	Settings              *Settings
	EmailSender           emailSender
}
type Server struct {
	db                   *sql.DB
	dir, downloads       string
	mux                  *http.ServeMux
	mu                   sync.Mutex
	clients              map[string]map[*socket]bool
	rooms                map[string]map[string]*socket
	limits               map[string]*bucket
	logger               *log.Logger
	meetings             meetingDirectory
	qrLogins             qrLoginDirectory
	avatarSlots          chan struct{}
	callsStop, callsDone chan struct{}
	callsClose           sync.Once
	settings             Settings
	storage              string
	uploadSlots          chan struct{}
	storageDone          chan struct{}
	media                *mediaRelay
	emailSender          emailSender
	ai                   *aiService
}
type bucket struct {
	count int
	until time.Time
}
type socket struct {
	c       *websocket.Conn
	session string
	send    chan []byte
	done    chan struct{}
	once    sync.Once
}
type userKey struct{}
type sessionKey struct{}

func New(cfg Config) (*Server, error) {
	settings := DefaultSettings()
	if cfg.Settings != nil {
		settings = *cfg.Settings
	}
	if cfg.DataDir != "" {
		settings.DataDir = cfg.DataDir
	}
	if cfg.DownloadsDir != "" {
		settings.DownloadsDir = cfg.DownloadsDir
	}
	if err := settings.Validate(); err != nil {
		return nil, err
	}
	cfg.DataDir, cfg.DownloadsDir = settings.DataDir, settings.DownloadsDir
	db, err := openStore(cfg.DataDir)
	if err != nil {
		return nil, err
	}
	if cfg.Logger == nil {
		cfg.Logger = log.New(os.Stderr, "welink ", log.LstdFlags)
	}
	s := &Server{db: db, dir: cfg.DataDir, downloads: cfg.DownloadsDir, clients: map[string]map[*socket]bool{}, rooms: map[string]map[string]*socket{}, limits: map[string]*bucket{}, logger: cfg.Logger, mux: http.NewServeMux()}
	s.settings = settings
	if err = s.initEmail(cfg.EmailSender); err != nil {
		db.Close()
		return nil, err
	}
	if err = s.initAI(); err != nil {
		db.Close()
		return nil, err
	}
	mode := "0"
	if settings.Directory.AllUsers {
		mode = "1"
	}
	if _, err = db.Exec("UPDATE app_settings SET value=? WHERE key='all_users'", mode); err != nil {
		db.Close()
		return nil, err
	}
	if err = s.initStorage(); err != nil {
		db.Close()
		return nil, err
	}
	if err = s.startMediaRelay(); err != nil {
		db.Close()
		return nil, err
	}
	s.routes()
	s.meetings.rooms = map[string]*meetingRoom{}
	s.avatarSlots = make(chan struct{}, 2)
	s.qrLogins.items = map[string]*qrLogin{}
	s.startCalls()
	s.startStorageCleanup()
	return s, nil
}
func (s *Server) Close() error {
	if s.ai != nil {
		s.ai.cancel()
		s.ai.wg.Wait()
	}
	if s.media != nil {
		s.media.close()
	}
	s.callsClose.Do(func() { close(s.callsStop); <-s.callsDone; <-s.storageDone })
	s.meetings.Lock()
	if records, e := s.activeCallRecords(); e == nil {
		for _, c := range records {
			_, _ = s.finishCallLocked(c, "interrupted")
		}
	}
	for _, room := range s.meetings.rooms {
		for _, p := range room.Peers {
			p.socket.close()
		}
	}
	s.meetings.rooms = map[string]*meetingRoom{}
	s.meetings.Unlock()
	s.mu.Lock()
	for _, clients := range s.clients {
		for c := range clients {
			c.close()
		}
	}
	for _, room := range s.rooms {
		for _, c := range room {
			c.close()
		}
	}
	s.mu.Unlock()
	return s.db.Close()
}
func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		defer func() {
			if e := recover(); e != nil {
				s.logger.Printf("handler panic: %v", e)
				fail(w, 500, "服务暂时不可用")
			}
		}()
		s.mux.ServeHTTP(w, r)
	})
}
func (s *Server) routes() {
	s.mux.HandleFunc("POST /api/ai/v1/responses", s.aiProxy)
	s.mux.HandleFunc("POST /api/integrations/yudesk/support", s.yudeskSupport)
	s.mux.HandleFunc("GET /api/public-config", func(w http.ResponseWriter, r *http.Request) {
		ok(w, map[string]any{"registrationEnabled": s.settings.Registration.Enabled, "emailAuthEnabled": s.settings.EmailAuth.Enabled})
	})
	s.mux.HandleFunc("GET /share/{token}", s.publicDriveShare)
	s.mux.HandleFunc("GET /space/{user}", s.publicSpace)
	s.mux.HandleFunc("GET /join/{code}", s.meetingLink)
	s.mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		if err := s.db.PingContext(r.Context()); err != nil {
			fail(w, 503, "数据库不可用")
			return
		}
		ok(w, map[string]any{"ok": true, "version": "0.1.17", "time": now()})
	})
	s.mux.HandleFunc("POST /api/auth/register", s.register)
	s.mux.HandleFunc("POST /api/auth/login", s.login)
	s.mux.HandleFunc("POST /api/auth/email/code", s.emailCode)
	s.mux.HandleFunc("POST /api/auth/email/reset", s.emailReset)
	s.mux.HandleFunc("POST /api/auth/qr", s.createQRLogin)
	s.mux.HandleFunc("POST /api/auth/qr/poll", s.pollQRLogin)
	s.mux.HandleFunc("POST /api/auth/qr/cancel", s.cancelQRLogin)
	for pattern, h := range map[string]http.HandlerFunc{
		"GET /api/ai/config": s.aiConfig, "POST /api/ai/runs": s.aiPrepare, "GET /api/ai/runs/{id}": s.aiStatus, "POST /api/ai/runs/{id}/complete": s.aiComplete, "POST /api/ai/runs/{id}/cancel": s.aiCancel,
		"POST /api/drive/folders": s.createDriveFolder, "PATCH /api/drive/folders/{id}": s.renameDriveFolder, "DELETE /api/drive/folders/{id}": s.deleteDriveFolder, "POST /api/drive/files/{id}/move": s.moveDriveFile,
		"GET /api/drive": s.listDrive, "POST /api/drive/files": s.uploadDrive, "GET /api/drive/files/{id}": s.downloadDrive, "PATCH /api/drive/files/{id}": s.renameDrive, "DELETE /api/drive/files/{id}": s.deleteDrive, "POST /api/drive/files/{id}/share": s.shareDrive, "DELETE /api/drive/files/{id}/share": s.revokeDriveShare,
		"GET /api/spaces/{user}": s.listSpace, "PATCH /api/spaces/me/access": s.setSpaceAccess, "GET /api/spaces/{user}/documents/{id}": s.readSpaceDocument, "POST /api/spaces/me/documents": s.saveSpaceDocument, "PUT /api/spaces/me/documents/{id}": s.saveSpaceDocument, "DELETE /api/spaces/me/documents/{id}": s.deleteSpaceDocument,
		"POST /api/admin/users/{id}/password": s.adminResetPassword,
		"POST /api/admin/users/email-code":    s.emailCode,
		"GET /api/admin/users/{id}":           s.adminUserProfile, "PATCH /api/admin/users/{id}": s.adminUpdateProfile,
		"GET /api/admin/users": s.adminUsers, "POST /api/admin/users": s.adminCreateUser, "DELETE /api/admin/users/{id}": s.adminDeleteUser,
		"DELETE /api/conversations/{id}":    s.hideConversation,
		"POST /api/conversations/{id}/open": s.openConversation,
		"GET /api/users/{id}":               s.userProfile,
		"GET /api/config":                   s.publicConfig,
		"GET /api/meetings/{code}":          s.meetingInfo,
		"PATCH /api/me/avatar":              s.selectCartoonAvatar,
		"POST /api/me/avatar":               s.uploadAvatar, "DELETE /api/me/avatar": s.resetAvatar,
		"POST /api/groups/{id}/avatar": s.uploadAvatar, "DELETE /api/groups/{id}/avatar": s.resetAvatar, "GET /api/avatars/{image}": s.avatar,
		"POST /api/contact-groups/order": s.orderContactGroups,
		"GET /api/contact-groups":        s.listContactGroups, "POST /api/contact-groups": s.saveContactGroup, "PATCH /api/contact-groups/{id}": s.saveContactGroup, "DELETE /api/contact-groups/{id}": s.deleteContactGroup,
		"GET /api/contacts/{user}": s.contactDetail, "PATCH /api/contacts/{user}": s.updateContact, "DELETE /api/contacts/{user}": s.deleteContact, "GET /api/contact-blocks": s.listBlocks, "POST /api/contact-blocks/{user}": s.blockContact, "DELETE /api/contact-blocks/{user}": s.unblockContact,
		"GET /api/contact-privacy": s.contactPrivacy, "PATCH /api/contact-privacy": s.updateContactPrivacy,
		"GET /api/groups": s.searchGroups, "POST /api/groups/{id}/join": s.joinGroup, "GET /api/group-requests": s.groupRequests, "POST /api/group-requests/{request}": s.resolveGroupRequest,
		"PATCH /api/groups/{id}": s.updateGroup, "PATCH /api/groups/{id}/members/{user}": s.updateGroupMember, "POST /api/groups/{id}/transfer": s.transferGroup, "DELETE /api/groups/{id}": s.dissolveGroup,
		"GET /api/auth/sessions": s.listSessions, "DELETE /api/auth/sessions/{id}": s.revokeDevice, "POST /api/auth/sessions/revoke-others": s.revokeOtherDevices, "POST /api/auth/password": s.changePassword,
		"GET /api/rtc-config":    s.rtcConfig,
		"POST /api/auth/qr/scan": s.scanQRLogin, "POST /api/auth/qr/confirm": s.confirmQRLogin,
		"POST /api/meetings": s.createMeeting, "GET /api/meetings": s.listMeetings, "POST /api/meetings/{code}/invite": s.inviteMeeting, "POST /api/meetings/{code}/end": s.endMeeting, "GET /api/meetings/{code}/ws": s.meetingSocket,
		"POST /api/auth/logout": s.logout, "GET /api/me": s.me, "PATCH /api/me": s.updateMe,
		"GET /api/users": s.users, "GET /api/friends": s.friends, "GET /api/requests": s.requests, "POST /api/requests": s.addRequest, "POST /api/requests/{id}": s.resolveRequest,
		"GET /api/conversations": s.conversations, "POST /api/conversations": s.createConversation, "GET /api/conversations/{id}": s.conversationDetail, "PATCH /api/conversations/{id}": s.updateConversation, "POST /api/conversations/{id}/members": s.addMembers, "DELETE /api/conversations/{id}/members/{user}": s.removeMember,
		"GET /api/conversations/{id}/messages": s.messages, "POST /api/conversations/{id}/messages": s.sendMessage, "POST /api/conversations/{id}/read": s.readConversation,
		"GET /api/messages/{id}/notification": s.messageNotification,
		"GET /api/outbox/{clientId}":          s.messageReceipt,
		"POST /api/calls":                     s.createCall, "GET /api/calls/active": s.activeCalls, "GET /api/calls/history": s.callHistory, "GET /api/calls/{id}": s.getCall, "POST /api/calls/{id}/respond": s.respondCall, "POST /api/calls/{id}/end": s.endCall, "DELETE /api/calls/{id}": s.deleteCall,
		"POST /api/messages/{id}/recall": s.recall, "DELETE /api/messages/{id}": s.deleteMessage, "GET /api/files": s.files, "POST /api/files": s.upload, "GET /api/files/{id}": s.download,
		"POST /api/messages/forward": s.forwardMessages, "GET /api/messages/{id}/forward": s.forwardRecord, "POST /api/conversations/{id}/messages/delete": s.deleteMessages,
		"POST /api/conversations/{id}/messages/sync": s.syncCachedMessages,
		"GET /api/favorites":                         s.favorites, "POST /api/favorites/{id}": s.favorite, "DELETE /api/favorites/{id}": s.unfavorite,
		"GET /api/ws": s.events, "POST /api/remotes": s.inviteRemote, "GET /api/remotes/{id}": s.getRemote, "POST /api/remotes/{id}/respond": s.respondRemote, "POST /api/remotes/{id}/end": s.endRemote, "GET /api/remotes/{id}/tunnel": s.tunnel,
	} {
		s.mux.Handle(pattern, s.auth(h))
	}
	s.mux.HandleFunc("GET /", s.landing)
}
func ok(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d := json.NewDecoder(r.Body)
	if err := d.Decode(v); err != nil {
		fail(w, 400, "请求格式错误")
		return false
	}
	return true
}
func uid(r *http.Request) string { return r.Context().Value(userKey{}).(string) }
func sessionHash(r *http.Request) string {
	value, _ := r.Context().Value(sessionKey{}).(string)
	return value
}
func hashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
func (s *Server) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if token == "" {
			if c, e := r.Cookie("welink_session"); e == nil {
				token = c.Value
			}
		}
		var id string
		if len(token) != 64 || s.db.QueryRow("SELECT user_id FROM sessions WHERE token=? AND expires>? AND NOT EXISTS(SELECT 1 FROM deleted_accounts d WHERE d.user_id=sessions.user_id)", hashToken(token), now()).Scan(&id) != nil {
			fail(w, 401, "请重新登录")
			return
		}
		hashed := hashToken(token)
		_, _ = s.db.Exec("UPDATE session_info SET last_seen=? WHERE token=? AND last_seen<?", now(), hashed, now()-60000)
		ctx := context.WithValue(r.Context(), userKey{}, id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(ctx, sessionKey{}, hashed)))
	})
}
func (s *Server) rate(r *http.Request, key string, limit int, d time.Duration) bool {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	s.mu.Lock()
	defer s.mu.Unlock()
	key = host + ":" + key
	if len(s.limits) > 10000 {
		for k, b := range s.limits {
			if time.Now().After(b.until) {
				delete(s.limits, k)
			}
		}
	}
	b := s.limits[key]
	if b == nil || time.Now().After(b.until) {
		b = &bucket{until: time.Now().Add(d)}
		s.limits[key] = b
	}
	b.count++
	return b.count <= limit
}
func validText(v string, max int) bool {
	return utf8.ValidString(v) && utf8.RuneCountInString(v) <= max && !strings.ContainsRune(v, 0)
}
func (s *Server) member(cid, user string) bool {
	var n int
	return s.db.QueryRow("SELECT 1 FROM members WHERE conversation_id=? AND user_id=?", cid, user).Scan(&n) == nil
}
func (s *Server) requireMember(w http.ResponseWriter, r *http.Request) bool {
	if !s.member(r.PathValue("id"), uid(r)) {
		fail(w, 403, "无法访问该会话")
		return false
	}
	return true
}
func (s *Server) online(id string) bool {
	if s.isAI(id) {
		return true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.clients[id]) > 0
}
func (s *Server) user(id string) (u User, err error) {
	err = s.db.QueryRow("SELECT u.id,CAST(n.number AS TEXT),u.name,u.avatar,u.bio,n.number FROM users u JOIN user_numbers n ON n.user_id=u.id WHERE u.id=?", id).Scan(&u.ID, &u.Account, &u.Name, &u.Avatar, &u.Bio, &u.Number)
	if err == nil {
		err = s.fillProfileDetails(&u)
	}
	u.Online = s.online(id)
	u.AI = s.isAI(id)
	return
}
func (s *Server) push(users []string, kind string, data any) {
	raw, _ := json.Marshal(map[string]any{"type": kind, "data": data})
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, id := range users {
		for c := range s.clients[id] {
			select {
			case c.send <- raw:
			default:
				c.close()
			}
		}
	}
}
func (s *Server) audience(cid string) []string {
	rows, err := s.db.Query("SELECT user_id FROM members WHERE conversation_id=?", cid)
	if err != nil {
		return nil
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	return ids
}
func (s *Server) pushConversation(cid, kind string, data any) { s.push(s.audience(cid), kind, data) }
func (s *Server) dbError(w http.ResponseWriter, err error) {
	var permission *groupError
	if errors.As(err, &permission) {
		fail(w, permission.status, permission.text)
		return
	}
	if strings.Contains(err.Error(), "message_blocked") {
		fail(w, 403, "该用户暂不接收你的私聊消息")
		return
	}
	if strings.Contains(err.Error(), "account_deleted") {
		fail(w, 401, "账号已被删除，请重新登录")
		return
	}
	if strings.Contains(err.Error(), "contact_send_forbidden") {
		fail(w, 403, "你们暂时无法私聊，请先确认好友关系")
		return
	}
	if strings.Contains(err.Error(), "contact_request_forbidden") {
		fail(w, 403, "暂时无法添加该用户")
		return
	}
	if strings.Contains(err.Error(), "group_send_forbidden") {
		fail(w, 403, "你已被禁言或不在该群，无法发送消息")
		return
	}
	s.logger.Printf("storage: %v", err)
	fail(w, 500, "保存失败，请重试")
}
func isMissing(err error) bool { return errors.Is(err, sql.ErrNoRows) }
func (c *socket) close()       { c.once.Do(func() { close(c.done); _ = c.c.Close() }) }

var upgrader = websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 4096, CheckOrigin: func(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	return origin == "" || origin == "https://"+r.Host || origin == "http://"+r.Host
}}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	id := uid(r)
	c := &socket{c: conn, session: sessionHash(r), send: make(chan []byte, 128), done: make(chan struct{})}
	s.mu.Lock()
	if s.clients[id] == nil {
		s.clients[id] = map[*socket]bool{}
	}
	s.clients[id][c] = true
	s.mu.Unlock()
	s.notifyPresence(id, true)
	defer func() {
		c.close()
		s.mu.Lock()
		delete(s.clients[id], c)
		last := len(s.clients[id]) == 0
		if last {
			delete(s.clients, id)
		}
		s.mu.Unlock()
		if last {
			s.notifyPresence(id, false)
		}
	}()
	if !s.sessionAlive(c) {
		return
	}
	go func() {
		t := time.NewTicker(25 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-c.done:
				return
			case raw := <-c.send:
				_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if conn.WriteMessage(websocket.TextMessage, raw) != nil {
					c.close()
					return
				}
			case <-t.C:
				if !s.sessionAlive(c) {
					return
				}
				if conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
					c.close()
					return
				}
			}
		}
	}()
	conn.SetReadLimit(8192)
	_ = conn.SetReadDeadline(time.Now().Add(70 * time.Second))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(70 * time.Second)) })
	for {
		var p struct{ Type, ConversationID string }
		if conn.ReadJSON(&p) != nil {
			return
		}
		if p.Type == "typing" && s.rate(r, "typing:"+id, 90, time.Minute) && s.canSpeak(p.ConversationID, id) {
			s.pushConversation(p.ConversationID, "typing", map[string]string{"userId": id, "conversationId": p.ConversationID})
		}
	}
}
func (s *Server) notifyPresence(id string, online bool) {
	rows, e := s.db.Query("SELECT peer_id FROM directory_friends WHERE user_id=?", id)
	if e != nil {
		return
	}
	ids := []string{}
	for rows.Next() {
		var peer string
		_ = rows.Scan(&peer)
		ids = append(ids, peer)
	}
	rows.Close()
	s.push(ids, "presence", map[string]any{"userId": id, "online": online})
}
