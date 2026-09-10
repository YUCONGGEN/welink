package core

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/gorilla/websocket"
	"sync"
	"time"
)

// Conference adapts YuDesk's native Android WebRTC signaling interface to the
// WeLink authenticated WebSocket transport. Media is handled by org.webrtc.
type Conference struct {
	conn *websocket.Conn
	mu   sync.Mutex
	once sync.Once
	done chan struct{}
}

func (e *Engine) OpenConference(code, token string) (*Conference, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	conn, err := e.client.DialConference(ctx, code, token)
	if err != nil {
		return nil, err
	}
	conn.SetReadLimit(64 << 10)
	c := &Conference{conn: conn, done: make(chan struct{})}
	go func() {
		t := time.NewTicker(20 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-c.done:
				return
			case <-t.C:
				if c.Send(`{"type":"ping"}`) != nil {
					c.Close()
					return
				}
			}
		}
	}()
	return c, nil
}
func (c *Conference) Read() (string, error) {
	_, raw, err := c.conn.ReadMessage()
	if err != nil {
		c.Close()
		return "", err
	}
	if !json.Valid(raw) {
		c.Close()
		return "", errors.New("会议数据格式错误")
	}
	return string(raw), nil
}
func (c *Conference) Send(raw string) error {
	if len(raw) > 64<<10 || !json.Valid([]byte(raw)) {
		return errors.New("会议信令无效")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return c.conn.WriteMessage(websocket.TextMessage, []byte(raw))
}
func (c *Conference) Close() { c.once.Do(func() { close(c.done); c.conn.Close() }) }
