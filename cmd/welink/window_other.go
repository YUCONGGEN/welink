//go:build !windows

package main

import (
	"errors"
	"log"
)

func newWindow(address, dir string) (windowHost, error) {
	return nil, errors.New("this desktop build targets Windows; use -headless for automated verification")
}
func showError(message string) { log.Print(message) }
