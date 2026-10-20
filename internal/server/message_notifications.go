package server

import (
	"net/http"
	"strings"
)

// Resolve each live alert against current membership and mute/block settings.
// Old/removed/recalled messages must never leak through a queued native alert.
func (s *Server) messageNotification(w http.ResponseWriter, r *http.Request) {
	m, err := scanMessage(s.db.QueryRow(messageQuery+"WHERE m.id=? AND "+messageVisible, r.PathValue("id"), uid(r)))
	if err != nil || m.Recalled || m.Sender == uid(r) {
		w.WriteHeader(204)
		return
	}
	var kind, name string
	var muted bool
	err = s.db.QueryRow("SELECT c.kind,c.name,x.muted FROM conversations c JOIN members x ON x.conversation_id=c.id WHERE c.id=? AND x.user_id=?", m.ConversationID, uid(r)).Scan(&kind, &name, &muted)
	if err != nil {
		w.WriteHeader(204)
		return
	}
	mention := false
	for _, id := range m.MentionRecipients {
		if id == uid(r) {
			mention = true
		}
	}
	if muted && !mention {
		w.WriteHeader(204)
		return
	}
	if kind == "direct" {
		if !contactAllowed(s.db, uid(r), m.Sender) {
			w.WriteHeader(204)
			return
		}
		var blocked bool
		if err = s.db.QueryRow("SELECT EXISTS(SELECT 1 FROM message_blocks WHERE user_id=? AND peer_id=?)", uid(r), m.Sender).Scan(&blocked); err != nil {
			s.dbError(w, err)
			return
		}
		if blocked {
			w.WriteHeader(204)
			return
		}
		name = m.Name
	}
	body := m.Text
	switch m.Kind {
	case "image":
		body = "[图片]"
	case "file":
		body = "[文件] " + m.FileName
	case "voice":
		body = "[语音]"
	case "video":
		body = "[视频]"
	case "forward":
		body = "[聊天记录]"
	case "meeting":
		body = "[会议邀请]"
	case "call":
		body = "[通话记录]"
	}
	if kind == "group" {
		body = m.Name + "：" + body
	}
	if mention {
		body = "有人 @你：" + body
	}
	clean := func(value string, limit int) string {
		value = strings.Join(strings.Fields(strings.ReplaceAll(value, "\x00", "")), " ")
		r := []rune(value)
		if len(r) > limit {
			return string(r[:limit]) + "…"
		}
		return value
	}
	ok(w, map[string]string{"conversationId": m.ConversationID, "messageId": m.ID, "title": clean(name, 64), "body": clean(body, 180)})
}
