#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -x .venv/bin/python || ! -d frontend/node_modules ]]; then
  echo "请先按 README 创建 .venv 并安装后端/前端依赖。" >&2
  exit 1
fi
ROOT_DIR="$PWD"
BACKEND_PID=""
FRONTEND_PID=""
cleanup() {
  [[ -z "$BACKEND_PID" ]] || kill "$BACKEND_PID" 2>/dev/null || true
  [[ -z "$FRONTEND_PID" ]] || kill "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
(cd backend && exec "$ROOT_DIR/.venv/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port 8000) &
BACKEND_PID=$!
(cd frontend && exec node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort) &
FRONTEND_PID=$!
echo "CaseDesk: http://127.0.0.1:5173 · API: http://127.0.0.1:8000/docs"
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done
exit 1
