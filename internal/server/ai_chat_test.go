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
)

// fakeChatProvider behaves like DeepSeek's OpenAI-compatible endpoint:
// POST /chat/completions, Bearer key, streaming or plain JSON replies.
func fakeChatProvider(t *testing.T, key string, requests chan<- map[string]any) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			w.WriteHeader(404)
			w.Write([]byte(`{"error":{"message":"Not Found"}}`))
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+key {
			w.WriteHeader(401)
			w.Write([]byte(`{"error":{"message":"Authentication Fails, Your api key is invalid","type":"authentication_error"}}`))
			return
		}
		var p map[string]any
		json.NewDecoder(r.Body).Decode(&p)
		if requests != nil {
			requests <- p
		}
		if p["model"] != "deepseek-chat" {
			w.WriteHeader(400)
			w.Write([]byte(`{"error":{"message":"Model Not Exist"}}`))
			return
		}
		if p["stream"] == true {
			w.Header().Set("Content-Type", "text/event-stream")
			for _, part := range []string{"你好，", "我是 ", "DeepSeek。"} {
				fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"思考\",\"content\":%q}}]}\n\n", part)
			}
			fmt.Fprint(w, "data: [DONE]\n\n")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"连接成功"}}]}`))
	}))
}

func TestConsoleConfiguresDeepSeekStyleModels(t *testing.T) {
	provider := fakeChatProvider(t, "sk-deepseek-test-key", nil)
	defer provider.Close()
	f := setupCommunity(t)
	f.s.configPath = filepath.Join(t.TempDir(), "config.json")
	if err := f.s.saveSettingsFile(f.s.settings); err != nil {
		t.Fatal(err)
	}
	c := f.console()
	good := map[string]any{"enabled": true, "api": "chat", "baseUrl": provider.URL + "/", "apiKey": "sk-deepseek-test-key", "model": "deepseek-chat"}
	// URL, API key and model ID are all required.
	for _, missing := range []string{"baseUrl", "apiKey", "model"} {
		body := map[string]any{}
		for k, v := range good {
			body[k] = v
		}
		body[missing] = ""
		c.do("PUT", "/api/ai", body, 400, nil)
	}
	var test struct {
		OK    bool
		Reply string
	}
	c.do("POST", "/api/ai/test", good, 200, &test)
	if !test.OK || test.Reply != "连接成功" {
		t.Fatal("test reply", test)
	}
	// Provider errors come back readable.
	var failure struct{ Error string }
	bad := map[string]any{"api": "chat", "baseUrl": provider.URL, "apiKey": "sk-wrong-key-000", "model": "deepseek-chat"}
	c.do("POST", "/api/ai/test", bad, 502, &failure)
	if !strings.Contains(failure.Error, "401") || !strings.Contains(failure.Error, "api key is invalid") {
		t.Fatal("provider error not explained:", failure.Error)
	}
	bad["apiKey"], bad["model"] = "sk-deepseek-test-key", "deepseek-nope"
	c.do("POST", "/api/ai/test", bad, 502, &failure)
	if !strings.Contains(failure.Error, "Model Not Exist") {
		t.Fatal("model error not explained:", failure.Error)
	}
	c.do("PUT", "/api/ai", good, 200, nil)
	saved, err := LoadSettings(f.s.configPath)
	if err != nil || !saved.AI.Enabled || saved.AI.API != "chat" || saved.AI.Model != "deepseek-chat" {
		t.Fatal("ai settings not saved", err, saved.AI)
	}
	creds := readAICredentials(saved.AI.CredentialsFile)
	if creds.BaseURL != provider.URL || creds.Token != "sk-deepseek-test-key" {
		t.Fatal("credentials not saved", creds)
	}
	// The key is never sent back; a blank key keeps the saved one.
	var view map[string]any
	c.do("GET", "/api/ai", nil, 200, &view)
	if view["keySet"] != true || view["apiKey"] != nil || strings.Contains(fmt.Sprint(view), "sk-deepseek") {
		t.Fatal("key leaked or missing", view)
	}
	good["apiKey"] = ""
	c.do("POST", "/api/ai/test", good, 200, &test)
}

func TestMeChatsThroughChatCompletionsProviders(t *testing.T) {
	requests := make(chan map[string]any, 4)
	provider := fakeChatProvider(t, "sk-deepseek-test-key", requests)
	defer provider.Close()
	settings := DefaultSettings()
	settings.Registration.Enabled = true
	settings.AI.Enabled, settings.AI.API, settings.AI.Model, settings.AI.ReasoningEffort = true, "chat", "deepseek-chat", ""
	settings.AI.CredentialsFile = filepath.Join(t.TempDir(), "ai.json")
	raw, _ := json.Marshal(aiCredentials{BaseURL: provider.URL, Token: "sk-deepseek-test-key"})
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
	a := f.register("ChatModelUser")
	bot, _ := s.user(s.ai.user)
	var config map[string]any
	f.request("GET", "/api/ai/config", a.Token, nil, 200, &config)
	if config["localTasks"] != false {
		t.Fatal("chat providers must not offer local tasks", config)
	}
	cid := f.direct(a, account{User: bot})
	m := sendTestMessage(f, cid, a, "你好", "")
	var job struct{ ID, Grant string }
	f.request("POST", "/api/ai/runs", a.Token, map[string]string{"messageId": m.ID, "mode": "chat"}, 200, &job)
	select {
	case p := <-requests:
		messages, _ := p["messages"].([]any)
		first, _ := messages[0].(map[string]any)
		if p["stream"] != true || len(messages) != 2 || first["role"] != "system" {
			t.Fatal("chat request shape", p)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("provider not called")
	}
	for end := time.Now().Add(3 * time.Second); ; {
		var state struct{ State, Error string }
		f.request("GET", "/api/ai/runs/"+job.ID, a.Token, nil, 200, &state)
		if state.State == "completed" {
			break
		}
		if state.State == "failed" || time.Now().After(end) {
			t.Fatal("reply not completed", state)
		}
		time.Sleep(10 * time.Millisecond)
	}
	var history []Message
	f.request("GET", "/api/conversations/"+cid+"/messages", a.Token, nil, 200, &history)
	if last := history[len(history)-1]; last.Text != "你好，我是 DeepSeek。" {
		t.Fatalf("streamed reply %q (reasoning must not leak into the answer)", last.Text)
	}
	// Local tasks (Codex, Responses API) are refused with an explanation.
	f.request("POST", "/api/ai/v1/responses", job.Grant, map[string]any{"input": "x"}, 400, nil)
}
