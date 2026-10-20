//go:build !windows

package mediabudget

func ScreenWorker() func() { return func() {} }
