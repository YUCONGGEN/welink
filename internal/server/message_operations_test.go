package server

import (
	"fmt"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func sendTestMessage(f *fixture, cid string, who account, text, reply string) Message {
	f.t.Helper()
	var m Message
	f.request("POST", "/api/conversations/"+cid+"/messages", who.Token, map[string]string{"text": text, "replyId": reply, "clientId": newID()}, 200, &m)
	return m
}

func readDeletion(t *testing.T, ws *websocket.Conn, id string) {
	t.Helper()
	ws.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		var event struct {
			Type string
			Data struct{ ID string }
		}
		if err := ws.ReadJSON(&event); err != nil {
			t.Fatal(err)
		}
		if event.Type == "message-deleted" {
			if event.Data.ID != id {
				t.Fatal("wrong deleted id")
			}
			return
		}
	}
}

func TestMessageDeletionIsPersonalPersistentAndSynchronized(t *testing.T) {
	f := setup(t)
	a, b, outsider := f.register("delete_alice"), f.register("delete_bobby"), f.register("delete_outsider")
	f.befriend(a, b)
	cid := f.direct(a, b)
	old := sendTestMessage(f, cid, b, "保留这条记录", "")
	deleted := sendTestMessage(f, cid, b, "仅删除自己的记录", "")
	f.request("POST", "/api/favorites/"+deleted.ID, a.Token, nil, 200, nil)
	a1, a2, peer := f.socket(a), f.socket(a), f.socket(b)
	f.request("DELETE", "/api/messages/"+deleted.ID, outsider.Token, nil, 404, nil)
	f.request("DELETE", "/api/messages/"+deleted.ID, a.Token, nil, 200, nil)
	readDeletion(t, a1, deleted.ID)
	readDeletion(t, a2, deleted.ID)
	var history []Message
	f.request("GET", "/api/conversations/"+cid+"/messages", a.Token, nil, 200, &history)
	if len(history) != 1 || history[0].ID != old.ID {
		t.Fatal("deleted message remained in history")
	}
	f.request("GET", "/api/conversations/"+cid+"/messages?q="+url.QueryEscape(deleted.Text), a.Token, nil, 200, &history)
	if len(history) != 0 {
		t.Fatal("deleted message remained searchable")
	}
	f.request("GET", "/api/conversations/"+cid+"/messages?around="+deleted.ID, a.Token, nil, 404, nil)
	f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, map[string]string{"text": "不能引用已删除记录", "replyId": deleted.ID, "clientId": newID()}, 400, nil)
	var conversations []struct {
		Last   Message
		Unread int
	}
	f.request("GET", "/api/conversations", a.Token, nil, 200, &conversations)
	if len(conversations) != 1 || conversations[0].Last.ID != old.ID || conversations[0].Unread != 1 {
		t.Fatal("preview/unread did not honor personal deletion")
	}
	f.request("GET", "/api/conversations/"+cid+"/messages", b.Token, nil, 200, &history)
	if len(history) != 2 {
		t.Fatal("deletion affected peer")
	}
	f.request("GET", "/api/favorites", a.Token, nil, 200, &history)
	if len(history) != 1 || history[0].ID != deleted.ID {
		t.Fatal("deletion destroyed independent favorite")
	}
	// The next shared event proves that the peer did not receive a personal deletion.
	marker := sendTestMessage(f, cid, a, "继续聊天", "")
	peer.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		var event struct {
			Type string
			Data Message
		}
		if err := peer.ReadJSON(&event); err != nil {
			t.Fatal(err)
		}
		if event.Type == "message-deleted" {
			t.Fatal("personal deletion leaked to peer")
		}
		if event.Type == "message" && event.Data.ID == marker.ID {
			break
		}
	}
	f.request("DELETE", "/api/messages/"+deleted.ID, a.Token, nil, 200, nil)
	var count int
	if err := f.s.db.QueryRow("SELECT COUNT(*) FROM message_deletions WHERE user_id=? AND message_id=?", a.User.ID, deleted.ID).Scan(&count); err != nil || count != 1 {
		t.Fatal("deletion not persisted idempotently", err)
	}
}

func TestHistorySearchFiltersPaginationContextAndReplyRedaction(t *testing.T) {
	f := setup(t)
	a, b := f.register("history_alice"), f.register("history_bobby")
	f.befriend(a, b)
	cid := f.direct(a, b)
	root := sendTestMessage(f, cid, a, "原消息 100%_含特殊符号", "")
	base := now() - 86400000
	var ids []string
	for i := 0; i < 135; i++ {
		id := newID()
		ids = append(ids, id)
		if _, err := f.s.db.Exec("INSERT INTO messages(id,conversation_id,sender,kind,text,client_id,created) VALUES(?,?,?,'text',?,?,?)", id, cid, b.User.ID, fmt.Sprintf("历史记录 %03d", i), newID(), base+int64(i)*1000); err != nil {
			t.Fatal(err)
		}
	}
	reply := sendTestMessage(f, cid, b, "引用跨越多页的原消息", root.ID)
	if reply.Reply == nil || reply.Reply.Text != root.Text {
		t.Fatal("reply metadata missing")
	}
	var page []Message
	f.request("GET", "/api/conversations/"+cid+"/messages", a.Token, nil, 200, &page)
	if len(page) != 60 || page[len(page)-1].Reply == nil || page[len(page)-1].Reply.Text != root.Text {
		t.Fatal("cross-page quote missing")
	}
	f.request("GET", "/api/conversations/"+cid+"/messages?q="+url.QueryEscape("100%_"), a.Token, nil, 200, &page)
	if len(page) != 1 || page[0].ID != root.ID {
		t.Fatal("literal search escaped incorrectly")
	}
	query := "/api/conversations/" + cid + "/messages?q=" + url.QueryEscape("历史记录")
	f.request("GET", query, a.Token, nil, 200, &page)
	if len(page) != 60 || page[0].ID != ids[75] {
		t.Fatal("first search page")
	}
	cursor := page[0].Seq
	f.request("GET", query+"&before="+strconv.FormatInt(cursor, 10), a.Token, nil, 200, &page)
	if len(page) != 60 || page[0].ID != ids[15] {
		t.Fatal("second search page")
	}
	f.request("GET", query+"&sender="+a.User.ID, a.Token, nil, 200, &page)
	if len(page) != 0 {
		t.Fatal("sender filter")
	}
	f.request("GET", query+"&from="+strconv.FormatInt(base+50000, 10)+"&to="+strconv.FormatInt(base+55000, 10), a.Token, nil, 200, &page)
	if len(page) != 5 {
		t.Fatal("date boundaries", len(page))
	}
	f.request("DELETE", "/api/messages/"+ids[49], a.Token, nil, 200, nil)
	f.request("GET", "/api/conversations/"+cid+"/messages?around="+ids[50], a.Token, nil, 200, &page)
	if len(page) != 61 {
		t.Fatal("context should contain 61 visible messages", len(page))
	}
	found := false
	for i, m := range page {
		if m.ID == ids[49] {
			t.Fatal("hidden record in context")
		}
		if m.ID == ids[50] {
			found = true
		}
		if i > 0 && m.Seq <= page[i-1].Seq {
			t.Fatal("context unordered")
		}
	}
	if !found {
		t.Fatal("context target missing")
	}
	last := page[len(page)-1].Seq
	f.request("GET", "/api/conversations/"+cid+"/messages?after="+strconv.FormatInt(last, 10), a.Token, nil, 200, &page)
	if len(page) == 0 || page[0].Seq <= last || page[len(page)-1].ID != reply.ID {
		t.Fatal("forward pagination")
	}
	fileID := newID()
	if _, err := f.s.db.Exec("INSERT INTO attachments VALUES(?,?,?,?,?,?,?)", fileID, a.User.ID, cid, "设计说明.pdf", "application/pdf", 100, now()); err != nil {
		t.Fatal(err)
	}
	var file Message
	f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, map[string]string{"kind": "file", "attachmentId": fileID, "clientId": newID()}, 200, &file)
	f.request("GET", "/api/conversations/"+cid+"/messages?kind=file&q="+url.QueryEscape("设计说明"), a.Token, nil, 200, &page)
	if len(page) != 1 || page[0].ID != file.ID {
		t.Fatal("filename/type search")
	}
	f.request("GET", query+"&from=invalid", a.Token, nil, 400, nil)
	f.request("POST", "/api/messages/"+root.ID+"/recall", a.Token, nil, 200, nil)
	f.request("GET", "/api/conversations/"+cid+"/messages?q="+url.QueryEscape(reply.Text), b.Token, nil, 200, &page)
	if len(page) != 1 || page[0].Reply == nil || !page[0].Reply.Recalled || page[0].Reply.Text != "" {
		t.Fatal("recalled original leaked in quote")
	}
	f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, map[string]string{"text": "不能引用撤回的记录", "replyId": root.ID, "clientId": newID()}, 400, nil)
	if _, err := f.s.db.Exec("UPDATE messages SET created=? WHERE id=?", now()-121000, reply.ID); err != nil {
		t.Fatal(err)
	}
	f.request("POST", "/api/messages/"+reply.ID+"/recall", b.Token, nil, 400, nil)
	// Recalled notices can still be removed from one's own view.
	f.request("DELETE", "/api/messages/"+root.ID, b.Token, nil, 200, nil)
}
