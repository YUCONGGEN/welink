package server

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDisabledPrimaryUsesExpansionStorage(t *testing.T) {
	settings := DefaultSettings()
	settings.DataDir, settings.Storage.Root = t.TempDir(), t.TempDir()
	settings.Registration.Enabled = true
	settings.Storage.PrimaryEnabled = false
	settings.Storage.RequireMarker = true
	settings.Storage.ReserveBytes = 0
	extra := t.TempDir()
	settings.Storage.Volumes = []StorageVolume{{ID: "temporary", Root: extra}}
	for _, root := range []string{settings.Storage.Root, extra} {
		if err := os.WriteFile(filepath.Join(root, ".welink-storage"), []byte(storageMarker), 0600); err != nil {
			t.Fatal(err)
		}
	}
	s, err := New(Config{Settings: &settings})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()
	defer s.Close()
	f := &fixture{t: t, s: s, server: ts, url: ts.URL}
	a := f.register("expansion_user")
	status, raw := storageUpload(t, f, "/api/drive/files", a.Token, "temporary.txt", strings.NewReader("fallback"), "")
	if status != 200 {
		t.Fatalf("upload: %d %s", status, raw)
	}
	var result struct{ ID string }
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	volume, err := s.objectVolume("yunpan", a.User.ID, result.ID)
	if err != nil || volume.ID != "temporary" {
		t.Fatal("disabled primary was selected", err)
	}
	if s.volumeReady(StorageVolume{ID: "primary", Root: settings.Storage.Root}) == nil {
		t.Fatal("disabled primary readable")
	}
	f.request("GET", "/api/drive/files/"+result.ID, a.Token, nil, 200, nil)
}

func TestExpansionDiskOfflineRecoveryAndDeletion(t *testing.T) {
	settings := DefaultSettings()
	settings.DataDir, settings.Storage.Root = t.TempDir(), t.TempDir()
	settings.Registration.Enabled = true
	settings.Storage.RequireMarker = true
	settings.Storage.ReserveBytes = 0
	extra := t.TempDir()
	settings.Storage.Volumes = []StorageVolume{{ID: "expansion", Root: extra}}
	marker := func(root string, present bool) {
		t.Helper()
		path := filepath.Join(root, ".welink-storage")
		var err error
		if present {
			err = os.WriteFile(path, []byte(storageMarker), 0600)
		} else {
			err = os.Remove(path)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	marker(settings.Storage.Root, true)
	f := &fixture{t: t}
	start := func() {
		var err error
		f.s, err = New(Config{Settings: &settings})
		if err != nil {
			t.Fatal(err)
		}
		f.server = httptest.NewServer(f.s.Handler())
		f.url = f.server.URL
	}
	start()
	t.Cleanup(func() { f.server.Close(); f.s.Close() })
	a, b := f.register("disk_owner"), f.register("disk_peer")
	cid := f.direct(a, b)
	upload := func(path, name, content, conversation string) string {
		t.Helper()
		status, raw := storageUpload(t, f, path, a.Token, name, strings.NewReader(content), conversation)
		if status != 200 {
			t.Fatalf("upload: %d %s", status, raw)
		}
		var receipt struct{ ID string }
		if json.Unmarshal(raw, &receipt) != nil {
			t.Fatal("receipt")
		}
		return receipt.ID
	}
	oldDrive := upload("/api/drive/files", "old.txt", "original drive", "")
	oldChat := upload("/api/files", "old-chat.txt", "original chat", cid)
	var doc spaceDocument
	f.request("POST", "/api/spaces/me/documents", a.Token, map[string]any{"title": "old.md", "content": "original doc"}, 200, &doc)
	oldDrivePath := f.s.drivePath(a.User.ID, oldDrive)
	var oldBlob string
	f.s.db.QueryRow("SELECT blob FROM space_documents WHERE id=?", doc.ID).Scan(&oldBlob)
	oldDocPath := f.s.spacePath(a.User.ID, oldBlob)
	marker(settings.Storage.Root, false)
	marker(extra, true)
	f.request("GET", "/api/drive/files/"+oldDrive, a.Token, nil, 503, nil)
	f.request("GET", "/api/files/"+oldChat, a.Token, nil, 503, nil)
	f.request("GET", "/api/spaces/me/documents/"+doc.ID, a.Token, nil, 503, nil)
	newDrive := upload("/api/drive/files", "new.txt", "expanded drive", "")
	newChat := upload("/api/files", "new-chat.txt", "expanded chat", cid)
	f.request("PUT", "/api/spaces/me/documents/"+doc.ID, a.Token, map[string]any{"title": "new.md", "content": "expanded doc", "revision": doc.Revision}, 200, &doc)
	for _, ref := range []struct{ kind, owner, id string }{{"yunpan", a.User.ID, newDrive}, {"uploads", "", newChat}} {
		volume, err := f.s.objectVolume(ref.kind, ref.owner, ref.id)
		if err != nil || volume.ID != "expansion" {
			t.Fatal("new upload did not use expansion disk", err)
		}
	}
	f.request("DELETE", "/api/drive/files/"+oldDrive, a.Token, nil, 200, nil)
	if _, err := os.Stat(oldDrivePath); err != nil {
		t.Fatal("offline physical file was modified", err)
	}
	f.request("GET", "/api/drive/files/"+oldDrive, a.Token, nil, 404, nil)
	marker(settings.Storage.Root, true)
	f.s.cleanStorage()
	for _, path := range []string{oldDrivePath, oldDocPath} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatal("deferred cleanup was not completed")
		}
	}
	f.request("GET", "/api/files/"+oldChat, a.Token, nil, 200, nil)
	marker(settings.Storage.Root, false)
	f.server.Close()
	f.s.Close()
	start()
	f.request("GET", "/api/drive/files/"+newDrive, a.Token, nil, 200, nil)
	f.request("GET", "/api/files/"+newChat, a.Token, nil, 200, nil)
	var reopened spaceDocument
	f.request("GET", "/api/spaces/me/documents/"+doc.ID, a.Token, nil, 200, &reopened)
	if reopened.Content != "expanded doc" {
		t.Fatal("document lost after restart")
	}
	used, _, err := driveUsage(f.s.db, a.User.ID)
	if err != nil || used != int64(len("expanded drive")) {
		t.Fatal("expanded storage changed account quota accounting")
	}
}
