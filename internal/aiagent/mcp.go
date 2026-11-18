package aiagent

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"time"
)

// linkme-AIdex reaches LinkMe itself (contacts, messages, files, scheduled
// messages, remote assistance) through a small MCP server: Codex starts the
// LinkMe program again with -aidex-tools, and that process forwards each tool
// call to the running LinkMe over loopback with a key valid for one task.

// ToolServer is how Codex starts LinkMe's MCP tool bridge.
type ToolServer struct {
	Command string
	Env     map[string]string
}

// Tool is one MCP tool definition.
type Tool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
}

// ToolResult is what a tool call returns to the model.
type ToolResult struct {
	Text    string `json:"text"`
	IsError bool   `json:"isError"`
}

const ToolBridgeFlag = "-aidex-tools"

// RunToolBridge serves MCP on stdin/stdout, forwarding to the LinkMe client
// named by LINKME_TOOLS_URL with LINKME_TOOLS_KEY. It returns an exit code.
func RunToolBridge() int {
	url, key := os.Getenv("LINKME_TOOLS_URL"), os.Getenv("LINKME_TOOLS_KEY")
	if url == "" || key == "" {
		return 2
	}
	client := &http.Client{Timeout: 10 * time.Minute, Transport: &http.Transport{Proxy: nil}}
	post := func(body any, out any) error {
		raw, _ := json.Marshal(body)
		req, _ := http.NewRequest("POST", url, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-LinkMe-Tools-Key", key)
		resp, err := client.Do(req)
		if err != nil {
			return errors.New("LinkMe 未在运行")
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			msg, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
			return errors.New(string(bytes.TrimSpace(msg)))
		}
		return json.NewDecoder(resp.Body).Decode(out)
	}
	list := func() ([]Tool, error) {
		var tools []Tool
		err := post(map[string]string{"op": "list"}, &tools)
		return tools, err
	}
	call := func(name string, args json.RawMessage) ToolResult {
		var r ToolResult
		if err := post(map[string]any{"op": "call", "name": name, "arguments": args}, &r); err != nil {
			return ToolResult{Text: err.Error(), IsError: true}
		}
		return r
	}
	if err := ServeMCP(os.Stdin, os.Stdout, list, call); err != nil {
		return 1
	}
	return 0
}

// ServeMCP implements the subset of the Model Context Protocol (stdio,
// newline-delimited JSON-RPC 2.0) that tool servers need.
func ServeMCP(in io.Reader, out io.Writer, list func() ([]Tool, error), call func(name string, args json.RawMessage) ToolResult) error {
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 64<<10), 8<<20)
	enc := json.NewEncoder(out)
	reply := func(id json.RawMessage, result any, rpcErr map[string]any) error {
		msg := map[string]any{"jsonrpc": "2.0", "id": id}
		if rpcErr != nil {
			msg["error"] = rpcErr
		} else {
			msg["result"] = result
		}
		return enc.Encode(msg)
	}
	for scanner.Scan() {
		var req struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if json.Unmarshal(scanner.Bytes(), &req) != nil {
			continue
		}
		if len(req.ID) == 0 {
			continue // notification
		}
		var err error
		switch req.Method {
		case "initialize":
			var p struct {
				ProtocolVersion string `json:"protocolVersion"`
			}
			_ = json.Unmarshal(req.Params, &p)
			if p.ProtocolVersion == "" {
				p.ProtocolVersion = "2025-06-18"
			}
			err = reply(req.ID, map[string]any{"protocolVersion": p.ProtocolVersion, "capabilities": map[string]any{"tools": map[string]any{}},
				"serverInfo": map[string]string{"name": "linkme", "version": "1"}, "instructions": "LinkMe 工具：以当前用户身份查看联系人与聊天、发送消息和文件、管理定时消息、发起远程协助邀请。"}, nil)
		case "ping":
			err = reply(req.ID, map[string]any{}, nil)
		case "tools/list":
			tools, e := list()
			if e != nil {
				err = reply(req.ID, nil, map[string]any{"code": -32603, "message": e.Error()})
			} else {
				err = reply(req.ID, map[string]any{"tools": tools}, nil)
			}
		case "tools/call":
			var p struct {
				Name      string          `json:"name"`
				Arguments json.RawMessage `json:"arguments"`
			}
			_ = json.Unmarshal(req.Params, &p)
			r := call(p.Name, p.Arguments)
			err = reply(req.ID, map[string]any{"content": []map[string]string{{"type": "text", "text": r.Text}}, "isError": r.IsError}, nil)
		default:
			err = reply(req.ID, nil, map[string]any{"code": -32601, "message": "method not found"})
		}
		if err != nil {
			return err
		}
	}
	return scanner.Err()
}
