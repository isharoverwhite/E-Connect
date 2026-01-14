# Agile Management Documentation
> **Purpose**: This document serves as a core artifact for Agile tracking of the "E-Connect IoT Smart Home System" project. It is intended to be parsed by AI agents to generate Product Deliverables.

---

## 1. Product Backlog & Sprint Backlog
**Sprint Goal**: Complete Backend Refactoring (Server & DB) to match the new "E-Connect" Database Design and Use Case Diagram.

| ID | User Story (Feature) | Status | Sprint Assigned |
|----|----------------------|--------|-----------------|
| **u1** | **Device Control** (Local & Remote) | **DONE (Backend)** | Sprint 1 |
| **u2** | **Monitor Sensors** & Export Reports | **DONE (Backend)** | Sprint 1 |
| **u3** | **Personalize Dashboard** (Grid Layout) | **DONE (Backend)** | Sprint 1 |
| **u4** | **Pin Configuration** (SVG Mapping) | **DONE (Backend)** | Sprint 1 |
| **u5** | **No-code Flash** (Web-flasher) | **DONE (Backend)** | Sprint 1 |
| **u6** | **Assign Random UUID** | **DONE** | Sprint 2 |
| **u7** | **Approve DIY Device** (Handshake) | **DONE** | Sprint 2 |
| **u8** | **Full Backup & Restore** | **DONE** | Sprint 2 |
| **u9** | **Automation Engine** | **DONE (API-side)** | Sprint 2 |
| **u10**| **Manage Extensions** | **DONE** | Sprint 2 |
| **u11**| **OTA & Heartbeat Monitoring** | **DONE** | Sprint 2 |
| **u12**| **Manage Users & Roles (RBAC)** | **DONE** | Sprint 1 |

*Note: "DONE (Backend)" implies API endpoints are ready, but Frontend UI integration is pending for future Sprints.*

---

## 2. Kanban / Task Board

### 📋 To Do (Next Sprint - Frontend & Integration)
- [ ] Implement Frontend UI for **Pin Mapping (SVG)** (Use Case u4).
- [ ] Build **Web Flasher Interface** (Use Case u5).
- [ ] Develop **Dashboard Grid System** UI (Use Case u3).
- [ ] Integrate **MQTT Broker** (Mosquitto) for real-time latency U1.
- [ ] Implement **Celery/Redis Worker** for Python Script Execution (Use Case u9).

### 🚧 In Progress (Integration Testing)
- [ ] End-to-End Testing with physical hardware (currently verified with Node.js Simulator).

### ✅ Done (Completed in Sprint 1 & 2)
- [x] **Database Migration**: Refactored complete SQL Schema (`users`, `devices`, `rooms`, `pin_configs`, `automations`, `history`).
- [x] **API Rewrite**: Updated `api.py` to use Pydantic v2 and SQLAlchemy 2.0 styles.
- [x] **Authentication**: Implemented JWT + RBAC (Admin vs Member).
- [x] **Device Handshake**: Handled optional UUID generation and device registration.
- [x] **Legacy Fixes**: Resolved `passlib` bcrypt issues by migrating to direct `bcrypt` library.
- [x] **Simulator Update**: Updated `test_server` (Node.js) to match new JSON payloads.
- [x] **Features**: Implemented Backup/Restore, OTP, CSV Export.

---

## 3. Sprint Burn-down Summary
**Phase: Server Refactoring & Database Migration**

*   **Start**: Project had a mismatch between SQL Models and Use Case Requirements.
*   **Peak**: Encountered dependency conflicts (`passlib`) and Schema integrity errors (`Foreign Key` constraints).
*   **Resolution**:
    *   **Day 1 (Sprint 1)**: Core Auth & User Management completed.
    *   **Day 2 (Sprint 1)**: Device & Sensor Models updated.
    *   **Day 3 (Sprint 2)**: Full Database reset & migration script executed. All advanced features (Backup, Automation trigger) implemented.
*   **Velocity**: High. 100% of Backend Tasks for Phase 1 (Schema), Phase 2 (Compatibility), and Phase 3 (Advanced) were completed within the targeted timeframe.

---

## 4. Sprint Retrospective Report
**Context**: Completion of DB Migration (Phase 1 & 2) and Server Expansion.

### 🌟 What Went Well (Keep doing)
1.  **Strict Schema Adherence**: We strictly followed the provided SQL design, which eliminated ambiguity in the `PinConfiguration` and `DeviceHistory` tables.
2.  **Proactive Simulator Updates**: Updating the Node.js simulator (`test_server`) alongside the API was critical. It allowed us to verify the "Handshake" logic immediately without waiting for hardware.
3.  **Dependency Simplification**: Moving from `passlib` to `bcrypt` removed a brittle dependency that was causing runtime errors on Python 3.13.

### ⚠️ What Needs Improvement (Action Items)
1.  **Database Reset Handling**: The "Foreign Key" error during startup required a manual drop of tables. **Action**: Create a dedicated migration script (Alembic) for future schema changes to avoid nuking the DB.
2.  **Code Merging**: We had a syntax error (duplicate `else` block) during the `api.py` refactor. **Action**: Improve code review or linting steps before applying edits.
3.  **Real-time Architecture**: Currently using HTTP for Device Control (`u1`). **Action**: Prioritize MQTT implementation in the next Sprint to ensure real-time performance matches the "Premium" design requirement.

---
**Deliverable Status**: The **Server Core** is ready for release to the Frontend Team.
