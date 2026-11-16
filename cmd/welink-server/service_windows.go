//go:build windows

package main

import (
	"context"
	"log"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/svc"
)

// runService runs the server under the Windows Service Control Manager. The
// installer registers the service with -config on the command line and the
// SCM restarts it after a non-zero exit (console restart or crash).
func runService(run func(context.Context) int) bool {
	inService, err := svc.IsWindowsService()
	if err != nil || !inService {
		return false
	}
	// Services start in System32; log next to the configuration instead.
	if dir := os.Getenv("ProgramData"); dir != "" {
		if f, e := os.OpenFile(filepath.Join(dir, "LinkMe", "server.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600); e == nil {
			log.SetOutput(f)
		}
	}
	// Restart from the console relies on the SCM failure actions.
	_ = os.Setenv("LINKME_SUPERVISED", "1")
	code := 0
	err = svc.Run("LinkMe", handler{run: run, code: &code})
	if err != nil {
		log.Print(err)
		os.Exit(1)
	}
	os.Exit(code)
	return true
}

type handler struct {
	run  func(context.Context) int
	code *int
}

func (h handler) Execute(_ []string, requests <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	status <- svc.Status{State: svc.StartPending}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan int, 1)
	go func() { done <- h.run(ctx) }()
	status <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
	for {
		select {
		case code := <-done:
			*h.code = code
			// A non-zero service exit code makes the SCM apply its
			// failure (restart) actions.
			return code != 0, uint32(code)
		case r := <-requests:
			switch r.Cmd {
			case svc.Interrogate:
				status <- r.CurrentStatus
			case svc.Stop, svc.Shutdown:
				status <- svc.Status{State: svc.StopPending}
				cancel()
				*h.code = <-done
				return false, 0
			}
		}
	}
}
