# Yeelight Code Bottleneck Analysis

## File Locations

| File | Purpose |
|------|---------|
| `server/tests/fixtures/Yeelight_control/yeelight_control.py` (1032 lines) | Core Yeelight LAN protocol implementation |
| `server/tests/fixtures/Yeelight_control/main.py` (51 lines) | Entry point / adapter |
| `server/app/services/external_runtime.py` (1398 lines) | Server-side runtime that delegates to extensions |
| `server/app/api.py` | HTTP API endpoints for device commands |
| `server/scripts/yeelight_discovery_helper.py` (124 lines) | SSDP discovery helper service |

## Bottleneck 1: Session Lock Serialization (CRITICAL)

**Location:** `yeelight_control.py` lines 88-102

```python
_SESSION_POOL_LOCK = threading.Lock()
_SESSION_POOL: dict[tuple[str, int], _YeelightSessionState] = {}

class _YeelightLanSession:
    def __enter__(self):
        state = _get_session_state(...)
        state.lock.acquire()  # ← ALL operations to same lamp wait here
```

**Problem:** The session pool uses ONE lock per (host, port). Every command and every probe to the same Yeelight lamp acquires this lock. During the lock hold, the code:
- Creates TCP connection (if needed)
- Sends JSON command
- Reads response (up to 1.5s with timeout windows)

If two concurrent operations target the same lamp, the second one **blocks** waiting for the first to release the lock.

**Fix:** Use separate send/receive locks or implement a command queue that batches operations.

## Bottleneck 2: SSDP Discovery Fallback (CRITICAL)

**Location:** `yeelight_control.py` lines 751-802

```python
def _discover_yeelight_metadata(host: str) -> dict | None:
    discovery = _discover_yeelight_metadata_via_udp(host)  # Up to 2s
    if discovery is not None:
        return discovery
    return _discover_yeelight_metadata_via_helper(host)     # Up to 1.5s
```

**Problem:** On ANY failure (timeout, connection error, validation error), the system falls back to:
1. UDP SSDP multicast: 2 attempts × 1s timeout = **2 seconds**
2. HTTP discovery helper: **1.5 seconds** timeout
3. Total worst case: **3.5 seconds** of blocking

This is triggered from both `_probe_yeelight_state()` (line 489) and `execute_command()` (line 270).

**Fix:** Cache discovery results. Don't rediscover on every failure — only when the lamp IP might have changed.

## Bottleneck 3: Reconciliation Retry Loop (HIGH)

**Location:** `yeelight_control.py` lines 349-380, 438-473

```python
def _reconcile_yeelight_command_after_failure(...):
    time.sleep(RECONCILE_DELAY_SECONDS)  # 0.15s
    observed_state = _probe_yeelight_state(...)  # Network call
    if _yeelight_state_matches_command(...):
        return observed_state
    return _retry_yeelight_command_with_power_preflight(...)
        # → another session + power_on + command + sleep(0.15) + probe AGAIN
```

**Problem:** On command failure, the system:
1. Sleeps 0.15s
2. Probes the lamp (network call + lock acquisition)
3. If state doesn't match expected → turns lamp on + re-sends command + sleeps 0.15s + probes again

This adds **0.3s-1s** of extra latency on failure paths.

**Fix:** Only reconcile for power-on preflight. For other failures, let the next refresh cycle correct the state.

## Bottleneck 4: Socket Read Timeout Windows (HIGH)

**Location:** `yeelight_control.py` lines 44-45, 162-174

```python
DEFAULT_TIMEOUT_SECONDS = 0.5
DEFAULT_READ_TIMEOUT_WINDOWS = 3

def _read_message(self):
    timeout_windows = 0
    while b"\r\n" not in state.recv_buffer:
        packet = state.socket.recv(4096)
        # On timeout: timeout_windows += 1
        # Retry up to 3 times before giving up
```

**Problem:** If the lamp is slow (network congestion, busy processing), each read retries up to 3 times at 0.5s each = **1.5 seconds** per message.

**Fix:** Reduce windows to 1 and increase base timeout to 1s. This gives faster failure detection.

## Bottleneck 5: Predicted State Instead of Actual State (MEDIUM)

**Location:** `yeelight_control.py` lines 416-435, 681-748

```python
def _execute_yeelight_command_direct(...):
    with _YeelightLanSession(host) as session:
        _apply_yeelight_command(session, ...)
    return _build_yeelight_predicted_state(...)  # ← PREDICTS, doesn't read back
```

**Problem:** After sending a command, the code does NOT read back the actual lamp state. Instead, it builds a "predicted" state based on what it THINKS the lamp should be. This means:
- If the command fails silently, the UI shows wrong state
- The next `get_device` call returns stale/predicted state until the refresh cycle corrects it
- User sees brightness change "instantly" in UI but the lamp might not have changed

## Bottleneck 6: DB State Caching with No Invalidation (MEDIUM)

**Location:** `api.py` line 4198, `external_runtime.py` line 2434

```python
@router.get("/device/{device_id}")
async def get_device(device_id: str, ...):
    external_device = _get_external_device_in_household_or_404(...)
    return _serialize_external_device(external_device)  # ← Reads last_state from DB
```

**Problem:** `GET /device/{device_id}` reads `last_state` from the database, which is only updated:
1. On `refresh_external_device_states_once()` cycle
2. After command execution completes
3. Via WebSocket push after state changes

Between these updates, the returned state can be **stale**. Combined with Bottleneck 5 (predicted state), the UI may show incorrect brightness for extended periods.

## Summary: Where the Time Goes

For a typical brightness query + change:

| Step | Time (best) | Time (worst) |
|------|------------|--------------|
| HTTP request → server | 5-50ms | 200ms |
| POST /command → background task spawn | 1-5ms | 10ms |
| Session lock acquisition | 0ms | **500ms** (if other op holds lock) |
| TCP connect (if expired) | 5ms | 100ms |
| JSON send + read | 10ms | **1500ms** (3 timeout windows) |
| SSDP discovery (if failure) | 0ms | **3500ms** |
| Reconciliation (if failure) | 0ms | **1000ms** |
| WebSocket broadcast → UI update | 5-50ms | 200ms |
| **TOTAL** | **20-120ms** | **7000ms** |
