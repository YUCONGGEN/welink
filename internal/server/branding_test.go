package server

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
)

func pngBytes(t *testing.T, w, h int) []byte {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetNRGBA(x, y, color.NRGBA{R: uint8(x), G: 120, B: 200, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestConsoleRenamesAndRebrandsTheApp(t *testing.T) {
	f := setupCommunity(t)
	f.s.configPath = filepath.Join(t.TempDir(), "config.json")
	if err := f.s.saveSettingsFile(f.s.settings); err != nil {
		t.Fatal(err)
	}
	c := f.console()
	var public struct {
		Name        string
		Icon        bool
		IconVersion string
	}
	f.request("GET", "/api/branding", "", nil, 200, &public)
	if public.Name != "LinkMe" || public.Icon {
		t.Fatal("default branding", public)
	}
	for _, bad := range []string{strings.Repeat("长", 25), "<script>", "a\nb"} {
		c.do("PUT", "/api/branding", map[string]string{"name": bad}, 400, nil)
	}
	c.do("PUT", "/api/branding", map[string]string{"name": "  云信通  "}, 200, nil)
	f.request("GET", "/api/branding", "", nil, 200, &public)
	if public.Name != "云信通" {
		t.Fatal("rename not live", public)
	}
	if saved, err := LoadSettings(f.s.configPath); err != nil || saved.Branding.Name != "云信通" {
		t.Fatal("rename not saved", err)
	}
	var cfg map[string]any
	f.request("GET", "/api/public-config", "", nil, 200, &cfg)
	if cfg["appName"] != "云信通" {
		t.Fatal("public config", cfg)
	}
	// Icons: decoded, centre-cropped to a square and stored at 256×256.
	resp, data := c.raw("PUT", "/api/branding/icon", bytes.NewReader([]byte("not an image")), true)
	if resp.StatusCode != 400 {
		t.Fatal("non-image accepted", resp.StatusCode, string(data))
	}
	resp, data = c.raw("PUT", "/api/branding/icon", bytes.NewReader(pngBytes(t, 600, 400)), true)
	if resp.StatusCode != 200 {
		t.Fatal("icon upload", resp.StatusCode, string(data))
	}
	f.request("GET", "/api/branding", "", nil, 200, &public)
	if !public.Icon || public.IconVersion == "" {
		t.Fatal("icon not reported", public)
	}
	got, err := http.Get(f.url + "/api/branding/icon")
	if err != nil {
		t.Fatal(err)
	}
	icon, err := png.Decode(got.Body)
	got.Body.Close()
	if err != nil || icon.Bounds().Dx() != 256 || icon.Bounds().Dy() != 256 {
		t.Fatal("stored icon", err)
	}
	page := mustGet(t, f.url+"/")
	if !strings.Contains(page, "<strong>云信通</strong>") || !strings.Contains(page, `src="/api/branding/icon?v=`+public.IconVersion) || !strings.Contains(page, "<title>云信通 · 即时通讯</title>") {
		t.Fatal("download page not branded")
	}
	// Back to defaults.
	c.do("DELETE", "/api/branding/icon", nil, 200, nil)
	c.do("PUT", "/api/branding", map[string]string{"name": ""}, 200, nil)
	f.request("GET", "/api/branding", "", nil, 200, &public)
	if public.Name != "LinkMe" || public.Icon {
		t.Fatal("reset", public)
	}
	if !strings.Contains(mustGet(t, f.url+"/"), "M/Link") {
		t.Fatal("default mark not restored")
	}
}
