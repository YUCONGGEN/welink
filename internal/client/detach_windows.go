package client

import (
	"os/exec"
	"syscall"
)

// detach starts cmd outside LinkMe's console and process group, so it keeps
// running after LinkMe exits (the updater replaces LinkMe's own program).
func detach(cmd *exec.Cmd) {
	const detachedProcess, newProcessGroup = 0x00000008, 0x00000200
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: detachedProcess | newProcessGroup}
}
