/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

export type LocationSource = "browser_geolocation" | "manual_search" | "manual_coordinates";

export type HomeLocation = {
  latitude: number;
  longitude: number;
  label: string;
  source: LocationSource;
};

export type NominatimResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    country?: string;
  };
};

export const DEFAULT_MAP_LOCATION: HomeLocation = {
  latitude: 21.0285,
  longitude: 105.8542,
  label: "Hanoi",
  source: "manual_search",
};

export function formatCoordinate(value: number) {
  return value.toFixed(5);
}

export function summarizePlace(result: NominatimResult) {
  const address = result.address;
  const localName = address?.city || address?.town || address?.village || address?.state;
  if (localName && address?.country) {
    return `${localName}, ${address.country}`;
  }
  return result.display_name.split(",").slice(0, 3).join(",").trim() || result.display_name;
}

export async function reverseGeocodeLabel(latitude: number, longitude: number) {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(latitude),
    lon: String(longitude),
    zoom: "14",
    addressdetails: "1",
  });

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error("Reverse geocoding failed");
    }
    const result = await response.json();
    if (typeof result?.display_name === "string" && result.display_name.trim()) {
      return result.display_name.split(",").slice(0, 3).join(",").trim();
    }
  } catch (error) {
    console.warn("Failed to resolve browser location label:", error);
  }

  return `Home (${formatCoordinate(latitude)}, ${formatCoordinate(longitude)})`;
}

export async function searchHomeLocations(query: string) {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    addressdetails: "1",
    limit: "5",
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("Location search failed");
  }
  return response.json() as Promise<NominatimResult[]>;
}
