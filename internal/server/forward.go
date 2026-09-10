package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"
)

const maxForwardSelection = 100
const maxForwardNodes = 1000
const maxForwardBytes = 1 << 20

type forwardItem struct {
	Name         string           `json:"name"`
	Avatar       string           `json:"avatar"`
	Created      int64            `json:"created"`
	Kind         string           `json:"kind"`
	Text         string           `json:"text"`
	AttachmentID string           `json:"attachmentId,omitempty"`
	FileName     string           `json:"fileName,omitempty"`
	FileSize     int64            `json:"fileSize,omitempty"`
	MIME         string           `json:"mime,omitempty"`
	Quote        *forwardQuote    `json:"quote,omitempty"`
	Record       *forwardDocument `json:"record,omitempty"`
}
type forwardQuote struct {
	Name string `json:"name"`
	Text string `json:"text"`
}
type forwardDocument struct {
	Title string        `json:"title"`
	Items []forwardItem `json:"items"`
}
type forwardCard struct {
	Title   string   `json:"title"`
	Preview []string `json:"preview"`
	Count   int      `json:"count"`
}
type forwardRequest struct {
	ConversationID string   `json:"conversationId"`
	MessageIDs     []string `json:"messageIds"`
	Targets        []string `json:"targets"`
	Mode           string   `json:"mode"`
	Note           string   `json:"note"`
	ClientID       string   `json:"clientId"`
}
type forwardResult struct {
	IDs           []string `json:"ids"`
	Conversations []string `json:"conversations"`
	Count         int      `json:"count"`
}
type forwardError struct {
	status  int
	message string
}

func (e *forwardError) Error() string           { return e.message }
func forwardFail(status int, text string) error { return &forwardError{status, text} }
func forwardMember(tx *sql.Tx, cid, user string) bool {
	var n int
	return tx.QueryRow("SELECT 1 FROM members WHERE conversation_id=? AND user_id=?", cid, user).Scan(&n) == nil
}
func uniqueIDs(ids []string, limit int) ([]string, bool) {
	if len(ids) == 0 || len(ids) > limit {
		return nil, false
	}
	seen := map[string]bool{}
	out := []string{}
	for _, id := range ids {
		if len(id) != 32 {
			return nil, false
		}
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	sort.Strings(out)
	return out, true
}

func (s *Server) forwardMessages(w http.ResponseWriter, r *http.Request) {
	var p forwardRequest
	if !decode(w, r, &p) {
		return
	}
	var valid bool
	if p.MessageIDs, valid = uniqueIDs(p.MessageIDs, maxForwardSelection); !valid {
		fail(w, 400, "请选择 1–100 条消息")
		return
	}
	if p.Targets, valid = uniqueIDs(p.Targets, 9); !valid {
		fail(w, 400, "请选择 1–9 个会话")
		return
	}
	if (p.Mode != "each" && p.Mode != "merge") || len(p.ClientID) < 8 || len(p.ClientID) > 100 || !validText(p.Note, 600) {
		fail(w, 400, "转发参数无效")
		return
	}
	p.Note = strings.TrimSpace(p.Note)
	if !s.rate(r, "forward:"+uid(r), 20, time.Minute) {
		fail(w, 429, "转发过于频繁，请稍后再试")
		return
	}
	result, messages, err := s.performForward(uid(r), p)
	if err != nil {
		var known *forwardError
		if errors.As(err, &known) {
			fail(w, known.status, known.message)
		} else {
			s.dbError(w, err)
		}
		return
	}
	for _, m := range messages {
		s.pushConversation(m.ConversationID, "message", m)
	}
	ok(w, result)
}

func (s *Server) performForward(user string, p forwardRequest) (forwardResult, []Message, error) {
	var result forwardResult
	fingerprintData, _ := json.Marshal(p)
	fingerprint := hashToken(string(fingerprintData))
	tx, err := s.db.Begin()
	if err != nil {
		return result, nil, err
	}
	defer tx.Rollback()
	var priorFingerprint, priorResult string
	err = tx.QueryRow("SELECT fingerprint,result FROM forward_batches WHERE user_id=? AND client_id=?", user, p.ClientID).Scan(&priorFingerprint, &priorResult)
	if err == nil {
		if priorFingerprint != fingerprint {
			return result, nil, forwardFail(409, "转发标识重复，请重试")
		}
		err = json.Unmarshal([]byte(priorResult), &result)
		return result, nil, err
	}
	if err != sql.ErrNoRows {
		return result, nil, err
	}
	if !forwardMember(tx, p.ConversationID, user) {
		return result, nil, forwardFail(403, "无权访问原聊天")
	}
	for _, cid := range p.Targets {
		if !forwardMember(tx, cid, user) {
			return result, nil, forwardFail(403, "无权向所选会话转发")
		}
	}
	sources := make([]Message, 0, len(p.MessageIDs))
	for _, id := range p.MessageIDs {
		m, err := scanMessage(tx.QueryRow(messageQuery+"WHERE m.id=? AND m.conversation_id=? AND m.recalled=0 AND "+messageVisible, id, p.ConversationID, user))
		if err != nil {
			if err == sql.ErrNoRows {
				return result, nil, forwardFail(400, "所选消息已删除、撤回或不可访问")
			}
			return result, nil, err
		}
		sources = append(sources, m)
	}
	sort.Slice(sources, func(i, j int) bool { return sources[i].Seq < sources[j].Seq })
	doc := forwardDocument{Title: forwardTitle(sources), Items: make([]forwardItem, 0, len(sources))}
	for _, m := range sources {
		item := forwardItem{Name: m.Name, Avatar: m.Avatar, Created: m.Created, Kind: m.Kind, Text: m.Text, AttachmentID: m.AttachmentID, FileName: m.FileName, FileSize: m.FileSize, MIME: m.MIME}
		if m.Reply != nil {
			item.Quote = &forwardQuote{Name: m.Reply.Name, Text: forwardPreview(m.Reply.Kind, m.Reply.Text, m.Reply.FileName, m.Reply.Recalled)}
		}
		if m.Kind == "forward" {
			var data string
			if err = tx.QueryRow("SELECT data FROM forward_records WHERE message_id=?", m.ID).Scan(&data); err != nil {
				return result, nil, err
			}
			if len(data) > maxForwardBytes {
				return result, nil, forwardFail(400, "聊天记录过大")
			}
			var nested forwardDocument
			if err = json.Unmarshal([]byte(data), &nested); err != nil {
				return result, nil, err
			}
			item.Record = &nested
		}
		doc.Items = append(doc.Items, item)
	}
	nodes := 0
	if err = checkForwardDocument(&doc, 0, &nodes); err != nil {
		return result, nil, err
	}
	serialized, _ := json.Marshal(doc)
	if len(serialized) > maxForwardBytes {
		return result, nil, forwardFail(400, "聊天记录超过 1 MB，请减少所选消息")
	}
	created := now()
	messages := []Message{}
	result.Conversations = p.Targets
	result.IDs = []string{}
	for _, cid := range p.Targets {
		// Each destination receives its own attachment IDs and scoped authorization.
		var snapshot forwardDocument
		if err = json.Unmarshal(serialized, &snapshot); err != nil {
			return result, nil, err
		}
		if err = cloneForwardAttachments(tx, &snapshot, cid, user, p.ConversationID); err != nil {
			return result, nil, err
		}
		add := func(kind, text, attachment string, record *forwardDocument) error {
			id := newID()
			clientID := "forward-" + newID()
			if _, e := tx.Exec("INSERT INTO messages(id,conversation_id,sender,kind,text,attachment_id,client_id,created) VALUES(?,?,?,?,?,?,?,?)", id, cid, user, kind, text, attachment, clientID, created); e != nil {
				return e
			}
			if record != nil {
				data, e := json.Marshal(record)
				if e != nil {
					return e
				}
				if _, e = tx.Exec("INSERT INTO forward_records VALUES(?,?)", id, string(data)); e != nil {
					return e
				}
			}
			m, e := scanMessage(tx.QueryRow(messageQuery+"WHERE m.id=?", id))
			if e != nil {
				return e
			}
			messages = append(messages, m)
			result.IDs = append(result.IDs, id)
			return nil
		}
		if p.Mode == "merge" {
			if err = add("forward", forwardSummary(&snapshot), "", &snapshot); err != nil {
				return result, nil, err
			}
		} else {
			for _, item := range snapshot.Items {
				text := item.Text
				if item.Record != nil {
					text = forwardSummary(item.Record)
				}
				if err = add(item.Kind, text, item.AttachmentID, item.Record); err != nil {
					return result, nil, err
				}
			}
		}
		if p.Note != "" {
			if err = add("text", p.Note, "", nil); err != nil {
				return result, nil, err
			}
		}
	}
	result.Count = len(result.IDs)
	resultData, _ := json.Marshal(result)
	if _, err = tx.Exec("INSERT INTO forward_batches VALUES(?,?,?,?,?)", user, p.ClientID, fingerprint, string(resultData), created); err != nil {
		return result, nil, err
	}
	if err = tx.Commit(); err != nil {
		return result, nil, err
	}
	return result, messages, nil
}

func forwardTitle(messages []Message) string {
	names := []string{}
	seen := map[string]bool{}
	for _, m := range messages {
		if !seen[m.Name] {
			seen[m.Name] = true
			names = append(names, m.Name)
		}
	}
	if len(names) > 2 {
		return "群聊的聊天记录"
	}
	return strings.Join(names, "和") + "的聊天记录"
}
func forwardPreview(kind, text, file string, recalled bool) string {
	if recalled {
		return "消息已撤回"
	}
	switch kind {
	case "image":
		return "[图片]"
	case "file":
		return "[文件] " + file
	case "meeting":
		return "[会议]"
	case "forward":
		return "[聊天记录]"
	}
	return text
}
func forwardSummary(doc *forwardDocument) string {
	card := forwardCard{Title: doc.Title, Count: len(doc.Items), Preview: []string{}}
	for _, item := range doc.Items {
		line := item.Name + "：" + forwardPreview(item.Kind, item.Text, item.FileName, false)
		runes := []rune(line)
		if len(runes) > 100 {
			line = string(runes[:100]) + "…"
		}
		card.Preview = append(card.Preview, line)
		if len(card.Preview) == 3 {
			break
		}
	}
	data, _ := json.Marshal(card)
	return string(data)
}
func checkForwardDocument(doc *forwardDocument, depth int, nodes *int) error {
	if depth > 8 {
		return forwardFail(400, "聊天记录嵌套过深，请减少合并层数")
	}
	for _, item := range doc.Items {
		*nodes = *nodes + 1
		if *nodes > maxForwardNodes {
			return forwardFail(400, "聊天记录内容过多，请减少所选消息")
		}
		if item.Record != nil {
			if err := checkForwardDocument(item.Record, depth+1, nodes); err != nil {
				return err
			}
		}
	}
	return nil
}
func cloneForwardAttachments(tx *sql.Tx, doc *forwardDocument, cid, user, sourceCID string) error {
	for index := range doc.Items {
		item := &doc.Items[index]
		if item.AttachmentID != "" {
			var name, mime, blob, origin string
			var size int64
			if err := tx.QueryRow("SELECT a.name,a.mime,a.size,COALESCE(b.blob_id,a.id),a.conversation_id FROM attachments a LEFT JOIN attachment_blobs b ON b.attachment_id=a.id WHERE a.id=?", item.AttachmentID).Scan(&name, &mime, &size, &blob, &origin); err != nil {
				return err
			}
			if origin != sourceCID {
				return forwardFail(403, "附件不属于原聊天")
			}
			id := newID()
			if _, err := tx.Exec("INSERT INTO attachments VALUES(?,?,?,?,?,?,?)", id, user, cid, name, mime, size, now()); err != nil {
				return err
			}
			if _, err := tx.Exec("INSERT INTO attachment_blobs VALUES(?,?)", id, blob); err != nil {
				return err
			}
			item.AttachmentID = id
			item.FileName = name
			item.FileSize = size
			item.MIME = mime
		}
		if item.Record != nil {
			if err := cloneForwardAttachments(tx, item.Record, cid, user, sourceCID); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Server) forwardRecord(w http.ResponseWriter, r *http.Request) {
	var data string
	err := s.db.QueryRow("SELECT f.data FROM forward_records f JOIN messages m ON m.id=f.message_id JOIN members x ON x.conversation_id=m.conversation_id WHERE m.id=? AND x.user_id=? AND m.recalled=0 AND ("+messageVisible+"OR EXISTS(SELECT 1 FROM favorites saved WHERE saved.message_id=m.id AND saved.user_id=?))", r.PathValue("id"), uid(r), uid(r), uid(r)).Scan(&data)
	if err != nil {
		if err == sql.ErrNoRows {
			fail(w, 404, "聊天记录已删除、撤回或不可访问")
		} else {
			s.dbError(w, err)
		}
		return
	}
	var doc forwardDocument
	if err = json.Unmarshal([]byte(data), &doc); err != nil {
		s.dbError(w, err)
		return
	}
	ok(w, doc)
}

func (s *Server) deleteMessages(w http.ResponseWriter, r *http.Request) {
	var p struct {
		MessageIDs []string `json:"messageIds"`
	}
	if !decode(w, r, &p) {
		return
	}
	ids, valid := uniqueIDs(p.MessageIDs, maxForwardSelection)
	if !valid {
		fail(w, 400, "请选择 1–100 条消息")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	cid := r.PathValue("id")
	if !forwardMember(tx, cid, uid(r)) {
		fail(w, 403, "无权访问该聊天")
		return
	}
	for _, id := range ids {
		var value int
		if tx.QueryRow("SELECT 1 FROM messages WHERE id=? AND conversation_id=?", id, cid).Scan(&value) != nil {
			fail(w, 400, "所选消息不属于该聊天")
			return
		}
	}
	for _, id := range ids {
		if _, err = tx.Exec("INSERT OR IGNORE INTO message_deletions VALUES(?,?,?)", uid(r), id, now()); err != nil {
			s.dbError(w, err)
			return
		}
	}
	if err = tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	for _, id := range ids {
		s.push([]string{uid(r)}, "message-deleted", map[string]string{"id": id, "conversationId": cid})
	}
	ok(w, map[string]any{"deleted": len(ids)})
}
