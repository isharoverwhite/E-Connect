# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

"""Unit tests for app.services.extension_runtime_loader.

These tests exercise the loader in isolation — no real database, no network.
They create throwaway ZIP archives on disk (under the real EXTENSION_EXTRACTED_DIR /
EXTENSION_PACKAGES_DIR paths used by extensions.py so that the path helpers work
correctly) and clean up after each test.
"""

from __future__ import annotations

import hashlib
import io
import json
import shutil
import sys
import zipfile
from pathlib import Path
from types import ModuleType
from typing import Any
from unittest.mock import patch

import pytest

# ---------------------------------------------------------------------------
# Ensure server root is on sys.path (mirrors conftest.py behaviour).
# ---------------------------------------------------------------------------
SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from app.services.extension_runtime_loader import (
    ExtensionRuntimeLoadError,
    LoadedExtensionRuntime,
    _load_module,
    _read_package_entrypoint,
    _read_package_hooks,
    clear_extension_runtime_cache,
    load_installed_extension_runtime,
    resolve_runtime_hook,
    validate_extension_package_runtime,
)
from app.services.extensions import (
    EXTENSION_EXTRACTED_DIR,
    EXTENSION_PACKAGES_DIR,
    DEFAULT_PACKAGE_HOOKS,
    OPTIONAL_PACKAGE_HOOKS,
    extract_extension_archive,
    resolve_extracted_extension_dir,
)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_TEST_EXTENSION_ID = "unit-test-ext"
_TEST_VERSION = "0.0.1-unit"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_zip_bytes(files: dict[str, str]) -> bytes:
    """Build an in-memory ZIP from {filename: text_content}."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buf.getvalue()


def _minimal_manifest(
    *,
    extension_id: str = _TEST_EXTENSION_ID,
    version: str = _TEST_VERSION,
    entrypoint: str = "main.py",
    hooks: dict[str, str] | None = None,
    extra_schemas: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Return a fully-valid normalized manifest dict."""
    resolved_hooks = hooks or {k: k for k in DEFAULT_PACKAGE_HOOKS}
    return {
        "manifest_version": "1.0",
        "extension_id": extension_id,
        "name": "Unit Test Extension",
        "version": version,
        "author": "test",
        "description": "Created by unit tests.",
        "provider": {"key": "unit-test", "display_name": "Unit Test"},
        "package": {
            "runtime": "python",
            "entrypoint": entrypoint,
            "hooks": resolved_hooks,
        },
        "device_schemas": extra_schemas or [
            {
                "schema_id": "unit-switch",
                "device_type": "switch",
                "name": "Unit Switch",
                "default_name": "Unit Switch",
                "description": "A test switch.",
                "display": {"card_type": "switch", "capabilities": ["power"]},
                "config_schema": {"fields": []},
            }
        ],
    }


_MINIMAL_HOOKS_PY = """\
def validate_command(device, command):
    return True

def execute_command(device, command):
    return {"status": "ok"}

def probe_state(device):
    return {"power": "on"}
"""

_HOOKS_VALIDATE_FALSE_PY = """\
def validate_command(device, command):
    return False

def execute_command(device, command):
    return {}

def probe_state(device):
    return {}
"""

_HOOKS_VALIDATE_RAISES_PY = """\
def validate_command(device, command):
    raise RuntimeError("validate failed intentionally")

def execute_command(device, command):
    raise RuntimeError("execute failed intentionally")

def probe_state(device):
    raise RuntimeError("probe failed intentionally")
"""

_HOOKS_PROBE_RETURNS_STATE_PY = """\
def validate_command(device, command):
    return True

def execute_command(device, command):
    return {"brightness": 42}

def probe_state(device):
    return {"power": "off", "brightness": 0}
"""

_HOOKS_WITH_DISCOVER_PY = """\
def validate_command(device, command):
    return True

def execute_command(device, command):
    return {}

def probe_state(device):
    return {}

def discover_devices(config):
    return [{"host": "192.168.1.1"}]
"""

_HOOKS_SYNTAX_ERROR_PY = """\
def validate_command(device, command)  # missing colon
    return True
"""

_HOOKS_IMPORT_ERROR_PY = """\
import _this_module_definitely_does_not_exist_xyz_abc

def validate_command(device, command):
    return True

def execute_command(device, command):
    return {}

def probe_state(device):
    return {}
"""


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

class _FakeExtension:
    """Minimal duck-type of InstalledExtension for load_installed_extension_runtime."""

    def __init__(
        self,
        *,
        extension_id: str,
        version: str,
        archive_sha256: str,
        archive_path: str | Path,
        package_root: str | None,
        manifest: dict[str, Any],
    ) -> None:
        self.extension_id = extension_id
        self.version = version
        self.archive_sha256 = archive_sha256
        self.archive_path = str(archive_path)
        self.package_root = package_root
        self.manifest = manifest


def _persist_extension(
    *,
    extension_id: str = _TEST_EXTENSION_ID,
    version: str = _TEST_VERSION,
    entrypoint: str = "main.py",
    hooks_code: str = _MINIMAL_HOOKS_PY,
    hooks: dict[str, str] | None = None,
    package_root: str | None = None,
    extra_py_files: dict[str, str] | None = None,
) -> _FakeExtension:
    """
    Create a real ZIP archive on disk and return a _FakeExtension object that
    load_installed_extension_runtime() can consume.
    """
    manifest = _minimal_manifest(
        extension_id=extension_id,
        version=version,
        entrypoint=entrypoint,
        hooks=hooks,
    )

    files: dict[str, str] = {}
    prefix = f"{package_root}/" if package_root else ""
    files[f"{prefix}manifest.json"] = json.dumps(manifest)
    files[f"{prefix}{entrypoint}"] = hooks_code
    if extra_py_files:
        for name, code in extra_py_files.items():
            files[f"{prefix}{name}"] = code

    archive_bytes = _make_zip_bytes(files)
    archive_sha256 = hashlib.sha256(archive_bytes).hexdigest()

    safe_name = f"{extension_id}-{version}-{archive_sha256[:12]}.zip"
    archive_path = EXTENSION_PACKAGES_DIR / safe_name
    archive_path.write_bytes(archive_bytes)

    return _FakeExtension(
        extension_id=extension_id,
        version=version,
        archive_sha256=archive_sha256,
        archive_path=archive_path,
        package_root=package_root,
        manifest=manifest,
    )


def _cleanup_extension(ext: _FakeExtension) -> None:
    """Remove archive and extracted dir created by _persist_extension."""
    archive = Path(ext.archive_path)
    if archive.exists():
        archive.unlink(missing_ok=True)

    extract_dir = resolve_extracted_extension_dir(
        extension_id=ext.extension_id,
        version=ext.version,
        archive_sha256=ext.archive_sha256,
    )
    if extract_dir.exists():
        shutil.rmtree(extract_dir)


@pytest.fixture(autouse=True)
def clear_cache():
    """Always clear the runtime cache before and after each test."""
    clear_extension_runtime_cache()
    yield
    clear_extension_runtime_cache()


# ---------------------------------------------------------------------------
# Tests: _read_package_entrypoint
# ---------------------------------------------------------------------------

class TestReadPackageEntrypoint:
    def test_returns_entrypoint_string(self):
        manifest = _minimal_manifest(entrypoint="hooks.py")
        assert _read_package_entrypoint(manifest) == "hooks.py"

    def test_strips_whitespace(self):
        manifest = _minimal_manifest()
        manifest["package"]["entrypoint"] = "  main.py  "
        assert _read_package_entrypoint(manifest) == "main.py"

    def test_raises_when_package_missing(self):
        with pytest.raises(ExtensionRuntimeLoadError, match="missing 'package'"):
            _read_package_entrypoint({"no_package": True})

    def test_raises_when_entrypoint_missing(self):
        manifest = _minimal_manifest()
        del manifest["package"]["entrypoint"]
        with pytest.raises(ExtensionRuntimeLoadError, match="missing 'package.entrypoint'"):
            _read_package_entrypoint(manifest)

    def test_raises_when_entrypoint_empty_string(self):
        manifest = _minimal_manifest()
        manifest["package"]["entrypoint"] = "   "
        with pytest.raises(ExtensionRuntimeLoadError, match="missing 'package.entrypoint'"):
            _read_package_entrypoint(manifest)

    def test_raises_when_entrypoint_not_a_string(self):
        manifest = _minimal_manifest()
        manifest["package"]["entrypoint"] = 123
        with pytest.raises(ExtensionRuntimeLoadError, match="missing 'package.entrypoint'"):
            _read_package_entrypoint(manifest)


# ---------------------------------------------------------------------------
# Tests: _read_package_hooks
# ---------------------------------------------------------------------------

class TestReadPackageHooks:
    def test_returns_default_hook_names_when_no_hooks_declared(self):
        manifest = _minimal_manifest()
        del manifest["package"]["hooks"]
        hooks = _read_package_hooks(manifest)
        assert hooks == {k: k for k in DEFAULT_PACKAGE_HOOKS}

    def test_custom_hook_names_are_respected(self):
        custom = {k: f"my_{k}" for k in DEFAULT_PACKAGE_HOOKS}
        manifest = _minimal_manifest(hooks=custom)
        hooks = _read_package_hooks(manifest)
        for key in DEFAULT_PACKAGE_HOOKS:
            assert hooks[key] == f"my_{key}"

    def test_optional_hook_is_included_when_declared(self):
        base_hooks = {k: k for k in DEFAULT_PACKAGE_HOOKS}
        base_hooks["discover_devices"] = "discover_devices"
        manifest = _minimal_manifest(hooks=base_hooks)
        hooks = _read_package_hooks(manifest)
        assert "discover_devices" in hooks
        assert hooks["discover_devices"] == "discover_devices"

    def test_optional_hook_absent_when_not_declared(self):
        manifest = _minimal_manifest()
        hooks = _read_package_hooks(manifest)
        assert "discover_devices" not in hooks

    def test_raises_when_package_missing(self):
        with pytest.raises(ExtensionRuntimeLoadError, match="missing 'package'"):
            _read_package_hooks({"no_package": True})

    def test_raises_when_hook_name_is_empty(self):
        bad_hooks = {k: k for k in DEFAULT_PACKAGE_HOOKS}
        bad_hooks["validate_command"] = "   "
        manifest = _minimal_manifest(hooks=bad_hooks)
        with pytest.raises(ExtensionRuntimeLoadError, match="hook 'validate_command' is invalid"):
            _read_package_hooks(manifest)

    def test_raises_when_hooks_field_is_not_a_dict(self):
        manifest = _minimal_manifest()
        manifest["package"]["hooks"] = ["validate_command", "execute_command"]
        with pytest.raises(ExtensionRuntimeLoadError, match="must be an object"):
            _read_package_hooks(manifest)


# ---------------------------------------------------------------------------
# Tests: _load_module (internal, tested via helpers)
# ---------------------------------------------------------------------------

class TestLoadModule:
    def test_loads_valid_entrypoint(self, tmp_path):
        entrypoint = tmp_path / "main.py"
        entrypoint.write_text(_MINIMAL_HOOKS_PY, encoding="utf-8")
        manifest = _minimal_manifest()

        runtime = _load_module(
            cache_key="test:abc123",
            entrypoint_path=entrypoint,
            manifest=manifest,
        )

        assert isinstance(runtime, LoadedExtensionRuntime)
        assert runtime.cache_key == "test:abc123"
        assert runtime.entrypoint_path == entrypoint
        assert hasattr(runtime.module, "validate_command")
        assert hasattr(runtime.module, "execute_command")
        assert hasattr(runtime.module, "probe_state")

    def test_raises_when_entrypoint_does_not_exist(self, tmp_path):
        missing = tmp_path / "nonexistent.py"
        manifest = _minimal_manifest()
        with pytest.raises(ExtensionRuntimeLoadError, match="does not exist"):
            _load_module(
                cache_key="test:missing",
                entrypoint_path=missing,
                manifest=manifest,
            )

    def test_raises_when_required_hook_is_not_callable(self, tmp_path):
        code = """\
# validate_command is a string, not a callable
validate_command = "not a function"

def execute_command(device, command):
    return {}

def probe_state(device):
    return {}
"""
        entrypoint = tmp_path / "main.py"
        entrypoint.write_text(code, encoding="utf-8")
        manifest = _minimal_manifest()

        with pytest.raises(ExtensionRuntimeLoadError, match="missing callable"):
            _load_module(
                cache_key="test:bad_hook",
                entrypoint_path=entrypoint,
                manifest=manifest,
            )

    def test_raises_on_syntax_error_in_entrypoint(self, tmp_path):
        entrypoint = tmp_path / "main.py"
        entrypoint.write_text(_HOOKS_SYNTAX_ERROR_PY, encoding="utf-8")
        manifest = _minimal_manifest()

        with pytest.raises(ExtensionRuntimeLoadError, match="failed to load"):
            _load_module(
                cache_key="test:syntax_err",
                entrypoint_path=entrypoint,
                manifest=manifest,
            )

    def test_raises_on_import_error_in_entrypoint(self, tmp_path):
        entrypoint = tmp_path / "main.py"
        entrypoint.write_text(_HOOKS_IMPORT_ERROR_PY, encoding="utf-8")
        manifest = _minimal_manifest()

        with pytest.raises(ExtensionRuntimeLoadError, match="failed to load"):
            _load_module(
                cache_key="test:import_err",
                entrypoint_path=entrypoint,
                manifest=manifest,
            )

    def test_optional_hook_missing_callable_is_allowed(self, tmp_path):
        """An optional hook (discover_devices) may be absent from the module."""
        code = _MINIMAL_HOOKS_PY  # no discover_devices defined
        entrypoint = tmp_path / "main.py"
        entrypoint.write_text(code, encoding="utf-8")

        base_hooks = {k: k for k in DEFAULT_PACKAGE_HOOKS}
        base_hooks["discover_devices"] = "discover_devices"
        manifest = _minimal_manifest(hooks=base_hooks)

        # Should NOT raise even though discover_devices is not in the module.
        runtime = _load_module(
            cache_key="test:optional_missing",
            entrypoint_path=entrypoint,
            manifest=manifest,
        )
        assert isinstance(runtime, LoadedExtensionRuntime)

    def test_module_is_cached_on_second_call(self, tmp_path):
        entrypoint = tmp_path / "main.py"
        entrypoint.write_text(_MINIMAL_HOOKS_PY, encoding="utf-8")
        manifest = _minimal_manifest()

        runtime1 = _load_module(
            cache_key="test:cache_check",
            entrypoint_path=entrypoint,
            manifest=manifest,
        )
        runtime2 = _load_module(
            cache_key="test:cache_check",
            entrypoint_path=entrypoint,
            manifest=manifest,
        )
        # Same object returned from cache
        assert runtime1 is runtime2

    def test_cache_is_cleared_by_clear_extension_runtime_cache(self, tmp_path):
        entrypoint = tmp_path / "main.py"
        entrypoint.write_text(_MINIMAL_HOOKS_PY, encoding="utf-8")
        manifest = _minimal_manifest()

        runtime1 = _load_module(
            cache_key="test:clear_cache",
            entrypoint_path=entrypoint,
            manifest=manifest,
        )
        clear_extension_runtime_cache()
        runtime2 = _load_module(
            cache_key="test:clear_cache",
            entrypoint_path=entrypoint,
            manifest=manifest,
        )
        # After cache clear a new object should be created
        assert runtime1 is not runtime2

    def test_sys_path_is_restored_after_load(self, tmp_path):
        entrypoint = tmp_path / "main.py"
        entrypoint.write_text(_MINIMAL_HOOKS_PY, encoding="utf-8")
        manifest = _minimal_manifest()

        path_before = list(sys.path)
        _load_module(
            cache_key="test:path_restore",
            entrypoint_path=entrypoint,
            manifest=manifest,
        )
        assert sys.path == path_before

    def test_sys_path_is_restored_even_on_load_error(self, tmp_path):
        entrypoint = tmp_path / "main.py"
        entrypoint.write_text(_HOOKS_SYNTAX_ERROR_PY, encoding="utf-8")
        manifest = _minimal_manifest()

        path_before = list(sys.path)
        with pytest.raises(ExtensionRuntimeLoadError):
            _load_module(
                cache_key="test:path_restore_err",
                entrypoint_path=entrypoint,
                manifest=manifest,
            )
        assert sys.path == path_before


# ---------------------------------------------------------------------------
# Tests: resolve_runtime_hook
# ---------------------------------------------------------------------------

class TestResolveRuntimeHook:
    def _make_runtime(self, tmp_path, code=_MINIMAL_HOOKS_PY) -> LoadedExtensionRuntime:
        entrypoint = tmp_path / "main.py"
        entrypoint.write_text(code, encoding="utf-8")
        manifest = _minimal_manifest()
        return _load_module(
            cache_key="test:resolve_hook",
            entrypoint_path=entrypoint,
            manifest=manifest,
        )

    def test_resolves_existing_hook(self, tmp_path):
        runtime = self._make_runtime(tmp_path)
        hook = resolve_runtime_hook(runtime, "validate_command")
        assert callable(hook)

    def test_raises_for_undeclared_hook_key(self, tmp_path):
        runtime = self._make_runtime(tmp_path)
        with pytest.raises(ExtensionRuntimeLoadError, match="not declared"):
            resolve_runtime_hook(runtime, "nonexistent_hook")

    def test_raises_when_hook_name_resolves_to_non_callable(self, tmp_path):
        """Hook name declared in manifest but the attribute is not callable."""
        code = """\
validate_command = 42  # not callable

def execute_command(device, command):
    return {}

def probe_state(device):
    return {}
"""
        entrypoint = tmp_path / "main.py"
        entrypoint.write_text(code, encoding="utf-8")
        manifest = _minimal_manifest()
        # Load normally — will fail because validate_command is not callable.
        with pytest.raises(ExtensionRuntimeLoadError, match="missing callable"):
            _load_module(
                cache_key="test:bad_callable",
                entrypoint_path=entrypoint,
                manifest=manifest,
            )

        # After the failed load, test resolve_runtime_hook with a crafted runtime that
        # has a hook_name pointing to a non-callable attribute on the module.
        import types
        fake_module = types.ModuleType("fake_module_for_test")
        fake_module.validate_command = "still_not_callable"  # type: ignore[attr-defined]
        fake_runtime = LoadedExtensionRuntime(
            cache_key="test:fake",
            module=fake_module,
            entrypoint_path=entrypoint,
            hook_names={"validate_command": "validate_command"},
        )
        with pytest.raises(ExtensionRuntimeLoadError, match="non-callable"):
            resolve_runtime_hook(fake_runtime, "validate_command")

    def test_validates_execute_command_callable(self, tmp_path):
        runtime = self._make_runtime(tmp_path)
        hook = resolve_runtime_hook(runtime, "execute_command")
        assert callable(hook)

    def test_validates_probe_state_callable(self, tmp_path):
        runtime = self._make_runtime(tmp_path)
        hook = resolve_runtime_hook(runtime, "probe_state")
        assert callable(hook)


# ---------------------------------------------------------------------------
# Tests: hook execution behaviour
# ---------------------------------------------------------------------------

class TestHookExecution:
    """Invoke hooks through the loaded module and verify results / error handling."""

    def _load_from_code(self, tmp_path, code: str) -> LoadedExtensionRuntime:
        entrypoint = tmp_path / "main.py"
        entrypoint.write_text(code, encoding="utf-8")
        manifest = _minimal_manifest()
        return _load_module(
            cache_key=f"test:exec:{id(tmp_path)}",
            entrypoint_path=entrypoint,
            manifest=manifest,
        )

    # -- validate_command --

    def test_validate_command_returns_true(self, tmp_path):
        runtime = self._load_from_code(tmp_path, _MINIMAL_HOOKS_PY)
        hook = resolve_runtime_hook(runtime, "validate_command")
        result = hook({"config": {}}, {"kind": "action"})
        assert result is True

    def test_validate_command_returns_false(self, tmp_path):
        runtime = self._load_from_code(tmp_path, _HOOKS_VALIDATE_FALSE_PY)
        hook = resolve_runtime_hook(runtime, "validate_command")
        result = hook({"config": {}}, {"kind": "action"})
        assert result is False

    def test_validate_command_exception_propagates(self, tmp_path):
        """A hook that raises should propagate the error to the caller."""
        runtime = self._load_from_code(tmp_path, _HOOKS_VALIDATE_RAISES_PY)
        hook = resolve_runtime_hook(runtime, "validate_command")
        with pytest.raises(RuntimeError, match="validate failed intentionally"):
            hook({"config": {}}, {"kind": "action"})

    # -- execute_command --

    def test_execute_command_returns_result(self, tmp_path):
        runtime = self._load_from_code(tmp_path, _MINIMAL_HOOKS_PY)
        hook = resolve_runtime_hook(runtime, "execute_command")
        result = hook({"config": {}}, {"kind": "action"})
        assert result == {"status": "ok"}

    def test_execute_command_returns_dict_with_expected_key(self, tmp_path):
        runtime = self._load_from_code(tmp_path, _HOOKS_PROBE_RETURNS_STATE_PY)
        hook = resolve_runtime_hook(runtime, "execute_command")
        result = hook({"config": {}}, {"kind": "action"})
        assert "brightness" in result

    def test_execute_command_exception_propagates(self, tmp_path):
        runtime = self._load_from_code(tmp_path, _HOOKS_VALIDATE_RAISES_PY)
        hook = resolve_runtime_hook(runtime, "execute_command")
        with pytest.raises(RuntimeError, match="execute failed intentionally"):
            hook({"config": {}}, {"kind": "action"})

    # -- probe_state --

    def test_probe_state_returns_dict(self, tmp_path):
        runtime = self._load_from_code(tmp_path, _MINIMAL_HOOKS_PY)
        hook = resolve_runtime_hook(runtime, "probe_state")
        result = hook({"config": {}})
        assert isinstance(result, dict)
        assert result["power"] == "on"

    def test_probe_state_returns_expected_keys(self, tmp_path):
        runtime = self._load_from_code(tmp_path, _HOOKS_PROBE_RETURNS_STATE_PY)
        hook = resolve_runtime_hook(runtime, "probe_state")
        result = hook({"config": {}})
        assert result == {"power": "off", "brightness": 0}

    def test_probe_state_exception_propagates(self, tmp_path):
        runtime = self._load_from_code(tmp_path, _HOOKS_VALIDATE_RAISES_PY)
        hook = resolve_runtime_hook(runtime, "probe_state")
        with pytest.raises(RuntimeError, match="probe failed intentionally"):
            hook({"config": {}})

    # -- discover_devices (optional hook) --

    def test_optional_discover_devices_hook_is_callable(self, tmp_path):
        entrypoint = tmp_path / "main.py"
        entrypoint.write_text(_HOOKS_WITH_DISCOVER_PY, encoding="utf-8")
        base_hooks = {k: k for k in DEFAULT_PACKAGE_HOOKS}
        base_hooks["discover_devices"] = "discover_devices"
        manifest = _minimal_manifest(hooks=base_hooks)
        runtime = _load_module(
            cache_key="test:discover",
            entrypoint_path=entrypoint,
            manifest=manifest,
        )
        hook = resolve_runtime_hook(runtime, "discover_devices")
        result = hook({})
        assert result == [{"host": "192.168.1.1"}]


# ---------------------------------------------------------------------------
# Tests: load_installed_extension_runtime (end-to-end with real disk I/O)
# ---------------------------------------------------------------------------

class TestLoadInstalledExtensionRuntime:
    def test_loads_valid_extension_from_archive(self):
        ext = _persist_extension()
        try:
            runtime = load_installed_extension_runtime(ext)
            assert isinstance(runtime, LoadedExtensionRuntime)
            assert runtime.cache_key == f"{ext.extension_id}:{ext.archive_sha256}"
        finally:
            _cleanup_extension(ext)

    def test_loads_extension_with_package_root(self):
        ext = _persist_extension(package_root="MyPackage")
        try:
            runtime = load_installed_extension_runtime(ext)
            assert isinstance(runtime, LoadedExtensionRuntime)
            assert "MyPackage" in str(runtime.entrypoint_path)
        finally:
            _cleanup_extension(ext)

    def test_raises_when_extension_id_is_missing(self):
        ext = _persist_extension()
        ext.extension_id = ""
        try:
            with pytest.raises(ExtensionRuntimeLoadError, match="missing extension_id"):
                load_installed_extension_runtime(ext)
        finally:
            _cleanup_extension(ext)

    def test_raises_when_version_is_missing(self):
        ext = _persist_extension()
        ext.version = ""
        try:
            with pytest.raises(ExtensionRuntimeLoadError, match="missing extension_id"):
                load_installed_extension_runtime(ext)
        finally:
            _cleanup_extension(ext)

    def test_raises_when_archive_sha256_is_missing(self):
        ext = _persist_extension()
        ext.archive_sha256 = ""
        try:
            with pytest.raises(ExtensionRuntimeLoadError, match="missing extension_id"):
                load_installed_extension_runtime(ext)
        finally:
            _cleanup_extension(ext)

    def test_raises_when_manifest_is_empty_dict(self):
        ext = _persist_extension()
        ext.manifest = {}
        try:
            with pytest.raises(ExtensionRuntimeLoadError, match="missing a normalized manifest"):
                load_installed_extension_runtime(ext)
        finally:
            _cleanup_extension(ext)

    def test_raises_when_manifest_is_not_a_dict(self):
        ext = _persist_extension()
        ext.manifest = None  # type: ignore[assignment]
        try:
            with pytest.raises(ExtensionRuntimeLoadError, match="missing a normalized manifest"):
                load_installed_extension_runtime(ext)
        finally:
            _cleanup_extension(ext)

    def test_raises_when_archive_missing_and_no_extracted_dir(self):
        ext = _persist_extension()
        archive = Path(ext.archive_path)
        try:
            # Remove archive before loading so the loader cannot extract
            archive.unlink(missing_ok=True)
            # Also ensure no pre-extracted dir exists
            extract_dir = resolve_extracted_extension_dir(
                extension_id=ext.extension_id,
                version=ext.version,
                archive_sha256=ext.archive_sha256,
            )
            if extract_dir.exists():
                shutil.rmtree(extract_dir)

            with pytest.raises(ExtensionRuntimeLoadError, match="missing"):
                load_installed_extension_runtime(ext)
        finally:
            _cleanup_extension(ext)

    def test_uses_existing_extracted_dir_when_archive_missing(self):
        """If the archive ZIP is gone but the extracted dir exists, load should succeed."""
        ext = _persist_extension()
        archive = Path(ext.archive_path)
        try:
            # First load: extracts the archive
            runtime1 = load_installed_extension_runtime(ext)
            assert isinstance(runtime1, LoadedExtensionRuntime)

            # Remove the archive and clear cache
            archive.unlink(missing_ok=True)
            clear_extension_runtime_cache()

            # Second load: should succeed using already-extracted dir
            runtime2 = load_installed_extension_runtime(ext)
            assert isinstance(runtime2, LoadedExtensionRuntime)
            assert runtime2.entrypoint_path == runtime1.entrypoint_path
        finally:
            _cleanup_extension(ext)

    def test_second_load_returns_cached_runtime(self):
        ext = _persist_extension(extension_id="unit-cache-ext")
        try:
            runtime1 = load_installed_extension_runtime(ext)
            runtime2 = load_installed_extension_runtime(ext)
            assert runtime1 is runtime2
        finally:
            _cleanup_extension(ext)

    def test_hook_names_are_exposed_on_runtime(self):
        ext = _persist_extension()
        try:
            runtime = load_installed_extension_runtime(ext)
            for hook_key in DEFAULT_PACKAGE_HOOKS:
                assert hook_key in runtime.hook_names
        finally:
            _cleanup_extension(ext)

    def test_module_hooks_are_actually_callable(self):
        ext = _persist_extension(hooks_code=_MINIMAL_HOOKS_PY)
        try:
            runtime = load_installed_extension_runtime(ext)
            for hook_key in DEFAULT_PACKAGE_HOOKS:
                hook = resolve_runtime_hook(runtime, hook_key)
                assert callable(hook)
        finally:
            _cleanup_extension(ext)


# ---------------------------------------------------------------------------
# Tests: validate_extension_package_runtime
# ---------------------------------------------------------------------------

class TestValidateExtensionPackageRuntime:
    def test_returns_entrypoint_path_for_valid_package(self):
        ext = _persist_extension()
        try:
            path = validate_extension_package_runtime(
                extension_id=ext.extension_id,
                version=ext.version,
                archive_sha256=ext.archive_sha256,
                archive_path=ext.archive_path,
                package_root=ext.package_root,
                manifest=ext.manifest,
            )
            assert isinstance(path, Path)
            assert path.name == "main.py"
            assert path.exists()
        finally:
            _cleanup_extension(ext)

    def test_cleans_up_extracted_dir_on_load_failure(self):
        """If load fails (e.g. bad hooks), extracted dir should be removed."""
        ext = _persist_extension(hooks_code=_HOOKS_SYNTAX_ERROR_PY)
        extract_dir = resolve_extracted_extension_dir(
            extension_id=ext.extension_id,
            version=ext.version,
            archive_sha256=ext.archive_sha256,
        )
        try:
            with pytest.raises(ExtensionRuntimeLoadError):
                validate_extension_package_runtime(
                    extension_id=ext.extension_id,
                    version=ext.version,
                    archive_sha256=ext.archive_sha256,
                    archive_path=ext.archive_path,
                    package_root=ext.package_root,
                    manifest=ext.manifest,
                )
            # The extracted dir must have been removed by the validator
            assert not extract_dir.exists()
        finally:
            _cleanup_extension(ext)


# ---------------------------------------------------------------------------
# Tests: sandbox / isolation
# ---------------------------------------------------------------------------

class TestSandboxIsolation:
    """Verify that exceptions in extension code do not leak loader state."""

    def test_exception_in_hook_does_not_corrupt_loader_cache(self, tmp_path):
        """A hook that raises should not affect the cached runtime for that extension."""
        entrypoint = tmp_path / "main.py"
        entrypoint.write_text(_HOOKS_VALIDATE_RAISES_PY, encoding="utf-8")
        manifest = _minimal_manifest()

        runtime = _load_module(
            cache_key="test:isolation",
            entrypoint_path=entrypoint,
            manifest=manifest,
        )
        hook = resolve_runtime_hook(runtime, "validate_command")

        # Invoke the hook (it raises) — loader state should remain intact
        with pytest.raises(RuntimeError):
            hook({}, {})

        # Runtime is still usable
        hook2 = resolve_runtime_hook(runtime, "execute_command")
        assert callable(hook2)

    def test_failed_module_load_does_not_leave_stale_entry_in_sys_modules(self, tmp_path):
        entrypoint = tmp_path / "main.py"
        entrypoint.write_text(_HOOKS_SYNTAX_ERROR_PY, encoding="utf-8")
        manifest = _minimal_manifest()

        modules_before = set(sys.modules.keys())
        with pytest.raises(ExtensionRuntimeLoadError):
            _load_module(
                cache_key="test:stale_modules",
                entrypoint_path=entrypoint,
                manifest=manifest,
            )

        # No new permanent module should have been registered
        new_modules = set(sys.modules.keys()) - modules_before
        leaked = [m for m in new_modules if "uploaded_extension" in m]
        assert not leaked, f"Stale module entries found: {leaked}"

    def test_extension_module_is_isolated_per_cache_key(self, tmp_path):
        """Two extensions with different cache keys get independent module objects."""
        code_a = _MINIMAL_HOOKS_PY
        code_b = _HOOKS_PROBE_RETURNS_STATE_PY

        entry_a = tmp_path / "ext_a.py"
        entry_b = tmp_path / "ext_b.py"
        entry_a.write_text(code_a, encoding="utf-8")
        entry_b.write_text(code_b, encoding="utf-8")

        manifest = _minimal_manifest()

        runtime_a = _load_module(
            cache_key="test:iso_a",
            entrypoint_path=entry_a,
            manifest=manifest,
        )
        runtime_b = _load_module(
            cache_key="test:iso_b",
            entrypoint_path=entry_b,
            manifest=manifest,
        )

        assert runtime_a.module is not runtime_b.module

        hook_a = resolve_runtime_hook(runtime_a, "probe_state")
        hook_b = resolve_runtime_hook(runtime_b, "probe_state")

        result_a = hook_a({})
        result_b = hook_b({})

        # ext_a's probe_state returns {"power": "on"}, ext_b returns {"power": "off", ...}
        assert result_a["power"] == "on"
        assert result_b["power"] == "off"
