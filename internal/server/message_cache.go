package server

import (
	"encoding/hex"
	"net/http"
	"strings"
)

// syncCachedMessages revalidates only IDs the client already cached. Missing
// results must be removed locally; this includes personal deletions and lost access.
func (s *Server) syncCachedMessages(w http.ResponseWriter, r *http.Request) {
	if !s.requireMember(w, r) {
		return
	}
	var input struct {
		IDs []string `json:"ids"`
	}
	if !decode(w, r, &input) {
		return
	}
	if len(input.IDs) == 0 || len(input.IDs) > 200 {
		fail(w, 400, "每次可核对 1–200 条缓存消息")
		return
	}
	ids := make([]string, 0, len(input.IDs))
	seen := make(map[string]bool)
	for _, id := range input.IDs {
		decoded, err := hex.DecodeString(id)
		if err != nil || len(decoded) != 16 {
			fail(w, 400, "消息标识无效")
			return
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	args := []any{r.PathValue("id"), uid(r), uid(r)}
	for _, id := range ids {
		args = append(args, id)
	}
	query := messageQuery + "WHERE m.conversation_id=? AND " + messageVisible +
		"AND EXISTS(SELECT 1 FROM members x WHERE x.conversation_id=m.conversation_id AND x.user_id=?) AND m.id IN (" + strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",") + ") ORDER BY m.seq"
	rows, err := s.db.Query(query, args...)
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer rows.Close()
	result := []Message{}
	for rows.Next() {
		message, err := scanMessage(rows)
		if err != nil {
			s.dbError(w, err)
			return
		}
		result = append(result, message)
	}
	if err = rows.Err(); err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, result)
}
