# E-Connect Testing Plan - Detailed Strategy

## 1. Introduction
This plan outlines the systematic testing process for the E-Connect system, adhering to the Waterfall methodology. It ensures that every service, API, and UI flow meets the requirements defined in the PRD v2.0.

---

## 2. Testing Levels Definition

| Level | Goal | Scope | Evidence Requirement |
|---|---|---|---|
| **Unit (UT)** | Verify small blocks of code. | Logic, Utils, Services. | `pytest` output, coverage > 80%. |
| **Integration (IT)** | Verify communication between components. | API -> DB, API -> MQTT. | `mariadb_nas` queries, MQTT logs. |
| **End-to-End (E2E)** | Verify real-world user workflows. | UI -> Backend -> Hardware Logic. | `chrome-devtools` traces, Screenshots. |

---

## 3. Detailed Unit Testing Matrix

### 3.1 Backend (Python / FastAPI)
| Function/Module | Test Case ID | Test Scenario | Steps to Perform | Expected Result |
|---|---|---|---|---|
| `auth_service.py` | UT-AUTH-001 | Token Minting | Call `create_access_token` with valid payload. | Returns a valid JWT string. |
| `auth_service.py` | UT-AUTH-002 | Token Verification | Call `verify_token` with expired JWT. | Raises `HTTPException` (401). |
| `builder.py` | UT-DIY-001 | GPIO Mapping Validation | Provide JSON with overlapping SDA/SCL pins. | Returns `validation_error` list. |
| `builder.py` | UT-DIY-002 | YAML Generation | Input valid pin configuration JSON. | Produces valid ESPHome-compatible YAML. |
| `mqtt_adapter.py` | UT-MQTT-001 | Topic Formatting | Call `get_topic` for a specific device UUID. | Returns `econnect/devices/{uuid}/command`. |

### 3.2 Frontend (Next.js / TypeScript)
| Component | Test Case ID | Test Scenario | Steps to Perform | Expected Result |
|---|---|---|---|---|
| `useAuth` hook | UT-WEB-001 | Context Rehydration | Mock `localStorage` with token and mount app. | App enters `Authenticated` state. |
| `PinEditor.tsx` | UT-WEB-002 | Capability Filter | Pass pin metadata (GPIO 2, Output only). | Mode dropdown only shows `OUTPUT`. |
| `LayoutEngine` | UT-WEB-003 | Grid Collision | Attempt to place widget over existing one. | `canPlace` function returns `false`. |

---

## 4. Detailed End-to-End (E2E) Testing Matrix

| Flow ID | Title | Happy Path Steps | Failure Path / Edge Case | DB Verification | Evidence |
|---|---|---|---|---|---|
| **E2E-SETUP** | **System Bootstrap** | 1. Access `/setup`<br>2. Fill Admin & Household<br>3. Submit | 1. Re-access `/setup` after completion.<br>2. Expected: Redirect to `/login` or 403. | `SELECT * FROM users;` (verify 1 admin created) | Browser Trace + DB Row |
| **E2E-ONBOARD** | **DIY Handshake** | 1. Un-registered device sends `/config`<br>2. Admin approves on `/devices` | 1. Reject a pending device.<br>2. Expected: Device stays in `rejected` status. | `SELECT status FROM devices WHERE id={uuid};` | Network Log (200 OK) + DB status |
| **E2E-BUILD** | **Firmware Build** | 1. Config DIY in UI<br>2. Trigger "Server Build"<br>3. Download `.bin` | 1. Trigger build with conflicting pins.<br>2. Expected: Build button disabled + local validation error. | `SELECT state FROM build_jobs ORDER BY id DESC LIMIT 1;` | `build_jobs` table (status: artifact_ready) |
| **E2E-CONTROL** | **MQTT Toggle** | 1. Toggle switch in UI<br>2. Observe MQTT broker msg | 1. Toggle while device is Offline.<br>2. Expected: UI shows "Device Offline" toast. | `SELECT * FROM device_history WHERE event_type='command';` | MQTT Explorer log + Toast screenshot |
| **E2E-AUTO** | **Automation Run** | 1. Set "Trigger: Button A"<br>2. Set "Action: Light ON"<br>3. Manual Trigger | 1. Trigger automation with invalid script logic.<br>2. Expected: Status 'failed' + error log entry. | `SELECT status FROM execution_logs WHERE auto_id={id};` | Execution Log Table Screenshot |

---

## 5. Persistence Verification Strategy (`mariadb_nas`)

| Table Name | Critical Fields to Check | When to Verify | Target Row Value |
|---|---|---|---|
| `users` | `username`, `is_active`, `is_approved` | After `/setup` or `Create User` | `is_approved = 1` for admin. |
| `devices` | `household_id`, `auth_status` | After `Handshake` & `Approve` | `auth_status = 'approved'`. |
| `build_jobs` | `artifact_path`, `finished_at` | After `Server Build` | `artifact_path` must not be null. |
| `automations` | `is_enabled`, `last_triggered_at` | After `Toggle` & `Trigger` | `is_enabled` matches UI toggle. |

---

## 6. Infrastructure & Tooling

1. **Backend Testing**: `pytest` for all unit and integration tests.
2. **Frontend Testing**: `Playwright` or `Chrome DevTools MCP` for E2E flows.
3. **Database Inspection**: `mariadb_nas` for manual and automated verification.
4. **Mocking**: `unittest.mock` for external services like MQTT Broker or Serial Ports.

## 7. Responsibility Matrix

- **Main**: Coordinates the overall testing session and gate approvals.
- **Planner**: Defines the test cases and acceptance criteria.
- **Coder**: Implements unit tests and fixes defects.
- **Tester**: Executes E2E flows and provides independent verification evidence.
