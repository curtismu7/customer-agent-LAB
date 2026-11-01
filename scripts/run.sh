#!/bin/sh
# One command on the host: install if needed, preflight, start. Starting it this way is the owner's opt-in to mock sign-in on this machine (ALLOW_MOCK_SIGNIN=1).
#   ./scripts/run.sh          (then open http://localhost:5600/)
set -e
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm ci
export ALLOW_MOCK_SIGNIN=1
npm run doctor
exec npm start
