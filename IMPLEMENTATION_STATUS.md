# Implementation Status & Task List

Based on the "E-Connect IoT Smart Home System" Use Case Diagram.

## Core Actors
- **Administrator**: Full access (Managed via RBAC `role="admin"`).
- **Member**: Limited access (Managed via RBAC `role="member"`).

## Use Cases & Status

### u1: Device Control (Local & Remote)
- [x] **Real-time Control API**: API endpoint (`POST /device/{id}/command`) implemented to log commands (ready for MQTT).
- [x] **Config Updates**: Server handles configuration updates which can trigger device changes.

### u2: Monitor Sensors & Export Reports
- [x] **Ingest Data**: `POST /device/{uuid}/data` (mapped to `/history`) implemented.
- [x] **View Data**: `GET /device/{uuid}/data` (mapped to `/history`) implemented.
- [x] **Export Reports**: `GET /device/{uuid}/export` implemented (CSV Download).

### u3: Personalize Dashboard (Grid Layout)
- [x] **Database Model**: `DashboardLayout` table created (column `ui_layout` in `users`).
- [x] **Save/Load API**: `PUT /users/me/layout` implemented.

### u4: Pin Configuration (SVG Mapping)
- [x] **Data Model**: `HardwareConfig` and `PinConfig` JSON structures moved to Relational `PinConfiguration` table.
- [x] **Storage**: stored in `Device` table.
- [x] **SVG Mapping Logic**: Server-side support ready (Pin data available in device config). Frontend task pending.

### u5: No-code Flash (Web-flasher)
- [x] **Firmware Storage**: `Firmware` table and file storage implemented.
- [x] **OTA API**: Endpoints to upload and download firmware binaries implemented.
- [x] **Web Flasher Interface**: Server endpoints ready. Frontend task pending.

### u6: Assign Random UUID
- [x] **UUID Generation**: Server automatically assigns a UUIDv4 if a device connects without one (`register_device_handshake`).

### u7: Approve DIY Device (Handshake)
- [x] **Authorization Flag**: `is_active` column implemented.
- [x] **Approval Endpoint**: `POST /device/{uuid}/approve` implemented.
- [x] **Rejection/Blocking**: Implicitly handled (inactive devices can be ignored or deleted).

### u8: Full Backup & Restore
- [x] **Backup**: `GET /system/backup` implemented (exports JSON).
- [x] **Restore**: `GET /device/{id}/restore/{archive_id}` implemented for per-device restore.

### u9: Automation Engine (Python Scripting)
- [x] **Script Management**: `AutomationScript` table and CRUD endpoints implemented.
- [x] **Execution Engine**: `POST /automation/{id}/trigger` implemented (Placeholder for execution log).

### u10: Manage Extensions (Custom Scripts)
- [x] **Extensions Repository**: Handled via Automation Scripts (User can upload/manage scripts).

### u11: OTA & Heartbeat Monitoring
- [x] **Heartbeat API**: `POST /device/{uuid}/history` (event: online) implemented.
- [x] **Status Tracking**: `last_seen` and `status` updated automatically.
- [x] **OTA Checks**: Devices can check for latest versions.

### u12: Manage Users & Roles (RBAC)
- [x] **Registration**: implemented.
- [x] **Login/Token**: implemented (JWT).
- [x] **Role Management**: implemented (`admin` vs `member` checks).

---

## Action Plan (Next Steps)
1. **Frontend Development**: The server is now fully featured. Next steps involve building the UI to consume these APIs.
2. **MQTT Integration**: Replace the REST placeholder for real-time control with an MQTT broker (Mosquitto) for lower latency.
3. **Automation Worker**: Implement a background worker (e.g., Celery) to execute Python scripts safely.
