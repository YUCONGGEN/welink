package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func sendText(f *fixture, cid string, a account, text, thread string) Message {
	var m Message
	f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, map[string]any{"kind": "text", "text": text, "clientId": "c-" + newID()[:16], "threadId": thread}, 200, &m)
	return m
}

func nextEvent(t *testing.T, ws *websocket.Conn, kind string) json.RawMessage {
	t.Helper()
	ws.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		var e struct {
			Type string
			Data json.RawMessage
		}
		if err := ws.ReadJSON(&e); err != nil {
			t.Fatalf("no %s event: %v", kind, err)
		}
		if e.Type == kind {
			return e.Data
		}
	}
}

func TestEditReactPinAndRecall(t *testing.T) {
	f := setup(t)
	a, b, c := f.register("feature_a"), f.register("feature_b"), f.register("feature_c")
	cid := f.group(a, b)
	m := sendText(f, cid, a, "原来的内容", "")
	ws := f.socket(b)

	// Only the sender edits, and the edit is visible to everyone.
	f.request("PATCH", "/api/messages/"+m.ID, b.Token, map[string]string{"text": "别人改"}, 403, nil)
	f.request("PATCH", "/api/messages/"+m.ID, c.Token, map[string]string{"text": "外人改"}, 404, nil)
	var edited Message
	f.request("PATCH", "/api/messages/"+m.ID, a.Token, map[string]string{"text": "改过的内容"}, 200, &edited)
	if edited.Text != "改过的内容" || edited.Edited == 0 {
		t.Fatalf("edit: %+v", edited)
	}
	var pushed Message
	json.Unmarshal(nextEvent(t, ws, "message-updated"), &pushed)
	if pushed.Text != "改过的内容" || pushed.Edited == 0 {
		t.Fatalf("pushed edit: %+v", pushed)
	}
	// An old message can no longer be edited or recalled.
	f.s.db.Exec("UPDATE messages SET created=? WHERE id=?", now()-25*3600*1000, m.ID)
	f.request("PATCH", "/api/messages/"+m.ID, a.Token, map[string]string{"text": "太晚了"}, 400, nil)
	f.request("POST", "/api/messages/"+m.ID+"/recall", a.Token, nil, 400, nil)
	// Recall works within 24 hours, not just two minutes.
	f.s.db.Exec("UPDATE messages SET created=? WHERE id=?", now()-3*3600*1000, m.ID)
	recent := sendText(f, cid, a, "三小时前", "")
	f.s.db.Exec("UPDATE messages SET created=? WHERE id=?", now()-3*3600*1000, recent.ID)
	f.request("POST", "/api/messages/"+recent.ID+"/recall", a.Token, nil, 200, nil)

	// Reactions toggle per person.
	var reacted struct{ Reactions []Reaction }
	f.request("POST", "/api/messages/"+m.ID+"/reactions", b.Token, map[string]string{"emoji": "👍"}, 200, &reacted)
	f.request("POST", "/api/messages/"+m.ID+"/reactions", a.Token, map[string]string{"emoji": "👍"}, 200, &reacted)
	f.request("POST", "/api/messages/"+m.ID+"/reactions", a.Token, map[string]string{"emoji": "收到"}, 200, &reacted)
	if len(reacted.Reactions) != 2 || len(reacted.Reactions[0].Users) != 2 {
		t.Fatalf("reactions: %+v", reacted)
	}
	f.request("POST", "/api/messages/"+m.ID+"/reactions", a.Token, map[string]string{"emoji": "收到"}, 200, &reacted)
	f.request("POST", "/api/messages/"+m.ID+"/reactions", a.Token, map[string]string{"emoji": "<script>"}, 400, nil)
	if len(reacted.Reactions) != 1 {
		t.Fatalf("toggle off: %+v", reacted)
	}
	var list []Message
	f.request("GET", "/api/conversations/"+cid+"/messages", b.Token, nil, 200, &list)
	if got := list[0]; got.ID != m.ID || len(got.Reactions) != 1 || got.Edited == 0 {
		t.Fatalf("listed message: %+v", got)
	}

	// Pins.
	f.request("POST", "/api/messages/"+m.ID+"/pin", b.Token, nil, 200, nil)
	var pins []pinnedMessage
	f.request("GET", "/api/conversations/"+cid+"/pins", a.Token, nil, 200, &pins)
	if len(pins) != 1 || pins[0].ID != m.ID || pins[0].PinnedBy != b.User.ID {
		t.Fatalf("pins: %+v", pins)
	}
	f.request("GET", "/api/conversations/"+cid+"/pins", c.Token, nil, 403, nil)
	f.request("DELETE", "/api/messages/"+m.ID+"/pin", a.Token, nil, 200, nil)
	f.request("GET", "/api/conversations/"+cid+"/pins", a.Token, nil, 200, &pins)
	if len(pins) != 0 {
		t.Fatal("unpin failed")
	}
}

func TestUrgentPollChainThread(t *testing.T) {
	f := setup(t)
	a, b, c := f.register("urgent_a"), f.register("urgent_b"), f.register("urgent_c")
	cid := f.group(a, b, c)
	m := sendText(f, cid, a, "请马上看", "")
	ws := f.socket(b)
	f.request("POST", "/api/messages/"+m.ID+"/urgent", b.Token, map[string]any{}, 403, nil)
	var urgent Message
	f.request("POST", "/api/messages/"+m.ID+"/urgent", a.Token, map[string]any{"users": []string{b.User.ID}}, 200, &urgent)
	if urgent.Urgent == nil || len(urgent.Urgent.Targets) != 1 || len(urgent.Urgent.Acked) != 0 {
		t.Fatalf("urgent: %+v", urgent.Urgent)
	}
	var event struct {
		Message Message
		From    string
	}
	json.Unmarshal(nextEvent(t, ws, "urgent"), &event)
	if event.Message.ID != m.ID || event.From == "" {
		t.Fatalf("urgent event: %+v", event)
	}
	var pending []Message
	f.request("GET", "/api/urgent", b.Token, nil, 200, &pending)
	if len(pending) != 1 {
		t.Fatalf("pending: %d", len(pending))
	}
	f.request("POST", "/api/messages/"+m.ID+"/urgent/ack", b.Token, nil, 200, nil)
	f.request("GET", "/api/urgent", b.Token, nil, 200, &pending)
	if len(pending) != 0 {
		t.Fatal("still pending after ack")
	}

	// Polls: single choice, revote, close.
	var poll Message
	f.request("POST", "/api/conversations/"+cid+"/polls", a.Token, map[string]any{"title": "团建去哪", "options": []string{"爬山", " 爬山 "}}, 400, nil)
	f.request("POST", "/api/conversations/"+cid+"/polls", a.Token, map[string]any{"title": "团建去哪", "options": []string{"爬山", "露营", "看电影"}}, 200, &poll)
	if poll.Kind != "poll" || poll.Poll == nil || len(poll.Poll.Counts) != 3 {
		t.Fatalf("poll: %+v", poll)
	}
	f.request("POST", "/api/messages/"+poll.ID+"/votes", b.Token, map[string]any{"options": []int{0, 1}}, 400, nil)
	f.request("POST", "/api/messages/"+poll.ID+"/votes", b.Token, map[string]any{"options": []int{1}}, 200, nil)
	f.request("POST", "/api/messages/"+poll.ID+"/votes", c.Token, map[string]any{"options": []int{1}}, 200, nil)
	f.request("POST", "/api/messages/"+poll.ID+"/votes", c.Token, map[string]any{"options": []int{2}}, 200, &poll)
	if fmt.Sprint(poll.Poll.Counts) != "[0 1 1]" || fmt.Sprint(poll.Poll.Votes[c.User.ID]) != "[2]" {
		t.Fatalf("votes: %+v", poll.Poll)
	}
	f.request("POST", "/api/messages/"+poll.ID+"/close", b.Token, nil, 403, nil)
	f.request("POST", "/api/messages/"+poll.ID+"/close", a.Token, nil, 200, nil)
	f.request("POST", "/api/messages/"+poll.ID+"/votes", a.Token, map[string]any{"options": []int{0}}, 400, nil)

	// Sign-up list.
	var chain Message
	f.request("POST", "/api/conversations/"+cid+"/chains", a.Token, map[string]string{"title": "周五聚餐报名", "note": "写上人数"}, 200, &chain)
	f.request("POST", "/api/messages/"+chain.ID+"/chain", b.Token, map[string]string{"text": "2 人"}, 200, nil)
	f.request("POST", "/api/messages/"+chain.ID+"/chain", c.Token, map[string]string{"text": "1 人"}, 200, nil)
	f.request("POST", "/api/messages/"+chain.ID+"/chain", b.Token, map[string]string{"text": "3 人"}, 200, &chain)
	if len(chain.Chain) != 2 || chain.Chain[0].Text != "3 人" {
		t.Fatalf("chain: %+v", chain.Chain)
	}
	f.request("POST", "/api/messages/"+chain.ID+"/chain", c.Token, map[string]string{"text": ""}, 200, &chain)
	if len(chain.Chain) != 1 {
		t.Fatal("leaving the sign-up failed")
	}

	// Threads: replies stay out of the main list and are counted on the root.
	r1 := sendText(f, cid, b, "我来看看", m.ID)
	sendText(f, cid, c, "我也在", m.ID)
	var bad Message
	f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, map[string]any{"kind": "text", "text": "套娃", "clientId": "nested-thread-1", "threadId": r1.ID}, 400, &bad)
	var list []Message
	f.request("GET", "/api/conversations/"+cid+"/messages", a.Token, nil, 200, &list)
	for _, x := range list {
		if x.ThreadID != "" {
			t.Fatal("thread reply in main list")
		}
		if x.ID == m.ID && (x.Thread == nil || x.Thread.Count != 2) {
			t.Fatalf("root thread info: %+v", x.Thread)
		}
	}
	var thread struct {
		Root    Message
		Replies []Message
	}
	f.request("GET", "/api/messages/"+m.ID+"/thread", c.Token, nil, 200, &thread)
	if thread.Root.ID != m.ID || len(thread.Replies) != 2 || thread.Replies[0].ThreadID != m.ID {
		t.Fatalf("thread: %+v", thread)
	}
	var found []Message
	f.request("GET", "/api/conversations/"+cid+"/messages?q="+"我也在", a.Token, nil, 200, &found)
	if len(found) != 1 {
		t.Fatal("search misses thread replies")
	}
	for _, kind := range []string{"poll", "chain"} {
		if p, ok := structuredPreview(kind, map[string]string{"poll": poll.Text, "chain": chain.Text}[kind]); !ok || !strings.Contains(p, "团建去哪") && !strings.Contains(p, "周五聚餐报名") {
			t.Fatalf("preview %s: %q", kind, p)
		}
	}
}

func TestUserStatus(t *testing.T) {
	f := setup(t)
	a, b := f.register("status_a"), f.register("status_b")
	f.befriend(a, b)
	ws := f.socket(b)
	var st UserStatus
	f.request("PUT", "/api/me/status", a.Token, map[string]any{"manual": "custom", "text": ""}, 400, nil)
	f.request("PUT", "/api/me/status", a.Token, map[string]any{"manual": "dnd", "until": now() + 3600_000}, 200, &st)
	if st.Status != "dnd" || st.Label != "请勿打扰" || !st.DND {
		t.Fatalf("status: %+v", st)
	}
	var event struct {
		UserID string
		Status UserStatus
	}
	json.Unmarshal(nextEvent(t, ws, "status"), &event)
	if event.UserID != a.User.ID || event.Status.Label != "请勿打扰" {
		t.Fatalf("event: %+v", event)
	}
	// Meetings and remote assistance override while they last.
	f.request("PUT", "/api/me/status", a.Token, map[string]any{"auto": "meeting"}, 200, &st)
	if st.Label != "会议中" || st.Manual != "dnd" {
		t.Fatalf("auto: %+v", st)
	}
	f.request("PUT", "/api/me/status", a.Token, map[string]any{"auto": ""}, 200, &st)
	var all map[string]UserStatus
	f.request("GET", "/api/statuses?ids="+a.User.ID+","+b.User.ID, b.Token, nil, 200, &all)
	if all[a.User.ID].Label != "请勿打扰" {
		t.Fatalf("statuses: %+v", all)
	}
	// An expired status is gone.
	if _, err := f.s.db.Exec("UPDATE user_statuses SET until=? WHERE user_id=?", now()-1, a.User.ID); err != nil {
		t.Fatal(err)
	}
	var later map[string]UserStatus
	f.request("GET", "/api/statuses?ids="+a.User.ID, b.Token, nil, 200, &later)
	if _, has := later[a.User.ID]; has {
		t.Fatalf("expired status still shown: %+v", later)
	}
}

func TestSummaryAndTranslate(t *testing.T) {
	var prompts []string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var p struct{ Messages []aiContextMessage }
		json.NewDecoder(r.Body).Decode(&p)
		prompt := p.Messages[len(p.Messages)-1].Content
		prompts = append(prompts, prompt)
		reply := "## 要点\n- 周五上线"
		if strings.HasPrefix(prompt, "翻译成") {
			reply = "Launch on Friday"
		}
		raw, _ := json.Marshal(reply)
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":%s}}]}\n\ndata: [DONE]\n\n", raw)
	}))
	defer provider.Close()
	settings := DefaultSettings()
	settings.Registration.Enabled = true
	settings.AI.Enabled, settings.AI.API, settings.AI.Model = true, "chat", "deepseek-chat"
	settings.AI.CredentialsFile = filepath.Join(t.TempDir(), "ai.json")
	raw, _ := json.Marshal(aiCredentials{BaseURL: provider.URL, Token: "sk-summary-test"})
	os.WriteFile(settings.AI.CredentialsFile, raw, 0600)
	s, err := New(Config{DataDir: t.TempDir(), Settings: &settings})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	defer s.Close()
	f := &fixture{t: t, s: s, url: srv.URL, server: srv}
	a, b := f.register("summary_a"), f.register("summary_b")
	cid := f.group(a, b)
	first := sendText(f, cid, a, "大家好", "")
	sendText(f, cid, a, "周五上线，请 @summary_b 准备发布说明", "")
	var out struct {
		Summary string
		Count   int
	}
	f.request("POST", "/api/conversations/"+cid+"/summary", b.Token, map[string]int64{"afterSeq": first.Seq}, 200, &out)
	if out.Count != 1 || !strings.Contains(out.Summary, "周五上线") || !strings.Contains(prompts[0], "准备发布说明") || strings.Contains(prompts[0], "大家好") {
		t.Fatalf("summary: %+v %q", out, prompts)
	}
	var tr struct{ Text string }
	f.request("POST", "/api/messages/"+first.ID+"/translate", b.Token, map[string]string{"lang": "en"}, 200, &tr)
	f.request("POST", "/api/messages/"+first.ID+"/translate", b.Token, map[string]string{"lang": "en"}, 200, &tr)
	if tr.Text != "Launch on Friday" || len(prompts) != 2 {
		t.Fatalf("translate cached: %q, %d calls", tr.Text, len(prompts))
	}
	f.request("POST", "/api/messages/"+first.ID+"/translate", b.Token, map[string]string{"lang": "xx"}, 400, nil)
}
