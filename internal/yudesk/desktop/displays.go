package desktop

import (
	"errors"
	"math"
	"sort"
	"unicode"
	"unicode/utf8"
)

// Ported from YuDesk for DXGI capture. Only the primary display is captured.

// ErrDisplayUnavailable means that a requested monitor was disconnected or its
// current geometry cannot be captured.
var ErrDisplayUnavailable = errors.New("selected desktop display is unavailable")

// Display uses native absolute desktop coordinates.
type Display struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	X       int     `json:"x"`
	Y       int     `json:"y"`
	Width   int     `json:"width"`
	Height  int     `json:"height"`
	Scale   float64 `json:"scale"`
	Primary bool    `json:"primary"`
}

const maxDisplays = 64

func validDisplayID(id string, allowEmpty bool) bool {
	if id == "" {
		return allowEmpty
	}
	if len(id) > 256 || !utf8.ValidString(id) {
		return false
	}
	for _, r := range id {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

func validDisplay(d Display) bool {
	return validDisplayID(d.ID, false) && len(d.Name) <= 512 && utf8.ValidString(d.Name) &&
		d.X >= -1048576 && d.X <= 1048576 && d.Y >= -1048576 && d.Y <= 1048576 &&
		d.Width > 0 && d.Width <= 32768 && d.Height > 0 && d.Height <= 32768 &&
		!math.IsNaN(d.Scale) && !math.IsInf(d.Scale, 0) && d.Scale >= 0.25 && d.Scale <= 16
}

func validateDisplays(displays []Display) ([]Display, error) {
	if len(displays) == 0 || len(displays) > maxDisplays {
		return nil, ErrDisplayUnavailable
	}
	seen := make(map[string]bool, len(displays))
	primaries := 0
	for _, d := range displays {
		if !validDisplay(d) || seen[d.ID] {
			return nil, ErrDisplayUnavailable
		}
		seen[d.ID] = true
		if d.Primary {
			primaries++
		}
	}
	if primaries != 1 {
		return nil, ErrDisplayUnavailable
	}
	// Stable presentation order without using a transient array index as identity.
	sort.Slice(displays, func(i, j int) bool {
		if displays[i].Primary != displays[j].Primary {
			return displays[i].Primary
		}
		if displays[i].X != displays[j].X {
			return displays[i].X < displays[j].X
		}
		if displays[i].Y != displays[j].Y {
			return displays[i].Y < displays[j].Y
		}
		return displays[i].ID < displays[j].ID
	})
	return displays, nil
}

func selectDisplay(displays []Display, id string) (Display, error) {
	for _, d := range displays {
		if (id == "" && d.Primary) || (id != "" && d.ID == id) {
			return d, nil
		}
	}
	return Display{}, ErrDisplayUnavailable
}
