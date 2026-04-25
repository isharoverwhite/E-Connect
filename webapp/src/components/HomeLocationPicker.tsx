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
    setLocationResults([]);
  };

  const handleMapPick = useCallback(async (latitude: number, longitude: number) => {
    setLocationResults([]);
    setError("");
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
    <div className="flex h-full flex-col space-y-4">
      {/* Top Controls: Use Device Location & Search */}
      <div className="flex shrink-0 flex-col sm:flex-row gap-3 sm:gap-4 relative z-50">
        <button
          type="button"
          onClick={requestBrowserLocation}
          disabled={isLocating || isSaving}
          className="group flex-1 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 py-2.5 sm:py-3 px-4 text-sm font-bold text-slate-700 dark:text-slate-200 shadow-sm transition-all duration-300 disabled:opacity-70 border border-slate-200/50 dark:border-slate-700/50 hover:shadow-md active:scale-[0.98]"
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
                type="text"
                enterKeyHint="search"
                value={locationSearch}
                onChange={(event) => setLocationSearch(event.target.value)}
                className="w-full h-full bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700/70 hover:border-slate-300 dark:hover:border-slate-600 rounded-xl py-2.5 sm:py-3 pl-11 pr-10 text-sm text-slate-900 dark:text-white placeholder-slate-400/70 transition-all duration-300 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/20 shadow-sm"
                placeholder={mergedLabels.searchPlaceholder}
                disabled={isSaving}
              />
              {locationSearch.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setLocationSearch("");
                    setLocationResults([]);
                    setError("");
                  }}
                  className="absolute right-3 top-3 w-[20px] h-[20px] flex items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors z-10"
                >
                  <span className="material-icons-round text-[14px]">close</span>
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={isSearchingLocation || isSaving}
              className="flex items-center justify-center w-[42px] sm:w-[46px] rounded-xl bg-slate-800 dark:bg-white hover:bg-slate-900 dark:hover:bg-slate-100 text-white dark:text-slate-900 transition-all duration-300 shadow-sm hover:shadow-md active:scale-95 disabled:opacity-60"
              aria-label={mergedLabels.searchAriaLabel}
            >
              <span className={`material-icons-round text-[20px] ${isSearchingLocation ? "animate-spin" : ""}`}>
                {isSearchingLocation ? "autorenew" : "arrow_forward"}
              </span>
            </button>
          </div>

          {/* Absolute Search Results Dropdown */}
          {(locationResults.length > 0 || error) ? (
            <div className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl overflow-hidden animate-fade-in flex flex-col z-50">
              {error ? (
                <div className="p-3 bg-red-50 dark:bg-red-900/20">
                  <p className="flex items-center text-xs font-medium text-red-500">
                    <span className="material-icons-round mr-1.5 text-[16px]">error</span>
                    {error}
                  </p>
                </div>
              ) : null}
              {locationResults.length > 0 ? (
                <div className="max-h-60 overflow-y-auto custom-scrollbar flex flex-col p-1.5 gap-0.5">
                  {locationResults.map((result) => (
                    <button
                      key={result.place_id}
                      type="button"
                      onClick={() => selectSearchResult(result)}
                      disabled={isSaving}
                      className="w-full text-left rounded-lg p-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group disabled:opacity-60"
                    >
                      <span className="block text-sm font-semibold text-slate-900 dark:text-white truncate group-hover:text-primary dark:group-hover:text-blue-400 transition-colors">
                        {summarizePlace(result)}
                      </span>
                      <span className="block mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {Number(result.lat).toFixed(5)}, {Number(result.lon).toFixed(5)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </form>
      </div>

      {/* Map Area */}
      <div className="flex min-h-0 flex-1 flex-col space-y-2 sm:space-y-3 relative z-10">
        <div className="group relative flex-1 basis-[300px] sm:basis-[360px] min-h-[150px] w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-100 shadow-md dark:border-slate-700/50 dark:bg-slate-900/50">
          <div className="absolute inset-0 z-10 pointer-events-none rounded-2xl ring-1 ring-inset ring-black/5 dark:ring-white/5"></div>
          <HomeLocationMap
            latitude={currentLocation.latitude}
            longitude={currentLocation.longitude}
            onPick={handleMapPick}
          />
        </div>
        <div className="flex justify-end px-1">
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
      <div className="shrink-0 space-y-2 pt-1 sm:space-y-3 sm:pt-2">
        <div className={`rounded-xl border p-2.5 sm:p-3 transition-all duration-500 ${selectedLocation ? 'bg-primary/5 border-primary/20 dark:bg-primary/10 dark:border-primary/20 shadow-[inset_0_0_20px_rgba(59,130,246,0.05)]' : 'bg-slate-50/50 border-slate-200 dark:bg-slate-900/50 dark:border-slate-700/50'}`}>
          <div className="flex items-center gap-3">
            <div className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 transition-colors duration-500 ${selectedLocation ? 'bg-primary text-white shadow-md shadow-primary/30' : 'bg-slate-200 dark:bg-slate-800 text-slate-400'}`}>
                <span className="material-icons-round text-[16px]">
                {selectedLocation ? "check" : "place"}
                </span>
            </div>
            <div className="flex-1 flex items-center justify-between gap-2 overflow-hidden">
              <div className="truncate">
                <p className={`text-sm font-bold truncate transition-colors duration-300 ${selectedLocation ? 'text-primary dark:text-blue-400' : 'text-slate-900 dark:text-white'}`}>{selectedLocation ? selectedLocation.label : mergedLabels.noneSelected}</p>
                {selectedLocation ? (
                   <p className="text-[12px] text-slate-500 dark:text-slate-400 truncate">
                     {`${formatCoordinate(selectedLocation.latitude)}, ${formatCoordinate(selectedLocation.longitude)}`}
                   </p>
                ) : null}
              </div>
              {isResolvingCoordinates ? (
                <p className="inline-flex items-center shrink-0 text-[12px] font-bold text-primary animate-pulse whitespace-nowrap">
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
