package server

import (
	"database/sql"
	"encoding/json"
	"unicode/utf16"
)

const mentionSchema = `
CREATE TABLE IF NOT EXISTS message_mentions(message_id TEXT PRIMARY KEY REFERENCES messages(id),data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS message_mention_recipients(message_id TEXT NOT NULL REFERENCES messages(id),user_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(message_id,user_id));
CREATE INDEX IF NOT EXISTS mention_recipient_lookup ON message_mention_recipients(user_id,message_id);
`

// Offsets use UTF-16 code units, matching native WebView textarea selection.
type Mention struct {
	UserID string `json:"userId"`
	Start  int    `json:"start"`
	End    int    `json:"end"`
}

func validateMentions(tx *sql.Tx, cid, sender, kind, text string, spans []Mention) ([]string, error) {
	if len(spans) == 0 {
		return nil, nil
	}
	if kind != "text" || len(spans) > 50 {
		return nil, groupFail(400, "每条文字消息最多添加 50 处 @提醒")
	}
	g, err := groupRequired(tx, cid, sender)
	if err != nil {
		return nil, groupFail(403, "只能在群聊中 @成员")
	}
	units := utf16.Encode([]rune(text))
	recipients := map[string]bool{}
	previous := 0
	for _, span := range spans {
		if span.Start < previous || span.End <= span.Start || span.End > len(units) || span.Start < 0 || (span.Start > 0 && utf16.IsSurrogate(rune(units[span.Start])) && units[span.Start] >= 0xdc00) || (span.End < len(units) && units[span.End] >= 0xdc00 && units[span.End] <= 0xdfff) {
			return nil, groupFail(400, "@提醒的位置无效")
		}
		previous = span.End
		var name string
		if span.UserID == "all" {
			if !g.manager() {
				return nil, groupFail(403, "只有群主和管理员可以 @全体成员")
			}
			name = "全体成员"
			rows, e := tx.Query("SELECT user_id FROM members WHERE conversation_id=?", cid)
			if e != nil {
				return nil, e
			}
			for rows.Next() {
				var id string
				if e = rows.Scan(&id); e != nil {
					rows.Close()
					return nil, e
				}
				recipients[id] = true
			}
			e = rows.Err()
			rows.Close()
			if e != nil {
				return nil, e
			}
		} else {
			if tx.QueryRow("SELECT COALESCE(NULLIF(g.nickname,''),u.name) FROM members m JOIN users u ON u.id=m.user_id LEFT JOIN group_members g ON g.conversation_id=m.conversation_id AND g.user_id=m.user_id WHERE m.conversation_id=? AND m.user_id=?", cid, span.UserID).Scan(&name) != nil {
				return nil, groupFail(400, "@的成员已不在群里，请重新选择")
			}
			recipients[span.UserID] = true
		}
		if string(utf16.Decode(units[span.Start:span.End])) != "@"+name {
			return nil, groupFail(400, "@成员名称已变化，请重新选择")
		}
	}
	delete(recipients, sender)
	out := make([]string, 0, len(recipients))
	for id := range recipients {
		out = append(out, id)
	}
	return out, nil
}

func saveMentions(tx *sql.Tx, id string, spans []Mention, recipients []string) error {
	if len(spans) == 0 {
		return nil
	}
	raw, err := json.Marshal(spans)
	if err != nil {
		return err
	}
	if _, err = tx.Exec("INSERT INTO message_mentions VALUES(?,?)", id, string(raw)); err != nil {
		return err
	}
	for _, user := range recipients {
		if _, err = tx.Exec("INSERT INTO message_mention_recipients VALUES(?,?)", id, user); err != nil {
			return err
		}
	}
	return nil
}

const mentionForUser = `EXISTS(SELECT 1 FROM message_mention_recipients mr WHERE mr.message_id=m.id AND mr.user_id=?) `

func (s *Server) unreadMentions(cid, user string) (count int, first string) {
	_ = s.db.QueryRow(`SELECT COUNT(*),COALESCE((SELECT m2.id FROM messages m2 JOIN message_mention_recipients mr2 ON mr2.message_id=m2.id WHERE m2.conversation_id=x.conversation_id AND mr2.user_id=x.user_id AND m2.seq>x.read_seq AND m2.recalled=0 AND NOT EXISTS(SELECT 1 FROM message_deletions d WHERE d.message_id=m2.id AND d.user_id=x.user_id) ORDER BY m2.seq LIMIT 1),'') FROM members x JOIN messages m ON m.conversation_id=x.conversation_id AND m.seq>x.read_seq JOIN message_mention_recipients mr ON mr.message_id=m.id AND mr.user_id=x.user_id WHERE x.conversation_id=? AND x.user_id=? AND m.recalled=0 AND NOT EXISTS(SELECT 1 FROM message_deletions d WHERE d.message_id=m.id AND d.user_id=x.user_id)`, cid, user).Scan(&count, &first)
	return
}
