#!/bin/bash
# Round-trip test for the editor's load/save boundary: every canonical file
# in main.ts must come back byte-identical from open → save-without-edits,
# and every on-screen format must survive save → reopen. Runs BlockNote in
# headless Chromium (it needs a DOM), so `chromium` must be on PATH.
#
#   tools/roundtrip/run.sh        → prints PASS/FAIL per case, exits non-zero on any FAIL
set -e
cd "$(dirname "$0")/../.."
npx vite build --config tools/roundtrip/vite.config.ts >/dev/null
PORT=${PORT:-47311}
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory tools/roundtrip/dist >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV' EXIT
sleep 0.5
OUT=$(chromium --headless=new --no-sandbox --disable-gpu --virtual-time-budget=5000 --dump-dom "http://127.0.0.1:$PORT/" 2>/dev/null \
  | python3 -c 'import sys,html,re; m=re.search(r"<pre id=\"out\">(.*?)</pre>", sys.stdin.read(), re.S); print(html.unescape(m.group(1)) if m else "NO OUTPUT")')
echo "$OUT"
echo "$OUT" | grep -q "^0 failures$"
