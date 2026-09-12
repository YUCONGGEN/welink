//go:build windows

package edge

import (
	"sync/atomic"
	"testing"
)

func TestFailedInitializationCallbacksDoNotTerminateProcess(t *testing.T) {
	for _, result := range []uintptr{0, 0x80004005, 0x80070005} {
		for _, environment := range []bool{false, true} {
			e := NewChromium()
			if environment {
				var value *ICoreWebView2Environment
				if result != 0 {
					value = &ICoreWebView2Environment{}
				}
				e.EnvironmentCompleted(result, value)
			} else {
				var value *ICoreWebView2Controller
				if result != 0 {
					value = &ICoreWebView2Controller{}
				}
				e.CreateCoreWebView2ControllerCompleted(result, value)
			}
			if atomic.LoadUintptr(&e.inited) != 2 {
				t.Fatal("failed initialization did not release wait loop")
			}
		}
	}
}
