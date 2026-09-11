package server

import (
	"database/sql"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const storageMarker = "welink-storage-v1\n"
const storageSchema = `
CREATE TABLE IF NOT EXISTS storage_objects(kind TEXT NOT NULL,owner TEXT NOT NULL,id TEXT NOT NULL,volume TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(kind,owner,id));
CREATE INDEX IF NOT EXISTS storage_pending_cleanup ON storage_objects(deleted);
INSERT OR IGNORE INTO storage_objects(kind,owner,id,volume) SELECT 'uploads','',a.id,'primary' FROM attachments a WHERE NOT EXISTS(SELECT 1 FROM attachment_blobs b WHERE b.attachment_id=a.id);
INSERT OR IGNORE INTO storage_objects(kind,owner,id,volume) SELECT 'yunpan',owner,id,'primary' FROM drive_files;
INSERT OR IGNORE INTO storage_objects(kind,owner,id,volume) SELECT 'spaces',owner,blob,'primary' FROM space_documents;
CREATE TRIGGER IF NOT EXISTS drive_storage_deleted AFTER DELETE ON drive_files BEGIN UPDATE storage_objects SET deleted=1 WHERE kind='yunpan' AND owner=OLD.owner AND id=OLD.id; END;
CREATE TRIGGER IF NOT EXISTS space_storage_deleted AFTER DELETE ON space_documents BEGIN UPDATE storage_objects SET deleted=1 WHERE kind='spaces' AND owner=OLD.owner AND id=OLD.blob; END;
CREATE TRIGGER IF NOT EXISTS space_storage_replaced AFTER UPDATE OF blob ON space_documents WHEN OLD.blob<>NEW.blob BEGIN UPDATE storage_objects SET deleted=1 WHERE kind='spaces' AND owner=OLD.owner AND id=OLD.blob; END;
`

func (s *Server) storageVolumes() []StorageVolume {
	return append([]StorageVolume{{ID: "primary", Root: s.storage}}, s.settings.Storage.Volumes...)
}
func (s *Server) volumeReady(volume StorageVolume) error {
	if volume.ID == "primary" && !s.settings.Storage.PrimaryEnabled {
		return errors.New("原存储盘已在配置中停用，请恢复磁盘访问权限后启用")
	}
	if s.settings.Storage.RequireMarker {
		value, err := os.ReadFile(filepath.Join(volume.Root, ".welink-storage"))
		if err != nil || string(value) != storageMarker {
			return errors.New("文件所在磁盘暂不可用，请恢复磁盘挂载")
		}
	}
	info, err := os.Stat(volume.Root)
	if err != nil || !info.IsDir() {
		return errors.New("存储目录暂不可用")
	}
	return nil
}
func (s *Server) initStorage() error {
	s.storage = s.settings.Storage.Root
	if s.storage == "" {
		s.storage = s.dir
	}
	s.uploadSlots = make(chan struct{}, s.settings.Storage.ConcurrentUploads)
	available := false
	for _, volume := range s.storageVolumes() {
		if !s.settings.Storage.RequireMarker {
			if err := os.MkdirAll(volume.Root, 0700); err != nil {
				continue
			}
		}
		if s.volumeReady(volume) != nil {
			continue
		}
		ready := true
		for _, name := range []string{"uploads", "yunpan", "spaces"} {
			if err := os.MkdirAll(filepath.Join(volume.Root, name), 0700); err != nil {
				ready = false
				break
			}
		}
		available = available || ready
	}
	if !available {
		return errors.New("没有可用的存储磁盘，请恢复挂载或在 storage.volumes 配置扩容磁盘")
	}
	return nil
}
func (s *Server) storageReady() error {
	for _, volume := range s.storageVolumes() {
		if s.volumeReady(volume) == nil {
			return nil
		}
	}
	return errors.New("存储磁盘暂不可用，请恢复挂载或添加扩容磁盘")
}
func (s *Server) uploadSlot(w http.ResponseWriter, r *http.Request) bool {
	if err := s.storageReady(); err != nil {
		fail(w, 503, err.Error())
		return false
	}
	select {
	case s.uploadSlots <- struct{}{}:
		return true
	default:
		fail(w, 429, "正在处理其他文件，请稍后重试")
		return false
	}
}
func safeFileName(name string) bool {
	return name != "" && name != "." && name != ".." && validText(name, 240) && !strings.ContainsAny(name, "/\\\x00\r\n")
}
func objectPath(volume StorageVolume, kind, owner, id string) string {
	if kind == "spaces" {
		id += ".md"
	}
	return filepath.Join(volume.Root, kind, owner, id)
}

// Each upload stays on one volume; choose a healthy disk with sufficient space.
func (s *Server) selectStorage(required int64) (StorageVolume, error) {
	if required < 256<<10 {
		required = 256 << 10
	}
	var selected StorageVolume
	var mostFree int64
	for _, volume := range s.storageVolumes() {
		if s.volumeReady(volume) != nil {
			continue
		}
		free, err := storageFree(volume.Root)
		if err != nil || free-s.settings.Storage.ReserveBytes < required {
			continue
		}
		if selected.ID == "" || free > mostFree {
			selected, mostFree = volume, free
		}
	}
	if selected.ID == "" {
		return StorageVolume{}, groupFail(507, "所有可用磁盘空间不足，请扩容后重试")
	}
	return selected, nil
}
func storeLocation(tx *sql.Tx, kind, owner, id string, volume StorageVolume) error {
	_, err := tx.Exec("INSERT INTO storage_objects(kind,owner,id,volume) VALUES(?,?,?,?)", kind, owner, id, volume.ID)
	return err
}
func (s *Server) objectVolume(kind, owner, id string) (StorageVolume, error) {
	volumeID := "primary"
	err := s.db.QueryRow("SELECT volume FROM storage_objects WHERE kind=? AND owner=? AND id=?", kind, owner, id).Scan(&volumeID)
	if err != nil && err != sql.ErrNoRows {
		return StorageVolume{}, err
	}
	for _, volume := range s.storageVolumes() {
		if volume.ID == volumeID {
			return volume, nil
		}
	}
	return StorageVolume{}, errors.New("文件所在磁盘未配置，请恢复原磁盘配置")
}
func (s *Server) storedPath(kind, owner, id string) string {
	volume, err := s.objectVolume(kind, owner, id)
	if err != nil {
		return ""
	}
	return objectPath(volume, kind, owner, id)
}
func (s *Server) openStored(kind, owner, id string) (*os.File, error) {
	volume, err := s.objectVolume(kind, owner, id)
	if err != nil {
		return nil, err
	}
	if err = s.volumeReady(volume); err != nil {
		return nil, err
	}
	return os.Open(objectPath(volume, kind, owner, id))
}

// Failed deletes on an offline disk remain queued until that same disk returns.
func (s *Server) cleanStorage() {
	for _, volume := range s.storageVolumes() {
		if s.volumeReady(volume) != nil {
			continue
		}
		s.cleanStorageVolume(volume)
	}
}
func (s *Server) cleanStorageVolume(volume StorageVolume) {
	rows, err := s.db.Query("SELECT kind,owner,id FROM storage_objects WHERE deleted=1 AND volume=? LIMIT 100", volume.ID)
	if err != nil {
		return
	}
	type pending struct{ kind, owner, id string }
	items := []pending{}
	for rows.Next() {
		var item pending
		if rows.Scan(&item.kind, &item.owner, &item.id) == nil {
			items = append(items, item)
		}
	}
	rows.Close()
	for _, item := range items {
		if s.volumeReady(volume) != nil {
			return
		}
		err = os.Remove(objectPath(volume, item.kind, item.owner, item.id))
		if err == nil || os.IsNotExist(err) {
			_, _ = s.db.Exec("DELETE FROM storage_objects WHERE kind=? AND owner=? AND id=? AND deleted=1", item.kind, item.owner, item.id)
		}
	}
}
func (s *Server) startStorageCleanup() {
	s.storageDone = make(chan struct{})
	go func() {
		defer close(s.storageDone)
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-s.callsStop:
				return
			case <-ticker.C:
				s.cleanStorage()
			}
		}
	}()
}

// Constant-memory writes with mount and free-space checks on the selected disk.
func (s *Server) copyUpload(volume StorageVolume, dst io.Writer, src io.Reader, limit int64) (int64, error) {
	buffer := make([]byte, 256<<10)
	var size, checked int64
	for {
		if size == 0 || size-checked >= 16<<20 {
			if err := s.volumeReady(volume); err != nil {
				return size, err
			}
			free, err := storageFree(volume.Root)
			if err != nil {
				return size, err
			}
			if free < s.settings.Storage.ReserveBytes+int64(len(buffer)) {
				return size, errors.New("存储磁盘剩余空间不足")
			}
			checked = size
		}
		n, err := src.Read(buffer)
		if n > 0 {
			if limit > 0 && size+int64(n) > limit {
				return size, errors.New("文件超过可用容量")
			}
			written, e := dst.Write(buffer[:n])
			size += int64(written)
			if e != nil {
				return size, e
			}
			if written != n {
				return size, io.ErrShortWrite
			}
		}
		if err == io.EOF {
			return size, nil
		}
		if err != nil {
			return size, err
		}
	}
}
