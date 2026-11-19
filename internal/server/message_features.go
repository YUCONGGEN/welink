package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// Feishu-style message features: editing, reactions, pinned messages,
// urgent reminders, polls, sign-up lists (接龙) and threads. Each keeps its
// data in its own table keyed by message id, so the messages table and every
// existing reader stay unchanged.

const messageFeatureSchema = `
CREATE TABLE IF NOT EXISTS message_edits(message_id TEXT PRIMARY KEY,edited INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS message_reactions(message_id TEXT NOT NULL,user_id TEXT NOT NULL,emoji TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(message_id,user_id,emoji));
CREATE TABLE IF NOT EXISTS message_pins(conversation_id TEXT NOT NULL,message_id TEXT NOT NULL,user_id TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(conversation_id,message_id));
CREATE TABLE IF NOT EXISTS message_urgent(message_id TEXT NOT NULL,user_id TEXT NOT NULL,created INTEGER NOT NULL,acked INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(message_id,user_id));
CREATE INDEX IF NOT EXISTS message_urgent_user ON message_urgent(user_id,acked);
CREATE TABLE IF NOT EXISTS message_threads(message_id TEXT PRIMARY KEY,root_id TEXT NOT NULL,conversation_id TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS message_threads_root ON message_threads(root_id);
CREATE TABLE IF NOT EXISTS poll_votes(message_id TEXT NOT NULL,user_id TEXT NOT NULL,option INTEGER NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(message_id,user_id,option));
CREATE TABLE IF NOT EXISTS chain_entries(message_id TEXT NOT NULL,user_id TEXT NOT NULL,text TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(message_id,user_id));
CREATE TABLE IF NOT EXISTS message_translations(message_id TEXT NOT NULL,lang TEXT NOT NULL,text TEXT NOT NULL,PRIMARY KEY(message_id,lang));
`

const (
	recallWindow = 24 * time.Hour
	editWindow   = 24 * time.Hour
	maxPins      = 20
)

var reactionEmoji = map[string]bool{"👍": true, "👌": true, "❤️": true, "😂": true, "🎉": true, "🙏": true, "😮": true, "😢": true, "💪": true, "👏": true, "收到": true, "赞": true, "OK": true, "辛苦了": true}

type Reaction struct {
	Emoji string   `json:"emoji"`
	Users []string `json:"users"`
}
type UrgentInfo struct {
	Targets []string `json:"targets"`
	Acked   []string `json:"acked"`
}
type PollInfo struct {
	Counts []int            `json:"counts"`
	Votes  map[string][]int `json:"votes"`
}
type ChainEntry struct {
	UserID string `json:"userId"`
	Name   string `json:"name"`
	Text   string `json:"text"`
}
type ThreadInfo struct {
	Count int   `json:"count"`
	Last  int64 `json:"last"`
}
type pollSpec struct {
	Title   string   `json:"title"`
	Options []string `json:"options"`
	Multi   bool     `json:"multi"`
	Closed  bool     `json:"closed,omitempty"`
}
type chainSpec struct {
	Title string `json:"title"`
	Note  string `json:"note,omitempty"`
}

// structuredPreview is how polls, sign-ups and shared documents read in
// notifications, conversation lists and forwarded records.
func structuredPreview(kind, text string) (string, bool) {
	switch kind {
	case "poll":
		var p pollSpec
		_ = json.Unmarshal([]byte(text), &p)
		return "[投票] " + p.Title, true
	case "chain":
		var c chainSpec
		_ = json.Unmarshal([]byte(text), &c)
		return "[接龙] " + c.Title, true
	case "text":
		if i := strings.Index(text, "\n"+docMessageMarker); i > 0 && strings.HasPrefix(text, "[") {
			return text[:i], true
		}
	}
	return "", false
}

func placeholders(n int) string { return strings.TrimSuffix(strings.Repeat("?,", n), ",") }

// decorate attaches reactions, urgent state, poll results, sign-ups and
// thread counts to messages about to be returned.
func (s *Server) decorate(list []Message) {
	if len(list) == 0 {
		return
	}
	ids := make([]any, len(list))
	index := map[string]int{}
	for i, m := range list {
		ids[i] = m.ID
		index[m.ID] = i
	}
	in := "(" + placeholders(len(ids)) + ")"
	if rows, err := s.db.Query("SELECT message_id,emoji,user_id FROM message_reactions WHERE message_id IN "+in+" ORDER BY created", ids...); err == nil {
		for rows.Next() {
			var mid, emoji, user string
			if rows.Scan(&mid, &emoji, &user) != nil {
				continue
			}
			m := &list[index[mid]]
			found := false
			for i := range m.Reactions {
				if m.Reactions[i].Emoji == emoji {
					m.Reactions[i].Users = append(m.Reactions[i].Users, user)
					found = true
				}
			}
			if !found {
				m.Reactions = append(m.Reactions, Reaction{Emoji: emoji, Users: []string{user}})
			}
		}
		rows.Close()
	}
	if rows, err := s.db.Query("SELECT message_id,user_id,acked FROM message_urgent WHERE message_id IN "+in, ids...); err == nil {
		for rows.Next() {
			var mid, user string
			var acked int64
			if rows.Scan(&mid, &user, &acked) != nil {
				continue
			}
			m := &list[index[mid]]
			if m.Urgent == nil {
				m.Urgent = &UrgentInfo{Targets: []string{}, Acked: []string{}}
			}
			m.Urgent.Targets = append(m.Urgent.Targets, user)
			if acked > 0 {
				m.Urgent.Acked = append(m.Urgent.Acked, user)
			}
		}
		rows.Close()
	}
	for i := range list {
		m := &list[i]
		if m.Recalled {
			continue
		}
		switch m.Kind {
		case "poll":
			var spec pollSpec
			if json.Unmarshal([]byte(m.Text), &spec) == nil {
				m.Poll = &PollInfo{Counts: make([]int, len(spec.Options)), Votes: map[string][]int{}}
			}
		case "chain":
			m.Chain = []ChainEntry{}
		}
	}
	if rows, err := s.db.Query("SELECT message_id,user_id,option FROM poll_votes WHERE message_id IN "+in+" ORDER BY created", ids...); err == nil {
		for rows.Next() {
			var mid, user string
			var option int
			if rows.Scan(&mid, &user, &option) != nil {
				continue
			}
			if p := list[index[mid]].Poll; p != nil && option >= 0 && option < len(p.Counts) {
				p.Counts[option]++
				p.Votes[user] = append(p.Votes[user], option)
			}
		}
		rows.Close()
	}
	if rows, err := s.db.Query("SELECT e.message_id,e.user_id,COALESCE(NULLIF(g.nickname,''),u.name),e.text FROM chain_entries e JOIN messages m ON m.id=e.message_id JOIN users u ON u.id=e.user_id LEFT JOIN group_members g ON g.conversation_id=m.conversation_id AND g.user_id=e.user_id WHERE e.message_id IN "+in+" ORDER BY e.created", ids...); err == nil {
		for rows.Next() {
			var mid string
			var e ChainEntry
			if rows.Scan(&mid, &e.UserID, &e.Name, &e.Text) == nil && list[index[mid]].Chain != nil {
				list[index[mid]].Chain = append(list[index[mid]].Chain, e)
			}
		}
		rows.Close()
	}
	if rows, err := s.db.Query("SELECT t.root_id,COUNT(*),MAX(m.created) FROM message_threads t JOIN messages m ON m.id=t.message_id WHERE m.recalled=0 AND t.root_id IN "+in+" GROUP BY t.root_id", ids...); err == nil {
		for rows.Next() {
			var root string
			var info ThreadInfo
			if rows.Scan(&root, &info.Count, &info.Last) == nil {
				list[index[root]].Thread = &info
			}
		}
		rows.Close()
	}
}

func (s *Server) decorated(m Message) Message {
	list := []Message{m}
	s.decorate(list)
	return list[0]
}

// visibleMessage loads a message the caller may see, or answers 404.
func (s *Server) visibleMessage(w http.ResponseWriter, r *http.Request) (Message, bool) {
	m, err := scanMessage(s.db.QueryRow(messageQuery+"WHERE m.id=? AND "+messageVisible, r.PathValue("id"), uid(r)))
	if err != nil || !s.member(m.ConversationID, uid(r)) {
		fail(w, 404, "消息不存在或不可访问")
		return m, false
	}
	return m, true
}

func (s *Server) pushMessageUpdate(m Message) {
	s.pushConversation(m.ConversationID, "message-updated", s.decorated(m))
}

// Editing ----------------------------------------------------------------------

func (s *Server) editMessage(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Text     string
		Mentions []Mention
	}
	if !decode(w, r, &p) {
		return
	}
	m, found := s.visibleMessage(w, r)
	if !found {
		return
	}
	if m.Sender != uid(r) || m.Kind != "text" || m.Recalled {
		fail(w, 403, "只能编辑自己发送的文字消息")
		return
	}
	if strings.Contains(m.Text, "\n"+docMessageMarker) {
		fail(w, 400, "分享的文档卡片不能编辑")
		return
	}
	if now()-m.Created > editWindow.Milliseconds() {
		fail(w, 400, "只能编辑 24 小时内发送的消息")
		return
	}
	if !validText(p.Text, 6000) || strings.TrimSpace(p.Text) == "" {
		fail(w, 400, "消息内容无效或超过 6000 字")
		return
	}
	if !s.canSpeak(m.ConversationID, uid(r)) {
		fail(w, 403, "你在该群已被禁言")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	recipients, err := validateMentions(tx, m.ConversationID, uid(r), "text", p.Text, p.Mentions)
	if err == nil {
		_, err = tx.Exec("UPDATE messages SET text=? WHERE id=?", p.Text, m.ID)
	}
	if err == nil {
		_, err = tx.Exec("DELETE FROM message_mentions WHERE message_id=?", m.ID)
	}
	if err == nil {
		_, err = tx.Exec("DELETE FROM message_mention_recipients WHERE message_id=?", m.ID)
	}
	if err == nil {
		err = saveMentions(tx, m.ID, p.Mentions, recipients)
	}
	if err == nil {
		_, err = tx.Exec("INSERT INTO message_edits(message_id,edited) VALUES(?,?) ON CONFLICT(message_id) DO UPDATE SET edited=excluded.edited", m.ID, now())
	}
	if err == nil {
		_, err = tx.Exec("DELETE FROM message_translations WHERE message_id=?", m.ID)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	updated, err := scanMessage(s.db.QueryRow(messageQuery+"WHERE m.id=?", m.ID))
	if err != nil {
		s.dbError(w, err)
		return
	}
	updated = s.decorated(updated)
	s.pushConversation(m.ConversationID, "message-updated", updated)
	ok(w, updated)
}

// Reactions --------------------------------------------------------------------

func (s *Server) reactMessage(w http.ResponseWriter, r *http.Request) {
	var p struct{ Emoji string }
	if !decode(w, r, &p) {
		return
	}
	if !reactionEmoji[p.Emoji] {
		fail(w, 400, "不支持的表情")
		return
	}
	m, found := s.visibleMessage(w, r)
	if !found {
		return
	}
	if m.Recalled {
		fail(w, 400, "消息已撤回")
		return
	}
	result, err := s.db.Exec("DELETE FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?", m.ID, uid(r), p.Emoji)
	if err != nil {
		s.dbError(w, err)
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		var count int
		_ = s.db.QueryRow("SELECT COUNT(DISTINCT emoji) FROM message_reactions WHERE message_id=?", m.ID).Scan(&count)
		if count >= 20 {
			fail(w, 400, "这条消息的表情回复已经很多了")
			return
		}
		if _, err = s.db.Exec("INSERT INTO message_reactions(message_id,user_id,emoji,created) VALUES(?,?,?,?)", m.ID, uid(r), p.Emoji, now()); err != nil {
			s.dbError(w, err)
			return
		}
	}
	updated := s.decorated(m)
	s.pushConversation(m.ConversationID, "reaction", map[string]any{"conversationId": m.ConversationID, "messageId": m.ID, "reactions": updated.Reactions})
	ok(w, map[string]any{"reactions": updated.Reactions})
}

// Pinned messages ----------------------------------------------------------------

type pinnedMessage struct {
	Message
	PinnedBy   string `json:"pinnedBy"`
	PinnedName string `json:"pinnedByName"`
	PinnedAt   int64  `json:"pinnedAt"`
}

func (s *Server) pinsOf(cid, viewer string) ([]pinnedMessage, error) {
	rows, err := s.db.Query(messageQuery+"JOIN message_pins p ON p.message_id=m.id AND p.conversation_id=m.conversation_id WHERE m.conversation_id=? AND m.recalled=0 AND "+messageVisible+"ORDER BY p.created DESC", cid, viewer)
	if err != nil {
		return nil, err
	}
	var list []Message
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		list = append(list, m)
	}
	rows.Close()
	out := []pinnedMessage{}
	for _, m := range list {
		pm := pinnedMessage{Message: m}
		_ = s.db.QueryRow("SELECT p.user_id,COALESCE(u.name,''),p.created FROM message_pins p LEFT JOIN users u ON u.id=p.user_id WHERE p.conversation_id=? AND p.message_id=?", cid, m.ID).Scan(&pm.PinnedBy, &pm.PinnedName, &pm.PinnedAt)
		out = append(out, pm)
	}
	return out, nil
}

func (s *Server) listPins(w http.ResponseWriter, r *http.Request) {
	if !s.requireMember(w, r) {
		return
	}
	pins, err := s.pinsOf(r.PathValue("id"), uid(r))
	if err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, pins)
}

func (s *Server) setPin(w http.ResponseWriter, r *http.Request) {
	m, found := s.visibleMessage(w, r)
	if !found {
		return
	}
	pin := r.Method == "POST"
	if pin && m.Recalled {
		fail(w, 400, "消息已撤回")
		return
	}
	if !s.canSpeak(m.ConversationID, uid(r)) {
		fail(w, 403, "你在该群已被禁言")
		return
	}
	var err error
	if pin {
		var n int
		_ = s.db.QueryRow("SELECT COUNT(*) FROM message_pins WHERE conversation_id=?", m.ConversationID).Scan(&n)
		if n >= maxPins {
			fail(w, 400, "最多置顶 20 条消息，请先取消一些")
			return
		}
		_, err = s.db.Exec("INSERT OR IGNORE INTO message_pins(conversation_id,message_id,user_id,created) VALUES(?,?,?,?)", m.ConversationID, m.ID, uid(r), now())
	} else {
		_, err = s.db.Exec("DELETE FROM message_pins WHERE conversation_id=? AND message_id=?", m.ConversationID, m.ID)
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.pushConversation(m.ConversationID, "pins", map[string]any{"conversationId": m.ConversationID, "messageId": m.ID, "pinned": pin, "by": uid(r)})
	ok(w, map[string]bool{"ok": true})
}

// Urgent reminders -----------------------------------------------------------------

func (s *Server) urgentMessage(w http.ResponseWriter, r *http.Request) {
	var p struct{ Users []string }
	if !decode(w, r, &p) {
		return
	}
	m, found := s.visibleMessage(w, r)
	if !found {
		return
	}
	if m.Sender != uid(r) || m.Recalled {
		fail(w, 403, "只能加急自己发送的消息")
		return
	}
	if now()-m.Created > recallWindow.Milliseconds() {
		fail(w, 400, "只能加急 24 小时内的消息")
		return
	}
	if !s.rate(r, "urgent:"+uid(r), 30, time.Hour) {
		fail(w, 429, "加急太频繁，请稍后再试")
		return
	}
	members := map[string]bool{}
	for _, id := range s.audience(m.ConversationID) {
		if id != uid(r) && !s.isAI(id) {
			members[id] = true
		}
	}
	targets := []string{}
	if len(p.Users) == 0 {
		for id := range members {
			targets = append(targets, id)
		}
	} else {
		for _, id := range p.Users {
			if members[id] {
				targets = append(targets, id)
			}
		}
	}
	if len(targets) == 0 || len(targets) > 200 {
		fail(w, 400, "请选择要加急提醒的成员")
		return
	}
	for _, id := range targets {
		if _, err := s.db.Exec("INSERT INTO message_urgent(message_id,user_id,created) VALUES(?,?,?) ON CONFLICT(message_id,user_id) DO UPDATE SET acked=0,created=excluded.created", m.ID, id, now()); err != nil {
			s.dbError(w, err)
			return
		}
	}
	updated := s.decorated(m)
	var sender string
	_ = s.db.QueryRow("SELECT name FROM users WHERE id=?", uid(r)).Scan(&sender)
	s.push(targets, "urgent", map[string]any{"message": updated, "from": sender})
	s.pushConversation(m.ConversationID, "message-updated", updated)
	ok(w, updated)
}

func (s *Server) ackUrgent(w http.ResponseWriter, r *http.Request) {
	m, found := s.visibleMessage(w, r)
	if !found {
		return
	}
	result, err := s.db.Exec("UPDATE message_urgent SET acked=? WHERE message_id=? AND user_id=? AND acked=0", now(), m.ID, uid(r))
	if err != nil {
		s.dbError(w, err)
		return
	}
	if n, _ := result.RowsAffected(); n > 0 {
		s.pushConversation(m.ConversationID, "message-updated", s.decorated(m))
	}
	ok(w, map[string]bool{"ok": true})
}

// pendingUrgent lists urgent messages the caller has not acknowledged, for
// showing them again after signing in or reconnecting.
func (s *Server) pendingUrgent(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(messageQuery+"JOIN message_urgent x ON x.message_id=m.id WHERE x.user_id=? AND x.acked=0 AND m.recalled=0 AND x.created>? AND "+messageVisible+"ORDER BY x.created", uid(r), now()-recallWindow.Milliseconds(), uid(r))
	if err != nil {
		s.dbError(w, err)
		return
	}
	all := []Message{}
	for rows.Next() {
		if m, err := scanMessage(rows); err == nil {
			all = append(all, m)
		}
	}
	rows.Close()
	list := []Message{}
	for _, m := range all {
		if s.member(m.ConversationID, uid(r)) {
			list = append(list, m)
		}
	}
	s.decorate(list)
	ok(w, list)
}

// Polls and sign-ups -----------------------------------------------------------------

func (s *Server) insertStructured(w http.ResponseWriter, r *http.Request, kind string, spec any) {
	cid := r.PathValue("id")
	if !s.requireMember(w, r) {
		return
	}
	if !s.rate(r, "message:"+uid(r), 180, time.Minute) {
		fail(w, 429, "发送太快，请稍后再试")
		return
	}
	raw, _ := json.Marshal(spec)
	id, client := newID(), "s-"+newID()
	if _, err := s.db.Exec("INSERT INTO messages(id,conversation_id,sender,kind,text,attachment_id,reply_id,client_id,created) VALUES(?,?,?,?,?,'','',?,?)", id, cid, uid(r), kind, string(raw), client, now()); err != nil {
		s.dbError(w, err)
		return
	}
	m, err := scanMessage(s.db.QueryRow(messageQuery+"WHERE m.id=?", id))
	if err != nil {
		s.dbError(w, err)
		return
	}
	m = s.decorated(m)
	s.pushConversation(cid, "message", m)
	ok(w, m)
}

func cleanLine(v string, max int) (string, bool) {
	v = strings.TrimSpace(strings.ReplaceAll(v, "\n", " "))
	return v, v != "" && validText(v, max)
}

func (s *Server) createPoll(w http.ResponseWriter, r *http.Request) {
	var p pollSpec
	if !decode(w, r, &p) {
		return
	}
	title, valid := cleanLine(p.Title, 100)
	if !valid {
		fail(w, 400, "请填写 100 字以内的投票主题")
		return
	}
	options := []string{}
	seen := map[string]bool{}
	for _, o := range p.Options {
		if o, valid := cleanLine(o, 60); valid && !seen[o] {
			seen[o] = true
			options = append(options, o)
		}
	}
	if len(options) < 2 || len(options) > 20 {
		fail(w, 400, "请填写 2–20 个不重复的选项")
		return
	}
	s.insertStructured(w, r, "poll", pollSpec{Title: title, Options: options, Multi: p.Multi})
}

func (s *Server) votePoll(w http.ResponseWriter, r *http.Request) {
	var p struct{ Options []int }
	if !decode(w, r, &p) {
		return
	}
	m, found := s.visibleMessage(w, r)
	if !found {
		return
	}
	var spec pollSpec
	if m.Kind != "poll" || m.Recalled || json.Unmarshal([]byte(m.Text), &spec) != nil {
		fail(w, 400, "这不是投票")
		return
	}
	if spec.Closed {
		fail(w, 400, "投票已结束")
		return
	}
	picked := map[int]bool{}
	for _, o := range p.Options {
		if o < 0 || o >= len(spec.Options) {
			fail(w, 400, "选项无效")
			return
		}
		picked[o] = true
	}
	if !spec.Multi && len(picked) > 1 {
		fail(w, 400, "这是单选投票")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	if _, err = tx.Exec("DELETE FROM poll_votes WHERE message_id=? AND user_id=?", m.ID, uid(r)); err == nil {
		for o := range picked {
			if _, err = tx.Exec("INSERT INTO poll_votes(message_id,user_id,option,created) VALUES(?,?,?,?)", m.ID, uid(r), o, now()); err != nil {
				break
			}
		}
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	updated := s.decorated(m)
	s.pushConversation(m.ConversationID, "message-updated", updated)
	ok(w, updated)
}

// closePoll ends a poll; only its creator can.
func (s *Server) closePoll(w http.ResponseWriter, r *http.Request) {
	m, found := s.visibleMessage(w, r)
	if !found {
		return
	}
	var spec pollSpec
	if m.Kind != "poll" || m.Sender != uid(r) || json.Unmarshal([]byte(m.Text), &spec) != nil {
		fail(w, 403, "只有发起人可以结束投票")
		return
	}
	spec.Closed = true
	raw, _ := json.Marshal(spec)
	if _, err := s.db.Exec("UPDATE messages SET text=? WHERE id=?", string(raw), m.ID); err != nil {
		s.dbError(w, err)
		return
	}
	m.Text = string(raw)
	updated := s.decorated(m)
	s.pushConversation(m.ConversationID, "message-updated", updated)
	ok(w, updated)
}

func (s *Server) createChain(w http.ResponseWriter, r *http.Request) {
	var p chainSpec
	if !decode(w, r, &p) {
		return
	}
	title, valid := cleanLine(p.Title, 100)
	if !valid {
		fail(w, 400, "请填写 100 字以内的接龙主题")
		return
	}
	if !validText(p.Note, 500) {
		fail(w, 400, "说明最多 500 字")
		return
	}
	s.insertStructured(w, r, "chain", chainSpec{Title: title, Note: strings.TrimSpace(p.Note)})
}

// joinChain adds or updates the caller's line (text may be empty: just the
// name); leave removes it.
func (s *Server) joinChain(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Text  string
		Leave bool
	}
	if !decode(w, r, &p) {
		return
	}
	m, found := s.visibleMessage(w, r)
	if !found {
		return
	}
	if m.Kind != "chain" || m.Recalled {
		fail(w, 400, "这不是接龙")
		return
	}
	text := strings.TrimSpace(strings.ReplaceAll(p.Text, "\n", " "))
	var err error
	if p.Leave {
		_, err = s.db.Exec("DELETE FROM chain_entries WHERE message_id=? AND user_id=?", m.ID, uid(r))
	} else {
		if !validText(text, 100) {
			fail(w, 400, "接龙内容最多 100 字")
			return
		}
		var n int
		_ = s.db.QueryRow("SELECT COUNT(*) FROM chain_entries WHERE message_id=?", m.ID).Scan(&n)
		if n >= 500 {
			fail(w, 400, "接龙人数已满")
			return
		}
		_, err = s.db.Exec("INSERT INTO chain_entries(message_id,user_id,text,created) VALUES(?,?,?,?) ON CONFLICT(message_id,user_id) DO UPDATE SET text=excluded.text", m.ID, uid(r), text, now())
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	updated := s.decorated(m)
	s.pushConversation(m.ConversationID, "message-updated", updated)
	ok(w, updated)
}

// Threads ----------------------------------------------------------------------------

// threadRoot checks that root can start or hold a thread in cid.
func threadRoot(q rowQuery, cid, root string) error {
	var kind string
	var recalled bool
	var parent string
	if q.QueryRow("SELECT m.kind,m.recalled,COALESCE((SELECT root_id FROM message_threads WHERE message_id=m.id),'') FROM messages m WHERE m.id=? AND m.conversation_id=?", root, cid).Scan(&kind, &recalled, &parent) != nil || recalled {
		return groupFail(400, "话题的原消息不存在")
	}
	if parent != "" {
		return groupFail(400, "不能在话题回复里再开话题")
	}
	return nil
}

func (s *Server) threadMessages(w http.ResponseWriter, r *http.Request) {
	root, found := s.visibleMessage(w, r)
	if !found {
		return
	}
	rows, err := s.db.Query(messageQuery+"JOIN message_threads t ON t.message_id=m.id WHERE t.root_id=? AND "+messageVisible+"ORDER BY m.seq LIMIT 500", root.ID, uid(r))
	if err != nil {
		s.dbError(w, err)
		return
	}
	list := []Message{}
	for rows.Next() {
		if m, err := scanMessage(rows); err == nil {
			list = append(list, m)
		}
	}
	rows.Close()
	s.decorate(list)
	ok(w, map[string]any{"root": s.decorated(root), "replies": list})
}

func (s *Server) pushThreadUpdate(cid, root string) {
	if m, err := scanMessage(s.db.QueryRow(messageQuery+"WHERE m.id=?", root)); err == nil {
		s.pushConversation(cid, "message-updated", s.decorated(m))
	}
}
