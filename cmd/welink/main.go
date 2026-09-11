package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"welink/internal/client"
)

func main() {
	headless := flag.Bool("headless", false, "run the local client without a native window")
	startup := flag.Bool("startup", false, "started by the current user's login startup entry")
	listen := flag.String("listen", "127.0.0.1:18746", "local client address")
	dir := flag.String("data", "", "client private directory")
	server := flag.String("server", "", "server URL override")
	pin := flag.String("fingerprint", "", "server certificate SHA-256")
	assets := flag.String("assets", "", "optional local UI directory for development")
	flag.Parse()
	if *dir == "" {
		root, e := os.UserConfigDir()
		if e != nil {
			log.Fatal(e)
		}
		*dir = filepath.Join(root, "WeLink")
	}
	_ = os.MkdirAll(*dir, 0700)
	if flag.NArg() > 0 {
		code := meetingCodeFromURI(flag.Arg(0))
		if code == "" {
			showError("会议链接无效")
			return
		}
		if err := saveMeetingInvite(*dir, code); err != nil {
			showError("无法打开会议邀请")
			return
		}
	}
	var instance instanceGuard
	if !*headless {
		var existing bool
		var err error
		instance, existing, err = acquireInstance(*dir)
		if err != nil {
			showError(err.Error())
			return
		}
		if existing {
			return
		}
		if instance != nil {
			defer instance.Close()
		}
	}
	f, e := os.OpenFile(filepath.Join(*dir, "client.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if e == nil {
		log.SetOutput(f)
		defer f.Close()
	}
	var window windowHost
	var windowMu sync.RWMutex
	c, e := client.New(client.Options{AssetsDirectory: *assets, Directory: *dir, Listen: *listen, Server: *server, Fingerprint: *pin, WindowAction: func(action string) {
		windowMu.RLock()
		target := window
		windowMu.RUnlock()
		if target != nil {
			target.Action(action)
		}
	}})
	if e != nil {
		log.Print(e)
		showError(e.Error())
		return
	}
	defer c.Close()
	if *headless {
		fmt.Println(c.URL())
		_ = os.WriteFile(filepath.Join(*dir, "client.url"), []byte(c.URL()), 0600)
		signals := make(chan os.Signal, 1)
		signal.Notify(signals, os.Interrupt)
		<-signals
		return
	}
	created, e := newWindow(c.URL(), *dir)
	if e != nil {
		log.Print(e)
		showError(e.Error())
		return
	}
	windowMu.Lock()
	window = created
	windowMu.Unlock()
	if *startup {
		if h, ok := created.(interface{ startupWindow() }); ok {
			h.startupWindow()
		}
	}
	if instance != nil {
		instance.Watch(func() { created.Action("show") })
	}
	created.Run()
	if instance != nil {
		instance.Close()
	}
	windowMu.Lock()
	window = nil
	windowMu.Unlock()
	created.Close()
}

type windowHost interface {
	Action(string)
	Run()
	Close()
}

type instanceGuard interface {
	Watch(func())
	Close()
}
