package server

import (
	"net/http"
	"regexp"
	"strings"
	"welink/internal/publicweb"
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
	if err := publicweb.Render(w, publicweb.Page{Kind: "meeting", Title: "WeLink 会议邀请", Code: code, DisplayCode: code[:3] + " " + code[3:6] + " " + code[6:], DownloadURL: strings.TrimRight(s.settings.DownloadURL, "/")}); err != nil {
		s.logger.Printf("render meeting invitation: %v", err)
	}
}
