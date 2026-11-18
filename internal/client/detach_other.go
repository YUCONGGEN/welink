//go:build !windows

package client

import (
	"os/exec"
	"syscall"
)

// detach starts cmd in its own session so it outlives LinkMe.
func detach(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true} }
