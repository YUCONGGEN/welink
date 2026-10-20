//go:build !windows

package aiagent

import "os/exec"

func hideProcess(cmd *exec.Cmd) {}
