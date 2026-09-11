package server

import (
	"net/http/httptest"
	"testing"
)

func attentionFixture(t *testing.T) *fixture {
	t.Helper()
	settings := DefaultSettings()
	settings.Registration.Enabled = true
	settings.Directory.AllUsers = true
	s, err := New(Config{DataDir: t.TempDir(), Settings: &settings})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(func() { s.Close(); srv.Close() })
	return &fixture{t: t, s: s, url: srv.URL, server: srv}
}

func TestSpecialCareIsPrivateAndPreservesOtherContactPreferences(t *testing.T) {
	f := attentionFixture(t)
	a, b, c := f.register("care_owner"), f.register("care_person"), f.register("care_other")
	read := func(owner, peer account) User {
		t.Helper()
		var detail struct{ User User }
		f.request("GET", "/api/contacts/"+peer.User.ID, owner.Token, nil, 200, &detail)
		return detail.User
	}
	f.request("PATCH", "/api/contacts/"+b.User.ID, a.Token, map[string]any{"specialCare": true, "remark": "家人", "note": "仅自己可见"}, 200, nil)
	if !read(a, b).SpecialCare || read(b, a).SpecialCare || read(c, b).SpecialCare {
		t.Fatal("special care is not owner-private")
	}
	var people []User
	f.request("GET", "/api/friends", a.Token, nil, 200, &people)
	count := 0
	for _, person := range people {
		if person.SpecialCare {
			count++
			if person.ID != b.User.ID {
				t.Fatal("wrong person marked")
			}
		}
	}
	if count != 1 {
		t.Fatal("directory did not expose the private care list", people)
	}
	var conversations []map[string]any
	f.request("GET", "/api/conversations", a.Token, nil, 200, &conversations)
	if len(conversations) != 0 {
		t.Fatal("marking a contact created a chat")
	}
	people = nil
	f.request("GET", "/api/users?q="+b.User.Number, c.Token, nil, 200, &people)
	if len(people) != 1 || people[0].SpecialCare || people[0].Remark != "" {
		t.Fatal("care metadata leaked through search", people)
	}
	f.request("PATCH", "/api/contacts/"+b.User.ID, a.Token, map[string]any{"note": "新的描述"}, 200, nil)
	if u := read(a, b); !u.SpecialCare || u.Remark != "家人" || u.Note != "新的描述" {
		t.Fatal("partial update removed care or remark", u)
	}
	var otherGroup map[string]string
	f.request("POST", "/api/contact-groups", c.Token, map[string]string{"name": "同事"}, 200, &otherGroup)
	f.request("PATCH", "/api/contacts/"+b.User.ID, a.Token, map[string]any{"specialCare": false, "groupId": otherGroup["id"]}, 400, nil)
	if !read(a, b).SpecialCare {
		t.Fatal("failed update changed special care")
	}
	f.request("POST", "/api/contact-groups", a.Token, map[string]string{"name": "特别关心"}, 400, nil)
	f.request("PATCH", "/api/contacts/"+b.User.ID, a.Token, map[string]any{"specialCare": "true"}, 400, nil)
	f.request("PATCH", "/api/contacts/"+a.User.ID, a.Token, map[string]bool{"specialCare": true}, 403, nil)
	f.request("PATCH", "/api/contacts/"+newID(), a.Token, map[string]bool{"specialCare": true}, 403, nil)
	f.request("PATCH", "/api/contacts/"+b.User.ID, "", map[string]bool{"specialCare": true}, 401, nil)
	f.request("PATCH", "/api/contacts/"+b.User.ID, a.Token, map[string]any{"messageBlocked": true}, 200, nil)
	var result map[string]string
	f.request("POST", "/api/conversations", b.Token, map[string]any{"kind": "direct", "members": []string{a.User.ID}}, 200, &result)
	f.request("POST", "/api/conversations/"+result["id"]+"/messages", b.Token, map[string]string{"text": "关心不会绕过屏蔽", "clientId": "care-blocked"}, 403, nil)
	if !read(a, b).SpecialCare {
		t.Fatal("blocking messages changed special care")
	}
	f.request("PATCH", "/api/contacts/"+b.User.ID, a.Token, map[string]bool{"specialCare": false}, 200, nil)
	if u := read(a, b); u.SpecialCare || u.Remark != "家人" || u.Note != "新的描述" {
		t.Fatal("canceling care deleted private notes", u)
	}
}

func TestSpecialCareRemovalPreservesChatAndOtherOwners(t *testing.T) {
	f := attentionFixture(t)
	a, b, c := f.register("care_remove_owner"), f.register("care_remove_peer"), f.register("care_no_chat")
	set := func(owner, peer account) {
		t.Helper()
		f.request("PATCH", "/api/contacts/"+peer.User.ID, owner.Token, map[string]any{"specialCare": true, "remark": "保留备注"}, 200, nil)
	}
	read := func(owner, peer account) User {
		t.Helper()
		var result struct{ User User }
		f.request("GET", "/api/contacts/"+peer.User.ID, owner.Token, nil, 200, &result)
		return result.User
	}
	set(a, b)
	set(b, a)
	set(a, c)
	f.request("DELETE", "/api/contacts/"+c.User.ID, a.Token, nil, 200, nil)
	if u := read(a, c); u.SpecialCare || u.Remark != "保留备注" {
		t.Fatal("removing never-chatted contact failed", u)
	}
	var result map[string]string
	f.request("POST", "/api/conversations", a.Token, map[string]any{"kind": "direct", "members": []string{b.User.ID}}, 200, &result)
	cid := result["id"]
	var first Message
	f.request("POST", "/api/conversations/"+cid+"/messages", b.Token, map[string]string{"text": "原来的聊天记录", "clientId": "care-before-remove"}, 200, &first)
	var chats []struct {
		ID   string
		Peer User
	}
	f.request("GET", "/api/conversations", a.Token, nil, 200, &chats)
	if len(chats) != 1 || !chats[0].Peer.SpecialCare {
		t.Fatal("chat peer lost the private care marker", chats)
	}
	f.request("DELETE", "/api/contacts/"+b.User.ID, a.Token, nil, 200, nil)
	if u := read(a, b); u.SpecialCare || u.Remark != "保留备注" || !read(b, a).SpecialCare {
		t.Fatal("removal changed the wrong owner or lost notes", u)
	}
	chats = nil
	f.request("GET", "/api/conversations", a.Token, nil, 200, &chats)
	if len(chats) != 0 {
		t.Fatal("removed conversation remains visible")
	}
	var messages []Message
	f.request("GET", "/api/conversations/"+cid+"/messages", a.Token, nil, 200, &messages)
	if len(messages) != 1 || messages[0].ID != first.ID {
		t.Fatal("removal deleted chat history")
	}
	f.request("POST", "/api/conversations/"+cid+"/messages", b.Token, map[string]string{"text": "再次聊天", "clientId": "care-after-remove"}, 200, nil)
	chats = nil
	f.request("GET", "/api/conversations", a.Token, nil, 200, &chats)
	if len(chats) != 1 || chats[0].ID != cid || chats[0].Peer.SpecialCare {
		t.Fatal("chat did not return with the retained history")
	}
	set(a, b)
	f.request("POST", "/api/contact-blocks/"+b.User.ID, a.Token, nil, 200, nil)
	var remaining int
	if err := f.s.db.QueryRow("SELECT COUNT(*) FROM contact_attention WHERE (user_id=? AND peer_id=?) OR (user_id=? AND peer_id=?)", a.User.ID, b.User.ID, b.User.ID, a.User.ID).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatal("blocked relationship retained orphan care entries", err, remaining)
	}
}

func TestSpecialCareSchemaUpgradesAnExistingStore(t *testing.T) {
	dir := t.TempDir()
	db, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	a, b := newID(), newID()
	for i, id := range []string{a, b} {
		if _, err = db.Exec("INSERT INTO users(id,account,name,password,created) VALUES(?,?,?,?,?)", id, id, "旧账号", []byte("test-hash"), i); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = db.Exec("INSERT INTO friends(user_id,peer_id,remark) VALUES(?,?,?)", a, b, "升级前的备注"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO contact_preferences(user_id,peer_id,note) VALUES(?,?,?)", a, b, "升级前的描述"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("DROP TABLE contact_attention"); err != nil {
		t.Fatal(err)
	}
	db.Close()
	for i := 0; i < 2; i++ {
		db, err = openStore(dir)
		if err != nil {
			t.Fatal(err)
		}
		var note, remark string
		if err = db.QueryRow("SELECT f.remark,p.note FROM friends f JOIN contact_preferences p USING(user_id,peer_id) WHERE f.user_id=? AND f.peer_id=?", a, b).Scan(&remark, &note); err != nil || note != "升级前的描述" || remark != "升级前的备注" {
			t.Fatal("upgrade lost existing preferences", err)
		}
		if _, err = db.Exec("INSERT OR IGNORE INTO contact_attention(user_id,peer_id) VALUES(?,?)", a, b); err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
}
