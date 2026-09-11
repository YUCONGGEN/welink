package server

import "testing"

func TestProfileDetailsReadUpdateAndPreserveForOldClients(t *testing.T) {
	f := setupCommunity(t)
	a, b := f.register("profile_detail_a"), f.register("profile_detail_b")
	f.request("GET", "/api/users/"+a.User.ID, "", nil, 401, nil)
	var u User
	f.request("PATCH", "/api/me", a.Token, map[string]string{"name": "林知夏", "phone": "+86 13800000000", "gender": "female", "jobTitle": "设计师"}, 200, &u)
	if u.Phone != "+86 13800000000" || u.Gender != "female" || u.JobTitle != "设计师" {
		t.Fatal("profile details not saved")
	}
	f.request("GET", "/api/users/"+a.User.ID, b.Token, nil, 200, &u)
	if u.Phone != "+86 13800000000" {
		t.Fatal("profile card details missing")
	}
	// Older clients saving just the name must not erase new fields.
	f.request("PATCH", "/api/me", a.Token, map[string]string{"name": "新昵称", "bio": "签名"}, 200, &u)
	if u.JobTitle != "设计师" || u.Gender != "female" {
		t.Fatal("old profile update erased details")
	}
	f.request("PATCH", "/api/me", a.Token, map[string]string{"name": "坏更新", "phone": "<script>"}, 400, nil)
	f.request("PATCH", "/api/me", a.Token, map[string]string{"name": "坏更新", "gender": "invalid"}, 400, nil)
	f.request("GET", "/api/me", a.Token, nil, 200, &u)
	if u.Name != "新昵称" {
		t.Fatal("invalid update partially committed")
	}
	f.request("PATCH", "/api/users/"+a.User.ID, b.Token, map[string]string{"phone": "13900000000"}, 405, nil)
	f.request("POST", "/api/contact-blocks/"+b.User.ID, a.Token, nil, 200, nil)
	f.request("GET", "/api/users/"+a.User.ID, b.Token, nil, 403, nil)
	f.request("PATCH", "/api/me", a.Token, map[string]string{"name": "新昵称", "phone": "", "gender": "", "jobTitle": ""}, 200, &u)
	var cleared User
	f.request("GET", "/api/me", a.Token, nil, 200, &cleared)
	if cleared.Phone != "" || cleared.JobTitle != "" || cleared.Gender != "" {
		t.Fatal("explicit clearing did not persist")
	}
}
