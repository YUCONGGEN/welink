package server

import (
	"github.com/gorilla/websocket"
	"net/http"
	"strings"
	"testing"
	"time"
)

func meetingRead(t *testing.T, c *websocket.Conn, kind string) meetingSignal {
	t.Helper()
	c.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		var m meetingSignal
		if err := c.ReadJSON(&m); err != nil {
			t.Fatal(err)
		}
		if m.Type == kind {
			return m
		}
	}
}
func TestMeetingInvitesSignalingAndHostAuthority(t *testing.T) {
	f := setup(t)
	a, b, c := f.register("meeting_alice"), f.register("meeting_bobby"), f.register("meeting_carol")
	f.befriend(a, b)
	cid := f.direct(a, b)
	events := f.socket(b)
	var room meetingRoom
	f.request("POST", "/api/meetings", a.Token, map[string]string{"title": "设计评审", "conversationId": cid}, 200, &room)
	if len(room.Code) != 9 {
		t.Fatal("missing meeting number")
	}
	events.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		var event struct {
			Type string
			Data struct{ Code string }
		}
		if err := events.ReadJSON(&event); err != nil {
			t.Fatal(err)
		}
		if event.Type == "meeting-invite" {
			if event.Data.Code != room.Code {
				t.Fatal("wrong invitation")
			}
			break
		}
	}
	dial := func(user account) *websocket.Conn {
		t.Helper()
		ws, _, err := websocket.DefaultDialer.Dial(strings.Replace(f.url, "http", "ws", 1)+"/api/meetings/"+room.Code+"/ws", http.Header{"Authorization": []string{"Bearer " + user.Token}})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { ws.Close() })
		return ws
	}
	host := dial(a)
	welcome := meetingRead(t, host, "welcome")
	if welcome.Host != a.User.ID || welcome.ID != a.User.ID {
		t.Fatal("host not assigned from authenticated account")
	}
	guest := dial(b)
	meetingRead(t, guest, "welcome")
	meetingRead(t, host, "peer-joined")
	f.request("POST", "/api/meetings/"+room.Code+"/end", c.Token, nil, 403, nil)
	host.WriteJSON(meetingSignal{Type: "signal", To: b.User.ID, From: c.User.ID, Signal: "offer", SDP: "v=0\r\n"})
	signal := meetingRead(t, guest, "signal")
	if signal.From != a.User.ID {
		t.Fatal("signal sender spoofing")
	}
	guest.WriteJSON(meetingSignal{Type: "state", Screen: true, Recording: true, Microphone: true})
	state := meetingRead(t, host, "state")
	if state.Screen || state.Recording || !state.Microphone {
		t.Fatal("guest obtained host media privileges")
	}
	host.WriteJSON(meetingSignal{Type: "transfer", To: b.User.ID})
	if meetingRead(t, guest, "host").Host != b.User.ID {
		t.Fatal("host transfer failed")
	}
	f.request("POST", "/api/meetings/"+room.Code+"/end", a.Token, nil, 403, nil)
	f.request("POST", "/api/meetings/"+room.Code+"/end", b.Token, nil, 200, nil)
	meetingRead(t, host, "ended")
	meetingRead(t, guest, "ended")
	ws, response, err := websocket.DefaultDialer.Dial(strings.Replace(f.url, "http", "ws", 1)+"/api/meetings/"+room.Code+"/ws", http.Header{"Authorization": []string{"Bearer " + c.Token}})
	if ws != nil {
		ws.Close()
	}
	if err == nil || response.StatusCode != 404 {
		t.Fatal("ended room still joinable")
	}
}

func TestMeetingRequiresMembershipAndAutoTransfersHost(t *testing.T) {
	f := setup(t)
	a, b, c := f.register("host_alice"), f.register("peer_bobby"), f.register("other_carol")
	f.befriend(a, b)
	cid := f.direct(a, b)
	f.request("POST", "/api/meetings", c.Token, map[string]string{"conversationId": cid}, 403, nil)
	var room meetingRoom
	f.request("POST", "/api/meetings", a.Token, nil, 400, nil)
	f.request("POST", "/api/meetings", a.Token, map[string]string{"title": "test"}, 200, &room)
	dial := func(user account) *websocket.Conn {
		ws, _, err := websocket.DefaultDialer.Dial(strings.Replace(f.url, "http", "ws", 1)+"/api/meetings/"+room.Code+"/ws", http.Header{"Authorization": []string{"Bearer " + user.Token}})
		if err != nil {
			t.Fatal(err)
		}
		return ws
	}
	host := dial(a)
	defer host.Close()
	meetingRead(t, host, "welcome")
	guest := dial(b)
	defer guest.Close()
	meetingRead(t, guest, "welcome")
	host.Close()
	if meetingRead(t, guest, "host").Host != b.User.ID {
		t.Fatal("host succession failed")
	}
	f.request("POST", "/api/meetings/"+room.Code+"/end", b.Token, nil, 200, nil)
}
