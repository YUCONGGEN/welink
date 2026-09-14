// Package appearance contains the shared, local-only public-page atmosphere.
package appearance

import _ "embed"

//go:embed atmosphere.css
var CSS string

//go:embed atmosphere.js
var JS string
