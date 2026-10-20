package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMeStreamCompletionRequired(t *testing.T) {
	partial := "data: {\"type\":\"response.output_text.delta\",\"delta\":\"你好\"}\n\n"
	if _, err := readAIReply(strings.NewReader(partial), "text/event-stream"); err == nil {
		t.Fatal("truncated response was treated as success")
	}
	text, err := readAIReply(strings.NewReader(partial+"data: {\"type\":\"response.completed\",\"response\":{}}\n\n"), "text/event-stream")
	if err != nil || text != "你好" {
		t.Fatalf("stream: %q %v", text, err)
	}
	if _, err := readAIReply(strings.NewReader("data: {\"type\":\"response.failed\"}\n"), "text/event-stream"); err == nil {
		t.Fatal("failed response accepted")
	}
}

func TestMeContextIsolationAndTaskGrant(t *testing.T) {
	requests := make(chan map[string]any, 10)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/responses" || r.Header.Get("Authorization") != "Bearer test-provider-secret-123456" {
			t.Error("wrong provider endpoint or credential")
			w.WriteHeader(403)
			return
		}
		var p map[string]any
		if json.NewDecoder(r.Body).Decode(&p) != nil {
			w.WriteHeader(400)
			return
		}
		requests <- p
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"output":[{"type":"message","content":[{"type":"output_text","text":"记住了，你喜欢蓝色。"}]}]}`))
	}))
	defer provider.Close()
	settings := DefaultSettings()
	settings.Registration.Enabled = true
	settings.AI.Enabled = true
	settings.AI.CredentialsFile = filepath.Join(t.TempDir(), "ai.json")
	raw, _ := json.Marshal(map[string]string{"base_url": provider.URL, "token": "test-provider-secret-123456"})
	if err := os.WriteFile(settings.AI.CredentialsFile, raw, 0600); err != nil {
		t.Fatal(err)
	}
	s, err := New(Config{DataDir: t.TempDir(), Settings: &settings})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	defer s.Close()
	f := &fixture{t: t, s: s, url: srv.URL, server: srv}
	a, b := f.register("AliceMeTest"), f.register("BobMeTest")
	bot, _ := s.user(s.ai.user)
	if !bot.AI || !bot.Online || bot.Name != "Me" {
		t.Fatalf("invalid AI account: %+v", bot)
	}
	ca, cb := f.direct(a, account{User: bot}), f.direct(b, account{User: bot})
	sendTestMessage(f, cb, b, "私人密码颜色是红色", "")
	first := sendTestMessage(f, ca, a, "我喜欢蓝色", "")
	var job struct {
		ID, Grant string
		History   []aiContextMessage
	}
	f.request("POST", "/api/ai/runs", a.Token, map[string]string{"messageId": first.ID, "mode": "chat"}, 200, &job)
	select {
	case p := <-requests:
		encoded, _ := json.Marshal(p)
		if strings.Contains(string(encoded), "红色") || p["model"] != "gpt-6-luna" {
			t.Fatal("context crossed accounts or changed model")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("provider not called")
	}
	for end := time.Now().Add(3 * time.Second); ; {
		var state struct{ State string }
		f.request("GET", "/api/ai/runs/"+job.ID, a.Token, nil, 200, &state)
		if state.State == "completed" {
			break
		}
		if time.Now().After(end) {
			t.Fatal("AI reply not persisted")
		}
		time.Sleep(10 * time.Millisecond)
	}
	f.request("GET", "/api/ai/runs/"+job.ID, b.Token, nil, 404, nil)
	second := sendTestMessage(f, ca, a, "我喜欢什么颜色？", "")
	f.request("POST", "/api/ai/runs", a.Token, map[string]string{"messageId": second.ID, "mode": "local"}, 200, &job)
	if len(job.History) != 3 || job.History[1].Role != "assistant" || !strings.Contains(job.History[0].Content, "蓝色") {
		t.Fatalf("context lost: %+v", job.History)
	}
	f.request("POST", "/api/ai/runs/"+job.ID+"/complete", b.Token, map[string]string{"text": "伪造回复"}, 403, nil)
	f.request("POST", "/api/ai/v1/responses", a.Token, map[string]any{"input": "no"}, 401, nil)
	f.request("POST", "/api/ai/v1/responses", job.Grant, map[string]any{"model": "other-model", "input": "authorized"}, 200, nil)
	if p := <-requests; p["model"] != "gpt-6-luna" {
		t.Fatal("grant used another model")
	}
	f.request("POST", "/api/ai/runs/"+job.ID+"/complete", a.Token, map[string]string{"text": "蓝色。"}, 200, nil)
	f.request("POST", "/api/ai/runs/"+job.ID+"/complete", a.Token, map[string]string{"text": "不应重复"}, 200, nil)
	f.request("POST", "/api/ai/v1/responses", job.Grant, map[string]any{"input": "expired"}, 401, nil)
	var n int
	_ = s.db.QueryRow("SELECT COUNT(*) FROM messages WHERE conversation_id=? AND sender=?", ca, bot.ID).Scan(&n)
	if n != 2 {
		t.Fatalf("duplicated bot replies: %d", n)
	}
}
