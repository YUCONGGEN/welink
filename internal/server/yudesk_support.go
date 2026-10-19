package server

// YuDesk has no WeLink password or general-purpose session. Only the trusted
// YuDesk server can act on a verified phone, and only with configured staff.
import (
	"bytes"
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
)

const yudeskSchema = `CREATE TABLE IF NOT EXISTS yudesk_identities(phone TEXT PRIMARY KEY,user_id TEXT UNIQUE NOT NULL REFERENCES users(id));`

var yudeskPhone = regexp.MustCompile(`^1[3-9][0-9]{9}$`)
var yudeskNumber = regexp.MustCompile(`^[1-9][0-9]{5}$`)

type yudeskSupportRequest struct {
	Phone    string   `json:"phone"`
	Staff    []string `json:"staff"`
	Action   string   `json:"action"`
	Peer     string   `json:"peer"`
	Text     string   `json:"text"`
	ClientID string   `json:"clientId"`
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
	if !decode(w, r, &p) {
		return
	}
	if (p.Action != "validate" && !yudeskPhone.MatchString(p.Phone)) || len(p.Staff) > 20 || (p.Action != "validate" && p.Action != "bootstrap" && p.Action != "history" && p.Action != "send") {
		fail(w, 400, "客服请求无效")
		return
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
		err := s.db.QueryRow(`SELECT n.user_id FROM user_numbers n WHERE n.number=? AND NOT EXISTS(SELECT 1 FROM deleted_accounts d WHERE d.user_id=n.user_id) AND NOT EXISTS(SELECT 1 FROM yudesk_identities y WHERE y.user_id=n.user_id)`, number).Scan(&id)
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
	if p.Action != "bootstrap" {
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
	if p.Action == "bootstrap" {
		// Return only support identity/contact information, never a login token.
		contacts := []map[string]any{}
		for _, u := range staff {
			contacts = append(contacts, map[string]any{"number": u.Number, "name": u.Name, "online": u.Online})
		}
		ok(w, map[string]any{"ok": true, "userId": id, "origin": "来自 YuDesk", "staff": contacts})
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
	child := r.Clone(context.WithValue(r.Context(), userKey{}, id))
	child.SetPathValue("id", cid)
	if p.Action == "send" {
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
		id = newID()
		// An unrelated editable WeLink profile with the same phone is never claimed.
		// Invalid bcrypt bytes intentionally disable password login for bridge users.
		_, err = tx.Exec("INSERT INTO users(id,account,name,password,avatar,bio,created) VALUES(?,?,?,?,?,?,?)", id, "yd_"+id[:20], phone[:3]+"****"+phone[7:]+" · 来自YuDesk", []byte("external:yudesk"), defaultCartoonAvatar(id), "来自 YuDesk", now())
		if err != nil {
			return "", err
		}
		if err = assignNumber(tx, id); err != nil {
			return "", err
		}
		if _, err = tx.Exec("INSERT INTO yudesk_identities VALUES(?,?)", phone, id); err != nil {
			return "", err
		}
		if _, err = tx.Exec("INSERT INTO user_profile_details(user_id,phone) VALUES(?,?)", id, phone); err != nil {
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
