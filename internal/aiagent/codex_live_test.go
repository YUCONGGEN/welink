package aiagent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestLiveCodex drives a real Codex app-server through Me's launcher against
// a fake Responses provider. Run it when pinning a new Codex version:
//
//	LINKME_CODEX_LIVE=path/to/codex-app-server.exe NO_PROXY=127.0.0.1 go test ./internal/aiagent -run LiveCodex -v
//
// The model asks to write hello.txt; the command must run inside the
// workspace sandbox and the turn must complete.
func TestLiveCodex(t *testing.T) {
	bin := os.Getenv("LINKME_CODEX_LIVE")
	if bin == "" {
		t.Skip("set LINKME_CODEX_LIVE to a codex-app-server binary")
	}
	workspace, _ := os.MkdirTemp("", "aidex-live")
	defer os.RemoveAll(workspace) // best effort: Codex may still be exiting
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			http.NotFound(w, r)
			return
		}
		calls++
		w.Header().Set("Content-Type", "text/event-stream")
		ev := func(data string) { fmt.Fprintf(w, "data: %s\n\n", data) }
		ev(`{"type":"response.created","response":{"id":"r"}}`)
		if calls == 1 {
			ev(`{"type":"response.output_item.done","item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"exec_command","arguments":"{\"cmd\":\"echo hello > hello.txt\"}"}}`)
		} else {
			ev(`{"type":"response.output_item.done","item":{"type":"message","role":"assistant","id":"msg_1","content":[{"type":"output_text","text":"完成"}]}}`)
		}
		ev(`{"type":"response.completed","response":{"id":"r","usage":{"input_tokens":1,"input_tokens_details":{"cached_tokens":0},"output_tokens":1,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":2}}}`)
	}))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	var replied bool
	s, err := Start(ctx, Options{Binary: bin, Home: filepath.Join(workspace, ".home"), Workspace: workspace, Model: "gpt-test", Effort: "low", ProviderURL: srv.URL + "/v1", Grant: "grant", Prompt: "写入 hello.txt"}, func(e Event) {
		replied = replied || (e.Type == "message" && e.Text == "完成")
	})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err = s.Wait(ctx); err != nil || !replied {
		t.Fatal("turn:", err, replied)
	}
	if _, err = os.Stat(filepath.Join(workspace, "hello.txt")); err != nil {
		t.Fatal("command did not run in the workspace:", err)
	}
}

// TestLiveCodexCallsLinkMeTools checks that Codex starts LinkMe's tool bridge
// (LINKME_TOOL_BRIDGE: a built LinkMe program) and can call a LinkMe tool.
func TestLiveCodexCallsLinkMeTools(t *testing.T) {
	bin, bridge := os.Getenv("LINKME_CODEX_LIVE"), os.Getenv("LINKME_TOOL_BRIDGE")
	if bin == "" || bridge == "" {
		t.Skip("set LINKME_CODEX_LIVE and LINKME_TOOL_BRIDGE")
	}
	workspace, _ := os.MkdirTemp("", "aidex-live")
	defer os.RemoveAll(workspace) // best effort: Codex may still be exiting
	called := make(chan string, 1)
	tools := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-LinkMe-Tools-Key") != "task-key" {
			w.WriteHeader(403)
			return
		}
		var p struct {
			Op, Name  string
			Arguments json.RawMessage
		}
		json.NewDecoder(r.Body).Decode(&p)
		if p.Op == "list" {
			json.NewEncoder(w).Encode([]Tool{{Name: "linkme_send_message", Description: "发送消息", InputSchema: json.RawMessage(`{"type":"object","properties":{"to":{"type":"array","items":{"type":"string"}},"text":{"type":"string"}},"required":["to","text"]}`)}})
			return
		}
		called <- p.Name + " " + string(p.Arguments)
		json.NewEncoder(w).Encode(ToolResult{Text: "已发送给 张三"})
	}))
	defer tools.Close()
	var toolName string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var req struct {
			Tools []struct {
				Name  string `json:"name"`
				Tools []struct {
					Name string `json:"name"`
				} `json:"tools"`
			} `json:"tools"`
		}
		json.Unmarshal(raw, &req)
		var dump struct{ Tools []json.RawMessage }
		json.Unmarshal(raw, &dump)
		for _, d := range dump.Tools {
			if os.Getenv("DUMP_TOOLS") != "" {
				t.Logf("tool: %.300s", d)
			}
		}
		for _, tl := range req.Tools {
			if strings.Contains(tl.Name, "linkme_send_message") {
				toolName = tl.Name
			}
			for _, sub := range tl.Tools {
				if strings.Contains(sub.Name, "linkme_send_message") {
					toolName = tl.Name + "." + sub.Name
				}
			}
		}
		if i := strings.Index(string(raw), "function_call_output"); i >= 0 {
			t.Logf("call output: %.400s", string(raw)[i:])
		}
		w.Header().Set("Content-Type", "text/event-stream")
		ev := func(data string) { fmt.Fprintf(w, "data: %s\n\n", data) }
		ev(`{"type":"response.created","response":{"id":"r"}}`)
		// Codex 0.169 lists MCP tools as a namespace ("mcp__linkme"); the model
		// calls them with that namespace and the tool's own name.
		if strings.Contains(string(raw), `"mcp__linkme"`) {
			toolName = "mcp__linkme/linkme_send_message"
		}
		if !strings.Contains(string(raw), "function_call_output") && toolName != "" {
			args, _ := json.Marshal(`{"to":["张三"],"text":"你好"}`)
			ev(`{"type":"response.output_item.done","item":{"type":"function_call","id":"fc_1","call_id":"call_1","namespace":"mcp__linkme","name":"linkme_send_message","arguments":` + string(args) + `}}`)
		} else {
			ev(`{"type":"response.output_item.done","item":{"type":"message","role":"assistant","id":"msg_1","content":[{"type":"output_text","text":"完成"}]}}`)
		}
		ev(`{"type":"response.completed","response":{"id":"r","usage":{"input_tokens":1,"input_tokens_details":{"cached_tokens":0},"output_tokens":1,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":2}}}`)
	}))
	defer provider.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	var s *Session
	var err error
	s, err = Start(ctx, Options{Binary: bin, Home: filepath.Join(workspace, ".home"), Workspace: workspace, Model: "gpt-test", Effort: "low", ProviderURL: provider.URL + "/v1", Grant: "grant", Prompt: "给张三发你好",
		Tools: &ToolServer{Command: bridge, Env: map[string]string{"LINKME_TOOLS_URL": tools.URL, "LINKME_TOOLS_KEY": "task-key"}}}, func(e Event) {
		t.Logf("event %s %s %.300s", e.Type, e.Method, e.Details)
		if e.Type == "approval" {
			go s.Approve(e.ID, true, nil)
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err = s.Wait(ctx); err != nil {
		t.Fatal("turn:", err)
	}
	select {
	case got := <-called:
		t.Log("tool called:", toolName, got)
	default:
		t.Fatal("LinkMe tool was not called; tool name seen:", toolName)
	}
}
