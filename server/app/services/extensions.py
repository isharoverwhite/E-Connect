# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from __future__ import annotations

import hashlib
import io
import json
import re
import shutil
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any


EXTENSIONS_DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "extensions"
EXTENSION_PACKAGES_DIR = EXTENSIONS_DATA_DIR / "packages"
EXTENSION_EXTRACTED_DIR = EXTENSIONS_DATA_DIR / "extracted"
MAX_EXTENSION_ARCHIVE_BYTES = 5 * 1024 * 1024
SUPPORTED_CARD_TYPES = {"light", "switch", "fan", "sensor"}
SUPPORTED_CONFIG_FIELD_TYPES = {"string", "number", "boolean"}
SUPPORTED_CAPABILITIES_BY_CARD_TYPE = {
    "light": {"power", "brightness", "rgb", "color_temperature"},
    "switch": {"power"},
    "fan": {"power", "speed"},
    "sensor": {"temperature", "humidity", "value"},
}
DEFAULT_CAPABILITIES_BY_CARD_TYPE = {
    "light": ("power", "brightness"),
    "switch": ("power",),
    "fan": ("power",),
    "sensor": ("value",),
}
IDENTIFIER_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{1,119}$")
PYTHON_SYMBOL_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
DEFAULT_PACKAGE_HOOKS = {
    "validate_command": "validate_command",
    "execute_command": "execute_command",
    "probe_state": "probe_state",
}

for path in (EXTENSIONS_DATA_DIR, EXTENSION_PACKAGES_DIR, EXTENSION_EXTRACTED_DIR):
    path.mkdir(parents=True, exist_ok=True)


class ExtensionManifestValidationError(ValueError):
    pass


def _read_nonempty_string(payload: dict[str, Any], key: str) -> str:
    raw_value = payload.get(key)
    if not isinstance(raw_value, str) or not raw_value.strip():
        raise ExtensionManifestValidationError(f"Manifest field '{key}' is required.")
    return raw_value.strip()


def _validate_identifier(value: str, *, field_name: str) -> str:
    normalized = value.strip().lower()
    if not IDENTIFIER_PATTERN.fullmatch(normalized):
        raise ExtensionManifestValidationError(
            f"Manifest field '{field_name}' must match lowercase slug format [a-z0-9_-]."
        )
    return normalized


def _validate_python_symbol(value: str, *, field_name: str) -> str:
    normalized = value.strip()
    if not PYTHON_SYMBOL_PATTERN.fullmatch(normalized):
        raise ExtensionManifestValidationError(
            f"Manifest field '{field_name}' must be a valid Python symbol name."
        )
    return normalized


def _validate_package_entrypoint(value: str) -> str:
    normalized = value.strip()
    path = PurePosixPath(normalized)
    if path.is_absolute() or ".." in path.parts or normalized.endswith("/"):
        raise ExtensionManifestValidationError("Manifest field 'package.entrypoint' must be a safe relative file path.")
    return normalized


def _normalize_config_field(field_payload: Any, *, schema_id: str, seen_keys: set[str]) -> dict[str, Any]:
    if not isinstance(field_payload, dict):
        raise ExtensionManifestValidationError(
            f"Config field entries for schema '{schema_id}' must be objects."
        )

    field_key = _validate_identifier(_read_nonempty_string(field_payload, "key"), field_name="config_schema.fields.key")
    if field_key in seen_keys:
        raise ExtensionManifestValidationError(
            f"Config field key '{field_key}' is duplicated in schema '{schema_id}'."
        )
    seen_keys.add(field_key)

    field_type = _read_nonempty_string(field_payload, "type").lower()
    if field_type not in SUPPORTED_CONFIG_FIELD_TYPES:
        raise ExtensionManifestValidationError(
            f"Config field '{field_key}' in schema '{schema_id}' uses unsupported type '{field_type}'."
        )

    field_label = _read_nonempty_string(field_payload, "label")
    required = bool(field_payload.get("required", False))
    return {
        "key": field_key,
        "label": field_label,
        "type": field_type,
        "required": required,
    }


def _normalize_device_schema(schema_payload: Any, *, seen_schema_ids: set[str]) -> dict[str, Any]:
    if not isinstance(schema_payload, dict):
        raise ExtensionManifestValidationError("Each device schema must be an object.")

    schema_id = _validate_identifier(_read_nonempty_string(schema_payload, "schema_id"), field_name="device_schemas.schema_id")
    if schema_id in seen_schema_ids:
        raise ExtensionManifestValidationError(f"Device schema id '{schema_id}' is duplicated.")
    seen_schema_ids.add(schema_id)

    name = _read_nonempty_string(schema_payload, "name")
    default_name = schema_payload.get("default_name")
    if not isinstance(default_name, str) or not default_name.strip():
        default_name = name
    else:
        default_name = default_name.strip()

    description = schema_payload.get("description")
    normalized_description = description.strip() if isinstance(description, str) and description.strip() else None

    display_payload = schema_payload.get("display")
    if not isinstance(display_payload, dict):
        raise ExtensionManifestValidationError(f"Schema '{schema_id}' is missing 'display'.")

    card_type = _read_nonempty_string(display_payload, "card_type").lower()
    if card_type not in SUPPORTED_CARD_TYPES:
        raise ExtensionManifestValidationError(
            f"Schema '{schema_id}' uses unsupported card type '{card_type}'."
        )

    raw_device_type = schema_payload.get("device_type")
    if raw_device_type is None:
        device_type = card_type
    else:
        device_type = _validate_identifier(
            _read_nonempty_string(schema_payload, "device_type"),
            field_name="device_schemas.device_type",
        )

    raw_capabilities = display_payload.get("capabilities")
    if raw_capabilities is None:
        raw_capabilities = list(DEFAULT_CAPABILITIES_BY_CARD_TYPE[card_type])
    if not isinstance(raw_capabilities, list) or len(raw_capabilities) == 0:
        raise ExtensionManifestValidationError(
            f"Schema '{schema_id}' display.capabilities must be a non-empty list."
        )

    allowed_capabilities = SUPPORTED_CAPABILITIES_BY_CARD_TYPE[card_type]
    capabilities: list[str] = []
    seen_capabilities: set[str] = set()
    for raw_capability in raw_capabilities:
        if not isinstance(raw_capability, str) or not raw_capability.strip():
            raise ExtensionManifestValidationError(
                f"Schema '{schema_id}' has an invalid display capability entry."
            )
        capability = raw_capability.strip().lower()
        if capability not in allowed_capabilities:
            raise ExtensionManifestValidationError(
                f"Schema '{schema_id}' uses unsupported capability '{capability}' for card type '{card_type}'."
            )
        if capability in seen_capabilities:
            continue
        seen_capabilities.add(capability)
        capabilities.append(capability)

    temperature_range: dict[str, int] | None = None
    raw_temperature_range = display_payload.get("temperature_range")
    if raw_temperature_range is not None:
        if card_type != "light":
            raise ExtensionManifestValidationError(
                f"Schema '{schema_id}' only allows display.temperature_range for light card types."
            )
        if not isinstance(raw_temperature_range, dict):
            raise ExtensionManifestValidationError(
                f"Schema '{schema_id}' display.temperature_range must be an object."
            )
        min_kelvin = raw_temperature_range.get("min")
        max_kelvin = raw_temperature_range.get("max")
        if not isinstance(min_kelvin, int) or not isinstance(max_kelvin, int):
            raise ExtensionManifestValidationError(
                f"Schema '{schema_id}' temperature range must use integer min/max values."
            )
        if min_kelvin >= max_kelvin:
            raise ExtensionManifestValidationError(
                f"Schema '{schema_id}' temperature range min must be lower than max."
            )
        temperature_range = {"min": min_kelvin, "max": max_kelvin}

    if temperature_range is not None and "color_temperature" not in capabilities:
        raise ExtensionManifestValidationError(
            f"Schema '{schema_id}' declares display.temperature_range without the 'color_temperature' capability."
        )

    if card_type == "light" and "color_temperature" in capabilities and temperature_range is None:
        temperature_range = {"min": 1700, "max": 6500}

    config_schema_payload = schema_payload.get("config_schema") or {}
    if not isinstance(config_schema_payload, dict):
        raise ExtensionManifestValidationError(
            f"Schema '{schema_id}' has invalid 'config_schema'."
        )

    raw_fields = config_schema_payload.get("fields") or []
    if not isinstance(raw_fields, list):
        raise ExtensionManifestValidationError(
            f"Schema '{schema_id}' config_schema.fields must be a list."
        )

    seen_field_keys: set[str] = set()
    fields = [
        _normalize_config_field(field_payload, schema_id=schema_id, seen_keys=seen_field_keys)
        for field_payload in raw_fields
    ]

    return {
        "schema_id": schema_id,
        "device_type": device_type,
        "name": name,
        "default_name": default_name,
        "description": normalized_description,
        "display": {
            "card_type": card_type,
            "capabilities": capabilities,
            "temperature_range": temperature_range,
        },
        "config_schema": {"fields": fields},
    }


def normalize_manifest_v1(manifest_payload: Any) -> dict[str, Any]:
    if not isinstance(manifest_payload, dict):
        raise ExtensionManifestValidationError("Manifest payload must be a JSON object.")

    manifest_version = _read_nonempty_string(manifest_payload, "manifest_version")
    if manifest_version != "1.0":
        raise ExtensionManifestValidationError(
            f"Unsupported manifest_version '{manifest_version}'. Expected '1.0'."
        )

    extension_id = _validate_identifier(_read_nonempty_string(manifest_payload, "extension_id"), field_name="extension_id")
    name = _read_nonempty_string(manifest_payload, "name")
    version = _read_nonempty_string(manifest_payload, "version")
    description = _read_nonempty_string(manifest_payload, "description")

    author = manifest_payload.get("author")
    normalized_author = author.strip() if isinstance(author, str) and author.strip() else None

    provider_payload = manifest_payload.get("provider")
    if not isinstance(provider_payload, dict):
        raise ExtensionManifestValidationError("Manifest field 'provider' is required.")

    provider_key = _validate_identifier(_read_nonempty_string(provider_payload, "key"), field_name="provider.key")
    provider_display_name = _read_nonempty_string(provider_payload, "display_name")

    package_payload = manifest_payload.get("package")
    if not isinstance(package_payload, dict):
        raise ExtensionManifestValidationError("Manifest field 'package' is required.")

    package_runtime = _read_nonempty_string(package_payload, "runtime").lower()
    if package_runtime != "python":
        raise ExtensionManifestValidationError(
            f"Unsupported package runtime '{package_runtime}'. Expected 'python'."
        )
    package_entrypoint = _validate_package_entrypoint(_read_nonempty_string(package_payload, "entrypoint"))
    raw_hooks = package_payload.get("hooks") or DEFAULT_PACKAGE_HOOKS
    if not isinstance(raw_hooks, dict):
        raise ExtensionManifestValidationError("Manifest field 'package.hooks' must be an object.")
    package_hooks = {
        hook_key: _validate_python_symbol(
            _read_nonempty_string(raw_hooks, hook_key),
            field_name=f"package.hooks.{hook_key}",
        )
        for hook_key in DEFAULT_PACKAGE_HOOKS
    }

    raw_device_schemas = manifest_payload.get("device_schemas")
    if not isinstance(raw_device_schemas, list) or len(raw_device_schemas) == 0:
        raise ExtensionManifestValidationError("Manifest must declare at least one device schema.")

    seen_schema_ids: set[str] = set()
    device_schemas = [
        _normalize_device_schema(schema_payload, seen_schema_ids=seen_schema_ids)
        for schema_payload in raw_device_schemas
    ]

    return {
        "manifest_version": manifest_version,
        "extension_id": extension_id,
        "name": name,
        "version": version,
        "author": normalized_author,
        "description": description,
        "provider": {
            "key": provider_key,
            "display_name": provider_display_name,
        },
        "package": {
            "runtime": package_runtime,
            "entrypoint": package_entrypoint,
            "hooks": package_hooks,
        },
        "device_schemas": device_schemas,
    }


def _locate_manifest_member(zip_file: zipfile.ZipFile) -> tuple[str, str | None]:
    candidates: list[str] = []
    for info in zip_file.infolist():
        if info.is_dir():
            continue

        path = PurePosixPath(info.filename)
        if path.name != "manifest.json":
            continue

        if len(path.parts) == 1:
            candidates.append(info.filename)
        elif len(path.parts) == 2:
            candidates.append(info.filename)

    if len(candidates) != 1:
        raise ExtensionManifestValidationError(
            "Extension ZIP must contain exactly one manifest.json at the root or one folder below it."
        )

    manifest_member = candidates[0]
    manifest_path = PurePosixPath(manifest_member)
    package_root = None if len(manifest_path.parts) == 1 else manifest_path.parts[0]
    return manifest_member, package_root


def _zip_contains_member(zip_file: zipfile.ZipFile, member_name: str) -> bool:
    try:
        zip_file.getinfo(member_name)
        return True
    except KeyError:
        return False


def parse_extension_archive(archive_bytes: bytes) -> tuple[dict[str, Any], dict[str, Any]]:
    if not archive_bytes:
        raise ExtensionManifestValidationError("Extension ZIP upload is empty.")
    if len(archive_bytes) > MAX_EXTENSION_ARCHIVE_BYTES:
        raise ExtensionManifestValidationError("Extension ZIP exceeds the 5 MB upload limit.")

    try:
        zip_file = zipfile.ZipFile(io.BytesIO(archive_bytes))
    except zipfile.BadZipFile as exc:
        raise ExtensionManifestValidationError("Uploaded file is not a valid ZIP archive.") from exc

    with zip_file:
        manifest_member, package_root = _locate_manifest_member(zip_file)
        try:
            manifest_payload = json.loads(zip_file.read(manifest_member).decode("utf-8"))
        except UnicodeDecodeError as exc:
            raise ExtensionManifestValidationError("manifest.json must be UTF-8 encoded.") from exc
        except json.JSONDecodeError as exc:
            raise ExtensionManifestValidationError("manifest.json is not valid JSON.") from exc

        normalized_manifest = normalize_manifest_v1(manifest_payload)
        entrypoint = normalized_manifest["package"]["entrypoint"]
        entrypoint_member = entrypoint if package_root is None else f"{package_root}/{entrypoint}"
        if not _zip_contains_member(zip_file, entrypoint_member):
            raise ExtensionManifestValidationError(
                f"Manifest entrypoint '{entrypoint}' was not found inside the ZIP archive."
            )

    archive_sha256 = hashlib.sha256(archive_bytes).hexdigest()
    metadata = {
        "archive_sha256": archive_sha256,
        "package_root": package_root,
    }
    return normalized_manifest, metadata


def persist_extension_archive(*, archive_bytes: bytes, extension_id: str, version: str, archive_sha256: str) -> Path:
    safe_name = f"{extension_id}-{version}-{archive_sha256[:12]}.zip"
    archive_path = EXTENSION_PACKAGES_DIR / safe_name
    archive_path.write_bytes(archive_bytes)
    return archive_path


def resolve_extracted_extension_dir(*, extension_id: str, version: str, archive_sha256: str) -> Path:
    safe_name = f"{extension_id}-{version}-{archive_sha256[:12]}"
    return EXTENSION_EXTRACTED_DIR / safe_name


def resolve_extension_entrypoint_path(*, package_root_dir: Path, entrypoint: str) -> Path:
    entrypoint_path = package_root_dir / PurePosixPath(entrypoint)
    return entrypoint_path.resolve()


def remove_extracted_extension_dir(*, extension_id: str, version: str, archive_sha256: str) -> None:
    extract_dir = resolve_extracted_extension_dir(
        extension_id=extension_id,
        version=version,
        archive_sha256=archive_sha256,
    )
    if extract_dir.exists():
        shutil.rmtree(extract_dir)


def _validated_archive_member_path(filename: str) -> PurePosixPath:
    member_path = PurePosixPath(filename)
    if member_path.is_absolute() or ".." in member_path.parts:
        raise ExtensionManifestValidationError("Extension ZIP contains an unsafe archive path.")
    return member_path


def extract_extension_archive(*, archive_path: str | Path, extension_id: str, version: str, archive_sha256: str) -> Path:
    source_archive_path = Path(archive_path)
    extract_dir = resolve_extracted_extension_dir(
        extension_id=extension_id,
        version=version,
        archive_sha256=archive_sha256,
    )
    temp_dir = extract_dir.with_name(f"{extract_dir.name}.tmp")
    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True, exist_ok=True)

    try:
        with zipfile.ZipFile(source_archive_path) as archive:
            for member in archive.infolist():
                member_path = _validated_archive_member_path(member.filename)
                destination = temp_dir.joinpath(*member_path.parts)
                if member.is_dir():
                    destination.mkdir(parents=True, exist_ok=True)
                    continue
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member) as source_handle, destination.open("wb") as destination_handle:
                    shutil.copyfileobj(source_handle, destination_handle)

        if extract_dir.exists():
            shutil.rmtree(extract_dir)
        temp_dir.replace(extract_dir)
    except Exception:
        if temp_dir.exists():
            shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    return extract_dir
def get_manifest_device_schema(manifest: dict[str, Any], schema_id: str) -> dict[str, Any]:
    for schema in manifest.get("device_schemas", []):
        if isinstance(schema, dict) and schema.get("schema_id") == schema_id:
            return schema
    raise ExtensionManifestValidationError(f"Device schema '{schema_id}' was not found in the installed manifest.")


def validate_external_device_config(schema: dict[str, Any], config_payload: Any) -> dict[str, Any]:
    if config_payload is None:
        config_payload = {}
    if not isinstance(config_payload, dict):
        raise ExtensionManifestValidationError("External device config must be a JSON object.")

    fields = schema.get("config_schema", {}).get("fields", [])
    normalized: dict[str, Any] = {}
    for field in fields:
        field_key = field["key"]
        raw_value = config_payload.get(field_key)
        if raw_value is None:
            if field.get("required"):
                raise ExtensionManifestValidationError(f"Config field '{field_key}' is required.")
            continue

        field_type = field["type"]
        if field_type == "string":
            if not isinstance(raw_value, str) or not raw_value.strip():
                raise ExtensionManifestValidationError(f"Config field '{field_key}' must be a non-empty string.")
            normalized[field_key] = raw_value.strip()
            continue

        if field_type == "number":
            if not isinstance(raw_value, (int, float)) or isinstance(raw_value, bool):
                raise ExtensionManifestValidationError(f"Config field '{field_key}' must be numeric.")
            normalized[field_key] = raw_value
            continue

        if field_type == "boolean":
            if not isinstance(raw_value, bool):
                raise ExtensionManifestValidationError(f"Config field '{field_key}' must be a boolean.")
            normalized[field_key] = raw_value
            continue

        raise ExtensionManifestValidationError(
            f"Config field '{field_key}' uses unsupported type '{field_type}'."
        )

    for key, value in config_payload.items():
        if key not in normalized and any(field["key"] == key for field in fields):
            continue
        if key not in {field["key"] for field in fields}:
            normalized[key] = value

    return normalized
