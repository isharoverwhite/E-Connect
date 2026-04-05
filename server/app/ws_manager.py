# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

import json
import logging
import asyncio
from threading import RLock
from typing import Any, Dict, Optional
from fastapi import WebSocket
from starlette.websockets import WebSocketState

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[dict[str, Any]] = []
        self._loop = None
        self._connections_lock = RLock()

    @staticmethod
    def _is_socket_connected(websocket: WebSocket) -> bool:
        return (
            websocket.client_state == WebSocketState.CONNECTED
            and websocket.application_state == WebSocketState.CONNECTED
        )

    def _prune_stale_connections_locked(self) -> int:
        live_connections: list[dict[str, Any]] = []
        stale_count = 0

        for conn in self.active_connections:
            websocket = conn["websocket"]
            if self._is_socket_connected(websocket):
                live_connections.append(conn)
            else:
                stale_count += 1

        if stale_count:
            self.active_connections = live_connections

        return stale_count

    def _snapshot_live_connections(self) -> list[dict[str, Any]]:
        with self._connections_lock:
            stale_count = self._prune_stale_connections_locked()
            snapshot = list(self.active_connections)

        if stale_count:
            logger.debug("Pruned %d stale WS connection(s) before broadcast.", stale_count)

        return snapshot

    def _remove_connections(self, websockets: list[WebSocket]) -> int:
        if not websockets:
            return 0

        websocket_ids = {id(websocket) for websocket in websockets}
        with self._connections_lock:
            before = len(self.active_connections)
            self.active_connections = [
                conn for conn in self.active_connections if id(conn["websocket"]) not in websocket_ids
            ]
            return before - len(self.active_connections)

    async def connect(self, websocket: WebSocket, user_id: int, account_type: str, accessible_room_ids: list[int]):
        await websocket.accept()
        if self._loop is None or self._loop.is_closed():
            self._loop = asyncio.get_running_loop()
        with self._connections_lock:
            self._prune_stale_connections_locked()
            self.active_connections = [
                conn for conn in self.active_connections if conn["websocket"] != websocket
            ]
            self.active_connections.append({
                "websocket": websocket,
                "user_id": user_id,
                "account_type": account_type,
                "accessible_room_ids": accessible_room_ids
            })
        logger.debug(f"WS connected user_id={user_id}. Active: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self._remove_connections([websocket])

    async def broadcast_device_event(self, event_type: str, device_id: str, room_id: Optional[int], payload: Dict[str, Any]):
        message = json.dumps({
            "type": event_type,
            "device_id": device_id,
            "payload": payload
        })

        dead_connections: list[WebSocket] = []
        for conn in self._snapshot_live_connections():
            websocket = conn["websocket"]
            has_permission = (
                conn["account_type"] == "admin" or
                (room_id is not None and room_id in conn["accessible_room_ids"])
            )

            if has_permission:
                if not self._is_socket_connected(websocket):
                    dead_connections.append(websocket)
                    continue
                try:
                    await websocket.send_text(message)
                except Exception as e:
                    logger.debug("Dropping stale WS connection during %s broadcast: %s", event_type, e)
                    dead_connections.append(websocket)

        removed_count = self._remove_connections(dead_connections)
        if removed_count:
            logger.debug("Removed %d stale WS connection(s) after %s broadcast.", removed_count, event_type)

    async def broadcast_system_event(self, event_type: str, payload: Dict[str, Any]):
        message = json.dumps({
            "type": event_type,
            "payload": payload
        })

        dead_connections: list[WebSocket] = []
        for conn in self._snapshot_live_connections():
            websocket = conn["websocket"]
            if conn["account_type"] == "admin":
                if not self._is_socket_connected(websocket):
                    dead_connections.append(websocket)
                    continue
                try:
                    await websocket.send_text(message)
                except Exception as e:
                    logger.debug("Dropping stale WS connection during %s system broadcast: %s", event_type, e)
                    dead_connections.append(websocket)

        removed_count = self._remove_connections(dead_connections)
        if removed_count:
            logger.debug("Removed %d stale WS connection(s) after %s system broadcast.", removed_count, event_type)

    def broadcast_device_event_sync(self, event_type: str, device_id: str, room_id: Optional[int], payload: Dict[str, Any]):
        if self._loop is not None and not self._loop.is_closed():
            asyncio.run_coroutine_threadsafe(
                self.broadcast_device_event(event_type, device_id, room_id, payload),
                self._loop
            )

manager = ConnectionManager()
