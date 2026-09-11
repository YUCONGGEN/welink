#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ANDROID_HOME:?Android SDK required}"
: "${ANDROID_NDK_HOME:?Android NDK required}"
export PATH="${JAVA_HOME:+$JAVA_HOME/bin:}$(go env GOPATH)/bin:$PATH"
MOBILE=v0.0.0-20260821190718-4776eadac327
if [ "$(go list -m -f '{{.Version}}' golang.org/x/mobile 2>/dev/null || true)" != "$MOBILE" ]; then
  go get "golang.org/x/mobile@$MOBILE"
fi
for tool in gomobile gobind; do
  if ! command -v "$tool" >/dev/null || ! go version -m "$(command -v "$tool")" | grep -Fq "$MOBILE"; then
    go install "golang.org/x/mobile/cmd/$tool@$MOBILE"
  fi
done
mkdir -p mobile/android/app/libs mobile/build
# Separate builds avoid the gomobile shared go.mod mutation race across ABIs.
for abi in arm64 arm amd64 386; do
  gomobile bind -androidapi 26 -target="android/$abi" -javapkg=cn.welink.bridge \
    -ldflags='-s -w -extldflags=-Wl,-z,max-page-size=16384' \
    -o "mobile/build/core-$abi.aar" ./mobile/core
done
python3 scripts/merge-aar.py
"${GRADLE_BIN:-gradle}" -p mobile/android --no-daemon --offline :app:lintDebug :app:assembleDebug
APK=mobile/android/app/build/outputs/apk/debug/app-debug.apk
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --verbose "$APK"
"$ANDROID_HOME/build-tools/35.0.0/zipalign" -c -P 16 4 "$APK"
python3 scripts/verify-android-assets.py "$APK"
sh scripts/android-assets-test.sh "$APK"
sh scripts/android-microphone-test.sh
mkdir -p dist
cp "$APK" dist/WeLink-Android.apk
