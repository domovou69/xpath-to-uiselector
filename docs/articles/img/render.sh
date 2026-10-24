#!/bin/zsh
# render.sh <svg> <png> <w> <h>
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=$3,$4 --screenshot="$2" "file://$1" >/dev/null 2>&1
