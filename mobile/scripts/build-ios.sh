#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]]; then
  echo '需要 macOS 和 Xcode 26+；Windows/Linux 无法执行此脚本。' >&2
  exit 1
fi
xcodebuild -version
npm ci
npm run build:web
npm test
npx cap sync ios
mkdir -p build
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$PWD/build/CampusSchedule.xcarchive" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO archive
app="$PWD/build/CampusSchedule.xcarchive/Products/Applications/App.app"
test -f "$app/Info.plist"
test -f "$app/public/recognition.js"
cmp www/recognition.js "$app/public/recognition.js"
mkdir -p build/unsigned/Payload
 ditto "$app" build/unsigned/Payload/App.app
(cd build/unsigned && ditto -c -k --keepParent Payload ../CampusSchedule-unsigned.ipa)
echo '已生成未签名 IPA。它不能直接安装，必须经过有效的苹果签名和设备授权。'
