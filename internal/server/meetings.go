package server

// Room signaling and host succession follow E:/yudesk/cmd/yudesk-relay/conference.go.
// Authentication is adapted to LinkMe sessions. WebRTC media stays on peer links.
import (
	"crypto/rand"
	"encoding/json"
	"math/big"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"
)

const maxMeetingPeers = 8

type meetingPeer struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Number     string `json:"number"`
	Host       bool   `json:"host,omitempty"`
	Microphone bool   `json:"microphone,omitempty"`
	Camera     bool   `json:"camera,omitempty"`
	Screen     bool   `json:"screen,omitempty"`
	Recording  bool   `json:"recording,omitempty"`
}
type meetingSignal struct {
	Started    int64         `json:"started,omitempty"`
	Type       string        `json:"type"`
	ID         string        `json:"id,omitempty"`
	From       string        `json:"from,omitempty"`
	To         string        `json:"to,omitempty"`
	Name       string        `json:"name,omitempty"`
	Host       string        `json:"host,omitempty"`
	Peers      []meetingPeer `json:"peers,omitempty"`
	Signal     string        `json:"signal,omitempty"`
	SDP        string        `json:"sdp,omitempty"`
	Candidate  string        `json:"candidate,omitempty"`
	Microphone bool          `json:"microphone,omitempty"`
	Camera     bool          `json:"camera,omitempty"`
	Screen     bool          `json:"screen,omitempty"`
	Recording  bool          `json:"recording,omitempty"`
	Message    string        `json:"message,omitempty"`
}
type meetingParticipant struct {
	meetingPeer
	socket *socket
	joined int64
}
type meetingRoom struct {
	CallID         string                         `json:"-"`
	Code           string                         `json:"code"`
	Title          string                         `json:"title"`
	Owner          string                         `json:"owner"`
	ConversationID string                         `json:"conversationId"`
	Created        int64                          `json:"created"`
	Expires        int64                          `json:"expires"`
	HostID         string                         `json:"host"`
	Peers          map[string]*meetingParticipant `json:"-"`
	Banned         map[string]bool                `json:"-"`
	Invitees       map[string]bool                `json:"-"`
}
type meetingDirectory struct {
	sync.Mutex
	rooms map[string]*meetingRoom
}

func (s *Server) isGroupMeeting(room *meetingRoom) bool {
	var number string
	return room.ConversationID != "" && s.db.QueryRow("SELECT number FROM group_profiles WHERE conversation_id=?", room.ConversationID).Scan(&number) == nil
}

func (s *Server) createMeeting(w http.ResponseWriter, r *http.Request) {
	if !s.rate(r, "create-meeting:"+uid(r), 12, time.Hour) {
		fail(w, 429, "发起会议过于频繁")
		return
	}
	var p struct {
		Title, ConversationID string
		Members               []string
	}
	if !decode(w, r, &p) {
		return
	}
	if p.Title == "" {
		u, _ := s.user(uid(r))
		p.Title = u.Name + "的会议"
	}
	if !validText(p.Title, 60) {
		fail(w, 400, "会议名称最多 60 字")
		return
	}
	ids, err := s.meetingInvitees(uid(r), p.ConversationID, p.Members)
	if err != nil {
		fail(w, 403, err.Error())
		return
	}
	s.meetings.Lock()
	var activeCalls int
	_ = s.db.QueryRow("SELECT COUNT(*) FROM calls WHERE state<>'ended' AND (caller=? OR callee=?)", uid(r), uid(r)).Scan(&activeCalls)
	if activeCalls > 0 {
		s.meetings.Unlock()
		fail(w, 409, "请先结束当前通话")
		return
	}
	for _, room := range s.meetings.rooms {
		if room.Owner == uid(r) {
			s.meetings.Unlock()
			fail(w, 409, "请先结束已发起的会议")
			return
		}
	}
	var code string
	for {
		n, e := rand.Int(rand.Reader, big.NewInt(900000000))
		if e != nil {
			s.meetings.Unlock()
			s.dbError(w, e)
			return
		}
		code = strconv.FormatInt(n.Int64()+100000000, 10)
		if s.meetings.rooms[code] == nil {
			break
		}
	}
	invitees := make(map[string]bool, len(ids))
	for _, id := range ids {
		invitees[id] = true
	}
	room := &meetingRoom{Code: code, Title: p.Title, Owner: uid(r), ConversationID: p.ConversationID, Created: now(), Expires: now() + int64(s.settings.Meetings.DurationMinutes)*60000, HostID: uid(r), Peers: map[string]*meetingParticipant{}, Banned: map[string]bool{}, Invitees: invitees}
	s.meetings.rooms[code] = room
	s.meetings.Unlock()
	if p.ConversationID != "" {
		body, _ := json.Marshal(map[string]string{"code": code, "title": p.Title})
		mid := newID()
		if _, err := s.db.Exec("INSERT INTO messages(id,conversation_id,sender,kind,text,client_id,created) VALUES(?,?,?,'meeting',?,?,?)", mid, p.ConversationID, uid(r), string(body), "meeting:"+code, now()); err != nil {
			s.finishMeeting(code, "创建会议消息失败")
			s.dbError(w, err)
			return
		}
		message, err := scanMessage(s.db.QueryRow(messageQuery+"WHERE m.id=?", mid))
		if err == nil {
			s.pushConversation(p.ConversationID, "message", message)
		}
	}
	// Timers terminate idle rooms too, so abandoned invites do not remain joinable.
	time.AfterFunc(time.Duration(s.settings.Meetings.DurationMinutes)*time.Minute, func() { s.finishMeeting(code, "会议已到期") })
	s.push(ids, "meeting-invite", map[string]any{"code": code, "title": p.Title, "from": uid(r), "conversationId": p.ConversationID, "expires": room.Expires})
	ok(w, room)
}

func (s *Server) listMeetings(w http.ResponseWriter, r *http.Request) {
	s.meetings.Lock()
	defer s.meetings.Unlock()
	out := []map[string]any{}
	for _, room := range s.meetings.rooms {
		if room.CallID == "" && (room.Owner == uid(r) || room.Peers[uid(r)] != nil) {
			out = append(out, map[string]any{"code": room.Code, "title": room.Title, "owner": room.Owner, "host": room.HostID, "created": room.Created, "expires": room.Expires, "count": len(room.Peers)})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i]["created"].(int64) > out[j]["created"].(int64) })
	ok(w, out)
}
func (s *Server) inviteMeeting(w http.ResponseWriter, r *http.Request) {
	var p struct {
		ConversationID string
		Members        []string
	}
	if !decode(w, r, &p) {
		return
	}
	ids, err := s.meetingInvitees(uid(r), p.ConversationID, p.Members)
	if err != nil {
		fail(w, 403, err.Error())
		return
	}
	s.meetings.Lock()
	room := s.meetings.rooms[r.PathValue("code")]
	if room == nil || room.CallID != "" || (room.Owner != uid(r) && room.Peers[uid(r)] == nil) {
		s.meetings.Unlock()
		fail(w, 403, "请先加入会议")
		return
	}
	data := map[string]any{"code": room.Code, "title": room.Title, "from": uid(r), "conversationId": p.ConversationID, "expires": room.Expires}
	if room.Invitees == nil {
		room.Invitees = make(map[string]bool)
	}
	for _, id := range ids {
		room.Invitees[id] = true
	}
	s.meetings.Unlock()
	s.push(ids, "meeting-invite", data)
	ok(w, map[string]bool{"ok": true})
}
func (s *Server) endMeeting(w http.ResponseWriter, r *http.Request) {
	s.meetings.Lock()
	room := s.meetings.rooms[r.PathValue("code")]
	allowed := room != nil && room.CallID == "" && room.HostID == uid(r)
	s.meetings.Unlock()
	if !allowed {
		fail(w, 403, "只有当前主持人可以结束会议")
		return
	}
	s.finishMeeting(r.PathValue("code"), "主持人已结束会议")
	ok(w, map[string]bool{"ok": true})
}
func (s *Server) finishMeeting(code, reason string) {
	s.meetings.Lock()
	defer s.meetings.Unlock()
	s.finishMeetingLocked(code, reason)
}
func (s *Server) finishMeetingLocked(code, reason string) {
	room := s.meetings.rooms[code]
	if room == nil {
		return
	}
	if room.CallID != "" {
		if c, e := readCall(s.db, room.CallID); e == nil {
			_, _ = s.finishCallLocked(c, "unavailable")
		}
		return
	}
	delete(s.meetings.rooms, code)
	invitees := make([]string, 0, len(room.Invitees))
	for id := range room.Invitees {
		invitees = append(invitees, id)
	}
	if len(invitees) > 0 {
		s.push(invitees, "meeting-ended", map[string]any{"code": code, "title": room.Title, "message": reason})
	}
	for _, p := range room.Peers {
		meetingQueue(p, meetingSignal{Type: "ended", Message: reason})
		time.AfterFunc(300*time.Millisecond, p.socket.close)
	}
}
func meetingQueue(p *meetingParticipant, m meetingSignal) {
	data, _ := json.Marshal(m)
	select {
	case <-p.socket.done:
		return
	default:
	}
	select {
	case p.socket.send <- data:
	default:
		p.socket.close()
	}
}
func meetingBroadcast(room *meetingRoom, m meetingSignal, except string) {
	for id, p := range room.Peers {
		if id != except {
			meetingQueue(p, m)
		}
	}
}

func (s *Server) meetingSocket(w http.ResponseWriter, r *http.Request) {
	if !s.rate(r, "join-meeting:"+uid(r), 60, time.Minute) {
		fail(w, 429, "入会尝试过于频繁")
		return
	}
	u, err := s.user(uid(r))
	if err != nil {
		s.dbError(w, err)
		return
	}
	code := r.PathValue("code")
	s.meetings.Lock()
	room := s.meetings.rooms[code]
	if room == nil || now() > room.Expires {
		s.meetings.Unlock()
		fail(w, 404, "会议不存在或已结束")
		return
	}
	if room.Banned[u.ID] {
		s.meetings.Unlock()
		fail(w, 403, "你已被主持人移出本次会议")
		return
	}
	if room.CallID != "" {
		c, e := readCall(s.db, room.CallID)
		if e != nil || c.State == "ended" || !c.assigned(u.ID, sessionHash(r)) || !contactAllowed(s.db, c.Caller, c.Callee) {
			s.meetings.Unlock()
			fail(w, 403, "请在已接听或发起通话的设备上加入")
			return
		}
	} else {
		var n int
		_ = s.db.QueryRow("SELECT COUNT(*) FROM calls WHERE state<>'ended' AND (caller=? OR callee=?)", u.ID, u.ID).Scan(&n)
		if n > 0 {
			s.meetings.Unlock()
			fail(w, 409, "请先结束当前通话")
			return
		}
	}
	groupMeeting := s.isGroupMeeting(room)
	if !groupMeeting && u.ID != room.Owner && contactBlocked(s.db, u.ID, room.Owner) {
		s.meetings.Unlock()
		fail(w, 403, "无法加入该会议")
		return
	}
	if groupMeeting && !s.member(room.ConversationID, u.ID) {
		s.meetings.Unlock()
		fail(w, 403, "只有当前群成员可以加入群会议")
		return
	}
	if len(room.Peers) >= s.settings.Meetings.MaxParticipants || room.Peers[u.ID] != nil {
		s.meetings.Unlock()
		fail(w, 409, "会议已满或当前账号已入会")
		return
	}
	if room.CallID == "" && len(room.Peers) == 0 && u.ID != room.HostID {
		s.meetings.Unlock()
		fail(w, 409, "请等待主持人进入会议")
		return
	}
	conn, e := upgrader.Upgrade(w, r, nil)
	if e != nil {
		s.meetings.Unlock()
		return
	}
	p := &meetingParticipant{meetingPeer: meetingPeer{ID: u.ID, Name: u.Name, Number: u.Number, Host: u.ID == room.HostID}, socket: &socket{c: conn, session: sessionHash(r), send: make(chan []byte, 64), done: make(chan struct{})}, joined: time.Now().UnixNano()}
	peers := []meetingPeer{}
	for _, existing := range room.Peers {
		peer := existing.meetingPeer
		peer.Host = peer.ID == room.HostID
		peers = append(peers, peer)
	}
	room.Peers[u.ID] = p
	meetingQueue(p, meetingSignal{Type: "welcome", ID: u.ID, Name: u.Name, Host: room.HostID, Peers: peers})
	meetingBroadcast(room, meetingSignal{Type: "peer-joined", ID: u.ID, Name: u.Name, Host: room.HostID}, u.ID)
	s.meetings.Unlock()
	defer s.leaveMeeting(code, p)
	if !s.sessionAlive(p.socket) {
		return
	}
	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-p.socket.done:
				return
			case raw := <-p.socket.send:
				conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
				if conn.WriteMessage(1, raw) != nil {
					p.socket.close()
					return
				}
			case <-ticker.C:
				if !s.sessionAlive(p.socket) {
					return
				}
				if conn.WriteControl(9, nil, time.Now().Add(5*time.Second)) != nil {
					p.socket.close()
					return
				}
			}
		}
	}()
	conn.SetReadLimit(64 << 10)
	conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(60 * time.Second)) })
	for {
		var m meetingSignal
		if conn.ReadJSON(&m) != nil {
			return
		}
		if !s.rate(r, "meeting-signal:"+u.ID, 600, time.Minute) {
			return
		}
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		if !s.applyMeetingSignal(code, p, m) {
			return
		}
	}
}

func (s *Server) applyMeetingSignal(code string, p *meetingParticipant, m meetingSignal) bool {
	s.meetings.Lock()
	defer s.meetings.Unlock()
	room := s.meetings.rooms[code]
	if room == nil || room.Peers[p.ID] != p {
		return false
	}
	switch m.Type {
	case "call-connected":
		return room.CallID != "" && s.callMediaReadyLocked(room, p)
	case "call-end":
		if room.CallID == "" {
			return false
		}
		c, e := readCall(s.db, room.CallID)
		if e != nil {
			return false
		}
		reason := "completed"
		if c.Started == 0 {
			reason = "cancelled"
		}
		_, e = s.finishCallLocked(c, reason)
		return e == nil
	case "ping":
		meetingQueue(p, meetingSignal{Type: "pong"})
	case "signal":
		target := room.Peers[m.To]
		valid := m.Signal == "offer" || m.Signal == "answer" || m.Signal == "candidate"
		if target == nil || target == p || !valid || len(m.SDP) > 32<<10 || len(m.Candidate) > 8<<10 || (m.Signal != "candidate" && m.SDP == "") || (m.Signal == "candidate" && !json.Valid([]byte(m.Candidate))) {
			return false
		}
		meetingQueue(target, meetingSignal{Type: "signal", From: p.ID, Signal: m.Signal, SDP: m.SDP, Candidate: m.Candidate})
	case "state":
		p.Microphone, p.Camera = m.Microphone, m.Camera
		p.Screen, p.Recording = m.Screen && room.HostID == p.ID, m.Recording && room.HostID == p.ID
		meetingBroadcast(room, meetingSignal{Type: "state", ID: p.ID, Microphone: p.Microphone, Camera: p.Camera, Screen: p.Screen, Recording: p.Recording}, "")
	case "transfer":
		if room.CallID != "" {
			return false
		}
		if room.HostID != p.ID || m.To == p.ID || room.Peers[m.To] == nil {
			return false
		}
		p.Screen, p.Recording = false, false
		meetingBroadcast(room, meetingSignal{Type: "state", ID: p.ID, Microphone: p.Microphone, Camera: p.Camera}, "")
		room.HostID = m.To
		meetingBroadcast(room, meetingSignal{Type: "host", Host: m.To}, "")
	case "mute", "kick":
		if room.CallID != "" {
			return false
		}
		if room.HostID != p.ID || m.To == p.ID || room.Peers[m.To] == nil {
			return false
		}
		target := room.Peers[m.To]
		if m.Type == "mute" {
			meetingQueue(target, meetingSignal{Type: "mute", From: p.ID})
		} else {
			room.Banned[m.To] = true
			meetingQueue(target, meetingSignal{Type: "ended", Message: "主持人已将你移出会议"})
			time.AfterFunc(200*time.Millisecond, target.socket.close)
		}
	case "end":
		if room.CallID != "" {
			c, e := readCall(s.db, room.CallID)
			if e == nil {
				_, _ = s.finishCallLocked(c, "completed")
			}
			return false
		}
		if room.HostID != p.ID {
			return false
		}
		s.finishMeetingLocked(code, "主持人已结束会议")
		return false
	default:
		return false
	}
	return true
}
func (s *Server) leaveMeeting(code string, p *meetingParticipant) {
	s.meetings.Lock()
	defer s.meetings.Unlock()
	room := s.meetings.rooms[code]
	if room == nil {
		time.AfterFunc(500*time.Millisecond, p.socket.close)
		return
	}
	if room.Peers[p.ID] != p {
		return
	}
	if room.CallID != "" {
		if c, e := readCall(s.db, room.CallID); e == nil {
			_, _ = s.finishCallLocked(c, "disconnected")
		}
		return
	}
	delete(room.Peers, p.ID)
	p.socket.close()
	meetingBroadcast(room, meetingSignal{Type: "peer-left", ID: p.ID}, "")
	if len(room.Peers) == 0 {
		delete(s.meetings.rooms, code)
		return
	}
	if room.HostID == p.ID {
		var next *meetingParticipant
		for _, candidate := range room.Peers {
			if next == nil || candidate.joined < next.joined {
				next = candidate
			}
		}
		room.HostID = next.ID
		meetingBroadcast(room, meetingSignal{Type: "host", Host: next.ID}, "")
	}
}
