package server

import (
	"encoding/json"
	"github.com/gorilla/websocket"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

type callResult struct {
	callRecord
	Code                        string
	CanJoin, CanRespond, CanEnd bool
	Peer                        User
}

func (f *fixture) call(a account, cid, mode string) callResult {
	f.t.Helper()
	var c callResult
	f.request("POST", "/api/calls", a.Token, map[string]string{"conversationId": cid, "mode": mode, "clientId": newID()}, 200, &c)
	return c
}
func (f *fixture) callState(a account, id string) callResult {
	f.t.Helper()
	var c callResult
	f.request("GET", "/api/calls/"+id, a.Token, nil, 200, &c)
	return c
}
func (f *fixture) callSocket(a account, code string, status int) *websocket.Conn {
	f.t.Helper()
	ws, response, e := websocket.DefaultDialer.Dial(strings.Replace(f.url, "http", "ws", 1)+"/api/meetings/"+code+"/ws", http.Header{"Authorization": []string{"Bearer " + a.Token}})
	if status != 101 {
		if ws != nil {
			ws.Close()
		}
		if e == nil || response == nil || response.StatusCode != status {
			f.t.Fatalf("call socket: %v, response %v", e, response)
		}
		return nil
	}
	if e != nil {
		f.t.Fatal(e)
	}
	f.t.Cleanup(func() { ws.Close() })
	meetingRead(f.t, ws, "welcome")
	return ws
}
func TestCallsConsentSessionBindingSignalingAndHistory(t *testing.T) {
	f := setup(t)
	a, b, other := f.register("call_alice"), f.register("call_bobby"), f.register("call_other")
	f.befriend(a, b)
	cid := f.direct(a, b)
	var b2 account
	f.request("POST", "/api/auth/login", "", map[string]string{"account": "call_bobby", "password": "test-password-937!"}, 200, &b2)
	var c callResult
	payload := map[string]string{"conversationId": cid, "mode": "video", "clientId": newID()}
	f.request("POST", "/api/calls", a.Token, payload, 200, &c)
	if c.State != "ringing" || c.Code != "" || c.CanJoin || !c.CanEnd {
		t.Fatal("caller got media before answer")
	}
	var duplicate callResult
	f.request("POST", "/api/calls", a.Token, payload, 200, &duplicate)
	if duplicate.ID != c.ID {
		t.Fatal("duplicate dial")
	}
	if incoming := f.callState(b, c.ID); !incoming.CanRespond || incoming.Code != "" {
		t.Fatal("incoming consent")
	}
	f.request("GET", "/api/calls/"+c.ID, other.Token, nil, 404, nil)
	f.request("POST", "/api/calls/"+c.ID+"/respond", a.Token, map[string]bool{"accept": true}, 403, nil)
	f.request("POST", "/api/calls/"+c.ID+"/respond", b.Token, map[string]bool{"accept": true, "audioOnly": true}, 200, &c)
	if !c.CanJoin || c.Mode != "audio" || len(c.Code) != 9 {
		t.Fatal("answer did not bind media")
	}
	f.request("POST", "/api/calls/"+c.ID+"/respond", b2.Token, map[string]bool{"accept": true}, 409, nil)
	if another := f.callState(b2, c.ID); another.CanJoin || another.Code != "" || another.CanEnd {
		t.Fatal("second device received media authorization")
	}
	f.callSocket(b2, c.Code, 403)
	f.callSocket(other, c.Code, 403)
	f.request("POST", "/api/meetings/"+c.Code+"/invite", a.Token, map[string]any{"members": []string{b.User.ID}}, 403, nil)
	guest := f.callSocket(b, c.Code, 101)
	host := f.callSocket(a, c.Code, 101)
	host.WriteJSON(meetingSignal{Type: "signal", To: b.User.ID, From: other.User.ID, Signal: "offer", SDP: "v=0\r\n"})
	if signal := meetingRead(t, guest, "signal"); signal.From != a.User.ID {
		t.Fatal("signal sender spoofing")
	}
	host.WriteJSON(meetingSignal{Type: "call-connected"})
	meetingRead(t, host, "call-state")
	if f.callState(a, c.ID).Started != 0 {
		t.Fatal("duration started with only one connected peer")
	}
	guest.WriteJSON(meetingSignal{Type: "call-connected"})
	meetingRead(t, guest, "call-state")
	for i := 0; i < 100 && f.callState(a, c.ID).Started == 0; i++ {
		time.Sleep(time.Millisecond)
	}
	if f.callState(a, c.ID).State != "connected" {
		t.Fatal("connected state missing")
	}
	f.request("POST", "/api/calls/"+c.ID+"/end", b2.Token, map[string]bool{}, 403, nil)
	guest.WriteJSON(meetingSignal{Type: "call-end"})
	meetingRead(t, host, "ended")
	ended := f.callState(a, c.ID)
	if ended.State != "ended" || ended.Reason != "completed" || ended.Ended < ended.Started {
		t.Fatal("hangup did not finish")
	}
	f.callSocket(a, c.Code, 404)
	var history []callResult
	f.request("GET", "/api/calls/history", a.Token, nil, 200, &history)
	if len(history) != 1 || history[0].ID != c.ID {
		t.Fatal("history missing")
	}
	f.request("DELETE", "/api/calls/"+c.ID, a.Token, nil, 200, nil)
	f.request("GET", "/api/calls/history", a.Token, nil, 200, &history)
	if len(history) != 0 {
		t.Fatal("personal call deletion failed")
	}
	f.request("GET", "/api/calls/history", b.Token, nil, 200, &history)
	if len(history) != 1 {
		t.Fatal("call deletion affected peer")
	}
}

func TestCallsBusyTimeoutRevocationAndPermissionChanges(t *testing.T) {
	f := setup(t)
	a, b, c := f.register("busy_alice"), f.register("busy_bobby"), f.register("busy_carol")
	f.befriend(a, b)
	f.befriend(c, b)
	ab, cb := f.direct(a, b), f.direct(c, b)
	first := f.call(a, ab, "audio")
	busy := f.call(c, cb, "video")
	if busy.State != "ended" || busy.Reason != "busy" {
		t.Fatal("recipient busy not enforced")
	}
	var body map[string]any
	json.Unmarshal([]byte(callMessage(busy.callRecord)), &body)
	if body["duration"] != float64(0) {
		t.Fatal("missed call got duration")
	}
	f.request("POST", "/api/meetings", b.Token, map[string]string{"title": "cannot join"}, 409, nil)
	if _, e := f.s.db.Exec("UPDATE calls SET created=? WHERE id=?", now()-46000, first.ID); e != nil {
		t.Fatal(e)
	}
	f.s.expireCalls()
	if ended := f.callState(a, first.ID); ended.Reason != "no_answer" {
		t.Fatal("ring timeout")
	}
	var missed []callResult
	f.request("GET", "/api/calls/history?missed=true", b.Token, nil, 200, &missed)
	if len(missed) != 1 {
		t.Fatal("missed history")
	}
	rejected := f.call(a, ab, "video")
	f.request("POST", "/api/calls/"+rejected.ID+"/respond", b.Token, map[string]bool{"accept": false}, 200, &rejected)
	if rejected.Reason != "rejected" {
		t.Fatal("reject")
	}
	connecting := f.call(a, ab, "audio")
	f.request("POST", "/api/calls/"+connecting.ID+"/respond", b.Token, map[string]bool{"accept": true}, 200, &connecting)
	f.s.db.Exec("UPDATE calls SET accepted=? WHERE id=?", now()-31000, connecting.ID)
	f.s.expireCalls()
	if f.callState(a, connecting.ID).Reason != "failed" {
		t.Fatal("connection timeout")
	}
	blocked := f.call(a, ab, "audio")
	f.request("POST", "/api/contact-blocks/"+a.User.ID, b.Token, map[string]string{}, 200, nil)
	if f.callState(a, blocked.ID).Reason != "unavailable" {
		t.Fatal("contact block did not stop ringing")
	}
	f.request("POST", "/api/calls", a.Token, map[string]string{"conversationId": ab, "mode": "audio", "clientId": newID()}, 403, nil)
	logout := f.call(c, cb, "audio")
	f.request("POST", "/api/auth/logout", c.Token, map[string]string{}, 200, nil)
	if f.callState(b, logout.ID).Reason != "offline" {
		t.Fatal("logout did not cancel assigned call")
	}
}

func TestCallsConcurrentAcceptAndServerRestart(t *testing.T) {
	f := setup(t)
	a, b := f.register("race_call_alice"), f.register("race_call_bobby")
	f.befriend(a, b)
	cid := f.direct(a, b)
	var b2 account
	f.request("POST", "/api/auth/login", "", map[string]string{"account": "race_call_bobby", "password": "test-password-937!"}, 200, &b2)
	c := f.call(a, cid, "audio")
	statuses := make(chan int, 2)
	var wg sync.WaitGroup
	for _, token := range []string{b.Token, b2.Token} {
		wg.Go(func() {
			req, _ := http.NewRequest("POST", f.url+"/api/calls/"+c.ID+"/respond", strings.NewReader(`{"accept":true}`))
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("Content-Type", "application/json")
			response, e := http.DefaultClient.Do(req)
			if e != nil {
				t.Error(e)
				return
			}
			response.Body.Close()
			statuses <- response.StatusCode
		})
	}
	wg.Wait()
	close(statuses)
	success, conflict := 0, 0
	for status := range statuses {
		if status == 200 {
			success++
		}
		if status == 409 {
			conflict++
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("accept winners %d conflicts %d", success, conflict)
	}
	dir := f.s.dir
	if e := f.s.Close(); e != nil {
		t.Fatal(e)
	}
	reopened, e := New(Config{DataDir: dir})
	if e != nil {
		t.Fatal(e)
	}
	defer reopened.Close()
	record, e := readCall(reopened.db, c.ID)
	if e != nil || record.Reason != "interrupted" {
		t.Fatal("restart did not finish abandoned call")
	}
}
