package server

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"math/big"
	"net/http"
	"strconv"
	"time"
)

const callSchema = `
CREATE TABLE IF NOT EXISTS calls(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id),caller TEXT NOT NULL REFERENCES users(id),callee TEXT NOT NULL REFERENCES users(id),caller_session TEXT NOT NULL,callee_session TEXT NOT NULL DEFAULT '',client_id TEXT NOT NULL,mode TEXT NOT NULL,state TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL,accepted INTEGER NOT NULL DEFAULT 0,started INTEGER NOT NULL DEFAULT 0,ended INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,room_code TEXT NOT NULL DEFAULT '',caller_ready INTEGER NOT NULL DEFAULT 0,callee_ready INTEGER NOT NULL DEFAULT 0,message_id TEXT NOT NULL REFERENCES messages(id),UNIQUE(caller,client_id));
CREATE INDEX IF NOT EXISTS calls_active ON calls(state,caller,callee);
CREATE TABLE IF NOT EXISTS call_deletions(user_id TEXT NOT NULL REFERENCES users(id),call_id TEXT NOT NULL REFERENCES calls(id),PRIMARY KEY(user_id,call_id));
`

type callRecord struct {
	Seq            int64  `json:"seq"`
	ID             string `json:"id"`
	ConversationID string `json:"conversationId"`
	Caller         string `json:"caller"`
	Callee         string `json:"callee"`
	CallerSession  string `json:"-"`
	CalleeSession  string `json:"-"`
	ClientID       string `json:"-"`
	Mode           string `json:"mode"`
	State          string `json:"state"`
	Reason         string `json:"reason"`
	Created        int64  `json:"created"`
	Accepted       int64  `json:"accepted"`
	Started        int64  `json:"started"`
	Ended          int64  `json:"ended"`
	Revision       int64  `json:"revision"`
	RoomCode       string `json:"-"`
	CallerReady    bool   `json:"-"`
	CalleeReady    bool   `json:"-"`
	MessageID      string `json:"messageId"`
}

const callQuery = `SELECT seq,id,conversation_id,caller,callee,caller_session,callee_session,client_id,mode,state,reason,created,accepted,started,ended,revision,room_code,caller_ready,callee_ready,message_id FROM calls `

func scanCall(row scanner) (c callRecord, err error) {
	err = row.Scan(&c.Seq, &c.ID, &c.ConversationID, &c.Caller, &c.Callee, &c.CallerSession, &c.CalleeSession, &c.ClientID, &c.Mode, &c.State, &c.Reason, &c.Created, &c.Accepted, &c.Started, &c.Ended, &c.Revision, &c.RoomCode, &c.CallerReady, &c.CalleeReady, &c.MessageID)
	return
}
func readCall(q rowQuery, id string) (callRecord, error) {
	return scanCall(q.QueryRow(callQuery+"WHERE id=?", id))
}
func (c callRecord) participant(user string) bool { return user == c.Caller || user == c.Callee }
func (c callRecord) assigned(user, session string) bool {
	return session != "" && (user == c.Caller && session == c.CallerSession || user == c.Callee && session == c.CalleeSession)
}
func (s *Server) callView(c callRecord, user, session string) any {
	peer := c.Caller
	if peer == user {
		peer = c.Callee
	}
	profile, _ := s.user(peer)
	code := ""
	join := c.State != "ringing" && c.State != "ended" && c.assigned(user, session)
	if join {
		code = c.RoomCode
	}
	return struct {
		callRecord
		Peer       User   `json:"peer"`
		Code       string `json:"code,omitempty"`
		CanJoin    bool   `json:"canJoin"`
		CanRespond bool   `json:"canRespond"`
		CanEnd     bool   `json:"canEnd"`
		Expires    int64  `json:"expires"`
	}{c, profile, code, join, c.State == "ringing" && user == c.Callee, c.State != "ended" && c.assigned(user, session), c.Created + 45000}
}
func callMessage(c callRecord) string {
	duration := int64(0)
	if c.Started > 0 && c.Ended > 0 {
		duration = max(int64(0), c.Ended-c.Started) / 1000
	}
	data, _ := json.Marshal(map[string]any{"id": c.ID, "mode": c.Mode, "state": c.State, "reason": c.Reason, "started": c.Started, "ended": c.Ended, "duration": duration})
	return string(data)
}
func (s *Server) publishCall(c callRecord) {
	s.push([]string{c.Caller, c.Callee}, "call", map[string]any{"id": c.ID, "conversationId": c.ConversationID, "revision": c.Revision})
}
func (s *Server) busyCallLocked(user string) bool {
	var n int
	if s.db.QueryRow("SELECT COUNT(*) FROM calls WHERE state<>'ended' AND (caller=? OR callee=?)", user, user).Scan(&n) != nil || n > 0 {
		return true
	}
	for _, room := range s.meetings.rooms {
		if room.Owner == user || room.Peers[user] != nil {
			return true
		}
	}
	return false
}
func (s *Server) createCall(w http.ResponseWriter, r *http.Request) {
	var p struct{ ConversationID, Mode, ClientID string }
	if !decode(w, r, &p) {
		return
	}
	if (p.Mode != "audio" && p.Mode != "video") || len(p.ClientID) < 8 || len(p.ClientID) > 100 {
		fail(w, 400, "通话参数无效")
		return
	}
	if !s.rate(r, "create-call:"+uid(r), 12, time.Minute) {
		fail(w, 429, "呼叫过于频繁，请稍后重试")
		return
	}
	s.meetings.Lock()
	defer s.meetings.Unlock()
	old, err := scanCall(s.db.QueryRow(callQuery+"WHERE caller=? AND client_id=?", uid(r), p.ClientID))
	if err == nil {
		if old.ConversationID != p.ConversationID {
			fail(w, 409, "呼叫标识已用于其他会话")
			return
		}
		ok(w, s.callView(old, uid(r), sessionHash(r)))
		return
	}
	if err != sql.ErrNoRows {
		s.dbError(w, err)
		return
	}
	var peer string
	if s.db.QueryRow("SELECT m.user_id FROM conversations c JOIN members m ON m.conversation_id=c.id WHERE c.id=? AND c.kind='direct' AND m.user_id<>? AND EXISTS(SELECT 1 FROM members WHERE conversation_id=c.id AND user_id=?)", p.ConversationID, uid(r), uid(r)).Scan(&peer) != nil || !contactAllowed(s.db, uid(r), peer) {
		fail(w, 403, "只能向当前好友发起通话")
		return
	}
	if s.busyCallLocked(uid(r)) {
		fail(w, 409, "你正在通话或会议中")
		return
	}
	c := callRecord{ID: newID(), ConversationID: p.ConversationID, Caller: uid(r), Callee: peer, CallerSession: sessionHash(r), ClientID: p.ClientID, Mode: p.Mode, State: "ringing", Created: now(), Revision: 1, MessageID: newID()}
	if s.busyCallLocked(peer) {
		c.State = "ended"
		c.Reason = "busy"
		c.Ended = c.Created
	}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	if !canSpeak(tx, c.ConversationID, c.Caller) {
		fail(w, 403, "无法向该好友发起通话")
		return
	}
	if _, err = tx.Exec("INSERT INTO messages(id,conversation_id,sender,kind,text,client_id,created) VALUES(?,?,?,'call',?,?,?)", c.MessageID, c.ConversationID, c.Caller, callMessage(c), "call:"+c.ID, c.Created); err != nil {
		s.dbError(w, err)
		return
	}
	result, err := tx.Exec("INSERT INTO calls(id,conversation_id,caller,callee,caller_session,client_id,mode,state,reason,created,ended,message_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", c.ID, c.ConversationID, c.Caller, c.Callee, c.CallerSession, c.ClientID, c.Mode, c.State, c.Reason, c.Created, c.Ended, c.MessageID)
	if err != nil {
		s.dbError(w, err)
		return
	}
	c.Seq, _ = result.LastInsertId()
	if err = tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	if message, e := scanMessage(s.db.QueryRow(messageQuery+"WHERE m.id=?", c.MessageID)); e == nil {
		s.pushConversation(c.ConversationID, "message", message)
	}
	s.publishCall(c)
	ok(w, s.callView(c, uid(r), sessionHash(r)))
}
func (s *Server) getCall(w http.ResponseWriter, r *http.Request) {
	c, e := readCall(s.db, r.PathValue("id"))
	if e != nil || !c.participant(uid(r)) {
		fail(w, 404, "通话不存在")
		return
	}
	ok(w, s.callView(c, uid(r), sessionHash(r)))
}
func (s *Server) activeCalls(w http.ResponseWriter, r *http.Request) { s.listCalls(w, r, true) }
func (s *Server) callHistory(w http.ResponseWriter, r *http.Request) { s.listCalls(w, r, false) }
func (s *Server) listCalls(w http.ResponseWriter, r *http.Request, active bool) {
	query := callQuery + "WHERE (caller=? OR callee=?) "
	args := []any{uid(r), uid(r)}
	if active {
		query += "AND state<>'ended' "
	} else {
		query += "AND state='ended' AND NOT EXISTS(SELECT 1 FROM call_deletions d WHERE d.call_id=calls.id AND d.user_id=?) "
		args = append(args, uid(r))
		if r.URL.Query().Get("missed") == "true" {
			query += "AND callee=? AND started=0 AND reason IN ('no_answer','cancelled','offline','interrupted') "
			args = append(args, uid(r))
		}
		if before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64); before > 0 {
			query += "AND seq<? "
			args = append(args, before)
		}
	}
	rows, e := s.db.Query(query+"ORDER BY seq DESC LIMIT 50", args...)
	if e != nil {
		s.dbError(w, e)
		return
	}
	records := []callRecord{}
	for rows.Next() {
		c, err := scanCall(rows)
		if err != nil {
			rows.Close()
			s.dbError(w, err)
			return
		}
		records = append(records, c)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		s.dbError(w, e)
		return
	}
	out := []any{}
	for _, c := range records {
		out = append(out, s.callView(c, uid(r), sessionHash(r)))
	}
	ok(w, out)
}
func (s *Server) respondCall(w http.ResponseWriter, r *http.Request) {
	var p struct{ Accept, AudioOnly bool }
	if !decode(w, r, &p) {
		return
	}
	s.meetings.Lock()
	defer s.meetings.Unlock()
	c, e := readCall(s.db, r.PathValue("id"))
	if e != nil || c.Callee != uid(r) {
		fail(w, 403, "无法处理该通话")
		return
	}
	if c.State != "ringing" {
		if p.Accept && c.State != "ended" && c.CalleeSession == sessionHash(r) {
			ok(w, s.callView(c, uid(r), sessionHash(r)))
			return
		}
		fail(w, 409, "通话已结束或已在其他设备接听")
		return
	}
	if now() >= c.Created+45000 {
		c, e = s.finishCallLocked(c, "no_answer")
		if e != nil {
			s.dbError(w, e)
			return
		}
		fail(w, 409, "来电已超时")
		return
	}
	if !p.Accept {
		c, e = s.finishCallLocked(c, "rejected")
		if e != nil {
			s.dbError(w, e)
			return
		}
		ok(w, s.callView(c, uid(r), sessionHash(r)))
		return
	}
	if !contactAllowed(s.db, c.Caller, c.Callee) {
		_, _ = s.finishCallLocked(c, "unavailable")
		fail(w, 403, "好友关系已变化")
		return
	}
	var code string
	for {
		n, err := rand.Int(rand.Reader, big.NewInt(900000000))
		if err != nil {
			s.dbError(w, err)
			return
		}
		code = strconv.FormatInt(n.Int64()+100000000, 10)
		if s.meetings.rooms[code] == nil {
			break
		}
	}
	c.CalleeSession = sessionHash(r)
	c.RoomCode = code
	c.Accepted = now()
	c.State = "connecting"
	c.Revision++
	if p.AudioOnly {
		c.Mode = "audio"
	}
	if e = s.saveCall(c); e != nil {
		s.dbError(w, e)
		return
	}
	s.meetings.rooms[code] = &meetingRoom{Code: code, Title: "WeLink 通话", Owner: c.Caller, HostID: c.Caller, ConversationID: c.ConversationID, Created: c.Accepted, Expires: c.Accepted + 7200000, CallID: c.ID, Peers: map[string]*meetingParticipant{}, Banned: map[string]bool{}}
	s.publishCall(c)
	ok(w, s.callView(c, uid(r), sessionHash(r)))
}
func (s *Server) endCall(w http.ResponseWriter, r *http.Request) {
	s.meetings.Lock()
	defer s.meetings.Unlock()
	c, e := readCall(s.db, r.PathValue("id"))
	if e != nil || !c.assigned(uid(r), sessionHash(r)) {
		fail(w, 403, "请在发起或接听的设备上结束通话")
		return
	}
	reason := "completed"
	if c.State == "ringing" {
		reason = "cancelled"
	} else if c.Started == 0 {
		reason = "cancelled"
	}
	c, e = s.finishCallLocked(c, reason)
	if e != nil {
		s.dbError(w, e)
		return
	}
	ok(w, s.callView(c, uid(r), sessionHash(r)))
}
func (s *Server) deleteCall(w http.ResponseWriter, r *http.Request) {
	c, e := readCall(s.db, r.PathValue("id"))
	if e != nil || !c.participant(uid(r)) {
		fail(w, 404, "通话不存在")
		return
	}
	if c.State != "ended" {
		fail(w, 409, "请先结束通话")
		return
	}
	if _, e = s.db.Exec("INSERT OR IGNORE INTO call_deletions VALUES(?,?)", uid(r), c.ID); e != nil {
		s.dbError(w, e)
		return
	}
	s.push([]string{uid(r)}, "call-history", map[string]string{"id": c.ID})
	ok(w, map[string]bool{"ok": true})
}
func (s *Server) saveCall(c callRecord) error {
	tx, e := s.db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	_, e = tx.Exec("UPDATE calls SET callee_session=?,mode=?,state=?,reason=?,accepted=?,started=?,ended=?,revision=?,room_code=?,caller_ready=?,callee_ready=? WHERE id=?", c.CalleeSession, c.Mode, c.State, c.Reason, c.Accepted, c.Started, c.Ended, c.Revision, c.RoomCode, c.CallerReady, c.CalleeReady, c.ID)
	if e != nil {
		return e
	}
	_, e = tx.Exec("UPDATE messages SET text=? WHERE id=? AND recalled=0", callMessage(c), c.MessageID)
	if e != nil {
		return e
	}
	return tx.Commit()
}

// All call transitions and room membership changes share meetings.Mutex.
func (s *Server) finishCallLocked(c callRecord, reason string) (callRecord, error) {
	if c.State == "ended" {
		return c, nil
	}
	c.State = "ended"
	c.Reason = reason
	c.Ended = now()
	c.Revision++
	if e := s.saveCall(c); e != nil {
		return c, e
	}
	if room := s.meetings.rooms[c.RoomCode]; room != nil {
		delete(s.meetings.rooms, c.RoomCode)
		for _, p := range room.Peers {
			meetingQueue(p, meetingSignal{Type: "ended", Message: "通话已结束"})
			time.AfterFunc(200*time.Millisecond, p.socket.close)
		}
	}
	s.publishCall(c)
	return c, nil
}
func (s *Server) callMediaReadyLocked(room *meetingRoom, p *meetingParticipant) bool {
	c, e := readCall(s.db, room.CallID)
	if e != nil || c.State == "ended" || !c.assigned(p.ID, p.socket.session) {
		return false
	}
	if c.Caller == p.ID {
		c.CallerReady = true
	} else {
		c.CalleeReady = true
	}
	if c.CallerReady && c.CalleeReady && c.Started == 0 {
		c.Started = now()
		c.State = "connected"
	}
	c.Revision++
	if e = s.saveCall(c); e != nil {
		return false
	}
	meetingBroadcast(room, meetingSignal{Type: "call-state", Started: c.Started}, "")
	s.publishCall(c)
	return true
}
func (s *Server) activeCallRecords() ([]callRecord, error) {
	rows, e := s.db.Query(callQuery + "WHERE state<>'ended'")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	var out []callRecord
	for rows.Next() {
		c, err := scanCall(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
func (s *Server) startCalls() {
	s.callsStop = make(chan struct{})
	s.callsDone = make(chan struct{})
	records, _ := s.activeCallRecords()
	for _, c := range records {
		_, _ = s.finishCallLocked(c, "interrupted")
	}
	go func() {
		defer close(s.callsDone)
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-s.callsStop:
				return
			case <-ticker.C:
				s.expireCalls()
			}
		}
	}()
}
func (s *Server) expireCalls() {
	s.meetings.Lock()
	defer s.meetings.Unlock()
	records, e := s.activeCallRecords()
	if e != nil {
		return
	}
	for _, c := range records {
		reason := ""
		switch {
		case c.State == "ringing" && now() >= c.Created+45000:
			reason = "no_answer"
		case c.State == "connecting" && now() >= c.Accepted+30000:
			reason = "failed"
		case c.State == "connected" && now() >= c.Started+7200000:
			reason = "expired"
		}
		if reason == "" && !contactAllowed(s.db, c.Caller, c.Callee) {
			reason = "unavailable"
		}
		for _, session := range []string{c.CallerSession, c.CalleeSession} {
			if session == "" {
				continue
			}
			var n int
			if s.db.QueryRow("SELECT 1 FROM sessions WHERE token=? AND expires>?", session, now()).Scan(&n) != nil {
				reason = "offline"
				break
			}
		}
		if reason != "" {
			_, _ = s.finishCallLocked(c, reason)
		}
	}
}
