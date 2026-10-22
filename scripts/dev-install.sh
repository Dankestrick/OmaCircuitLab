#!/bin/bash
# Copy this checkout into the shell's plugin folder and add the app menu entry
# (development; the finished plugin is installed with `omarchy plugin add`).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ID="io.github.dankestrick.omacircuitlab"
DEST="$HOME/.config/omarchy/plugins/$ID"
mkdir -p "$DEST"
rsync -a --delete --exclude .git --exclude tests --exclude scripts --exclude docs --exclude node_modules "$ROOT/" "$DEST/"
mkdir -p "$HOME/.local/share/applications"
sed "s|OMACIRCUIT_ICON|$DEST/icon.png|" "$ROOT/omacircuitlab.desktop" > "$HOME/.local/share/applications/omacircuitlab.desktop"
echo "Copied to $DEST and added the app menu entry"
