package release

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"strings"
	"testing"
)

func TestSignedManifests(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	m := Manifest{Name: "linkme-aidex", Version: "0.169.1", Packages: map[string]File{"windows/amd64": {File: "linkme-aidex-0.169.1-windows-amd64.tar.zst", Size: 10, SHA256: strings.Repeat("ab", 32), Entry: "bin/codex-app-server.exe"}}}
	signed, err := Sign(m, priv)
	if err != nil {
		t.Fatal(err)
	}
	got, err := verify(signed, "linkme-aidex", pub)
	if err != nil || got.Version != "0.169.1" {
		t.Fatal(err, got)
	}
	if _, err = verify(signed, "linkme-app", pub); err == nil {
		t.Fatal("manifest accepted for another product")
	}
	if _, err = Verify(signed, "linkme-aidex"); err == nil {
		t.Fatal("manifest signed by another key accepted")
	}
	// Any change to the payload breaks the signature.
	var s Signed
	json.Unmarshal(signed, &s)
	s.Payload = strings.Replace(s.Payload, "0.169.1", "9.169.1", 1)
	tampered, _ := json.Marshal(s)
	if _, err = verify(tampered, "linkme-aidex", pub); err == nil || !strings.Contains(err.Error(), "签名") {
		t.Fatal("tampered manifest accepted", err)
	}
	// Signed but unsafe contents are still refused.
	m.Packages["windows/amd64"] = File{File: "../evil.exe", Size: 1, SHA256: strings.Repeat("ab", 32)}
	bad, _ := Sign(m, priv)
	if _, err = verify(bad, "linkme-aidex", pub); err == nil {
		t.Fatal("unsafe file name accepted")
	}
}

func TestNewer(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{{"0.170.0", "0.169.1", true}, {"0.169.10", "0.169.9", true}, {"0.169.1", "0.169.1", false}, {"1.0", "0.999.9", true}, {"0.169.1", "", true}, {"", "0.1", false}} {
		if Newer(c.a, c.b) != c.want {
			t.Fatal(c)
		}
	}
}
