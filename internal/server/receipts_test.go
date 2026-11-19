package server

import (
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func readsOf(f *fixture, cid string, a account) map[string]memberRead {
	var list []memberRead
	f.request("GET", "/api/conversations/"+cid+"/reads", a.Token, nil, 200, &list)
	out := map[string]memberRead{}
	for _, m := range list {
		out[m.UserID] = m
	}
	return out
}

// nextRead returns the next "read" event, or false if none comes in time.
func nextRead(t *testing.T, ws *websocket.Conn, wait time.Duration) (struct {
	ConversationID, UserID string
	Seq                    int64
}, bool) {
	t.Helper()
	ws.SetReadDeadline(time.Now().Add(wait))
	for {
		var event struct {
			Type string
			Data struct {
				ConversationID, UserID string
				Seq                    int64
			}
		}
		if ws.ReadJSON(&event) != nil {
			return event.Data, false
		}
		if event.Type == "read" {
			return event.Data, true
		}
	}
}

func TestReadReceipts(t *testing.T) {
	f := setup(t)
	a, b, c, d := f.register("receipt_a"), f.register("receipt_b"), f.register("receipt_c"), f.register("receipt_d")
	cid := f.group(a, b, c)
	var first, second Message
	f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, map[string]any{"kind": "text", "text": "第一条", "clientId": "receipt-1"}, 200, &first)
	f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, map[string]any{"kind": "text", "text": "第二条", "clientId": "receipt-2"}, 200, &second)

	// Outsiders cannot see who read what; the caller is not listed.
	f.request("GET", "/api/conversations/"+cid+"/reads", d.Token, nil, 403, nil)
	reads := readsOf(f, cid, a)
	if len(reads) != 2 || reads[b.User.ID].Seq >= first.Seq || reads[c.User.ID].Seq >= first.Seq {
		t.Fatalf("before reading: %+v", reads)
	}

	// b reads the first message: the sender hears about it once.
	ws := f.socket(a)
	f.request("POST", "/api/conversations/"+cid+"/read", b.Token, map[string]int64{"seq": first.Seq}, 200, nil)
	got, okRead := nextRead(t, ws, 2*time.Second)
	if !okRead || got.UserID != b.User.ID || got.Seq != first.Seq || got.ConversationID != cid {
		t.Fatalf("read event: %+v %v", got, okRead)
	}
	f.request("POST", "/api/conversations/"+cid+"/read", b.Token, map[string]int64{"seq": first.Seq}, 200, nil)
	if again, repeated := nextRead(t, ws, 300*time.Millisecond); repeated {
		t.Fatalf("unchanged read position pushed again: %+v", again)
	}
	// Reading never moves backwards.
	f.request("POST", "/api/conversations/"+cid+"/read", b.Token, map[string]int64{"seq": 0}, 200, nil)
	if reads = readsOf(f, cid, a); reads[b.User.ID].Seq != first.Seq {
		t.Fatalf("read position went back: %+v", reads[b.User.ID])
	}

	// 标为已读 without a seq reads everything.
	f.request("POST", "/api/conversations/"+cid+"/read", c.Token, map[string]any{}, 200, nil)
	if reads = readsOf(f, cid, a); reads[c.User.ID].Seq != second.Seq {
		t.Fatalf("mark all read: %+v", reads[c.User.ID])
	}
	var list []map[string]any
	f.request("GET", "/api/conversations", c.Token, nil, 200, &list)
	for _, conv := range list {
		if conv["id"] == cid && conv["unread"].(float64) != 0 {
			t.Fatalf("still unread after 标为已读: %v", conv["unread"])
		}
	}

	// Someone who joins later does not count for the messages before them.
	f.befriend(a, d)
	f.request("POST", "/api/conversations/"+cid+"/members", a.Token, map[string]any{"members": []string{d.User.ID}}, 200, nil)
	if reads = readsOf(f, cid, a); reads[d.User.ID].Joined < second.Seq {
		t.Fatalf("newcomer counted for older messages: %+v", reads[d.User.ID])
	}
}

func TestDirectReadReceipts(t *testing.T) {
	f := setup(t)
	a, b := f.register("receipt_e"), f.register("receipt_f")
	f.befriend(a, b)
	cid := f.direct(a, b)
	if reads := readsOf(f, cid, a); len(reads) != 1 || reads[b.User.ID].Name == "" {
		t.Fatalf("direct reads: %+v", reads)
	}
}
