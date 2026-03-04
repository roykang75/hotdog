#!/bin/bash
# Chrome Web Store 업로드용 ZIP 패키지 생성

set -e

VERSION=$(grep '"version"' manifest.json | sed 's/.*: *"\(.*\)".*/\1/')
OUTPUT="hotdog-v${VERSION}.zip"

rm -f "$OUTPUT"

zip -r "$OUTPUT" \
  manifest.json \
  popup.html \
  popup.js \
  popup.css \
  content.js \
  content.css \
  youtube-main.js \
  icons/

echo "✅ Created $OUTPUT"
unzip -l "$OUTPUT"
