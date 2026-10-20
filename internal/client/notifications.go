package client

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Notification contains display text only; credentials never leave the receiver.
type Notification struct {
	Unread         int    `json:"unread,omitempty"`
	Type           string `json:"type"`
	UserID         string `json:"userId,omitempty"`
	ConversationID string `json:"conversationId,omitempty"`
	MessageID      string `json:"messageId,omitempty"`
	ID             string `json:"id,omitempty"`
	State          string `json:"state,omitempty"`
	Reason         string `json:"reason,omitempty"`
	Mode           string `json:"mode,omitempty"`
	Started        int64  `json:"started,omitempty"`
	From           string `json:"from,omitempty"`
	FromName       string `json:"fromName,omitempty"`
	Recipient      string `json:"recipient,omitempty"`
	Requester      string `json:"requester,omitempty"`
	Host           string `json:"host,omitempty"`
	Code           string `json:"code,omitempty"`
	CanRespond     bool   `json:"canRespond,omitempty"`
	Expires        int64  `json:"expires,omitempty"`
	Title          string `json:"title,omitempty"`
	Body           string `json:"body,omitempty"`
}

type notificationState struct {
	mu       sync.Mutex
	token    string
	revision uint64
	cancel   context.CancelFunc
	handler  func(Notification)
}

var sessionTokenPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var notificationIDPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)
var errNotificationSession = errors.New("notification session expired")

func (c *Client) SetNotificationHandler(handler func(Notification)) {
	c.notifications.mu.Lock()
	c.notifications.handler = handler
	c.notifications.mu.Unlock()
}

// The receiver belongs to the process, not a WebView or Activity. A repeated
// login-page load with the same session cannot create another connection.
func (c *Client) SetNotificationSession(token string) error {
	if token != "" && !sessionTokenPattern.MatchString(token) {
		return errors.New("invalid notification session")
	}
	n := &c.notifications
	n.mu.Lock()
	defer n.mu.Unlock()
	if token == n.token {
		return nil
	}
	c.stopAI()
	if n.cancel != nil {
		n.cancel()
		n.cancel = nil
	}
	n.revision++
	n.token = token
	if n.handler != nil {
		n.handler(Notification{Type: "reset"})
	}
	if token == "" {
		return nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	n.cancel = cancel
	go c.receiveNotifications(ctx, n.revision, token, c.Config())
	return nil
}

func (c *Client) emitNotification(revision uint64, notice Notification) {
	n := &c.notifications
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.revision == revision && n.token != "" && n.handler != nil {
		n.handler(notice)
	}
}

func (c *Client) receiveNotifications(ctx context.Context, revision uint64, token string, cfg Config) {
	u, _ := validateConfig(cfg)
	transport := &http.Transport{TLSClientConfig: tlsConfig(cfg.Fingerprint)}
	defer transport.CloseIdleConnections()
	httpClient := &http.Client{Transport: transport, Timeout: 8 * time.Second}
	get := func(path string, out any) error {
		req, err := http.NewRequestWithContext(ctx, "GET", strings.TrimRight(cfg.Server, "/")+path, nil)
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := httpClient.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		if resp.StatusCode == 401 {
			return errNotificationSession
		}
		if resp.StatusCode == 204 {
			return nil
		}
		if resp.StatusCode != 200 {
			return errors.New("notification metadata unavailable")
		}
		return json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(out)
	}
	var me struct {
		ID string `json:"id"`
	}
	seen := make(map[string]bool)
	var order []string
	started := time.Now().UnixMilli()
	deliver := func(id string) error {
		if !notificationIDPattern.MatchString(id) || seen[id] {
			return nil
		}
		var notice Notification
		if err := get("/api/messages/"+id+"/notification", &notice); err != nil {
			return err
		}
		seen[id] = true
		order = append(order, id)
		if len(order) > 512 {
			delete(seen, order[0])
			order = order[1:]
		}
		if notice.MessageID != "" {
			notice.Type = "message"
			notice.UserID = me.ID
			c.emitNotification(revision, notice)
		}
		return nil
	}
	deliverEvent := func(kind string, data json.RawMessage) error {
		var notice Notification
		switch kind {
		case "call":
			var ref struct {
				ID string `json:"id"`
			}
			if json.Unmarshal(data, &ref) != nil || !notificationIDPattern.MatchString(ref.ID) {
				return nil
			}
			var call struct {
				ID             string `json:"id"`
				ConversationID string `json:"conversationId"`
				Caller         string `json:"caller"`
				Callee         string `json:"callee"`
				Mode           string `json:"mode"`
				State          string `json:"state"`
				Reason         string `json:"reason"`
				Started        int64  `json:"started"`
				Expires        int64  `json:"expires"`
				CanRespond     bool   `json:"canRespond"`
				Peer           struct {
					Name string `json:"name"`
				} `json:"peer"`
			}
			if err := get("/api/calls/"+ref.ID, &call); err != nil {
				return err
			}
			notice = Notification{Type: "call", ID: call.ID, ConversationID: call.ConversationID, From: call.Caller, Recipient: call.Callee, Mode: call.Mode, State: call.State, Reason: call.Reason, Started: call.Started, CanRespond: call.CanRespond, Expires: call.Expires, Title: call.Peer.Name, UserID: me.ID}
		case "meeting-invite":
			if json.Unmarshal(data, &notice) != nil {
				return nil
			}
			notice.Type = "meeting"
			notice.State = "pending"
			notice.UserID = me.ID
		case "meeting-ended":
			if json.Unmarshal(data, &notice) != nil {
				return nil
			}
			notice.Type = "meeting"
			notice.State = "ended"
			notice.UserID = me.ID
		case "remote":
			if json.Unmarshal(data, &notice) != nil {
				return nil
			}
			notice.Type = "remote"
			notice.UserID = me.ID
			notice.From = notice.Requester
			if notice.From != "" {
				var profile struct {
					Name string `json:"name"`
				}
				if get("/api/users/"+notice.From, &profile) == nil {
					notice.Title = profile.Name
				}
			}
		default:
			return nil
		}
		if notice.Title == "" {
			if notice.Type == "meeting" {
				notice.Title = "会议邀请"
			} else if notice.Type == "remote" {
				notice.Title = "远程协助邀请"
			}
		}
		c.emitNotification(revision, notice)
		return nil
	}
	refreshUnread := func() error {
		var rows []struct {
			Unread, MentionCount int
			Muted                bool
		}
		if err := get("/api/conversations", &rows); err != nil {
			return err
		}
		count := 0
		for _, row := range rows {
			if row.Muted {
				count += row.MentionCount
			} else {
				count += row.Unread
			}
		}
		c.emitNotification(revision, Notification{Type: "unread", UserID: me.ID, Unread: count})
		return nil
	}
	u.Scheme = strings.Replace(u.Scheme, "http", "ws", 1)
	u.Path = "/api/ws"
	dialer := websocket.Dialer{TLSClientConfig: tlsConfig(cfg.Fingerprint), HandshakeTimeout: 10 * time.Second}
	for ctx.Err() == nil {
		err := get("/api/me", &me)
		if errors.Is(err, errNotificationSession) {
			c.emitNotification(revision, Notification{Type: "signed-out"})
			return
		}
		if err == nil {
			conn, response, dialErr := dialer.DialContext(ctx, u.String(), http.Header{"Authorization": []string{"Bearer " + token}})
			if response != nil && response.Body != nil {
				response.Body.Close()
			}
			if dialErr == nil {
				c.emitNotification(revision, Notification{Type: "connected", UserID: me.ID})
				stop := context.AfterFunc(ctx, func() { conn.Close() })
				conn.SetReadLimit(4 << 20)
				_ = conn.SetReadDeadline(time.Now().Add(70 * time.Second))
				conn.SetPingHandler(func(data string) error {
					_ = conn.SetReadDeadline(time.Now().Add(70 * time.Second))
					return conn.WriteControl(websocket.PongMessage, []byte(data), time.Now().Add(5*time.Second))
				})
				// Reading independently keeps ping/pong responsive during HTTP lookups.
				type incomingEvent struct {
					kind, id string
					data     json.RawMessage
				}
				events := make(chan incomingEvent, 128)
				closed := make(chan struct{})
				userID := me.ID
				go func() {
					defer close(closed)
					for {
						var event struct {
							Type string          `json:"type"`
							Data json.RawMessage `json:"data"`
						}
						if conn.ReadJSON(&event) != nil {
							return
						}
						if event.Type == "read" || event.Type == "conversation" || event.Type == "message-deleted" || event.Type == "recall" {
							select {
							case events <- incomingEvent{kind: "refresh"}:
							default:
								conn.Close()
								return
							}
						}
						if event.Type == "message" {
							var message struct{ ID, Sender string }
							if json.Unmarshal(event.Data, &message) != nil || message.Sender == userID {
								continue
							}
							select {
							case events <- incomingEvent{kind: "message", id: message.ID}:
							default:
								conn.Close()
								return
							}
						}
						if event.Type == "call" || event.Type == "meeting-invite" || event.Type == "meeting-ended" || event.Type == "remote" {
							select {
							case events <- incomingEvent{kind: event.Type, data: event.Data}:
							default:
								conn.Close()
								return
							}
						}
					}
				}()
				// Reconnect catches the latest unread message per conversation received
				// while transport was down, without replaying old login history.
				var conversations []struct {
					Unread int
					Last   struct {
						ID, Sender string
						Created    int64
					}
				}
				if get("/api/conversations", &conversations) == nil {
					for _, cv := range conversations {
						if cv.Unread > 0 && cv.Last.Created >= started && cv.Last.Sender != me.ID {
							_ = deliver(cv.Last.ID)
						}
					}
				}
				_ = refreshUnread()
			loop:
				for {
					select {
					case <-ctx.Done():
						break loop
					case <-closed:
						break loop
					case event := <-events:
						var err error
						switch event.kind {
						case "message":
							err = deliver(event.id)
						case "refresh":
						case "call", "meeting-invite", "meeting-ended", "remote":
							err = deliverEvent(event.kind, event.data)
						}
						if err == nil {
							err = refreshUnread()
						}
						if errors.Is(err, errNotificationSession) {
							c.emitNotification(revision, Notification{Type: "signed-out"})
							stop()
							conn.Close()
							return
						}
						if err != nil {
							break loop
						}
					}
				}
				stop()
				conn.Close()
			}
		}
		if ctx.Err() != nil {
			return
		}
		c.emitNotification(revision, Notification{Type: "reconnecting", UserID: me.ID})
		select {
		case <-ctx.Done():
			return
		case <-time.After(2500 * time.Millisecond):
		}
	}
}
