//go:build windows

package main

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"golang.org/x/sys/windows/registry"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unicode/utf16"
)

const startupRegistryPath = `Software\Microsoft\Windows\CurrentVersion\Run`

type desktopStartup struct {
	name, command string
	read          func() (string, bool, error)
	write         func(*string) error
}

func startupCommand(executable, directory string) (string, error) {
	if !filepath.IsAbs(executable) || !filepath.IsAbs(directory) || strings.ContainsAny(executable+directory, "\x00\r\n\"") {
		return "", errors.New("开机启动需要有效的绝对程序路径和资料目录")
	}
	command := `"` + executable + `" -data ` + syscall.EscapeArg(directory) + ` -startup`
	if len(utf16.Encode([]rune(command))) > 260 {
		return "", errors.New("程序或资料目录过长，无法注册开机启动；请使用较短的目录")
	}
	return command, nil
}

func newDesktopStartup(directory string) *desktopStartup {
	executable, _ := os.Executable()
	directory, _ = filepath.Abs(directory)
	command, _ := startupCommand(executable, directory)
	hash := sha256.Sum256([]byte(strings.ToLower(filepath.Clean(directory))))
	return registryStartup(startupRegistryPath, fmt.Sprintf("WeLink-%x", hash[:6]), command)
}

func registryStartup(path, name, command string) *desktopStartup {
	s := &desktopStartup{name: name, command: command}
	s.read = func() (string, bool, error) {
		key, err := registry.OpenKey(registry.CURRENT_USER, path, registry.QUERY_VALUE)
		if errors.Is(err, registry.ErrNotExist) {
			return "", false, nil
		}
		if err != nil {
			return "", false, err
		}
		defer key.Close()
		value, _, err := key.GetStringValue(name)
		if errors.Is(err, registry.ErrNotExist) {
			return "", false, nil
		}
		return value, err == nil, err
	}
	s.write = func(value *string) error {
		if value == nil {
			key, err := registry.OpenKey(registry.CURRENT_USER, path, registry.SET_VALUE)
			if errors.Is(err, registry.ErrNotExist) {
				return nil
			}
			if err != nil {
				return err
			}
			defer key.Close()
			err = key.DeleteValue(name)
			if errors.Is(err, registry.ErrNotExist) {
				return nil
			}
			return err
		}
		key, _, err := registry.CreateKey(registry.CURRENT_USER, path, registry.SET_VALUE)
		if err != nil {
			return err
		}
		defer key.Close()
		return key.SetStringValue(name, *value)
	}
	return s
}

func (s *desktopStartup) registered() bool {
	value, exists, err := s.read()
	return err == nil && exists && value == s.command && s.command != ""
}

func (s *desktopStartup) prepare(enabled bool) (func() error, error) {
	if enabled && s.command == "" {
		return nil, errors.New("当前程序或资料目录过长，无法注册开机启动")
	}
	old, existed, err := s.read()
	if err != nil {
		return nil, fmt.Errorf("无法读取开机启动设置：%w", err)
	}
	var next *string
	if enabled {
		next = &s.command
	}
	if enabled && existed && old == s.command || !enabled && !existed {
		return func() error { return nil }, nil
	}
	if err = s.write(next); err != nil {
		return nil, fmt.Errorf("无法保存开机启动设置：%w", err)
	}
	return func() error {
		if existed {
			return s.write(&old)
		}
		return s.write(nil)
	}, nil
}
