package server

import (
	"database/sql"
	"net/http"
)

// A receipt reports only the sender's delivery outcome. It never restores recalled
// or personally deleted content, even after the sender has left the conversation.
func (s *Server) messageReceipt(w http.ResponseWriter, r *http.Request) {
	clientID := r.PathValue("clientId")
	if len(clientID) < 8 || len(clientID) > 100 {
		fail(w, 400, "消息标识无效")
		return
	}
	var id, cid string
	err := s.db.QueryRow("SELECT id,conversation_id FROM messages WHERE sender=? AND client_id=?", uid(r), clientID).Scan(&id, &cid)
	if err == sql.ErrNoRows {
		ok(w, map[string]bool{"delivered": false})
		return
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, map[string]any{"delivered": true, "id": id, "conversationId": cid})
}
