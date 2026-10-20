package client

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"welink/internal/aiagent"
)

type localAIState struct {
	mu   sync.Mutex
	task *localAITask
}
type localAITask struct {
	ID             string          `json:"id"`
	ConversationID string          `json:"conversationId"`
	State          string          `json:"state"`
	Error          string          `json:"error,omitempty"`
	Text           string          `json:"text,omitempty"`
	Events         []aiagent.Event `json:"events"`
	token          string
	cancel         context.CancelFunc
	session        *aiagent.Session
}

func (c *Client) aiRequest(ctx context.Context, token, method, path string, body, out any) error {
	cfg := c.Config()
	var input io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		input = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(cfg.Server, "/")+path, input)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	transport := &http.Transport{TLSClientConfig: tlsConfig(cfg.Fingerprint)}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("无法连接 Me 服务")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		var fail struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&fail)
		if fail.Error == "" {
			fail.Error = fmt.Sprintf("Me 服务返回 %d", resp.StatusCode)
		}
		return errors.New(fail.Error)
	}
	if out != nil {
		return json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(out)
	}
	return nil
}
func (c *Client) aiOwner(ctx context.Context, token string) (string, error) {
	if !sessionTokenPattern.MatchString(token) {
		return "", errors.New("请先登录")
	}
	var user struct {
		ID string `json:"id"`
	}
	if err := c.aiRequest(ctx, token, "GET", "/api/me", nil, &user); err != nil {
		return "", err
	}
	if !notificationIDPattern.MatchString(user.ID) {
		return "", errors.New("账号无效")
	}
	sum := sha256.Sum256([]byte(c.Config().Server + "\n" + user.ID))
	return hex.EncodeToString(sum[:16]), nil
}
func (c *Client) aiPreferencesPath(owner string) string {
	return filepath.Join(c.dir, "me", owner, "workspace.json")
}
func (c *Client) stopAI() {
	c.ai.mu.Lock()
	task := c.ai.task
	if task != nil && task.cancel != nil {
		task.cancel()
	}
	c.ai.task = nil
	c.ai.mu.Unlock()
}
func (c *Client) serveAI(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !sessionTokenPattern.MatchString(token) {
		localError(w, 401, "请先登录")
		return
	}
	switch r.URL.Path {
	case "/local/ai/status":
		if r.Method != "GET" {
			w.WriteHeader(405)
			return
		}
		c.ai.mu.Lock()
		defer c.ai.mu.Unlock()
		if c.ai.task != nil && c.ai.task.token == token {
			localJSON(w, c.ai.task)
		} else {
			localJSON(w, map[string]string{"state": "idle"})
		}
	case "/local/ai/config":
		owner, err := c.aiOwner(r.Context(), token)
		if err != nil {
			localError(w, 401, err.Error())
			return
		}
		path := c.aiPreferencesPath(owner)
		if r.Method == "GET" {
			var config struct {
				Workspace string `json:"workspace"`
			}
			raw, _ := os.ReadFile(path)
			_ = json.Unmarshal(raw, &config)
			platform := c.Config().Platform
			localJSON(w, map[string]any{"workspace": config.Workspace, "available": (platform == "windows" || platform == "darwin") && aiagent.FindBinary() != ""})
			return
		}
		if r.Method != "POST" {
			w.WriteHeader(405)
			return
		}
		var p struct {
			Workspace string `json:"workspace"`
		}
		if !localDecode(w, r, &p) {
			return
		}
		if p.Workspace != "" {
			if !filepath.IsAbs(p.Workspace) {
				localError(w, 400, "请输入完整的本机目录路径")
				return
			}
			resolved, e := filepath.EvalSymlinks(p.Workspace)
			stat, se := os.Stat(resolved)
			if e != nil || se != nil || !stat.IsDir() {
				localError(w, 400, "所选目录不存在")
				return
			}
			p.Workspace = resolved
		}
		c.ai.mu.Lock()
		busy := c.ai.task != nil && c.ai.task.State == "running"
		c.ai.mu.Unlock()
		if busy {
			localError(w, 409, "请先停止当前任务再切换目录")
			return
		}
		if err = os.MkdirAll(filepath.Dir(path), 0700); err == nil {
			var raw []byte
			raw, err = json.Marshal(p)
			if err == nil {
				err = os.WriteFile(path, raw, 0600)
			}
		}
		if err != nil {
			localError(w, 500, "保存工作目录失败")
			return
		}
		localJSON(w, p)
	case "/local/ai/start":
		if r.Method != "POST" {
			w.WriteHeader(405)
			return
		}
		if c.Config().Platform != "windows" && c.Config().Platform != "darwin" {
			localError(w, 400, "本机任务请在 Windows 或 macOS 桌面端执行")
			return
		}
		var p struct{ MessageID string }
		if !localDecode(w, r, &p) {
			return
		}
		owner, err := c.aiOwner(r.Context(), token)
		if err != nil {
			localError(w, 401, err.Error())
			return
		}
		var prefs struct{ Workspace string }
		raw, _ := os.ReadFile(c.aiPreferencesPath(owner))
		_ = json.Unmarshal(raw, &prefs)
		if prefs.Workspace == "" {
			localError(w, 400, "请先为 Me 选择工作目录")
			return
		}
		binary := aiagent.FindBinary()
		if binary == "" {
			localError(w, 400, "本机缺少 Codex 工具，请安装完整版本 LinkMe")
			return
		}
		c.ai.mu.Lock()
		if c.ai.task != nil && c.ai.task.State == "running" {
			c.ai.mu.Unlock()
			localError(w, 409, "Me 正在执行本地任务")
			return
		}
		task := &localAITask{State: "running", token: token, Events: []aiagent.Event{}}
		c.ai.task = task
		c.ai.mu.Unlock()
		var job struct {
			ID, ConversationID, Model, Effort, Grant, Instructions string
			History                                                []struct{ Role, Content string }
		}
		if err = c.aiRequest(r.Context(), token, "POST", "/api/ai/runs", map[string]string{"messageId": p.MessageID, "mode": "local"}, &job); err != nil {
			c.ai.mu.Lock()
			if c.ai.task == task {
				c.ai.task = nil
			}
			c.ai.mu.Unlock()
			localError(w, 400, err.Error())
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		c.ai.mu.Lock()
		task.ID = job.ID
		task.ConversationID = job.ConversationID
		task.cancel = cancel
		stillCurrent := c.ai.task == task
		c.ai.mu.Unlock()
		if !stillCurrent {
			cancel()
		}
		history, _ := json.Marshal(job.History)
		prompt := job.Instructions + "\n\n当前用户与 Me 的聊天上下文（只属于这一段对话；最后一条是本轮请求）：\n" + string(history)
		options := aiagent.Options{Binary: binary, Home: filepath.Join(c.dir, "me", owner, "runtime"), Workspace: prefs.Workspace, Model: job.Model, Effort: job.Effort, ProviderURL: strings.TrimRight(c.Config().Server, "/") + "/api/ai/v1", Grant: job.Grant, Prompt: prompt}
		go c.runAI(ctx, task, options)
		localJSON(w, map[string]string{"id": job.ID, "conversationId": job.ConversationID})
	case "/local/ai/approve":
		if r.Method != "POST" {
			w.WriteHeader(405)
			return
		}
		var p struct {
			TaskID, ID string
			Accept     bool
			Answers    json.RawMessage
		}
		if !localDecode(w, r, &p) {
			return
		}
		c.ai.mu.Lock()
		task := c.ai.task
		var session *aiagent.Session
		if task != nil && task.ID == p.TaskID && task.token == token {
			session = task.session
		}
		c.ai.mu.Unlock()
		if session == nil {
			localError(w, 409, "当前任务不可审批")
			return
		}
		if err := session.Approve(p.ID, p.Accept, p.Answers); err != nil {
			localError(w, 400, err.Error())
			return
		}
		c.ai.mu.Lock()
		for i := range task.Events {
			if task.Events[i].Type == "approval" && task.Events[i].ID == p.ID {
				task.Events[i].Type = "resolved"
			}
		}
		c.ai.mu.Unlock()
		localJSON(w, map[string]bool{"ok": true})
	case "/local/ai/cancel":
		if r.Method != "POST" {
			w.WriteHeader(405)
			return
		}
		c.ai.mu.Lock()
		task := c.ai.task
		if task != nil && task.token == token && task.cancel != nil {
			task.cancel()
		}
		c.ai.mu.Unlock()
		localJSON(w, map[string]bool{"ok": true})
	default:
		http.NotFound(w, r)
	}
}
func (c *Client) runAI(ctx context.Context, task *localAITask, options aiagent.Options) {
	var final string
	session, err := aiagent.Start(ctx, options, func(event aiagent.Event) {
		c.ai.mu.Lock()
		defer c.ai.mu.Unlock()
		if c.ai.task != task {
			return
		}
		if event.Type == "delta" {
			task.Text += event.Text
			if len(task.Text) > 128<<10 {
				task.Text = task.Text[len(task.Text)-(128<<10):]
			}
			return
		}
		if event.Type == "message" {
			final = event.Text
			task.Text = event.Text
		}
		if event.Type != "message" {
			if len(task.Events) >= 200 {
				task.Events = task.Events[1:]
			}
			task.Events = append(task.Events, event)
		}
	})
	if err == nil {
		c.ai.mu.Lock()
		task.session = session
		c.ai.mu.Unlock()
		err = session.Wait(ctx)
		session.Close()
	}
	c.ai.mu.Lock()
	task.session = nil
	task.State = "completed"
	errorText := ""
	if err != nil {
		task.State = "failed"
		errorText = err.Error()
		if ctx.Err() != nil {
			task.State = "cancelled"
			errorText = "任务已停止"
		}
		runes := []rune(errorText)
		if len(runes) > 280 {
			errorText = string(runes[:280])
		}
		task.Error = errorText
	}
	c.ai.mu.Unlock()
	syncCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if task.State == "cancelled" {
		_ = c.aiRequest(syncCtx, task.token, "POST", "/api/ai/runs/"+task.ID+"/cancel", map[string]any{}, nil)
	} else {
		if len([]rune(final)) > 24000 {
			final = string([]rune(final)[:23980]) + "\n（回复过长，已截断）"
		}
		err = c.aiRequest(syncCtx, task.token, "POST", "/api/ai/runs/"+task.ID+"/complete", map[string]string{"text": final, "error": errorText}, nil)
		if err != nil {
			c.ai.mu.Lock()
			task.Error = "任务已结束，但回复尚未同步服务器：" + err.Error()
			c.ai.mu.Unlock()
		}
	}
}
