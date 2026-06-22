/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import dynamic from "next/dynamic";

const HomeLocationLeafletMap = dynamic(() => import("./HomeLocationLeafletMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-slate-100 text-sm font-medium text-slate-500 dark:bg-slate-950 dark:text-slate-400">
      Loading map...
    </div>
  ),
});

type HomeLocationMapProps = {
  latitude: number;
  longitude: number;
  onPick: (latitude: number, longitude: number) => void;
};

export default function HomeLocationMap(props: HomeLocationMapProps) {
  return <HomeLocationLeafletMap {...props} />;
}
