package aiagent

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/klauspost/compress/zstd"
	"welink/internal/release"
)

func testArchive(files map[string]string) []byte {
	var buf bytes.Buffer
	z, _ := zstd.NewWriter(&buf)
	tw := tar.NewWriter(z)
	for name, body := range files {
		tw.WriteHeader(&tar.Header{Name: name, Mode: 0755, Size: int64(len(body)), Typeflag: tar.TypeReg})
		tw.Write([]byte(body))
	}
	tw.Close()
	z.Close()
	return buf.Bytes()
}

// manifestFor serves data as this platform's package of version.
func manifestFor(t *testing.T, data []byte, version string) (release.Manifest, *httptest.Server) {
	if !AIdexSupported() {
		t.Skip("linkme-AIdex is not offered on this platform")
	}
	sum := sha256.Sum256(data)
	file := AIdexName + "-" + version + "-" + strings.ReplaceAll(Platform(), "/", "-") + ".tar.zst"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/downloads/tools/"+file {
			http.NotFound(w, r)
			return
		}
		w.Write(data)
	}))
	t.Cleanup(srv.Close)
	return release.Manifest{Name: AIdexName, Version: version, Packages: map[string]release.File{Platform(): {File: file, Size: int64(len(data)), SHA256: hex.EncodeToString(sum[:]), Entry: aidexEntry()}}}, srv
}

func TestInstallAIdexAndUpdate(t *testing.T) {
	root := t.TempDir()
	m, srv := manifestFor(t, testArchive(map[string]string{aidexEntry(): "#!old", "codex-path/rg": "rg"}), "1.2.0")
	var last int64
	if err := InstallAIdex(context.Background(), root, srv.Client(), srv.URL, m, func(done, total int64) { last = done }); err != nil || last != m.Packages[Platform()].Size {
		t.Fatal(err, last)
	}
	binary, version := DownloadedCodex(root)
	if raw, _ := os.ReadFile(binary); string(raw) != "#!old" || version != "1.2.0" {
		t.Fatal("not installed", binary, version)
	}
	if FindBinary(root) == "" {
		t.Fatal("downloaded copy not found")
	}
	// The server offers a newer version: it replaces the old copy.
	m2, srv2 := manifestFor(t, testArchive(map[string]string{aidexEntry(): "#!new"}), "1.10.0")
	if err := InstallAIdex(context.Background(), root, srv2.Client(), srv2.URL, m2, nil); err != nil {
		t.Fatal(err)
	}
	if _, version = DownloadedCodex(root); version != "1.10.0" {
		t.Fatal("update not used", version)
	}
	if entries, _ := os.ReadDir(root); len(entries) != 1 {
		t.Fatal("old copy or download left behind", entries)
	}
}

func TestInstallAIdexRejectsTamperedOrUnsafeArchives(t *testing.T) {
	root := t.TempDir()
	good := testArchive(map[string]string{aidexEntry(): "#!codex"})
	m, _ := manifestFor(t, good, "1.0.0")
	tampered := append([]byte(nil), good...)
	tampered[len(tampered)-1] ^= 1
	_, bad := manifestFor(t, tampered, "1.0.0")
	if err := InstallAIdex(context.Background(), root, bad.Client(), bad.URL, m, nil); err == nil || !strings.Contains(err.Error(), "校验失败") {
		t.Fatal("tampered archive accepted:", err)
	}
	evil := testArchive(map[string]string{"../escape.txt": "x", aidexEntry(): "#!codex"})
	me, esrv := manifestFor(t, evil, "1.0.1")
	if err := InstallAIdex(context.Background(), root, esrv.Client(), esrv.URL, me, nil); err == nil || !strings.Contains(err.Error(), "内容无效") {
		t.Fatal("path traversal accepted:", err)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(root), "escape.txt")); err == nil {
		t.Fatal("file escaped the tools directory")
	}
	if entries, _ := os.ReadDir(root); len(entries) != 0 {
		t.Fatal("rejected archive left files", entries)
	}
}

func TestAIdexFileNames(t *testing.T) {
	for _, ok := range []string{"aidex.json", "linkme-aidex-0.169.1-windows-amd64.tar.zst", "linkme-aidex-1.2-darwin-arm64.tar.zst"} {
		if !AIdexFile(ok) {
			t.Fatal("should serve", ok)
		}
	}
	for _, bad := range []string{"../welink.json", "linkme-aidex--windows-amd64.tar.zst", "linkme-aidex-1..2-windows-amd64.tar.zst", "codex-0.169.1-windows-amd64.tar.zst", "linkme-aidex-1.0-linux-amd64.tar.zst", "aidex.json.bak"} {
		if AIdexFile(bad) {
			t.Fatal("should not serve", bad)
		}
	}
}

func TestAIdexBypassesProxyForTheLinkMeServer(t *testing.T) {
	t.Setenv("NO_PROXY", "corp.local")
	got := directHosts("http://192.168.77.57:8250/api/ai/v1")
	for _, want := range []string{"corp.local", "192.168.77.57", "127.0.0.1"} {
		if !strings.Contains(","+got+",", ","+want+",") {
			t.Fatalf("NO_PROXY %q lacks %s", got, want)
		}
	}
}
