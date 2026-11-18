package aiagent

import (
	"archive/tar"
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/klauspost/compress/zstd"
	"welink/internal/release"
)

// linkme-AIdex is Me's local task component: the open-source Codex
// app-server (github.com/openai/codex, Apache-2.0; notice in licenses.txt)
// with its Windows sandbox helpers and ripgrep, unmodified. It is not in the
// installer. Every LinkMe server hosts it under /downloads/tools/ with a
// manifest signed by the official release key; clients download and update
// it from their own server only, and maintainers refresh the server's copy
// from the official site in the management console.
const (
	AIdexName     = "linkme-aidex"
	AIdexManifest = "aidex.json"
)

// Platform is this computer's key in a release manifest.
func Platform() string { return runtime.GOOS + "/" + runtime.GOARCH }

// AIdexSupported reports whether linkme-AIdex exists for this computer.
func AIdexSupported() bool { return Platform() == "windows/amd64" || Platform() == "darwin/arm64" }

func aidexEntry() string {
	if runtime.GOOS == "windows" {
		return "bin/codex-app-server.exe"
	}
	return "bin/codex-app-server"
}

// AIdexFile reports whether name may be served from downloads/tools/.
func AIdexFile(name string) bool {
	if name == AIdexManifest {
		return true
	}
	v, ok := strings.CutPrefix(name, AIdexName+"-")
	if !ok {
		return false
	}
	for _, suffix := range []string{"-windows-amd64.tar.zst", "-darwin-arm64.tar.zst"} {
		if version, ok := strings.CutSuffix(v, suffix); ok && version != "" && strings.Trim(version, "0123456789.") == "" && !strings.Contains(version, "..") {
			return true
		}
	}
	return false
}

// InstalledCodex returns the downloaded linkme-AIdex program under root.
func InstalledCodex(root string) string { binary, _ := DownloadedCodex(root); return binary }

// DownloadedCodex returns the newest downloaded linkme-AIdex and its version.
// An older copy keeps working until an update has been installed.
func DownloadedCodex(root string) (binary, version string) {
	if root == "" || !AIdexSupported() {
		return "", ""
	}
	entries, _ := os.ReadDir(root)
	for _, e := range entries {
		v, ok := strings.CutPrefix(e.Name(), "aidex-")
		if !e.IsDir() || !ok || v == "" || strings.Trim(v, "0123456789.") != "" || !release.Newer(v, version) {
			continue
		}
		b := filepath.Join(root, e.Name(), filepath.FromSlash(aidexEntry()))
		if st, err := os.Stat(b); err == nil && st.Mode().IsRegular() {
			binary, version = b, v
		}
	}
	return binary, version
}

// FetchAIdexManifest reads and verifies the manifest a server hosts.
func FetchAIdexManifest(ctx context.Context, client *http.Client, server string) (release.Manifest, error) {
	raw, err := release.Fetch(ctx, client, strings.TrimRight(server, "/")+"/downloads/tools/"+AIdexManifest)
	if errors.Is(err, os.ErrNotExist) {
		return release.Manifest{}, errors.New("服务器尚未提供 linkme-AIdex，请联系管理员在后台更新")
	}
	if err != nil {
		return release.Manifest{}, err
	}
	return release.Verify(raw, AIdexName)
}

// InstallAIdex downloads this computer's package of a verified manifest from
// server and unpacks it into root/aidex-<version>, replacing older copies.
func InstallAIdex(ctx context.Context, root string, client *http.Client, server string, m release.Manifest, progress func(done, total int64)) error {
	f, ok := m.Packages[Platform()]
	if !ok || !AIdexFile(f.File) {
		return errors.New("服务器的 linkme-AIdex 不支持当前系统")
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return err
	}
	archive := filepath.Join(root, f.File+".download")
	defer os.Remove(archive)
	if err := release.Download(ctx, client, strings.TrimRight(server, "/")+"/downloads/tools/"+f.File, archive, f, progress); err != nil {
		if ctx.Err() != nil {
			return errors.New("已取消下载")
		}
		return errors.New("下载 linkme-AIdex 失败：" + err.Error())
	}
	return unpack(archive, root, m.Version)
}

// unpack extracts only regular files with clean relative paths into a
// temporary directory, then moves it into place in one rename.
func unpack(archive, root, version string) error {
	f, err := os.Open(archive)
	if err != nil {
		return err
	}
	defer f.Close()
	z, err := zstd.NewReader(f, zstd.WithDecoderConcurrency(1), zstd.WithDecoderMaxWindow(1<<27))
	if err != nil {
		return err
	}
	defer z.Close()
	final := filepath.Join(root, "aidex-"+version)
	staging := final + ".partial"
	_ = os.RemoveAll(staging)
	defer os.RemoveAll(staging)
	t := tar.NewReader(z)
	var total int64
	for {
		h, err := t.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return errors.New("组件包已损坏")
		}
		name := path.Clean(h.Name)
		if h.Typeflag != tar.TypeReg || name != h.Name || path.IsAbs(name) || strings.HasPrefix(name, "../") || name == ".." || strings.Contains(name, "\\") || strings.Contains(name, ":") {
			return errors.New("组件包内容无效")
		}
		if total += h.Size; total > 1<<30 {
			return errors.New("组件包过大")
		}
		target := filepath.Join(staging, filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0700)
		if err != nil {
			return err
		}
		if _, err = io.Copy(out, io.LimitReader(t, h.Size)); err != nil {
			out.Close()
			return err
		}
		if err = out.Close(); err != nil {
			return err
		}
	}
	if st, err := os.Stat(filepath.Join(staging, filepath.FromSlash(aidexEntry()))); err != nil || !st.Mode().IsRegular() {
		return errors.New("组件包缺少程序")
	}
	_ = os.RemoveAll(final)
	if err = os.Rename(staging, final); err != nil {
		return err
	}
	// Older copies are no longer used. One still running (an active task)
	// may refuse removal on Windows; it is retried after the next update.
	if entries, err := os.ReadDir(root); err == nil {
		for _, e := range entries {
			if e.IsDir() && strings.HasPrefix(e.Name(), "aidex-") && e.Name() != filepath.Base(final) {
				_ = os.RemoveAll(filepath.Join(root, e.Name()))
			}
		}
	}
	return nil
}
