package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
)

func TestDriveFolderOwnershipMoveDeleteAndPermanentShare(t *testing.T) {
	f := setupCommunity(t)
	a, b := f.register("folder_alice"), f.register("folder_bobby")
	create := func(token, parent, name string) driveFolder {
		var folder driveFolder
		f.request("POST", "/api/drive/folders", token, map[string]string{"name": name, "parentId": parent}, 200, &folder)
		return folder
	}
	root := create(a.Token, "", "项目")
	child := create(a.Token, root.ID, "图片")
	other := create(b.Token, "", "项目")
	f.request("POST", "/api/drive/folders", a.Token, map[string]string{"name": "项目"}, 409, nil)
	f.request("POST", "/api/drive/folders", a.Token, map[string]string{"name": "../无效"}, 400, nil)
	f.request("POST", "/api/drive/folders", b.Token, map[string]string{"name": "偷建", "parentId": root.ID}, 404, nil)
	f.request("GET", "/api/drive?folder="+root.ID, b.Token, nil, 404, nil)
	f.request("PATCH", "/api/drive/folders/"+root.ID, b.Token, map[string]string{"name": "偷改"}, 404, nil)
	f.request("DELETE", "/api/drive/folders/"+root.ID, b.Token, map[string]string{"confirmName": root.Name}, 404, nil)
	status, raw := storageUpload(t, f, "/api/drive/files?folder="+child.ID, a.Token, "test.txt", strings.NewReader("hello"), "")
	if status != 200 {
		t.Fatalf("upload %d %s", status, raw)
	}
	var file driveFile
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	var list struct {
		Files   []driveFile
		Folders []driveFolder
		Path    []driveFolder
		Used    int64
	}
	f.request("GET", "/api/drive?folder=", a.Token, nil, 200, &list)
	if len(list.Files) != 0 || len(list.Folders) != 1 || list.Used != 5 {
		t.Fatal("root scope or account quota incorrect", list)
	}
	f.request("GET", "/api/drive?folder="+child.ID, a.Token, nil, 200, &list)
	if len(list.Files) != 1 || len(list.Path) != 2 || list.Files[0].FolderID != child.ID {
		t.Fatal("child listing", list)
	}
	f.request("GET", "/api/drive", a.Token, nil, 200, &list)
	if len(list.Files) != 1 {
		t.Fatal("legacy flat listing lost files")
	}
	var share, again struct {
		URL     string
		Expires int64
	}
	f.request("POST", "/api/drive/files/"+file.ID+"/share", a.Token, map[string]int{"days": 1}, 200, &share)
	f.request("POST", "/api/drive/files/"+file.ID+"/share", a.Token, map[string]int{"days": 7}, 200, &again)
	if share.URL != again.URL || share.Expires != 0 {
		t.Fatal("share rotated or expires")
	}
	shared, _ := url.Parse(share.URL)
	checkShare := func(want int) {
		response, err := http.Get(f.url + shared.Path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != want {
			t.Fatalf("share status %d", response.StatusCode)
		}
		if want == 200 && !strings.Contains(string(body), "永久有效") {
			t.Fatal("missing permanent label")
		}
	}
	f.request("POST", "/api/drive/files/"+file.ID+"/move", a.Token, map[string]string{"folderId": other.ID}, 404, nil)
	f.request("POST", "/api/drive/files/"+file.ID+"/move", b.Token, map[string]string{"folderId": other.ID}, 404, nil)
	f.request("POST", "/api/drive/files/"+file.ID+"/move", a.Token, map[string]string{"folderId": ""}, 200, nil)
	f.request("GET", "/api/drive?folder=", a.Token, nil, 200, &list)
	if len(list.Files) != 1 || list.Used != 5 {
		t.Fatal("move lost data or quota")
	}
	checkShare(200)
	f.request("POST", "/api/drive/files/"+file.ID+"/move", a.Token, map[string]string{"folderId": child.ID}, 200, nil)
	f.request("PATCH", "/api/drive/folders/"+root.ID, a.Token, map[string]string{"name": "改名后"}, 200, nil)
	f.request("DELETE", "/api/drive/folders/"+root.ID, a.Token, map[string]string{"confirmName": root.Name}, 409, nil)
	f.request("DELETE", "/api/drive/folders/"+root.ID, a.Token, map[string]string{"confirmName": "改名后"}, 200, nil)
	f.request("GET", "/api/drive?folder="+child.ID, a.Token, nil, 404, nil)
	checkShare(404)
	f.request("GET", "/api/drive?folder=", a.Token, nil, 200, &list)
	if len(list.Files) != 0 || len(list.Folders) != 0 || list.Used != 0 {
		t.Fatal("recursive delete retained data", list)
	}
	if _, err := os.Stat(f.s.drivePath(a.User.ID, file.ID)); !os.IsNotExist(err) {
		t.Fatal("deleted folder retained blob", err)
	}
	f.request("GET", "/api/drive?folder=", b.Token, nil, 200, &list)
	if len(list.Folders) != 1 {
		t.Fatal("deleted another user's folder")
	}
}

func TestDriveFolderLimitsAndShareMigration(t *testing.T) {
	f := setupCommunity(t)
	a := f.register("folder_limits")
	f.s.settings.Drive.MaxFolderDepth = 1
	f.s.settings.Drive.MaxFolders = 1
	var folder driveFolder
	f.request("POST", "/api/drive/folders", a.Token, map[string]string{"name": "one"}, 200, &folder)
	f.request("POST", "/api/drive/folders", a.Token, map[string]string{"name": "child", "parentId": folder.ID}, 409, nil)
	f.request("POST", "/api/drive/folders", a.Token, map[string]string{"name": "two"}, 409, nil)
	status, raw := storageUpload(t, f, "/api/drive/files", a.Token, "share.txt", strings.NewReader("test"), "")
	if status != 200 {
		t.Fatal(status)
	}
	var file driveFile
	json.Unmarshal(raw, &file)
	for _, item := range []struct {
		token   string
		expires int64
	}{{strings.Repeat("a", 64), now() + 60000}, {strings.Repeat("b", 64), now() - 60000}, {strings.Repeat("c", 64), 0}} {
		if _, err := f.s.db.Exec("INSERT INTO drive_shares VALUES(?,?,?,?)", item.token, file.ID, now(), item.expires); err != nil {
			t.Fatal(err)
		}
	}
	db, err := openStore(f.s.dir)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var active, expired int64
	db.QueryRow("SELECT expires FROM drive_shares WHERE token=?", strings.Repeat("a", 64)).Scan(&active)
	db.QueryRow("SELECT expires FROM drive_shares WHERE token=?", strings.Repeat("b", 64)).Scan(&expired)
	if active != 0 || expired <= 0 || expired >= now() {
		t.Fatal("migration must keep expired links expired")
	}
	for _, item := range []struct {
		token  string
		status int
	}{{"a", 200}, {"b", 404}, {"c", 200}} {
		response, err := http.Get(f.url + "/share/" + strings.Repeat(item.token, 64))
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != item.status {
			t.Fatal("migration public status", item.token, response.StatusCode)
		}
	}
	f.request("DELETE", "/api/drive/files/"+file.ID+"/share", a.Token, nil, 200, nil)
	var count int
	db.QueryRow("SELECT COUNT(*) FROM drive_shares WHERE file_id=?", file.ID).Scan(&count)
	if count != 0 {
		t.Fatal("revoke left active links")
	}
}
