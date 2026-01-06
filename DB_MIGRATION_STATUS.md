# Database Migration & Compatibility Status

## Overview
The database schema has been completely refactored to match the user-provided SQL design.
This document tracks the tasks required to align the codebase with the new schema.

## Migration Tasks

### Phase 1: Database Schema (Server) - ✅ COMPLETED
- [x] **Users Table**: Refactor to `user_id`, `authentication`, `account_type`.
- [x] **Rooms Table**: Create new table for User-Room relationship.
- [x] **Devices Table**: Refactor to `device_id` (UUID), add MQTT topics, link to Room/User.
- [x] **Pin Configs**: Move from JSON to `pin_configurations` relational table.
- [x] **Automations**: Update columns (`script_code`, `last_triggered`).
- [x] **History**: Create `device_history` to replace simple `SensorData`.
- [x] **API Models**: Update `sql_models.py` and Pydantic `models.py` to match SQL.
- [x] **API Endpoints**: Rewrite `api.py` to support new schema flow (Handshake, Auth).

### Phase 2: Client/Device Compatibility - ✅ COMPLETED
- [x] **Test Server (Node.js)**: Update simulator to send new Handshake Payload (`DeviceRegister`).
- [x] **Firmware (ESP32)**: Update .ino file to match new JSON payload structure.
- [x] **UUID Generation**: Server now supports generating UUIDs for devices that don't send one.

### Phase 3: Advanced Features - ✅ COMPLETED
- [x] **Backup/Restore**: Implement API to write/read from `backup_archives` table.
- [x] **Room Management**: Add CRUD API for `rooms`.
- [x] **Dashboard API**: Implement API for `ui_layout` storage in `users` table.
- [x] **Automation Trigger**: Add endpoint to manually trigger automation scripts.
- [x] **Data Export**: Add CSV export for device history.

## Changes Details

### Implemented Tables
1.  **Users (`users`)**:
    *   Renamed `id` -> `user_id`.
    *   Renamed `hashed_password` -> `authentication`.
    *   Added `fullname`, `ui_layout`, `account_type`.
2.  **Rooms (`rooms`)**: New table linking users and rooms.
3.  **Devices (`devices`)**:
    *   Refactored ID to `device_id` (UUID).
    *   Added `mac_address`, `topic_pub`, `topic_sub`.
    *   Changed `is_authorized` -> `is_active`.
4.  **Pin Configurations (`pin_configurations`)**:
    *   Replaced JSON blob with dedicated relational table.
    *   Supports `gpio_pin`, `mode`, `v_pin`.
5.  **Automations (`automations`)**:
    *   Renamed `content` -> `script_code`.
    *   Added `last_triggered`.
6.  **Device History (`device_history`)**:
    *   Replaces `SensorData`.
    *   Tracks `event_type` and `payload`.
