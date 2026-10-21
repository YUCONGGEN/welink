package server

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
	"welink/internal/client"
)

// This opt-in fixture uses an isolated database and a fake email sender. It never
// sends mail or reads credentials from a deployed server.
type browserEmailSender struct {
	mu sync.Mutex
	path string
	codes map[string]string
}
func (m *browserEmailSender) SendOTP(_ context.Context, email, code string) error {
	m.mu.Lock(); defer m.mu.Unlock()
	m.codes[email] = code
	raw, err := json.Marshal(m.codes)
	if err != nil { return err }
	return os.WriteFile(m.path, raw, 0600)
}
func TestBrowserRegressionFixture(t *testing.T) {
	dir := os.Getenv("LINKME_BROWSER_FIXTURE")
	if dir == "" { t.Skip("opt-in isolated browser regression fixture") }
	if err := os.MkdirAll(dir, 0700); err != nil { t.Fatal(err) }
	cfg := DefaultSettings()
	cfg.Registration.Enabled = true
	cfg.EmailAuth = EmailAuthSettings{Enabled:true, CredentialsFile:"test-injected"}
	mail := &browserEmailSender{path:filepath.Join(dir,"mail.json"),codes:map[string]string{}}
	s, err := New(Config{DataDir:t.TempDir(), Settings:&cfg, EmailSender:mail})
	if err != nil { t.Fatal(err) }; defer s.Close()
	listener, err := net.Listen("tcp", "0.0.0.0:18288")
	if err != nil { t.Fatal(err) }
	httpServer := &http.Server{Handler:s.Handler(),ReadHeaderTimeout:5*time.Second}
	defer httpServer.Close(); go httpServer.Serve(listener)
	c, err := client.New(client.Options{Directory:filepath.Join(dir,"client"), Listen:"0.0.0.0:18788", Server:"http://127.0.0.1:18288"})
	if err != nil { t.Fatal(err) }; defer c.Close()
	if err := os.WriteFile(filepath.Join(dir,"client.url"),[]byte(c.URL()),0600); err != nil { t.Fatal(err) }
	for {
		if _, err := os.Stat(filepath.Join(dir,"stop")); err == nil { return }
		time.Sleep(200*time.Millisecond)
	}
}
