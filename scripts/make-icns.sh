#!/usr/bin/env bash
# Generate assets/icon.icns from assets/icon.svg on macOS.
#
# Requires rsvg-convert (Homebrew: `brew install librsvg`) plus the system
# `sips` and `iconutil` tools that ship with macOS. Used by the macOS packaging
# job so the app bundle carries a proper multi-resolution icon.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
svg="$repo_root/assets/icon.svg"
out="$repo_root/assets/icon.icns"

if ! command -v rsvg-convert >/dev/null 2>&1; then
    echo "rsvg-convert not found. Install it with: brew install librsvg" >&2
    exit 1
fi

work="$(mktemp -d)"
iconset="$work/icon.iconset"
mkdir -p "$iconset"
trap 'rm -rf "$work"' EXIT

render() {
    # Arguments: pixel size, destination filename.
    rsvg-convert -w "$1" -h "$1" "$svg" -o "$iconset/$2"
}

render 16 icon_16x16.png
render 32 icon_16x16@2x.png
render 32 icon_32x32.png
render 64 icon_32x32@2x.png
render 128 icon_128x128.png
render 256 icon_128x128@2x.png
render 256 icon_256x256.png
render 512 icon_256x256@2x.png
render 512 icon_512x512.png
render 1024 icon_512x512@2x.png

iconutil -c icns "$iconset" -o "$out"
echo "Wrote $out"
