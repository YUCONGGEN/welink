package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"time"
)

// Scheduled messages: a user (usually through Me's linkme-AIdex) asks the
// server to send a text, image or file to a chat once or repeatedly. The
// server sends them even while the user's computer is off, through the same
// handler as a normal send, so membership, mutes and real-time delivery
// apply unchanged. Users see and cancel them in Settings → 定时消息.
const scheduleSchema = `
CREATE TABLE IF NOT EXISTS scheduled_messages(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), conversation_id TEXT NOT NULL REFERENCES conversations(id), kind TEXT NOT NULL, text TEXT NOT NULL, attachment_id TEXT NOT NULL DEFAULT '', next_run INTEGER NOT NULL, repeat TEXT NOT NULL, tz_offset INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, last_run INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS scheduled_due ON scheduled_messages(next_run);
CREATE INDEX IF NOT EXISTS scheduled_user ON scheduled_messages(user_id);
`

type schedule struct {
	ID             string `json:"id"`
	ConversationID string `json:"conversationId"`
	Kind           string `json:"kind"`
	Text           string `json:"text"`
	AttachmentID   string `json:"attachmentId,omitempty"`
	NextRun        int64  `json:"nextRun"`
	Repeat         string `json:"repeat"`
	TZOffset       int    `json:"tzOffset"`
	Created        int64  `json:"created"`
	LastRun        int64  `json:"lastRun,omitempty"`
	LastError      string `json:"lastError,omitempty"`
}

const maxSchedules = 200

func (s *Server) listSchedules(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query("SELECT id,conversation_id,kind,text,attachment_id,next_run,repeat,tz_offset,created,last_run,last_error FROM scheduled_messages WHERE user_id=? ORDER BY next_run", uid(r))
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer rows.Close()
	out := []schedule{}
	for rows.Next() {
		var v schedule
		if err = rows.Scan(&v.ID, &v.ConversationID, &v.Kind, &v.Text, &v.AttachmentID, &v.NextRun, &v.Repeat, &v.TZOffset, &v.Created, &v.LastRun, &v.LastError); err != nil {
			s.dbError(w, err)
			return
		}
		out = append(out, v)
	}
	ok(w, out)
}

func (s *Server) createSchedule(w http.ResponseWriter, r *http.Request) {
	var p struct {
		ConversationID, Kind, Text, AttachmentID, Repeat string
		At                                               int64
		TZOffset                                         int
	}
	if !decode(w, r, &p) {
		return
	}
	if p.Kind == "" {
		p.Kind = "text"
	}
	if p.Repeat == "" {
		p.Repeat = "once"
	}
	switch {
	case p.Repeat != "once" && p.Repeat != "daily" && p.Repeat != "weekdays":
		fail(w, 400, "重复方式只能是 once、daily 或 weekdays")
		return
	case p.At < now()-60_000 || p.At > now()+366*24*3600*1000:
		fail(w, 400, "发送时间需在现在到一年之内")
		return
	case p.TZOffset < -14*60 || p.TZOffset > 14*60:
		fail(w, 400, "时区无效")
		return
	case (p.Kind != "text" && p.Kind != "image" && p.Kind != "file") || !validText(p.Text, 6000) || (p.Kind == "text" && p.Text == ""):
		fail(w, 400, "消息内容无效或超过 6000 字")
		return
	case !s.member(p.ConversationID, uid(r)) || !s.canSpeak(p.ConversationID, uid(r)):
		fail(w, 403, "无法在该会话发送消息")
		return
	}
	if p.Kind != "text" {
		var mime string
		if s.db.QueryRow("SELECT mime FROM attachments WHERE id=? AND owner=? AND conversation_id=?", p.AttachmentID, uid(r), p.ConversationID).Scan(&mime) != nil {
			fail(w, 400, "附件不存在")
			return
		}
	} else {
		p.AttachmentID = ""
	}
	var count int
	_ = s.db.QueryRow("SELECT COUNT(*) FROM scheduled_messages WHERE user_id=?", uid(r)).Scan(&count)
	if count >= maxSchedules {
		fail(w, 400, fmt.Sprintf("定时消息最多 %d 条，请先取消不需要的", maxSchedules))
		return
	}
	v := schedule{ID: newID(), ConversationID: p.ConversationID, Kind: p.Kind, Text: p.Text, AttachmentID: p.AttachmentID, NextRun: max(p.At, now()), Repeat: p.Repeat, TZOffset: p.TZOffset, Created: now()}
	if v.Repeat == "weekdays" {
		v.NextRun = nextWeekday(v.NextRun-1, v.NextRun, v.TZOffset)
	}
	if _, err := s.db.Exec("INSERT INTO scheduled_messages(id,user_id,conversation_id,kind,text,attachment_id,next_run,repeat,tz_offset,created) VALUES(?,?,?,?,?,?,?,?,?,?)", v.ID, uid(r), v.ConversationID, v.Kind, v.Text, v.AttachmentID, v.NextRun, v.Repeat, v.TZOffset, v.Created); err != nil {
		s.dbError(w, err)
		return
	}
	s.push([]string{uid(r)}, "schedules", map[string]any{})
	ok(w, v)
}

func (s *Server) deleteSchedule(w http.ResponseWriter, r *http.Request) {
	res, err := s.db.Exec("DELETE FROM scheduled_messages WHERE id=? AND user_id=?", r.PathValue("id"), uid(r))
	if err != nil {
		s.dbError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		fail(w, 404, "定时消息不存在")
		return
	}
	s.push([]string{uid(r)}, "schedules", map[string]any{})
	ok(w, map[string]bool{"ok": true})
}

// nextWeekday returns the first time at the same local clock time as base,
// later than after, that falls on Monday–Friday in the user's time zone.
func nextWeekday(after, base int64, tzOffset int) int64 {
	t := base
	for t <= after {
		t += 24 * 3600 * 1000
	}
	for {
		local := time.UnixMilli(t).UTC().Add(time.Duration(tzOffset) * time.Minute)
		if wd := local.Weekday(); wd != time.Saturday && wd != time.Sunday {
			return t
		}
		t += 24 * 3600 * 1000
	}
}

// startSchedules sends what is due every 15 seconds until the server closes.
func (s *Server) startSchedules() {
	s.schedulesDone = make(chan struct{})
	go func() {
		defer close(s.schedulesDone)
		t := time.NewTicker(15 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-s.callsStop:
				return
			case <-t.C:
				s.sendDueSchedules()
			}
		}
	}()
}

func (s *Server) sendDueSchedules() {
	rows, err := s.db.Query("SELECT id,user_id,conversation_id,kind,text,attachment_id,next_run,repeat,tz_offset FROM scheduled_messages WHERE next_run<=? ORDER BY next_run LIMIT 100", now())
	if err != nil {
		return
	}
	type due struct {
		schedule
		user string
	}
	var list []due
	for rows.Next() {
		var d due
		if rows.Scan(&d.ID, &d.user, &d.ConversationID, &d.Kind, &d.Text, &d.AttachmentID, &d.NextRun, &d.Repeat, &d.TZOffset) == nil {
			list = append(list, d)
		}
	}
	rows.Close()
	for _, d := range list {
		errText := ""
		var disabled int
		_ = s.db.QueryRow("SELECT disabled FROM user_status WHERE user_id=?", d.user).Scan(&disabled)
		if disabled == 1 {
			errText = "账号已停用"
		} else {
			// The run time makes the client ID unique per occurrence, so a
			// restart between sending and rescheduling never sends twice.
			body, _ := json.Marshal(map[string]string{"kind": d.Kind, "text": d.Text, "attachmentId": d.AttachmentID, "clientId": fmt.Sprintf("schedule:%s:%d", d.ID, d.NextRun)})
			req := httptest.NewRequest("POST", "/api/conversations/"+d.ConversationID+"/messages", bytes.NewReader(body))
			req = req.WithContext(context.WithValue(req.Context(), userKey{}, d.user))
			req.SetPathValue("id", d.ConversationID)
			rec := httptest.NewRecorder()
			s.sendMessage(rec, req)
			if rec.Code != 200 {
				var e struct{ Error string }
				_ = json.Unmarshal(rec.Body.Bytes(), &e)
				errText = e.Error
				if errText == "" {
					errText = fmt.Sprintf("发送失败（%d）", rec.Code)
				}
			}
		}
		switch d.Repeat {
		case "daily":
			next := d.NextRun
			for next <= now() {
				next += 24 * 3600 * 1000
			}
			_, _ = s.db.Exec("UPDATE scheduled_messages SET next_run=?,last_run=?,last_error=? WHERE id=?", next, now(), errText, d.ID)
		case "weekdays":
			_, _ = s.db.Exec("UPDATE scheduled_messages SET next_run=?,last_run=?,last_error=? WHERE id=?", nextWeekday(now(), d.NextRun, d.TZOffset), now(), errText, d.ID)
		default:
			_, _ = s.db.Exec("DELETE FROM scheduled_messages WHERE id=?", d.ID)
		}
		if errText != "" && s.logger != nil {
			s.logger.Printf("scheduled message %s: %s", d.ID, errText)
		}
		s.push([]string{d.user}, "schedules", map[string]any{})
	}
}
