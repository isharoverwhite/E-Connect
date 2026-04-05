# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from __future__ import annotations

import importlib.util
import re
import sys
import traceback
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from types import ModuleType
from typing import Any, Callable

from app.services.extensions import (
    DEFAULT_PACKAGE_HOOKS,
    extract_extension_archive,
    remove_extracted_extension_dir,
    resolve_extracted_extension_dir,
    resolve_extension_entrypoint_path,
)


class ExtensionRuntimeLoadError(RuntimeError):
    pass


@dataclass(frozen=True)
class LoadedExtensionRuntime:
    cache_key: str
    module: ModuleType
    entrypoint_path: Path
    hook_names: dict[str, str]


_RUNTIME_CACHE: dict[str, LoadedExtensionRuntime] = {}
_RUNTIME_CACHE_LOCK = RLock()
_IMPORT_NAME_SANITIZER = re.compile(r"[^A-Za-z0-9_]+")


def clear_extension_runtime_cache() -> None:
    with _RUNTIME_CACHE_LOCK:
        _RUNTIME_CACHE.clear()


def validate_extension_package_runtime(
    *,
    extension_id: str,
    version: str,
    archive_sha256: str,
    archive_path: str | Path,
    package_root: str | None,
    manifest: dict[str, Any],
) -> Path:
    try:
        _, entrypoint_path = _load_runtime_from_package(
            extension_id=extension_id,
            version=version,
            archive_sha256=archive_sha256,
            archive_path=archive_path,
            package_root=package_root,
            manifest=manifest,
        )
    except ExtensionRuntimeLoadError:
        remove_extracted_extension_dir(
            extension_id=extension_id,
            version=version,
            archive_sha256=archive_sha256,
        )
        raise

    return entrypoint_path


def load_installed_extension_runtime(extension: Any) -> LoadedExtensionRuntime:
    manifest = extension.manifest if isinstance(getattr(extension, "manifest", None), dict) else {}
    extension_id = str(getattr(extension, "extension_id", "") or "").strip()
    version = str(getattr(extension, "version", "") or "").strip()
    archive_sha256 = str(getattr(extension, "archive_sha256", "") or "").strip()
    archive_path = getattr(extension, "archive_path", None)
    package_root = getattr(extension, "package_root", None)

    runtime, _ = _load_runtime_from_package(
        extension_id=extension_id,
        version=version,
        archive_sha256=archive_sha256,
        archive_path=archive_path,
        package_root=package_root,
        manifest=manifest,
    )
    return runtime


def resolve_runtime_hook(runtime: LoadedExtensionRuntime, hook_key: str) -> Callable[..., Any]:
    hook_name = runtime.hook_names.get(hook_key)
    if not hook_name:
        raise ExtensionRuntimeLoadError(f"Extension runtime hook '{hook_key}' is not declared.")

    hook = getattr(runtime.module, hook_name, None)
    if not callable(hook):
        raise ExtensionRuntimeLoadError(
            f"Extension runtime hook '{hook_key}' resolved to non-callable '{hook_name}'."
        )
    return hook


def _load_runtime_from_package(
    *,
    extension_id: str,
    version: str,
    archive_sha256: str,
    archive_path: str | Path | None,
    package_root: str | None,
    manifest: dict[str, Any],
) -> tuple[LoadedExtensionRuntime, Path]:
    if not extension_id or not version or not archive_sha256:
        raise ExtensionRuntimeLoadError("Installed extension metadata is missing extension_id, version, or archive_sha256.")
    if not isinstance(manifest, dict) or not manifest:
        raise ExtensionRuntimeLoadError("Installed extension metadata is missing a normalized manifest.")

    entrypoint = _read_package_entrypoint(manifest)
    extracted_root = resolve_extracted_extension_dir(
        extension_id=extension_id,
        version=version,
        archive_sha256=archive_sha256,
    )
    package_dir = extracted_root / package_root if isinstance(package_root, str) and package_root else extracted_root
    entrypoint_path = resolve_extension_entrypoint_path(
        package_root_dir=package_dir,
        entrypoint=entrypoint,
    )
    if not entrypoint_path.exists():
        source_archive_path = Path(archive_path) if isinstance(archive_path, (str, Path)) and str(archive_path).strip() else None
        if source_archive_path is None or not source_archive_path.exists():
            message = "Installed extension extracted runtime package is missing."
            if source_archive_path is not None:
                message = f"{message} Uploaded archive was not found at {source_archive_path}."
            raise ExtensionRuntimeLoadError(message)
        extracted_root = extract_extension_archive(
            archive_path=source_archive_path,
            extension_id=extension_id,
            version=version,
            archive_sha256=archive_sha256,
        )
        package_dir = extracted_root / package_root if isinstance(package_root, str) and package_root else extracted_root
        entrypoint_path = resolve_extension_entrypoint_path(
            package_root_dir=package_dir,
            entrypoint=entrypoint,
        )
    cache_key = f"{extension_id}:{archive_sha256}"
    return _load_module(cache_key=cache_key, entrypoint_path=entrypoint_path, manifest=manifest), entrypoint_path


def _load_module(*, cache_key: str, entrypoint_path: Path, manifest: dict[str, Any]) -> LoadedExtensionRuntime:
    with _RUNTIME_CACHE_LOCK:
        cached_runtime = _RUNTIME_CACHE.get(cache_key)
        if cached_runtime is not None and cached_runtime.entrypoint_path == entrypoint_path and entrypoint_path.exists():
            return cached_runtime

        if not entrypoint_path.exists():
            raise ExtensionRuntimeLoadError(f"Extension runtime entrypoint does not exist: {entrypoint_path}")

        package_dir = entrypoint_path.parent
        local_module_names = [child.stem for child in package_dir.glob("*.py")]
        for module_name in local_module_names:
            sys.modules.pop(module_name, None)

        import_name = f"uploaded_extension_{_IMPORT_NAME_SANITIZER.sub('_', cache_key)}"
        sys.modules.pop(import_name, None)

        previous_sys_path = list(sys.path)
        try:
            sys.path.insert(0, str(package_dir))
            spec = importlib.util.spec_from_file_location(import_name, entrypoint_path)
            if spec is None or spec.loader is None:
                raise ExtensionRuntimeLoadError(f"Could not create import spec for extension entrypoint '{entrypoint_path.name}'.")
            module = importlib.util.module_from_spec(spec)
            sys.modules[import_name] = module
            spec.loader.exec_module(module)
        except ExtensionRuntimeLoadError:
            sys.modules.pop(import_name, None)
            raise
        except Exception as exc:
            sys.modules.pop(import_name, None)
            traceback_details = "".join(traceback.format_exception_only(type(exc), exc)).strip()
            raise ExtensionRuntimeLoadError(f"Extension runtime entrypoint failed to load: {traceback_details}") from exc
        finally:
            sys.path[:] = previous_sys_path

        hook_names = _read_package_hooks(manifest)
        for hook_key, hook_name in hook_names.items():
            hook = getattr(module, hook_name, None)
            if not callable(hook):
                raise ExtensionRuntimeLoadError(
                    f"Manifest hook '{hook_key}' points to missing callable '{hook_name}' in '{entrypoint_path.name}'."
                )

        loaded_runtime = LoadedExtensionRuntime(
            cache_key=cache_key,
            module=module,
            entrypoint_path=entrypoint_path,
            hook_names=hook_names,
        )
        _RUNTIME_CACHE[cache_key] = loaded_runtime
        return loaded_runtime


def _read_package_entrypoint(manifest: dict[str, Any]) -> str:
    package = manifest.get("package")
    if not isinstance(package, dict):
        raise ExtensionRuntimeLoadError("Installed extension manifest is missing 'package'.")

    entrypoint = package.get("entrypoint")
    if not isinstance(entrypoint, str) or not entrypoint.strip():
        raise ExtensionRuntimeLoadError("Installed extension manifest is missing 'package.entrypoint'.")
    return entrypoint.strip()


def _read_package_hooks(manifest: dict[str, Any]) -> dict[str, str]:
    package = manifest.get("package")
    if not isinstance(package, dict):
        raise ExtensionRuntimeLoadError("Installed extension manifest is missing 'package'.")

    raw_hooks = package.get("hooks") or DEFAULT_PACKAGE_HOOKS
    if not isinstance(raw_hooks, dict):
        raise ExtensionRuntimeLoadError("Installed extension manifest field 'package.hooks' must be an object.")

    hooks: dict[str, str] = {}
    for hook_key, default_name in DEFAULT_PACKAGE_HOOKS.items():
        hook_name = raw_hooks.get(hook_key, default_name)
        if not isinstance(hook_name, str) or not hook_name.strip():
            raise ExtensionRuntimeLoadError(f"Installed extension manifest hook '{hook_key}' is invalid.")
        hooks[hook_key] = hook_name.strip()
    return hooks
