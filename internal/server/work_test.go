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
)

func TestTasksAssignAndComplete(t *testing.T) {
	f := setup(t)
	a, b, stranger := f.register("task_a"), f.register("task_b"), f.register("task_x")
	f.befriend(a, b)
	cid := f.direct(a, b)
	m := sendTestMessage(f, cid, a, "周五前交周报", "")
	f.request("POST", "/api/tasks", a.Token, map[string]any{"title": "外人", "assignees": []string{stranger.User.ID}}, 403, nil)
	ws := f.socket(b)
	var task Task
	f.request("POST", "/api/tasks", a.Token, map[string]any{"title": "交周报", "due": now() + 3600_000, "assignees": []string{b.User.ID}, "messageId": m.ID}, 200, &task)
	if task.ConversationID != cid || len(task.Assignees) != 1 || task.Creator.ID != a.User.ID {
		t.Fatalf("task: %+v", task)
	}
	nextEvent(t, ws, "task")
	var mine []Task
	f.request("GET", "/api/tasks", b.Token, nil, 200, &mine)
	if len(mine) != 1 {
		t.Fatalf("assignee list: %d", len(mine))
	}
	f.request("GET", "/api/tasks?scope=created", a.Token, nil, 200, &mine)
	if len(mine) != 1 {
		t.Fatal("creator list")
	}
	// The assignee completes; only the creator edits or deletes.
	f.request("PATCH", "/api/tasks/"+task.ID, b.Token, map[string]any{"title": "改标题"}, 403, nil)
	f.request("PATCH", "/api/tasks/"+task.ID, stranger.Token, map[string]any{"done": true}, 404, nil)
	f.request("PATCH", "/api/tasks/"+task.ID, b.Token, map[string]any{"done": true}, 200, &task)
	if task.Done == 0 || task.DoneBy != b.User.ID {
		t.Fatalf("done: %+v", task)
	}
	f.request("GET", "/api/tasks", b.Token, nil, 200, &mine)
	if len(mine) != 0 {
		t.Fatal("done task still open")
	}
	f.request("GET", "/api/tasks?scope=done", a.Token, nil, 200, &mine)
	if len(mine) != 1 {
		t.Fatal("done list")
	}
	f.request("DELETE", "/api/tasks/"+task.ID, b.Token, nil, 403, nil)
	f.request("DELETE", "/api/tasks/"+task.ID, a.Token, nil, 200, nil)
	// A task with nobody assigned belongs to its creator.
	f.request("POST", "/api/tasks", a.Token, map[string]any{"title": "自己的事"}, 200, nil)
	f.request("GET", "/api/tasks", a.Token, nil, 200, &mine)
	if len(mine) != 1 || mine[0].Title != "自己的事" {
		t.Fatalf("own task: %+v", mine)
	}
}

func TestCalendarInvitations(t *testing.T) {
	f := setup(t)
	a, b, stranger := f.register("cal_a"), f.register("cal_b"), f.register("cal_x")
	f.befriend(a, b)
	start := now() + 86400000
	f.request("POST", "/api/events", a.Token, map[string]any{"title": "评审", "start": start, "end": start - 1}, 400, nil)
	f.request("POST", "/api/events", a.Token, map[string]any{"title": "评审", "start": start, "end": start + 3600_000, "attendees": []string{stranger.User.ID}}, 403, nil)
	var e Event
	f.request("POST", "/api/events", a.Token, map[string]any{"title": "评审", "start": start, "end": start + 3600_000, "attendees": []string{b.User.ID}, "meeting": true, "location": "3 楼"}, 200, &e)
	if len(e.Attendees) != 1 || !e.Meeting || e.Remind != 15 {
		t.Fatalf("event: %+v", e)
	}
	var list []Event
	f.request("GET", fmt.Sprintf("/api/events?from=%d&to=%d", start-1000, start+86400000), b.Token, nil, 200, &list)
	if len(list) != 1 {
		t.Fatal("attendee does not see the event")
	}
	f.request("GET", "/api/events", stranger.Token, nil, 200, &list)
	if len(list) != 0 {
		t.Fatal("stranger sees the event")
	}
	f.request("PATCH", "/api/events/"+e.ID, b.Token, map[string]any{"title": "改"}, 403, nil)
	f.request("PATCH", "/api/events/"+e.ID, b.Token, map[string]any{"response": "accept"}, 200, &e)
	if e.Attendees[0].Response != "accept" {
		t.Fatalf("response: %+v", e.Attendees)
	}
	f.request("PATCH", "/api/events/"+e.ID, a.Token, map[string]any{"title": "设计评审", "attendees": []string{}}, 200, &e)
	if e.Title != "设计评审" || len(e.Attendees) != 0 {
		t.Fatalf("edit: %+v", e)
	}
	f.request("DELETE", "/api/events/"+e.ID, a.Token, nil, 200, nil)
}

func TestFlagsAndGlobalSearch(t *testing.T) {
	f := setup(t)
	a, b, c := f.register("search_a"), f.register("search_b"), f.register("search_c")
	group := f.group(a, b)
	cid := f.direct(a, b)
	f.request("PATCH", "/api/conversations/"+group, a.Token, map[string]string{"name": "发布小组"}, 200, nil)
	m := sendTestMessage(f, cid, b, "发布时间定在周五", "")
	f.request("POST", "/api/messages/"+m.ID+"/flag", a.Token, nil, 200, nil)
	f.request("POST", "/api/messages/"+m.ID+"/flag", c.Token, nil, 404, nil)
	var flags []flaggedMessage
	f.request("GET", "/api/flags", a.Token, nil, 200, &flags)
	if len(flags) != 1 || flags[0].ConversationName != "search_b" {
		t.Fatalf("flags: %+v", flags)
	}
	f.request("DELETE", "/api/messages/"+m.ID+"/flag", a.Token, nil, 200, nil)
	f.request("GET", "/api/flags", a.Token, nil, 200, &flags)
	if len(flags) != 0 {
		t.Fatal("unflag failed")
	}
	f.newDoc(a, "doc", "发布计划")
	var found struct {
		Contacts []struct{ ID, Name, ConversationID string }
		Chats    []struct{ ID, Name string }
		Messages []flaggedMessage
		Docs     []docSummary
	}
	f.request("GET", "/api/search?q=发布", a.Token, nil, 200, &found)
	if len(found.Chats) != 1 || len(found.Messages) != 1 || len(found.Docs) != 1 {
		t.Fatalf("search: %+v", found)
	}
	f.request("GET", "/api/search?q=search_b", a.Token, nil, 200, &found)
	if len(found.Contacts) != 1 || found.Contacts[0].ConversationID != cid {
		t.Fatalf("contact search: %+v", found.Contacts)
	}
	// Others' chats and documents never show up.
	f.request("GET", "/api/search?q=发布", c.Token, nil, 200, &found)
	if len(found.Messages)+len(found.Docs)+len(found.Chats) != 0 {
		t.Fatalf("leak: %+v", found)
	}
}

func TestAssistantBriefAskAndSwitch(t *testing.T) {
	var prompts []string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var p struct{ Messages []aiContextMessage }
		json.NewDecoder(r.Body).Decode(&p)
		prompt := p.Messages[len(p.Messages)-1].Content
		prompts = append(prompts, prompt)
		reply := "早上好！今天有 1 条加急。"
		if strings.Contains(prompt, "用户的要求") {
			cid := strings.Fields(prompt[strings.Index(prompt, "- 会话 ")+len("- 会话 "):])[0]
			reply = `{"reply":"好的","actions":[{"type":"send_message","conversationId":"` + cid + `","text":"我晚点到"}]}`
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
	raw, _ := json.Marshal(aiCredentials{BaseURL: provider.URL, Token: "sk-assistant-test"})
	os.WriteFile(settings.AI.CredentialsFile, raw, 0600)
	s, err := New(Config{DataDir: t.TempDir(), Settings: &settings})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	defer s.Close()
	f := &fixture{t: t, s: s, url: srv.URL, server: srv}
	a, b := f.register("helper_a"), f.register("helper_b")
	f.befriend(a, b)
	cid := f.direct(a, b)
	sendTestMessage(f, cid, b, "今晚七点开会别忘了", "")
	f.request("POST", "/api/tasks", a.Token, map[string]any{"title": "写周报", "due": now() - 1000}, 200, nil)

	var prefs assistantPrefs
	f.request("GET", "/api/assistant/prefs", a.Token, nil, 200, &prefs)
	if !prefs.Enabled || !prefs.AI {
		t.Fatalf("defaults: %+v", prefs)
	}
	var brief struct {
		Brief string
		Facts map[string]float64
	}
	f.request("POST", "/api/assistant/brief?tz=480", a.Token, map[string]any{}, 200, &brief)
	if brief.Brief == "" || brief.Facts["unread"] != 1 || brief.Facts["tasks"] != 1 || !strings.Contains(prompts[0], "今晚七点开会别忘了") || !strings.Contains(prompts[0], "写周报") || !strings.Contains(prompts[0], "已逾期") {
		t.Fatalf("brief: %+v\n%s", brief, prompts[0])
	}
	var ask struct {
		Reply   string
		Actions []map[string]any
	}
	f.request("POST", "/api/assistant/ask?tz=480", a.Token, map[string]string{"text": "告诉 helper_b 我晚点到"}, 200, &ask)
	if len(ask.Actions) != 1 || ask.Actions[0]["type"] != "send_message" || ask.Actions[0]["conversationId"] != cid {
		t.Fatalf("ask: %+v", ask)
	}
	// Switched off, the assistant does nothing.
	f.request("PUT", "/api/assistant/prefs", a.Token, map[string]bool{"enabled": false}, 200, &prefs)
	f.request("POST", "/api/assistant/brief", a.Token, map[string]any{}, 403, nil)
	f.request("POST", "/api/assistant/ask", a.Token, map[string]string{"text": "hi"}, 403, nil)
	f.request("GET", "/api/assistant/prefs", a.Token, nil, 200, &prefs)
	if prefs.Enabled {
		t.Fatal("switch not saved")
	}
}
