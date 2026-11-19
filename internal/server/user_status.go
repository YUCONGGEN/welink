package server

import (
	"net/http"
	"strings"
)

// Personal status, after Feishu: something the user sets ("请勿打扰", "忙碌",
// their own words, optionally until a time) and something the app sets while
// it happens (in a meeting, a call or remote assistance). The automatic one
// wins while it lasts.

const statusSchema = `CREATE TABLE IF NOT EXISTS user_statuses(user_id TEXT PRIMARY KEY,manual TEXT NOT NULL DEFAULT '',text TEXT NOT NULL DEFAULT '',until INTEGER NOT NULL DEFAULT 0,auto TEXT NOT NULL DEFAULT '',updated INTEGER NOT NULL);`

var manualStatus = map[string]string{"": "", "busy": "忙碌", "dnd": "请勿打扰", "away": "暂时离开", "leave": "休假中", "custom": ""}
var autoStatus = map[string]string{"": "", "meeting": "会议中", "call": "通话中", "remote": "远程协助中"}

type UserStatus struct {
	Status string `json:"status"`
	Label  string `json:"label"`
	Text   string `json:"text,omitempty"`
	Until  int64  `json:"until,omitempty"`
	Manual string `json:"manual,omitempty"`
	DND    bool   `json:"dnd,omitempty"`
}

func readStatus(q rowQuery, user string) UserStatus {
	var manual, text, auto string
	var until int64
	_ = q.QueryRow("SELECT manual,text,until,auto FROM user_statuses WHERE user_id=?", user).Scan(&manual, &text, &until, &auto)
	if until > 0 && until <= now() {
		manual, text, until = "", "", 0
	}
	st := UserStatus{Manual: manual, Text: text, Until: until, DND: manual == "dnd"}
	switch {
	case auto != "":
		st.Status, st.Label = auto, autoStatus[auto]
	case manual == "custom":
		st.Status, st.Label = "custom", text
	case manual != "":
		st.Status, st.Label = manual, manualStatus[manual]
	}
	return st
}

func (s *Server) statuses(w http.ResponseWriter, r *http.Request) {
	ids := strings.Split(r.URL.Query().Get("ids"), ",")
	if len(ids) > 500 {
		ids = ids[:500]
	}
	out := map[string]UserStatus{}
	for _, id := range ids {
		if id = strings.TrimSpace(id); id != "" && len(id) <= 64 {
			if st := readStatus(s.db, id); st.Status != "" || id == uid(r) {
				out[id] = st
			}
		}
	}
	ok(w, out)
}

func (s *Server) setStatus(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Manual, Text, Auto *string
		Until              *int64
	}
	if !decode(w, r, &p) {
		return
	}
	me := uid(r)
	var manual, text, auto string
	var until int64
	_ = s.db.QueryRow("SELECT manual,text,until,auto FROM user_statuses WHERE user_id=?", me).Scan(&manual, &text, &until, &auto)
	if p.Manual != nil {
		if _, known := manualStatus[*p.Manual]; !known {
			fail(w, 400, "状态无效")
			return
		}
		manual, text, until = *p.Manual, "", 0
		if p.Text != nil {
			text = strings.TrimSpace(*p.Text)
		}
		if manual == "custom" && (text == "" || !validText(text, 30)) {
			fail(w, 400, "自定义状态需为 1–30 字")
			return
		}
		if manual != "custom" {
			text = ""
		}
		if p.Until != nil && *p.Until > now() {
			until = *p.Until
		}
	}
	if p.Auto != nil {
		if _, known := autoStatus[*p.Auto]; !known {
			fail(w, 400, "状态无效")
			return
		}
		auto = *p.Auto
	}
	if _, err := s.db.Exec("INSERT INTO user_statuses(user_id,manual,text,until,auto,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET manual=excluded.manual,text=excluded.text,until=excluded.until,auto=excluded.auto,updated=excluded.updated", me, manual, text, until, auto, now()); err != nil {
		s.dbError(w, err)
		return
	}
	st := readStatus(s.db, me)
	s.notifyStatus(me, st)
	ok(w, st)
}

// notifyStatus tells the user's friends, the people they chat with directly
// and their other devices.
func (s *Server) notifyStatus(id string, st UserStatus) {
	seen := map[string]bool{id: true}
	targets := []string{id}
	rows, err := s.db.Query("SELECT peer_id FROM directory_friends WHERE user_id=? UNION SELECT m.user_id FROM members m JOIN conversations c ON c.id=m.conversation_id AND c.kind='direct' JOIN members me ON me.conversation_id=c.id AND me.user_id=?", id, id)
	if err == nil {
		for rows.Next() {
			var peer string
			if rows.Scan(&peer) == nil && !seen[peer] {
				seen[peer] = true
				targets = append(targets, peer)
			}
		}
		rows.Close()
	}
	s.push(targets, "status", map[string]any{"userId": id, "status": st})
}
