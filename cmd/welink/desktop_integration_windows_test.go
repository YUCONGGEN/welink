//go:build windows

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
	"welink/internal/client"
	"welink/internal/server"
)

func TestNativeDesktopChatAndDuplicateProcess(t *testing.T) {
	if os.Getenv("WELINK_NATIVE_DESKTOP_TEST") != "1" {
		t.Skip("opt-in native WebView2 chat and process integration")
	}
	settings := server.DefaultSettings()
	settings.Registration.Enabled = true
	s, err := server.New(server.Config{DataDir: t.TempDir(), Settings: &settings})
	if err != nil {
		t.Fatal(err)
	}
	apiServer := httptest.NewServer(s.Handler())
	defer apiServer.Close()
	defer s.Close()
	request := func(path, token string, body any) (map[string]any, error) {
		var raw []byte
		method := "GET"
		if body != nil {
			raw, _ = json.Marshal(body)
			method = "POST"
		}
		r, _ := http.NewRequest(method, apiServer.URL+path, bytes.NewReader(raw))
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("Content-Type", "application/json")
		response, e := http.DefaultClient.Do(r)
		if e != nil {
			return nil, e
		}
		defer response.Body.Close()
		data, _ := io.ReadAll(response.Body)
		if response.StatusCode != 200 {
			return nil, fmt.Errorf("%s: %d %s", path, response.StatusCode, data)
		}
		var result map[string]any
		e = json.Unmarshal(data, &result)
		return result, e
	}
	register := func(account string) map[string]any {
		v, e := request("/api/auth/register", "", map[string]string{"account": account, "name": account, "password": "WeLink-test-only-2026!"})
		if e != nil {
			t.Fatal(e)
		}
		return v
	}
	a, b := register("native_alice"), register("native_bob")
	at, bt := a["token"].(string), b["token"].(string)
	req, err := request("/api/requests", at, map[string]any{"userId": b["user"].(map[string]any)["id"]})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = request("/api/requests/"+req["id"].(string), bt, map[string]bool{"accept": true}); err != nil {
		t.Fatal(err)
	}
	conversation, err := request("/api/conversations", at, map[string]any{"kind": "direct", "members": []any{b["user"].(map[string]any)["id"]}})
	if err != nil {
		t.Fatal(err)
	}
	cid := conversation["id"].(string)
	os.MkdirAll(".local/native-desktop-tests", 0700)
	directory, err := os.MkdirTemp(".local/native-desktop-tests", "chat-")
	if err != nil {
		t.Fatal(err)
	}
	directory, _ = filepath.Abs(directory)
	guard, existing, err := acquireInstance(directory)
	if err != nil || existing {
		t.Fatalf("instance: %v %v", existing, err)
	}
	defer guard.Close()
	var w windowHost
	c, err := client.New(client.Options{Directory: directory, Listen: "127.0.0.1:0", Server: apiServer.URL, WindowAction: func(action string) {
		if w != nil {
			w.Action(action)
		}
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	w, err = newWindow("about:blank", directory)
	if err != nil {
		t.Fatal(err)
	}
	h := w.(*windowsHost)
	guard.Watch(func() { h.Action("show") })
	h.desktop.preferences.MessageAlerts = false
	done := make(chan string, 1)
	h.view.Bind("nativeTestReport", func(message string) {
		select {
		case done <- message:
		default:
		}
	})
	h.view.Bind("nativeTestControl", func(action string) (map[string]any, error) {
		switch action {
		case "peer-message":
			return request("/api/conversations/"+cid+"/messages", bt, map[string]string{"text": "native hidden message", "clientId": "native-hidden"})
		case "duplicate":
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			binary, _ := filepath.Abs("dist/WeLink-Windows.exe")
			cmd := exec.CommandContext(ctx, binary, "-data", directory, "-listen", "127.0.0.1:18750", "-server", apiServer.URL)
			cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
			if e := cmd.Run(); e != nil {
				return nil, e
			}
			return map[string]any{"ok": true}, nil
		case "state":
			visible, _, _ := user32.NewProc("IsWindowVisible").Call(h.hwnd)
			raw, e := os.ReadFile(filepath.Join(directory, "desktop.json"))
			if e != nil {
				return nil, e
			}
			var prefs desktopPreferences
			if e = json.Unmarshal(raw, &prefs); e != nil {
				return nil, e
			}
			return map[string]any{"visible": visible != 0, "unread": h.desktop.unread, "tray": h.desktop.trayAvailable, "preferences": prefs}, nil
		}
		return nil, fmt.Errorf("unknown test control")
	})
	config, _ := json.Marshal(map[string]string{"conversation": cid, "account": "native_alice", "password": "WeLink-test-only-2026!"})
	script := strings.Replace(nativeChatScript, "__CONFIG__", string(config), 1)
	h.view.Init(script)
	h.view.Navigate(c.URL())
	result := make(chan string, 1)
	go func() {
		time.Sleep(time.Second)
		h.view.Dispatch(func() { h.view.Eval(script) })
		select {
		case message := <-done:
			result <- message
		case <-time.After(45 * time.Second):
			result <- "native chat test timed out"
		}
		h.Action("quit")
	}()
	h.Run()
	guard.Close()
	h.Close()
	if message := <-result; message != "ok" {
		t.Fatal(message)
	}
	// Open the same profile in another real Windows process, as on application
	// restart. The first document persisted a message while POST was unavailable.
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	binary, _ := os.Executable()
	child := exec.CommandContext(ctx, binary, "-test.run=^TestNativeOutboxReopenHelper$", "-test.v")
	child.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	child.Env = append(os.Environ(), "WELINK_REOPEN_DIRECTORY="+directory, "WELINK_REOPEN_URL="+c.URL(), "WELINK_REOPEN_CONFIG="+string(config))
	if output, err := child.CombinedOutput(); err != nil {
		t.Fatalf("native reopen: %v\n%s", err, output)
	}
}

func TestNativeOutboxReopenHelper(t *testing.T) {
	directory := os.Getenv("WELINK_REOPEN_DIRECTORY")
	if directory == "" {
		t.Skip("only run as native outbox subprocess")
	}
	w, err := newWindow("about:blank", directory)
	if err != nil {
		t.Fatal(err)
	}
	h := w.(*windowsHost)
	reopened := make(chan string, 1)
	h.view.Bind("nativeTestReport", func(message string) {
		select {
		case reopened <- message:
		default:
		}
	})
	restartScript := strings.Replace(nativeOutboxRestartScript, "__CONFIG__", os.Getenv("WELINK_REOPEN_CONFIG"), 1)
	h.view.Init(restartScript)
	h.view.Navigate(os.Getenv("WELINK_REOPEN_URL"))
	result := make(chan string, 1)
	go func() {
		time.Sleep(time.Second)
		h.view.Dispatch(func() { h.view.Eval(restartScript) })
		select {
		case message := <-reopened:
			result <- message
		case <-time.After(30 * time.Second):
			result <- "native outbox restart timed out"
		}
		h.Action("quit")
	}()
	h.Run()
	h.Close()
	if message := <-result; message != "ok" {
		t.Fatal(message)
	}
}

const nativeChatScript = `(async()=>{if(window.nativeChatStarted)return;window.nativeChatStarted=true;
 const cfg=__CONFIG__,sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(fn,label)=>{for(let i=0;i<100;i++){if(await fn())return;await sleep(50)}throw Error('timeout: '+label)};
 const click=s=>{const node=document.querySelector(s);if(!node)throw Error('missing '+s);node.click()};
 const check=(value,label)=>{if(!value)throw Error(label)};
 const api=async path=>{const r=await fetch(path,{headers:{Authorization:'Bearer '+localStorage.getItem('welink_token')}});if(!r.ok)throw Error('HTTP '+r.status);return r.json()};
 try{
 await wait(()=>document.querySelector('#auth-form'),'login');document.querySelector('[name=account]').value=cfg.account;document.querySelector('[name=password]').value=cfg.password;click('#auth-form button[type=submit]');await wait(()=>document.querySelector('.rail'),'authenticated');
 click('[data-conversation="'+cfg.conversation+'"]');await wait(()=>document.querySelector('#composer'),'chat');
 click('.rail [data-action=settings]');click('[data-desktop=settings]');await wait(()=>document.querySelector('#desktop-close-tray'),'desktop settings');
 document.querySelector('#desktop-message-alerts').checked=false;click('#desktop-save');await wait(()=>!document.querySelector('#desktop-save'),'saved preferences');
 let state=await nativeTestControl('state');check(state.tray&&state.preferences.closeToTray&&!state.preferences.messageAlerts,'native settings persistence');
 click('[data-action=window-close]');await wait(()=>window.welinkNativeHidden===true,'native hidden event');state=await nativeTestControl('state');check(!state.visible&&state.tray,'real HWND hidden with tray');
 await nativeTestControl('peer-message');await wait(async()=>((await api('/api/conversations')).find(c=>c.id===cfg.conversation)?.unread)===1,'server unread');await wait(async()=>(await nativeTestControl('state')).unread===1,'native unread count');
 await nativeTestControl('duplicate');await wait(()=>window.welinkNativeHidden===false,'duplicate restores primary');state=await nativeTestControl('state');check(state.visible,'real HWND restored');
 await wait(async()=>((await api('/api/conversations')).find(c=>c.id===cfg.conversation)?.unread)===0,'read on restore');check(document.querySelector('#messages').textContent.includes('native hidden message'),'WebSocket delivered hidden message');
 const originalFetch=window.fetch;window.fetch=(url,options={})=>String(url).endsWith('/messages')&&options.method==='POST'?Promise.reject(Error('native test offline')):originalFetch(url,options);
 const local=store=>new Promise((resolve,reject)=>{const r=indexedDB.open('welink-local');r.onsuccess=()=>{const db=r.result,tx=db.transaction(store),q=tx.objectStore(store).getAll();q.onsuccess=()=>resolve(q.result);tx.oncomplete=()=>db.close()};r.onerror=()=>reject(r.error)});
 const composer=document.querySelector('#composer');composer.value='native persistent message';composer.dispatchEvent(new Event('input'));click('#send-message');await wait(async()=>(await local('queue')).some(r=>r.body.text==='native persistent message'),'queue on disk');await wait(()=>!composer.disabled&&composer.value==='','composer cleared after commit');
 composer.value='native persistent draft';composer.dispatchEvent(new Event('input'));await wait(async()=>(await local('drafts')).some(r=>r.text==='native persistent draft'),'draft on disk');
 click('.rail [data-action=more-menu]');click('[data-desktop=quit]');await wait(()=>document.querySelector('#desktop-exit'),'explicit exit confirmation');
 await nativeTestReport('ok');
 }catch(e){await nativeTestReport(String(e.stack||e))}
})();`

const nativeOutboxRestartScript = `(async()=>{if(window.nativeRestartStarted)return;window.nativeRestartStarted=true;
 const cfg=__CONFIG__,sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(fn,label)=>{for(let i=0;i<160;i++){if(await fn())return;await sleep(50)}throw Error('timeout: '+label)};
 try{
  await wait(()=>document.querySelector('.rail'),'session restored');document.querySelector('[data-conversation="'+cfg.conversation+'"]').click();
  await wait(()=>document.querySelector('#composer')?.value==='native persistent draft','draft after native recreation');
  await wait(()=>Array.from(document.querySelectorAll('[data-message]')).some(n=>n.textContent.includes('native persistent message')),'pending message delivered');
  const response=await fetch('/api/conversations/'+cfg.conversation+'/messages',{headers:{Authorization:'Bearer '+localStorage.getItem('welink_token')}}),messages=await response.json();if(messages.filter(m=>m.text==='native persistent message').length!==1)throw Error('native retry duplicated a message');
  await nativeTestReport('ok');
 }catch(e){await nativeTestReport(String(e.stack||e))}
})();`
