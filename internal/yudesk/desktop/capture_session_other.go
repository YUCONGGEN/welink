//go:build !windows

package desktop

import "context"

// OpenCapture returns the one-shot capture path on platforms without an
// event-driven backend.
func OpenCapture(context.Context) (func(CaptureOptions) (Screenshot, error), func()) {
	return CaptureWithOptions, func() {}
}
