package server

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

type simultaneousUpload struct {
	reader  *bytes.Reader
	ready   chan<- struct{}
	release <-chan struct{}
	started bool
}

func (r *simultaneousUpload) Read(p []byte) (int, error) {
	if !r.started {
		r.started = true
		r.ready <- struct{}{}
		<-r.release
	}
	return r.reader.Read(p)
}

func TestConcurrentDriveUploadsCannotExceedQuota(t *testing.T) {
	f := setupCommunity(t)
	a := f.register("drive_concurrent")
	quota := f.s.settings.driveQuota()
	if _, err := f.s.db.Exec("INSERT INTO drive_files VALUES(?,?,?,?,'application/octet-stream',1,1)", newID(), a.User.ID, "existing quota", quota-1000); err != nil {
		t.Fatal(err)
	}
	ready, release, results := make(chan struct{}, 2), make(chan struct{}), make(chan int, 2)
	for range 2 {
		go func() {
			reader := &simultaneousUpload{reader: bytes.NewReader(make([]byte, 600)), ready: ready, release: release}
			status, _ := storageUpload(t, f, "/api/drive/files", a.Token, "concurrent.bin", reader, "")
			results <- status
		}()
	}
	<-ready
	<-ready
	close(release)
	statuses := map[int]int{}
	for range 2 {
		statuses[<-results]++
	}
	if statuses[200] != 1 || statuses[409]+statuses[507] != 1 {
		t.Fatalf("concurrent upload outcomes: %v", statuses)
	}
	used, count, err := driveUsage(f.s.db, a.User.ID)
	if err != nil || used != quota-400 || count != 2 {
		t.Fatalf("quota or file count changed incorrectly: %d %d %v", used, count, err)
	}
	files, err := os.ReadDir(filepath.Join(f.s.storage, "yunpan", a.User.ID))
	if err != nil || len(files) != 1 {
		t.Fatalf("failed concurrent upload left a physical file: %v", err)
	}
}
