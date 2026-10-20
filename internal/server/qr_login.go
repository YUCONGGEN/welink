package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	qrcode "github.com/skip2/go-qrcode"
)

type qrLogin struct {
	PollHash, ScanHash, State, UserID, Device, CheckCode string
	UserSession                                          string
	Expires                                              int64
}
type qrLoginDirectory struct {
	sync.Mutex
	items map[string]*qrLogin
}
type qrRequest struct {
	ID         string `json:"id"`
	Key        string `json:"key"`
	PollSecret string `json:"pollSecret"`
	Accept     bool   `json:"accept"`
}

func (s *Server) createQRLogin(w http.ResponseWriter, r *http.Request) {
	if !s.rate(r, "qr-create", 20, time.Minute) {
		fail(w, 429, "刷新二维码过于频繁，请稍后再试")
		return
	}
	var input struct{ Device string }
	if !decode(w, r, &input) {
		return
	}
	input.Device = strings.TrimSpace(input.Device)
	if input.Device == "" {
		input.Device = "LinkMe Windows 客户端"
	}
	if !validText(input.Device, 60) {
		fail(w, 400, "设备名称过长")
		return
	}
	id, pollSecret, scanKey := newID(), newID()+newID(), newID()+newID()
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		s.dbError(w, err)
		return
	}
	check := fmt.Sprintf("%06d", n.Int64())
	payload := "welink://login/" + id + "?key=" + scanKey
	png, err := qrcode.Encode(payload, qrcode.Medium, 288)
	if err != nil {
		s.dbError(w, err)
		return
	}
	q := &qrLogin{PollHash: hashToken(pollSecret), ScanHash: hashToken(scanKey), State: "waiting", Device: input.Device, CheckCode: check, Expires: now() + 180000}
	s.qrLogins.Lock()
	defer s.qrLogins.Unlock()
	for id, item := range s.qrLogins.items {
		if item.Expires <= now() {
			delete(s.qrLogins.items, id)
		}
	}
	if len(s.qrLogins.items) >= 1024 {
		fail(w, 503, "扫码登录繁忙，请稍后再试")
		return
	}
	s.qrLogins.items[id] = q
	// The scannable content never contains the secret that can redeem a session.
	ok(w, map[string]any{"id": id, "pollSecret": pollSecret, "payload": payload, "image": "data:image/png;base64," + base64.StdEncoding.EncodeToString(png), "expires": q.Expires, "checkCode": check})
}

func qrSecretEqual(value, expectedHash string) bool {
	return len(value) == 64 && subtle.ConstantTimeCompare([]byte(hashToken(value)), []byte(expectedHash)) == 1
}

func (s *Server) pollQRLogin(w http.ResponseWriter, r *http.Request) {
	var input qrRequest
	if !decode(w, r, &input) {
		return
	}
	s.qrLogins.Lock()
	defer s.qrLogins.Unlock()
	q := s.qrLogins.items[input.ID]
	if q == nil || !qrSecretEqual(input.PollSecret, q.PollHash) {
		fail(w, 404, "二维码已失效，请刷新")
		return
	}
	if q.Expires <= now() {
		delete(s.qrLogins.items, input.ID)
		ok(w, map[string]string{"state": "expired"})
		return
	}
	if q.State == "approved" {
		// Holding the lock makes simultaneous redemption attempts single-use.
		if s.issueSession(w, r, q.UserID) {
			delete(s.qrLogins.items, input.ID)
		}
		return
	}
	ok(w, map[string]any{"state": q.State, "expires": q.Expires})
}

func (s *Server) cancelQRLogin(w http.ResponseWriter, r *http.Request) {
	var input qrRequest
	if !decode(w, r, &input) {
		return
	}
	s.qrLogins.Lock()
	defer s.qrLogins.Unlock()
	if q := s.qrLogins.items[input.ID]; q != nil && qrSecretEqual(input.PollSecret, q.PollHash) {
		delete(s.qrLogins.items, input.ID)
	}
	ok(w, map[string]bool{"ok": true})
}

func (s *Server) scanQRLogin(w http.ResponseWriter, r *http.Request) {
	if !s.rate(r, "qr-scan:"+uid(r), 30, time.Minute) {
		fail(w, 429, "扫码次数过多，请稍后再试")
		return
	}
	var input qrRequest
	if !decode(w, r, &input) {
		return
	}
	s.qrLogins.Lock()
	defer s.qrLogins.Unlock()
	q := s.qrLogins.items[input.ID]
	if q == nil || q.Expires <= now() || !qrSecretEqual(input.Key, q.ScanHash) {
		fail(w, 404, "二维码已过期或不属于当前服务器")
		return
	}
	if q.State != "waiting" && q.State != "scanned" {
		fail(w, 409, "二维码已处理，请在电脑上刷新")
		return
	}
	if q.UserID != "" && (q.UserID != uid(r) || q.UserSession != sessionHash(r)) {
		fail(w, 403, "此二维码已由其他账号扫描")
		return
	}
	q.UserID, q.State = uid(r), "scanned"
	q.UserSession = sessionHash(r)
	ok(w, map[string]any{"state": q.State, "device": q.Device, "checkCode": q.CheckCode, "expires": q.Expires})
}

func (s *Server) confirmQRLogin(w http.ResponseWriter, r *http.Request) {
	var input qrRequest
	if !decode(w, r, &input) {
		return
	}
	s.qrLogins.Lock()
	defer s.qrLogins.Unlock()
	q := s.qrLogins.items[input.ID]
	if q == nil || q.Expires <= now() || !qrSecretEqual(input.Key, q.ScanHash) {
		fail(w, 404, "二维码已失效，请重新扫码")
		return
	}
	if q.State != "scanned" || q.UserID != uid(r) || q.UserSession != sessionHash(r) {
		fail(w, 403, "请先使用当前账号扫码")
		return
	}
	q.State = "rejected"
	if input.Accept {
		q.State = "approved"
	}
	ok(w, map[string]string{"state": q.State})
}
