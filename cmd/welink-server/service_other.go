//go:build !windows

package main

import "context"

// runService is only meaningful on Windows; elsewhere systemd, launchd or
// Docker supervise the process directly.
func runService(func(context.Context) int) bool { return false }
