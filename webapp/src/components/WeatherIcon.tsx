// Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.
"use client";

import { useEffect, useRef } from "react";
import { animate, createTimeline, stagger } from "animejs";

function resetStyles(els: HTMLElement | HTMLElement[], props: string[]) {
  const targets = Array.isArray(els) ? els : [els];
  targets.forEach(el => props.forEach(p => el.style.removeProperty(p)));
}

export type WeatherSize = "hero" | "inline" | "forecast";

// ─── Sun ─────────────────────────────────────────────────────────────────────

export function WeatherSunIcon({
  size,
  className = "",
}: {
  size: WeatherSize;
  className?: string;
}) {
  const raysRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (size === "hero" || !raysRef.current) return;
    const el = raysRef.current;
    const anim = animate(el, {
      rotate: "1turn",
      duration: 2000,
      ease: "outExpo",
      onComplete: () => { resetStyles(el, ["transform"]); },
    });
    return () => { anim.pause(); };
  }, [size]);

  const containerClass = size === "hero" ? "h-10 w-10" : size === "forecast" ? "h-7 w-7" : "h-5 w-5";
  const coreClass = size === "hero" ? "h-6 w-6" : size === "forecast" ? "h-4 w-4" : "h-3 w-3";
  const coreShadow = "shadow-[0_0_10px_rgba(251,191,36,0.35)]";
  const longRay =
    size === "hero"
      ? "top-[-2px] h-[8px] w-[2px]"
      : size === "forecast"
      ? "top-[-1.5px] h-[6px] w-[1.5px]"
      : "top-[-1px] h-[4px] w-[1.5px]";
  const shortRay =
    size === "hero"
      ? "top-[2px] h-[4px] w-[2px]"
      : size === "forecast"
      ? "top-[1.5px] h-[3px] w-[1.5px]"
      : "top-[1px] h-[2px] w-[1.5px]";

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center align-middle ${containerClass} ${className}`}
    >
      <span ref={raysRef} className="absolute inset-0">
        {Array.from({ length: 12 }).map((_, i) => (
          <span
            key={`sun-ray-${i}`}
            className="absolute inset-0"
            style={{ transform: `rotate(${i * 30}deg)` }}
          >
            <span
              className={`absolute left-1/2 -translate-x-1/2 rounded-full bg-amber-300 ${
                i % 2 === 0 ? longRay : shortRay
              }`}
            />
          </span>
        ))}
      </span>
      <span className={`relative rounded-full bg-amber-400 ${coreClass} ${coreShadow}`} />
    </span>
  );
}

// ─── Moon ────────────────────────────────────────────────────────────────────

export function WeatherMoonIcon({
  size,
  className = "",
}: {
  size: WeatherSize;
  className?: string;
}) {
  const moonRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (size === "hero" || !moonRef.current) return;
    const el = moonRef.current;
    const anim = animate(el, {
      y: [{ to: -3 }, { to: 0 }],
      duration: 2000,
      ease: "inOutSine",
      onComplete: () => { resetStyles(el, ["transform"]); },
    });
    return () => { anim.pause(); };
  }, [size]);

  if (size !== "hero") {
    const szClass = size === "forecast" ? "text-[22px]" : "text-[18px]";
    return (
      <span
        ref={moonRef}
        className={`material-icons-round inline-block shrink-0 align-middle ${szClass} leading-none ${className}`}
      >
        dark_mode
      </span>
    );
  }

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center align-middle h-10 w-10 ${className}`}
    >
      <span className="relative rounded-full bg-slate-200 dark:bg-slate-100 h-7 w-7 shadow-[0_0_12px_rgba(226,232,240,0.22)]">
        <span className="absolute rounded-full bg-white dark:bg-slate-900 left-[8px] top-[1px] h-6 w-6" />
      </span>
    </span>
  );
}

// ─── Rainy ───────────────────────────────────────────────────────────────────

export function WeatherRainyIcon({
  size,
  className = "",
}: {
  size: WeatherSize;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (size === "hero" || !containerRef.current) return;
    const cloud = containerRef.current.querySelector<HTMLElement>(".wcloud");
    const drops = Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(".wdrop")
    );
    if (!cloud || !drops.length) return;

    const cloudAnim = animate(cloud, {
      x: [{ to: -3 }, { to: 3 }, { to: 0 }],
      duration: 2000,
      ease: "inOutSine",
      onComplete: () => { resetStyles(cloud, ["transform"]); },
    });

    const rainAnim = animate(drops, {
      translateY: [{ from: -4, to: 9, duration: 500 }],
      opacity: [
        { from: 0, to: 1, duration: 100 },
        { to: 1, duration: 300 },
        { to: 0, duration: 100 },
      ],
      loop: 2,
      delay: stagger(150),
      onComplete: () => { resetStyles(drops, ["transform", "opacity"]); },
    });

    return () => { cloudAnim.pause(); rainAnim.pause(); };
  }, [size]);

  if (size === "hero") {
    return (
      <span
        className={`material-symbols-rounded text-6xl text-sky-500 dark:text-sky-400 group-hover:text-sky-600 dark:group-hover:text-sky-300 transition-colors ${className}`}
      >
        rainy
      </span>
    );
  }

  const sz = size === "forecast";
  return (
    <div
      ref={containerRef}
      className={`relative flex items-center justify-center ${sz ? "h-7 w-7" : "mr-1 h-5 w-5"} ${className}`}
    >
      <span className={`material-symbols-rounded wcloud relative z-10 ${sz ? "text-xl" : "text-sm"}`}>cloud</span>
      <div className={`absolute left-1/2 -translate-x-1/2 flex items-center ${sz ? "top-[16px] gap-[3px]" : "top-[12px] gap-[2px]"}`}>
        <div className={`wdrop bg-sky-500 dark:bg-sky-400 rounded-full rotate-[15deg] ${sz ? "w-[2px] h-[8px]" : "w-[1.5px] h-[6px]"}`} />
        <div className={`wdrop bg-sky-500 dark:bg-sky-400 rounded-full rotate-[15deg] ${sz ? "w-[2px] h-[8px] mt-[2px]" : "w-[1.5px] h-[6px] mt-[2px]"}`} />
        <div className={`wdrop bg-sky-500 dark:bg-sky-400 rounded-full rotate-[15deg] ${sz ? "w-[2px] h-[8px]" : "w-[1.5px] h-[6px]"}`} />
      </div>
    </div>
  );
}

// ─── Thunderstorm ────────────────────────────────────────────────────────────

export function WeatherThunderstormIcon({
  size,
  className = "",
}: {
  size: WeatherSize;
  className?: string;
}) {
  const iconRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (size === "hero" || !iconRef.current) return;
    const el = iconRef.current;

    const tl = createTimeline({ autoplay: true });
    tl.add(el, { opacity: 0.05, filter: "drop-shadow(0 0 8px rgba(251,191,36,1))", duration: 60, ease: "linear" }, 600)
      .add(el, { opacity: 1, filter: "drop-shadow(0 0 2px rgba(251,191,36,0.3))", duration: 80, ease: "outQuad" })
      .add(el, { opacity: 0.05, filter: "drop-shadow(0 0 8px rgba(251,191,36,1))", duration: 60, ease: "linear" }, "+=120")
      .add(el, { opacity: 1, filter: "none", duration: 300, ease: "outQuad" });

    return () => { tl.pause(); };
  }, [size]);

  return (
    <span
      ref={iconRef}
      className={`material-symbols-rounded ${
        size === "hero"
          ? "text-6xl text-sky-500 dark:text-sky-400 group-hover:text-sky-600 dark:group-hover:text-sky-300 transition-colors"
          : size === "forecast"
          ? "text-[26px] text-sky-500 dark:text-sky-400 inline-block"
          : "text-sm mr-1 inline-block"
      } ${className}`}
    >
      thunderstorm
    </span>
  );
}

// ─── Snow ────────────────────────────────────────────────────────────────────

export function WeatherSnowIcon({
  size,
  className = "",
}: {
  size: WeatherSize;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (size === "hero" || !containerRef.current) return;
    const cloud = containerRef.current.querySelector<HTMLElement>(".wcloud");
    const flakes = Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(".wflake")
    );
    if (!cloud || !flakes.length) return;

    const cloudAnim = animate(cloud, {
      x: [{ to: -3 }, { to: 3 }, { to: 0 }],
      duration: 2000,
      ease: "inOutSine",
      onComplete: () => { resetStyles(cloud, ["transform"]); },
    });

    const snowAnim = animate(flakes, {
      translateY: [{ from: -3, to: 8, duration: 500 }],
      opacity: [
        { from: 0, to: 1, duration: 100 },
        { to: 1, duration: 300 },
        { to: 0, duration: 100 },
      ],
      scale: [
        { from: 0.6, to: 1.1, duration: 300 },
        { to: 0.9, duration: 200 },
      ],
      loop: 2,
      delay: stagger(200),
      onComplete: () => { resetStyles(flakes, ["transform", "opacity"]); },
    });

    return () => { cloudAnim.pause(); snowAnim.pause(); };
  }, [size]);

  if (size === "hero") {
    return (
      <span
        className={`material-symbols-rounded text-6xl text-sky-500 dark:text-sky-400 group-hover:text-sky-600 dark:group-hover:text-sky-300 transition-colors ${className}`}
      >
        ac_unit
      </span>
    );
  }

  const sz = size === "forecast";
  return (
    <div
      ref={containerRef}
      className={`relative flex items-center justify-center ${sz ? "h-7 w-7" : "mr-1 h-5 w-5"} ${className}`}
    >
      <span className={`material-symbols-rounded wcloud relative z-10 ${sz ? "text-xl" : "text-sm"}`}>cloud</span>
      <div className={`absolute left-1/2 -translate-x-1/2 flex items-center ${sz ? "top-[16px] gap-[3px]" : "top-[12px] gap-[2px]"}`}>
        <div className={`wflake bg-sky-200 dark:bg-sky-100 rounded-full ${sz ? "w-[4px] h-[4px]" : "w-[3px] h-[3px]"}`} />
        <div className={`wflake bg-sky-200 dark:bg-sky-100 rounded-full ${sz ? "w-[4px] h-[4px] mt-[1px]" : "w-[3px] h-[3px] mt-[1px]"}`} />
        <div className={`wflake bg-sky-200 dark:bg-sky-100 rounded-full ${sz ? "w-[4px] h-[4px]" : "w-[3px] h-[3px]"}`} />
      </div>
    </div>
  );
}

// ─── Cloudy ──────────────────────────────────────────────────────────────────

export function WeatherCloudyIcon({
  size,
  className = "",
}: {
  size: WeatherSize;
  className?: string;
}) {
  const cloudRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (size === "hero" || !cloudRef.current) return;
    const el = cloudRef.current;
    const anim = animate(el, {
      x: [{ to: -3 }, { to: 3 }, { to: 0 }],
      duration: 2000,
      ease: "inOutSine",
      onComplete: () => { resetStyles(el, ["transform"]); },
    });
    return () => { anim.pause(); };
  }, [size]);

  return (
    <span
      ref={cloudRef}
      className={`material-symbols-rounded ${
        size === "hero"
          ? "text-6xl text-sky-500 dark:text-sky-400 group-hover:text-sky-600 dark:group-hover:text-sky-300 transition-colors"
          : size === "forecast"
          ? "text-[26px] text-sky-500 dark:text-sky-400 inline-block"
          : "text-sm mr-1 inline-block"
      } ${className}`}
    >
      cloud
    </span>
  );
}
