#!/usr/bin/env bash
# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.


set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBAPP_DIR="$ROOT_DIR/webapp"
SERVER_PORT="${ECONNECT_SERVER_PORT:-8000}"
WEBAPP_HTTP_PORT="${ECONNECT_WEBAPP_HTTP_PORT:-3000}"
WEBAPP_HTTPS_PORT="${ECONNECT_WEBAPP_HTTPS_PORT:-3443}"
WEBAPP_INTERNAL_HTTP_PORT="${ECONNECT_WEBAPP_INTERNAL_HTTP_PORT:-3001}"

cd "$WEBAPP_DIR"

export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-/api/v1}"
export API_URL="${API_URL:-$NEXT_PUBLIC_API_URL}"
export BACKEND_INTERNAL_URL="${BACKEND_INTERNAL_URL:-http://127.0.0.1:$SERVER_PORT}"
export ALLOW_INSECURE_HTTP="${ALLOW_INSECURE_HTTP:-1}"
export PORT="$WEBAPP_HTTP_PORT"
export HTTPS_PORT="$WEBAPP_HTTPS_PORT"
export INTERNAL_HTTP_PORT="$WEBAPP_INTERNAL_HTTP_PORT"
export HOSTNAME="${HOSTNAME:-localhost}"

# In CI the dev server compilation takes too long (>3 min) and exceeds the
# 180 s webServer timeout. Use the pre-built production server instead.
if [[ "${CI:-}" == "true" ]]; then
  exec npm start
else
  exec npm run dev
fi
