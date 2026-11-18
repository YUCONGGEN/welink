package server

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"welink/internal/aiagent"
	"welink/internal/release"
)

// fakeOfficial serves a signed linkme-AIdex release like the official site.
func fakeOfficial(t *testing.T, key ed25519.PrivateKey, version string, archive []byte) *httptest.Server {
	sum := sha256.Sum256(archive)
	file := aiagent.AIdexName + "-" + version + "-windows-amd64.tar.zst"
	signed, err := release.Sign(release.Manifest{Name: aiagent.AIdexName, Version: version, Packages: map[string]release.File{"windows/amd64": {File: file, Size: int64(len(archive)), SHA256: hex.EncodeToString(sum[:]), Entry: "bin/codex-app-server.exe"}}}, key)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/downloads/tools/aidex.json":
			w.Write(signed)
		case "/downloads/tools/" + file:
			w.Write(archive)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func useReleaseKey(t *testing.T) ed25519.PrivateKey {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	old := release.PublicKey
	release.PublicKey = pub
	t.Cleanup(func() { release.PublicKey = old })
	return priv
}

func waitAIdex(t *testing.T, c *consoleClient) map[string]any {
	for end := time.Now().Add(10 * time.Second); time.Now().Before(end); time.Sleep(20 * time.Millisecond) {
		var st map[string]any
		c.do("GET", "/api/aidex", nil, 200, &st)
		if st["state"] != "updating" {
			return st
		}
	}
	t.Fatal("update did not finish")
	return nil
}

func TestConsoleUpdatesAIdexFromOfficialSite(t *testing.T) {
	key := useReleaseKey(t)
	f := setupCommunity(t)
	f.s.downloads = t.TempDir()
	oldOfficial := officialSite
	t.Cleanup(func() { officialSite = oldOfficial })
	archive := []byte("linkme-aidex test archive v1")
	officialSite = fakeOfficial(t, key, "0.169.1", archive).URL
	c := f.console()

	var st map[string]any
	c.do("GET", "/api/aidex?check=1", nil, 200, &st)
	if st["published"] != false || st["official"] != "0.169.1" {
		t.Fatal("before update", st)
	}
	// Clients see nothing until the server publishes a version.
	if resp, _ := http.Get(f.url + "/downloads/tools/aidex.json"); resp.StatusCode != 404 {
		t.Fatal("manifest served before update", resp.StatusCode)
	}
	c.do("POST", "/api/aidex/update", nil, 200, nil)
	if st = waitAIdex(t, c); st["state"] != "done" || st["version"] != "0.169.1" || st["published"] != true {
		t.Fatal("after update", st)
	}
	// Clients download from this server: manifest and archive, nothing else.
	resp, err := http.Get(f.url + "/downloads/tools/aidex.json")
	if err != nil || resp.StatusCode != 200 {
		t.Fatal("manifest", err)
	}
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if m, err := release.Verify(raw, aiagent.AIdexName); err != nil || m.Version != "0.169.1" {
		t.Fatal("published manifest", err)
	}
	resp, _ = http.Get(f.url + "/downloads/tools/linkme-aidex-0.169.1-windows-amd64.tar.zst")
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(body) != string(archive) {
		t.Fatal("archive not served")
	}
	for _, bad := range []string{"/downloads/tools/../welink.json", "/downloads/tools/aidex.json.download", "/downloads/tools/other.exe"} {
		if resp, _ = http.Get(f.url + bad); resp.StatusCode != 404 {
			t.Fatal("served", bad, resp.StatusCode)
		}
	}

	// A newer official version replaces the old archive.
	officialSite = fakeOfficial(t, key, "0.170.0", []byte("linkme-aidex test archive v2")).URL
	c.do("POST", "/api/aidex/update", nil, 200, nil)
	if st = waitAIdex(t, c); st["version"] != "0.170.0" {
		t.Fatal("not updated", st)
	}
	if _, err = os.Stat(filepath.Join(f.s.downloads, "tools", "linkme-aidex-0.169.1-windows-amd64.tar.zst")); !os.IsNotExist(err) {
		t.Fatal("old archive kept")
	}

	// A release signed by anyone else is refused and changes nothing.
	_, other, _ := ed25519.GenerateKey(rand.Reader)
	officialSite = fakeOfficial(t, other, "9.9.9", []byte("evil")).URL
	c.do("POST", "/api/aidex/update", nil, 200, nil)
	if st = waitAIdex(t, c); st["state"] != "failed" || !strings.Contains(st["error"].(string), "签名") || st["version"] != "0.170.0" {
		t.Fatal("forged release", st)
	}
}

func TestConsoleUpdatesClientAppsFromOfficialSite(t *testing.T) {
	key := useReleaseKey(t)
	f := setupCommunity(t)
	f.s.downloads = t.TempDir()
	oldOfficial := officialSite
	t.Cleanup(func() { officialSite = oldOfficial })
	setup, apk := []byte("MZ new windows installer"), []byte("PK\x03\x04 new android app")
	files := map[string][]byte{"LinkMe-Setup.exe": setup, "LinkMe-Android.apk": apk}
	packages := map[string]release.File{}
	for platform, name := range map[string]string{"windows/amd64": "LinkMe-Setup.exe", "android/arm64": "LinkMe-Android.apk"} {
		sum := sha256.Sum256(files[name])
		packages[platform] = release.File{File: name, Size: int64(len(files[name])), SHA256: hex.EncodeToString(sum[:])}
	}
	signed, _ := release.Sign(release.Manifest{Name: "linkme-app", Version: "0.1.20", Packages: packages}, key)
	official := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/downloads/")
		if name == "app.json" {
			w.Write(signed)
		} else if body, ok := files[name]; ok {
			w.Write(body)
		} else {
			http.NotFound(w, r)
		}
	}))
	defer official.Close()
	officialSite = official.URL
	c := f.console()
	c.do("POST", "/api/app-release/update", nil, 200, nil)
	var st map[string]any
	for end := time.Now().Add(10 * time.Second); time.Now().Before(end); time.Sleep(20 * time.Millisecond) {
		c.do("GET", "/api/app-release", nil, 200, &st)
		if st["state"] != "updating" {
			break
		}
	}
	if st["state"] != "done" || st["version"] != "0.1.20" {
		t.Fatal("app release", st)
	}
	resp, _ := http.Get(f.url + "/downloads/app.json")
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if m, err := release.Verify(raw, "linkme-app"); err != nil || m.Version != "0.1.20" {
		t.Fatal("published app manifest", err)
	}
	sums, _ := os.ReadFile(filepath.Join(f.s.downloads, "SHA256SUMS.txt"))
	if !strings.Contains(string(sums), "LinkMe-Setup.exe") || !strings.Contains(string(sums), "LinkMe-Android.apk") {
		t.Fatal("download page checksums not refreshed", string(sums))
	}
	// A hand-uploaded installer is not the signed release: clients must stop
	// self-updating from this server.
	resp, body := c.raw("PUT", "/api/downloads/LinkMe-Setup.exe", strings.NewReader("MZ"+strings.Repeat("custom build ", 200)), true)
	if resp.StatusCode != 200 {
		t.Fatal("upload", resp.StatusCode, string(body))
	}
	if resp, _ = http.Get(f.url + "/downloads/app.json"); resp.StatusCode != 404 {
		t.Fatal("signed manifest still published after manual upload")
	}
}
