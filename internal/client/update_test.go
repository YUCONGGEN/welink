package client

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"welink/internal/release"
	"welink/internal/version"
)

func signedServer(t *testing.T, key ed25519.PrivateKey, ver string, pkg []byte) *httptest.Server {
	sum := sha256.Sum256(pkg)
	platforms := map[string]release.File{}
	for _, p := range []string{"windows/amd64", "darwin/arm64", "linux/amd64", "android/arm64"} {
		platforms[p] = release.File{File: "LinkMe-Setup.exe", Size: int64(len(pkg)), SHA256: hex.EncodeToString(sum[:])}
	}
	signed, _ := release.Sign(release.Manifest{Name: AppName, Version: ver, Packages: platforms}, key)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/downloads/app.json":
			w.Write(signed)
		case "/downloads/LinkMe-Setup.exe":
			w.Write(pkg)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestAppUpdatesComeFromTheServerAndAreVerified(t *testing.T) {
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	old := release.PublicKey
	release.PublicKey = pub
	t.Cleanup(func() { release.PublicKey = old })
	newer := "9.0.0"
	pkg := []byte("MZ new LinkMe installer")
	srv := signedServer(t, key, newer, pkg)
	c, err := New(Options{Directory: t.TempDir(), Listen: "127.0.0.1:0", Server: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.checkAppUpdate()
	st := c.appUpdateStatus()
	if st["state"] != "ready" || st["latest"] != newer || st["current"] != version.App {
		t.Fatal("update not ready", st)
	}
	if raw, _ := os.ReadFile(c.update.path); string(raw) != string(pkg) {
		t.Fatal("downloaded package differs")
	}

	// The same or an older version is not offered.
	c2, _ := New(Options{Directory: t.TempDir(), Listen: "127.0.0.1:0", Server: signedServer(t, key, version.App, pkg).URL})
	defer c2.Close()
	c2.checkAppUpdate()
	if st := c2.appUpdateStatus(); st["state"] != "" {
		t.Fatal("current version offered as update", st)
	}

	// A manifest signed by someone else is refused, and nothing is downloaded.
	_, other, _ := ed25519.GenerateKey(rand.Reader)
	c3, _ := New(Options{Directory: t.TempDir(), Listen: "127.0.0.1:0", Server: signedServer(t, other, newer, pkg).URL})
	defer c3.Close()
	c3.checkAppUpdate()
	if st := c3.appUpdateStatus(); st["state"] != "failed" || c3.update.path != "" {
		t.Fatal("forged update accepted", st)
	}
	if _, err := c3.applyAppUpdate(); err == nil {
		t.Fatal("applied an update that was never verified")
	}
}
