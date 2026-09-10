package server

import (
	"github.com/gorilla/websocket"
	"net/http"
	"regexp"
	"time"
)

type Remote struct {
	ID             string `json:"id"`
	ConversationID string `json:"conversationId"`
	Requester      string `json:"requester"`
	Recipient      string `json:"recipient"`
	Host           string `json:"host"`
	Mode           string `json:"mode"`
	State          string `json:"state"`
	DeviceID       string `json:"deviceId"`
	Created        int64  `json:"created"`
	Updated        int64  `json:"updated"`
}

func (s *Server) remote(id string) (v Remote, e error) {
	e = s.db.QueryRow("SELECT id,conversation_id,requester,recipient,host,mode,state,device_id,created,updated FROM remotes WHERE id=?", id).Scan(&v.ID, &v.ConversationID, &v.Requester, &v.Recipient, &v.Host, &v.Mode, &v.State, &v.DeviceID, &v.Created, &v.Updated)
	return
}
func (s *Server) publishRemote(v Remote) { s.push([]string{v.Requester, v.Recipient}, "remote", v) }
func (s *Server) inviteRemote(w http.ResponseWriter, r *http.Request) {
	if !s.rate(r, "remote:"+uid(r), 12, time.Minute) {
		fail(w, 429, "远程邀请过于频繁")
		return
	}
	var p struct{ ConversationID, Mode, Direction, DeviceID string }
	if !decode(w, r, &p) {
		return
	}
	if (p.Mode != "view" && p.Mode != "control") || !s.member(p.ConversationID, uid(r)) {
		fail(w, 400, "无效的远程协助请求")
		return
	}
	var kind string
	_ = s.db.QueryRow("SELECT kind FROM conversations WHERE id=?", p.ConversationID).Scan(&kind)
	if kind != "direct" {
		fail(w, 400, "请在好友单聊中发起远程协助")
		return
	}
	var recipient string
	_ = s.db.QueryRow("SELECT user_id FROM members WHERE conversation_id=? AND user_id<>?", p.ConversationID, uid(r)).Scan(&recipient)
	if !s.online(recipient) {
		fail(w, 409, "对方当前不在线")
		return
	}
	host := recipient
	device := ""
	if p.Direction == "share" {
		host = uid(r)
		device = p.DeviceID
		if !regexp.MustCompile(`^[A-Fa-f0-9]{24}$`).MatchString(device) {
			fail(w, 400, "请在客户端开启共享")
			return
		}
	}
	var busy int
	_ = s.db.QueryRow("SELECT COUNT(*) FROM remotes WHERE ((state='pending' AND updated>?) OR (state='accepted' AND updated>?)) AND (requester IN (?,?) OR recipient IN (?,?))", now()-60000, now()-7200000, uid(r), recipient, uid(r), recipient).Scan(&busy)
	if busy > 0 {
		fail(w, 409, "已有远程协助正在等待或进行中")
		return
	}
	v := Remote{ID: newID(), ConversationID: p.ConversationID, Requester: uid(r), Recipient: recipient, Host: host, Mode: p.Mode, State: "pending", DeviceID: device, Created: now(), Updated: now()}
	_, e := s.db.Exec("INSERT INTO remotes VALUES(?,?,?,?,?,?,?,?,?,?)", v.ID, v.ConversationID, v.Requester, v.Recipient, v.Host, v.Mode, v.State, v.DeviceID, v.Created, v.Updated)
	if e != nil {
		s.dbError(w, e)
		return
	}
	s.publishRemote(v)
	ok(w, v)
}
func (s *Server) getRemote(w http.ResponseWriter, r *http.Request) {
	v, e := s.remote(r.PathValue("id"))
	if e != nil || (uid(r) != v.Requester && uid(r) != v.Recipient) {
		fail(w, 404, "远程协助不存在")
		return
	}
	if v.State == "pending" && now()-v.Created > 60000 {
		_, _ = s.db.Exec("UPDATE remotes SET state='expired',updated=? WHERE id=? AND state='pending'", now(), v.ID)
		v.State = "expired"
	}
	ok(w, v)
}
func (s *Server) respondRemote(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Accept   bool
		DeviceID string
	}
	if !decode(w, r, &p) {
		return
	}
	v, e := s.remote(r.PathValue("id"))
	if e != nil || v.Recipient != uid(r) {
		fail(w, 403, "无法处理此邀请")
		return
	}
	if v.State != "pending" || now()-v.Created > 60000 {
		fail(w, 409, "邀请已失效")
		return
	}
	state := "rejected"
	if p.Accept {
		state = "accepted"
		if v.Host == uid(r) {
			if !regexp.MustCompile(`^[A-Fa-f0-9]{24}$`).MatchString(p.DeviceID) {
				fail(w, 400, "客户端设备身份无效")
				return
			}
			v.DeviceID = p.DeviceID
		}
	}
	res, e := s.db.Exec("UPDATE remotes SET state=?,device_id=?,updated=? WHERE id=? AND state='pending'", state, v.DeviceID, now(), v.ID)
	if e != nil {
		s.dbError(w, e)
		return
	}
	if n, _ := res.RowsAffected(); n != 1 {
		fail(w, 409, "邀请已处理")
		return
	}
	v.State = state
	v.Updated = now()
	s.publishRemote(v)
	ok(w, v)
}
func (s *Server) endRemote(w http.ResponseWriter, r *http.Request) {
	v, e := s.remote(r.PathValue("id"))
	if e != nil || (uid(r) != v.Requester && uid(r) != v.Recipient) {
		fail(w, 404, "远程协助不存在")
		return
	}
	_, e = s.db.Exec("UPDATE remotes SET state='ended',updated=? WHERE id=?", now(), v.ID)
	if e != nil {
		s.dbError(w, e)
		return
	}
	s.closeRoom(v.ID)
	v.State = "ended"
	v.Updated = now()
	s.publishRemote(v)
	ok(w, v)
}
func (s *Server) closeRoom(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range s.rooms[id] {
		c.close()
	}
	delete(s.rooms, id)
}
func (s *Server) tunnel(w http.ResponseWriter, r *http.Request) {
	v, e := s.remote(r.PathValue("id"))
	user := uid(r)
	if e != nil || v.State != "accepted" || (user != v.Requester && user != v.Recipient) || now()-v.Updated > 7200000 {
		fail(w, 403, "远程协助未获双方同意或已结束")
		return
	}
	if !s.member(v.ConversationID, user) {
		fail(w, 403, "不再属于该会话")
		return
	}
	conn, e := upgrader.Upgrade(w, r, nil)
	if e != nil {
		return
	}
	c := &socket{c: conn, send: make(chan []byte, 32), done: make(chan struct{})}
	s.mu.Lock()
	if s.rooms[v.ID] == nil {
		s.rooms[v.ID] = map[string]*socket{}
	}
	room := s.rooms[v.ID]
	if room[user] != nil {
		s.mu.Unlock()
		c.close()
		return
	}
	room[user] = c
	s.mu.Unlock()
	defer func() {
		s.closeRoom(v.ID)
		_, _ = s.db.Exec("UPDATE remotes SET state='ended',updated=? WHERE id=? AND state='accepted'", now(), v.ID)
		v.State = "ended"
		s.publishRemote(v)
	}()
	go func() {
		tick := time.NewTicker(20 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-c.done:
				return
			case p := <-c.send:
				_ = conn.SetWriteDeadline(time.Now().Add(15 * time.Second))
				if conn.WriteMessage(websocket.BinaryMessage, p) != nil {
					c.close()
					return
				}
			case <-tick.C:
				if now()-v.Created > 7200000 {
					c.close()
					return
				}
				if conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
					c.close()
					return
				}
			}
		}
	}()
	conn.SetReadLimit(128 << 10)
	_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(60 * time.Second)) })
	for {
		typ, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if typ != websocket.BinaryMessage {
			return
		}
		var peer *socket
		deadline := time.NewTimer(30 * time.Second)
		tick := time.NewTicker(20 * time.Millisecond)
		for peer == nil {
			s.mu.Lock()
			for id, other := range s.rooms[v.ID] {
				if id != user {
					peer = other
				}
			}
			s.mu.Unlock()
			if peer != nil {
				break
			}
			select {
			case <-deadline.C:
				tick.Stop()
				return
			case <-c.done:
				deadline.Stop()
				tick.Stop()
				return
			case <-tick.C:
			}
		}
		deadline.Stop()
		tick.Stop()
		select {
		case peer.send <- data:
		case <-peer.done:
			return
		case <-c.done:
			return
		case <-time.After(15 * time.Second):
			return
		}
	}
}
