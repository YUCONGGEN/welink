package client

import (
	"context"
	"net/http"
	"path/filepath"
	"sync"
	"time"
	"welink/internal/aiagent"
	"welink/internal/release"
)

// codexInstall tracks linkme-AIdex, Me's local task component. The installer
// stays small: the component is downloaded from the user's LinkMe server on
// first use, and updated automatically when the server offers a newer
// signed version.
type codexInstall struct {
	mu          sync.Mutex
	state, err  string // "", "downloading", "failed"
	done, total int64
	cancel      context.CancelFunc
	manifest    release.Manifest
	manifestErr string
	checked     time.Time
	server      string
}

func (c *Client) codexRoot() string { return filepath.Join(c.dir, "tools") }

func (c *Client) toolsHTTP() *http.Client {
	cfg := c.Config()
	// Straight to the user's server, like every other LinkMe connection: a
	// system/env proxy usually cannot reach a LAN server.
	return &http.Client{Transport: &http.Transport{Proxy: nil, TLSClientConfig: tlsConfig(cfg.Fingerprint)}}
}

// aidexManifest returns the server's verified manifest, cached briefly.
func (c *Client) aidexManifest(force bool) (release.Manifest, string) {
	server := c.Config().Server
	c.codex.mu.Lock()
	fresh := c.codex.server == server && time.Since(c.codex.checked) < 10*time.Minute
	if fresh && !force {
		defer c.codex.mu.Unlock()
		return c.codex.manifest, c.codex.manifestErr
	}
	c.codex.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	m, err := aiagent.FetchAIdexManifest(ctx, c.toolsHTTP(), server)
	c.codex.mu.Lock()
	defer c.codex.mu.Unlock()
	c.codex.manifest, c.codex.manifestErr, c.codex.checked, c.codex.server = m, "", time.Now(), server
	if err != nil {
		c.codex.manifest, c.codex.manifestErr = release.Manifest{}, err.Error()
	}
	return c.codex.manifest, c.codex.manifestErr
}

func (c *Client) codexStatus() map[string]any {
	supported := aiagent.AIdexSupported()
	binary := aiagent.FindBinary(c.codexRoot())
	downloaded, current := aiagent.DownloadedCodex(c.codexRoot())
	var m release.Manifest
	var manifestErr string
	if supported {
		m, manifestErr = c.aidexManifest(false)
	}
	file := m.Packages[aiagent.Platform()]
	// A downloaded copy follows the server automatically.
	if downloaded != "" && file.File != "" && release.Newer(m.Version, current) {
		c.startCodexInstall()
	}
	c.codex.mu.Lock()
	defer c.codex.mu.Unlock()
	// source: "downloaded" (managed here) or "system" (installed by the user
	// or shipped with LinkMe; left as it is).
	source := ""
	if binary != "" {
		source = "system"
		if binary == downloaded {
			source = "downloaded"
		}
	}
	state := c.codex.state
	if state == "" {
		switch {
		case binary != "":
			state = "installed"
		case file.File == "":
			state = "unavailable"
		default:
			state = "missing"
		}
	}
	errText := c.codex.err
	if state == "unavailable" {
		errText = manifestErr
		if errText == "" {
			errText = "服务器的 linkme-AIdex 不支持当前系统"
		}
	}
	return map[string]any{"supported": supported, "installed": binary != "", "source": source, "current": current, "version": m.Version, "size": file.Size, "state": state, "done": c.codex.done, "total": c.codex.total, "error": errText}
}

func (c *Client) startCodexInstall() {
	c.codex.mu.Lock()
	if c.codex.state == "downloading" {
		c.codex.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	c.codex.state, c.codex.err, c.codex.done, c.codex.total, c.codex.cancel = "downloading", "", 0, 0, cancel
	c.codex.mu.Unlock()
	go func() {
		defer cancel()
		m, manifestErr := c.aidexManifest(true)
		err := error(nil)
		if manifestErr != "" {
			err = errString(manifestErr)
		} else {
			c.codex.mu.Lock()
			c.codex.total = m.Packages[aiagent.Platform()].Size
			c.codex.mu.Unlock()
			err = aiagent.InstallAIdex(ctx, c.codexRoot(), c.toolsHTTP(), c.Config().Server, m, func(done, total int64) {
				c.codex.mu.Lock()
				c.codex.done, c.codex.total = done, total
				c.codex.mu.Unlock()
			})
		}
		c.codex.mu.Lock()
		defer c.codex.mu.Unlock()
		c.codex.cancel = nil
		if err != nil {
			c.codex.state, c.codex.err = "failed", err.Error()
			return
		}
		c.codex.state = ""
	}()
}

type errString string

func (e errString) Error() string { return string(e) }

func (c *Client) cancelCodexInstall() {
	c.codex.mu.Lock()
	defer c.codex.mu.Unlock()
	if c.codex.cancel != nil {
		c.codex.cancel()
	}
}
