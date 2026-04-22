/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import HomeLocationMap from "@/components/HomeLocationMap";
import {
  DEFAULT_MAP_LOCATION,
  formatCoordinate,
  type HomeLocation,
  type NominatimResult,
  reverseGeocodeLabel,
  searchHomeLocations,
  summarizePlace,
} from "@/lib/home-location";

type HomeLocationPickerLabels = {
  useDevice: string;
  requestingLocation: string;
  searchLabel: string;
  searchPlaceholder: string;
  searchAriaLabel: string;
  noneSelected: string;
  noneDescription: string;
  dragHint: string;
  resolvingCoordinates: string;
};

type HomeLocationPickerProps = {
  isOpen?: boolean;
  selectedLocation: HomeLocation | null;
  onLocationChange: (location: HomeLocation) => void;
  title: string;
  description: string;
  isSaving?: boolean;
  labels?: Partial<HomeLocationPickerLabels>;
  actions?: ReactNode;
};

const defaultLabels: HomeLocationPickerLabels = {
  useDevice: "Use this device location",
  requestingLocation: "Requesting location...",
  searchLabel: "Search manually",
  searchPlaceholder: "Street, city, or place",
  searchAriaLabel: "Search location",
  noneSelected: "No home location selected",
  noneDescription: "Allow browser location access, search manually, or drag the marker on the map.",
  dragHint: "Tip: drag the marker or click anywhere on the map to fine-tune the exact house position.",
  resolvingCoordinates: "Updating coordinates...",
};

export default function HomeLocationPicker({
  isOpen = true,
  selectedLocation,
  onLocationChange,
  title,
  description,
  isSaving = false,
  labels,
  actions,
}: HomeLocationPickerProps) {
  const mergedLabels = useMemo(() => ({ ...defaultLabels, ...labels }), [labels]);
  const [locationSearch, setLocationSearch] = useState("");
  const [locationResults, setLocationResults] = useState<NominatimResult[]>([]);
  const [isLocating, setIsLocating] = useState(false);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [isResolvingCoordinates, setIsResolvingCoordinates] = useState(false);
  const [error, setError] = useState("");
  const [hasRequestedBrowserLocation, setHasRequestedBrowserLocation] = useState(false);
  const resolveRequestIdRef = useRef(0);

  const applyHomeLocation = useCallback((location: HomeLocation) => {
    onLocationChange(location);
    setError("");
  }, [onLocationChange]);

  const requestBrowserLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("This browser cannot share location. Search for your home manually.");
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        const label = await reverseGeocodeLabel(latitude, longitude);
        applyHomeLocation({ latitude, longitude, label, source: "browser_geolocation" });
        setIsLocating(false);
      },
      (geolocationError) => {
        console.warn("Home location permission failed:", geolocationError);
        setError("Location permission was not granted. Search for your home manually.");
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }, [applyHomeLocation]);

  useEffect(() => {
    if (!isOpen || hasRequestedBrowserLocation || selectedLocation) {
      return;
    }
    setHasRequestedBrowserLocation(true);
    requestBrowserLocation();
  }, [hasRequestedBrowserLocation, isOpen, requestBrowserLocation, selectedLocation]);

  const searchLocations = async (event: FormEvent) => {
    event.preventDefault();
    const query = locationSearch.trim();
    if (!query) {
      setError("Enter a place, address, or city to search.");
      return;
    }

    setIsSearchingLocation(true);
    try {
      const results = await searchHomeLocations(query);
      setLocationResults(results);
      setError(results.length === 0 ? "No matching place found. Try a more specific address." : "");
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Location search failed.");
    } finally {
      setIsSearchingLocation(false);
    }
  };

  const selectSearchResult = (result: NominatimResult) => {
    const latitude = Number(result.lat);
    const longitude = Number(result.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setError("Selected place has invalid coordinates.");
      return;
    }
    applyHomeLocation({
      latitude,
      longitude,
      label: summarizePlace(result),
      source: "manual_search",
    });
  };

  const handleMapPick = useCallback(async (latitude: number, longitude: number) => {
    const requestId = resolveRequestIdRef.current + 1;
    resolveRequestIdRef.current = requestId;
    setIsResolvingCoordinates(true);
    try {
      const label = await reverseGeocodeLabel(latitude, longitude);
      if (resolveRequestIdRef.current !== requestId) {
        return;
      }
      applyHomeLocation({
        latitude,
        longitude,
        label,
        source: "manual_coordinates",
      });
    } finally {
      if (resolveRequestIdRef.current === requestId) {
        setIsResolvingCoordinates(false);
      }
    }
  }, [applyHomeLocation]);

  const currentLocation = selectedLocation ?? DEFAULT_MAP_LOCATION;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5">
      <div className="space-y-3">
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-950 h-[320px] sm:h-[420px]">
          <HomeLocationMap
            latitude={currentLocation.latitude}
            longitude={currentLocation.longitude}
            onPick={handleMapPick}
          />
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{mergedLabels.dragHint}</p>
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">{title}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{description}</p>
        </div>

        <button
          type="button"
          onClick={requestBrowserLocation}
          disabled={isLocating || isSaving}
          className="flex w-full items-center justify-center rounded-lg bg-primary py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-600 disabled:opacity-70"
        >
          <span className={`material-icons-round mr-2 text-lg ${isLocating ? "animate-spin" : ""}`}>
            {isLocating ? "autorenew" : "my_location"}
          </span>
          {isLocating ? mergedLabels.requestingLocation : mergedLabels.useDevice}
        </button>

        <form onSubmit={searchLocations} className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">{mergedLabels.searchLabel}</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="material-icons-round absolute left-3 top-2.5 text-[18px] text-slate-400">search</span>
              <input
                type="search"
                value={locationSearch}
                onChange={(event) => setLocationSearch(event.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 pl-10 pr-3 text-sm text-slate-900 placeholder-slate-400 transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary dark:border-slate-700 dark:bg-black/20 dark:text-white"
                placeholder={mergedLabels.searchPlaceholder}
                disabled={isSaving}
              />
            </div>
            <button
              type="submit"
              disabled={isSearchingLocation || isSaving}
              className="rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-slate-900"
              aria-label={mergedLabels.searchAriaLabel}
            >
              <span className={`material-icons-round text-lg ${isSearchingLocation ? "animate-spin" : ""}`}>
                {isSearchingLocation ? "autorenew" : "search"}
              </span>
            </button>
          </div>
          {error ? (
            <p className="flex items-center text-xs font-medium text-red-500">
              <span className="material-icons-round mr-1 text-[14px]">error</span>
              {error}
            </p>
          ) : null}
        </form>

        {locationResults.length > 0 ? (
          <div className="max-h-36 space-y-2 overflow-auto pr-1">
            {locationResults.map((result) => (
              <button
                key={result.place_id}
                type="button"
                onClick={() => selectSearchResult(result)}
                disabled={isSaving}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-primary/70 disabled:opacity-60 dark:border-slate-700 dark:bg-black/20"
              >
                <span className="line-clamp-2 block text-sm font-semibold text-slate-900 dark:text-white">{summarizePlace(result)}</span>
                <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">{Number(result.lat).toFixed(5)}, {Number(result.lon).toFixed(5)}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="min-h-[116px] rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-black/20">
          <div className="flex items-start gap-3">
            <span className={`material-icons-round mt-0.5 ${selectedLocation ? "text-emerald-500" : "text-slate-400"}`}>
              {selectedLocation ? "check_circle" : "home_pin"}
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{selectedLocation ? selectedLocation.label : mergedLabels.noneSelected}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {selectedLocation
                  ? `${formatCoordinate(selectedLocation.latitude)}, ${formatCoordinate(selectedLocation.longitude)}`
                  : mergedLabels.noneDescription}
              </p>
              {isResolvingCoordinates ? (
                <p className="mt-2 inline-flex items-center text-[11px] font-medium text-primary">
                  <span className="material-icons-round mr-1 animate-spin text-[14px]">autorenew</span>
                  {mergedLabels.resolvingCoordinates}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {actions}

        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          className="inline-flex text-[11px] text-slate-500 hover:text-primary"
        >
          © OpenStreetMap contributors
        </a>
      </div>
    </div>
  );
}
