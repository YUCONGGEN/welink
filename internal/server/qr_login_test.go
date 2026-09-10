package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

type qrTestChallenge struct {
	ID, PollSecret, Payload, Image, CheckCode string
}

func newQRChallenge(f *fixture) (qrTestChallenge, map[string]any) {
	var q qrTestChallenge
	f.request("POST", "/api/auth/qr", "", map[string]string{"device": "测试 Windows"}, 200, &q)
	u, err := url.Parse(q.Payload)
	if err != nil {
		f.t.Fatal(err)
	}
	return q, map[string]any{"id": q.ID, "key": u.Query().Get("key")}
}

func TestQRLoginConsentAndSingleUse(t *testing.T) {
	f := setup(t)
	phone, other := f.register("qr_phone"), f.register("qr_other")
	q, scan := newQRChallenge(f)
	if len(q.PollSecret) != 64 || len(q.CheckCode) != 6 || strings.Contains(q.Payload, q.PollSecret) || !strings.HasPrefix(q.Image, "data:image/png;base64,") {
		t.Fatal("invalid QR challenge")
	}
	poll := map[string]any{"id": q.ID, "pollSecret": q.PollSecret}
	f.request("POST", "/api/auth/qr/scan", "", scan, 401, nil)
	f.request("POST", "/api/auth/qr/confirm", phone.Token, map[string]any{"id": q.ID, "key": scan["key"], "accept": true}, 403, nil)
	f.request("POST", "/api/auth/qr/poll", "", map[string]any{"id": q.ID, "pollSecret": scan["key"]}, 404, nil)
	var status map[string]any
	f.request("POST", "/api/auth/qr/poll", "", poll, 200, &status)
	if status["state"] != "waiting" || status["token"] != nil {
		t.Fatal("issued login before scan")
	}
	f.request("POST", "/api/auth/qr/scan", phone.Token, scan, 200, &status)
	if status["checkCode"] != q.CheckCode || status["token"] != nil {
		t.Fatal("scan leaked session or code mismatch")
	}
	f.request("POST", "/api/auth/qr/scan", other.Token, scan, 403, nil)
	f.request("POST", "/api/auth/qr/confirm", other.Token, map[string]any{"id": q.ID, "key": scan["key"], "accept": true}, 403, nil)
	f.request("POST", "/api/auth/qr/poll", "", poll, 200, &status)
	if status["state"] != "scanned" || status["token"] != nil {
		t.Fatal("issued login before confirmation")
	}
	f.request("POST", "/api/auth/qr/confirm", phone.Token, map[string]any{"id": q.ID, "key": scan["key"], "accept": true}, 200, nil)
	// Two concurrent requests must create exactly one independent desktop session.
	type redemption struct {
		status int
		body   []byte
		err    error
	}
	responses := make(chan redemption, 2)
	for n := 0; n < 2; n++ {
		go func() {
			body, _ := json.Marshal(poll)
			r, err := http.Post(f.url+"/api/auth/qr/poll", "application/json", bytes.NewReader(body))
			if err != nil {
				responses <- redemption{err: err}
				return
			}
			defer r.Body.Close()
			b, _ := io.ReadAll(r.Body)
			responses <- redemption{status: r.StatusCode, body: b}
		}()
	}
	success := 0
	for n := 0; n < 2; n++ {
		result := <-responses
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.status == 200 {
			var desktop account
			if err := json.Unmarshal(result.body, &desktop); err != nil {
				t.Fatal(err)
			}
			if desktop.User.ID != phone.User.ID || desktop.Token == phone.Token || len(desktop.Token) != 64 {
				t.Fatal("wrong desktop session")
			}
			f.request("GET", "/api/me", desktop.Token, nil, 200, nil)
			success++
		} else if result.status != 404 {
			t.Fatalf("unexpected redemption status %d", result.status)
		}
	}
	if success != 1 {
		t.Fatalf("got %d redeemed sessions", success)
	}
	f.request("GET", "/api/me", phone.Token, nil, 200, nil)
	f.request("POST", "/api/auth/qr/confirm", phone.Token, map[string]any{"id": q.ID, "key": scan["key"], "accept": true}, 404, nil)
}

func TestQRLoginCancelExpiryAndWrongSecret(t *testing.T) {
	f := setup(t)
	phone := f.register("qr_expiry")
	q, scan := newQRChallenge(f)
	f.request("POST", "/api/auth/qr/scan", phone.Token, map[string]string{"id": q.ID, "key": strings.Repeat("0", 64)}, 404, nil)
	f.request("POST", "/api/auth/qr/scan", phone.Token, scan, 200, nil)
	f.request("POST", "/api/auth/qr/confirm", phone.Token, map[string]any{"id": q.ID, "key": scan["key"], "accept": false}, 200, nil)
	var state map[string]any
	f.request("POST", "/api/auth/qr/poll", "", map[string]string{"id": q.ID, "pollSecret": q.PollSecret}, 200, &state)
	if state["state"] != "rejected" || state["token"] != nil {
		t.Fatal("cancel authorized login")
	}
	f.request("POST", "/api/auth/qr/confirm", phone.Token, map[string]any{"id": q.ID, "key": scan["key"], "accept": true}, 403, nil)
	q, scan = newQRChallenge(f)
	f.s.qrLogins.Lock()
	f.s.qrLogins.items[q.ID].Expires = now() - 1
	f.s.qrLogins.Unlock()
	f.request("POST", "/api/auth/qr/scan", phone.Token, scan, 404, nil)
	f.request("POST", "/api/auth/qr/poll", "", map[string]string{"id": q.ID, "pollSecret": q.PollSecret}, 200, &state)
	if state["state"] != "expired" {
		t.Fatal("expired challenge survived")
	}
	q, scan = newQRChallenge(f)
	f.request("POST", "/api/auth/qr/cancel", "", map[string]string{"id": q.ID, "pollSecret": q.PollSecret}, 200, nil)
	f.request("POST", "/api/auth/qr/scan", phone.Token, scan, 404, nil)
}
