package server

const directorySchema = `
CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT OR IGNORE INTO app_settings VALUES('all_users','0');
CREATE TABLE IF NOT EXISTS deleted_accounts(user_id TEXT PRIMARY KEY REFERENCES users(id),admin_id TEXT NOT NULL REFERENCES users(id),created INTEGER NOT NULL);
CREATE VIEW IF NOT EXISTS directory_friends AS
 SELECT f.user_id,f.peer_id FROM friends f WHERE (SELECT value FROM app_settings WHERE key='all_users')='0'
 UNION ALL
 SELECT u.id,p.id FROM users u JOIN users p ON p.id<>u.id WHERE (SELECT value FROM app_settings WHERE key='all_users')='1'
 AND NOT EXISTS(SELECT 1 FROM deleted_accounts d WHERE d.user_id=u.id OR d.user_id=p.id)
 AND NOT EXISTS(SELECT 1 FROM contact_blocks b WHERE (b.user_id=u.id AND b.peer_id=p.id) OR (b.user_id=p.id AND b.peer_id=u.id));
`
