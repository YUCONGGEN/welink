package server

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestLandingServesLinkMeDownloadsAndLegacyAliases(t *testing.T) {
	f := setup(t)
	f.s.downloads = t.TempDir()
	files := map[string]string{
		"LinkMe-Windows.exe":     "windows",
		"LinkMe-Setup.exe":       "setup",
		"LinkMe-Android.apk":     "android",
		"LinkMe-macOS-arm64.zip": "macos",
		"SHA256SUMS.txt":         "checksums",
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(f.s.downloads, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	paths := map[string]string{
		"/downloads/LinkMe-Windows.exe":     "windows",
		"/downloads/LinkMe-Setup.exe":       "setup",
		"/downloads/LinkMe-Android.apk":     "android",
		"/downloads/LinkMe-macOS-arm64.zip": "macos",
		"/downloads/SHA256SUMS.txt":         "checksums",
		"/downloads/WeLink-Windows.exe":     "windows",
		"/downloads/WeLink-Setup.exe":       "setup",
		"/downloads/WeLink-Android.apk":     "android",
	}
	for path, want := range paths {
		resp, err := f.server.Client().Get(f.url + path)
		if err != nil {
			t.Fatal(err)
		}
		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		if resp.StatusCode != http.StatusOK || string(body) != want {
			t.Errorf("GET %s: status=%d body=%q, want 200 %q", path, resp.StatusCode, body, want)
		}
	}
}

func TestHealthReportsCurrentRelease(t *testing.T) {
	f := setup(t)
	var result struct {
		OK      bool   `json:"ok"`
		Version string `json:"version"`
	}
	f.request("GET", "/health", "", nil, http.StatusOK, &result)
	if !result.OK || result.Version != "0.1.17" {
		t.Fatalf("unexpected health response: %+v", result)
	}
}
