import json
import logging
import asyncio
from typing import Any, Dict, Optional
from fastapi import WebSocket

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[dict[str, Any]] = []
        self._loop = None

    async def connect(self, websocket: WebSocket, user_id: int, account_type: str, accessible_room_ids: list[int]):
        await websocket.accept()
        if self._loop is None:
            self._loop = asyncio.get_running_loop()
        self.active_connections.append({
            "websocket": websocket,
            "user_id": user_id,
            "account_type": account_type,
            "accessible_room_ids": accessible_room_ids
        })
        logger.debug(f"WS connected user_id={user_id}. Active: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections = [
            conn for conn in self.active_connections if conn["websocket"] != websocket
        ]

    async def broadcast_device_event(self, event_type: str, device_id: str, room_id: Optional[int], payload: Dict[str, Any]):
        message = json.dumps({
            "type": event_type,
            "device_id": device_id,
            "payload": payload
        })

        dead_connections = []
        for conn in self.active_connections:
            has_permission = (
                conn["account_type"] == "admin" or
                (room_id is not None and room_id in conn["accessible_room_ids"])
            )

            if has_permission:
                try:
                    await conn["websocket"].send_text(message)
                except Exception as e:
                    logger.warning(f"Error sending WS message: {e}")
                    dead_connections.append(conn["websocket"])

        for ws in dead_connections:
            self.disconnect(ws)

    async def broadcast_system_event(self, event_type: str, payload: Dict[str, Any]):
        message = json.dumps({
            "type": event_type,
            "payload": payload
        })

        dead_connections = []
        for conn in self.active_connections:
            if conn["account_type"] == "admin":
                try:
                    await conn["websocket"].send_text(message)
                except Exception as e:
                    logger.warning(f"Error sending WS message: {e}")
                    dead_connections.append(conn["websocket"])

        for ws in dead_connections:
            self.disconnect(ws)

    def broadcast_device_event_sync(self, event_type: str, device_id: str, room_id: Optional[int], payload: Dict[str, Any]):
        if self._loop is not None and not self._loop.is_closed():
            asyncio.run_coroutine_threadsafe(
                self.broadcast_device_event(event_type, device_id, room_id, payload),
                self._loop
            )

manager = ConnectionManager()
