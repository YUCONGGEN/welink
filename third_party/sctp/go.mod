module github.com/pion/sctp

// YzDesk: requires the module versions the application builds with (the main
// and mobile modules select them anyway) instead of upstream's older ones,
// and no test-only modules, as upstream's tests are not vendored; anet is
// YzDesk's patched copy, as in the application. `go test`, `go vet` and
// `go mod verify` then work here from the application's module cache alone
// (-mod=readonly, no network); `go list -m all` also walks test-only
// modules of the dependencies and needs the network once. See
// YZDESK_PATCH.md.
require (
	github.com/pion/logging v0.2.4
	github.com/pion/randutil v0.1.0
	github.com/pion/transport/v4 v4.1.0
)

// The versions the application selects, all in its module cache. Not
// github.com/stretchr/objx: only testify's mock package uses it, and listing
// it here made it a direct requirement of the module `gomobile bind`
// generates for mobile/ (which requires everything `go list -m all` names),
// whose `go mod tidy` then needs a go.mod that no offline build cache has.
require (
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	github.com/stretchr/testify v1.12.1 // indirect
	github.com/wlynxg/anet v0.0.5 // indirect
	go.yaml.in/yaml/v3 v3.0.5 // indirect
	golang.org/x/net v0.57.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
	golang.org/x/time v0.14.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

replace github.com/wlynxg/anet => ../anet

go 1.25.0

// Retract version with ZeroChecksum misinterpretation (bi-directional/global handling)
retract v1.8.12
