package server

// Only the authenticated YuDesk server can provision verified identities or
// synchronize password verifiers. Clients receive no general LinkMe session.
import (
	"bytes"
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/mail"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const yudeskSchema = `CREATE TABLE IF NOT EXISTS yudesk_identities(phone TEXT PRIMARY KEY,user_id TEXT UNIQUE NOT NULL REFERENCES users(id));CREATE TABLE IF NOT EXISTS yudesk_credential_versions(user_id TEXT PRIMARY KEY REFERENCES users(id),revision INTEGER NOT NULL);`

var yudeskPhone = regexp.MustCompile(`^1[3-9][0-9]{9}$`)
var yudeskNumber = regexp.MustCompile(`^[1-9][0-9]{5}$`)

type yudeskSupportRequest struct {
	Phone        string   `json:"phone"`
	Email        string   `json:"email"`
	Staff        []string `json:"staff"`
	Action       string   `json:"action"`
	Peer         string   `json:"peer"`
	Text         string   `json:"text"`
	Kind         string   `json:"kind"`
	ImageData    string   `json:"imageData"`
	ImageName    string   `json:"imageName"`
	ImageMime    string   `json:"imageMime"`
	ClientID     string   `json:"clientId"`
	AttachmentID string   `json:"attachmentId"`
	MessageID    string   `json:"messageId"`
	Credential   string   `json:"credential"`
	Revision     int64    `json:"revision"`
}

func (s *Server) yudeskSupport(w http.ResponseWriter, r *http.Request) {
	secret := os.Getenv("WELINK_YUDESK_SECRET")
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	ip := net.ParseIP(host)
	if len(secret) < 32 || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+secret)) != 1 || (r.TLS == nil && (ip == nil || !ip.IsLoopback())) {
		fail(w, 403, "客服连接未授权")
		return
	}
	var p yudeskSupportRequest
	// Support image messages are JSON with bounded base64 payloads. The normal
	// API decoder is intentionally 1 MiB, so this bridge uses a larger explicit
	// cap while still rejecting unbounded request bodies.
	r.Body = http.MaxBytesReader(w, r.Body, 18<<20)
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		fail(w, 400, "请求格式错误")
		return
	}
	validIdentity := yudeskPhone.MatchString(p.Phone)
	if p.Email != "" {
		email := strings.ToLower(strings.TrimSpace(p.Email))
		address, err := mail.ParseAddress(email)
		ascii := true
		for _, ch := range email {
			if ch < 33 || ch > 126 {
				ascii = false
			}
		}
		validIdentity = p.Phone == "" && ascii && len(email) <= 254 && err == nil && address.Name == "" && address.Address == email
		if validIdentity {
			p.Phone = "email:" + email
		}
	}
	if (p.Action != "validate" && !validIdentity) || len(p.Staff) > 20 || (p.Action != "validate" && p.Action != "bootstrap" && p.Action != "history" && p.Action != "send" && p.Action != "account-sync" && p.Action != "image" && p.Action != "read") {
		fail(w, 400, "客服请求无效")
		return
	}
	if p.Action == "send" && p.Kind != "" && p.Kind != "text" && p.Kind != "image" {
		fail(w, 400, "客服消息类型无效")
		return
	}
	if p.Action == "account-sync" {
		if _, _, ok := yudeskVerifier(p.Credential); !ok || p.Revision < 1 {
			fail(w, 400, "账号同步数据无效")
			return
		}
	}
	// Validate the whole list before provisioning an account or adding contacts.
	staff := []User{}
	seen := map[string]bool{}
	for _, number := range p.Staff {
		if !yudeskNumber.MatchString(number) {
			fail(w, 400, "客服账号必须为六位数字")
			return
		}
		if seen[number] {
			continue
		}
		seen[number] = true
		var id string
		err := s.db.QueryRow(`SELECT n.user_id FROM user_numbers n WHERE n.number=? AND NOT EXISTS(SELECT 1 FROM deleted_accounts d WHERE d.user_id=n.user_id)`, number).Scan(&id)
		if err != nil {
			fail(w, 400, "客服账号不存在或不可用")
			return
		}
		u, err := s.user(id)
		if err != nil {
			s.dbError(w, err)
			return
		}
		staff = append(staff, u)
	}
	if p.Action == "validate" {
		ok(w, map[string]bool{"ok": true})
		return
	}
	var peer User
	if p.Action != "bootstrap" && p.Action != "account-sync" {
		for _, u := range staff {
			if u.Number == p.Peer {
				peer = u
			}
		}
		if peer.ID == "" {
			fail(w, 403, "请选择指定客服")
			return
		}
	}
	id, err := s.yudeskIdentity(p.Phone, staff)
	if err != nil {
		fail(w, 503, "忙碌中")
		return
	}
	if p.Action == "account-sync" {
		s.yudeskSyncCredential(w, r, id, p.Credential, p.Revision)
		return
	}
	if p.Action == "bootstrap" {
		// Return only support identity/contact information, never a login token.
		contacts := []map[string]any{}
		for _, u := range staff {
			if u.ID == id {
				contacts = append(contacts, map[string]any{"number": u.Number, "name": u.Name, "online": u.Online, "unread": 0, "self": true})
				continue
			}
			var unread int
			cid, e := s.yudeskConversation(id, u.ID)
			if e != nil {
				fail(w, 503, "忙碌中")
				return
			}
			if e = s.db.QueryRow(`SELECT COUNT(*) FROM messages m JOIN members x ON x.conversation_id=m.conversation_id AND x.user_id=? WHERE m.conversation_id=? AND m.seq>x.read_seq AND m.sender<>? AND m.recalled=0 AND NOT EXISTS(SELECT 1 FROM message_deletions d WHERE d.message_id=m.id AND d.user_id=?)`, id, cid, id, id).Scan(&unread); e != nil {
				s.dbError(w, e)
				return
			}
			contacts = append(contacts, map[string]any{"number": u.Number, "name": u.Name, "online": u.Online, "unread": unread})
		}
		var revision int64
		e := s.db.QueryRow(`SELECT revision FROM yudesk_credential_versions WHERE user_id=?`, id).Scan(&revision)
		if e != nil && !errors.Is(e, sql.ErrNoRows) {
			s.dbError(w, e)
			return
		}
		ok(w, map[string]any{"ok": true, "userId": id, "origin": "来自 YuDesk", "staff": contacts, "credentialRevision": revision})
		return
	}
	if peer.ID == id {
		fail(w, http.StatusConflict, "当前账号就是该客服，请选择其他客服")
		return
	}
	if !contactAllowed(s.db, id, peer.ID) {
		fail(w, 403, "暂时无法联系此客服")
		return
	}
	cid, err := s.yudeskConversation(id, peer.ID)
	if err != nil {
		s.dbError(w, err)
		return
	}
	if p.Action == "read" {
		var seq int64
		if s.db.QueryRow(`SELECT seq FROM messages WHERE id=? AND conversation_id=? AND NOT EXISTS(SELECT 1 FROM message_deletions d WHERE d.message_id=messages.id AND d.user_id=?)`, p.MessageID, cid, id).Scan(&seq) != nil {
			fail(w, 404, "消息不存在")
			return
		}
		if _, err = s.db.Exec(`UPDATE members SET read_seq=MAX(read_seq,?) WHERE conversation_id=? AND user_id=?`, seq, cid, id); err != nil {
			s.dbError(w, err)
			return
		}
		ok(w, map[string]bool{"ok": true})
		return
	}
	if p.Action == "image" {
		s.yudeskSupportImage(w, r, id, cid, p.AttachmentID)
		return
	}
	child := r.Clone(context.WithValue(r.Context(), userKey{}, id))
	child.SetPathValue("id", cid)
	if p.Action == "send" {
		if p.Kind == "image" {
			s.yudeskSupportImageSend(w, child, p)
			return
		}
		raw, _ := json.Marshal(map[string]string{"kind": "text", "text": p.Text, "clientId": p.ClientID})
		child.Body = io.NopCloser(bytes.NewReader(raw))
		s.sendMessage(w, child)
		return
	}
	// Existing visibility, recalled-message and pagination semantics are retained.
	child.URL.RawQuery = ""
	capture := &yudeskResponse{header: http.Header{}}
	s.messages(capture, child)
	if capture.status >= 400 {
		w.WriteHeader(capture.status)
		_, _ = w.Write(capture.body.Bytes())
		return
	}
	var messages []Message
	if json.Unmarshal(capture.body.Bytes(), &messages) != nil {
		fail(w, 503, "忙碌中")
		return
	}
	ok(w, map[string]any{"ok": true, "userId": id, "messages": messages})
}

// yudeskSupportImageSend turns the bridge's bounded base64 image into the
// normal attachment + message flow. This keeps the same permissions, storage
// limits, deduplication and message push behavior as native clients.
func (s *Server) yudeskSupportImageSend(w http.ResponseWriter, child *http.Request, p yudeskSupportRequest) {
	raw, err := base64.StdEncoding.DecodeString(p.ImageData)
	if err != nil || len(raw) == 0 || len(raw) > 12<<20 {
		fail(w, 400, "图片数据无效或过大")
		return
	}
	probe := len(raw)
	if probe > 512 {
		probe = 512
	}
	contentType := http.DetectContentType(raw[:probe])
	if !strings.HasPrefix(contentType, "image/") || (p.ImageMime != "" && !strings.HasPrefix(p.ImageMime, "image/")) {
		fail(w, 400, "客服图片格式无效")
		return
	}
	name := filepath.Base(strings.ReplaceAll(p.ImageName, "\\", "/"))
	if name == "." || name == "" || name == string(filepath.Separator) {
		name = "image.png"
	}
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	if err = form.WriteField("conversationId", child.PathValue("id")); err != nil {
		fail(w, 400, "图片请求无效")
		return
	}
	// The upload is idempotent independently from the message. A retry with the
	// same YuDesk client ID therefore reuses the stored attachment.
	if err = form.WriteField("clientId", "yudesk-image-"+p.ClientID); err != nil {
		fail(w, 400, "图片请求无效")
		return
	}
	part, err := form.CreateFormFile("file", name)
	if err != nil {
		fail(w, 400, "图片请求无效")
		return
	}
	if _, err = part.Write(raw); err != nil || form.Close() != nil {
		fail(w, 400, "图片上传失败")
		return
	}
	uploadRequest := child.Clone(child.Context())
	uploadRequest.Method = http.MethodPost
	uploadRequest.Body = io.NopCloser(bytes.NewReader(body.Bytes()))
	uploadRequest.ContentLength = int64(body.Len())
	uploadRequest.Header = child.Header.Clone()
	uploadRequest.Header.Set("Content-Type", form.FormDataContentType())
	capture := &yudeskResponse{header: http.Header{}}
	s.upload(capture, uploadRequest)
	if capture.status >= 400 {
		w.WriteHeader(capture.status)
		_, _ = w.Write(capture.body.Bytes())
		return
	}
	var attachment struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(capture.body.Bytes(), &attachment) != nil || attachment.ID == "" {
		fail(w, 503, "图片上传响应无效")
		return
	}
	message, _ := json.Marshal(map[string]string{"kind": "image", "text": p.Text, "attachmentId": attachment.ID, "clientId": p.ClientID})
	child.Body = io.NopCloser(bytes.NewReader(message))
	s.sendMessage(w, child)
}

type yudeskResponse struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (w *yudeskResponse) Header() http.Header         { return w.header }
func (w *yudeskResponse) WriteHeader(n int)           { w.status = n }
func (w *yudeskResponse) Write(p []byte) (int, error) { return w.body.Write(p) }

func (s *Server) yudeskIdentity(phone string, staff []User) (string, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	var id string
	err = tx.QueryRow("SELECT user_id FROM yudesk_identities WHERE phone=?", phone).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		if strings.HasPrefix(phone, "email:") {
			err = tx.QueryRow(`SELECT e.user_id FROM user_emails e WHERE e.email=? AND e.verified>0 AND NOT EXISTS(SELECT 1 FROM deleted_accounts d WHERE d.user_id=e.user_id)`, strings.TrimPrefix(phone, "email:")).Scan(&id)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return "", err
			}
		}
		if id == "" {
			id = newID()
			// An unrelated editable LinkMe profile with the same phone is never claimed.
			// Invalid bcrypt bytes intentionally disable password login for bridge users.
			label, profilePhone := phone[:3]+"****"+phone[7:], phone
			if strings.HasPrefix(phone, "email:") {
				email := strings.TrimPrefix(phone, "email:")
				parts := strings.SplitN(email, "@", 2)
				label, profilePhone = parts[0][:1]+"***@"+parts[1], ""
			}
			_, err = tx.Exec("INSERT INTO users(id,account,name,password,avatar,bio,created) VALUES(?,?,?,?,?,?,?)", id, "yd_"+id[:20], label+" · 来自YuDesk", []byte("external:yudesk"), defaultCartoonAvatar(id), "来自 YuDesk", now())
			if err != nil {
				return "", err
			}
			if err = assignNumber(tx, id); err != nil {
				return "", err
			}
			if strings.HasPrefix(phone, "email:") {
				if _, err = tx.Exec(`INSERT INTO user_emails(user_id,email,verified) VALUES(?,?,?)`, id, strings.TrimPrefix(phone, "email:"), now()); err != nil {
					return "", err
				}
			}
			if _, err = tx.Exec("INSERT INTO user_profile_details(user_id,phone) VALUES(?,?)", id, profilePhone); err != nil {
				return "", err
			}
		}
		if _, err = tx.Exec("INSERT INTO yudesk_identities VALUES(?,?)", phone, id); err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	}
	var deleted int
	if err = tx.QueryRow("SELECT COUNT(*) FROM deleted_accounts WHERE user_id=?", id).Scan(&deleted); err != nil {
		return "", err
	}
	if deleted != 0 {
		return "", errors.New("account disabled")
	}
	changed := []string{}
	for _, u := range staff {
		if u.ID == id {
			// Older bridge releases inserted a self-contact before failing to
			// create its duplicate conversation members. Repair only that pair.
			if _, err = tx.Exec("DELETE FROM friends WHERE user_id=? AND peer_id=?", id, id); err != nil {
				return "", err
			}
			continue
		}
		if contactBlocked(tx, id, u.ID) {
			continue
		}
		result, err := tx.Exec("INSERT OR IGNORE INTO friends(user_id,peer_id) VALUES(?,?),(?,?)", id, u.ID, u.ID, id)
		if err != nil {
			return "", err
		}
		if n, _ := result.RowsAffected(); n > 0 {
			changed = append(changed, u.ID)
		}
	}
	if err = tx.Commit(); err != nil {
		return "", err
	}
	if len(changed) > 0 {
		s.push(changed, "contacts", map[string]bool{"ok": true})
	}
	return id, nil
}
func (s *Server) yudeskConversation(user, peer string) (string, error) {
	ids := []string{user, peer}
	sort.Strings(ids)
	key := strings.Join(ids, ":")
	tx, err := s.db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	var id string
	err = tx.QueryRow("SELECT id FROM conversations WHERE direct_key=?", key).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		id = newID()
		if _, err = tx.Exec("INSERT INTO conversations(id,kind,name,owner,direct_key,created) VALUES(?,'direct','',?,?,?)", id, user, key, now()); err != nil {
			return "", err
		}
		if _, err = tx.Exec("INSERT INTO members(conversation_id,user_id) VALUES(?,?),(?,?)", id, user, id, peer); err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	}
	return id, tx.Commit()
}
