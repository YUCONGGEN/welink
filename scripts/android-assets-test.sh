#!/bin/sh
set -eu
apk=${1:-dist/WeLink-Android.apk}
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
javac -d "$test_dir" mobile/android/app/src/main/java/cn/welink/app/UiAssets.java mobile/android/asset-tests/cn/welink/app/UiAssetsTest.java
java -cp "$test_dir" cn.welink.app.UiAssetsTest "$apk"
