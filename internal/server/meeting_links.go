package server

import (
	"fmt"
	"html/template"
	"net/http"
	"regexp"
	"strings"
)

var meetingLinkCode = regexp.MustCompile(`^[1-9][0-9]{8}$`)

func (s *Server) meetingInfo(w http.ResponseWriter, r *http.Request) {
	s.meetings.Lock()
	defer s.meetings.Unlock()
	room := s.meetings.rooms[r.PathValue("code")]
	if room == nil || room.CallID != "" || now() >= room.Expires {
		fail(w, 404, "会议不存在或已结束")
		return
	}
	ok(w, map[string]any{"code": room.Code, "title": room.Title, "count": len(room.Peers), "expires": room.Expires})
}
func (s *Server) meetingLink(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("code")
	if !meetingLinkCode.MatchString(code) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
	fmt.Fprintf(w, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WeLink 会议邀请</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(145deg,#eef7ff,#fff3f3);font:15px system-ui;color:#37465a}.card{width:min(92vw,480px);padding:36px;background:#fff;border:1px solid #e5eef7;border-radius:22px;text-align:center;box-shadow:0 16px 80px #30446412}b{color:#0099ff}h1{font-size:25px;margin:24px 0 12px}p{color:#8a98a9;line-height:1.9}.code{font-size:35px;letter-spacing:5px;margin:28px 0}button,a{font:inherit;border:0;border-radius:8px;text-decoration:none;cursor:pointer;padding:13px 20px;display:block;margin:12px 0;width:100%%}a{background:#0099ff;color:#fff}button{background:#eef6ff;color:#0099ff}small{font-size:12px;color:#8a98a9}.downloads{display:flex;gap:10px}.downloads a{font-size:12px;background:none;color:#6f88a2;padding:6px}</style><main class="card"><b>WeLink</b><h1>邀请你加入会议</h1><p>在 WeLink 登录后，确认加入会议。</p><div class="code">%s %s %s</div><a href="welink://meeting/%s">在 WeLink 中打开</a><button id="copy">复制邀请链接和会议号</button><small id="status">也可将链接或会议号粘贴到“加入会议”</small><div class="downloads"><a href="%s/downloads/WeLink-Setup.exe">下载 Windows 版</a><a href="%s/downloads/WeLink-Android.apk">下载 Android 版</a></div></main><script>document.getElementById('copy').onclick=function(){var text='邀请你加入 WeLink 会议\n会议号：%s %s %s\n会议链接：'+location.origin+'/join/%s';var input=document.createElement('textarea');input.value=text;document.body.appendChild(input);input.select();var copied=document.execCommand('copy');input.remove();document.getElementById('status').textContent=copied?'邀请链接和会议号已复制':'请复制上方会议号';};</script></html>`, code[:3], code[3:6], code[6:], code, template.HTMLEscapeString(strings.TrimRight(s.settings.DownloadURL, "/")), template.HTMLEscapeString(strings.TrimRight(s.settings.DownloadURL, "/")), code[:3], code[3:6], code[6:], code)
}
