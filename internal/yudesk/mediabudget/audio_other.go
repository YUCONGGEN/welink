//go:build !windows

package mediabudget

func AudioWorker() func() { return func() {} }
