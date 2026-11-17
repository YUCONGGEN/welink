// Package publicweb renders the public download, meeting and file-share pages.
package publicweb

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"html/template"
	"net/http"
	"strings"

	"welink/internal/appearance"
)

//go:embed pages.html
var pageHTML string

//go:embed pages.css
var pageCSS string

//go:embed pages.js
var pageJS string

type Page struct {
	Kind        string
	Title       string
	Name        string
	Size        string
	Validity    string
	Code        string
	DisplayCode string
	DownloadURL string
	DriveGB     int64
	// ConsoleURL links the management console from the header when it is public.
	ConsoleURL string
	// DeployGuide shows the self-hosting install guide. Only the server that
	// publishes the installers (the official site) shows it; a deployment
	// installed for an organisation never does.
	DeployGuide bool
	// AppName and BrandIcon come from the server's branding (default LinkMe).
	AppName      string
	BrandIcon    string
	Documents    []Document
	Content      string
	DocumentOpen bool
}

type Document struct {
	ID    string
	Title string
}

var scripts = appearance.JS + "\n" + pageJS
var scriptDigest = sha256.Sum256([]byte(scripts))
var policy = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'sha256-" + base64.StdEncoding.EncodeToString(scriptDigest[:]) + "'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
var pages = template.Must(template.New("public").Funcs(template.FuncMap{
	// Only embedded, version-controlled CSS/JS bypass contextual escaping.
	"styles":  func() template.CSS { return template.CSS(appearance.CSS + "\n" + pageCSS) },
	"scripts": func() template.JS { return template.JS(scripts) },
}).Parse(pageHTML))

func Render(w http.ResponseWriter, page Page) error {
	if page.AppName == "" {
		page.AppName = "LinkMe"
	} else if page.AppName != "LinkMe" {
		page.Title = strings.ReplaceAll(page.Title, "LinkMe", page.AppName)
	}
	var buffer bytes.Buffer
	if err := pages.Execute(&buffer, page); err != nil {
		return err
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", policy)
	_, err := w.Write(buffer.Bytes())
	return err
}
