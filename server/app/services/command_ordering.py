# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from __future__ import annotations

from dataclasses import dataclass
from threading import Lock


@dataclass(frozen=True)
class CommandOrderingTicket:
    command_id: str
    device_id: str
    scope_key: str
    sequence_number: int
    superseded_command_id: str | None = None


class CommandOrderingManager:
    def __init__(self) -> None:
        self._lock = Lock()
        self._latest_by_scope: dict[str, str] = {}
        self._sequence_by_scope: dict[str, int] = {}
        self._tickets: dict[str, dict[str, str | int | None]] = {}

    def activate(self, *, command_id: str, device_id: str, scope_key: str) -> CommandOrderingTicket:
        with self._lock:
            previous_command_id = self._latest_by_scope.get(scope_key)
            if previous_command_id:
                previous_ticket = self._tickets.get(previous_command_id)
                if previous_ticket is not None:
                    previous_ticket["superseded_by"] = command_id

            sequence_number = int(self._sequence_by_scope.get(scope_key, 0)) + 1
            self._sequence_by_scope[scope_key] = sequence_number
            self._latest_by_scope[scope_key] = command_id
            self._tickets[command_id] = {
                "command_id": command_id,
                "device_id": device_id,
                "scope_key": scope_key,
                "sequence_number": sequence_number,
                "superseded_by": None,
            }
            return CommandOrderingTicket(
                command_id=command_id,
                device_id=device_id,
                scope_key=scope_key,
                sequence_number=sequence_number,
                superseded_command_id=previous_command_id,
            )

    def is_latest(self, command_id: str) -> bool:
        with self._lock:
            ticket = self._tickets.get(command_id)
            if ticket is None:
                return False
            scope_key = str(ticket["scope_key"])
            return (
                self._latest_by_scope.get(scope_key) == command_id
                and ticket.get("superseded_by") is None
            )

    def get(self, command_id: str) -> CommandOrderingTicket | None:
        with self._lock:
            ticket = self._tickets.get(command_id)
            if ticket is None:
                return None
            return CommandOrderingTicket(
                command_id=str(ticket["command_id"]),
                device_id=str(ticket["device_id"]),
                scope_key=str(ticket["scope_key"]),
                sequence_number=int(ticket["sequence_number"]),
                superseded_command_id=(
                    str(ticket["superseded_by"])
                    if isinstance(ticket.get("superseded_by"), str)
                    else None
                ),
            )

    def complete(self, command_id: str) -> CommandOrderingTicket | None:
        with self._lock:
            ticket = self._tickets.pop(command_id, None)
            if ticket is None:
                return None

            scope_key = str(ticket["scope_key"])
            if self._latest_by_scope.get(scope_key) == command_id:
                self._latest_by_scope.pop(scope_key, None)

            return CommandOrderingTicket(
                command_id=str(ticket["command_id"]),
                device_id=str(ticket["device_id"]),
                scope_key=scope_key,
                sequence_number=int(ticket["sequence_number"]),
                superseded_command_id=(
                    str(ticket["superseded_by"])
                    if isinstance(ticket.get("superseded_by"), str)
                    else None
                ),
            )

    def reset(self) -> None:
        with self._lock:
            self._latest_by_scope.clear()
            self._sequence_by_scope.clear()
            self._tickets.clear()


command_ordering_manager = CommandOrderingManager()
