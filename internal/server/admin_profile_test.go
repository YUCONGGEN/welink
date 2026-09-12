package server

import "testing"

func TestAdminProfilePermissionsValidationAndPreservation(t *testing.T) {
	f := setupCommunity(t)
	a, b := f.register("profile_admin"), f.register("profile_target")
	f.s.settings.Admin.Users = []string{a.User.ID}
	path := "/api/admin/users/" + b.User.ID
	f.request("GET", path, "", nil, 401, nil)
	f.request("GET", path, b.Token, nil, 403, nil)
	f.request("PATCH", path, b.Token, map[string]string{"name": "forbidden"}, 403, nil)
	f.request("POST", "/api/contact-blocks/"+a.User.ID, b.Token, nil, 200, nil)
	var u User
	f.request("GET", path, a.Token, nil, 200, &u)
	f.request("PATCH", path, a.Token, map[string]string{"name": "  林晓  ", "phone": "13800000000", "gender": "female", "jobTitle": "工程师", "bio": "签名"}, 200, &u)
	if u.Name != "林晓" || u.Number != b.User.Number || u.Phone != "13800000000" || u.Gender != "female" || u.JobTitle != "工程师" || u.Bio != "签名" {
		t.Fatal("profile not saved", u)
	}
	f.request("PATCH", path, a.Token, map[string]string{"name": "新姓名"}, 200, &u)
	if u.Phone != "13800000000" || u.Bio != "签名" || u.Avatar != b.User.Avatar {
		t.Fatal("partial edit erased fields", u)
	}
	for _, body := range []map[string]string{{"name": " "}, {"name": "不应保存", "phone": "bad"}, {"name": "不应保存", "gender": "bad"}} {
		f.request("PATCH", path, a.Token, body, 400, nil)
	}
	f.request("PATCH", path, a.Token, map[string]string{"name": "新姓名", "number": "999999"}, 200, &u)
	f.request("GET", "/api/me", b.Token, nil, 200, &u)
	if u.Name != "新姓名" || u.Phone != "13800000000" || u.Number != b.User.Number {
		t.Fatal("invalid edit partially saved", u)
	}
	f.request("POST", "/api/auth/login", "", map[string]string{"account": b.User.Number, "password": "test-password-937!"}, 200, nil)
	u = User{}
	f.request("PATCH", path, a.Token, map[string]string{"phone": "", "gender": "", "jobTitle": "", "bio": ""}, 200, &u)
	if u.Phone != "" || u.Gender != "" || u.JobTitle != "" || u.Bio != "" {
		t.Fatal("could not clear optional fields")
	}
	var audits int
	f.s.db.QueryRow("SELECT COUNT(*) FROM admin_audit WHERE actor=? AND target=? AND action='update-profile'", a.User.ID, b.User.ID).Scan(&audits)
	if audits != 4 {
		t.Fatal("invalid edit recorded or successful edit missing", audits)
	}
	f.request("PATCH", "/api/admin/users/"+a.User.ID, a.Token, map[string]string{"name": "管理员姓名"}, 200, &u)
	f.request("GET", "/api/admin/users", a.Token, nil, 200, nil)
	f.request("DELETE", path, a.Token, map[string]string{"confirmNumber": b.User.Number}, 200, nil)
	f.request("GET", path, a.Token, nil, 404, nil)
	f.request("PATCH", path, a.Token, map[string]string{"name": "不能恢复"}, 404, nil)
	f.request("PATCH", "/api/admin/users/nonexistent", a.Token, map[string]string{"name": "不存在"}, 404, nil)
}
