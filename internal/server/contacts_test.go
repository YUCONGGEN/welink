package server

import (
	"github.com/gorilla/websocket"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestBlockRevokesNonGroupMeetingAccessAndKeepsSharedGroup(t *testing.T) {
	for _, kind := range []string{"public", "other-direct", "group"} {
		t.Run(kind, func(t *testing.T) {
			f := setup(t)
			a, b, c := f.register("room_owner"), f.register("room_guest"), f.register("room_third")
			var cid string
			if kind == "group" {
				cid = f.group(a, b, c)
			} else {
				f.befriend(a, b)
				if kind == "other-direct" {
					f.befriend(a, c)
					cid = f.direct(a, c)
				}
			}
			var room meetingRoom
			f.request("POST", "/api/meetings", a.Token, map[string]string{"title": kind, "conversationId": cid}, 200, &room)
			dial := func(user account, status int) *websocket.Conn {
				t.Helper()
				ws, response, err := websocket.DefaultDialer.Dial(strings.Replace(f.url, "http", "ws", 1)+"/api/meetings/"+room.Code+"/ws", http.Header{"Authorization": []string{"Bearer " + user.Token}})
				if response == nil || response.StatusCode != status || (status == 101 && err != nil) {
					t.Fatalf("meeting admission: expected %d, response %v, error %v", status, response, err)
				}
				if ws != nil {
					t.Cleanup(func() { ws.Close() })
				}
				return ws
			}
			host := dial(a, 101)
			meetingRead(t, host, "welcome")
			guest := dial(b, 101)
			meetingRead(t, guest, "welcome")
			meetingRead(t, host, "peer-joined")
			f.request("POST", "/api/contact-blocks/"+b.User.ID, a.Token, nil, 200, nil)
			if kind == "group" {
				if err := guest.WriteJSON(meetingSignal{Type: "ping"}); err != nil {
					t.Fatal(err)
				}
				meetingRead(t, guest, "pong")
				guest.Close()
				meetingRead(t, host, "peer-left")
				meetingRead(t, dial(b, 101), "welcome")
			} else {
				guest.SetReadDeadline(time.Now().Add(2 * time.Second))
				for {
					_, _, err := guest.ReadMessage()
					if err != nil {
						if timeout, ok := err.(net.Error); ok && timeout.Timeout() {
							t.Fatal("blocked meeting connection remained open")
						}
						break
					}
				}
				dial(b, 403)
			}
			f.request("POST", "/api/meetings/"+room.Code+"/end", a.Token, nil, 200, nil)
		})
	}
}

func TestContactGroupsRemarksPrivacyAndOwnership(t *testing.T) {
	f := setup(t)
	a, b, c := f.register("contact_owner"), f.register("contact_friend"), f.register("contact_other")
	f.befriend(a, b)
	cid := f.direct(a, b)
	var first, second map[string]string
	f.request("POST", "/api/contact-groups", a.Token, map[string]string{"name": "同事"}, 200, &first)
	f.request("POST", "/api/contact-groups", a.Token, map[string]string{"name": "朋友"}, 200, &second)
	f.request("POST", "/api/contact-groups", a.Token, map[string]string{"name": "同事"}, 409, nil)
	f.request("PATCH", "/api/contacts/"+b.User.ID, a.Token, map[string]string{"remark": "小陈", "note": "摄影与设计", "groupId": first["id"]}, 200, nil)
	var friends []User
	friends = nil
	f.request("GET", "/api/friends", a.Token, nil, 200, &friends)
	if len(friends) != 1 || friends[0].Remark != "小陈" || friends[0].ContactGroupID != first["id"] || friends[0].Note != "摄影与设计" {
		t.Fatal(friends)
	}
	friends = nil
	f.request("GET", "/api/friends", b.Token, nil, 200, &friends)
	if friends[0].Remark != "" || friends[0].Note != "" || friends[0].ContactGroupID != "" {
		t.Fatal("private metadata leaked", friends)
	}
	var conversations []map[string]any
	f.request("GET", "/api/conversations", a.Token, nil, 200, &conversations)
	if conversations[0]["name"] != "小陈" || conversations[0]["canSend"] != true {
		t.Fatal(conversations)
	}
	f.request("PATCH", "/api/contacts/"+a.User.ID, b.Token, map[string]string{"remark": "不应保存", "groupId": first["id"]}, 400, nil)
	friends = nil
	f.request("GET", "/api/friends", b.Token, nil, 200, &friends)
	if friends[0].Remark != "" {
		t.Fatal("partial metadata write")
	}
	f.request("PATCH", "/api/contact-groups/"+first["id"], b.Token, map[string]string{"name": "越权"}, 404, nil)
	f.request("DELETE", "/api/contact-groups/"+first["id"], b.Token, nil, 404, nil)
	f.request("POST", "/api/contact-groups/order", a.Token, map[string]any{"ids": []string{second["id"], first["id"]}}, 200, nil)
	var groups []map[string]any
	f.request("GET", "/api/contact-groups", a.Token, nil, 200, &groups)
	if groups[0]["id"] != second["id"] {
		t.Fatal(groups)
	}
	f.request("DELETE", "/api/contact-groups/"+first["id"], a.Token, nil, 200, nil)
	friends = nil
	f.request("GET", "/api/friends", a.Token, nil, 200, &friends)
	if friends[0].ContactGroupID != "" || friends[0].Remark != "小陈" {
		t.Fatal("deleting group removed metadata", friends)
	}
	f.request("PATCH", "/api/contact-privacy", a.Token, map[string]bool{"searchable": false, "allowRequests": false}, 200, nil)
	var users []User
	f.request("GET", "/api/users?q="+a.User.Number, c.Token, nil, 200, &users)
	if len(users) != 0 {
		t.Fatal("hidden user found")
	}
	f.request("GET", "/api/users?q="+a.User.Number, b.Token, nil, 200, &users)
	if len(users) != 1 {
		t.Fatal("friend disappeared from search")
	}
	f.request("POST", "/api/requests", c.Token, map[string]string{"userId": a.User.ID}, 403, nil)
	f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, map[string]string{"text": "现有好友不受影响", "clientId": "privacy-friend-001"}, 200, nil)
	f.request("PATCH", "/api/contact-privacy", a.Token, map[string]bool{"searchable": true}, 200, nil)
	var privacy map[string]bool
	f.request("GET", "/api/contact-privacy", a.Token, nil, 200, &privacy)
	if !privacy["searchable"] || privacy["allowRequests"] {
		t.Fatal("partial privacy update changed omitted fields", privacy)
	}
}

func TestContactRemovalBlocksPrivateWritesAndPreservesGroupAndHistory(t *testing.T) {
	f := setup(t)
	a, b, c := f.register("remove_owner"), f.register("remove_friend"), f.register("remove_other")
	group := f.group(a, b, c)
	cid := f.direct(a, b)
	var old Message
	f.request("POST", "/api/conversations/"+cid+"/messages", b.Token, map[string]string{"text": "保留历史", "clientId": "before-removal-001"}, 200, &old)
	f.request("DELETE", "/api/contacts/"+b.User.ID, a.Token, nil, 200, nil)
	for _, u := range []account{a, b} {
		f.request("GET", "/api/conversations/"+cid+"/messages", u.Token, nil, 200, nil)
		f.request("POST", "/api/conversations/"+cid+"/messages", u.Token, map[string]string{"text": "已删除好友", "clientId": "removed-send-001"}, 403, nil)
		f.request("POST", "/api/messages/forward", u.Token, map[string]any{"conversationId": cid, "messageIds": []string{old.ID}, "targets": []string{cid}, "mode": "each", "clientId": "removed-forward-001"}, 403, nil)
		mediaUpload(t, f, cid, u, "blocked.txt", []byte("blocked"), nil, 403)
	}
	f.request("POST", "/api/conversations/"+group+"/messages", b.Token, map[string]string{"text": "共同群聊继续", "clientId": "group-after-removal"}, 200, nil)
	f.request("POST", "/api/conversations", b.Token, map[string]any{"kind": "direct", "members": []string{a.User.ID}}, 403, nil)
	f.request("POST", "/api/meetings", b.Token, map[string]string{"conversationId": cid}, 403, nil)
	var request map[string]string
	f.request("POST", "/api/requests", b.Token, map[string]string{"userId": a.User.ID}, 200, &request)
	f.request("POST", "/api/contact-blocks/"+b.User.ID, a.Token, nil, 200, nil)
	f.request("POST", "/api/requests/"+request["id"], a.Token, map[string]bool{"accept": true}, 404, nil)
	f.request("POST", "/api/requests", b.Token, map[string]string{"userId": a.User.ID}, 403, nil)
	var blocks []map[string]any
	f.request("GET", "/api/contact-blocks", a.Token, nil, 200, &blocks)
	if len(blocks) != 1 || blocks[0]["id"] != b.User.ID {
		t.Fatal(blocks)
	}
	f.request("GET", "/api/contact-blocks", b.Token, nil, 200, &blocks)
	if len(blocks) != 0 {
		t.Fatal("blocklist leaked")
	}
	var users []User
	f.request("GET", "/api/users?q="+a.User.Number, b.Token, nil, 200, &users)
	if len(users) != 0 {
		t.Fatal("blocked user found blocker")
	}
	f.request("DELETE", "/api/contact-blocks/"+b.User.ID, a.Token, nil, 200, nil)
	if contactAllowed(f.s.db, a.User.ID, b.User.ID) {
		t.Fatal("unblock restored friendship")
	}
	f.request("POST", "/api/requests", b.Token, map[string]string{"userId": a.User.ID}, 200, &request)
	f.request("POST", "/api/requests/"+request["id"], a.Token, map[string]bool{"accept": true}, 200, nil)
	if f.direct(a, b) != cid {
		t.Fatal("re-add duplicated conversation")
	}
	f.request("POST", "/api/conversations/"+cid+"/messages", b.Token, map[string]string{"text": "重新添加", "clientId": "readded-friend-001"}, 200, nil)
}

func TestBlockEndsRemoteAndDirectMeetingAndDeniesNewChannels(t *testing.T) {
	f := setup(t)
	a, b := f.register("block_host"), f.register("block_guest")
	f.befriend(a, b)
	cid := f.direct(a, b)
	f.socket(b)
	var remote Remote
	f.request("POST", "/api/remotes", a.Token, map[string]string{"conversationId": cid, "mode": "view"}, 200, &remote)
	f.request("POST", "/api/remotes/"+remote.ID+"/respond", b.Token, map[string]any{"accept": true, "deviceId": "1234567890abcdef12345678"}, 200, nil)
	dial := func(user account) *websocket.Conn {
		c, _, e := websocket.DefaultDialer.Dial(strings.Replace(f.url, "http", "ws", 1)+"/api/remotes/"+remote.ID+"/tunnel", http.Header{"Authorization": []string{"Bearer " + user.Token}})
		if e != nil {
			t.Fatal(e)
		}
		t.Cleanup(func() { c.Close() })
		return c
	}
	left, right := dial(a), dial(b)
	var room meetingRoom
	f.request("POST", "/api/meetings", a.Token, map[string]string{"conversationId": cid}, 200, &room)
	f.request("POST", "/api/contact-blocks/"+b.User.ID, a.Token, nil, 200, nil)
	for _, conn := range []*websocket.Conn{left, right} {
		conn.SetReadDeadline(time.Now().Add(time.Second))
		if _, _, e := conn.ReadMessage(); e == nil {
			t.Fatal("remote tunnel remained open")
		}
	}
	current, e := f.s.remote(remote.ID)
	if e != nil || current.State != "ended" {
		t.Fatal("remote not ended", current, e)
	}
	f.s.meetings.Lock()
	_, exists := f.s.meetings.rooms[room.Code]
	f.s.meetings.Unlock()
	if exists {
		t.Fatal("direct meeting not ended")
	}
	f.request("POST", "/api/remotes", a.Token, map[string]string{"conversationId": cid, "mode": "view"}, 403, nil)
	f.request("POST", "/api/meetings", a.Token, map[string]any{"members": []string{b.User.ID}}, 403, nil)
	// A stale authorization snapshot cannot write new remote sessions or messages.
	_, e = f.s.db.Exec("INSERT INTO remotes VALUES(?,?,?,?,?,?,?,?,?,?)", newID(), cid, a.User.ID, b.User.ID, b.User.ID, "view", "pending", "", now(), now())
	if e == nil || !strings.Contains(e.Error(), "contact_send_forbidden") {
		t.Fatal(e)
	}
}
