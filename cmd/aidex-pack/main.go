// Command aidex-pack builds a linkme-AIdex release from official Codex
// app-server packages (github.com/openai/codex releases, the
// codex-app-server-package-<target>.tar.zst files): it keeps only what Me
// needs, repacks each platform as linkme-aidex-<version>-<platform>.tar.zst
// and writes aidex.json signed with the LinkMe release key.
//
//	go run ./cmd/aidex-pack -key ~/.linkme/aidex-signing.key -version 0.169.1 \
//	  -windows codex-app-server-package-x86_64-pc-windows-msvc.tar.zst \
//	  -mac codex-app-server-package-aarch64-apple-darwin.tar.zst -out dist/tools
//
// Upload the output to the official site's downloads/tools/; servers then
// update from there in the management console.
package main

import (
	"archive/tar"
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/klauspost/compress/zstd"
	"welink/internal/aiagent"
	"welink/internal/release"
)

type platform struct {
	key, suffix, entry string
	keep               []string
}

var platforms = map[string]platform{
	"windows": {"windows/amd64", "windows-amd64", "bin/codex-app-server.exe", []string{"bin/codex-app-server.exe", "codex-resources/codex-command-runner.exe", "codex-resources/codex-windows-sandbox-setup.exe", "codex-path/rg.exe", "codex-package.json"}},
	"mac":     {"darwin/arm64", "darwin-arm64", "bin/codex-app-server", []string{"bin/codex-app-server", "codex-path/rg", "codex-package.json"}},
}

func main() {
	keyPath := flag.String("key", "", "base64 Ed25519 private key")
	version := flag.String("version", "", "Codex version, e.g. 0.169.1")
	out := flag.String("out", "dist/tools", "output directory")
	sources := map[string]*string{"windows": flag.String("windows", "", "official Windows x64 package"), "mac": flag.String("mac", "", "official macOS arm64 package")}
	flag.Parse()
	rawKey, err := os.ReadFile(*keyPath)
	if err != nil {
		log.Fatal(err)
	}
	keyBytes, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(rawKey)))
	if err != nil || len(keyBytes) != ed25519.PrivateKeySize {
		log.Fatal("invalid signing key")
	}
	key := ed25519.PrivateKey(keyBytes)
	if !key.Public().(ed25519.PublicKey).Equal(release.PublicKey) {
		log.Fatal("signing key does not match release.PublicKey")
	}
	if err = os.MkdirAll(*out, 0755); err != nil {
		log.Fatal(err)
	}
	m := release.Manifest{Name: aiagent.AIdexName, Version: *version, Packages: map[string]release.File{}}
	for name, src := range sources {
		if *src == "" {
			continue
		}
		p := platforms[name]
		file := fmt.Sprintf("%s-%s-%s.tar.zst", aiagent.AIdexName, *version, p.suffix)
		size, sum, err := repack(*src, filepath.Join(*out, file), p.keep)
		if err != nil {
			log.Fatalf("%s: %v", name, err)
		}
		m.Packages[p.key] = release.File{File: file, Size: size, SHA256: sum, Entry: p.entry}
		fmt.Printf("%s  %.1f MB  %s\n", file, float64(size)/1048576, sum)
	}
	signed, err := release.Sign(m, key)
	if err != nil {
		log.Fatal(err)
	}
	if _, err = release.Verify(signed, aiagent.AIdexName); err != nil {
		log.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(*out, aiagent.AIdexManifest), signed, 0644); err != nil {
		log.Fatal(err)
	}
	fmt.Println("wrote", filepath.Join(*out, aiagent.AIdexManifest))
}

func repack(src, dst string, keep []string) (int64, string, error) {
	in, err := os.Open(src)
	if err != nil {
		return 0, "", err
	}
	defer in.Close()
	z, err := zstd.NewReader(in, zstd.WithDecoderMaxWindow(1<<31))
	if err != nil {
		return 0, "", err
	}
	defer z.Close()
	files := map[string][]byte{}
	t := tar.NewReader(z)
	for {
		h, err := t.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return 0, "", err
		}
		for _, k := range keep {
			if h.Name == k && h.Typeflag == tar.TypeReg {
				if files[k], err = io.ReadAll(t); err != nil {
					return 0, "", err
				}
			}
		}
	}
	var buf bytes.Buffer
	w, _ := zstd.NewWriter(&buf, zstd.WithEncoderLevel(zstd.SpeedBestCompression), zstd.WithWindowSize(1<<26))
	tw := tar.NewWriter(w)
	for _, k := range keep {
		data, ok := files[k]
		if !ok {
			return 0, "", fmt.Errorf("package lacks %s", k)
		}
		mode := int64(0755)
		if strings.HasSuffix(k, ".json") {
			mode = 0644
		}
		if err = tw.WriteHeader(&tar.Header{Name: k, Mode: mode, Size: int64(len(data)), ModTime: time.Unix(0, 0), Typeflag: tar.TypeReg, Format: tar.FormatPAX}); err != nil {
			return 0, "", err
		}
		tw.Write(data)
	}
	if err = tw.Close(); err != nil {
		return 0, "", err
	}
	if err = w.Close(); err != nil {
		return 0, "", err
	}
	sum := sha256.Sum256(buf.Bytes())
	return int64(buf.Len()), hex.EncodeToString(sum[:]), os.WriteFile(dst, buf.Bytes(), 0644)
}
