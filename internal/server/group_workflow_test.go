package server

import "testing"

func TestAdminCreatesAccountWithoutDisplayName(t *testing.T) {
	f := setupCommunity(t)
	a := f.register("optional_name_admin")
	f.s.settings.Admin.Users = []string{a.User.ID}
	f.s.settings.Registration.Enabled = false
	var made struct {
		User            User
		InitialPassword string
	}
	f.request("POST", "/api/admin/users", a.Token, map[string]string{}, 200, &made)
	if made.User.Name != made.User.Number || len(made.User.Number) != 6 || made.InitialPassword == "" {
		t.Fatal("missing usable generated credentials")
	}
	var session account
	f.request("POST", "/api/auth/login", "", map[string]string{"account": made.User.Number, "password": made.InitialPassword}, 200, &session)
	f.request("POST", "/api/admin/users", session.Token, map[string]string{}, 403, nil)
	f.request("POST", "/api/auth/register", "", map[string]string{}, 403, nil)
	f.request("POST", "/api/admin/users", a.Token, map[string]string{"password": "short"}, 400, nil)
	f.request("POST", "/api/admin/users", a.Token, map[string]string{"name": " ", "password": "explicit-password-123!"}, 200, &made)
	if made.User.Name != made.User.Number {
		t.Fatal("blank name was not replaced")
	}
}

func TestHiddenGroupCanBeFoundAndReopenedWithoutApplying(t *testing.T) {
	f := setupCommunity(t)
	a, b, c := f.register("workflow_owner"), f.register("workflow_member"), f.register("workflow_other")
	var created map[string]string
	f.request("POST", "/api/conversations", a.Token, map[string]any{"kind": "group", "members": []string{b.User.ID}}, 200, &created)
	cid := created["id"]
	var detail struct {
		Name  string
		Group groupInfo
	}
	f.request("GET", "/api/conversations/"+cid, a.Token, nil, 200, &detail)
	if detail.Name != a.User.Name+"、"+b.User.Name || detail.Group.JoinMode != "open" {
		t.Fatal("group default name/join mode", detail)
	}
	f.request("PATCH", "/api/groups/"+cid, a.Token, map[string]any{"joinMode": "approval"}, 200, nil)
	f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, map[string]string{"text": "keep history", "clientId": "hidden-history"}, 200, nil)
	f.request("DELETE", "/api/conversations/"+cid, b.Token, nil, 200, nil)
	var mine []map[string]any
	f.request("GET", "/api/groups?mine=1", b.Token, nil, 200, &mine)
	if len(mine) != 1 || mine[0]["id"] != cid || mine[0]["joined"] != true {
		t.Fatal("hidden member missing from directory", mine)
	}
	f.request("GET", "/api/groups?q="+detail.Group.Number, b.Token, nil, 200, &mine)
	if len(mine) != 1 || mine[0]["joined"] != true {
		t.Fatal("member was treated as applicant")
	}
	f.request("GET", "/api/groups?mine=1", c.Token, nil, 200, &mine)
	if len(mine) != 0 {
		t.Fatal("private membership leaked")
	}
	f.request("POST", "/api/conversations/"+cid+"/open", c.Token, nil, 404, nil)
	f.request("POST", "/api/conversations/"+cid+"/open", b.Token, nil, 200, nil)
	var conversations []map[string]any
	f.request("GET", "/api/conversations", b.Token, nil, 200, &conversations)
	if len(conversations) != 1 {
		t.Fatal("not restored")
	}
	f.request("POST", "/api/conversations/"+cid+"/messages", b.Token, map[string]string{"text": "chat after reopening", "clientId": "reopen-chat"}, 200, nil)
	var messages []Message
	f.request("GET", "/api/conversations/"+cid+"/messages", b.Token, nil, 200, &messages)
	if len(messages) != 2 {
		t.Fatal("history missing")
	}
	f.request("DELETE", "/api/conversations/"+cid, b.Token, nil, 200, nil)
	f.request("POST", "/api/groups/"+cid+"/join", b.Token, map[string]string{}, 200, nil)
	f.request("GET", "/api/conversations", b.Token, nil, 200, &conversations)
	if len(conversations) != 1 {
		t.Fatal("legacy member entry did not restore")
	}
	f.request("POST", "/api/conversations/"+cid+"/members", b.Token, map[string]any{"members": []string{c.User.ID}}, 200, nil)
	if !f.s.member(cid, c.User.ID) {
		t.Fatal("invitation incorrectly requires approval")
	}
	var pending int
	f.s.db.QueryRow("SELECT COUNT(*) FROM group_requests WHERE conversation_id=?", cid).Scan(&pending)
	if pending != 0 {
		t.Fatal("unnecessary applications", pending)
	}
}
