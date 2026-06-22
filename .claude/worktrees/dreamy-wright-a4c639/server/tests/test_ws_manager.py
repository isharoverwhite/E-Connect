# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from __future__ import annotations

import asyncio
import json
import logging

from starlette.websockets import WebSocketState

from app.ws_manager import ConnectionManager


class FakeWebSocket:
    def __init__(
        self,
        *,
        client_state: WebSocketState = WebSocketState.CONNECTED,
        application_state: WebSocketState = WebSocketState.CONNECTED,
        fail_on_send: bool = False,
        fail_on_accept: bool = False,
    ) -> None:
        self.client_state = client_state
        self.application_state = application_state
        self.fail_on_send = fail_on_send
        self.fail_on_accept = fail_on_accept
        self.accepted = False
        self.sent_messages: list[str] = []

    async def accept(self) -> None:
        if self.fail_on_accept:
            self.client_state = WebSocketState.DISCONNECTED
            self.application_state = WebSocketState.DISCONNECTED
            raise RuntimeError("socket closed before accept")
        self.accepted = True
        self.client_state = WebSocketState.CONNECTED
        self.application_state = WebSocketState.CONNECTED

    async def send_text(self, message: str) -> None:
        if self.fail_on_send:
            self.client_state = WebSocketState.DISCONNECTED
            self.application_state = WebSocketState.DISCONNECTED
            raise RuntimeError("socket closed")
        self.sent_messages.append(message)


def test_connect_prunes_stale_connections_before_registering_new_socket() -> None:
    manager = ConnectionManager()
    stale_socket = FakeWebSocket(
        client_state=WebSocketState.DISCONNECTED,
        application_state=WebSocketState.DISCONNECTED,
    )
    fresh_socket = FakeWebSocket(
        client_state=WebSocketState.CONNECTING,
        application_state=WebSocketState.CONNECTING,
    )
    manager.active_connections = [
        {
            "websocket": stale_socket,
            "user_id": 1,
            "account_type": "admin",
            "accessible_room_ids": [],
        }
    ]

    asyncio.run(manager.connect(fresh_socket, 2, "admin", []))

    assert fresh_socket.accepted is True
    assert len(manager.active_connections) == 1
    assert manager.active_connections[0]["websocket"] is fresh_socket


def test_connect_skips_accept_for_already_connected_socket() -> None:
    manager = ConnectionManager()
    websocket = FakeWebSocket()

    connected = asyncio.run(manager.connect(websocket, 2, "admin", []))

    assert connected is True
    assert websocket.accepted is False
    assert len(manager.active_connections) == 1
    assert manager.active_connections[0]["websocket"] is websocket


def test_connect_ignores_stale_socket_when_accept_fails(caplog) -> None:
    manager = ConnectionManager()
    stale_socket = FakeWebSocket(
        client_state=WebSocketState.CONNECTING,
        application_state=WebSocketState.CONNECTING,
        fail_on_accept=True,
    )

    with caplog.at_level(logging.WARNING):
        connected = asyncio.run(manager.connect(stale_socket, 2, "admin", []))

    assert connected is False
    assert stale_socket.accepted is False
    assert manager.active_connections == []
    assert not [record for record in caplog.records if record.levelno >= logging.WARNING]


def test_broadcast_device_event_prunes_stale_connections_without_warning(caplog) -> None:
    manager = ConnectionManager()
    stale_socket = FakeWebSocket(
        client_state=WebSocketState.DISCONNECTED,
        application_state=WebSocketState.DISCONNECTED,
    )
    live_socket = FakeWebSocket()
    manager.active_connections = [
        {
            "websocket": stale_socket,
            "user_id": 1,
            "account_type": "admin",
            "accessible_room_ids": [],
        },
        {
            "websocket": live_socket,
            "user_id": 2,
            "account_type": "admin",
            "accessible_room_ids": [],
        },
    ]

    with caplog.at_level(logging.WARNING):
        asyncio.run(
            manager.broadcast_device_event(
                "command_delivery",
                "device-1",
                None,
                {"command_id": "cmd-1", "status": "acknowledged"},
            )
        )

    assert len(manager.active_connections) == 1
    assert manager.active_connections[0]["websocket"] is live_socket
    assert len(live_socket.sent_messages) == 1
    assert json.loads(live_socket.sent_messages[0]) == {
        "type": "command_delivery",
        "device_id": "device-1",
        "payload": {"command_id": "cmd-1", "status": "acknowledged"},
    }
    assert not [record for record in caplog.records if record.levelno >= logging.WARNING]


def test_broadcast_system_event_removes_failed_socket_without_warning(caplog) -> None:
    manager = ConnectionManager()
    failing_socket = FakeWebSocket(fail_on_send=True)
    live_socket = FakeWebSocket()
    manager.active_connections = [
        {
            "websocket": failing_socket,
            "user_id": 1,
            "account_type": "admin",
            "accessible_room_ids": [],
        },
        {
            "websocket": live_socket,
            "user_id": 2,
            "account_type": "admin",
            "accessible_room_ids": [],
        },
    ]

    with caplog.at_level(logging.WARNING):
        asyncio.run(
            manager.broadcast_system_event(
                "system_metrics",
                {"cpu_percent": 20, "memory_used": 512},
            )
        )

    assert len(manager.active_connections) == 1
    assert manager.active_connections[0]["websocket"] is live_socket
    assert len(live_socket.sent_messages) == 1
    assert json.loads(live_socket.sent_messages[0]) == {
        "type": "system_metrics",
        "payload": {"cpu_percent": 20, "memory_used": 512},
    }
    assert not [record for record in caplog.records if record.levelno >= logging.WARNING]
