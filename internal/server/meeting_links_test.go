package server

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestMeetingLinksInfoAndCallIsolation(t *testing.T) {
	f := setup(t)
	a, b := f.register("link_alice"), f.register("link_bobby")
	f.befriend(a, b)
	var room map[string]any
	f.request("POST", "/api/meetings", a.Token, map[string]string{"title": "讨论会"}, 200, &room)
	code := room["code"].(string)
	response, e := http.Get(f.url + "/join/" + code)
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 200 || !strings.Contains(string(raw), "welink://meeting/"+code) || !strings.Contains(string(raw), "复制邀请链接和会议号") {
		t.Fatal("missing public invitation")
	}
	if strings.Contains(string(raw), a.Token) || strings.Contains(string(raw), "讨论会") {
		t.Fatal("public page exposed session or private title")
	}
	f.request("GET", "/api/meetings/"+code, "", nil, 401, nil)
	f.request("GET", "/api/meetings/"+code, b.Token, nil, 200, nil)
	f.request("POST", "/api/meetings/"+code+"/end", a.Token, map[string]string{}, 200, nil)
	f.request("GET", "/api/meetings/"+code, b.Token, nil, 404, nil)
	c := f.call(a, f.direct(a, b), "video")
	var accepted struct{ Code string }
	f.request("POST", "/api/calls/"+c.ID+"/respond", b.Token, map[string]bool{"accept": true}, 200, &accepted)
	f.request("GET", "/api/meetings/"+accepted.Code, a.Token, nil, 404, nil)
	response, e = http.Get(f.url + "/join/not-a-code")
	if e != nil {
		t.Fatal(e)
	}
	response.Body.Close()
	if response.StatusCode != 404 {
		t.Fatal(response.StatusCode)
	}
}
