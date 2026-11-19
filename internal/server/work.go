package server

import (
	"database/sql"
	"net/http"
	"sort"
	"strings"
	"time"
)

// Workbench features after DingTalk and Feishu: tasks that can be assigned,
// a calendar with invitations, messages flagged to handle later, and one
// search over contacts, chats, messages and documents.

const workSchema = `
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,creator TEXT NOT NULL,title TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',due INTEGER NOT NULL DEFAULT 0,done INTEGER NOT NULL DEFAULT 0,done_by TEXT NOT NULL DEFAULT '',message_id TEXT NOT NULL DEFAULT '',conversation_id TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL,updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS task_assignees(task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,user_id TEXT NOT NULL,PRIMARY KEY(task_id,user_id));
CREATE INDEX IF NOT EXISTS task_assignees_user ON task_assignees(user_id);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,creator TEXT NOT NULL,title TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT '',start INTEGER NOT NULL,end INTEGER NOT NULL,all_day INTEGER NOT NULL DEFAULT 0,meeting INTEGER NOT NULL DEFAULT 0,remind INTEGER NOT NULL DEFAULT 15,created INTEGER NOT NULL,updated INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS events_start ON events(start);
CREATE TABLE IF NOT EXISTS event_attendees(event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,user_id TEXT NOT NULL,response TEXT NOT NULL DEFAULT '',PRIMARY KEY(event_id,user_id));
CREATE INDEX IF NOT EXISTS event_attendees_user ON event_attendees(user_id);
CREATE TABLE IF NOT EXISTS message_flags(user_id TEXT NOT NULL,message_id TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(user_id,message_id));
`

type person struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
}

// canReach says whether user a may assign work to or invite user b: friends,
// or people who share a conversation.
func canReach(q rowQuery, a, b string) bool {
	if a == b {
		return true
	}
	var n int
	return q.QueryRow(`SELECT 1 WHERE EXISTS(SELECT 1 FROM friends WHERE (user_id=? AND peer_id=?) OR (user_id=? AND peer_id=?)) OR EXISTS(SELECT 1 FROM members x JOIN members y ON y.conversation_id=x.conversation_id WHERE x.user_id=? AND y.user_id=?)`, a, b, b, a, a, b).Scan(&n) == nil
}

func (s *Server) people(ids []string) []person {
	out := []person{}
	for _, id := range ids {
		var p person
		if s.db.QueryRow("SELECT id,name,avatar FROM users WHERE id=?", id).Scan(&p.ID, &p.Name, &p.Avatar) == nil {
			out = append(out, p)
		}
	}
	return out
}

func (s *Server) validPeople(w http.ResponseWriter, me string, ids []string, max int) ([]string, bool) {
	seen := map[string]bool{}
	out := []string{}
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		if s.isAI(id) || !canReach(s.db, me, id) {
			fail(w, 403, "只能选择好友或同一个聊天里的人")
			return nil, false
		}
		out = append(out, id)
	}
	if len(out) > max {
		fail(w, 400, "人数太多")
		return nil, false
	}
	return out, true
}

// Tasks ---------------------------------------------------------------------

type Task struct {
	ID             string   `json:"id"`
	Title          string   `json:"title"`
	Note           string   `json:"note"`
	Due            int64    `json:"due"`
	Done           int64    `json:"done"`
	DoneBy         string   `json:"doneBy,omitempty"`
	Creator        person   `json:"creator"`
	Assignees      []person `json:"assignees"`
	MessageID      string   `json:"messageId,omitempty"`
	ConversationID string   `json:"conversationId,omitempty"`
	Created        int64    `json:"created"`
	Updated        int64    `json:"updated"`
}

func (s *Server) loadTask(id string) (Task, error) {
	var t Task
	var creator string
	err := s.db.QueryRow("SELECT id,title,note,due,done,done_by,creator,message_id,conversation_id,created,updated FROM tasks WHERE id=?", id).Scan(&t.ID, &t.Title, &t.Note, &t.Due, &t.Done, &t.DoneBy, &creator, &t.MessageID, &t.ConversationID, &t.Created, &t.Updated)
	if err != nil {
		return t, err
	}
	if p := s.people([]string{creator}); len(p) == 1 {
		t.Creator = p[0]
	} else {
		t.Creator = person{ID: creator}
	}
	t.Assignees = s.people(s.taskAssignees(id))
	return t, nil
}

func (s *Server) taskAssignees(id string) []string {
	rows, err := s.db.Query("SELECT user_id FROM task_assignees WHERE task_id=?", id)
	if err != nil {
		return nil
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var u string
		if rows.Scan(&u) == nil {
			ids = append(ids, u)
		}
	}
	return ids
}

func (s *Server) taskAudience(t Task) []string {
	ids := []string{t.Creator.ID}
	for _, a := range t.Assignees {
		if a.ID != t.Creator.ID {
			ids = append(ids, a.ID)
		}
	}
	return ids
}

func (s *Server) listTasks(w http.ResponseWriter, r *http.Request) {
	me := uid(r)
	scope := r.URL.Query().Get("scope")
	query := "SELECT DISTINCT t.id FROM tasks t LEFT JOIN task_assignees a ON a.task_id=t.id WHERE "
	switch scope {
	case "created":
		query += "t.creator=? AND t.done=0"
	case "done":
		query += "(t.creator=? OR a.user_id=?) AND t.done>0"
	case "all":
		query += "(t.creator=? OR a.user_id=?)"
	default:
		query += "(a.user_id=? OR (t.creator=? AND NOT EXISTS(SELECT 1 FROM task_assignees x WHERE x.task_id=t.id))) AND t.done=0"
	}
	args := []any{me}
	if scope != "created" {
		args = append(args, me)
	}
	rows, err := s.db.Query(query+" ORDER BY CASE WHEN t.due=0 THEN 1 ELSE 0 END,t.due,t.created DESC LIMIT 500", args...)
	if err != nil {
		s.dbError(w, err)
		return
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	out := []Task{}
	for _, id := range ids {
		if t, err := s.loadTask(id); err == nil {
			out = append(out, t)
		}
	}
	ok(w, out)
}

func (s *Server) createTask(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Title, Note, MessageID string
		Due                    int64
		Assignees              []string
	}
	if !decode(w, r, &p) {
		return
	}
	me := uid(r)
	p.Title = strings.TrimSpace(p.Title)
	if p.Title == "" || !validText(p.Title, 200) || !validText(p.Note, 2000) || p.Due < 0 {
		fail(w, 400, "待办标题需为 1–200 字")
		return
	}
	assignees, valid := s.validPeople(w, me, p.Assignees, 50)
	if !valid {
		return
	}
	cid := ""
	if p.MessageID != "" {
		if s.db.QueryRow("SELECT m.conversation_id FROM messages m JOIN members x ON x.conversation_id=m.conversation_id AND x.user_id=? WHERE m.id=?", me, p.MessageID).Scan(&cid) != nil {
			fail(w, 404, "消息不存在")
			return
		}
	}
	var open int
	_ = s.db.QueryRow("SELECT COUNT(*) FROM tasks WHERE creator=? AND done=0", me).Scan(&open)
	if open >= 2000 {
		fail(w, 400, "未完成的待办太多了，请先处理一些")
		return
	}
	id, t := newID(), now()
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	if _, err = tx.Exec("INSERT INTO tasks(id,creator,title,note,due,message_id,conversation_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?)", id, me, p.Title, p.Note, p.Due, p.MessageID, cid, t, t); err == nil {
		for _, a := range assignees {
			if _, err = tx.Exec("INSERT INTO task_assignees(task_id,user_id) VALUES(?,?)", id, a); err != nil {
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
	task, _ := s.loadTask(id)
	s.push(s.taskAudience(task), "task", map[string]any{"task": task, "by": me, "created": true})
	ok(w, task)
}

func (s *Server) updateTask(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Title, Note *string
		Due         *int64
		Done        *bool
		Assignees   []string
	}
	if !decode(w, r, &p) {
		return
	}
	me := uid(r)
	t, err := s.loadTask(r.PathValue("id"))
	if err != nil {
		fail(w, 404, "待办不存在")
		return
	}
	assigned := false
	for _, a := range t.Assignees {
		assigned = assigned || a.ID == me
	}
	creator := t.Creator.ID == me
	if !creator && !assigned {
		fail(w, 404, "待办不存在")
		return
	}
	if !creator && (p.Title != nil || p.Note != nil || p.Due != nil || p.Assignees != nil) {
		fail(w, 403, "只有创建人可以修改待办内容")
		return
	}
	if p.Title != nil {
		title := strings.TrimSpace(*p.Title)
		if title == "" || !validText(title, 200) {
			fail(w, 400, "待办标题需为 1–200 字")
			return
		}
		t.Title = title
	}
	if p.Note != nil {
		if !validText(*p.Note, 2000) {
			fail(w, 400, "说明最多 2000 字")
			return
		}
		t.Note = *p.Note
	}
	if p.Due != nil && *p.Due >= 0 {
		t.Due = *p.Due
	}
	doneBy := t.DoneBy
	if p.Done != nil {
		if *p.Done && t.Done == 0 {
			t.Done, doneBy = now(), me
		} else if !*p.Done {
			t.Done, doneBy = 0, ""
		}
	}
	before := s.taskAudience(t)
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	_, err = tx.Exec("UPDATE tasks SET title=?,note=?,due=?,done=?,done_by=?,updated=? WHERE id=?", t.Title, t.Note, t.Due, t.Done, doneBy, now(), t.ID)
	if err == nil && p.Assignees != nil {
		assignees, valid := s.validPeople(w, me, p.Assignees, 50)
		if !valid {
			return
		}
		if _, err = tx.Exec("DELETE FROM task_assignees WHERE task_id=?", t.ID); err == nil {
			for _, a := range assignees {
				if _, err = tx.Exec("INSERT INTO task_assignees(task_id,user_id) VALUES(?,?)", t.ID, a); err != nil {
					break
				}
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
	updated, _ := s.loadTask(t.ID)
	targets := map[string]bool{}
	for _, id := range append(before, s.taskAudience(updated)...) {
		targets[id] = true
	}
	ids := []string{}
	for id := range targets {
		ids = append(ids, id)
	}
	s.push(ids, "task", map[string]any{"task": updated, "by": me})
	ok(w, updated)
}

func (s *Server) deleteTask(w http.ResponseWriter, r *http.Request) {
	t, err := s.loadTask(r.PathValue("id"))
	if err != nil || t.Creator.ID != uid(r) {
		fail(w, 403, "只有创建人可以删除待办")
		return
	}
	audience := s.taskAudience(t)
	if _, err = s.db.Exec("DELETE FROM task_assignees WHERE task_id=?", t.ID); err == nil {
		_, err = s.db.Exec("DELETE FROM tasks WHERE id=?", t.ID)
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.push(audience, "task", map[string]any{"task": map[string]string{"id": t.ID}, "deleted": true, "by": uid(r)})
	ok(w, map[string]bool{"ok": true})
}

// Calendar --------------------------------------------------------------------

type Attendee struct {
	person
	Response string `json:"response"`
}
type Event struct {
	ID        string     `json:"id"`
	Title     string     `json:"title"`
	Note      string     `json:"note"`
	Location  string     `json:"location"`
	Start     int64      `json:"start"`
	End       int64      `json:"end"`
	AllDay    bool       `json:"allDay"`
	Meeting   bool       `json:"meeting"`
	Remind    int        `json:"remind"`
	Creator   person     `json:"creator"`
	Attendees []Attendee `json:"attendees"`
}

func (s *Server) loadEvent(id string) (Event, error) {
	var e Event
	var creator string
	err := s.db.QueryRow("SELECT id,title,note,location,start,end,all_day,meeting,remind,creator FROM events WHERE id=?", id).Scan(&e.ID, &e.Title, &e.Note, &e.Location, &e.Start, &e.End, &e.AllDay, &e.Meeting, &e.Remind, &creator)
	if err != nil {
		return e, err
	}
	if p := s.people([]string{creator}); len(p) == 1 {
		e.Creator = p[0]
	}
	e.Attendees = []Attendee{}
	rows, err := s.db.Query("SELECT a.user_id,u.name,u.avatar,a.response FROM event_attendees a JOIN users u ON u.id=a.user_id WHERE a.event_id=?", id)
	if err != nil {
		return e, err
	}
	defer rows.Close()
	for rows.Next() {
		var a Attendee
		if rows.Scan(&a.ID, &a.Name, &a.Avatar, &a.Response) == nil {
			e.Attendees = append(e.Attendees, a)
		}
	}
	return e, nil
}

func (s *Server) eventAudience(e Event) []string {
	ids := []string{e.Creator.ID}
	for _, a := range e.Attendees {
		if a.ID != e.Creator.ID {
			ids = append(ids, a.ID)
		}
	}
	return ids
}

func (s *Server) listEvents(w http.ResponseWriter, r *http.Request) {
	from, to := atoiQuery(r, "from", now()-7*86400000), atoiQuery(r, "to", now()+60*86400000)
	if to-from > 400*86400000 {
		fail(w, 400, "时间范围太大")
		return
	}
	me := uid(r)
	rows, err := s.db.Query("SELECT DISTINCT e.id FROM events e LEFT JOIN event_attendees a ON a.event_id=e.id WHERE (e.creator=? OR a.user_id=?) AND e.end>=? AND e.start<? ORDER BY e.start LIMIT 1000", me, me, from, to)
	if err != nil {
		s.dbError(w, err)
		return
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	out := []Event{}
	for _, id := range ids {
		if e, err := s.loadEvent(id); err == nil {
			out = append(out, e)
		}
	}
	ok(w, out)
}

func atoiQuery(r *http.Request, key string, def int64) int64 {
	if v := r.URL.Query().Get(key); v != "" {
		if n := atoi(v); n > 0 {
			return int64(n)
		}
	}
	return def
}

type eventInput struct {
	Title, Note, Location *string
	Start, End            *int64
	AllDay, Meeting       *bool
	Remind                *int
	Attendees             []string
}

func (s *Server) applyEventInput(w http.ResponseWriter, me string, e *Event, p eventInput) ([]string, bool) {
	if p.Title != nil {
		e.Title = strings.TrimSpace(*p.Title)
	}
	if p.Note != nil {
		e.Note = *p.Note
	}
	if p.Location != nil {
		e.Location = strings.TrimSpace(*p.Location)
	}
	if p.Start != nil {
		e.Start = *p.Start
	}
	if p.End != nil {
		e.End = *p.End
	}
	if p.AllDay != nil {
		e.AllDay = *p.AllDay
	}
	if p.Meeting != nil {
		e.Meeting = *p.Meeting
	}
	if p.Remind != nil && *p.Remind >= 0 && *p.Remind <= 7*24*60 {
		e.Remind = *p.Remind
	}
	switch {
	case e.Title == "" || !validText(e.Title, 200):
		fail(w, 400, "日程标题需为 1–200 字")
		return nil, false
	case !validText(e.Note, 2000) || !validText(e.Location, 200):
		fail(w, 400, "说明或地点过长")
		return nil, false
	case e.Start <= 0 || e.End < e.Start || e.End-e.Start > 31*86400000:
		fail(w, 400, "日程时间无效")
		return nil, false
	}
	if p.Attendees == nil {
		return nil, true
	}
	return s.validPeople(w, me, p.Attendees, 200)
}

func (s *Server) createEvent(w http.ResponseWriter, r *http.Request) {
	var p eventInput
	if !decode(w, r, &p) {
		return
	}
	me := uid(r)
	e := Event{Remind: 15}
	if p.Attendees == nil {
		p.Attendees = []string{}
	}
	attendees, valid := s.applyEventInput(w, me, &e, p)
	if !valid {
		return
	}
	id, t := newID(), now()
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	if _, err = tx.Exec("INSERT INTO events(id,creator,title,note,location,start,end,all_day,meeting,remind,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", id, me, e.Title, e.Note, e.Location, e.Start, e.End, e.AllDay, e.Meeting, e.Remind, t, t); err == nil {
		for _, a := range attendees {
			if a == me {
				continue
			}
			if _, err = tx.Exec("INSERT INTO event_attendees(event_id,user_id) VALUES(?,?)", id, a); err != nil {
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
	event, _ := s.loadEvent(id)
	s.push(s.eventAudience(event), "event", map[string]any{"event": event, "by": me, "created": true})
	ok(w, event)
}

func (s *Server) updateEvent(w http.ResponseWriter, r *http.Request) {
	var p struct {
		eventInput
		Response *string
	}
	if !decode(w, r, &p) {
		return
	}
	me := uid(r)
	e, err := s.loadEvent(r.PathValue("id"))
	if err != nil {
		fail(w, 404, "日程不存在")
		return
	}
	attending := false
	for _, a := range e.Attendees {
		attending = attending || a.ID == me
	}
	if e.Creator.ID != me && !attending {
		fail(w, 404, "日程不存在")
		return
	}
	before := s.eventAudience(e)
	if p.Response != nil {
		if !attending || (*p.Response != "accept" && *p.Response != "decline" && *p.Response != "tentative" && *p.Response != "") {
			fail(w, 400, "回复无效")
			return
		}
		if _, err = s.db.Exec("UPDATE event_attendees SET response=? WHERE event_id=? AND user_id=?", *p.Response, e.ID, me); err != nil {
			s.dbError(w, err)
			return
		}
	}
	changing := p.Title != nil || p.Note != nil || p.Location != nil || p.Start != nil || p.End != nil || p.AllDay != nil || p.Meeting != nil || p.Remind != nil || p.Attendees != nil
	if changing {
		if e.Creator.ID != me {
			fail(w, 403, "只有组织者可以修改日程")
			return
		}
		attendees, valid := s.applyEventInput(w, me, &e, p.eventInput)
		if !valid {
			return
		}
		tx, err := s.db.Begin()
		if err != nil {
			s.dbError(w, err)
			return
		}
		defer tx.Rollback()
		_, err = tx.Exec("UPDATE events SET title=?,note=?,location=?,start=?,end=?,all_day=?,meeting=?,remind=?,updated=? WHERE id=?", e.Title, e.Note, e.Location, e.Start, e.End, e.AllDay, e.Meeting, e.Remind, now(), e.ID)
		if err == nil && p.Attendees != nil {
			if _, err = tx.Exec("DELETE FROM event_attendees WHERE event_id=? AND user_id NOT IN (SELECT value FROM json_each(?))", e.ID, jsonList(attendees)); err == nil {
				for _, a := range attendees {
					if a != me {
						if _, err = tx.Exec("INSERT OR IGNORE INTO event_attendees(event_id,user_id) VALUES(?,?)", e.ID, a); err != nil {
							break
						}
					}
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
	}
	updated, _ := s.loadEvent(e.ID)
	targets := map[string]bool{}
	for _, id := range append(before, s.eventAudience(updated)...) {
		targets[id] = true
	}
	ids := []string{}
	for id := range targets {
		ids = append(ids, id)
	}
	s.push(ids, "event", map[string]any{"event": updated, "by": me})
	ok(w, updated)
}

func jsonList(ids []string) string {
	if len(ids) == 0 {
		return "[]"
	}
	return `["` + strings.Join(ids, `","`) + `"]`
}

func (s *Server) deleteEvent(w http.ResponseWriter, r *http.Request) {
	e, err := s.loadEvent(r.PathValue("id"))
	if err != nil || e.Creator.ID != uid(r) {
		fail(w, 403, "只有组织者可以取消日程")
		return
	}
	audience := s.eventAudience(e)
	if _, err = s.db.Exec("DELETE FROM event_attendees WHERE event_id=?", e.ID); err == nil {
		_, err = s.db.Exec("DELETE FROM events WHERE id=?", e.ID)
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.push(audience, "event", map[string]any{"event": map[string]string{"id": e.ID, "title": e.Title}, "deleted": true, "by": uid(r)})
	ok(w, map[string]bool{"ok": true})
}

// Flagged messages ---------------------------------------------------------------

func (s *Server) setFlag(w http.ResponseWriter, r *http.Request) {
	m, found := s.visibleMessage(w, r)
	if !found {
		return
	}
	var err error
	if r.Method == "POST" {
		var n int
		_ = s.db.QueryRow("SELECT COUNT(*) FROM message_flags WHERE user_id=?", uid(r)).Scan(&n)
		if n >= 1000 {
			fail(w, 400, "标记的消息太多了，请先处理一些")
			return
		}
		_, err = s.db.Exec("INSERT OR IGNORE INTO message_flags(user_id,message_id,created) VALUES(?,?,?)", uid(r), m.ID, now())
	} else {
		_, err = s.db.Exec("DELETE FROM message_flags WHERE user_id=? AND message_id=?", uid(r), m.ID)
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.push([]string{uid(r)}, "flags", map[string]any{"messageId": m.ID, "flagged": r.Method == "POST"})
	ok(w, map[string]bool{"ok": true})
}

type flaggedMessage struct {
	Message
	ConversationName string `json:"conversationName"`
	Flagged          int64  `json:"flagged"`
}

func (s *Server) listFlags(w http.ResponseWriter, r *http.Request) {
	me := uid(r)
	rows, err := s.db.Query(messageQuery+"JOIN message_flags f ON f.message_id=m.id AND f.user_id=? JOIN members x ON x.conversation_id=m.conversation_id AND x.user_id=f.user_id WHERE "+messageVisible+"ORDER BY f.created DESC LIMIT 500", me, me)
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
	out := []flaggedMessage{}
	for _, m := range list {
		f := flaggedMessage{Message: m}
		_ = s.db.QueryRow("SELECT created FROM message_flags WHERE user_id=? AND message_id=?", me, m.ID).Scan(&f.Flagged)
		f.ConversationName = s.conversationName(m.ConversationID, me)
		out = append(out, f)
	}
	ok(w, out)
}

// conversationName is a group's name, or the other person's in a direct chat.
func (s *Server) conversationName(cid, me string) string {
	var kind, name string
	_ = s.db.QueryRow("SELECT kind,name FROM conversations WHERE id=?", cid).Scan(&kind, &name)
	if kind == "direct" {
		_ = s.db.QueryRow("SELECT u.name FROM members m JOIN users u ON u.id=m.user_id WHERE m.conversation_id=? AND m.user_id<>?", cid, me).Scan(&name)
	}
	return name
}

// Global search ----------------------------------------------------------------------

func (s *Server) globalSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" || !validText(q, 100) {
		fail(w, 400, "请输入 1–100 字的关键词")
		return
	}
	if !s.rate(r, "search:"+uid(r), 120, time.Minute) {
		fail(w, 429, "搜索太频繁，请稍后再试")
		return
	}
	me, like := uid(r), "%"+escapeLike(q)+"%"
	type contact struct {
		person
		Number         string `json:"number"`
		ConversationID string `json:"conversationId,omitempty"`
	}
	contacts := []contact{}
	rows, err := s.db.Query(`SELECT u.id,u.name,u.avatar,COALESCE((SELECT CAST(number AS TEXT) FROM user_numbers WHERE user_id=u.id),''),COALESCE((SELECT c.id FROM conversations c JOIN members a ON a.conversation_id=c.id AND a.user_id=? JOIN members b ON b.conversation_id=c.id AND b.user_id=u.id WHERE c.kind='direct' LIMIT 1),'') FROM users u WHERE u.id IN (SELECT peer_id FROM friends WHERE user_id=?) AND (u.name LIKE ? ESCAPE '\' OR EXISTS(SELECT 1 FROM user_numbers n WHERE n.user_id=u.id AND CAST(n.number AS TEXT)=?)) LIMIT 20`, me, me, like, q)
	if err == nil {
		for rows.Next() {
			var c contact
			if rows.Scan(&c.ID, &c.Name, &c.Avatar, &c.Number, &c.ConversationID) == nil {
				contacts = append(contacts, c)
			}
		}
		rows.Close()
	}
	type chat struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Count int    `json:"count"`
	}
	chats := []chat{}
	rows, err = s.db.Query(`SELECT c.id,c.name,(SELECT COUNT(*) FROM members WHERE conversation_id=c.id) FROM conversations c JOIN members x ON x.conversation_id=c.id AND x.user_id=? WHERE c.kind='group' AND c.name LIKE ? ESCAPE '\' LIMIT 20`, me, like)
	if err == nil {
		for rows.Next() {
			var c chat
			if rows.Scan(&c.ID, &c.Name, &c.Count) == nil {
				chats = append(chats, c)
			}
		}
		rows.Close()
	}
	messages := []flaggedMessage{}
	rows, err = s.db.Query(messageQuery+"JOIN members x ON x.conversation_id=m.conversation_id AND x.user_id=? WHERE m.recalled=0 AND m.kind IN ('text','file','forward') AND (m.text LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\') AND "+messageVisible+"ORDER BY m.seq DESC LIMIT 40", me, like, like, me)
	if err == nil {
		var list []Message
		for rows.Next() {
			if m, err := scanMessage(rows); err == nil {
				list = append(list, m)
			}
		}
		rows.Close()
		for _, m := range list {
			messages = append(messages, flaggedMessage{Message: m, ConversationName: s.conversationName(m.ConversationID, me)})
		}
	}
	docs := []docSummary{}
	rows, err = s.db.Query(`SELECT d.id,d.kind,d.title,d.owner,COALESCE(o.name,''),d.updated FROM docs d LEFT JOIN users o ON o.id=d.owner WHERE d.title LIKE ? ESCAPE '\' AND (d.owner=? OR EXISTS(SELECT 1 FROM doc_members WHERE doc_id=d.id AND user_id=?) OR EXISTS(SELECT 1 FROM doc_groups g JOIN members m ON m.conversation_id=g.conversation_id AND m.user_id=? WHERE g.doc_id=d.id) OR EXISTS(SELECT 1 FROM doc_recents WHERE doc_id=d.id AND user_id=?)) ORDER BY d.updated DESC LIMIT 20`, like, me, me, me, me)
	if err == nil {
		for rows.Next() {
			var d docSummary
			if rows.Scan(&d.ID, &d.Kind, &d.Title, &d.Owner, &d.OwnerName, &d.Updated) == nil {
				docs = append(docs, d)
			}
		}
		rows.Close()
	}
	kept := docs[:0]
	for _, d := range docs {
		if role, _ := docRole(s.db, d.ID, me); role > docNone {
			d.Role = docRoleNames[role]
			kept = append(kept, d)
		}
	}
	sort.SliceStable(messages, func(i, j int) bool { return messages[i].Created > messages[j].Created })
	ok(w, map[string]any{"contacts": contacts, "chats": chats, "messages": messages, "docs": kept})
}

var _ = sql.ErrNoRows
