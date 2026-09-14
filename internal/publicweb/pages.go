// Package publicweb renders the public download, meeting and file-share pages.
package publicweb

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"html/template"
	"net/http"

	"welink/internal/appearance"
)

//go:embed pages.html
var pageHTML string

//go:embed pages.css
var pageCSS string

//go:embed pages.js
var pageJS string

type Page struct {
	Kind         string
	Title        string
	Name         string
	Size         string
	Validity     string
	Code         string
	DisplayCode  string
	DownloadURL  string
	DriveGB      int64
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
var policy = "default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-" + base64.StdEncoding.EncodeToString(scriptDigest[:]) + "'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
var pages = template.Must(template.New("public").Funcs(template.FuncMap{
	// Only embedded, version-controlled CSS/JS bypass contextual escaping.
	"styles":  func() template.CSS { return template.CSS(appearance.CSS + "\n" + pageCSS) },
	"scripts": func() template.JS { return template.JS(scripts) },
}).Parse(pageHTML))

func Render(w http.ResponseWriter, page Page) error {
	var buffer bytes.Buffer
	if err := pages.Execute(&buffer, page); err != nil {
		return err
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", policy)
	_, err := w.Write(buffer.Bytes())
	return err
}
