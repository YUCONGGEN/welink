package client

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestProxyReusesConnectionsAndKeepsCredentialsPerRequest(t *testing.T) {
	var connections atomic.Int32
	up := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, r.Header.Get("Authorization")+"|"+r.Header.Get("Cookie"))
	}))
	up.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateNew {
			connections.Add(1)
		}
	}
	up.Start()
	defer up.Close()
	c, err := New(Options{Directory: t.TempDir(), Listen: "127.0.0.1:0", Server: up.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	for i := 0; i < 12; i++ {
		req := httptest.NewRequest("GET", "http://local/api/me", nil)
		req.Header.Set("Authorization", fmt.Sprint(i))
		req.Header.Set("Cookie", fmt.Sprintf("welink_local=private; welink_session=session%d; unrelated=private", i))
		rec := httptest.NewRecorder()
		c.proxy(rec, req)
		if rec.Code != 200 || rec.Body.String() != fmt.Sprintf("%d|welink_session=session%d", i, i) {
			t.Fatal("request identity leaked", rec.Code, rec.Body.String())
		}
	}
	if n := connections.Load(); n != 1 {
		t.Fatalf("12 sequential requests opened %d connections, want 1", n)
	}
}

func TestProxyConfigChangeRotatesServerAndCertificatePool(t *testing.T) {
	up := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "first") }))
	up.Config.ErrorLog = log.New(io.Discard, "", 0)
	up.StartTLS()
	defer up.Close()
	cert := sha256.Sum256(up.Certificate().Raw)
	c, err := New(Options{Directory: t.TempDir(), Listen: "127.0.0.1:0", Server: up.URL, Fingerprint: hex.EncodeToString(cert[:])})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	get := func(code int, body string) {
		t.Helper()
		rec := httptest.NewRecorder()
		c.proxy(rec, httptest.NewRequest("GET", "http://local/api/me", nil))
		if rec.Code != code || body != "" && rec.Body.String() != body {
			t.Fatalf("response %d %s", rec.Code, rec.Body.String())
		}
	}
	set := func(cfg Config) {
		t.Helper()
		raw, _ := json.Marshal(cfg)
		rec := httptest.NewRecorder()
		c.local(rec, httptest.NewRequest("POST", "http://local/local/config", strings.NewReader(string(raw))))
		if rec.Code != 200 {
			t.Fatal(rec.Body.String())
		}
	}
	get(200, "first")
	set(Config{Server: up.URL, Fingerprint: strings.Repeat("0", 64)})
	get(502, "") // Must not reuse a connection verified using the old pin.
	second := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "second") }))
	defer second.Close()
	set(Config{Server: second.URL})
	get(200, "second")
	set(Config{Server: up.URL, Fingerprint: hex.EncodeToString(cert[:])})
	get(200, "first")
}
