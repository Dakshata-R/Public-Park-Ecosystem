#!/bin/sh
# usage: render.sh in.svg out.png W H
URL="file:///$(cygpath -m "$1")"; OUT=$(cygpath -w "$2")
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --default-background-color=ffffffff --user-data-dir="$(cygpath -w "$PWD/chrome-prof")" --window-size=$3,$4 --screenshot="$OUT" "$URL" 2>&1 | grep -i -E "error|written" | tail -3
