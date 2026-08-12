#!/usr/bin/env bash
# Vite cannot run natively from /mnt/sdcard (noexec mount on Android).
# This script syncs the client into ~/.sparkline-build, builds there, and copies dist back.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/client"
DEST="$HOME/.sparkline-build/sparkline-client"

echo "== Syncing client -> $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
tar -C "$SRC" -cf - . | tar -C "$DEST" -xf -

echo "== Building"
cd "$DEST"
ESBUILD_BINARY_PATH="$HOME/.sparkline-build/esbuild" node "$DEST/node_modules/vite/bin/vite.js" build 2>&1

echo "== Copying dist back"
rm -rf "$SRC/dist"
cp -r "$DEST/dist" "$SRC/dist"
echo "== Done: $SRC/dist"
