package server

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
)

func avatarUpload(t *testing.T, f *fixture, path string, who account, raw []byte, status int) string {
	t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	file, _ := form.CreateFormFile("file", "photo.png")
	file.Write(raw)
	form.Close()
	req, _ := http.NewRequest("POST", f.url+path, &body)
	req.Header.Set("Authorization", "Bearer "+who.Token)
	req.Header.Set("Content-Type", form.FormDataContentType())
	res, e := http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	if res.StatusCode != status {
		t.Fatalf("avatar upload: got %d want %d: %s", res.StatusCode, status, data)
	}
	var out map[string]string
	json.Unmarshal(data, &out)
	return out["avatar"]
}
func avatarGet(t *testing.T, f *fixture, value, token string, status int) []byte {
	t.Helper()
	req, _ := http.NewRequest("GET", f.url+"/api/avatars/"+strings.TrimPrefix(value, "image:"), nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, e := http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	if res.StatusCode != status {
		t.Fatalf("avatar get: got %d want %d: %s", res.StatusCode, status, data)
	}
	if status == 200 && res.Header.Get("Content-Type") != "image/jpeg" {
		t.Fatal(res.Header)
	}
	return data
}
func avatarPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 96, 64))
	for y := 0; y < 64; y++ {
		for x := 0; x < 96; x++ {
			img.SetNRGBA(x, y, color.NRGBA{uint8(x * 2), uint8(y * 3), 170, 200})
		}
	}
	var raw bytes.Buffer
	if e := png.Encode(&raw, img); e != nil {
		t.Fatal(e)
	}
	return append(raw.Bytes(), []byte("discard-source-metadata")...)
}
func TestAvatarNormalizationOwnershipAndProfilePreservation(t *testing.T) {
	f := setup(t)
	a, b := f.register("avatar_owner"), f.register("avatar_reader")
	f.befriend(a, b)
	events := f.socket(b)
	value := avatarUpload(t, f, "/api/me/avatar", a, avatarPNG(t), 200)
	if !strings.HasPrefix(value, "image:") {
		t.Fatal(value)
	}
	data := avatarGet(t, f, value, b.Token, 200)
	config, e := jpeg.DecodeConfig(bytes.NewReader(data))
	if e != nil || config.Width != 512 || config.Height != 512 || bytes.Contains(data, []byte("discard-source-metadata")) {
		t.Fatal(config, e)
	}
	avatarGet(t, f, value, "", 401)
	for {
		var event struct {
			Type string
			Data map[string]string
		}
		if e = events.ReadJSON(&event); e != nil {
			t.Fatal(e)
		}
		if event.Type == "profile" {
			if event.Data["avatar"] != value || event.Data["userId"] != a.User.ID {
				t.Fatal(event)
			}
			break
		}
	}
	var u User
	f.request("PATCH", "/api/me", a.Token, map[string]string{"name": "新昵称", "bio": "签名更新不覆盖图片"}, 200, &u)
	if u.Avatar != value {
		t.Fatal("profile change removed photo")
	}
	f.request("PATCH", "/api/me", b.Token, map[string]string{"name": b.User.Name, "avatar": value}, 400, nil)
	avatarUpload(t, f, "/api/me/avatar", a, []byte("<svg onload=alert(1)></svg>"), 400)
	avatarUpload(t, f, "/api/me/avatar", a, make([]byte, maxAvatarUpload+1), 400)
	newValue := avatarUpload(t, f, "/api/me/avatar", a, avatarPNG(t), 200)
	avatarGet(t, f, value, a.Token, 404)
	avatarGet(t, f, newValue, a.Token, 200)
	f.request("PATCH", "/api/me", a.Token, map[string]string{"name": "新昵称", "avatar": "pink"}, 200, &u)
	if u.Avatar != "pink" {
		t.Fatal(u)
	}
	avatarGet(t, f, newValue, a.Token, 404)
	value = avatarUpload(t, f, "/api/me/avatar", a, avatarPNG(t), 200)
	f.request("DELETE", "/api/me/avatar", a.Token, nil, 200, nil)
	avatarGet(t, f, value, a.Token, 404)
}
func TestGroupAvatarRolesVisibilityAndRevocation(t *testing.T) {
	f := setup(t)
	a, b, c := f.register("group_photo_owner"), f.register("group_photo_member"), f.register("group_photo_outside")
	cid := f.group(a, b)
	path := "/api/groups/" + cid + "/avatar"
	raw := avatarPNG(t)
	avatarUpload(t, f, path, b, raw, 403)
	value := avatarUpload(t, f, path, a, raw, 200)
	if f.groupInfo(cid, b).Avatar != value {
		t.Fatal("missing group photo")
	}
	avatarGet(t, f, value, b.Token, 200)
	avatarGet(t, f, value, c.Token, 404)
	f.request("PATCH", "/api/groups/"+cid, a.Token, map[string]bool{"discoverable": true}, 200, nil)
	avatarGet(t, f, value, c.Token, 200)
	var groups []map[string]any
	f.request("GET", "/api/groups?q="+f.groupInfo(cid, a).Number, c.Token, nil, 200, &groups)
	if len(groups) != 1 || groups[0]["avatar"] != value {
		t.Fatal(groups)
	}
	f.request("PATCH", "/api/groups/"+cid+"/members/"+b.User.ID, a.Token, map[string]bool{"admin": true}, 200, nil)
	newValue := avatarUpload(t, f, path, b, raw, 200)
	avatarGet(t, f, value, a.Token, 404)
	f.request("PATCH", "/api/groups/"+cid+"/members/"+b.User.ID, a.Token, map[string]bool{"admin": false}, 200, nil)
	f.request("DELETE", path, b.Token, nil, 403, nil)
	f.request("DELETE", path, a.Token, nil, 200, nil)
	avatarGet(t, f, newValue, a.Token, 404)
	value = avatarUpload(t, f, path, a, raw, 200)
	f.request("DELETE", "/api/groups/"+cid, a.Token, nil, 200, nil)
	avatarGet(t, f, value, b.Token, 404)
}

func TestAvatarRejectsOversizedDimensionsBeforeDecode(t *testing.T) {
	var raw bytes.Buffer
	if e := png.Encode(&raw, image.NewRGBA(image.Rect(0, 0, 4097, 1))); e != nil {
		t.Fatal(e)
	}
	if _, e := normalizeAvatar(raw.Bytes()); e == nil {
		t.Fatal("oversized image accepted")
	}
	if _, e := normalizeAvatar(avatarPNG(t)[:35]); e == nil {
		t.Fatal("truncated image accepted")
	}
}
