package server

import (
	"database/sql"
	"path/filepath"
	"regexp"
	"testing"
)

func TestNumbersLoginSearchAndStability(t *testing.T) {
	f := setup(t)
	a, b := f.register("number_alice"), f.register("number_bobby")
	if !regexp.MustCompile(`^[1-9][0-9]{5}$`).MatchString(a.User.Number) || a.User.Number == b.User.Number {
		t.Fatal("invalid or duplicate WeLink numbers")
	}
	var login account
	f.request("POST", "/api/auth/login", "", map[string]string{"account": a.User.Number, "password": "test-password-937!"}, 200, &login)
	if login.User.ID != a.User.ID {
		t.Fatal("number resolved to another user")
	}
	var found []User
	f.request("GET", "/api/users?q="+a.User.Number, b.Token, nil, 200, &found)
	if len(found) != 1 || found[0].ID != a.User.ID {
		t.Fatal("number search failed")
	}
	f.request("PATCH", "/api/me", a.Token, map[string]string{"name": "新昵称", "avatar": "blue", "bio": "hello"}, 200, nil)
	var updated User
	f.request("GET", "/api/me", a.Token, nil, 200, &updated)
	if updated.Number != a.User.Number {
		t.Fatal("profile edit changed number")
	}
	var generated account
	f.request("POST", "/api/auth/register", "", map[string]string{"name": "无需登录别名", "password": "test-password-937!"}, 200, &generated)
	if generated.User.Number == "" {
		t.Fatal("registration without alias lacks number")
	}
	f.request("POST", "/api/auth/register", "", map[string]string{"account": a.User.Number, "name": "collision", "password": "test-password-937!"}, 400, nil)
}

func TestNumberMigrationPreservesExistingNumericAliases(t *testing.T) {
	dir := t.TempDir()
	db, e := sql.Open("sqlite", filepath.Join(dir, "welink.db"))
	if e != nil {
		t.Fatal(e)
	}
	_, e = db.Exec(`CREATE TABLE users(id TEXT PRIMARY KEY, account TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password BLOB NOT NULL, avatar TEXT NOT NULL DEFAULT 'blue', bio TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL); INSERT INTO users(id,account,name,password,created) VALUES('legacy','100001','旧账号',X'00',1);`)
	if e != nil {
		t.Fatal(e)
	}
	db.Close()
	store, e := openStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	var number string
	if e = store.QueryRow("SELECT number FROM user_numbers WHERE user_id='legacy'").Scan(&number); e != nil {
		t.Fatal(e)
	}
	if number != "100002" {
		t.Fatal("migration did not preserve numeric alias namespace", number)
	}
	store.Close()
	store, e = openStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer store.Close()
	var again string
	store.QueryRow("SELECT number FROM user_numbers WHERE user_id='legacy'").Scan(&again)
	if again != number {
		t.Fatal("number changed on restart")
	}
}

func TestSixDigitUpgradeKeepsIdentityAndOldLogin(t *testing.T) {
	f := setupCommunity(t)
	a := f.register("preview_number")
	if _, err := f.s.db.Exec("UPDATE user_numbers SET number=100000001 WHERE user_id=?", a.User.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.db.Exec("UPDATE sqlite_sequence SET seq=100000001 WHERE name='user_numbers'"); err != nil {
		t.Fatal(err)
	}
	if err := migrateNumbers(f.s.db); err != nil {
		t.Fatal(err)
	}
	var user User
	f.request("GET", "/api/me", a.Token, nil, 200, &user)
	if user.ID != a.User.ID || user.Number != "100001" {
		t.Fatal("identity changed during six-digit upgrade")
	}
	var login account
	f.request("POST", "/api/auth/login", "", map[string]string{"account": "100000001", "password": "test-password-937!"}, 200, &login)
	if login.User.ID != a.User.ID || login.User.Number != "100001" {
		t.Fatal("old login no longer resolves to the same user")
	}
	if _, err := f.s.db.Exec("UPDATE sqlite_sequence SET seq=999999 WHERE name='user_numbers'"); err != nil {
		t.Fatal(err)
	}
	f.request("POST", "/api/auth/register", "", map[string]string{"account": "beyond_six", "name": "no more numbers", "password": "test-password-937!"}, 409, nil)
}
