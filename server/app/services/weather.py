# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from __future__ import annotations

import json
import ssl
import urllib.parse
import urllib.request
from typing import Any

import certifi


OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
WTTR_URL = "https://wttr.in"
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
    if weather_code == 95:
        return "Stormy nearby", "thunderstorm"
    if 96 <= weather_code <= 99:
        return "Thunderstorm", "thunderstorm"
    return "Cloudy", "cloud"


# wttr.in (Weather.com) code → (description, icon)
_WTTR_CODE_MAP: dict[int, tuple[str, str]] = {
    113: ("Clear sky",       "sunny"),
    116: ("Partly cloudy",   "cloud"),
    119: ("Cloudy",          "cloud"),
    122: ("Overcast",        "cloud"),
    143: ("Mist",            "foggy"),
    176: ("Patchy rain",     "rainy"),
    179: ("Patchy snow",     "ac_unit"),
    182: ("Patchy sleet",    "rainy"),
    185: ("Patchy freezing drizzle", "rainy"),
    200: ("Stormy nearby",   "thunderstorm"),
    227: ("Blowing snow",    "ac_unit"),
    230: ("Blizzard",        "ac_unit"),
    248: ("Fog",             "foggy"),
    260: ("Freezing fog",    "foggy"),
    263: ("Light drizzle",   "rainy"),
    266: ("Drizzle",         "rainy"),
    281: ("Freezing drizzle","rainy"),
    284: ("Heavy freezing drizzle", "rainy"),
    293: ("Light rain",      "rainy"),
    296: ("Moderate rain",   "rainy"),
    299: ("Heavy rain",      "rainy"),
    302: ("Heavy rain",      "rainy"),
    305: ("Heavy rain",      "rainy"),
    308: ("Torrential rain", "rainy"),
    311: ("Light sleet",     "rainy"),
    314: ("Moderate sleet",  "rainy"),
    317: ("Light sleet",     "rainy"),
    320: ("Moderate snow",   "ac_unit"),
    323: ("Patchy light snow","ac_unit"),
    326: ("Light snow",      "ac_unit"),
    329: ("Patchy moderate snow","ac_unit"),
    332: ("Moderate snow",   "ac_unit"),
    335: ("Patchy heavy snow","ac_unit"),
    338: ("Heavy snow",      "ac_unit"),
    350: ("Ice pellets",     "ac_unit"),
    353: ("Light rain showers","rainy"),
    356: ("Moderate rain showers","rainy"),
    359: ("Torrential rain", "rainy"),
    362: ("Light sleet showers","rainy"),
    365: ("Moderate sleet showers","rainy"),
    368: ("Light snow showers","ac_unit"),
    371: ("Moderate snow showers","ac_unit"),
    374: ("Light ice pellets","ac_unit"),
    377: ("Moderate ice pellets","ac_unit"),
    386: ("Thunderstorm",    "thunderstorm"),
    389: ("Thunderstorm",    "thunderstorm"),
    392: ("Patchy snow with thunder","thunderstorm"),
    395: ("Heavy snow with thunder","thunderstorm"),
}


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


def _parse_metar_conditions(station: dict[str, Any]) -> tuple[str, str]:
    wx = (station.get("wxString") or "").upper()
    cover = (station.get("cover") or "").upper()

    if "TS" in wx:
        return ("Thunderstorm", "thunderstorm") if ("RA" in wx or "GR" in wx) else ("Stormy nearby", "thunderstorm")
    if "RA" in wx or "DZ" in wx:
        if wx.startswith("-"):
            return "Light rain", "rainy"
        if wx.startswith("+"):
            return "Heavy rain", "rainy"
        return "Rainy", "rainy"
    if "SN" in wx or "SG" in wx or "GS" in wx:
        return "Snowy", "ac_unit"
    if "FG" in wx:
        return "Foggy", "foggy"
    if "BR" in wx or "HZ" in wx:
        return "Hazy", "foggy"

    if cover in ("CAVOK", "CLR", "SKC", "NSC"):
        return "Clear sky", "sunny"
    if cover == "FEW":
        return "Mostly clear", "sunny"
    if cover == "SCT":
        return "Partly cloudy", "cloud"
    if cover in ("BKN", "OVC"):
        return "Cloudy", "cloud"
    return "Clear sky", "sunny"


def fetch_metar_for_location(latitude: float, longitude: float) -> dict[str, Any] | None:
    """Fetch nearest METAR observation from aviationweather.gov. Returns None on any failure."""
    delta = 1.5
    bbox = f"{latitude - delta},{longitude - delta},{latitude + delta},{longitude + delta}"
    url = f"https://aviationweather.gov/api/data/metar?bbox={bbox}&format=json"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "E-Connect/1.0 self-hosted-home-weather"},
    )
    ssl_context = ssl.create_default_context(cafile=certifi.where())
    try:
        with urllib.request.urlopen(request, timeout=WEATHER_TIMEOUT_SECONDS, context=ssl_context) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if not isinstance(payload, list) or not payload:
            return None

        nearest = None
        min_dist = float("inf")
        for station in payload:
            slat = station.get("lat")
            slon = station.get("lon")
            if slat is None or slon is None:
                continue
            dist = (float(slat) - latitude) ** 2 + (float(slon) - longitude) ** 2
            if dist < min_dist:
                min_dist = dist
                nearest = station

        if nearest is None:
            return None

        temp = nearest.get("temp")
        if temp is None:
            return None

        description, icon = _parse_metar_conditions(nearest)
        icao_id = nearest.get("icaoId") or nearest.get("stationId") or ""
        return {
            "temperature": float(temp),
            "description": description,
            "icon": icon,
            "source": f"METAR {icao_id}".strip(),
            "observed_at": nearest.get("reportTime"),
        }
    except Exception:
        return None


def fetch_wttr_weather_for_location(latitude: float, longitude: float) -> dict[str, Any] | None:
    """Fetch current conditions from wttr.in (Weather.com source). Returns None on any failure."""
    url = f"{WTTR_URL}/{latitude:.4f},{longitude:.4f}?format=j1"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "E-Connect/1.0 self-hosted-home-weather"},
    )
    ssl_context = ssl.create_default_context(cafile=certifi.where())
    try:
        with urllib.request.urlopen(request, timeout=WEATHER_TIMEOUT_SECONDS, context=ssl_context) as response:
            payload = json.loads(response.read().decode("utf-8"))
        cc = payload["current_condition"][0]
        wttr_code = int(cc["weatherCode"])
        temperature = float(cc["temp_C"])
        raw_desc = cc["weatherDesc"][0]["value"]
        description, icon = _WTTR_CODE_MAP.get(wttr_code, (raw_desc, "cloud"))
        is_day = cc.get("is_day") == "yes"
        return {
            "temperature": temperature,
            "weather_code": wttr_code,
            "description": description,
            "icon": icon,
            "is_day": is_day,
        }
    except Exception:
        return None


def _fetch_wttr_daily(latitude: float, longitude: float) -> list[dict[str, Any]] | None:
    """Fetch 3-day daily forecast from wttr.in (Weather.com). Returns None on failure."""
    url = f"{WTTR_URL}/{latitude:.4f},{longitude:.4f}?format=j1"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "E-Connect/1.0 self-hosted-home-weather"},
    )
    ssl_context = ssl.create_default_context(cafile=certifi.where())
    try:
        with urllib.request.urlopen(request, timeout=WEATHER_TIMEOUT_SECONDS, context=ssl_context) as response:
            payload = json.loads(response.read().decode("utf-8"))
        result = []
        for day in payload.get("weather", [])[:3]:
            date_str = day.get("date", "")
            max_c = float(day.get("maxtempC", 0))
            min_c = float(day.get("mintempC", 0))
            hourly: list = day.get("hourly", [])
            # Use midday slot (index 4 = 12:00) as representative condition
            midday = hourly[4] if len(hourly) > 4 else (hourly[-1] if hourly else {})
            wttr_code = int(midday.get("weatherCode", 113))
            raw_desc = (midday.get("weatherDesc") or [{}])[0].get("value", "")
            description, icon = _WTTR_CODE_MAP.get(wttr_code, (raw_desc or "Cloudy", "cloud"))
            result.append({
                "date": date_str,
                "weather_code": wttr_code,
                "description": description,
                "icon": icon,
                "temp_max": max_c,
                "temp_min": min_c,
            })
        return result or None
    except Exception:
        return None


def _fetch_open_meteo_daily(latitude: float, longitude: float) -> list[dict[str, Any]] | None:
    """Fetch 7-day daily forecast from Open-Meteo DWD ICON. Returns None on failure."""
    query = urllib.parse.urlencode({
        "latitude": f"{latitude:.6f}",
        "longitude": f"{longitude:.6f}",
        "daily": "temperature_2m_max,temperature_2m_min,weather_code",
        "timezone": "auto",
        "forecast_days": "7",
        "models": "icon_seamless",
    })
    url = f"{OPEN_METEO_FORECAST_URL}?{query}"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "E-Connect/1.0 self-hosted-home-weather"},
    )
    ssl_context = ssl.create_default_context(cafile=certifi.where())
    try:
        with urllib.request.urlopen(request, timeout=WEATHER_TIMEOUT_SECONDS, context=ssl_context) as response:
            payload = json.loads(response.read().decode("utf-8"))
        daily = payload.get("daily")
        if not isinstance(daily, dict):
            return None
        times: list = daily.get("time", [])
        max_temps: list = daily.get("temperature_2m_max", [])
        min_temps: list = daily.get("temperature_2m_min", [])
        codes: list = daily.get("weather_code", [])
        result = []
        for i, date_str in enumerate(times):
            code = int(codes[i]) if i < len(codes) and codes[i] is not None else 0
            desc, icon = describe_weather_code(code)
            result.append({
                "date": date_str,
                "weather_code": code,
                "description": desc,
                "icon": icon,
                "temp_max": float(max_temps[i]) if i < len(max_temps) and max_temps[i] is not None else None,
                "temp_min": float(min_temps[i]) if i < len(min_temps) and min_temps[i] is not None else None,
            })
        return result or None
    except Exception:
        return None


def fetch_daily_forecast_for_location(latitude: float, longitude: float) -> list[dict[str, Any]] | None:
    """Merge wttr.in (days 1–3) with Open-Meteo ICON (days 4–7)."""
    wttr = _fetch_wttr_daily(latitude, longitude)
    meteo = _fetch_open_meteo_daily(latitude, longitude)

    if not meteo:
        return wttr  # fallback to wttr-only if Open-Meteo fails

    if wttr:
        # wttr.in covers days 1-3; Open-Meteo fills days 4-7 (indices 3-6)
        merged = wttr[:3] + meteo[3:]
    else:
        merged = meteo

    return merged or None
