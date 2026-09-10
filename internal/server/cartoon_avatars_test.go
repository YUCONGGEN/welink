package server

import (
	"fmt"
	"strings"
	"testing"
)

func TestCartoonAvatarRegistrationSelectionUploadAndReset(t *testing.T) {
	f := setup(t)
	a := f.register("cartoon_default")
	if !validCartoonAvatar(a.User.Avatar) || a.User.Avatar != defaultCartoonAvatar(a.User.ID) {
		t.Fatal("new account has no stable cartoon default")
	}
	var selected account
	f.request("POST", "/api/auth/register", "", map[string]string{"account": "cartoon_selected", "name": "小兔", "password": "test-password-937!", "avatar": "cartoon:100"}, 200, &selected)
	if selected.User.Avatar != "cartoon:100" {
		t.Fatal(selected.User.Avatar)
	}
	f.request("POST", "/api/auth/register", "", map[string]string{"account": "cartoon_invalid", "name": "无效头像", "password": "test-password-937!", "avatar": "cartoon:101"}, 400, nil)
	for i := 1; i <= 100; i++ {
		avatar := fmt.Sprintf("cartoon:%03d", i)
		var result map[string]string
		f.request("PATCH", "/api/me/avatar", a.Token, map[string]string{"avatar": avatar}, 200, &result)
		if result["avatar"] != avatar {
			t.Fatal(result)
		}
	}
	for _, avatar := range []string{"cartoon:000", "cartoon:101", "cartoon:1", "cartoon:001/../bad", "https://example.org/1.svg", "image:123", "blue"} {
		f.request("PATCH", "/api/me/avatar", a.Token, map[string]string{"avatar": avatar}, 400, nil)
	}
	f.request("PATCH", "/api/me/avatar", "", map[string]string{"avatar": "cartoon:001"}, 401, nil)
	photo := avatarUpload(t, f, "/api/me/avatar", a, avatarPNG(t), 200)
	if !strings.HasPrefix(photo, "image:") {
		t.Fatal(photo)
	}
	f.request("PATCH", "/api/me/avatar", a.Token, map[string]string{"avatar": "cartoon:042"}, 200, nil)
	avatarGet(t, f, photo, a.Token, 404)
	var user User
	f.request("GET", "/api/me", a.Token, nil, 200, &user)
	if user.Avatar != "cartoon:042" || user.Name != a.User.Name {
		t.Fatal("selection changed profile fields", user)
	}
	avatarUpload(t, f, "/api/me/avatar", a, avatarPNG(t), 200)
	f.request("DELETE", "/api/me/avatar", a.Token, nil, 200, nil)
	f.request("GET", "/api/me", a.Token, nil, 200, &user)
	if user.Avatar != defaultCartoonAvatar(a.User.ID) {
		t.Fatal(user.Avatar)
	}
	var other User
	f.request("GET", "/api/me", selected.Token, nil, 200, &other)
	if other.Avatar != "cartoon:100" {
		t.Fatal("other user's selection changed")
	}
}

func TestCartoonAvatarMigrationKeepsPhotosAndChoices(t *testing.T) {
	f := setup(t)
	a, b, c := f.register("cartoon_legacy"), f.register("cartoon_photo"), f.register("cartoon_choice")
	photo := avatarUpload(t, f, "/api/me/avatar", b, avatarPNG(t), 200)
	f.request("PATCH", "/api/me/avatar", c.Token, map[string]string{"avatar": "cartoon:081"}, 200, nil)
	if _, err := f.s.db.Exec("UPDATE users SET avatar='blue' WHERE id=?", a.User.ID); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := migrateCartoonAvatars(f.s.db); err != nil {
			t.Fatal(err)
		}
	}
	for _, test := range []struct{ id, want string }{{a.User.ID, defaultCartoonAvatar(a.User.ID)}, {b.User.ID, photo}, {c.User.ID, "cartoon:081"}} {
		var got string
		if err := f.s.db.QueryRow("SELECT avatar FROM users WHERE id=?", test.id).Scan(&got); err != nil || got != test.want {
			t.Fatal(got, err)
		}
	}
}
