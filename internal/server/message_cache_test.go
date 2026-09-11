package server

import "testing"

func TestCachedMessagesReconcileDeletionRecallAndMembership(t *testing.T) {
	f := setup(t)
	a, b, outsider := f.register("cache_alice"), f.register("cache_bobby"), f.register("cache_other")
	f.befriend(a, b)
	cid := f.direct(a, b)
	kept := sendTestMessage(f, cid, b, "仍可查看", "")
	deleted := sendTestMessage(f, cid, b, "只删除自己的副本", "")
	recalled := sendTestMessage(f, cid, b, "撤回后不能保留缓存原文", "")
	quote := sendTestMessage(f, cid, a, "引用原文", recalled.ID)
	f.request("DELETE", "/api/messages/"+deleted.ID, a.Token, nil, 200, nil)
	f.request("POST", "/api/messages/"+recalled.ID+"/recall", b.Token, nil, 200, nil)
	path := "/api/conversations/" + cid + "/messages/sync"
	input := map[string]any{"ids": []string{quote.ID, deleted.ID, recalled.ID, kept.ID, kept.ID, newID()}}
	var messages []Message
	f.request("POST", path, a.Token, input, 200, &messages)
	if len(messages) != 3 || messages[0].ID != kept.ID || messages[1].ID != recalled.ID || messages[2].ID != quote.ID {
		t.Fatal("incorrect cache reconciliation", messages)
	}
	if !messages[1].Recalled || messages[1].Text != "" || messages[1].AttachmentID != "" || messages[2].Reply == nil || !messages[2].Reply.Recalled || messages[2].Reply.Text != "" {
		t.Fatal("recalled content leaked", messages)
	}
	f.request("POST", path, b.Token, input, 200, &messages)
	if len(messages) != 4 {
		t.Fatal("personal deletion affected peer cache", messages)
	}
	f.request("POST", path, outsider.Token, input, 403, nil)
	f.request("POST", path, "", input, 401, nil)
	if _, err := f.s.db.Exec("DELETE FROM members WHERE conversation_id=? AND user_id=?", cid, a.User.ID); err != nil {
		t.Fatal(err)
	}
	f.request("POST", path, a.Token, input, 403, nil)
}

func TestCachedMessagesValidateIDsAndDoNotCrossConversations(t *testing.T) {
	f := setup(t)
	a, b, c := f.register("cache_valid_a"), f.register("cache_valid_b"), f.register("cache_valid_c")
	f.befriend(a, b)
	f.befriend(a, c)
	cid, other := f.direct(a, b), f.direct(a, c)
	secret := sendTestMessage(f, other, a, "另一会话", "")
	path := "/api/conversations/" + cid + "/messages/sync"
	var result []Message
	f.request("POST", path, b.Token, map[string]any{"ids": []string{secret.ID}}, 200, &result)
	if len(result) != 0 {
		t.Fatal("cross-conversation message returned")
	}
	for _, input := range []any{map[string]any{"ids": []string{}}, map[string]any{"ids": []string{"invalid"}}, map[string]any{"ids": "bad"}, map[string]any{"ids": make([]string, 201)}} {
		f.request("POST", path, a.Token, input, 400, nil)
	}
	settings := DefaultSettings()
	settings.Chat.ReceivedCacheMessages = 0
	if err := settings.Validate(); err != nil {
		t.Fatal("cache cannot be disabled", err)
	}
	settings.Chat.ReceivedCacheBytes = -1
	if settings.Validate() == nil {
		t.Fatal("negative cache limit accepted")
	}
}
