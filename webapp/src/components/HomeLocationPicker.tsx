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
  title: _title,
  description: _description,
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
    <div className="space-y-6 flex flex-col">
      {/* Top Controls: Use Device Location & Search */}
      <div className="flex flex-col sm:flex-row gap-4">
        <button
          type="button"
          onClick={requestBrowserLocation}
          disabled={isLocating || isSaving}
          className="group flex-1 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 py-3 px-4 text-sm font-bold text-slate-700 dark:text-slate-200 shadow-sm transition-all duration-300 disabled:opacity-70 border border-slate-200/50 dark:border-slate-700/50 hover:shadow-md active:scale-[0.98]"
        >
          <span className={`material-icons-round mr-2 text-lg transition-transform group-hover:scale-110 ${isLocating ? "animate-spin text-primary" : "text-primary dark:text-blue-400"}`}>
            {isLocating ? "autorenew" : "my_location"}
          </span>
          {isLocating ? mergedLabels.requestingLocation : mergedLabels.useDevice}
        </button>

        <form onSubmit={searchLocations} className="flex-1 relative">
          <div className="flex gap-3">
            <div className="relative flex-1 group">
              <span className="material-icons-round absolute left-3.5 top-3 text-[18px] text-slate-400 transition-colors group-focus-within:text-primary z-10">search</span>
              <input
                type="search"
                value={locationSearch}
                onChange={(event) => setLocationSearch(event.target.value)}
                className="w-full h-full bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700/70 hover:border-slate-300 dark:hover:border-slate-600 rounded-xl py-3 pl-11 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400/70 transition-all duration-300 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/20 shadow-sm"
                placeholder={mergedLabels.searchPlaceholder}
                disabled={isSaving}
              />
            </div>
            <button
              type="submit"
              disabled={isSearchingLocation || isSaving}
              className="flex items-center justify-center w-[46px] h-[46px] rounded-xl bg-slate-800 dark:bg-white hover:bg-slate-900 dark:hover:bg-slate-100 text-white dark:text-slate-900 transition-all duration-300 shadow-sm hover:shadow-md active:scale-95 disabled:opacity-60"
              aria-label={mergedLabels.searchAriaLabel}
            >
              <span className={`material-icons-round text-[20px] ${isSearchingLocation ? "animate-spin" : ""}`}>
                {isSearchingLocation ? "autorenew" : "arrow_forward"}
              </span>
            </button>
          </div>
        </form>
      </div>

      {/* Errors & Search Results */}
      {error ? (
        <p className="flex items-center text-xs font-medium text-red-500 animate-fade-in -mt-2">
          <span className="material-icons-round mr-1.5 text-[16px]">error</span>
          {error}
        </p>
      ) : null}

      {locationResults.length > 0 ? (
        <div className="max-h-48 grid grid-cols-1 sm:grid-cols-2 gap-2 overflow-auto custom-scrollbar -mt-2">
          {locationResults.map((result) => (
            <button
              key={result.place_id}
              type="button"
              onClick={() => selectSearchResult(result)}
              disabled={isSaving}
              className="w-full group text-left transition-all duration-300 disabled:opacity-60"
            >
              <div className="rounded-xl border border-slate-200/70 bg-slate-50/80 p-3 hover:border-primary/50 hover:bg-white dark:border-slate-700/50 dark:bg-slate-800/40 dark:hover:border-primary/50 dark:hover:bg-slate-800 hover:shadow-sm">
                  <span className="line-clamp-2 block text-sm font-semibold text-slate-900 dark:text-white group-hover:text-primary dark:group-hover:text-blue-400 transition-colors">{summarizePlace(result)}</span>
                  <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">{Number(result.lat).toFixed(5)}, {Number(result.lon).toFixed(5)}</span>
              </div>
            </button>
          ))}
        </div>
      ) : null}

      {/* Map Area */}
      <div className="space-y-3">
        <div className="overflow-hidden w-full rounded-2xl border border-slate-200/80 dark:border-slate-700/50 bg-slate-100 dark:bg-slate-900/50 h-[320px] sm:h-[420px] shadow-md relative group">
          <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-black/5 dark:ring-white/5 rounded-2xl z-10"></div>
          <HomeLocationMap
            latitude={currentLocation.latitude}
            longitude={currentLocation.longitude}
            onPick={handleMapPick}
          />
        </div>
        <div className="flex justify-between items-center px-1">
            <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 opacity-80"><span className="material-icons-round text-[14px]">touch_app</span>{mergedLabels.dragHint}</p>
            <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
                className="inline-flex text-[11px] font-medium text-slate-400 hover:text-primary transition-colors"
            >
                © OpenStreetMap
            </a>
        </div>
      </div>

      {/* Selected Location & Actions */}
      <div className="space-y-4 pt-2">
        <div className={`rounded-2xl border p-4 transition-all duration-500 ${selectedLocation ? 'bg-primary/5 border-primary/20 dark:bg-primary/10 dark:border-primary/20 shadow-[inset_0_0_20px_rgba(59,130,246,0.05)]' : 'bg-slate-50/50 border-slate-200 dark:bg-slate-900/50 dark:border-slate-700/50'}`}>
          <div className="flex items-start gap-4">
            <div className={`flex items-center justify-center w-10 h-10 rounded-full shrink-0 transition-colors duration-500 ${selectedLocation ? 'bg-primary text-white shadow-md shadow-primary/30' : 'bg-slate-200 dark:bg-slate-800 text-slate-400'}`}>
                <span className="material-icons-round text-[20px]">
                {selectedLocation ? "check" : "place"}
                </span>
            </div>
            <div className="pt-0.5 flex-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <p className={`text-sm font-bold transition-colors duration-300 ${selectedLocation ? 'text-primary dark:text-blue-400' : 'text-slate-900 dark:text-white'}`}>{selectedLocation ? selectedLocation.label : mergedLabels.noneSelected}</p>
                <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400 leading-snug">
                  {selectedLocation
                    ? `${formatCoordinate(selectedLocation.latitude)}, ${formatCoordinate(selectedLocation.longitude)}`
                    : mergedLabels.noneDescription}
                </p>
              </div>
              {isResolvingCoordinates ? (
                <p className="inline-flex items-center text-[12px] font-bold text-primary animate-pulse whitespace-nowrap">
                  <span className="material-icons-round mr-1.5 animate-spin text-[16px]">autorenew</span>
                  {mergedLabels.resolvingCoordinates}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div>
            {actions}
        </div>
      </div>
    </div>
  );
}
