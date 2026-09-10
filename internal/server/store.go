package server

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	_ "modernc.org/sqlite"
	"os"
	"path/filepath"
	"time"
)

const schema = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, account TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password BLOB NOT NULL, avatar TEXT NOT NULL DEFAULT 'blue', bio TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS user_numbers(number INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT UNIQUE REFERENCES users(id));
INSERT INTO sqlite_sequence(name,seq) SELECT 'user_numbers',100000000 WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='user_numbers');
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS session_info(token TEXT PRIMARY KEY REFERENCES sessions(token) ON DELETE CASCADE, id TEXT UNIQUE NOT NULL, device TEXT NOT NULL, created INTEGER NOT NULL, last_seen INTEGER NOT NULL);
INSERT INTO session_info SELECT token,lower(hex(randomblob(16))),'旧版客户端',MAX(0,expires-2592000000),0 FROM sessions WHERE token NOT IN (SELECT token FROM session_info);
CREATE TABLE IF NOT EXISTS friends(user_id TEXT NOT NULL REFERENCES users(id), peer_id TEXT NOT NULL REFERENCES users(id), remark TEXT NOT NULL DEFAULT '', PRIMARY KEY(user_id,peer_id));
CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, sender TEXT NOT NULL REFERENCES users(id), recipient TEXT NOT NULL REFERENCES users(id), message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS request_pending ON requests(sender,recipient) WHERE status='pending';
CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, owner TEXT NOT NULL REFERENCES users(id), direct_key TEXT UNIQUE, announcement TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS members(conversation_id TEXT NOT NULL REFERENCES conversations(id), user_id TEXT NOT NULL REFERENCES users(id), read_seq INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, muted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(conversation_id,user_id));
CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, conversation_id TEXT NOT NULL REFERENCES conversations(id), sender TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, text TEXT NOT NULL, attachment_id TEXT NOT NULL DEFAULT '', reply_id TEXT NOT NULL DEFAULT '', client_id TEXT NOT NULL, recalled INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, UNIQUE(sender,client_id));
CREATE INDEX IF NOT EXISTS message_history ON messages(conversation_id,seq);
CREATE TABLE IF NOT EXISTS message_deletions(user_id TEXT NOT NULL REFERENCES users(id), message_id TEXT NOT NULL REFERENCES messages(id), created INTEGER NOT NULL, PRIMARY KEY(user_id,message_id));
CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id), conversation_id TEXT NOT NULL REFERENCES conversations(id), name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS attachment_blobs(attachment_id TEXT PRIMARY KEY REFERENCES attachments(id), blob_id TEXT NOT NULL REFERENCES attachments(id));
CREATE TABLE IF NOT EXISTS attachment_media(attachment_id TEXT PRIMARY KEY REFERENCES attachments(id),kind TEXT NOT NULL,duration_ms INTEGER NOT NULL,width INTEGER NOT NULL DEFAULT 0,height INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS forward_records(message_id TEXT PRIMARY KEY REFERENCES messages(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS forward_batches(user_id TEXT NOT NULL REFERENCES users(id), client_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(user_id,client_id));
CREATE TABLE IF NOT EXISTS favorites(user_id TEXT NOT NULL REFERENCES users(id), message_id TEXT NOT NULL REFERENCES messages(id), created INTEGER NOT NULL, PRIMARY KEY(user_id,message_id));
CREATE TABLE IF NOT EXISTS remotes(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), requester TEXT NOT NULL REFERENCES users(id), recipient TEXT NOT NULL REFERENCES users(id), host TEXT NOT NULL REFERENCES users(id), mode TEXT NOT NULL, state TEXT NOT NULL, device_id TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, updated INTEGER NOT NULL);
`

func openStore(dir string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Join(dir, "uploads"), 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", filepath.Join(dir, "welink.db"))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	if err = migrateNumbers(db); err != nil {
		db.Close()
		return nil, err
	}
	if _, err = db.Exec(groupSchema); err != nil {
		db.Close()
		return nil, err
	}
	if _, err = db.Exec(contactSchema); err != nil {
		db.Close()
		return nil, err
	}
	if _, err = db.Exec(mentionSchema); err != nil {
		db.Close()
		return nil, err
	}
	if _, err = db.Exec(avatarSchema); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

// Assigned numbers are permanent and separate from editable profile names.
// Reserving skipped values keeps legacy numeric aliases unambiguous at login.
func assignNumber(tx *sql.Tx, id string) error {
	for {
		result, err := tx.Exec("INSERT INTO user_numbers(user_id) VALUES(NULL)")
		if err != nil {
			return err
		}
		number, err := result.LastInsertId()
		if err != nil {
			return err
		}
		var taken int
		if err = tx.QueryRow("SELECT COUNT(*) FROM users WHERE account=CAST(? AS TEXT)", number).Scan(&taken); err != nil {
			return err
		}
		if taken != 0 {
			continue
		}
		_, err = tx.Exec("UPDATE user_numbers SET user_id=? WHERE number=?", id, number)
		return err
	}
}
func migrateNumbers(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rows, err := tx.Query("SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM user_numbers WHERE user_id IS NOT NULL) ORDER BY created,id")
	if err != nil {
		return err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, id := range ids {
		if err = assignNumber(tx, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func now() int64 { return time.Now().UnixMilli() }

type User struct {
	ID             string `json:"id"`
	Number         string `json:"number"`
	Account        string `json:"account"`
	Name           string `json:"name"`
	Avatar         string `json:"avatar"`
	Bio            string `json:"bio"`
	Online         bool   `json:"online"`
	Remark         string `json:"remark,omitempty"`
	Role           string `json:"role,omitempty"`
	Nickname       string `json:"nickname,omitempty"`
	MuteUntil      int64  `json:"muteUntil,omitempty"`
	ContactGroupID string `json:"contactGroupId,omitempty"`
	Note           string `json:"note,omitempty"`
}
type Message struct {
	MentionRecipients []string          `json:"mentionRecipients,omitempty"`
	Mentions          []Mention         `json:"mentions,omitempty"`
	Seq               int64             `json:"seq"`
	ID                string            `json:"id"`
	ConversationID    string            `json:"conversationId"`
	Sender            string            `json:"sender"`
	Kind              string            `json:"kind"`
	Text              string            `json:"text"`
	AttachmentID      string            `json:"attachmentId"`
	ReplyID           string            `json:"replyId"`
	ClientID          string            `json:"clientId"`
	Recalled          bool              `json:"recalled"`
	Created           int64             `json:"created"`
	Name              string            `json:"name"`
	Avatar            string            `json:"avatar"`
	FileName          string            `json:"fileName,omitempty"`
	FileSize          int64             `json:"fileSize,omitempty"`
	MIME              string            `json:"mime,omitempty"`
	DurationMS        int64             `json:"durationMs,omitempty"`
	Width             int               `json:"width,omitempty"`
	Height            int               `json:"height,omitempty"`
	Reply             *MessageReference `json:"reply,omitempty"`
}

type MessageReference struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Text     string `json:"text"`
	FileName string `json:"fileName,omitempty"`
	Recalled bool   `json:"recalled"`
}

const messageQuery = `SELECT m.seq,m.id,m.conversation_id,m.sender,m.kind,m.text,m.attachment_id,m.reply_id,m.client_id,m.recalled,m.created,COALESCE(NULLIF(gn.nickname,''),u.name),u.avatar,COALESCE(a.name,''),COALESCE(a.size,0),COALESCE(a.mime,''),COALESCE(rm.id,''),COALESCE(NULLIF(gr.nickname,''),ru.name,''),COALESCE(rm.kind,''),COALESCE(rm.text,''),COALESCE(ra.name,''),COALESCE(rm.recalled,0),COALESCE(am.duration_ms,0),COALESCE(am.width,0),COALESCE(am.height,0),COALESCE((SELECT data FROM message_mentions WHERE message_id=m.id),'[]'),(SELECT json_group_array(user_id) FROM message_mention_recipients WHERE message_id=m.id) FROM messages m JOIN users u ON u.id=m.sender LEFT JOIN attachments a ON a.id=m.attachment_id LEFT JOIN messages rm ON rm.id=m.reply_id AND rm.conversation_id=m.conversation_id LEFT JOIN users ru ON ru.id=rm.sender LEFT JOIN attachments ra ON ra.id=rm.attachment_id LEFT JOIN attachment_media am ON am.attachment_id=m.attachment_id LEFT JOIN group_members gn ON gn.conversation_id=m.conversation_id AND gn.user_id=m.sender LEFT JOIN group_members gr ON gr.conversation_id=m.conversation_id AND gr.user_id=rm.sender `

const messageVisible = `NOT EXISTS(SELECT 1 FROM message_deletions md WHERE md.message_id=m.id AND md.user_id=?) `

type scanner interface{ Scan(...any) error }

func scanMessage(s scanner) (m Message, err error) {
	var reply MessageReference
	var mentions, recipients string
	err = s.Scan(&m.Seq, &m.ID, &m.ConversationID, &m.Sender, &m.Kind, &m.Text, &m.AttachmentID, &m.ReplyID, &m.ClientID, &m.Recalled, &m.Created, &m.Name, &m.Avatar, &m.FileName, &m.FileSize, &m.MIME, &reply.ID, &reply.Name, &reply.Kind, &reply.Text, &reply.FileName, &reply.Recalled, &m.DurationMS, &m.Width, &m.Height, &mentions, &recipients)
	if err == nil && !m.Recalled {
		err = json.Unmarshal([]byte(mentions), &m.Mentions)
	}
	if err == nil && !m.Recalled {
		err = json.Unmarshal([]byte(recipients), &m.MentionRecipients)
	}
	if reply.ID != "" && !m.Recalled {
		if reply.Recalled {
			reply.Text = ""
			reply.FileName = ""
		}
		m.Reply = &reply
	}
	return
}
