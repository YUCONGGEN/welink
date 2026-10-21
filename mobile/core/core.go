// Package core exposes the Go client to the Android native host via gomobile.
package core

import (
	"encoding/json"
	"path/filepath"
	"sync/atomic"
	"welink/internal/client"
)

type Engine struct {
	client        *client.Client
	accessibility atomic.Bool
}

// NotificationListener is held by the Application, never by a WebView Activity.
type NotificationListener interface{ OnNotification(string) }

func (e *Engine) SetNotificationListener(listener NotificationListener) {
	if listener == nil {
		e.client.SetNotificationHandler(nil)
		return
	}
	e.client.SetNotificationHandler(func(n client.Notification) { b, _ := json.Marshal(n); listener.OnNotification(string(b)) })
}
func (e *Engine) StopNotifications()          { _ = e.client.SetNotificationSession("") }
func (e *Engine) RestoreNotifications() error { return e.client.RestoreNotificationSession() }

func Start(directory string) (*Engine, error) {
	c, e := client.New(client.Options{Directory: directory, AssetsDirectory: filepath.Join(directory, "ui"), Listen: "127.0.0.1:18746", Mobile: true})
	if e != nil {
		return nil, e
	}
	return &Engine{client: c}, nil
}
func (e *Engine) URL() string             { return e.client.URL() }
func (e *Engine) Close()                  { e.client.Close() }
func (e *Engine) StateJSON() string       { b, _ := json.Marshal(e.client.Remote.State()); return string(b) }
func (e *Engine) SetSharing(enabled bool) { e.client.Remote.SetSharing(enabled) }
func (e *Engine) SubmitJPEG(data []byte, width, height int) error {
	return e.client.Remote.SubmitJPEG(data, width, height)
}
func (e *Engine) NextInput(timeout int) string { return e.client.Remote.NextInput(timeout) }
func (e *Engine) CanInput() bool {
	s := e.client.Remote.State()
	return e.accessibility.Load() && s.Sharing && s.Status == "connected" && s.Role == "host" && s.Mode == "control"
}
func (e *Engine) WantsFrame() bool {
	s := e.client.Remote.State()
	return s.Sharing && s.Status == "connected" && s.Role == "host"
}
func (e *Engine) StopRemote()                     { e.client.Remote.Stop() }
func (e *Engine) SetAccessibility(enabled bool)   { e.accessibility.Store(enabled) }
func (e *Engine) ReportInputError(message string) { e.client.Remote.SetError(message) }
