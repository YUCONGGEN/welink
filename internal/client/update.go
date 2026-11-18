package client

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
	"welink/internal/release"
	"welink/internal/version"
)

// App updates come from the user's own LinkMe server, never from elsewhere:
// the server publishes downloads/app.json (signed by the official release
// key) next to the installers. The client checks it at start and every few
// hours, downloads a newer package in the background and verifies it, and
// the user restarts LinkMe to install it.
const (
	AppName     = "linkme-app"
	AppManifest = "app.json"
)

type appUpdate struct {
	mu          sync.Mutex
	state, err  string // "", "checking", "downloading", "ready", "failed"
	latest      string
	done, total int64
	path        string // verified package, when ready
	checked     time.Time
	loop        sync.Once
}

func (c *Client) appPlatform() string {
	if c.Config().Platform == "android" || runtime.GOOS == "android" {
		return "android/arm64"
	}
	return runtime.GOOS + "/" + runtime.GOARCH
}

func (c *Client) updatesDir() string { return filepath.Join(c.dir, "updates") }

// startUpdateLoop checks shortly after start, then every six hours.
func (c *Client) startUpdateLoop() {
	c.update.loop.Do(func() {
		go func() {
			time.Sleep(20 * time.Second)
			for {
				c.checkAppUpdate()
				time.Sleep(6 * time.Hour)
			}
		}()
	})
}

func (c *Client) checkAppUpdate() {
	c.update.mu.Lock()
	if c.update.state == "checking" || c.update.state == "downloading" {
		c.update.mu.Unlock()
		return
	}
	c.update.state, c.update.err = "checking", ""
	c.update.mu.Unlock()
	path, latest, err := c.fetchAppUpdate()
	c.update.mu.Lock()
	defer c.update.mu.Unlock()
	c.update.checked, c.update.latest = time.Now(), latest
	switch {
	case err != nil:
		c.update.state, c.update.err = "failed", err.Error()
	case path != "":
		c.update.state, c.update.path = "ready", path
	default:
		c.update.state = ""
	}
}

// fetchAppUpdate returns the verified package of a newer version, if any.
func (c *Client) fetchAppUpdate() (string, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	server := strings.TrimRight(c.Config().Server, "/")
	httpClient := c.toolsHTTP()
	raw, err := release.Fetch(ctx, httpClient, server+"/downloads/"+AppManifest)
	if errors.Is(err, os.ErrNotExist) {
		return "", "", nil // this server does not offer signed updates
	}
	if err != nil {
		return "", "", err
	}
	m, err := release.Verify(raw, AppName)
	if err != nil {
		return "", "", err
	}
	f, ok := m.Packages[c.appPlatform()]
	if !ok || !release.Newer(m.Version, version.App) {
		return "", m.Version, nil
	}
	dir := c.updatesDir()
	if err = os.MkdirAll(dir, 0700); err != nil {
		return "", m.Version, err
	}
	target := filepath.Join(dir, m.Version+"-"+f.File)
	if st, err := os.Stat(target); err == nil && st.Size() == f.Size && fileSHA256(target) == f.SHA256 {
		return target, m.Version, nil
	}
	// Only the newest download is kept.
	if entries, err := os.ReadDir(dir); err == nil {
		for _, e := range entries {
			_ = os.RemoveAll(filepath.Join(dir, e.Name()))
		}
	}
	c.update.mu.Lock()
	c.update.state, c.update.latest, c.update.done, c.update.total = "downloading", m.Version, 0, f.Size
	c.update.mu.Unlock()
	partial := target + ".download"
	err = release.Download(ctx, httpClient, server+"/downloads/"+f.File, partial, f, func(done, total int64) {
		c.update.mu.Lock()
		c.update.done = done
		c.update.mu.Unlock()
	})
	if err == nil {
		err = os.Rename(partial, target)
	}
	if err != nil {
		_ = os.Remove(partial)
		return "", m.Version, fmt.Errorf("下载新版本失败：%v", err)
	}
	return target, m.Version, nil
}

func (c *Client) appUpdateStatus() map[string]any {
	c.update.mu.Lock()
	defer c.update.mu.Unlock()
	return map[string]any{"current": version.App, "latest": c.update.latest, "state": c.update.state, "error": c.update.err, "done": c.update.done, "total": c.update.total, "platform": c.appPlatform()}
}

// applyAppUpdate starts installing the downloaded package. On Windows the
// installer waits for LinkMe to exit, then replaces and restarts it; on macOS
// a helper swaps the app bundle after exit. Android returns the package path
// for the system installer.
func (c *Client) applyAppUpdate() (map[string]any, error) {
	c.update.mu.Lock()
	path, state := c.update.path, c.update.state
	c.update.mu.Unlock()
	if state != "ready" || path == "" {
		return nil, errors.New("新版本尚未下载完成")
	}
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	switch c.appPlatform() {
	case "windows/amd64":
		if !strings.EqualFold(filepath.Base(exe), "WeLink-Windows.exe") {
			return nil, errors.New("当前运行方式不支持自动更新，请从下载页安装新版本")
		}
		cmd := exec.Command(path, "-update", "-dir", filepath.Dir(exe))
		detach(cmd)
		if err = cmd.Start(); err != nil {
			return nil, fmt.Errorf("无法启动更新：%v", err)
		}
		return map[string]any{"exit": true}, nil
	case "darwin/arm64":
		app := filepath.Clean(filepath.Join(filepath.Dir(exe), "..", ".."))
		if !strings.HasSuffix(app, ".app") {
			return nil, errors.New("当前运行方式不支持自动更新，请从下载页安装新版本")
		}
		staging := filepath.Join(c.updatesDir(), "staging")
		_ = os.RemoveAll(staging)
		if err = unzipApp(path, staging); err != nil {
			return nil, err
		}
		fresh, _ := filepath.Glob(filepath.Join(staging, "*.app"))
		if len(fresh) != 1 {
			return nil, errors.New("更新包内容无效")
		}
		script := `while kill -0 "$1" 2>/dev/null; do sleep 0.3; done; rm -rf "$2.old"; mv "$2" "$2.old" && mv "$3" "$2" && rm -rf "$2.old"; open "$2"`
		cmd := exec.Command("/bin/sh", "-c", script, "sh", fmt.Sprint(os.Getpid()), app, fresh[0])
		detach(cmd)
		if err = cmd.Start(); err != nil {
			return nil, err
		}
		go func() { time.Sleep(time.Second); os.Exit(0) }()
		return map[string]any{"exit": true}, nil
	case "android/arm64":
		return map[string]any{"apk": path}, nil
	}
	return nil, errors.New("当前系统不支持自动更新")
}

func fileSHA256(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	if _, err = io.Copy(h, f); err != nil {
		return ""
	}
	return hex.EncodeToString(h.Sum(nil))
}

func unzipApp(archive, dir string) error {
	r, err := zip.OpenReader(archive)
	if err != nil {
		return errors.New("更新包已损坏")
	}
	defer r.Close()
	for _, f := range r.File {
		name := filepath.FromSlash(f.Name)
		if !filepath.IsLocal(name) {
			return errors.New("更新包内容无效")
		}
		target := filepath.Join(dir, name)
		if f.FileInfo().IsDir() {
			if err = os.MkdirAll(target, 0755); err != nil {
				return err
			}
			continue
		}
		if f.Mode()&os.ModeSymlink != 0 {
			src, err := f.Open()
			if err != nil {
				return err
			}
			link, _ := io.ReadAll(io.LimitReader(src, 4096))
			src.Close()
			if err = os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				return err
			}
			if err = os.Symlink(string(link), target); err != nil {
				return err
			}
			continue
		}
		if err = os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		src, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, f.Mode().Perm()|0600)
		if err == nil {
			_, err = io.Copy(out, src)
			if cerr := out.Close(); err == nil {
				err = cerr
			}
		}
		src.Close()
		if err != nil {
			return err
		}
	}
	return nil
}
