package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"welink/internal/aiagent"
	"welink/internal/release"
)

// Signed official releases that a LinkMe server mirrors for its clients:
// linkme-AIdex (Me's local task component) and the client apps. Maintainers
// update them from the official site in the management console; clients
// download and update only from their own server, and check the official
// signature themselves.
var officialSite = "http://www.yucg.cn:8251"

const appReleaseName, appManifest = "linkme-app", "app.json"

type releaseJob struct {
	mu          sync.Mutex
	state, err  string // "", "updating", "failed", "done"
	done, total int64
	official    string // version last seen on the official site
}

type mirrorKind struct {
	name, manifest, sub, label string
	allowed                    func(file string) bool
}

var (
	aidexMirror = mirrorKind{name: aiagent.AIdexName, manifest: aiagent.AIdexManifest, sub: "tools", label: "linkme-AIdex", allowed: aiagent.AIdexFile}
	appMirror   = mirrorKind{name: appReleaseName, manifest: appManifest, sub: "", label: "客户端", allowed: func(f string) bool { return slices.Contains(downloadNames, f) }}
)

func (s *Server) mirrorJob(k mirrorKind) *releaseJob {
	if k.name == appReleaseName {
		return &s.appRelease
	}
	return &s.aidex
}

func (s *Server) mirrorDir(k mirrorKind) string { return filepath.Join(s.downloads, k.sub) }

func (s *Server) mirrorLocal(k mirrorKind) (release.Manifest, bool) {
	raw, err := os.ReadFile(filepath.Join(s.mirrorDir(k), k.manifest))
	if err != nil {
		return release.Manifest{}, false
	}
	m, err := release.Verify(raw, k.name)
	return m, err == nil
}

// withdrawAppRelease stops publishing app.json (after a manual upload).
func (s *Server) withdrawAppRelease() error {
	err := os.Remove(filepath.Join(s.downloads, appManifest))
	if os.IsNotExist(err) {
		return nil
	}
	return err
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

func officialClient() *http.Client {
	return &http.Client{Transport: &http.Transport{Proxy: http.ProxyFromEnvironment}}
}

func (s *Server) officialManifest(ctx context.Context, k mirrorKind) (release.Manifest, []byte, error) {
	raw, err := release.Fetch(ctx, officialClient(), strings.TrimRight(officialSite, "/")+"/downloads/"+path(k, k.manifest))
	if errors.Is(err, os.ErrNotExist) {
		return release.Manifest{}, nil, errors.New("官网暂未发布" + k.label)
	}
	if err != nil {
		return release.Manifest{}, nil, err
	}
	m, err := release.Verify(raw, k.name)
	return m, raw, err
}

func path(k mirrorKind, file string) string {
	if k.sub == "" {
		return file
	}
	return k.sub + "/" + file
}

func (s *Server) consoleMirrorStatus(k mirrorKind) func(http.ResponseWriter, *http.Request, consoleActor) {
	return func(w http.ResponseWriter, r *http.Request, _ consoleActor) {
		if s.downloads == "" {
			fail(w, 409, "服务器未配置下载目录")
			return
		}
		m, published := s.mirrorLocal(k)
		platforms := []map[string]any{}
		if published {
			for platform, f := range m.Packages {
				st, err := os.Stat(filepath.Join(s.mirrorDir(k), f.File))
				platforms = append(platforms, map[string]any{"platform": platform, "file": f.File, "size": f.Size, "ready": err == nil && st.Size() == f.Size})
			}
			slices.SortFunc(platforms, func(a, b map[string]any) int { return strings.Compare(a["platform"].(string), b["platform"].(string)) })
		}
		job := s.mirrorJob(k)
		if r.URL.Query().Get("check") == "1" {
			ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
			defer cancel()
			latest, _, err := s.officialManifest(ctx, k)
			if err != nil {
				fail(w, 502, "无法读取官网版本："+err.Error())
				return
			}
			job.mu.Lock()
			job.official = latest.Version
			job.mu.Unlock()
		}
		job.mu.Lock()
		defer job.mu.Unlock()
		ok(w, map[string]any{"version": m.Version, "published": published, "platforms": platforms, "official": job.official, "source": officialSite,
			"state": job.state, "error": job.err, "done": job.done, "total": job.total})
	}
}

func (s *Server) consoleMirrorUpdate(k mirrorKind, action string) func(http.ResponseWriter, *http.Request, consoleActor) {
	return func(w http.ResponseWriter, r *http.Request, a consoleActor) {
		if s.downloads == "" {
			fail(w, 409, "服务器未配置下载目录")
			return
		}
		job := s.mirrorJob(k)
		job.mu.Lock()
		if job.state == "updating" {
			job.mu.Unlock()
			fail(w, 409, "正在更新，请稍候")
			return
		}
		job.state, job.err, job.done, job.total = "updating", "", 0, 0
		job.mu.Unlock()
		_ = s.audit(nil, a, action, "", officialSite)
		go func() {
			version, err := s.mirrorUpdate(k, job)
			job.mu.Lock()
			defer job.mu.Unlock()
			if err != nil {
				job.state, job.err = "failed", err.Error()
				s.logger.Printf("%s update failed: %v", k.label, err)
				return
			}
			job.state, job.official = "done", version
			s.logger.Printf("%s %s published from %s", k.label, version, officialSite)
		}()
		ok(w, map[string]bool{"ok": true})
	}
}

// mirrorUpdate copies the official signed release into the downloads
// directory. Each file is verified before it replaces the old one, and the
// manifest is written last, so clients only ever see a complete version.
func (s *Server) mirrorUpdate(k mirrorKind, job *releaseJob) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Minute)
	defer cancel()
	m, raw, err := s.officialManifest(ctx, k)
	if err != nil {
		return "", err
	}
	dir := s.mirrorDir(k)
	if err = os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	var total, base int64
	for _, f := range m.Packages {
		if !k.allowed(f.File) {
			return "", errors.New("官网清单包含无效文件名")
		}
		total += f.Size
	}
	job.mu.Lock()
	job.total = total
	job.mu.Unlock()
	keep := map[string]bool{k.manifest: true}
	for _, f := range m.Packages {
		keep[f.File] = true
		target := filepath.Join(dir, f.File)
		if fileSHA256(target) != f.SHA256 {
			partial := target + ".download"
			err = release.Download(ctx, officialClient(), strings.TrimRight(officialSite, "/")+"/downloads/"+path(k, f.File), partial, f, func(done, _ int64) {
				job.mu.Lock()
				job.done = base + done
				job.mu.Unlock()
			})
			if err == nil {
				_ = os.Chmod(partial, 0644)
				err = os.Rename(partial, target)
			}
			if err != nil {
				os.Remove(partial)
				return "", err
			}
		}
		base += f.Size
		job.mu.Lock()
		job.done = base
		job.mu.Unlock()
	}
	if k.name == appReleaseName {
		if err = s.writeSums(); err != nil {
			return "", err
		}
	}
	if err = writeFileAtomic(filepath.Join(dir, k.manifest), raw, 0644); err != nil {
		return "", err
	}
	if k.name == aiagent.AIdexName {
		if entries, err := os.ReadDir(dir); err == nil {
			for _, e := range entries {
				if !keep[e.Name()] && strings.HasPrefix(e.Name(), aiagent.AIdexName+"-") {
					_ = os.Remove(filepath.Join(dir, e.Name()))
				}
			}
		}
	}
	return m.Version, nil
}
