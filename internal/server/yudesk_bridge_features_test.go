package server

import (
	"bytes"
	"encoding/base64"
	"golang.org/x/crypto/argon2"
	"image"
	"image/png"
	"strings"
	"testing"
)

func bridgeCredential(password string) string {
	salt := []byte("bridge-test-salt")
	return "$yudesk$argon2id$3,65536,2$" + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32))
}

func TestYuDeskRegistrationResetAndEmailLogin(t *testing.T) {
	key := strings.Repeat("c", 40)
	t.Setenv("WELINK_YUDESK_SECRET", key)
	f := setup(t)
	email := "bridge-credentials@example.com"
	path := "/api/integrations/yudesk/support"
	// Invalid sync requests must not create a bridge account.
	f.request("POST", path, key, map[string]any{"action": "account-sync", "email": email, "credential": "bad", "revision": 1}, 400, nil)
	var count int
	f.s.db.QueryRow("SELECT COUNT(*) FROM yudesk_identities").Scan(&count)
	if count != 0 {
		t.Fatal("bad sync provisioned an account")
	}
	body := map[string]any{"action": "account-sync", "email": email, "credential": bridgeCredential("Bridge-register-password!"), "revision": 1}
	f.request("POST", path, key, body, 200, nil)
	var id string
	f.s.db.QueryRow(`SELECT user_id FROM user_emails WHERE email=? AND verified>0`, email).Scan(&id)
	if id == "" {
		t.Fatal("email identity not registered")
	}
	var hash []byte
	f.s.db.QueryRow("SELECT password FROM users WHERE id=?", id).Scan(&hash)
	if !storedPasswordMatches(hash, "Bridge-register-password!") {
		t.Fatal("password was not synchronized")
	}
	f.s.settings.EmailAuth.Enabled = true
	var login struct{ Token string }
	f.request("POST", "/api/auth/login", "", map[string]string{"email": email, "password": "Bridge-register-password!"}, 200, &login)
	body["credential"] = bridgeCredential("Bridge-reset-password!")
	body["revision"] = 2
	f.request("POST", path, key, body, 200, nil)
	f.request("GET", "/api/me", login.Token, nil, 401, nil)
	f.request("POST", "/api/auth/login", "", map[string]string{"email": email, "password": "Bridge-register-password!"}, 401, nil)
	f.request("POST", "/api/auth/login", "", map[string]string{"email": email, "password": "Bridge-reset-password!"}, 200, nil)
	// Out-of-order retries may not restore an earlier password.
	body["revision"] = 1
	body["credential"] = bridgeCredential("Bridge-register-password!")
	f.request("POST", path, key, body, 200, nil)
	f.s.db.QueryRow("SELECT password FROM users WHERE id=?", id).Scan(&hash)
	if !storedPasswordMatches(hash, "Bridge-reset-password!") {
		t.Fatal("stale sync restored the old password")
	}
}

func TestYuDeskSupportImageVisibilityAndUnread(t *testing.T) {
	key := strings.Repeat("i", 40)
	t.Setenv("WELINK_YUDESK_SECRET", key)
	f := setup(t)
	staff := f.register("image_support")
	path := "/api/integrations/yudesk/support"
	body := map[string]any{"action": "bootstrap", "email": "image-bridge@example.com", "staff": []string{staff.User.Number}}
	var bootstrap struct {
		UserID string
		Staff  []struct{ Unread int }
	}
	f.request("POST", path, key, body, 200, &bootstrap)
	cid, err := f.s.yudeskConversation(bootstrap.UserID, staff.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	var raw bytes.Buffer
	_ = png.Encode(&raw, image.NewRGBA(image.Rect(0, 0, 48, 32)))
	m := forwardAttachment(t, f, cid, staff, "test.png", "image", "image/png", raw.Bytes())
	f.request("POST", path, key, body, 200, &bootstrap)
	if len(bootstrap.Staff) != 1 || bootstrap.Staff[0].Unread != 1 {
		t.Fatal("missing unread message")
	}
	body["action"] = "image"
	body["peer"] = staff.User.Number
	body["attachmentId"] = m.AttachmentID
	var pic struct {
		Data          string
		Width, Height int
	}
	f.request("POST", path, key, body, 200, &pic)
	data, err := base64.StdEncoding.DecodeString(pic.Data)
	if err != nil || len(data) == 0 || pic.Width != 48 || pic.Height != 32 {
		t.Fatal("image preview not decoded")
	}
	body["action"] = "read"
	body["messageId"] = m.ID
	f.request("POST", path, key, body, 200, nil)
	body["action"] = "bootstrap"
	f.request("POST", path, key, body, 200, &bootstrap)
	if bootstrap.Staff[0].Unread != 0 {
		t.Fatal("read acknowledgement did not clear unread")
	}
	f.request("POST", "/api/messages/"+m.ID+"/recall", staff.Token, nil, 200, nil)
	body["action"] = "image"
	f.request("POST", path, key, body, 404, nil)
	// Another verified customer cannot retrieve the same attachment.
	body["email"] = "other-bridge@example.com"
	f.request("POST", path, key, body, 404, nil)
}
