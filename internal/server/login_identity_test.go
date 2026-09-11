package server

import "testing"

func TestLoginUsesAccountInsteadOfNickname(t *testing.T) {
	f := setupCommunity(t)
	a, b := f.register("login_alpha"), f.register("login_bravo")
	const nickname = "同名用户"
	for _, person := range []account{a, b} {
		f.request("PATCH", "/api/me", person.Token, map[string]string{"name": nickname}, 200, nil)
	}
	f.request("POST", "/api/auth/login", "", map[string]string{"account": nickname, "password": "test-password-937!"}, 401, nil)
	// A nickname that resembles another user's login must never select that user.
	f.request("PATCH", "/api/me", b.Token, map[string]string{"name": a.User.Account}, 200, nil)
	var result account
	for _, old := range []string{"login_alpha", "login_bravo", "100000001"} {
		f.request("POST", "/api/auth/login", "", map[string]string{"account": old, "password": "test-password-937!"}, 401, nil)
	}
	for _, login := range []string{a.User.Number} {
		f.request("POST", "/api/auth/login", "", map[string]string{"account": login, "password": "test-password-937!"}, 200, &result)
		if result.User.ID != a.User.ID {
			t.Fatal("nickname changed account identity")
		}
	}
}
