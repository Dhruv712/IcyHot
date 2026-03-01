"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  area,
  curveCatmullRom,
  interpolateHcl,
  line,
  scaleLinear,
} from "d3";
import type { JournalWaveformEntry } from "@/lib/journalWaveform";

type ZoomLevel = "life" | "season" | "week";

type SamplePoint = {
  ts: number;
  intensity: number;
  entry?: JournalWaveformEntry;
};

type GapSegment = {
  startTs: number;
  endTs: number;
  days: number;
};

interface JournalWaveformTimelineProps {
  entries: JournalWaveformEntry[];
  activeEntryId?: string;
  onSelectEntry?: (entry: JournalWaveformEntry) => void;
}

const DAY_MS = 86_400_000;
const ZOOM_ORDER: ZoomLevel[] = ["life", "season", "week"];
const WINDOW_DAYS: Record<Exclude<ZoomLevel, "life">, number> = {
  season: 96,
  week: 10,
};
const HEIGHT_BY_ZOOM: Record<ZoomLevel, number> = {
  life: 128,
  season: 148,
  week: 214,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatDate(dateStr: string, includeYear = false): string {
  if (!dateStr) return "";
  const date = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  });
}

function amberForIntensity(intensity: number): { color: string; opacity: number } {
  const color = interpolateHcl("#7a5920", "#ffcf73")(clamp(intensity, 0, 1));
  return {
    color,
    opacity: 0.3 + clamp(intensity, 0, 1) * 0.65,
  };
}

function buildSamples(entries: JournalWaveformEntry[], zoomLevel: ZoomLevel): {
  samples: SamplePoint[];
  gaps: GapSegment[];
} {
  if (entries.length === 0) {
    return { samples: [], gaps: [] };
  }

  const raw: SamplePoint[] = [];
  const gaps: GapSegment[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const ts = new Date(`${entry.date}T12:00:00`).getTime();
    raw.push({ ts, intensity: entry.intensity, entry });

    const next = entries[index + 1];
    if (!next) continue;

    const nextTs = new Date(`${next.date}T12:00:00`).getTime();
    const gapDays = Math.round((nextTs - ts) / DAY_MS);
    if (gapDays >= 3) {
      const taper = Math.min(DAY_MS * 1.8, (nextTs - ts) * 0.28);
      const startTs = ts + taper;
      const endTs = nextTs - taper;
      raw.push({ ts: startTs, intensity: 0 });
      raw.push({ ts: endTs, intensity: 0 });
      gaps.push({ startTs, endTs, days: gapDays });
    }
  }

  raw.sort((a, b) => a.ts - b.ts);

  const radius = zoomLevel === "life" ? 6 : zoomLevel === "season" ? 4 : 2;
  const smoothed = raw.map((sample, index) => {
    let totalWeight = 0;
    let total = 0;

    for (let offset = -radius; offset <= radius; offset += 1) {
      const neighbor = raw[index + offset];
      if (!neighbor) continue;
      const weight = radius + 1 - Math.abs(offset);
      total += neighbor.intensity * weight;
      totalWeight += weight;
    }

    return {
      ...sample,
      intensity: totalWeight > 0 ? total / totalWeight : sample.intensity,
    } satisfies SamplePoint;
  });

  return { samples: smoothed, gaps };
}

function getWindowSpan(zoomLevel: ZoomLevel, fullSpan: number): number {
  if (zoomLevel === "life") return Math.max(fullSpan, DAY_MS * 45);
  return WINDOW_DAYS[zoomLevel] * DAY_MS;
}

function clampCenter(centerTs: number, minTs: number, maxTs: number, span: number): number {
  const half = span / 2;
  if (maxTs - minTs <= span) return (minTs + maxTs) / 2;
  return clamp(centerTs, minTs + half, maxTs - half);
}

function findNearestEntry(entries: Array<JournalWaveformEntry & { ts: number }>, targetTs: number) {
  if (entries.length === 0) return null;
  let best = entries[0];
  let bestDistance = Math.abs(entries[0].ts - targetTs);

  for (let index = 1; index < entries.length; index += 1) {
    const distance = Math.abs(entries[index].ts - targetTs);
    if (distance < bestDistance) {
      best = entries[index];
      bestDistance = distance;
    }
  }

  return best;
}

function shiftZoom(current: ZoomLevel, direction: -1 | 1): ZoomLevel {
  return ZOOM_ORDER[clamp(ZOOM_ORDER.indexOf(current) + direction, 0, ZOOM_ORDER.length - 1)];
}

export default function JournalWaveformTimeline({
  entries,
  activeEntryId,
  onSelectEntry,
}: JournalWaveformTimelineProps) {
  const gradientId = useId();
  const clipId = useId();
  const outerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startCenterTs: number;
    moved: boolean;
  } | null>(null);

  const orderedEntries = useMemo(
    () => [...entries].sort((a, b) => a.date.localeCompare(b.date)),
    [entries],
  );
  const entriesWithTs = useMemo(
    () => orderedEntries.map((entry) => ({ ...entry, ts: new Date(`${entry.date}T12:00:00`).getTime() })),
    [orderedEntries],
  );
  const activeEntry = useMemo(
    () => entriesWithTs.find((entry) => entry.id === activeEntryId) ?? entriesWithTs[entriesWithTs.length - 1] ?? null,
    [activeEntryId, entriesWithTs],
  );

  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("season");
  const [collapsed, setCollapsed] = useState(false);
  const [fallbackNow] = useState(() => Date.now());
  const [centerTs, setCenterTs] = useState<number>(() => activeEntry?.ts ?? Date.now());
  const [viewportWidth, setViewportWidth] = useState(0);
  const [scrubState, setScrubState] = useState<{
    entry: (JournalWaveformEntry & { ts: number }) | null;
    gap: GapSegment | null;
    x: number;
    y: number;
    visible: boolean;
  }>({ entry: null, gap: null, x: 0, y: 0, visible: false });

  useEffect(() => {
    const node = outerRef.current;
    if (!node) return undefined;

    const observer = new ResizeObserver((records) => {
      const nextWidth = Math.round(records[0]?.contentRect.width ?? 0);
      if (nextWidth > 0) setViewportWidth(nextWidth);
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const minTs = entriesWithTs[0]?.ts ?? fallbackNow;
  const maxTs = entriesWithTs[entriesWithTs.length - 1]?.ts ?? minTs + DAY_MS;
  const fullDomainStart = minTs - DAY_MS * 3;
  const fullDomainEnd = maxTs + DAY_MS * 3;
  const fullSpan = Math.max(fullDomainEnd - fullDomainStart, DAY_MS * 45);
  const requestedSpan = getWindowSpan(zoomLevel, fullSpan);
  const clampedCenter = clampCenter(centerTs, fullDomainStart, fullDomainEnd, requestedSpan);
  const domainStart = zoomLevel === "life" ? fullDomainStart : clampedCenter - requestedSpan / 2;
  const domainEnd = zoomLevel === "life" ? fullDomainEnd : clampedCenter + requestedSpan / 2;

  const { samples, gaps } = useMemo(
    () => buildSamples(orderedEntries, zoomLevel),
    [orderedEntries, zoomLevel],
  );

  const visibleEntries = useMemo(
    () => entriesWithTs.filter((entry) => entry.ts >= domainStart - DAY_MS * 2 && entry.ts <= domainEnd + DAY_MS * 2),
    [domainEnd, domainStart, entriesWithTs],
  );
  const visibleGaps = useMemo(
    () => gaps.filter((gap) => gap.endTs >= domainStart && gap.startTs <= domainEnd),
    [domainEnd, domainStart, gaps],
  );

  const plotWidth = Math.max(260, viewportWidth - 44);
  const frameHeight = collapsed ? 64 : HEIGHT_BY_ZOOM[zoomLevel];
  const labelBandHeight = !collapsed && zoomLevel === "week" ? 88 : 0;
  const chartTop = 18;
  const waveformHeight = Math.max(24, frameHeight - 48 - labelBandHeight);
  const baselineY = chartTop + waveformHeight;
  const amplitude = waveformHeight * 0.78;

  const xScale = useMemo(
    () => scaleLinear().domain([domainStart, domainEnd]).range([22, plotWidth + 22]),
    [domainEnd, domainStart, plotWidth],
  );

  const areaPath = useMemo(() => {
    if (samples.length === 0) return "";
    const generator = area<SamplePoint>()
      .x((sample) => xScale(sample.ts))
      .y0(baselineY)
      .y1((sample) => baselineY - sample.intensity * amplitude)
      .curve(curveCatmullRom.alpha(0.18));
    return generator(samples) ?? "";
  }, [amplitude, baselineY, samples, xScale]);

  const ridgePath = useMemo(() => {
    if (samples.length === 0) return "";
    const generator = line<SamplePoint>()
      .x((sample) => xScale(sample.ts))
      .y((sample) => baselineY - sample.intensity * amplitude)
      .curve(curveCatmullRom.alpha(0.18));
    return generator(samples) ?? "";
  }, [amplitude, baselineY, samples, xScale]);

  const gradientStops = useMemo(() => {
    if (visibleEntries.length === 0) {
      const fallback = amberForIntensity(0.4);
      return [{ offset: "0%", ...fallback }, { offset: "100%", ...fallback }];
    }

    const span = Math.max(1, domainEnd - domainStart);
    return visibleEntries.map((entry) => {
      const amber = amberForIntensity(entry.intensity);
      return {
        offset: `${clamp(((entry.ts - domainStart) / span) * 100, 0, 100)}%`,
        ...amber,
      };
    });
  }, [domainEnd, domainStart, visibleEntries]);

  const updateScrub = useCallback(
    (clientX: number, clientY: number, forceVisible = false) => {
      if (!outerRef.current) return;
      const bounds = outerRef.current.getBoundingClientRect();
      const relativeX = clamp(clientX - bounds.left, 22, plotWidth + 22);
      const targetTs = domainStart + ((relativeX - 22) / Math.max(1, plotWidth)) * (domainEnd - domainStart);
      const gap = visibleGaps.find((item) => targetTs >= item.startTs && targetTs <= item.endTs) ?? null;
      const nearest = gap ? null : findNearestEntry(visibleEntries, targetTs);

      setScrubState({
        entry: nearest,
        gap,
        x: relativeX,
        y: clamp(clientY - bounds.top, 12, baselineY),
        visible: forceVisible || zoomLevel !== "life",
      });
    },
    [baselineY, domainEnd, domainStart, plotWidth, visibleEntries, visibleGaps, zoomLevel],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startCenterTs: clampedCenter,
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      updateScrub(event.clientX, event.clientY, true);
    },
    [clampedCenter, updateScrub],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        if (zoomLevel !== "life") {
          updateScrub(event.clientX, event.clientY);
        }
        return;
      }

      const dx = event.clientX - drag.startX;
      if (Math.abs(dx) > 4) drag.moved = true;

      if (zoomLevel !== "life" && drag.moved) {
        const nextCenter = drag.startCenterTs - (dx / Math.max(1, plotWidth)) * requestedSpan;
        setCenterTs(clampCenter(nextCenter, fullDomainStart, fullDomainEnd, requestedSpan));
      }

      updateScrub(event.clientX, event.clientY, true);
    },
    [fullDomainEnd, fullDomainStart, plotWidth, requestedSpan, updateScrub, zoomLevel],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      const bounds = outerRef.current?.getBoundingClientRect();
      const relativeX = bounds
        ? clamp(event.clientX - bounds.left, 22, plotWidth + 22)
        : 22;
      const targetTs = domainStart + ((relativeX - 22) / Math.max(1, plotWidth)) * (domainEnd - domainStart);
      const nearest = findNearestEntry(visibleEntries, targetTs);

      if (!drag.moved) {
        if (zoomLevel === "life") {
          setCenterTs(targetTs);
          setZoomLevel("season");
        } else if (zoomLevel === "season") {
          setCenterTs(targetTs);
          setZoomLevel("week");
        } else if (zoomLevel === "week" && nearest) {
          onSelectEntry?.(nearest);
        }
      }

      dragStateRef.current = null;
      if (zoomLevel === "life") {
        setScrubState((current) => ({ ...current, visible: false }));
      }
    },
    [domainEnd, domainStart, onSelectEntry, plotWidth, visibleEntries, zoomLevel],
  );

  const handlePointerLeave = useCallback(() => {
    if (!dragStateRef.current) {
      setScrubState((current) => ({ ...current, visible: false }));
    }
  }, []);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (visibleEntries.length === 0) return;
      event.preventDefault();

      if ((event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) && zoomLevel !== "life") {
        const nextCenter = clampedCenter + (event.deltaX / Math.max(1, plotWidth)) * requestedSpan;
        setCenterTs(clampCenter(nextCenter, fullDomainStart, fullDomainEnd, requestedSpan));
        return;
      }

      const nextZoom = shiftZoom(zoomLevel, event.deltaY < 0 ? 1 : -1);
      if (nextZoom === zoomLevel) return;

      const bounds = outerRef.current?.getBoundingClientRect();
      const pointerRatio = bounds
        ? clamp((event.clientX - bounds.left - 22) / Math.max(1, plotWidth), 0, 1)
        : 0.5;
      const focusTs = domainStart + pointerRatio * (domainEnd - domainStart);
      const nextSpan = getWindowSpan(nextZoom, fullSpan);

      setZoomLevel(nextZoom);
      setCenterTs(clampCenter(focusTs, fullDomainStart, fullDomainEnd, nextSpan));
    },
    [
      clampedCenter,
      domainEnd,
      domainStart,
      fullDomainEnd,
      fullDomainStart,
      fullSpan,
      plotWidth,
      requestedSpan,
      visibleEntries.length,
      zoomLevel,
    ],
  );

  const weekEntries = !collapsed && zoomLevel === "week" ? visibleEntries.slice(-8) : [];
  const baselineColor = "rgba(255, 209, 128, 0.14)";

  return (
    <div
      ref={outerRef}
      className="relative overflow-hidden rounded-[28px] border border-white/8 bg-[#12161b] shadow-[0_18px_60px_rgba(0,0,0,0.32)] transition-[height,opacity] duration-400"
      style={{
        height: frameHeight,
        backgroundImage:
          "radial-gradient(circle at 18% 12%, rgba(255,191,87,0.12), transparent 32%), linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0))",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onWheel={handleWheel}
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/36">
          Terrain
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-full border border-white/10 bg-white/5 p-1">
            {ZOOM_ORDER.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setZoomLevel(level)}
                onPointerDown={(event) => event.stopPropagation()}
                className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] transition-all ${
                  zoomLevel === level
                    ? "bg-[rgba(255,191,87,0.16)] text-[#ffd18a]"
                    : "text-white/40 hover:text-white/68"
                }`}
              >
                {level}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            onPointerDown={(event) => event.stopPropagation()}
            className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-white/50 transition-colors hover:text-white"
          >
            {collapsed ? "Open" : "Mini"}
          </button>
        </div>
      </div>

      <svg
        width="100%"
        height={frameHeight - 8}
        viewBox={`0 0 ${plotWidth + 44} ${frameHeight - 8}`}
        className="block"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" x2="100%" y1="0%" y2="0%">
            {gradientStops.map((stop, index) => (
              <stop
                key={`${stop.offset}-${index}`}
                offset={stop.offset}
                stopColor={stop.color}
                stopOpacity={stop.opacity}
              />
            ))}
          </linearGradient>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={plotWidth + 44} height={frameHeight - 8} rx="24" />
          </clipPath>
        </defs>

        <g clipPath={`url(#${clipId})`}>
          <rect x="0" y="0" width={plotWidth + 44} height={frameHeight - 8} fill="rgba(7,10,14,0.18)" />
          <line x1="22" x2={plotWidth + 22} y1={baselineY} y2={baselineY} stroke={baselineColor} strokeWidth="1" />

          {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} opacity={0.92} />}
          {ridgePath && (
            <path
              d={ridgePath}
              fill="none"
              stroke="#f0ba63"
              strokeOpacity="0.82"
              strokeWidth="1.6"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {!collapsed && zoomLevel === "week" &&
            visibleEntries.map((entry) => {
              const x = xScale(entry.ts);
              const y = baselineY - entry.intensity * amplitude;
              return (
                <circle
                  key={entry.id}
                  cx={x}
                  cy={y}
                  r={2.35}
                  fill="#f3c46f"
                  fillOpacity={0.88}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectEntry?.(entry);
                  }}
                  className="cursor-pointer"
                />
              );
            })}
        </g>
      </svg>

      {!collapsed && zoomLevel === "week" && weekEntries.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[88px] px-5">
          {weekEntries.map((entry, index) => {
            const x = xScale(entry.ts);
            const row = index % 2;
            const top = 10 + row * 38;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelectEntry?.(entry)}
                onPointerDown={(event) => event.stopPropagation()}
                className="pointer-events-auto absolute w-[154px] -translate-x-1/2 rounded-2xl border border-white/8 bg-black/24 px-3 py-2 text-left shadow-[0_10px_28px_rgba(0,0,0,0.2)] backdrop-blur-sm transition-transform duration-200 hover:-translate-y-0.5"
                style={{ left: x, top }}
              >
                <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
                  {formatDate(entry.date)}
                </div>
                <div className="line-clamp-2 text-[11px] leading-relaxed text-white/78">{entry.distilled}</div>
              </button>
            );
          })}
        </div>
      )}

      {!collapsed && scrubState.visible && (scrubState.entry || scrubState.gap) && (
        <div
          className="pointer-events-none absolute z-10 w-[220px] -translate-x-1/2 rounded-2xl border border-white/10 bg-[#0d1116]/94 px-3 py-3 shadow-[0_16px_38px_rgba(0,0,0,0.34)] backdrop-blur-md"
          style={{
            left: clamp(scrubState.x, 118, plotWidth - 72),
            top: Math.max(30, scrubState.y - 52),
          }}
        >
          {scrubState.gap ? (
            <>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/44">
                Quiet stretch
              </div>
              <p className="text-xs leading-relaxed text-white/78">
                {scrubState.gap.days} days without an entry.
              </p>
            </>
          ) : scrubState.entry ? (
            <>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/44">
                {formatDate(scrubState.entry.date, true)}
              </div>
              <p className="text-xs leading-relaxed text-white/82">{scrubState.entry.distilled}</p>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
