package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestMeetingCaptionsBecomeMinutes(t *testing.T) {
	f := setup(t)
	a, b := f.register("minutes_host"), f.register("minutes_guest")
	f.befriend(a, b)
	cid := f.direct(a, b)
	var room meetingRoom
	f.request("POST", "/api/meetings", a.Token, map[string]string{"title": "周会", "conversationId": cid}, 200, &room)
	dial := func(user account) *websocket.Conn {
		ws, _, err := websocket.DefaultDialer.Dial(strings.Replace(f.url, "http", "ws", 1)+"/api/meetings/"+room.Code+"/ws", http.Header{"Authorization": []string{"Bearer " + user.Token}})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { ws.Close() })
		return ws
	}
	host := dial(a)
	meetingRead(t, host, "welcome")
	guest := dial(b)
	meetingRead(t, guest, "welcome")
	events := f.socket(b)
	host.WriteJSON(meetingSignal{Type: "caption", Text: "我们周五发布"})
	if c := meetingRead(t, guest, "caption"); c.Text != "我们周五发布" || c.Final || c.Name != "minutes_host" {
		t.Fatalf("interim caption: %+v", c)
	}
	host.WriteJSON(meetingSignal{Type: "caption", Text: "我们周五发布 0.2 版", Final: true})
	guest.WriteJSON(meetingSignal{Type: "caption", Text: "好的，我负责测试", Final: true})
	meetingRead(t, host, "caption")
	host.WriteJSON(meetingSignal{Type: "end"})
	events.SetReadDeadline(time.Now().Add(5 * time.Second))
	var docID string
	for docID == "" {
		var e struct {
			Type string
			Data json.RawMessage
		}
		if err := events.ReadJSON(&e); err != nil {
			t.Fatal("no minutes:", err)
		}
		if e.Type == "meeting-minutes" {
			var d struct{ DocID string }
			json.Unmarshal(e.Data, &d)
			docID = d.DocID
		}
	}
	d := f.openDoc(b, docID)
	var body docBody
	json.Unmarshal(d.Content, &body)
	text := ""
	for _, blk := range body.Blocks {
		text += blk.Text + "\n"
	}
	if d.Role != "edit" || !strings.Contains(d.Title, "会议纪要 · 周会") || !strings.Contains(text, "minutes_guest：好的，我负责测试") || !strings.Contains(text, "参会人") {
		t.Fatalf("minutes doc: %s %s\n%s", d.Role, d.Title, text)
	}
	var list []Message
	f.request("GET", "/api/conversations/"+cid+"/messages", b.Token, nil, 200, &list)
	if last := list[len(list)-1]; !strings.Contains(last.Text, docMessageMarker+docID) {
		t.Fatalf("minutes not posted: %+v", last)
	}
}
