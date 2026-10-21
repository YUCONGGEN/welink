package server

import (
	"net/http"
	"strings"
	"testing"
	"time"
	"github.com/gorilla/websocket"
)

func TestLastParticipantLeavingEndsOutstandingInvitations(t *testing.T) {
	f := setup(t)
	a,b := f.register("leave_host"),f.register("leave_invitee")
	f.befriend(a,b)
	events := f.socket(b)
	var room meetingRoom
	f.request("POST","/api/meetings",a.Token,map[string]any{"members":[]string{b.User.ID}},200,&room)
	host,_,err := websocket.DefaultDialer.Dial(strings.Replace(f.url,"http","ws",1)+"/api/meetings/"+room.Code+"/ws",http.Header{"Authorization":[]string{"Bearer "+a.Token}})
	if err != nil { t.Fatal(err) }
	meetingRead(t,host,"welcome")
	host.Close()
	events.SetReadDeadline(time.Now().Add(3*time.Second))
	for {
		var event struct { Type string; Data struct{ Code string } }
		if err := events.ReadJSON(&event); err != nil { t.Fatal(err) }
		if event.Type == "meeting-ended" {
			if event.Data.Code != room.Code { t.Fatal("wrong meeting ended") }
			break
		}
	}
	f.request("GET","/api/meetings/"+room.Code,b.Token,nil,404,nil)
}
