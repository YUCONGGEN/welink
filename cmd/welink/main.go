package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"welink/internal/client"
)

func main() {
	headless := flag.Bool("headless", false, "run the local client without a native window")
	listen := flag.String("listen", "127.0.0.1:18746", "local client address")
	dir := flag.String("data", "", "client private directory")
	server := flag.String("server", "", "server URL override")
	pin := flag.String("fingerprint", "", "server certificate SHA-256")
	flag.Parse()
	if *dir == "" {
		root, e := os.UserConfigDir()
		if e != nil {
			log.Fatal(e)
		}
		*dir = filepath.Join(root, "WeLink")
	}
	_ = os.MkdirAll(*dir, 0700)
	f, e := os.OpenFile(filepath.Join(*dir, "client.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if e == nil {
		log.SetOutput(f)
		defer f.Close()
	}
	var window windowHost
	c, e := client.New(client.Options{Directory: *dir, Listen: *listen, Server: *server, Fingerprint: *pin, WindowAction: func(action string) {
		if window != nil {
			window.Action(action)
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
	window, e = newWindow(c.URL(), *dir)
	if e != nil {
		log.Print(e)
		showError(e.Error())
		return
	}
	window.Run()
	window.Close()
}

type windowHost interface {
	Action(string)
	Run()
	Close()
}
