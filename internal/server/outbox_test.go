package server

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestUploadIdempotenceContentConflictsAndIsolation(t *testing.T) {
	f := setup(t)
	a, b, c := f.register("outbox_alice"), f.register("outbox_bobby"), f.register("outbox_carol")
	f.befriend(a, b)
	f.befriend(a, c)
	cid, other := f.direct(a, b), f.direct(a, c)
	key := newID()
	fields := map[string]string{"clientId": key, "mediaKind": "voice"}
	wav := voiceWAV(1250)
	first := mediaUpload(t, f, cid, a, "voice.wav", wav, fields, 200)
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() {
			again := mediaUpload(t, f, cid, a, "voice.wav", wav, fields, 200)
			if again.ID != first.ID || again.Media.DurationMS != 1250 {
				t.Error("retry created another attachment or lost metadata")
			}
		})
	}
	wg.Wait()
	mediaUpload(t, f, cid, a, "changed.wav", wav, fields, 409)
	mediaUpload(t, f, cid, a, "voice.wav", voiceWAV(1800), fields, 409)
	mediaUpload(t, f, other, a, "voice.wav", wav, fields, 409)
	mediaUpload(t, f, cid, a, "voice.wav", wav, map[string]string{"clientId": key}, 409)
	mediaUpload(t, f, cid, a, "voice.wav", wav, map[string]string{"clientId": "bad"}, 400)
	second := mediaUpload(t, f, cid, b, "voice.wav", wav, fields, 200)
	if second.ID == first.ID {
		t.Fatal("upload key crossed accounts")
	}
	var count int
	f.s.db.QueryRow("SELECT COUNT(*) FROM attachments").Scan(&count)
	if count != 2 {
		t.Fatalf("orphan attachment rows: %d", count)
	}
	files, err := os.ReadDir(filepath.Join(f.s.dir, "uploads"))
	if err != nil || len(files) != 2 {
		t.Fatalf("orphan upload files: %d %v", len(files), err)
	}
	f.request("DELETE", "/api/contacts/"+b.User.ID, a.Token, nil, 200, nil)
	mediaUpload(t, f, cid, a, "voice.wav", wav, fields, 403)
}

func TestDeliveryReceiptSurvivesRecallDeletionAndMembershipChanges(t *testing.T) {
	f := setup(t)
	a, b := f.register("receipt_alice"), f.register("receipt_bobby")
	f.befriend(a, b)
	cid := f.direct(a, b)
	key := newID()
	var receipt struct {
		Delivered          bool
		ID, ConversationID string
	}
	f.request("GET", "/api/outbox/"+key, a.Token, nil, 200, &receipt)
	if receipt.Delivered {
		t.Fatal("unsent message reported delivered")
	}
	var message Message
	f.request("POST", "/api/conversations/"+cid+"/messages", a.Token, map[string]string{"text": "receipt test", "clientId": key}, 200, &message)
	f.request("POST", "/api/messages/"+message.ID+"/recall", a.Token, map[string]string{}, 200, nil)
	f.request("DELETE", "/api/messages/"+message.ID, a.Token, nil, 200, nil)
	if _, err := f.s.db.Exec("DELETE FROM members WHERE conversation_id=? AND user_id=?", cid, a.User.ID); err != nil {
		t.Fatal(err)
	}
	f.request("GET", "/api/outbox/"+key, a.Token, nil, 200, &receipt)
	if !receipt.Delivered || receipt.ID != message.ID || receipt.ConversationID != cid {
		t.Fatal("receipt lost after recall/delete/leave")
	}
	receipt.Delivered = false
	f.request("GET", "/api/outbox/"+key, b.Token, nil, 200, &receipt)
	if receipt.Delivered {
		t.Fatal("another account obtained receipt")
	}
	f.request("GET", "/api/outbox/"+key, "", nil, 401, nil)
	f.request("GET", "/api/outbox/bad", a.Token, nil, 400, nil)
}
