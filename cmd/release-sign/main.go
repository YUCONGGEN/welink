// Command release-sign writes a signed LinkMe release manifest for files
// that are already built, e.g. the client apps:
//
//	go run ./cmd/release-sign -key ~/.linkme/aidex-signing.key -name linkme-app \
//	  -version 0.1.19 -out dist/app.json \
//	  windows/amd64=dist/LinkMe-Setup.exe darwin/arm64=dist/LinkMe-macOS-arm64.zip \
//	  android/arm64=dist/LinkMe-Android.apk
//
// The manifest is published next to the files on the official site; LinkMe
// servers mirror both from the management console.
package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"welink/internal/release"
)

func main() {
	keyPath := flag.String("key", "", "base64 Ed25519 private key")
	name := flag.String("name", "linkme-app", "release name")
	version := flag.String("version", "", "release version")
	out := flag.String("out", "", "manifest path")
	flag.Parse()
	rawKey, err := os.ReadFile(*keyPath)
	if err != nil {
		log.Fatal(err)
	}
	keyBytes, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(rawKey)))
	if err != nil || len(keyBytes) != ed25519.PrivateKeySize || !ed25519.PrivateKey(keyBytes).Public().(ed25519.PublicKey).Equal(release.PublicKey) {
		log.Fatal("signing key does not match release.PublicKey")
	}
	m := release.Manifest{Name: *name, Version: *version, Packages: map[string]release.File{}}
	for _, arg := range flag.Args() {
		platform, path, ok := strings.Cut(arg, "=")
		if !ok {
			log.Fatalf("expected platform=path, got %q", arg)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			log.Fatal(err)
		}
		sum := sha256.Sum256(data)
		m.Packages[platform] = release.File{File: filepath.Base(path), Size: int64(len(data)), SHA256: hex.EncodeToString(sum[:])}
		fmt.Printf("%-14s %s %.1f MB\n", platform, filepath.Base(path), float64(len(data))/1048576)
	}
	signed, err := release.Sign(m, ed25519.PrivateKey(keyBytes))
	if err == nil {
		_, err = release.Verify(signed, *name)
	}
	if err == nil {
		err = os.WriteFile(*out, signed, 0644)
	}
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("wrote", *out)
}
