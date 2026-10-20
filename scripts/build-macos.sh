#!/bin/sh
set -eu

mkdir -p .local dist
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags='-s -w' -o .local/LinkMe-macOS-arm64 ./cmd/welink
python3 scripts/package-macos.py
