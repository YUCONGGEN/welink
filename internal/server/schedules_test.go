package server

import (
	"testing"
	"time"
)

func TestScheduledMessagesAreSentByTheServer(t *testing.T) {
	f := setup(t)
	a, b, c := f.register("ScheduleA"), f.register("ScheduleB"), f.register("Outsider")
	f.befriend(a, b)
	cid := f.direct(a, b)
	soon := time.Now().Add(time.Minute).UnixMilli()
	var once, daily schedule
	f.request("POST", "/api/schedules", a.Token, map[string]any{"conversationId": cid, "text": "早上好", "at": soon}, 200, &once)
	f.request("POST", "/api/schedules", a.Token, map[string]any{"conversationId": cid, "text": "每日提醒", "at": soon, "repeat": "daily", "tzOffset": 480}, 200, &daily)
	// Only members can schedule into a chat, and repeat/time are validated.
	f.request("POST", "/api/schedules", c.Token, map[string]any{"conversationId": cid, "text": "x", "at": soon}, 403, nil)
	f.request("POST", "/api/schedules", a.Token, map[string]any{"conversationId": cid, "text": "x", "at": soon, "repeat": "hourly"}, 400, nil)
	f.request("POST", "/api/schedules", a.Token, map[string]any{"conversationId": cid, "text": "x", "at": soon - 3600_000}, 400, nil)
	var mine []schedule
	f.request("GET", "/api/schedules", a.Token, nil, 200, &mine)
	if len(mine) != 2 {
		t.Fatal("schedules", mine)
	}
	f.request("GET", "/api/schedules", b.Token, nil, 200, &mine)
	if len(mine) != 0 {
		t.Fatal("another user's schedules visible", mine)
	}
	// Nothing is due yet.
	f.s.sendDueSchedules()
	var history []Message
	f.request("GET", "/api/conversations/"+cid+"/messages", b.Token, nil, 200, &history)
	if len(history) != 0 {
		t.Fatal("sent early", history)
	}
	// Make both due; the server sends them as A, even with A offline.
	f.s.db.Exec("UPDATE scheduled_messages SET next_run=?", time.Now().UnixMilli()-1000)
	f.s.sendDueSchedules()
	f.s.sendDueSchedules() // a second pass must not send twice
	f.request("GET", "/api/conversations/"+cid+"/messages", b.Token, nil, 200, &history)
	if len(history) != 2 || history[0].Sender != a.User.ID {
		t.Fatal("scheduled messages", history)
	}
	f.request("GET", "/api/schedules", a.Token, nil, 200, &mine)
	if len(mine) != 1 || mine[0].ID != daily.ID || mine[0].NextRun < time.Now().Add(23*time.Hour).UnixMilli() {
		t.Fatal("once not removed or daily not rescheduled", mine)
	}
	f.request("DELETE", "/api/schedules/"+daily.ID, b.Token, nil, 404, nil)
	f.request("DELETE", "/api/schedules/"+daily.ID, a.Token, nil, 200, nil)
	f.request("GET", "/api/schedules", a.Token, nil, 200, &mine)
	if len(mine) != 0 {
		t.Fatal("not cancelled", mine)
	}
}

func TestNextWeekdaySkipsWeekends(t *testing.T) {
	// Friday 2026-11-20 09:00 in UTC+8.
	fri := time.Date(2026, 11, 20, 9, 0, 0, 0, time.FixedZone("CST", 8*3600)).UnixMilli()
	next := time.UnixMilli(nextWeekday(fri, fri, 480)).In(time.FixedZone("CST", 8*3600))
	if next.Weekday() != time.Monday || next.Hour() != 9 {
		t.Fatal("next weekday", next)
	}
}
