#!/bin/sh
set -eu
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
javac -d "$test_dir" \
  mobile/android/app/src/main/java/cn/welink/app/MicrophoneLevel.java \
  mobile/android/app/src/main/java/cn/welink/app/MicrophoneInput.java \
  mobile/android/asset-tests/cn/welink/app/MicrophoneLevelTest.java \
  mobile/android/asset-tests/cn/welink/app/MicrophoneInputTest.java
java -cp "$test_dir" cn.welink.app.MicrophoneLevelTest
java -cp "$test_dir" cn.welink.app.MicrophoneInputTest
