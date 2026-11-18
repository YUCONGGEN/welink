// Package release describes signed LinkMe downloads (the linkme-AIdex
// component, and app updates) that a LinkMe server hosts for its clients.
//
// The official LinkMe release signs a manifest with an Ed25519 key that never
// leaves the release machine. Clients and servers carry the public key below,
// so a server (self-hosted or not) can mirror the files but cannot change
// what clients run: the manifest signature and each file's SHA-256 are
// checked before anything is installed.
package release

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// PublicKey verifies official LinkMe manifests.
var PublicKey = mustKey("POXOcMnfs43LqQLNJsA4LmaJr3LIDv+s0lTLuRGc6ro=")

func mustKey(s string) ed25519.PublicKey {
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil || len(raw) != ed25519.PublicKeySize {
		panic("invalid release public key")
	}
	return raw
}

// File is one downloadable package for one platform ("windows/amd64").
type File struct {
	File   string `json:"file"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
	Entry  string `json:"entry,omitempty"` // program inside an archive
}

type Manifest struct {
	Name     string          `json:"name"` // e.g. "linkme-aidex"
	Version  string          `json:"version"`
	Packages map[string]File `json:"packages"`
}

// Signed is the published form: the manifest JSON as signed, and its signature.
type Signed struct {
	Payload   string `json:"payload"`
	Signature string `json:"signature"`
}

var (
	versionPattern = regexp.MustCompile(`^[0-9]{1,6}(\.[0-9]{1,6}){1,3}$`)
	filePattern    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.-]{0,120}\.(tar\.zst|exe|apk|zip)$`)
)

// Verify checks the signature and contents of a published manifest.
func Verify(raw []byte, name string) (Manifest, error) {
	return verify(raw, name, PublicKey)
}

func verify(raw []byte, name string, key ed25519.PublicKey) (Manifest, error) {
	var s Signed
	var m Manifest
	if len(raw) > 64<<10 || json.Unmarshal(raw, &s) != nil {
		return m, errors.New("更新清单格式无效")
	}
	sig, err := base64.StdEncoding.DecodeString(s.Signature)
	if err != nil || !ed25519.Verify(key, []byte(s.Payload), sig) {
		return m, errors.New("更新清单签名无效")
	}
	if json.Unmarshal([]byte(s.Payload), &m) != nil || m.Name != name || !versionPattern.MatchString(m.Version) || len(m.Packages) == 0 || len(m.Packages) > 16 {
		return m, errors.New("更新清单内容无效")
	}
	for platform, f := range m.Packages {
		if len(platform) > 32 || !filePattern.MatchString(f.File) || f.Size < 1 || f.Size > 2<<30 || len(f.SHA256) != 64 || strings.Trim(f.SHA256, "0123456789abcdef") != "" || strings.Contains(f.Entry, "..") || strings.HasPrefix(f.Entry, "/") {
			return m, errors.New("更新清单内容无效")
		}
	}
	return m, nil
}

// Sign produces the published form (used by the release tool).
func Sign(m Manifest, key ed25519.PrivateKey) ([]byte, error) {
	payload, err := json.Marshal(m)
	if err != nil {
		return nil, err
	}
	return json.MarshalIndent(Signed{Payload: string(payload), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload))}, "", "  ")
}

// Newer reports whether version a is newer than b ("" is oldest).
func Newer(a, b string) bool {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	if a == "" {
		return false
	}
	if b == "" {
		return true
	}
	for i := 0; i < max(len(pa), len(pb)); i++ {
		var x, y int
		if i < len(pa) {
			x, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			y, _ = strconv.Atoi(pb[i])
		}
		if x != y {
			return x > y
		}
	}
	return false
}

// Fetch downloads a small file (a manifest) from url.
func Fetch(ctx context.Context, client *http.Client, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("无法连接 %s", req.URL.Host)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, os.ErrNotExist
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("%s 返回 %d", req.URL.Host, resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 64<<10))
}

// Download saves url to target, failing unless size and SHA-256 match f.
func Download(ctx context.Context, client *http.Client, url, target string, f File, progress func(done, total int64)) error {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("无法连接 %s", req.URL.Host)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("%s 返回 %d", req.URL.Host, resp.StatusCode)
	}
	out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	hash := sha256.New()
	var done int64
	buf := make([]byte, 256<<10)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if done+int64(n) > f.Size {
				out.Close()
				return errors.New("文件大小不符")
			}
			if _, err = out.Write(buf[:n]); err != nil {
				out.Close()
				return err
			}
			hash.Write(buf[:n])
			done += int64(n)
			if progress != nil {
				progress(done, f.Size)
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			out.Close()
			return fmt.Errorf("下载中断：%v", readErr)
		}
	}
	if err = out.Close(); err != nil {
		return err
	}
	if done != f.Size || hex.EncodeToString(hash.Sum(nil)) != f.SHA256 {
		return errors.New("文件校验失败")
	}
	return nil
}
