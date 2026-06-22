# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from __future__ import annotations


class ExtensionRuntimeError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        mark_offline: bool = False,
        connection_failed: bool = False,
    ) -> None:
        super().__init__(message)
        self.mark_offline = mark_offline
        self.connection_failed = connection_failed


class ExtensionValidationError(ExtensionRuntimeError):
    pass


class ExtensionUnsupportedError(ExtensionRuntimeError):
    pass
