package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"image"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"

	"welink/internal/publicweb"

	_ "image/jpeg" // uploaded icons may be JPEG

	xdraw "golang.org/x/image/draw"
)

// Branding lets an organisation show its own product name and icon. The name
// lives in settings (branding.name) and changes take effect immediately; the
// icon is a 256×256 PNG kept in <data_dir>/branding/icon.png.

const defaultAppName = "LinkMe"

type brandState struct {
	mu      sync.RWMutex
	name    string
	version string // short hash of the icon, "" when the default icon is used
}

func (s *Server) appName() string {
	s.brand.mu.RLock()
	defer s.brand.mu.RUnlock()
	if s.brand.name == "" {
		return defaultAppName
	}
	return s.brand.name
}

func (s *Server) brandIconVersion() string {
	s.brand.mu.RLock()
	defer s.brand.mu.RUnlock()
	return s.brand.version
}

func (s *Server) brandIconPath() string { return filepath.Join(s.dir, "branding", "icon.png") }

// loadBrand reads the configured name and the stored icon at startup.
func (s *Server) loadBrand() {
	s.brand.mu.Lock()
	defer s.brand.mu.Unlock()
	s.brand.name = strings.TrimSpace(s.settings.Branding.Name)
	s.brand.version = ""
	if raw, err := os.ReadFile(s.brandIconPath()); err == nil {
		sum := sha256.Sum256(raw)
		s.brand.version = hex.EncodeToString(sum[:6])
	}
}

func validAppName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 24 || !validText(name, 24) || strings.ContainsAny(name, "<>\"'&") || strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return errors.New("软件名称需要 1–24 个字符，不能包含 < > \" ' &")
	}
	return nil
}

// GET /api/branding (public): what clients and pages should display.
func (s *Server) publicBranding(w http.ResponseWriter, r *http.Request) {
	ok(w, map[string]any{"name": s.appName(), "icon": s.brandIconVersion() != "", "iconVersion": s.brandIconVersion()})
}

// GET /api/branding/icon (public): the uploaded icon, 404 when none.
func (s *Server) brandIcon(w http.ResponseWriter, r *http.Request) {
	raw, err := os.ReadFile(s.brandIconPath())
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_, _ = w.Write(raw)
}

func (s *Server) consoleBranding(w http.ResponseWriter, r *http.Request, _ consoleActor) {
	ok(w, map[string]any{"name": s.appName(), "default": defaultAppName, "icon": s.brandIconVersion() != "", "iconVersion": s.brandIconVersion()})
}

// PUT /api/branding {name}: saved to the settings file and applied at once.
func (s *Server) consoleSaveBranding(w http.ResponseWriter, r *http.Request, a consoleActor) {
	var p struct{ Name string }
	if !decode(w, r, &p) {
		return
	}
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		p.Name = defaultAppName
	}
	if err := validAppName(p.Name); err != nil {
		fail(w, 400, err.Error())
		return
	}
	settings, err := s.fileSettings()
	if err != nil {
		fail(w, 409, "配置文件当前无效，请先在“系统设置”中修正："+err.Error())
		return
	}
	if p.Name == defaultAppName {
		settings.Branding.Name = ""
	} else {
		settings.Branding.Name = p.Name
	}
	if s.configPath != "" {
		if err = s.saveSettingsFile(settings); err != nil {
			s.dbError(w, err)
			return
		}
	}
	// Keep the running settings in step so this alone needs no restart.
	s.settings.Branding.Name = settings.Branding.Name
	s.loadBrand()
	_ = s.audit(nil, a, "save-brand-name", "", p.Name)
	s.brandChanged()
	s.consoleBranding(w, r, a)
}

// PUT /api/branding/icon (raw PNG or JPEG body): cropped to a centred square
// and scaled to 256×256.
func (s *Server) consoleUploadBrandIcon(w http.ResponseWriter, r *http.Request, a consoleActor) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4<<20))
	if err != nil {
		fail(w, 413, "图标文件不能超过 4 MB")
		return
	}
	src, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		fail(w, 400, "请上传 PNG 或 JPG 图片")
		return
	}
	b := src.Bounds()
	if b.Dx() < 64 || b.Dy() < 64 {
		fail(w, 400, "图标至少需要 64×64 像素，建议 512×512")
		return
	}
	side := min(b.Dx(), b.Dy())
	crop := image.Rect(b.Min.X+(b.Dx()-side)/2, b.Min.Y+(b.Dy()-side)/2, 0, 0)
	crop.Max = crop.Min.Add(image.Pt(side, side))
	icon := image.NewNRGBA(image.Rect(0, 0, 256, 256))
	xdraw.CatmullRom.Scale(icon, icon.Rect, src, crop, xdraw.Over, nil)
	var out bytes.Buffer
	if err = png.Encode(&out, icon); err == nil {
		err = writeFileAtomic(s.brandIconPath(), out.Bytes(), 0644)
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.loadBrand()
	_ = s.audit(nil, a, "upload-brand-icon", "", "")
	s.brandChanged()
	s.consoleBranding(w, r, a)
}

func (s *Server) consoleDeleteBrandIcon(w http.ResponseWriter, r *http.Request, a consoleActor) {
	if err := os.Remove(s.brandIconPath()); err != nil && !os.IsNotExist(err) {
		s.dbError(w, err)
		return
	}
	s.loadBrand()
	_ = s.audit(nil, a, "reset-brand-icon", "", "")
	s.brandChanged()
	s.consoleBranding(w, r, a)
}

// brandChanged tells every connected client to refresh its name and icon.
func (s *Server) brandChanged() {
	s.mu.Lock()
	ids := make([]string, 0, len(s.clients))
	for id := range s.clients {
		ids = append(ids, id)
	}
	s.mu.Unlock()
	s.push(ids, "branding", map[string]any{"name": s.appName(), "icon": s.brandIconVersion() != "", "iconVersion": s.brandIconVersion()})
}

// brandPage fills a public page with the server's name and icon.
func (s *Server) brandPage(p publicweb.Page) publicweb.Page {
	p.AppName = s.appName()
	if v := s.brandIconVersion(); v != "" {
		p.BrandIcon = "/api/branding/icon?v=" + v
	}
	return p
}
