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
)

func main() {
	configPath := flag.String("config", "", "JSON server configuration file")
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
	settings, configErr := server.LoadSettings(*configPath)
	if configErr != nil {
		log.Fatal(configErr)
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
			log.Fatal(err)
		}
		log.Printf("administrator account created; configure admin.users with immutable ID %s", id)
		return
	}
	if *initTLS {
		if err := generateTLS(*data); err != nil {
			log.Fatal(err)
		}
		return
	}
	s, e := server.New(server.Config{DataDir: *data, DownloadsDir: *downloads, Settings: &settings})
	if e != nil {
		log.Fatal(e)
	}
	defer s.Close()
	var downloadServer *http.Server
	if *web != "" {
		downloadServer = &http.Server{Addr: *web, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != "GET" && r.Method != "HEAD" {
				http.NotFound(w, r)
				return
			}
			if r.URL.Path != "/" && !strings.HasPrefix(r.URL.Path, "/downloads/") {
				http.NotFound(w, r)
				return
			}
			s.Handler().ServeHTTP(w, r)
		})}
		go func() {
			if err := downloadServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				log.Printf("download listener: %v", err)
			}
		}()
	}
	srv := &http.Server{Addr: *addr, Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 64 << 10, TLSConfig: &tls.Config{MinVersion: tls.VersionTLS13}}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(c)
		if downloadServer != nil {
			_ = downloadServer.Shutdown(c)
		}
	}()
	log.Printf("LinkMe 0.1.16 listening on %s", *addr)
	if *cert != "" && *key != "" {
		e = srv.ListenAndServeTLS(*cert, *key)
	} else {
		e = srv.ListenAndServe()
	}
	if e != nil && e != http.ErrServerClosed {
		log.Fatal(e)
	}
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
