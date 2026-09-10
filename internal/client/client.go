package client

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
	"welink/internal/remote"
	"welink/internal/ui"
	"welink/internal/yudesk/desktop"
)

var DefaultServer = "http://223.166.147.252:8250"
var DefaultFingerprint = ""

type Config struct {
	Server      string `json:"server"`
	Fingerprint string `json:"fingerprint"`
	Platform    string `json:"platform"`
}
type Options struct {
	Directory, Listen   string
	AssetsDirectory     string
	Mobile              bool
	Server, Fingerprint string
	WindowAction        func(string)
}
type Client struct {
	mu             sync.Mutex
	config         Config
	dir, key, host string
	srv            *http.Server
	listener       net.Listener
	Remote         *remote.Engine
	window         func(string)
	assets         fs.FS
}

func New(o Options) (*Client, error) {
	if o.Directory == "" {
		root, e := os.UserConfigDir()
		if e != nil {
			return nil, e
		}
		o.Directory = filepath.Join(root, "WeLink")
	}
	if err := os.MkdirAll(o.Directory, 0700); err != nil {
		return nil, err
	}
	config := Config{Server: DefaultServer, Fingerprint: DefaultFingerprint, Platform: runtime.GOOS}
	if o.Mobile {
		config.Platform = "android"
	}
	if raw, e := os.ReadFile(filepath.Join(o.Directory, "connection.json")); e == nil {
		_ = json.Unmarshal(raw, &config)
	}
	config.Platform = runtime.GOOS
	if o.Mobile {
		config.Platform = "android"
	}
	if o.Server != "" {
		config.Server = o.Server
		config.Fingerprint = o.Fingerprint
	}
	if _, e := validateConfig(config); e != nil {
		return nil, e
	}
	if o.Listen == "" {
		o.Listen = "127.0.0.1:18746"
	}
	ln, e := net.Listen("tcp", o.Listen)
	if e != nil {
		return nil, e
	}
	engine, e := remote.New(o.Directory, o.Mobile)
	if e != nil {
		ln.Close()
		return nil, e
	}
	var secret [32]byte
	if _, e = rand.Read(secret[:]); e != nil {
		ln.Close()
		return nil, e
	}
	c := &Client{config: config, dir: o.Directory, key: hex.EncodeToString(secret[:]), host: net.JoinHostPort("127.0.0.1", fmt.Sprint(ln.Addr().(*net.TCPAddr).Port)), listener: ln, Remote: engine, window: o.WindowAction}
	c.assets, _ = fs.Sub(ui.Files, "assets")
	if o.AssetsDirectory != "" {
		if _, err := os.Stat(filepath.Join(o.AssetsDirectory, "index.html")); err == nil {
			c.assets = os.DirFS(o.AssetsDirectory)
		}
	}
	c.srv = &http.Server{Handler: http.HandlerFunc(c.serve), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 90 * time.Second}
	go c.srv.Serve(ln)
	return c, nil
}
func (c *Client) URL() string { return "http://" + c.host + "/?access_token=" + c.key }
func (c *Client) Close() {
	c.Remote.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = c.srv.Shutdown(ctx)
}
func (c *Client) Config() Config { c.mu.Lock(); defer c.mu.Unlock(); return c.config }
func validateConfig(cfg Config) (*url.URL, error) {
	u, e := url.Parse(cfg.Server)
	if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, errors.New("服务地址格式不正确")
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return nil, errors.New("服务地址必须使用 HTTP 或 HTTPS")
	}
	if cfg.Fingerprint != "" {
		b, e := hex.DecodeString(cfg.Fingerprint)
		if e != nil || len(b) != 32 {
			return nil, errors.New("证书指纹必须为 64 位十六进制")
		}
	}
	return u, nil
}
func tlsConfig(pin string) *tls.Config {
	config := &tls.Config{MinVersion: tls.VersionTLS13}
	if pin != "" {
		want, _ := hex.DecodeString(pin)
		config.InsecureSkipVerify = true // Replaced by explicit certificate pin and validity verification below.
		config.VerifyConnection = func(cs tls.ConnectionState) error {
			if len(cs.PeerCertificates) == 0 {
				return errors.New("missing server certificate")
			}
			cert := cs.PeerCertificates[0]
			actual := sha256.Sum256(cert.Raw)
			if subtle.ConstantTimeCompare(actual[:], want) != 1 {
				return errors.New("服务端证书指纹不匹配")
			}
			if time.Now().Before(cert.NotBefore) || time.Now().After(cert.NotAfter) {
				return errors.New("服务端证书已过期或未生效")
			}
			return nil
		}
	}
	return config
}
func (c *Client) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Cache-Control", "no-store")
	if r.Host != c.host {
		http.Error(w, "invalid host", 403)
		return
	}
	if r.URL.Path == "/" && subtle.ConstantTimeCompare([]byte(r.URL.Query().Get("access_token")), []byte(c.key)) == 1 {
		http.SetCookie(w, &http.Cookie{Name: "welink_local", Value: c.key, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	cookie, err := r.Cookie("welink_local")
	if err != nil || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(c.key)) != 1 {
		http.Error(w, "请通过 WeLink 客户端打开", 403)
		return
	}
	origin := r.Header.Get("Origin")
	if origin != "" && origin != "http://"+c.host {
		http.Error(w, "invalid origin", 403)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/local/") {
		c.local(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/") {
		c.proxy(w, r)
		return
	}
	if r.URL.Path != "/" && !strings.HasPrefix(r.URL.Path, "/assets/") {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'")
	handler := http.FileServer(http.FS(c.assets))
	if strings.HasPrefix(r.URL.Path, "/assets/") {
		http.StripPrefix("/assets/", handler).ServeHTTP(w, r)
	} else {
		handler.ServeHTTP(w, r)
	}
}
func (c *Client) proxy(w http.ResponseWriter, r *http.Request) {
	cfg := c.Config()
	u, _ := validateConfig(cfg)
	p := httputil.NewSingleHostReverseProxy(u)
	transport := &http.Transport{TLSClientConfig: tlsConfig(cfg.Fingerprint), Proxy: nil, ResponseHeaderTimeout: 45 * time.Second, DialContext: (&net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}).DialContext}
	defer transport.CloseIdleConnections()
	p.Transport = transport
	original := p.Director
	p.Director = func(req *http.Request) {
		original(req)
		req.Host = u.Host
		req.Header.Del("Origin")
		req.Header.Del("X-Forwarded-For")
		req.Header.Del("X-Forwarded-Host")
		req.Header.Del("X-Forwarded-Proto")
		cookies := req.Cookies()
		req.Header.Del("Cookie")
		for _, cookie := range cookies {
			if cookie.Name == "welink_session" {
				req.AddCookie(cookie)
			}
		}
	}
	p.ModifyResponse = func(resp *http.Response) error {
		cookies := resp.Cookies()
		resp.Header.Del("Set-Cookie")
		for _, cookie := range cookies {
			if cookie.Name == "welink_session" {
				cookie.Secure = false
				cookie.Domain = ""
				resp.Header.Add("Set-Cookie", cookie.String())
			}
		}
		return nil
	}
	p.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		localError(w, 502, "无法连接服务器，请检查网络和连接设置")
	}
	p.ServeHTTP(w, r)
}
func localJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}
func localError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
func localDecode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if json.NewDecoder(r.Body).Decode(v) != nil {
		localError(w, 400, "请求格式错误")
		return false
	}
	return true
}
func (c *Client) local(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if r.Method == "GET" {
		switch path {
		case "/local/config":
			localJSON(w, c.Config())
		case "/local/remote/state":
			localJSON(w, c.Remote.State())
		case "/local/remote/frame":
			data, state := c.Remote.Frame()
			if len(data) == 0 {
				w.WriteHeader(204)
				return
			}
			w.Header().Set("Content-Type", "image/jpeg")
			w.Header().Set("X-Frame", fmt.Sprint(state.Frame))
			_, _ = w.Write(data)
		default:
			http.NotFound(w, r)
		}
		return
	}
	if r.Method != "POST" {
		w.WriteHeader(405)
		return
	}
	switch path {
	case "/local/config":
		var cfg Config
		if !localDecode(w, r, &cfg) {
			return
		}
		cfg.Server = strings.TrimRight(strings.TrimSpace(cfg.Server), "/")
		cfg.Fingerprint = strings.TrimSpace(cfg.Fingerprint)
		if _, err := validateConfig(cfg); err != nil {
			localError(w, 400, err.Error())
			return
		}
		c.mu.Lock()
		cfg.Platform = c.config.Platform
		c.mu.Unlock()
		raw, _ := json.MarshalIndent(cfg, "", "  ")
		if err := os.WriteFile(filepath.Join(c.dir, "connection.json"), raw, 0600); err != nil {
			localError(w, 500, "保存连接设置失败")
			return
		}
		c.Remote.Stop()
		c.mu.Lock()
		c.config = cfg
		c.mu.Unlock()
		localJSON(w, cfg)
	case "/local/remote/start":
		var p struct{ ID, Token string }
		if !localDecode(w, r, &p) {
			return
		}
		cfg := c.Config()
		u, _ := validateConfig(cfg)
		httpClient := &http.Client{Timeout: 12 * time.Second, Transport: &http.Transport{TLSClientConfig: tlsConfig(cfg.Fingerprint)}}
		defer httpClient.CloseIdleConnections()
		get := func(path string, out any) error {
			req, err := http.NewRequest("GET", u.String()+path, nil)
			if err != nil {
				return err
			}
			req.Header.Set("Authorization", "Bearer "+p.Token)
			resp, err := httpClient.Do(req)
			if err != nil {
				return err
			}
			defer resp.Body.Close()
			if resp.StatusCode != 200 {
				return errors.New("远程协助身份验证失败")
			}
			return json.NewDecoder(resp.Body).Decode(out)
		}
		var inv remote.Invitation
		var me struct{ ID string }
		if err := get("/api/remotes/"+url.PathEscape(p.ID), &inv); err != nil {
			localError(w, 403, err.Error())
			return
		}
		if err := get("/api/me", &me); err != nil {
			localError(w, 403, err.Error())
			return
		}
		if err := c.Remote.Start(inv, me.ID, p.Token, cfg.Server, tlsConfig(cfg.Fingerprint)); err != nil {
			localError(w, 409, err.Error())
			return
		}
		localJSON(w, c.Remote.State())
	case "/local/remote/stop":
		c.Remote.Stop()
		localJSON(w, map[string]bool{"ok": true})
	case "/local/remote/input":
		var p struct{ Events []desktop.InputEvent }
		if !localDecode(w, r, &p) {
			return
		}
		if err := c.Remote.SendInput(p.Events); err != nil {
			localError(w, 403, err.Error())
			return
		}
		localJSON(w, map[string]bool{"ok": true})
	case "/local/remote/release":
		c.Remote.ReleaseInput()
		localJSON(w, map[string]bool{"ok": true})
	case "/local/window/min", "/local/window/max", "/local/window/close":
		if c.window != nil {
			action := strings.TrimPrefix(path, "/local/window/")
			go c.window(action)
		}
		localJSON(w, map[string]bool{"ok": true})
	default:
		http.NotFound(w, r)
	}
}
