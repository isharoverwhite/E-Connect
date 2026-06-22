# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from __future__ import annotations

import json
import ssl
import urllib.parse
import urllib.request
from typing import Any

import certifi


OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
WEATHER_TIMEOUT_SECONDS = 5


class WeatherProviderError(RuntimeError):
    pass


def describe_weather_code(weather_code: int) -> tuple[str, str]:
    if weather_code == 0:
        return "Clear sky", "sunny"
    if weather_code in (1, 2, 3):
        return "Partly cloudy", "cloud"
    if weather_code in (45, 48):
        return "Foggy", "foggy"
    if 51 <= weather_code <= 67:
        return "Rainy", "rainy"
    if 71 <= weather_code <= 77:
        return "Snowy", "ac_unit"
    if 80 <= weather_code <= 82:
        return "Showers", "rainy"
    if 95 <= weather_code <= 99:
        return "Thunderstorm", "thunderstorm"
    return "Cloudy", "cloud"


def _coerce_float(value: Any, field_name: str) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise WeatherProviderError(f"Open-Meteo response is missing {field_name}.") from exc
    if not parsed == parsed:
        raise WeatherProviderError(f"Open-Meteo response contains invalid {field_name}.")
    return parsed


def _coerce_weather_code(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise WeatherProviderError("Open-Meteo response is missing weather_code.") from exc


def _build_open_meteo_url(latitude: float, longitude: float) -> str:
    query = urllib.parse.urlencode(
        {
            "latitude": f"{latitude:.6f}",
            "longitude": f"{longitude:.6f}",
            "current": "temperature_2m,weather_code,is_day",
            "temperature_unit": "celsius",
            "timezone": "auto",
        }
    )
    return f"{OPEN_METEO_FORECAST_URL}?{query}"


def _load_open_meteo_payload(latitude: float, longitude: float) -> dict[str, Any]:
    request = urllib.request.Request(
        _build_open_meteo_url(latitude, longitude),
        headers={"User-Agent": "E-Connect/1.0 self-hosted-home-weather"},
    )
    ssl_context = ssl.create_default_context(cafile=certifi.where())
    try:
        with urllib.request.urlopen(request, timeout=WEATHER_TIMEOUT_SECONDS, context=ssl_context) as response:
            raw_payload = response.read().decode("utf-8")
    except Exception as exc:
        raise WeatherProviderError("Open-Meteo weather request failed.") from exc

    try:
        payload = json.loads(raw_payload)
    except json.JSONDecodeError as exc:
        raise WeatherProviderError("Open-Meteo returned invalid JSON.") from exc

    if not isinstance(payload, dict):
        raise WeatherProviderError("Open-Meteo returned an unexpected payload.")
    return payload


def fetch_current_weather_for_location(latitude: float, longitude: float) -> dict[str, Any]:
    payload = _load_open_meteo_payload(latitude, longitude)
    current = payload.get("current")

    if isinstance(current, dict):
        temperature = _coerce_float(current.get("temperature_2m"), "temperature_2m")
        weather_code = _coerce_weather_code(current.get("weather_code"))
        is_day_value = current.get("is_day")
        is_day = bool(is_day_value) if is_day_value is not None else None
        observed_at = current.get("time") if isinstance(current.get("time"), str) else None
    else:
        legacy_current = payload.get("current_weather")
        if not isinstance(legacy_current, dict):
            raise WeatherProviderError("Open-Meteo response is missing current conditions.")
        temperature = _coerce_float(legacy_current.get("temperature"), "temperature")
        weather_code = _coerce_weather_code(legacy_current.get("weathercode"))
        is_day_value = legacy_current.get("is_day")
        is_day = bool(is_day_value) if is_day_value is not None else None
        observed_at = legacy_current.get("time") if isinstance(legacy_current.get("time"), str) else None

    description, icon = describe_weather_code(weather_code)
    return {
        "temperature": temperature,
        "weather_code": weather_code,
        "description": description,
        "icon": icon,
        "is_day": is_day,
        "observed_at": observed_at,
    }
