#!/usr/bin/env bash
# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.


set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$ROOT_DIR/server"
WEBAPP_DIR="$ROOT_DIR/webapp"

SERVER_PYTHON="${ECONNECT_SERVER_PYTHON:-$SERVER_DIR/venv/bin/python}"
START_DOCKER_DEPS="${ECONNECT_START_DOCKER_DEPS:-1}"

SERVER_HOST="${ECONNECT_SERVER_HOST:-0.0.0.0}"
SERVER_PORT="${ECONNECT_SERVER_PORT:-8000}"
WEBAPP_HTTP_PORT="${ECONNECT_WEBAPP_HTTP_PORT:-3000}"
WEBAPP_HTTPS_PORT="${ECONNECT_WEBAPP_HTTPS_PORT:-3443}"
WEBAPP_INTERNAL_HTTP_PORT="${ECONNECT_WEBAPP_INTERNAL_HTTP_PORT:-3001}"
PUBLIC_HOST_OVERRIDE="${ECONNECT_PUBLIC_HOST:-}"

SERVER_PID=""
WEBAPP_PID=""

usage() {
  cat <<'EOF'
Usage: ./run-local-server-webapp.sh [options]

Starts the local FastAPI server and Next.js webapp with an OTA-safe topology:
- backend on 0.0.0.0:8000
- webapp HTTP on 3000
- webapp HTTPS companion on 3443

Options:
  --public-host HOST         Override the LAN/public host used for firmware targets.
  --server-port PORT         Override backend port. Default: 8000
  --webapp-http-port PORT    Override webapp HTTP port. Default: 3000
  --webapp-https-port PORT   Override webapp HTTPS port. Default: 3443
  --no-docker-deps           Do not auto-start docker compose services db/mqtt.
  -h, --help                 Show this help message.

Environment overrides:
  ECONNECT_PUBLIC_HOST
  ECONNECT_SERVER_PORT
  ECONNECT_WEBAPP_HTTP_PORT
  ECONNECT_WEBAPP_HTTPS_PORT
  ECONNECT_WEBAPP_INTERNAL_HTTP_PORT
  ECONNECT_SERVER_PYTHON
  ECONNECT_START_DOCKER_DEPS=0

Notes:
  - The webapp runs in developer mode with hot reload, but still keeps the
    public OTA-safe topology: HTTP on :3000 and HTTPS companion on :3443.
  - MariaDB and MQTT are expected on localhost. By default the script ensures
    docker compose has db + mqtt running first.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --public-host)
      PUBLIC_HOST_OVERRIDE="${2:?Missing value for --public-host}"
      shift 2
      ;;
    --server-port)
      SERVER_PORT="${2:?Missing value for --server-port}"
      shift 2
      ;;
    --webapp-http-port)
      WEBAPP_HTTP_PORT="${2:?Missing value for --webapp-http-port}"
      shift 2
      ;;
    --webapp-https-port)
      WEBAPP_HTTPS_PORT="${2:?Missing value for --webapp-https-port}"
      shift 2
      ;;
    --no-docker-deps)
      START_DOCKER_DEPS="0"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

load_env_file() {
  local file_path="$1"
  if [[ -f "$file_path" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$file_path"
    set +a
  fi
}

validate_port_number() {
  local port="$1"
  if ! [[ "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
    echo "Invalid TCP port: $port" >&2
    exit 1
  fi
}

check_port_is_free() {
  local port="$1"
  local label="$2"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use and blocks $label." >&2
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2 || true
    exit 1
  fi
}

python_probe() {
  "$SERVER_PYTHON" - "$@"
}

wait_for_tcp_port() {
  local host="$1"
  local port="$2"
  local timeout_seconds="$3"
  local label="$4"

  python_probe "$host" "$port" "$timeout_seconds" "$label" <<'PY'
import socket
import sys
import time

host = sys.argv[1]
port = int(sys.argv[2])
deadline = time.time() + float(sys.argv[3])
label = sys.argv[4]

while time.time() < deadline:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(1.0)
    try:
        sock.connect((host, port))
    except OSError:
        time.sleep(0.5)
    else:
        sock.close()
        sys.exit(0)
    finally:
        sock.close()

print(f"Timed out waiting for {label} on {host}:{port}.", file=sys.stderr)
sys.exit(1)
PY
}

wait_for_http_url() {
  local url="$1"
  local timeout_seconds="$2"
  local label="$3"
  local insecure_tls="${4:-0}"

  python_probe "$url" "$timeout_seconds" "$label" "$insecure_tls" <<'PY'
import ssl
import sys
import time
import urllib.request

url = sys.argv[1]
deadline = time.time() + float(sys.argv[2])
label = sys.argv[3]
insecure_tls = sys.argv[4] == "1"
context = ssl._create_unverified_context() if insecure_tls else None

while time.time() < deadline:
    try:
        with urllib.request.urlopen(url, timeout=3, context=context) as response:
            if 200 <= response.status < 500:
                sys.exit(0)
    except Exception:
        time.sleep(0.5)

print(f"Timed out waiting for {label} at {url}.", file=sys.stderr)
sys.exit(1)
PY
}

detect_public_host() {
  python_probe <<'PY'
import socket

def emit_first(candidates):
    seen = set()
    for candidate in candidates:
        normalized = (candidate or "").strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        if normalized.startswith("127.") or normalized == "::1":
            continue
        print(normalized)
        return

candidates = []
try:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.connect(("8.8.8.8", 80))
        candidates.append(sock.getsockname()[0])
except OSError:
    pass

try:
    hostname = socket.gethostname().strip() or None
    infos = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
except OSError:
    infos = []

for family, _, _, _, sockaddr in infos:
    if family == socket.AF_INET:
        candidates.append(sockaddr[0])

emit_first(candidates)
PY
}

classify_host_for_tls() {
  python_probe "$1" <<'PY'
import ipaddress
import sys

candidate = sys.argv[1].strip()
try:
    ipaddress.ip_address(candidate)
except ValueError:
    print("dns")
else:
    print("ip")
PY
}

validate_public_host() {
  local host="$1"
  python_probe "$host" <<'PY'
import ipaddress
import sys

candidate = sys.argv[1].strip().lower().rstrip(".")
blocked_names = {"", "localhost", "server", "webapp", "db", "mqtt"}

if candidate in blocked_names:
    print(f"Invalid public host for OTA/runtime targets: {candidate!r}", file=sys.stderr)
    sys.exit(1)

try:
    ip = ipaddress.ip_address(candidate)
except ValueError:
    sys.exit(0)

if ip.is_loopback or ip.is_unspecified or ip.is_link_local or ip.is_multicast:
    print(f"Invalid public host for OTA/runtime targets: {candidate!r}", file=sys.stderr)
    sys.exit(1)
PY
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM

  if [[ -n "$WEBAPP_PID" ]] && kill -0 "$WEBAPP_PID" >/dev/null 2>&1; then
    kill "$WEBAPP_PID" >/dev/null 2>&1 || true
    wait "$WEBAPP_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi

  exit "$exit_code"
}

trap cleanup EXIT INT TERM

require_command bash
require_command lsof
require_command npm
[[ -x "$SERVER_PYTHON" ]] || {
  echo "Missing backend Python runtime: $SERVER_PYTHON" >&2
  exit 1
}
[[ -d "$WEBAPP_DIR/node_modules" ]] || {
  echo "Missing webapp dependencies in $WEBAPP_DIR/node_modules. Run 'npm install' in webapp first." >&2
  exit 1
}

load_env_file "$ROOT_DIR/.env"
load_env_file "$SERVER_DIR/.env"
load_env_file "$WEBAPP_DIR/.env.local"

validate_port_number "$SERVER_PORT"
validate_port_number "$WEBAPP_HTTP_PORT"
validate_port_number "$WEBAPP_HTTPS_PORT"
validate_port_number "$WEBAPP_INTERNAL_HTTP_PORT"

if [[ "$WEBAPP_HTTP_PORT" == "$WEBAPP_HTTPS_PORT" || "$WEBAPP_HTTP_PORT" == "$WEBAPP_INTERNAL_HTTP_PORT" || "$WEBAPP_HTTPS_PORT" == "$WEBAPP_INTERNAL_HTTP_PORT" ]]; then
  echo "Webapp ports must be distinct." >&2
  exit 1
fi

PUBLIC_HOST="$PUBLIC_HOST_OVERRIDE"
if [[ -z "$PUBLIC_HOST" && -n "${FIRMWARE_PUBLIC_BASE_URL:-}" ]]; then
  PUBLIC_HOST="$(python_probe "${FIRMWARE_PUBLIC_BASE_URL}" <<'PY'
from urllib.parse import urlsplit
import sys

candidate = sys.argv[1].strip()
parsed = urlsplit(candidate if "://" in candidate else f"//{candidate}", scheme="http")
print(parsed.hostname or "")
PY
)"
fi

if [[ -z "$PUBLIC_HOST" ]]; then
  PUBLIC_HOST="$(detect_public_host)"
fi

if [[ -z "$PUBLIC_HOST" ]]; then
  echo "Could not detect a reachable LAN/public host automatically. Set ECONNECT_PUBLIC_HOST and retry." >&2
  exit 1
fi

validate_public_host "$PUBLIC_HOST"

HOST_CLASS="$(classify_host_for_tls "$PUBLIC_HOST")"
if [[ "$HOST_CLASS" == "ip" ]]; then
  export HTTPS_IPS="${HTTPS_IPS:+$HTTPS_IPS,}$PUBLIC_HOST"
else
  export HTTPS_HOSTS="${HTTPS_HOSTS:+$HTTPS_HOSTS,}$PUBLIC_HOST"
fi

export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-/api/v1}"
export API_URL="${API_URL:-$NEXT_PUBLIC_API_URL}"
export BACKEND_INTERNAL_URL="${BACKEND_INTERNAL_URL:-http://127.0.0.1:$SERVER_PORT}"
export ALLOW_INSECURE_HTTP="${ALLOW_INSECURE_HTTP:-1}"

export FIRMWARE_PUBLIC_BASE_URL="${FIRMWARE_PUBLIC_BASE_URL:-http://$PUBLIC_HOST:$WEBAPP_HTTP_PORT}"
export FIRMWARE_PUBLIC_SCHEME="${FIRMWARE_PUBLIC_SCHEME:-http}"
export FIRMWARE_PUBLIC_PORT="${FIRMWARE_PUBLIC_PORT:-$WEBAPP_HTTP_PORT}"
export FIRMWARE_OTA_PUBLIC_SCHEME="${FIRMWARE_OTA_PUBLIC_SCHEME:-http}"
export FIRMWARE_OTA_PUBLIC_PORT="${FIRMWARE_OTA_PUBLIC_PORT:-$SERVER_PORT}"
export FIRMWARE_MQTT_BROKER="${FIRMWARE_MQTT_BROKER:-$PUBLIC_HOST}"
export FIRMWARE_MQTT_PORT="${FIRMWARE_MQTT_PORT:-${MQTT_PORT:-1883}}"
export MDNS_DISCOVERY_PORT="${MDNS_DISCOVERY_PORT:-$SERVER_PORT}"
export MDNS_WEBAPP_PORT="${MDNS_WEBAPP_PORT:-$WEBAPP_HTTP_PORT}"

if [[ "$START_DOCKER_DEPS" == "1" ]]; then
  require_command docker
  echo "Ensuring docker compose dependencies are up: db, mqtt"
  (
    cd "$ROOT_DIR"
    docker compose up -d db mqtt >/dev/null
  )
fi

wait_for_tcp_port "127.0.0.1" "${MQTT_PORT:-1883}" "30" "MQTT broker"
wait_for_tcp_port "127.0.0.1" "3306" "60" "MariaDB"

check_port_is_free "$SERVER_PORT" "backend"
check_port_is_free "$WEBAPP_HTTP_PORT" "webapp HTTP"
check_port_is_free "$WEBAPP_HTTPS_PORT" "webapp HTTPS"
check_port_is_free "$WEBAPP_INTERNAL_HTTP_PORT" "webapp internal HTTP"

echo "Starting backend on http://$SERVER_HOST:$SERVER_PORT"
(
  cd "$SERVER_DIR"
  exec "$SERVER_PYTHON" -m uvicorn main:app --reload --host "$SERVER_HOST" --port "$SERVER_PORT"
) &
SERVER_PID="$!"

wait_for_http_url "http://127.0.0.1:$SERVER_PORT/health" "60" "backend health"

echo "Starting webapp dev runtime on http://0.0.0.0:$WEBAPP_HTTP_PORT and https://0.0.0.0:$WEBAPP_HTTPS_PORT"
(
  cd "$WEBAPP_DIR"
  exec env \
    PORT="$WEBAPP_HTTP_PORT" \
    HTTPS_PORT="$WEBAPP_HTTPS_PORT" \
    INTERNAL_HTTP_PORT="$WEBAPP_INTERNAL_HTTP_PORT" \
    HOSTNAME="0.0.0.0" \
    npm run dev
) &
WEBAPP_PID="$!"

wait_for_http_url "http://127.0.0.1:$WEBAPP_HTTP_PORT/login" "90" "webapp HTTP login"
wait_for_http_url "https://127.0.0.1:$WEBAPP_HTTPS_PORT/login" "90" "webapp HTTPS login" "1"

cat <<EOF

Local runtime is ready.

- Public host: $PUBLIC_HOST
- Web UI (HTTP):  http://$PUBLIC_HOST:$WEBAPP_HTTP_PORT
- Web UI (HTTPS): https://$PUBLIC_HOST:$WEBAPP_HTTPS_PORT
- Backend health:  http://$PUBLIC_HOST:$SERVER_PORT/health
- Firmware base:   $FIRMWARE_PUBLIC_BASE_URL
- OTA download:    http://$PUBLIC_HOST:$SERVER_PORT/api/v1/diy/ota/download/<job_id>/firmware.bin

Keep this script running while testing OTA. Press Ctrl+C to stop the local backend and webapp.
Docker db/mqtt containers are left running intentionally.
EOF

status=0
while true; do
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    wait "$SERVER_PID" || status=$?
    echo "Backend process exited." >&2
    break
  fi

  if ! kill -0 "$WEBAPP_PID" >/dev/null 2>&1; then
    wait "$WEBAPP_PID" || status=$?
    echo "Webapp process exited." >&2
    break
  fi

  sleep 1
done

exit "$status"
