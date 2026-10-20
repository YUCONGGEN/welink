// Package remote integrates YuDesk's authenticated encryption, P2P negotiation,
// screen capture and input with WeLink's explicitly accepted chat invitations.
package remote

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"encoding/json"
	"errors"
	"github.com/gorilla/websocket"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"
	"welink/internal/yudesk/desktop"
	"welink/internal/yudesk/peerpath"
	"welink/internal/yudesk/protocol"
	"welink/internal/yudesk/secureconn"
)

type Invitation struct {
	ID        string `json:"id"`
	Host      string `json:"host"`
	Requester string `json:"requester"`
	Recipient string `json:"recipient"`
	Mode      string `json:"mode"`
	State     string `json:"state"`
	DeviceID  string `json:"deviceId"`
}
type State struct {
	ID       string `json:"id"`
	DeviceID string `json:"deviceId"`
	Role     string `json:"role"`
	Mode     string `json:"mode"`
	Status   string `json:"status"`
	Path     string `json:"path"`
	Error    string `json:"error"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Frame    uint64 `json:"frame"`
	RTT      int64  `json:"rtt"`
	Sharing  bool   `json:"sharing"`
}
type Engine struct {
	mu                        sync.Mutex
	key                       ed25519.PrivateKey
	state                     State
	cancel                    context.CancelFunc
	conn                      *protocol.Conn
	frame                     []byte
	inputs                    chan string
	performance               Performance
	mobile                    bool
	sharing                   bool
	sourceWidth, sourceHeight int
	held                      map[string]desktop.InputEvent
}

func New(dir string, mobile bool) (*Engine, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "remote-identity.key")
	key, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		_, key, err = ed25519.GenerateKey(rand.Reader)
		if err == nil {
			err = os.WriteFile(path, key, 0600)
		}
	}
	if err != nil {
		return nil, err
	}
	if len(key) != ed25519.PrivateKeySize {
		return nil, errors.New("invalid local identity")
	}
	e := &Engine{key: key, mobile: mobile, inputs: make(chan string, 64), held: map[string]desktop.InputEvent{}}
	e.performance, err = loadPerformance(dir)
	if err != nil {
		return nil, err
	}
	e.state = State{DeviceID: secureconn.DeviceID(e.key.Public().(ed25519.PublicKey)), Status: "idle"}
	return e, nil
}
func (e *Engine) State() State {
	e.mu.Lock()
	defer e.mu.Unlock()
	s := e.state
	s.Sharing = e.sharing
	return s
}
func (e *Engine) SetError(message string) { e.mu.Lock(); e.state.Error = message; e.mu.Unlock() }
func (e *Engine) Frame() ([]byte, State) {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]byte(nil), e.frame...), e.state
}
func (e *Engine) SetSharing(enabled bool) {
	e.mu.Lock()
	e.sharing = enabled
	host := e.state.Role == "host"
	e.mu.Unlock()
	if !enabled && host {
		e.Stop()
	}
}
func (e *Engine) Stop() {
	e.mu.Lock()
	cancel := e.cancel
	e.cancel = nil
	c := e.conn
	e.conn = nil
	e.state.Status = "ended"
	e.frame = nil
	e.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if c != nil {
		_ = c.Close()
	}
	e.release()
}
func (e *Engine) Start(inv Invitation, user, token, baseURL string, config *tls.Config) error {
	if inv.State != "accepted" || (user != inv.Requester && user != inv.Recipient) {
		return errors.New("远程邀请未获双方同意")
	}
	role := "viewer"
	if inv.Host == user {
		role = "host"
	}
	e.mu.Lock()
	if e.state.ID == inv.ID && e.cancel != nil {
		e.mu.Unlock()
		return nil
	}
	if e.cancel != nil {
		e.mu.Unlock()
		return errors.New("请先结束当前远程协助")
	}
	if role == "host" && e.mobile && !e.sharing {
		e.mu.Unlock()
		return errors.New("请先授权 Android 屏幕共享")
	}
	if role == "host" && inv.DeviceID != e.state.DeviceID {
		e.mu.Unlock()
		return errors.New("共享设备身份不匹配")
	}
	ctx, cancel := context.WithCancel(context.Background())
	e.cancel = cancel
	e.state = State{ID: inv.ID, DeviceID: e.state.DeviceID, Role: role, Mode: inv.Mode, Status: "connecting"}
	e.mu.Unlock()
	go e.run(ctx, inv, user, token, baseURL, config)
	return nil
}
func (e *Engine) run(ctx context.Context, inv Invitation, user, token, baseURL string, config *tls.Config) {
	var finalErr error
	defer func() {
		e.mu.Lock()
		if e.state.ID == inv.ID {
			e.state.Status = "ended"
			if finalErr != nil && ctx.Err() == nil {
				e.state.Error = finalErr.Error()
			}
			if e.cancel != nil {
				e.cancel()
			}
			e.cancel = nil
			if e.conn != nil {
				e.conn.Close()
			}
			e.conn = nil
		}
		e.mu.Unlock()
		e.release()
	}()
	u, err := url.Parse(baseURL)
	if err != nil {
		finalErr = err
		return
	}
	u.Path = "/api/remotes/" + inv.ID + "/tunnel"
	if u.Scheme == "https" {
		u.Scheme = "wss"
	} else {
		u.Scheme = "ws"
	}
	d := websocket.Dialer{TLSClientConfig: config, HandshakeTimeout: 15 * time.Second, NetDialContext: (&net.Dialer{Timeout: 10 * time.Second}).DialContext}
	ws, _, err := d.DialContext(ctx, u.String(), http.Header{"Authorization": []string{"Bearer " + token}})
	if err != nil {
		finalErr = err
		return
	}
	raw := websocketPipe(ws)
	stop := context.AfterFunc(ctx, func() { raw.Close() })
	defer stop()
	defer raw.Close()
	var secure net.Conn
	if inv.Host == user {
		secure, err = secureconn.Accept(raw, e.key)
	} else {
		secure, err = secureconn.Connect(raw, inv.DeviceID)
	}
	if err != nil {
		finalErr = err
		return
	}
	base := protocol.NewConn(secure)
	role := "viewer"
	if inv.Host == user {
		role = "agent"
	}
	pc, info, err := negotiateTransport(ctx, base, role, peerpath.Options{STUNURLs: e.performance.STUNURLs, Timeout: time.Duration(e.performance.DirectTimeoutMS) * time.Millisecond, PortMapping: e.performance.PortMapping})
	if err != nil {
		finalErr = err
		return
	}
	defer pc.Close()
	pc.EnableInterleaving()
	pc.SetBulkRate(e.performance.MaxMbps * 1000000 / 8)
	e.mu.Lock()
	e.conn = pc
	e.state.Status = "connected"
	e.state.Path = info.Mode
	e.mu.Unlock()
	if role == "agent" && !e.mobile {
		go e.capture(ctx, pc)
	}
	go e.ping(ctx, pc)
	for {
		m, err := pc.ReadMessage()
		if err != nil {
			finalErr = err
			return
		}
		switch m.Method {
		case "frame":
			if role != "viewer" || len(m.Data) > 16<<20 {
				finalErr = errors.New("unexpected frame")
				return
			}
			var meta struct{ Width, Height int }
			_ = json.Unmarshal(m.Params, &meta)
			if meta.Width < 1 || meta.Height < 1 || meta.Width > 8192 || meta.Height > 8192 {
				continue
			}
			e.mu.Lock()
			e.frame = m.Data
			e.state.Width = meta.Width
			e.state.Height = meta.Height
			e.state.Frame++
			e.mu.Unlock()
		case "input":
			if role != "agent" || inv.Mode != "control" {
				finalErr = errors.New("viewing session rejected input")
				return
			}
			var events []desktop.InputEvent
			if json.Unmarshal(m.Params, &events) != nil || len(events) > 64 {
				finalErr = errors.New("invalid input")
				return
			}
			if e.mobile {
				e.mu.Lock()
				allowed := e.sharing
				e.mu.Unlock()
				if allowed {
					select {
					case e.inputs <- string(m.Params):
					default:
						finalErr = errors.New("input queue full")
						return
					}
				}
			} else {
				if err := e.apply(events); err != nil {
					_ = pc.WriteMessage(protocol.Message{Kind: "event", Method: "error", Error: err.Error()})
				}
			}
		case "release":
			if role == "agent" {
				e.release()
			}
		case "ping":
			_ = pc.WriteMessage(protocol.Message{Kind: "event", Method: "pong", ID: m.ID})
		case "pong":
			var sent int64
			_ = json.Unmarshal([]byte(m.ID), &sent)
			e.mu.Lock()
			e.state.RTT = time.Now().UnixMilli() - sent
			e.mu.Unlock()
		case "error":
			e.mu.Lock()
			e.state.Error = m.Error
			e.mu.Unlock()
		}
	}
}
func (e *Engine) ping(ctx context.Context, pc *protocol.Conn) {
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			b, _ := json.Marshal(time.Now().UnixMilli())
			if pc.WriteMessage(protocol.Message{Kind: "event", Method: "ping", ID: string(b)}) != nil {
				return
			}
		}
	}
}
func (e *Engine) capture(ctx context.Context, pc *protocol.Conn) {
	controller := e.performance.controller()
	budget := e.performance.interval()
	t := time.NewTicker(budget)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			started := time.Now()
			shot, err := desktop.CaptureWithOptions(desktop.CaptureOptions{Quality: controller.Quality, MaxWidth: controller.Width})
			if err != nil {
				e.mu.Lock()
				e.state.Error = err.Error()
				e.mu.Unlock()
				continue
			}
			e.mu.Lock()
			e.sourceWidth = shot.SourceWidth
			e.sourceHeight = shot.SourceHeight
			e.mu.Unlock()
			p, _ := json.Marshal(map[string]int{"width": shot.Width, "height": shot.Height})
			if pc.WriteMessageContext(ctx, protocol.Message{Kind: "event", Method: "frame", Params: p, Data: shot.JPEG}) != nil {
				return
			}
			e.mu.Lock()
			e.state.Width = shot.Width
			e.state.Height = shot.Height
			e.state.Frame++
			rtt := e.state.RTT
			e.mu.Unlock()
			controller.Ack(time.Duration(rtt) * time.Millisecond)
			controller.Update(time.Now(), time.Since(started), budget, shot.SourceWidth)
		}
	}
}
func (e *Engine) SendInput(events []desktop.InputEvent) error {
	e.mu.Lock()
	c := e.conn
	allowed := e.state.Status == "connected" && e.state.Role == "viewer" && e.state.Mode == "control"
	e.mu.Unlock()
	if c == nil || !allowed {
		return errors.New("当前会话不允许控制")
	}
	if len(events) > 64 {
		return errors.New("too many input events")
	}
	p, err := json.Marshal(events)
	if err != nil {
		return err
	}
	return c.WriteMessage(protocol.Message{Kind: "event", Method: "input", Params: p})
}
func (e *Engine) ReleaseInput() {
	e.mu.Lock()
	c := e.conn
	e.mu.Unlock()
	if c != nil {
		_ = c.WriteMessage(protocol.Message{Kind: "event", Method: "release"})
	}
}
func (e *Engine) apply(events []desktop.InputEvent) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	for i := range events {
		v := &events[i]
		if v.Type == "move" {
			if e.state.Width > 0 {
				v.X = v.X * e.sourceWidth / e.state.Width
			}
			if e.state.Height > 0 {
				v.Y = v.Y * e.sourceHeight / e.state.Height
			}
		}
		key := v.Code
		if key == "" {
			key = v.Key
		}
		if v.Type == "down" {
			key = string(rune(v.Button + 1000))
			e.held[key] = *v
		}
		if v.Type == "up" {
			delete(e.held, string(rune(v.Button+1000)))
		}
		if v.Type == "key_down" {
			e.held[key] = *v
		}
		if v.Type == "key_up" {
			delete(e.held, key)
		}
	}
	return desktop.ApplyInput(events)
}
func (e *Engine) release() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.mobile {
		select {
		case e.inputs <- `[{"type":"release"}]`:
		default:
		}
		return
	}
	if len(e.held) == 0 {
		return
	}
	events := []desktop.InputEvent{}
	for _, v := range e.held {
		if v.Type == "down" {
			v.Type = "up"
		} else {
			v.Type = "key_up"
		}
		events = append(events, v)
	}
	e.held = map[string]desktop.InputEvent{}
	_ = desktop.ApplyInput(events)
}
func (e *Engine) SubmitJPEG(data []byte, width, height int) error {
	e.mu.Lock()
	c := e.conn
	allowed := e.mobile && e.sharing && e.state.Role == "host" && e.state.Status == "connected"
	e.mu.Unlock()
	if !allowed || c == nil {
		return nil
	}
	if width < 1 || height < 1 || width > 4096 || height > 4096 || len(data) > 16<<20 {
		return errors.New("invalid mobile frame")
	}
	p, _ := json.Marshal(map[string]int{"width": width, "height": height})
	err := c.WriteMessage(protocol.Message{Kind: "event", Method: "frame", Params: p, Data: data})
	if err == nil {
		e.mu.Lock()
		e.state.Width = width
		e.state.Height = height
		e.state.Frame++
		e.mu.Unlock()
	}
	return err
}
func (e *Engine) NextInput(timeout int) string {
	select {
	case s := <-e.inputs:
		return s
	case <-time.After(time.Duration(min(max(timeout, 1), 1000)) * time.Millisecond):
		return ""
	}
}
func websocketPipe(ws *websocket.Conn) net.Conn {
	a, b := net.Pipe()
	var once sync.Once
	closeAll := func() { once.Do(func() { a.Close(); b.Close(); ws.Close() }) }
	ws.SetReadLimit(128 << 10)
	go func() {
		defer closeAll()
		for {
			typ, data, err := ws.ReadMessage()
			if err != nil {
				return
			}
			if typ != websocket.BinaryMessage {
				return
			}
			if _, err = b.Write(data); err != nil {
				return
			}
		}
	}()
	go func() {
		defer closeAll()
		buf := make([]byte, 32<<10)
		for {
			n, err := b.Read(buf)
			if err != nil && err != io.EOF {
				return
			}
			if n > 0 {
				_ = ws.SetWriteDeadline(time.Now().Add(20 * time.Second))
				if ws.WriteMessage(websocket.BinaryMessage, buf[:n]) != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()
	return a
}
