package server

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func (f *fixture) group(owner account, members ...account) string {
	ids := []string{}
	for _, u := range members {
		f.befriend(owner, u)
		ids = append(ids, u.User.ID)
	}
	var c map[string]string
	f.request("POST", "/api/conversations", owner.Token, map[string]any{"kind": "group", "name": "设计讨论组", "members": ids}, 200, &c)
	return c["id"]
}
func (f *fixture) groupInfo(cid string, a account) groupInfo {
	var out struct{ Group groupInfo }
	f.request("GET", "/api/conversations/"+cid, a.Token, nil, 200, &out)
	return out.Group
}
func TestGroupNumbersJoiningRolesAndExit(t *testing.T) {
	f := setup(t)
	a, b, c, d := f.register("group_owner"), f.register("group_admin"), f.register("group_joiner"), f.register("group_other")
	cid := f.group(a, b)
	g := f.groupInfo(cid, a)
	if g.Number != "200000001" || g.Count != 2 || g.Role != "owner" {
		t.Fatalf("bad group %+v", g)
	}
	var found []map[string]any
	f.request("GET", "/api/groups?q="+g.Number, c.Token, nil, 200, &found)
	if len(found) != 0 {
		t.Fatal("private group searchable")
	}
	f.request("POST", "/api/groups/"+cid+"/join", c.Token, map[string]string{}, 404, nil)
	f.request("PATCH", "/api/groups/"+cid, b.Token, map[string]any{"discoverable": true}, 403, nil)
	f.request("PATCH", "/api/groups/"+cid, a.Token, map[string]any{"discoverable": true, "description": "一起讨论设计", "joinMode": "approval"}, 200, nil)
	f.request("GET", "/api/groups?q="+g.Number, c.Token, nil, 200, &found)
	if len(found) != 1 || found[0]["number"] != g.Number {
		t.Fatal(found)
	}
	if _, ok := found[0]["members"]; ok {
		t.Fatal("public search exposed membership")
	}
	f.request("POST", "/api/groups/"+cid+"/join", c.Token, map[string]string{"message": "我想加入"}, 200, nil)
	f.request("POST", "/api/groups/"+cid+"/join", c.Token, map[string]string{"message": "再次申请"}, 200, nil)
	var requests []struct {
		ID, Status string
		CanReview  bool
	}
	f.request("GET", "/api/group-requests", a.Token, nil, 200, &requests)
	if len(requests) != 1 || !requests[0].CanReview {
		t.Fatal(requests)
	}
	request := requests[0].ID
	f.request("GET", "/api/conversations/"+cid+"/messages", c.Token, nil, 403, nil)
	f.request("POST", "/api/group-requests/"+request, b.Token, map[string]bool{"accept": true}, 403, nil)
	f.request("PATCH", "/api/groups/"+cid+"/members/"+b.User.ID, a.Token, map[string]bool{"admin": true}, 200, nil)
	f.request("POST", "/api/group-requests/"+request, b.Token, map[string]bool{"accept": true}, 200, nil)
	f.request("POST", "/api/group-requests/"+request, a.Token, map[string]bool{"accept": true}, 409, nil)
	if f.groupInfo(cid, c).Count != 3 {
		t.Fatal("request not approved")
	}
	f.request("POST", "/api/groups/"+cid+"/join", d.Token, map[string]string{}, 200, nil)
	f.request("GET", "/api/group-requests", b.Token, nil, 200, &requests)
	f.request("POST", "/api/group-requests/"+requests[0].ID, b.Token, map[string]bool{"accept": false}, 200, nil)
	f.request("GET", "/api/conversations/"+cid, d.Token, nil, 403, nil)
	f.request("PATCH", "/api/groups/"+cid+"/members/"+a.User.ID, b.Token, map[string]int{"muteMinutes": 10}, 403, nil)
	f.request("PATCH", "/api/groups/"+cid+"/members/"+c.User.ID, b.Token, map[string]bool{"admin": true}, 403, nil)
	f.request("DELETE", "/api/conversations/"+cid+"/members/"+a.User.ID, a.Token, nil, 403, nil)
	f.request("POST", "/api/groups/"+cid+"/transfer", b.Token, map[string]string{"userId": c.User.ID}, 403, nil)
	f.request("POST", "/api/groups/"+cid+"/transfer", a.Token, map[string]string{"userId": d.User.ID}, 403, nil)
	f.request("POST", "/api/groups/"+cid+"/transfer", a.Token, map[string]string{"userId": c.User.ID}, 200, nil)
	if f.groupInfo(cid, a).Role != "member" || f.groupInfo(cid, c).Role != "owner" {
		t.Fatal("transfer roles incorrect")
	}
	f.request("DELETE", "/api/conversations/"+cid+"/members/"+a.User.ID, a.Token, nil, 200, nil)
	f.request("GET", "/api/conversations/"+cid+"/messages", a.Token, nil, 403, nil)
	f.request("DELETE", "/api/groups/"+cid, b.Token, nil, 403, nil)
	f.request("DELETE", "/api/groups/"+cid, c.Token, nil, 200, nil)
	f.request("GET", "/api/conversations/"+cid, b.Token, nil, 403, nil)
	f.request("POST", "/api/groups/"+cid+"/join", d.Token, map[string]string{}, 404, nil)
	f.request("GET", "/api/groups?q="+g.Number, d.Token, nil, 200, &found)
	if len(found) != 0 {
		t.Fatal("dissolved group found")
	}
	f.request("GET", "/api/group-requests", d.Token, nil, 200, &requests)
	if requests[0].Status != "rejected" {
		t.Fatal("review history lost")
	}
}

func TestGroupMuteCoversMessagesFilesForwardMeetingsAndNickname(t *testing.T) {
	f := setup(t)
	a, b, c := f.register("mute_owner"), f.register("mute_member"), f.register("mute_admin")
	cid := f.group(a, b, c)
	f.request("PATCH", "/api/groups/"+cid+"/members/"+c.User.ID, a.Token, map[string]bool{"admin": true}, 200, nil)
	f.request("PATCH", "/api/groups/"+cid+"/members/"+b.User.ID, b.Token, map[string]string{"nickname": "小陈"}, 200, nil)
	var m Message
	f.request("POST", "/api/conversations/"+cid+"/messages", b.Token, map[string]string{"text": "群名片消息", "clientId": "nickname-001"}, 200, &m)
	if m.Name != "小陈" {
		t.Fatal("group card not used", m.Name)
	}
	f.request("PATCH", "/api/groups/"+cid+"/members/"+b.User.ID, c.Token, map[string]int{"muteMinutes": 10}, 200, nil)
	f.request("POST", "/api/conversations/"+cid+"/messages", b.Token, map[string]string{"text": "绕过禁言", "clientId": "muted-text-001"}, 403, nil)
	f.request("POST", "/api/messages/forward", b.Token, map[string]any{"conversationId": cid, "messageIds": []string{m.ID}, "targets": []string{cid}, "mode": "merge", "clientId": "muted-forward-001"}, 403, nil)
	f.request("POST", "/api/meetings", b.Token, map[string]string{"conversationId": cid}, 403, nil)
	mediaUpload(t, f, cid, b, "blocked.txt", []byte("a muted upload"), nil, 403)
	if f.s.canSpeak(cid, b.User.ID) {
		t.Fatal("muted upload/typing gate allowed")
	}
	f.request("GET", "/api/conversations/"+cid+"/messages", b.Token, nil, 200, nil)
	f.request("PATCH", "/api/groups/"+cid+"/members/"+b.User.ID, a.Token, map[string]int{"muteMinutes": -1}, 400, nil)
	f.request("PATCH", "/api/groups/"+cid+"/members/"+b.User.ID, a.Token, map[string]int{"muteMinutes": 43201}, 400, nil)
	if _, e := f.s.db.Exec("UPDATE group_members SET mute_until=? WHERE conversation_id=? AND user_id=?", now()-1, cid, b.User.ID); e != nil {
		t.Fatal(e)
	}
	f.request("POST", "/api/conversations/"+cid+"/messages", b.Token, map[string]string{"text": "已自动解除", "clientId": "expired-mute-001"}, 200, nil)
	f.request("PATCH", "/api/groups/"+cid, a.Token, map[string]bool{"allMuted": true}, 200, nil)
	f.request("POST", "/api/conversations/"+cid+"/messages", b.Token, map[string]string{"text": "全员禁言", "clientId": "all-muted-001"}, 403, nil)
	for _, u := range []account{a, c} {
		f.request("POST", "/api/conversations/"+cid+"/messages", u.Token, map[string]string{"text": "管理通知", "clientId": "manager-text-001"}, 200, nil)
	}
	f.request("PATCH", "/api/groups/"+cid, b.Token, map[string]bool{"allMuted": false}, 403, nil)
	f.request("PATCH", "/api/groups/"+cid, c.Token, map[string]bool{"allMuted": false}, 200, nil)
	// A trigger checks authority again at the actual write, including internal/forwarded writes.
	f.request("DELETE", "/api/conversations/"+cid+"/members/"+b.User.ID, c.Token, nil, 200, nil)
	_, e := f.s.db.Exec("INSERT INTO messages(id,conversation_id,sender,kind,text,client_id,created) VALUES(?,?,?,'text','stale authorization','stale-member',?)", newID(), cid, b.User.ID, now())
	if e == nil || !strings.Contains(e.Error(), "group_send_forbidden") {
		t.Fatal("stale member inserted message", e)
	}
	var n int
	f.s.db.QueryRow("SELECT COUNT(*) FROM group_members WHERE conversation_id=? AND user_id=?", cid, b.User.ID).Scan(&n)
	if n != 0 {
		t.Fatal("stale admin/mute/card retained")
	}
}

func TestGroupInvitationApprovalCapacityAndAtomicUpdates(t *testing.T) {
	f := setup(t)
	a, b, c, d := f.register("invite_owner"), f.register("invite_member"), f.register("invite_friend"), f.register("invite_other")
	cid := f.group(a, b)
	f.befriend(b, c)
	f.befriend(a, c)
	f.befriend(a, d)
	f.request("POST", "/api/conversations/"+cid+"/members", b.Token, map[string]any{"members": []string{c.User.ID}}, 200, nil)
	if f.s.member(cid, c.User.ID) {
		t.Fatal("invite bypassed approval")
	}
	var requests []struct{ ID string }
	f.request("GET", "/api/group-requests", a.Token, nil, 200, &requests)
	f.request("POST", "/api/group-requests/"+requests[0].ID, a.Token, map[string]bool{"accept": true}, 200, nil)
	f.request("PATCH", "/api/groups/"+cid, a.Token, map[string]bool{"membersInvite": false}, 200, nil)
	f.request("POST", "/api/conversations/"+cid+"/members", b.Token, map[string]any{"members": []string{c.User.ID}}, 403, nil)
	f.request("PATCH", "/api/conversations/"+cid, a.Token, map[string]string{"name": "不应保存", "announcement": strings.Repeat("字", 2001)}, 400, nil)
	var detail map[string]any
	f.request("GET", "/api/conversations/"+cid, a.Token, nil, 200, &detail)
	if detail["name"] != "设计讨论组" {
		t.Fatal("partially applied update")
	}
	// Fill to 199 without bcrypt overhead, then verify a two-person invite is atomic.
	f.request("DELETE", "/api/conversations/"+cid+"/members/"+c.User.ID, a.Token, nil, 200, nil)
	for i := 0; i < 197; i++ {
		id := fmt.Sprintf("capacity-%d", i)
		if _, e := f.s.db.Exec("INSERT INTO users(id,account,name,password,created) VALUES(?,?,?,'unused',?)", id, id, id, now()); e != nil {
			t.Fatal(e)
		}
		if _, e := f.s.db.Exec("INSERT INTO members(conversation_id,user_id) VALUES(?,?)", cid, id); e != nil {
			t.Fatal(e)
		}
	}
	f.request("POST", "/api/conversations/"+cid+"/members", a.Token, map[string]any{"members": []string{c.User.ID, d.User.ID}}, 409, nil)
	if f.s.member(cid, c.User.ID) || f.s.member(cid, d.User.ID) {
		t.Fatal("over-capacity batch partly committed")
	}
	f.request("POST", "/api/conversations/"+cid+"/members", a.Token, map[string]any{"members": []string{c.User.ID}}, 200, nil)
	if f.groupInfo(cid, a).Count != 200 {
		t.Fatal("capacity wrong")
	}
	f.request("PATCH", "/api/groups/"+cid, a.Token, map[string]any{"discoverable": true, "joinMode": "open"}, 200, nil)
	f.request("POST", "/api/groups/"+cid+"/join", d.Token, map[string]string{}, 409, nil)
}

func TestGroupMigrationKeepsNumbersAndDissolutionEndsMeeting(t *testing.T) {
	f := setup(t)
	a, b := f.register("migration_owner"), f.register("migration_member")
	cid := f.group(a, b)
	g := f.groupInfo(cid, a)
	legacy := newID()
	if _, e := f.s.db.Exec("INSERT INTO conversations(id,kind,name,owner,created) VALUES(?,'group','旧版群',?,?)", legacy, a.User.ID, now()); e != nil {
		t.Fatal(e)
	}
	if _, e := f.s.db.Exec("INSERT INTO members(conversation_id,user_id) VALUES(?,?)", legacy, a.User.ID); e != nil {
		t.Fatal(e)
	}
	if _, e := f.s.db.Exec(groupSchema); e != nil {
		t.Fatal(e)
	}
	if f.groupInfo(cid, a).Number != g.Number {
		t.Fatal("migration changed number")
	}
	if legacyGroup := f.groupInfo(legacy, a); legacyGroup.Number == "" || legacyGroup.Number == g.Number || legacyGroup.Discoverable {
		t.Fatalf("bad legacy migration %+v", legacyGroup)
	}
	var room meetingRoom
	f.request("POST", "/api/meetings", a.Token, map[string]string{"conversationId": cid}, 200, &room)
	f.request("DELETE", "/api/groups/"+cid, a.Token, nil, 200, nil)
	f.s.meetings.Lock()
	_, exists := f.s.meetings.rooms[room.Code]
	f.s.meetings.Unlock()
	if exists {
		t.Fatal("dissolution left group meeting alive")
	}
	if _, e := f.s.db.Exec(groupSchema); e != nil {
		t.Fatal(e)
	}
	var dissolved int
	if e := f.s.db.QueryRow("SELECT dissolved FROM group_profiles WHERE conversation_id=?", cid).Scan(&dissolved); e != nil || dissolved == 0 {
		t.Fatal("migration revived group")
	}
	req, _ := http.NewRequest("GET", f.url+"/api/groups?q="+g.Number, nil)
	resp, e := http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatal("unauthenticated search")
	}
}
