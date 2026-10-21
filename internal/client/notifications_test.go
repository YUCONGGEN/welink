package client

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestNotificationReceiverRestoresAndReconnectsWithoutUI(t *testing.T) {
	const messageID = "11111111111111111111111111111111"
	connections := make(chan *websocket.Conn, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 64) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/api/me":
			fmt.Fprint(w, `{"id":"me"}`)
		case "/api/conversations":
			// This message predates the recreated process. It must still notify.
			fmt.Fprintf(w, `[{"unread":1,"last":{"id":%q,"sender":"other","created":1}}]`, messageID)
		case "/api/messages/" + messageID + "/notification":
			fmt.Fprintf(w, `{"messageId":%q,"conversationId":"chat","title":"Alice","body":"background message"}`, messageID)
		case "/api/ws":
			conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
			if err != nil {
				return
			}
			defer conn.Close()
			connections <- conn
			for {
				if _, _, err := conn.ReadMessage(); err != nil {
					return
				}
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	dir := t.TempDir()
	create := func() *Client {
		c, err := New(Options{Directory: dir, Listen: "127.0.0.1:0", Server: server.URL, Mobile: true})
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	first := create()
	if err := first.SetNotificationSession(strings.Repeat("a", 64)); err != nil {
		t.Fatal(err)
	}
	select {
	case <-connections:
	case <-time.After(5 * time.Second):
		t.Fatal("initial receiver did not connect")
	}
	first.Close()
	if _, err := os.Stat(first.notificationSessionPath()); err != nil {
		t.Fatal("process shutdown lost the login session:", err)
	}

	restored := create()
	defer restored.Close()
	notices := make(chan Notification, 32)
	restored.SetNotificationHandler(func(n Notification) { notices <- n })
	if err := restored.RestoreNotificationSession(); err != nil {
		t.Fatal(err)
	}
	waitNotice := func(kind string) Notification {
		t.Helper()
		timer := time.NewTimer(8 * time.Second)
		defer timer.Stop()
		for {
			select {
			case n := <-notices:
				if n.Type == kind {
					return n
				}
			case <-timer.C:
				t.Fatalf("no %s notification without a WebView", kind)
				return Notification{}
			}
		}
	}
	waitNotice("connected")
	if n := waitNotice("message"); n.MessageID != messageID {
		t.Fatalf("lost unread message: %+v", n)
	}
	var conn *websocket.Conn
	select {
	case conn = <-connections:
	case <-time.After(5 * time.Second):
		t.Fatal("no restored websocket")
	}
	conn.Close() // Network loss while the Activity does not exist.
	waitNotice("reconnecting")
	waitNotice("connected")
	if err := restored.SetNotificationSession(""); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(restored.notificationSessionPath()); !os.IsNotExist(err) {
		t.Fatal("logout retained credentials:", err)
	}
}

func TestNotificationRestoreDiscardsInvalidAndExpiredSessions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusUnauthorized) }))
	defer server.Close()
	c, err := New(Options{Directory: t.TempDir(), Listen: "127.0.0.1:0", Server: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if err := os.WriteFile(c.notificationSessionPath(), []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := c.RestoreNotificationSession(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(c.notificationSessionPath()); !os.IsNotExist(err) {
		t.Fatal("invalid session was retained")
	}
	done := make(chan struct{}, 1)
	c.SetNotificationHandler(func(n Notification) {
		if n.Type == "signed-out" {
			done <- struct{}{}
		}
	})
	if err := c.SetNotificationSession(strings.Repeat("a", 64)); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("expired session was not rejected")
	}
	// Synchronize with the expiry handler before checking its state.
	c.notifications.mu.Lock()
	defer c.notifications.mu.Unlock()
	if c.notifications.token != "" {
		t.Fatal("expired token still active")
	}
	if _, err := os.Stat(c.notificationSessionPath()); !os.IsNotExist(err) {
		t.Fatal("expired session was retained")
	}
}
