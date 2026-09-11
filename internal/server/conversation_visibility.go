package server

import (
	"database/sql"
	"net/http"
)

const conversationVisibilitySchema = `CREATE TABLE IF NOT EXISTS hidden_conversations(user_id TEXT NOT NULL REFERENCES users(id),conversation_id TEXT NOT NULL REFERENCES conversations(id),after_seq INTEGER NOT NULL,PRIMARY KEY(user_id,conversation_id));`

func (s *Server) hideConversationID(w http.ResponseWriter, r *http.Request, id string) {
	if !s.member(id, uid(r)) {
		fail(w, 404, "会话不存在")
		return
	}
	_, err := s.db.Exec("INSERT INTO hidden_conversations(user_id,conversation_id,after_seq) VALUES(?,?,COALESCE((SELECT MAX(seq) FROM messages WHERE conversation_id=?),0)) ON CONFLICT(user_id,conversation_id) DO UPDATE SET after_seq=excluded.after_seq", uid(r), id, id)
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.push([]string{uid(r)}, "conversations", map[string]bool{"ok": true})
	ok(w, map[string]bool{"ok": true})
}
func (s *Server) hideConversation(w http.ResponseWriter, r *http.Request) {
	s.hideConversationID(w, r, r.PathValue("id"))
}
func (s *Server) hidePeerConversation(w http.ResponseWriter, r *http.Request) {
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	user, peer := uid(r), r.PathValue("user")
	// Removing a contact also removes it from the special-care list. Remarks and
	// chat history stay intact, including when this contact has never been chatted.
	if _, err = tx.Exec("DELETE FROM contact_attention WHERE user_id=? AND peer_id=?", user, peer); err != nil {
		s.dbError(w, err)
		return
	}
	var id string
	err = tx.QueryRow("SELECT c.id FROM conversations c JOIN members a ON a.conversation_id=c.id JOIN members b ON b.conversation_id=c.id WHERE c.kind='direct' AND a.user_id=? AND b.user_id=?", user, peer).Scan(&id)
	if err != nil && err != sql.ErrNoRows {
		s.dbError(w, err)
		return
	}
	if id != "" {
		if _, err = tx.Exec("INSERT INTO hidden_conversations(user_id,conversation_id,after_seq) VALUES(?,?,COALESCE((SELECT MAX(seq) FROM messages WHERE conversation_id=?),0)) ON CONFLICT(user_id,conversation_id) DO UPDATE SET after_seq=excluded.after_seq", user, id, id); err != nil {
			s.dbError(w, err)
			return
		}
	}
	if err = tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	s.push([]string{user}, "contacts", map[string]bool{"ok": true})
	ok(w, map[string]bool{"ok": true})
}
