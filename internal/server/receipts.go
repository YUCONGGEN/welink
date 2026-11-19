package server

import (
	"database/sql"
	"net/http"
)

// Read receipts come from members.read_seq, which every client already moves
// forward as it shows a conversation. A message counts for the members who
// were in the conversation when it was sent: member_joins remembers the last
// sequence before someone joined a group, so a newcomer, whose read position
// starts at the end, is not listed as having read the history before them.
const receiptSchema = `CREATE TABLE IF NOT EXISTS member_joins(conversation_id TEXT NOT NULL,user_id TEXT NOT NULL,joined_seq INTEGER NOT NULL,PRIMARY KEY(conversation_id,user_id));`

type memberRead struct {
	UserID string `json:"userId"`
	Seq    int64  `json:"seq"`
	Joined int64  `json:"joined"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
}

// conversationReads lists how far every other member has read, which the
// client turns into 已读 / N 人未读 for the caller's own messages and keeps
// current from "read" events.
func (s *Server) conversationReads(w http.ResponseWriter, r *http.Request) {
	if !s.requireMember(w, r) {
		return
	}
	rows, e := s.db.Query(`SELECT x.user_id,x.read_seq,COALESCE(j.joined_seq,0),COALESCE(NULLIF(g.nickname,''),u.name),u.avatar FROM members x JOIN users u ON u.id=x.user_id LEFT JOIN member_joins j ON j.conversation_id=x.conversation_id AND j.user_id=x.user_id LEFT JOIN group_members g ON g.conversation_id=x.conversation_id AND g.user_id=x.user_id WHERE x.conversation_id=? AND x.user_id<>? ORDER BY u.name`, r.PathValue("id"), uid(r))
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []memberRead{}
	for rows.Next() {
		var m memberRead
		if e = rows.Scan(&m.UserID, &m.Seq, &m.Joined, &m.Name, &m.Avatar); e != nil {
			s.dbError(w, e)
			return
		}
		// The assistant reads nothing, so it would show every message unread.
		if !s.isAI(m.UserID) {
			out = append(out, m)
		}
	}
	if e = rows.Err(); e != nil {
		s.dbError(w, e)
		return
	}
	ok(w, out)
}

func recordJoin(tx *sql.Tx, cid, user string) error {
	_, e := tx.Exec("INSERT OR REPLACE INTO member_joins(conversation_id,user_id,joined_seq) VALUES(?,?,COALESCE((SELECT MAX(seq) FROM messages WHERE conversation_id=?),0))", cid, user, cid)
	return e
}
