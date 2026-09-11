package server

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
)

const driveFolderSchema = `
CREATE TABLE IF NOT EXISTS drive_folders(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),parent_id TEXT NOT NULL DEFAULT '',name TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS drive_folder_names ON drive_folders(owner,parent_id,name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS drive_folder_files(file_id TEXT PRIMARY KEY REFERENCES drive_files(id) ON DELETE CASCADE,folder_id TEXT NOT NULL REFERENCES drive_folders(id));
CREATE INDEX IF NOT EXISTS drive_folder_children ON drive_folder_files(folder_id);
`

type driveFolder struct {
	ID       string `json:"id"`
	ParentID string `json:"parentId"`
	Name     string `json:"name"`
	Created  int64  `json:"created"`
	Updated  int64  `json:"updated"`
}

func driveFolderPath(q rowQuery, owner, id string) ([]driveFolder, error) {
	path := []driveFolder{}
	seen := map[string]bool{}
	for id != "" {
		if seen[id] || len(path) >= 128 {
			return nil, errors.New("文件夹层级无效")
		}
		seen[id] = true
		var folder driveFolder
		if err := q.QueryRow("SELECT id,parent_id,name,created,updated FROM drive_folders WHERE id=? AND owner=?", id, owner).Scan(&folder.ID, &folder.ParentID, &folder.Name, &folder.Created, &folder.Updated); err != nil {
			return nil, err
		}
		path = append(path, folder)
		id = folder.ParentID
	}
	for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
		path[i], path[j] = path[j], path[i]
	}
	return path, nil
}

func (s *Server) childDriveFolders(owner, parent, query string) ([]driveFolder, error) {
	rows, err := s.db.Query("SELECT id,parent_id,name,created,updated FROM drive_folders WHERE owner=? AND parent_id=? AND name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE,id", owner, parent, "%"+escapeLike(query)+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	folders := []driveFolder{}
	for rows.Next() {
		var f driveFolder
		if err = rows.Scan(&f.ID, &f.ParentID, &f.Name, &f.Created, &f.Updated); err != nil {
			return nil, err
		}
		folders = append(folders, f)
	}
	return folders, rows.Err()
}

func (s *Server) createDriveFolder(w http.ResponseWriter, r *http.Request) {
	var p struct{ Name, ParentID string }
	if !decode(w, r, &p) {
		return
	}
	p.Name = strings.TrimSpace(p.Name)
	if !safeFileName(p.Name) {
		fail(w, 400, "文件夹名称无效")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	path, err := driveFolderPath(tx, uid(r), p.ParentID)
	if err != nil {
		fail(w, 404, "上级文件夹不存在")
		return
	}
	if len(path) >= s.settings.Drive.MaxFolderDepth {
		fail(w, 409, "文件夹层级已达上限")
		return
	}
	var count int
	if err = tx.QueryRow("SELECT COUNT(*) FROM drive_folders WHERE owner=?", uid(r)).Scan(&count); err != nil {
		s.dbError(w, err)
		return
	}
	if count >= s.settings.Drive.MaxFolders {
		fail(w, 409, "文件夹数量已达上限")
		return
	}
	if err = tx.QueryRow("SELECT COUNT(*) FROM drive_folders WHERE owner=? AND parent_id=? AND name=? COLLATE NOCASE", uid(r), p.ParentID, p.Name).Scan(&count); err != nil {
		s.dbError(w, err)
		return
	}
	if count > 0 {
		fail(w, 409, "当前目录已有同名文件夹")
		return
	}
	f := driveFolder{ID: newID(), ParentID: p.ParentID, Name: p.Name, Created: now(), Updated: now()}
	if _, err = tx.Exec("INSERT INTO drive_folders VALUES(?,?,?,?,?,?)", f.ID, uid(r), f.ParentID, f.Name, f.Created, f.Updated); err != nil {
		s.dbError(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	s.push([]string{uid(r)}, "drive", map[string]bool{"ok": true})
	ok(w, f)
}

func (s *Server) renameDriveFolder(w http.ResponseWriter, r *http.Request) {
	var p struct{ Name string }
	if !decode(w, r, &p) {
		return
	}
	p.Name = strings.TrimSpace(p.Name)
	if !safeFileName(p.Name) {
		fail(w, 400, "文件夹名称无效")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	path, err := driveFolderPath(tx, uid(r), r.PathValue("id"))
	if err != nil || len(path) == 0 {
		fail(w, 404, "文件夹不存在")
		return
	}
	folder := path[len(path)-1]
	var count int
	if err = tx.QueryRow("SELECT COUNT(*) FROM drive_folders WHERE owner=? AND parent_id=? AND name=? COLLATE NOCASE AND id<>?", uid(r), folder.ParentID, p.Name, folder.ID).Scan(&count); err != nil {
		s.dbError(w, err)
		return
	}
	if count > 0 {
		fail(w, 409, "当前目录已有同名文件夹")
		return
	}
	if _, err = tx.Exec("UPDATE drive_folders SET name=?,updated=? WHERE id=? AND owner=?", p.Name, now(), folder.ID, uid(r)); err != nil {
		s.dbError(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	s.push([]string{uid(r)}, "drive", map[string]bool{"ok": true})
	ok(w, map[string]bool{"ok": true})
}

func (s *Server) moveDriveFile(w http.ResponseWriter, r *http.Request) {
	var p struct{ FolderID string }
	if !decode(w, r, &p) {
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	if _, err = driveFolderPath(tx, uid(r), p.FolderID); err != nil {
		fail(w, 404, "目标文件夹不存在")
		return
	}
	var exists int
	if err = tx.QueryRow("SELECT 1 FROM drive_files WHERE id=? AND owner=?", r.PathValue("id"), uid(r)).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "文件不存在")
		return
	} else if err != nil {
		s.dbError(w, err)
		return
	}
	if _, err = tx.Exec("DELETE FROM drive_folder_files WHERE file_id=?", r.PathValue("id")); err != nil {
		s.dbError(w, err)
		return
	}
	if p.FolderID != "" {
		if _, err = tx.Exec("INSERT INTO drive_folder_files VALUES(?,?)", r.PathValue("id"), p.FolderID); err != nil {
			s.dbError(w, err)
			return
		}
	}
	if _, err = tx.Exec("UPDATE drive_files SET updated=? WHERE id=?", now(), r.PathValue("id")); err != nil {
		s.dbError(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	s.push([]string{uid(r)}, "drive", map[string]bool{"ok": true})
	ok(w, map[string]bool{"ok": true})
}

const driveFolderTree = `WITH RECURSIVE tree(id) AS (SELECT id FROM drive_folders WHERE id=? AND owner=? UNION ALL SELECT f.id FROM drive_folders f JOIN tree t ON f.parent_id=t.id WHERE f.owner=?) `

func (s *Server) deleteDriveFolder(w http.ResponseWriter, r *http.Request) {
	var p struct{ ConfirmName string }
	if !decode(w, r, &p) {
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	path, err := driveFolderPath(tx, uid(r), r.PathValue("id"))
	if err != nil || len(path) == 0 {
		fail(w, 404, "文件夹不存在")
		return
	}
	if p.ConfirmName != path[len(path)-1].Name {
		fail(w, 409, "文件夹名称已变化，请重新确认删除")
		return
	}
	args := []any{r.PathValue("id"), uid(r), uid(r)}
	if _, err = tx.Exec(driveFolderTree+"DELETE FROM drive_files WHERE owner=? AND id IN (SELECT file_id FROM drive_folder_files WHERE folder_id IN (SELECT id FROM tree))", append(args, uid(r))...); err != nil {
		s.dbError(w, err)
		return
	}
	if _, err = tx.Exec(driveFolderTree+"DELETE FROM drive_folders WHERE id IN (SELECT id FROM tree)", args...); err != nil {
		s.dbError(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	s.cleanStorage()
	s.push([]string{uid(r)}, "drive", map[string]bool{"ok": true})
	ok(w, map[string]bool{"ok": true})
}
