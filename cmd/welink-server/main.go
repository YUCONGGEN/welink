package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"flag"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"welink/internal/server"
	"welink/internal/version"
)

// Version is printed by -version and reported by /health.
const Version = version.App

// exitRestart tells a supervising service manager (systemd, launchd, the
// Windows SCM or Docker) that the console asked for a restart.
const exitRestart = 3

func main() {
	// Under the Windows Service Control Manager, runService takes over and
	// calls run itself; everywhere else it returns false immediately.
	if runService(run) {
		return
	}
	os.Exit(run(context.Background()))
}

// run starts the server and returns the process exit code.
func run(parent context.Context) int {
	configPath := flag.String("config", "", "JSON server configuration file")
	checkConfig := flag.Bool("check-config", false, "validate the configuration file and exit")
	consoleAdmin := flag.String("console-admin", "", "create the web console administrator (or reset their password) and exit")
	consolePasswordFile := flag.String("console-password-file", "", "private file containing the console administrator password")
	showVersion := flag.Bool("version", false, "print the version and exit")
	bootstrapPasswordFile := flag.String("bootstrap-admin-password-file", "", "private file containing the initial administrator password")
	bootstrapAlias := flag.String("bootstrap-admin-account", "", "initial administrator login alias")
	bootstrapName := flag.String("bootstrap-admin-name", "", "initialize the first account in an empty database")
	bootstrapEmail := flag.String("bootstrap-admin-email", "", "verified email for an initial email-authenticated administrator")
	bootstrapOutput := flag.String("bootstrap-admin-output", "", "private file for initial credentials")
	addr := flag.String("listen", ":8250", "API listen address")
	data := flag.String("data", "data", "database and uploads directory")
	downloads := flag.String("downloads", "downloads", "public downloads directory")
	cert := flag.String("cert", "", "TLS certificate")
	key := flag.String("key", "", "TLS key")
	initTLS := flag.Bool("init-tls", false, "create local TLS certificate and print fingerprint")
	web := flag.String("download-listen", "", "optional HTTP listener serving only downloads")
	flag.Parse()
	if *showVersion {
		fmt.Println(Version)
		return 0
	}
	// The console edits this file, so remember where it is regardless of
	// the working directory a service manager starts us in.
	if *configPath != "" {
		if abs, err := filepath.Abs(*configPath); err == nil {
			*configPath = abs
		}
	}
	settings, configErr := server.LoadSettings(*configPath)
	if configErr != nil {
		log.Print(configErr)
		return 1
	}
	if *checkConfig {
		fmt.Println("配置有效")
		return 0
	}
	if *consoleAdmin != "" {
		if *consolePasswordFile == "" {
			log.Print("-console-admin requires -console-password-file")
			return 1
		}
		raw, err := os.ReadFile(*consolePasswordFile)
		if err != nil {
			log.Print(err)
			return 1
		}
		created, err := server.SetConsoleAdmin(settings, *consoleAdmin, strings.TrimRight(string(raw), "\r\n"))
		if err != nil {
			log.Print(err)
			return 1
		}
		if created {
			fmt.Println("后台管理员已创建：" + *consoleAdmin)
		} else {
			fmt.Println("后台管理员密码已重置：" + *consoleAdmin)
		}
		return 0
	}
	flag.Visit(func(f *flag.Flag) {
		switch f.Name {
		case "listen":
			settings.Listen = *addr
		case "download-listen":
			settings.DownloadListen = *web
		case "data":
			settings.DataDir = *data
		case "downloads":
			settings.DownloadsDir = *downloads
		}
	})
	*addr, *web, *data, *downloads = settings.Listen, settings.DownloadListen, settings.DataDir, settings.DownloadsDir
	if *bootstrapName != "" {
		id, err := server.BootstrapAdmin(settings, *bootstrapName, *bootstrapAlias, *bootstrapPasswordFile, *bootstrapOutput, *bootstrapEmail)
		if err != nil {
			log.Print(err)
			return 1
		}
		log.Printf("first account created: %s", id)
		return 0
	}
	if *initTLS {
		if err := generateTLS(*data); err != nil {
			log.Print(err)
			return 1
		}
		return 0
	}
	s, e := server.New(server.Config{DataDir: *data, DownloadsDir: *downloads, Settings: &settings, ConfigPath: *configPath, Supervised: os.Getenv("LINKME_SUPERVISED") == "1"})
	if e != nil {
		log.Print(e)
		return 1
	}
	defer s.Close()
	servers := []*http.Server{}
	serve := func(name string, srv *http.Server) {
		servers = append(servers, srv)
		go func() {
			if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				log.Printf("%s listener: %v", name, err)
			}
		}()
	}
	if *web != "" {
		serve("download", &http.Server{Addr: *web, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// The download port serves the public page, the packages and (when
			// console.public is on) the management console under /admin/.
			admin := settings.Console.Enabled && settings.Console.Public && (r.URL.Path == "/admin" || strings.HasPrefix(r.URL.Path, "/admin/"))
			if !admin && r.Method != "GET" && r.Method != "HEAD" {
				http.NotFound(w, r)
				return
			}
			brand := r.URL.Path == "/api/branding" || r.URL.Path == "/api/branding/icon"
			if !admin && !brand && r.URL.Path != "/" && !strings.HasPrefix(r.URL.Path, "/downloads/") {
				http.NotFound(w, r)
				return
			}
			s.Handler().ServeHTTP(w, r)
		})})
	}
	if settings.Console.Enabled {
		serve("console", &http.Server{Addr: settings.Console.Listen, Handler: s.ConsoleHandler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 64 << 10})
		log.Printf("LinkMe console listening on %s", settings.Console.Listen)
	}
	srv := &http.Server{Addr: *addr, Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 64 << 10, TLSConfig: &tls.Config{MinVersion: tls.VersionTLS13}}
	ctx, stop := signal.NotifyContext(parent, os.Interrupt, syscall.SIGTERM)
	defer stop()
	code := 0
	go func() {
		select {
		case <-ctx.Done():
		case <-s.RestartRequested():
			log.Print("restart requested from the console")
			code = exitRestart
		}
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(c)
		for _, other := range servers {
			_ = other.Shutdown(c)
		}
	}()
	log.Printf("LinkMe %s listening on %s", Version, *addr)
	if *cert != "" && *key != "" {
		e = srv.ListenAndServeTLS(*cert, *key)
	} else {
		e = srv.ListenAndServe()
	}
	if e != nil && e != http.ErrServerClosed {
		log.Print(e)
		return 1
	}
	return code
}
func generateTLS(dir string) error {
	if e := os.MkdirAll(dir, 0700); e != nil {
		return e
	}
	certPath := filepath.Join(dir, "server.crt")
	if b, e := os.ReadFile(certPath); e == nil {
		block, _ := pem.Decode(b)
		sum := sha256.Sum256(block.Bytes)
		log.Print(hex.EncodeToString(sum[:]))
		return nil
	}
	key, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		return e
	}
	serial, e := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if e != nil {
		return e
	}
	template := x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "LinkMe Server"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().AddDate(5, 0, 0), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, IPAddresses: []net.IP{net.ParseIP("223.166.147.252"), net.ParseIP("127.0.0.1")}, DNSNames: []string{"localhost"}}
	der, e := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if e != nil {
		return e
	}
	pk, e := x509.MarshalECPrivateKey(key)
	if e != nil {
		return e
	}
	if e = os.WriteFile(filepath.Join(dir, "server.key"), pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: pk}), 0600); e != nil {
		return e
	}
	if e = os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0644); e != nil {
		return e
	}
	sum := sha256.Sum256(der)
	log.Print(hex.EncodeToString(sum[:]))
	return nil
}
