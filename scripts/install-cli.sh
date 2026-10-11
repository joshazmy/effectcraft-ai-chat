#!/bin/sh
# Download the EffectCraft command-line tool into ~/.local/bin (macOS, universal).
# Usage: scripts/install-cli.sh [destination-dir]
set -e

VER="${EFFECTCRAFT_VERSION:-0.8.0}"
DEST="${1:-$HOME/.local/bin}"
TMP="$(mktemp -d)"

mkdir -p "$DEST"
curl -fL -o "$TMP/cli.zip" \
  "https://github.com/storytold/effectcraft/releases/download/v$VER/effectcraft-cli-$VER-macos-universal.zip"
unzip -oq "$TMP/cli.zip" -d "$TMP"
install -m 755 "$TMP/effectcraft-cli-$VER-macos-universal/effectcraft-cli" "$DEST/effectcraft-cli"
rm -rf "$TMP"

echo "installed $DEST/effectcraft-cli"
"$DEST/effectcraft-cli" --help | head -1
