#!/usr/bin/env bash
# Fanal MVP — boots backend (ssh2 + express) and Vite dev server.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "▸ installing deps (first run)…"
  npm install --no-audit --no-fund
fi

echo "▸ starting fanal-app"
echo "   · api  http://127.0.0.1:8787"
echo "   · web  http://127.0.0.1:5173"
echo ""
exec npm run dev
