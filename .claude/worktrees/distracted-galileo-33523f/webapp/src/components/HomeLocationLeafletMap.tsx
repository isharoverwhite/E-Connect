/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { divIcon, type LatLngExpression, type Marker as LeafletMarker } from "leaflet";

type HomeLocationLeafletMapProps = {
  latitude: number;
  longitude: number;
  onPick: (latitude: number, longitude: number) => void;
};

const homeLocationIcon = divIcon({
  className: "home-location-marker",
  html: '<div class="home-location-marker__pin"><span class="material-icons-round home-location-marker__icon">place</span></div>',
  iconSize: [42, 52],
  iconAnchor: [21, 52],
});

function RecenterMap({ center }: { center: LatLngExpression }) {
  const map = useMap();

  useEffect(() => {
    map.setView(center, Math.max(map.getZoom(), 15), { animate: true });
  }, [center, map]);

  return null;
}

function PickOnMapClick({ onPick }: { onPick: (latitude: number, longitude: number) => void }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });

  return null;
}

export default function HomeLocationLeafletMap({
  latitude,
  longitude,
  onPick,
}: HomeLocationLeafletMapProps) {
  const markerRef = useRef<LeafletMarker | null>(null);
  const center = useMemo<LatLngExpression>(() => [latitude, longitude], [latitude, longitude]);

  const eventHandlers = useMemo(
    () => ({
      dragend() {
        const marker = markerRef.current;
        if (!marker) {
          return;
        }
        const nextLatLng = marker.getLatLng();
        onPick(nextLatLng.lat, nextLatLng.lng);
      },
    }),
    [onPick],
  );

  return (
    <MapContainer
      center={center}
      zoom={15}
      scrollWheelZoom
      className="home-location-map h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <RecenterMap center={center} />
      <PickOnMapClick onPick={onPick} />
      <Marker
        draggable
        eventHandlers={eventHandlers}
        icon={homeLocationIcon}
        position={center}
        ref={markerRef}
      />
    </MapContainer>
  );
}
