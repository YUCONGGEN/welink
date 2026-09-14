package publicweb

import (
	"crypto/sha256"
	"encoding/base64"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPublicPagesKeepLinksAndEscapeContent(t *testing.T) {
	for _, page := range []Page{
		{Kind: "download", Title: "WeLink", DriveGB: 5},
		{Kind: "meeting", Title: "会议", Code: "123456789", DisplayCode: "123 456 789", DownloadURL: "http://example.com:8251"},
		{Kind: "share", Title: "分享", Name: `<script>alert("file")</script>.txt`, Size: "1.00 MB", Validity: "永久有效"},
		{Kind: "space", Title: "空间", Name: "同事", DocumentOpen: true, Content: `</pre><script>alert("content")</script>`},
		{Kind: "space", Title: "空间", Name: "空文档", DocumentOpen: true},
		{Kind: "space", Title: "空间", Documents: []Document{{ID: "abc", Title: `<img src=x onerror=alert(1)>`}}},
	} {
		t.Run(page.Kind+page.Name, func(t *testing.T) {
			w := httptest.NewRecorder()
			if err := Render(w, page); err != nil {
				t.Fatal(err)
			}
			html := w.Body.String()
			if strings.Contains(html, "#ZgotmplZ") || strings.Contains(html, `<script>alert`) || strings.Contains(html, `<img src=x`) {
				t.Fatal("unsafe or broken template output")
			}
			if strings.Count(html, "<script>") != 1 || !strings.Contains(html, `class="snowfall" aria-hidden="true"`) {
				t.Fatal("missing shared atmosphere")
			}
			start := strings.Index(html, "<script>") + len("<script>")
			end := strings.Index(html[start:], "</script>") + start
			digest := sha256.Sum256([]byte(html[start:end]))
			csp := w.Header().Get("Content-Security-Policy")
			if !strings.Contains(csp, "script-src 'sha256-"+base64.StdEncoding.EncodeToString(digest[:])+"'") || !strings.Contains(csp, "frame-ancestors 'none'") {
				t.Fatal("page scripts must be covered by the restrictive CSP")
			}
			if page.Kind == "meeting" && !strings.Contains(html, `href="welink://meeting/123456789"`) {
				t.Fatal("desktop app invitation is broken")
			}
			if page.Kind == "share" && (!strings.Contains(html, `href="?download=1"`) || !strings.Contains(html, "永久有效")) {
				t.Fatal("shared-file download is broken")
			}
			if page.Kind == "download" && (!strings.Contains(html, "/downloads/WeLink-Setup.exe") || !strings.Contains(html, "/downloads/WeLink-Android.apk") || !strings.Contains(html, "每人 5 GB")) {
				t.Fatal("missing client downloads or configured quota")
			}
		})
	}
}
