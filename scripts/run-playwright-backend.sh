#!/usr/bin/env bash
# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.


set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT_DIR/server"
DEFAULT_SERVER_PYTHON="$SERVER_DIR/.venv/bin/python"
LEGACY_SERVER_PYTHON="$SERVER_DIR/venv/bin/python"
SERVER_PORT="${ECONNECT_SERVER_PORT:-8000}"
PLAYWRIGHT_DB_PATH="${ECONNECT_PLAYWRIGHT_DB_PATH:-$ROOT_DIR/.codex-artifacts/playwright/econnect-e2e.sqlite3}"

if [[ -n "${ECONNECT_SERVER_PYTHON:-}" ]]; then
  SERVER_PYTHON="$ECONNECT_SERVER_PYTHON"
elif [[ -x "$DEFAULT_SERVER_PYTHON" ]]; then
  SERVER_PYTHON="$DEFAULT_SERVER_PYTHON"
elif [[ -x "$LEGACY_SERVER_PYTHON" ]]; then
  SERVER_PYTHON="$LEGACY_SERVER_PYTHON"
elif command -v python3 >/dev/null 2>&1; then
  SERVER_PYTHON="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  SERVER_PYTHON="$(command -v python)"
else
  echo "No Python runtime available for Playwright backend bootstrap." >&2
  exit 1
fi

mkdir -p "$(dirname "$PLAYWRIGHT_DB_PATH")"

export DATABASE_URL="${DATABASE_URL:-sqlite:///$PLAYWRIGHT_DB_PATH}"
export MQTT_BROKER="${MQTT_BROKER:-127.0.0.1}"
export MQTT_PORT="${MQTT_PORT:-18830}"
export MQTT_NAMESPACE="${MQTT_NAMESPACE:-local}"
export ALLOW_INSECURE_HTTP="${ALLOW_INSECURE_HTTP:-1}"
export RUNTIME_NETWORK_REFRESH_INTERVAL_SECONDS="${RUNTIME_NETWORK_REFRESH_INTERVAL_SECONDS:-3600}"

cd "$SERVER_DIR"
exec "$SERVER_PYTHON" -m uvicorn main:app --host 127.0.0.1 --port "$SERVER_PORT"
