package server

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"welink/internal/version"

	"welink/internal/emailauth"
)

// Configuration management for the console: the server settings file, the
// private credential files it points to, and the client packages published on
// the download page. Saved settings take effect after a restart.

func (s *Server) consoleOverview(w http.ResponseWriter, r *http.Request, _ consoleActor) {
	counts := map[string]int64{}
	for key, query := range map[string]string{
		"users":      "SELECT COUNT(*) FROM users u WHERE NOT EXISTS(SELECT 1 FROM deleted_accounts d WHERE d.user_id=u.id) AND u.account NOT LIKE 'me_ai_%'",
		"disabled":   "SELECT COUNT(*) FROM user_status st WHERE st.disabled=1 AND NOT EXISTS(SELECT 1 FROM deleted_accounts d WHERE d.user_id=st.user_id)",
		"sessions":   "SELECT COUNT(*) FROM sessions WHERE expires>" + fmt.Sprint(now()),
		"groups":     "SELECT COUNT(*) FROM conversations c WHERE kind='group' AND NOT EXISTS(SELECT 1 FROM group_profiles g WHERE g.conversation_id=c.id AND g.dissolved=1)",
		"messages":   "SELECT COUNT(*) FROM messages",
		"driveBytes": "SELECT COALESCE(SUM(size),0) FROM drive_files",
	} {
		var n int64
		if err := s.db.QueryRow(query).Scan(&n); err == nil {
			counts[key] = n
		}
	}
	s.mu.Lock()
	counts["online"] = int64(len(s.clients))
	s.mu.Unlock()
	s.meetings.Lock()
	counts["meetings"] = int64(len(s.meetings.rooms))
	s.meetings.Unlock()
	type volume struct {
		ID    string `json:"id"`
		Root  string `json:"root"`
		Free  int64  `json:"free"`
		Ready bool   `json:"ready"`
		Error string `json:"error,omitempty"`
	}
	volumes := []volume{}
	for _, v := range s.storageVolumes() {
		item := volume{ID: v.ID, Root: v.Root, Ready: true}
		if err := s.volumeReady(v); err != nil {
			item.Ready, item.Error = false, err.Error()
		}
		item.Free, _ = storageFree(v.Root)
		volumes = append(volumes, item)
	}
	dataFree, _ := storageFree(s.dir)
	ok(w, map[string]any{
		"version": version.App, "started": s.started.UnixMilli(), "counts": counts, "volumes": volumes,
		"dataDir": s.dir, "dataFree": dataFree, "downloadsDir": s.downloads, "configPath": s.configPath,
		"supervised": s.supervised, "restartPending": s.settingsChangedOnDisk(),
		"publicURL": s.settings.PublicURL, "downloadURL": s.settings.DownloadURL, "listen": s.settings.Listen,
		"downloadListen": s.settings.DownloadListen, "consoleListen": s.settings.Console.Listen,
		"emailAuth": s.settings.EmailAuth.Enabled, "registration": s.settings.Registration.Enabled, "media": s.settings.Media.Enabled, "ai": s.settings.AI.Enabled,
	})
}

// fileSettings reads the configuration file as it is on disk now, which may
// differ from the running settings until the next restart.
func (s *Server) fileSettings() (Settings, error) {
	if s.configPath == "" {
		return s.settings, nil
	}
	return LoadSettings(s.configPath)
}

func (s *Server) settingsChangedOnDisk() bool {
	if s.configPath == "" {
		return false
	}
	saved, err := s.fileSettings()
	if err != nil {
		return true
	}
	a, _ := json.Marshal(saved)
	b, _ := json.Marshal(s.settings)
	return !bytes.Equal(a, b)
}

func (s *Server) consoleSettings(w http.ResponseWriter, r *http.Request, _ consoleActor) {
	saved, err := s.fileSettings()
	result := map[string]any{"running": s.settings, "configPath": s.configPath, "editable": s.configPath != "", "supervised": s.supervised, "defaults": DefaultSettings()}
	if err != nil {
		result["settings"] = s.settings
		result["fileError"] = err.Error()
	} else {
		result["settings"] = saved
		result["restartPending"] = s.settingsChangedOnDisk()
	}
	ok(w, result)
}

// writeFileAtomic replaces path with data via a temporary file in the same
// directory, so a crash never leaves a half-written configuration.
func writeFileAtomic(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*")
	if err != nil {
		// The service may own the file but not its directory (for example a
		// root-owned install directory); then rewrite the file in place.
		if f, e := os.OpenFile(path, os.O_WRONLY|os.O_TRUNC, mode); e == nil {
			_, e = f.Write(data)
			if e == nil {
				e = f.Sync()
			}
			if cerr := f.Close(); e == nil {
				e = cerr
			}
			return e
		}
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if _, err = tmp.Write(data); err == nil {
		err = tmp.Sync()
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Chmod(name, mode)
	}
	if err == nil {
		err = os.Rename(name, path)
	}
	return err
}

// saveSettingsFile validates and writes the configuration, keeping the
// previous version in config-backups next to it (last 20).
func (s *Server) saveSettingsFile(next Settings) error {
	if s.configPath == "" {
		return groupFail(409, "服务未使用配置文件启动（缺少 -config），无法在后台保存设置")
	}
	if err := next.Validate(); err != nil {
		return groupFail(400, "设置无效："+err.Error())
	}
	data, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if old, e := os.ReadFile(s.configPath); e == nil {
		dir := filepath.Join(filepath.Dir(s.configPath), "config-backups")
		if e = os.MkdirAll(dir, 0700); e == nil {
			_ = os.WriteFile(filepath.Join(dir, "config-"+time.Now().Format("20060102-150405.000")+".json"), old, 0600)
			if entries, e := os.ReadDir(dir); e == nil && len(entries) > 20 {
				names := []string{}
				for _, entry := range entries {
					names = append(names, entry.Name())
				}
				sort.Strings(names)
				for _, name := range names[:len(names)-20] {
					_ = os.Remove(filepath.Join(dir, name))
				}
			}
		}
	}
	return writeFileAtomic(s.configPath, data, 0600)
}

func (s *Server) consoleSaveSettings(w http.ResponseWriter, r *http.Request, a consoleActor) {
	next := DefaultSettings()
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(&next); err != nil {
		fail(w, 400, "设置格式错误："+err.Error())
		return
	}
	if !next.Console.Enabled {
		fail(w, 400, "不能在后台关闭管理后台本身")
		return
	}
	before, _ := s.fileSettings()
	if err := s.saveSettingsFile(next); err != nil {
		s.dbError(w, err)
		return
	}
	_ = s.audit(nil, a, "save-settings", "", strings.Join(settingsDiff(before, next), ", "))
	ok(w, map[string]any{"ok": true, "restartPending": s.settingsChangedOnDisk(), "supervised": s.supervised})
}

// settingsDiff lists the changed top-level keys for the audit log.
func settingsDiff(a, b Settings) []string {
	var x, y map[string]json.RawMessage
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	_ = json.Unmarshal(ja, &x)
	_ = json.Unmarshal(jb, &y)
	out := []string{}
	for k, v := range y {
		if !bytes.Equal(x[k], v) {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

func (s *Server) consoleRestart(w http.ResponseWriter, r *http.Request, a consoleActor) {
	if !s.supervised {
		fail(w, 409, "服务不是由系统服务启动的，无法自动重启；请在服务器上手动重启")
		return
	}
	if saved, err := s.fileSettings(); err != nil {
		fail(w, 409, "配置文件当前无效，重启会失败："+err.Error())
		return
	} else if err = saved.Validate(); err != nil {
		fail(w, 409, "配置文件当前无效，重启会失败："+err.Error())
		return
	}
	_ = s.audit(nil, a, "restart", "", "")
	ok(w, map[string]bool{"ok": true})
	if f, isFlusher := w.(http.Flusher); isFlusher {
		f.Flush()
	}
	go func() {
		time.Sleep(500 * time.Millisecond)
		s.restartOnce.Do(func() { close(s.restart) })
	}()
}

// Private credential files referenced by the settings. Secret values are
// write-only: the console shows whether they are set, never what they are.

type configFileView struct {
	Kind     string          `json:"kind"`
	Path     string          `json:"path"`
	Exists   bool            `json:"exists"`
	Modified int64           `json:"modified,omitempty"`
	Values   map[string]any  `json:"values"`
	Secrets  map[string]bool `json:"secrets"`
	Error    string          `json:"error,omitempty"`
}

func (s *Server) configFilePath(kind string, settings Settings) string {
	switch kind {
	case "email":
		return settings.EmailAuth.CredentialsFile
	case "ai":
		return settings.AI.CredentialsFile
	case "media":
		return settings.Media.SecretFile
	}
	return ""
}

func (s *Server) defaultConfigFilePath(kind string) string {
	base := filepath.Dir(s.configPath)
	if s.configPath == "" {
		base = s.dir
	}
	switch kind {
	case "email":
		return filepath.Join(base, "private", "email.json")
	case "ai":
		return filepath.Join(base, "private", "ai.json")
	}
	return filepath.Join(base, "private", "media-secret")
}

func (s *Server) consoleConfigFiles(w http.ResponseWriter, r *http.Request, _ consoleActor) {
	settings, err := s.fileSettings()
	if err != nil {
		settings = s.settings
	}
	out := []configFileView{}
	for _, kind := range []string{"email", "ai", "media"} {
		v := configFileView{Kind: kind, Path: s.configFilePath(kind, settings), Values: map[string]any{}, Secrets: map[string]bool{}}
		var raw []byte
		if v.Path != "" {
			if info, e := os.Stat(v.Path); e == nil {
				v.Exists, v.Modified = true, info.ModTime().UnixMilli()
				raw, e = os.ReadFile(v.Path)
				if e != nil {
					v.Error = "无法读取文件"
				}
			}
		}
		switch kind {
		case "email":
			var c emailauth.Config
			if len(raw) > 0 && json.Unmarshal(raw, &c) != nil {
				v.Error = "文件不是有效的 JSON"
			}
			v.Values = map[string]any{"secretId": c.SecretID, "region": c.Region, "from": c.From, "templateId": c.TemplateID, "subject": c.Subject}
			v.Secrets["secretKey"] = c.SecretKey != ""
		case "ai":
			var c struct {
				BaseURL string `json:"base_url"`
				Token   string `json:"token"`
			}
			if len(raw) > 0 && json.Unmarshal(raw, &c) != nil {
				v.Error = "文件不是有效的 JSON"
			}
			v.Values = map[string]any{"base_url": c.BaseURL}
			v.Secrets["token"] = c.Token != ""
		case "media":
			v.Secrets["secret"] = len(bytes.TrimSpace(raw)) > 0
		}
		out = append(out, v)
	}
	ok(w, out)
}

func randomSecret() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

func (s *Server) consoleSaveConfigFile(w http.ResponseWriter, r *http.Request, a consoleActor) {
	kind := r.PathValue("kind")
	if kind != "email" && kind != "ai" && kind != "media" {
		fail(w, 404, "未知的配置文件")
		return
	}
	var p map[string]any
	if !decode(w, r, &p) {
		return
	}
	str := func(key string) string {
		v, _ := p[key].(string)
		return strings.TrimSpace(v)
	}
	settings, err := s.fileSettings()
	if err != nil {
		fail(w, 409, "配置文件当前无效，请先在“系统设置”中修正："+err.Error())
		return
	}
	path := s.configFilePath(kind, settings)
	if path == "" {
		path = s.defaultConfigFilePath(kind)
	}
	old, _ := os.ReadFile(path)
	var data []byte
	switch kind {
	case "email":
		var c emailauth.Config
		_ = json.Unmarshal(old, &c)
		templateID, _ := p["templateId"].(float64)
		c.SecretID, c.Region, c.From, c.Subject, c.TemplateID = str("secretId"), str("region"), str("from"), str("subject"), uint64(templateID)
		if key := str("secretKey"); key != "" {
			c.SecretKey = key
		}
		if data, err = json.MarshalIndent(c, "", "  "); err == nil {
			tmp := filepath.Join(filepath.Dir(path), ".email-check.json")
			if err = writeFileAtomic(tmp, data, 0600); err == nil {
				_, err = emailauth.LoadConfig(tmp)
				_ = os.Remove(tmp)
				if err != nil {
					fail(w, 400, "邮件配置不完整：需要 SecretId、SecretKey、地域（ap-guangzhou 或 ap-hongkong）、发件地址、模板 ID 和邮件主题")
					return
				}
			}
		}
	case "ai":
		var c struct {
			BaseURL string `json:"base_url"`
			Token   string `json:"token"`
		}
		_ = json.Unmarshal(old, &c)
		c.BaseURL = str("base_url")
		if token := str("token"); token != "" {
			c.Token = token
		}
		if !strings.HasPrefix(c.BaseURL, "http://") && !strings.HasPrefix(c.BaseURL, "https://") || len(c.Token) < 16 {
			fail(w, 400, "请填写以 http(s):// 开头的接口地址，以及至少 16 位的访问令牌")
			return
		}
		data, err = json.MarshalIndent(c, "", "  ")
	case "media":
		secret := str("secret")
		if p["generate"] == true {
			secret, err = randomSecret()
		}
		if err == nil && len(secret) < 16 {
			fail(w, 400, "中继密钥至少 16 位，或选择自动生成")
			return
		}
		data = []byte(secret + "\n")
	}
	if err == nil {
		err = writeFileAtomic(path, data, 0600)
	}
	if err == nil && s.configFilePath(kind, settings) != path {
		// Point the settings at the new file.
		switch kind {
		case "email":
			settings.EmailAuth.CredentialsFile = path
		case "ai":
			settings.AI.CredentialsFile = path
		case "media":
			settings.Media.SecretFile = path
		}
		err = s.saveSettingsFile(settings)
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	_ = s.audit(nil, a, "save-credentials", kind, path)
	ok(w, map[string]any{"ok": true, "path": path, "restartPending": true})
}

// Client packages on the public download page.

var downloadNames = []string{"LinkMe-Setup.exe", "LinkMe-Android.apk", "LinkMe-macOS-arm64.zip"}

func validDownloadName(name string) bool {
	for _, n := range downloadNames {
		if n == name {
			return true
		}
	}
	return false
}

func (s *Server) consoleDownloads(w http.ResponseWriter, r *http.Request, _ consoleActor) {
	type item struct {
		Name     string `json:"name"`
		Size     int64  `json:"size"`
		Modified int64  `json:"modified"`
		SHA256   string `json:"sha256"`
		Exists   bool   `json:"exists"`
	}
	sums := map[string]string{}
	if raw, err := os.ReadFile(filepath.Join(s.downloads, "SHA256SUMS.txt")); err == nil {
		for _, line := range strings.Split(string(raw), "\n") {
			if f := strings.Fields(line); len(f) == 2 {
				sums[f[1]] = f[0]
			}
		}
	}
	out := []item{}
	for _, name := range downloadNames {
		v := item{Name: name, SHA256: sums[name]}
		if info, err := os.Stat(filepath.Join(s.downloads, name)); err == nil {
			v.Exists, v.Size, v.Modified = true, info.Size(), info.ModTime().UnixMilli()
		}
		out = append(out, v)
	}
	ok(w, map[string]any{"items": out, "dir": s.downloads, "url": s.settings.DownloadURL})
}

// writeSums rewrites SHA256SUMS.txt for the packages present now.
func (s *Server) writeSums() error {
	var b strings.Builder
	for _, name := range downloadNames {
		f, err := os.Open(filepath.Join(s.downloads, name))
		if err != nil {
			continue
		}
		h := sha256.New()
		_, err = io.Copy(h, f)
		f.Close()
		if err != nil {
			return err
		}
		b.WriteString(hex.EncodeToString(h.Sum(nil)) + "  " + name + "\n")
	}
	return writeFileAtomic(filepath.Join(s.downloads, "SHA256SUMS.txt"), []byte(b.String()), 0644)
}

func (s *Server) consoleUploadDownload(w http.ResponseWriter, r *http.Request, a consoleActor) {
	name := r.PathValue("name")
	if !validDownloadName(name) {
		fail(w, 400, "只能上传 Windows 安装包、Android 安装包或 macOS 压缩包")
		return
	}
	if s.downloads == "" {
		fail(w, 409, "未配置下载目录")
		return
	}
	if err := os.MkdirAll(s.downloads, 0755); err != nil {
		s.dbError(w, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 512<<20)
	tmp, err := os.CreateTemp(s.downloads, "."+name+".upload-*")
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer os.Remove(tmp.Name())
	h := sha256.New()
	size, err := io.Copy(io.MultiWriter(tmp, h), r.Body)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		fail(w, 400, "上传未完成："+err.Error())
		return
	}
	if size < 1024 {
		fail(w, 400, "文件过小，不像是安装包")
		return
	}
	if err = checkPackage(name, tmp.Name()); err != nil {
		fail(w, 400, err.Error())
		return
	}
	if err = os.Chmod(tmp.Name(), 0644); err == nil {
		err = os.Rename(tmp.Name(), filepath.Join(s.downloads, name))
	}
	if err == nil {
		err = s.writeSums()
	}
	if err == nil {
		// A hand-uploaded package is not part of the signed official
		// release, so clients stop self-updating from this server until the
		// next "从官网更新".
		err = s.withdrawAppRelease()
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	sum := hex.EncodeToString(h.Sum(nil))
	_ = s.audit(nil, a, "upload-package", name, fmt.Sprintf("%d bytes sha256 %s", size, sum[:16]))
	ok(w, map[string]any{"ok": true, "size": size, "sha256": sum})
}

// checkPackage rejects an obviously wrong file for the slot (an APK in the
// Windows slot and so on) by its file signature.
func checkPackage(name, path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	head := make([]byte, 4)
	if _, err = io.ReadFull(f, head); err != nil {
		return errors.New("无法读取文件")
	}
	switch {
	case strings.HasSuffix(name, ".exe") && string(head[:2]) != "MZ":
		return errors.New("这不是 Windows 程序文件（.exe）")
	case (strings.HasSuffix(name, ".apk") || strings.HasSuffix(name, ".zip")) && string(head) != "PK\x03\x04":
		return errors.New("这不是有效的安装包（应为 ZIP/APK 格式）")
	}
	return nil
}

func (s *Server) consoleDeleteDownload(w http.ResponseWriter, r *http.Request, a consoleActor) {
	name := r.PathValue("name")
	if !validDownloadName(name) {
		fail(w, 404, "文件不存在")
		return
	}
	_ = s.withdrawAppRelease()
	err := os.Remove(filepath.Join(s.downloads, name))
	if err != nil && !os.IsNotExist(err) {
		s.dbError(w, err)
		return
	}
	if err = s.writeSums(); err != nil {
		s.dbError(w, err)
		return
	}
	_ = s.audit(nil, a, "delete-package", name, "")
	ok(w, map[string]bool{"ok": true})
}

// AI model configuration: protocol, endpoint URL, API key (write-only) and
// model ID live together on one console page. The key and URL are stored in
// the private credentials file; everything else in the settings file.

type aiCredentials struct {
	BaseURL string `json:"base_url"`
	Token   string `json:"token"`
}

type aiConfigInput struct {
	Enabled bool   `json:"enabled"`
	API     string `json:"api"`
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
	Model   string `json:"model"`
	Effort  string `json:"effort"`
}

func (s *Server) aiCredentialsPath(settings Settings) string {
	if settings.AI.CredentialsFile != "" {
		return settings.AI.CredentialsFile
	}
	return s.defaultConfigFilePath("ai")
}

func readAICredentials(path string) aiCredentials {
	var c aiCredentials
	if raw, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(raw, &c)
	}
	return c
}

func (s *Server) consoleAI(w http.ResponseWriter, r *http.Request, _ consoleActor) {
	settings, err := s.fileSettings()
	if err != nil {
		settings = s.settings
	}
	creds := readAICredentials(s.aiCredentialsPath(settings))
	api := settings.AI.API
	if api == "" {
		api = "responses"
	}
	ok(w, map[string]any{"enabled": settings.AI.Enabled, "api": api, "baseUrl": creds.BaseURL, "keySet": creds.Token != "", "model": settings.AI.Model, "effort": settings.AI.ReasoningEffort,
		"running": s.ai != nil, "restartPending": s.settingsChangedOnDisk(), "supervised": s.supervised})
}

// resolve fills a blank key from the saved credentials and validates the three
// required fields.
func (s *Server) resolveAIInput(p *aiConfigInput, settings Settings) error {
	p.API, p.BaseURL, p.Model, p.Effort = strings.TrimSpace(p.API), strings.TrimRight(strings.TrimSpace(p.BaseURL), "/"), strings.TrimSpace(p.Model), strings.TrimSpace(p.Effort)
	p.APIKey = strings.TrimSpace(p.APIKey)
	if p.API == "" {
		p.API = "chat"
	}
	if p.API != "chat" && p.API != "responses" {
		return errors.New("请选择接口类型")
	}
	if p.APIKey == "" {
		p.APIKey = readAICredentials(s.aiCredentialsPath(settings)).Token
	}
	u, err := url.Parse(p.BaseURL)
	switch {
	case p.BaseURL == "" || err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.RawQuery != "" || u.User != nil:
		return errors.New("请填写以 http:// 或 https:// 开头的接口地址，例如 https://api.deepseek.com")
	case len(p.APIKey) < 8:
		return errors.New("请填写 API Key")
	case p.Model == "" || len(p.Model) > 128 || strings.ContainsAny(p.Model, " \r\n\t"):
		return errors.New("请填写模型 ID，例如 deepseek-chat")
	}
	if p.API == "responses" && p.Effort == "" {
		p.Effort = "medium"
	}
	return nil
}

func (s *Server) consoleSaveAI(w http.ResponseWriter, r *http.Request, a consoleActor) {
	var p aiConfigInput
	if !decode(w, r, &p) {
		return
	}
	settings, err := s.fileSettings()
	if err != nil {
		fail(w, 409, "配置文件当前无效，请先在“系统设置”中修正："+err.Error())
		return
	}
	if err = s.resolveAIInput(&p, settings); err != nil {
		fail(w, 400, err.Error())
		return
	}
	path := s.aiCredentialsPath(settings)
	data, _ := json.MarshalIndent(aiCredentials{BaseURL: p.BaseURL, Token: p.APIKey}, "", "  ")
	if err = writeFileAtomic(path, data, 0600); err != nil {
		s.dbError(w, err)
		return
	}
	settings.AI.Enabled, settings.AI.API, settings.AI.Model, settings.AI.CredentialsFile = p.Enabled, p.API, p.Model, path
	if p.Effort != "" {
		settings.AI.ReasoningEffort = p.Effort
	}
	if err = s.saveSettingsFile(settings); err != nil {
		s.dbError(w, err)
		return
	}
	_ = s.audit(nil, a, "save-ai", "", p.API+" "+p.BaseURL+" "+p.Model)
	ok(w, map[string]any{"ok": true, "restartPending": s.settingsChangedOnDisk(), "supervised": s.supervised})
}

// consoleTestAI sends one short request with the given settings (saved key if
// the field is blank) and reports the model's reply or the provider's error.
func (s *Server) consoleTestAI(w http.ResponseWriter, r *http.Request, _ consoleActor) {
	var p aiConfigInput
	if !decode(w, r, &p) {
		return
	}
	if !s.rate(r, "console-ai-test", 20, time.Minute) {
		fail(w, 429, "测试过于频繁，请稍后再试")
		return
	}
	settings, _ := s.fileSettings()
	if err := s.resolveAIInput(&p, settings); err != nil {
		fail(w, 400, err.Error())
		return
	}
	prompt := "请只回复四个字：连接成功"
	payload := map[string]any{"model": p.Model, "messages": []map[string]string{{"role": "user", "content": prompt}}, "stream": false, "max_tokens": 32}
	endpoint, read := p.BaseURL+"/chat/completions", readChatReply
	if p.API == "responses" {
		payload = map[string]any{"model": p.Model, "input": prompt, "store": false, "max_output_tokens": 64}
		endpoint, read = p.BaseURL+"/responses", readAIReply
	}
	raw, _ := json.Marshal(payload)
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(raw))
	if err != nil {
		fail(w, 400, "接口地址无效")
		return
	}
	req.Header.Set("Authorization", "Bearer "+p.APIKey)
	req.Header.Set("Content-Type", "application/json")
	started := time.Now()
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		message := "无法连接到 " + endpoint
		if ctx.Err() != nil {
			message += "（45 秒内没有响应）"
		}
		fail(w, 502, message)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		fail(w, 502, providerError(resp)+"（请求地址 "+endpoint+"）")
		return
	}
	reply, err := read(resp.Body, resp.Header.Get("Content-Type"))
	if err != nil {
		fail(w, 502, err.Error())
		return
	}
	runes := []rune(strings.TrimSpace(reply))
	if len(runes) > 120 {
		runes = append(runes[:120], '…')
	}
	ok(w, map[string]any{"ok": true, "reply": string(runes), "ms": time.Since(started).Milliseconds(), "endpoint": endpoint})
}
