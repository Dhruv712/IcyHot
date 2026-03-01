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
  valence: number;
  clarity: number;
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
  life: 138,
  season: 162,
  week: 224,
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

function colorForEmotion(valence: number, clarity: number, intensity: number): string {
  const confidence = clamp(clarity, 0, 1);

  if (valence >= 0.1) {
    const warm = interpolateHcl("#9e8c5d", "#ffbf57")(clamp(0.35 + valence * 0.55 + intensity * 0.18, 0, 1));
    return interpolateHcl("#63666f", warm)(0.25 + confidence * 0.75);
  }

  if (valence <= -0.1) {
    const coolBase = interpolateHcl("#5b6fa7", "#7a70a7")(clamp((1 - confidence) * 0.85, 0, 1));
    const heated = interpolateHcl(coolBase, "#dd6b3f")(clamp(intensity * 0.85, 0, 1));
    return interpolateHcl("#646771", heated)(0.22 + confidence * 0.78);
  }

  const neutral = interpolateHcl("#5d6966", "#88858d")(1 - confidence * 0.8);
  return interpolateHcl("#666871", neutral)(0.3 + confidence * 0.5);
}

function buildAugmentedSamples(entries: JournalWaveformEntry[]): {
  samples: SamplePoint[];
  gaps: GapSegment[];
} {
  if (entries.length === 0) {
    return { samples: [], gaps: [] };
  }

  const samples: SamplePoint[] = [];
  const gaps: GapSegment[] = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const ts = new Date(`${entry.date}T12:00:00`).getTime();
    samples.push({
      ts,
      intensity: entry.intensity,
      valence: entry.valence,
      clarity: entry.clarity,
      entry,
    });

    const next = entries[i + 1];
    if (!next) continue;

    const nextTs = new Date(`${next.date}T12:00:00`).getTime();
    const gapDays = Math.round((nextTs - ts) / DAY_MS);
    if (gapDays >= 3) {
      const taper = Math.min(DAY_MS * 1.5, (nextTs - ts) / 2 - DAY_MS * 0.2);
      const startTs = ts + taper;
      const endTs = nextTs - taper;

      samples.push({
        ts: startTs,
        intensity: 0,
        valence: entry.valence * 0.3,
        clarity: entry.clarity * 0.5,
      });
      samples.push({
        ts: endTs,
        intensity: 0,
        valence: next.valence * 0.3,
        clarity: next.clarity * 0.5,
      });
      gaps.push({ startTs, endTs, days: gapDays });
    }
  }

  samples.sort((a, b) => a.ts - b.ts);
  return { samples, gaps };
}

function getWindowSpan(zoomLevel: ZoomLevel, fullSpan: number): number {
  if (zoomLevel === "life") {
    return Math.max(fullSpan, DAY_MS * 45);
  }
  return WINDOW_DAYS[zoomLevel] * DAY_MS;
}

function clampCenter(centerTs: number, minTs: number, maxTs: number, span: number): number {
  const half = span / 2;
  if (maxTs - minTs <= span) {
    return (minTs + maxTs) / 2;
  }
  return clamp(centerTs, minTs + half, maxTs - half);
}

function findNearestEntry(entries: Array<JournalWaveformEntry & { ts: number }>, targetTs: number) {
  if (entries.length === 0) return null;
  let best = entries[0];
  let bestDistance = Math.abs(entries[0].ts - targetTs);

  for (let i = 1; i < entries.length; i += 1) {
    const distance = Math.abs(entries[i].ts - targetTs);
    if (distance < bestDistance) {
      best = entries[i];
      bestDistance = distance;
    }
  }

  return best;
}

function shiftZoom(current: ZoomLevel, direction: -1 | 1): ZoomLevel {
  const nextIndex = clamp(ZOOM_ORDER.indexOf(current) + direction, 0, ZOOM_ORDER.length - 1);
  return ZOOM_ORDER[nextIndex];
}

export default function JournalWaveformTimeline({
  entries,
  activeEntryId,
  onSelectEntry,
}: JournalWaveformTimelineProps) {
  const gradientId = useId();
  const clipId = useId();
  const textureId = useId();
  const glowId = useId();
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
    x: number;
    y: number;
    visible: boolean;
  }>({ entry: null, x: 0, y: 0, visible: false });

  useEffect(() => {
    const node = outerRef.current;
    if (!node) return undefined;

    const observer = new ResizeObserver((records) => {
      const nextWidth = Math.round(records[0]?.contentRect.width ?? 0);
      if (nextWidth > 0) {
        setViewportWidth(nextWidth);
      }
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { samples, gaps } = useMemo(
    () => buildAugmentedSamples(orderedEntries),
    [orderedEntries],
  );

  const minTs = entriesWithTs[0]?.ts ?? fallbackNow;
  const maxTs = entriesWithTs[entriesWithTs.length - 1]?.ts ?? minTs + DAY_MS;
  const fullDomainStart = minTs - DAY_MS * 3;
  const fullDomainEnd = maxTs + DAY_MS * 3;
  const fullSpan = Math.max(fullDomainEnd - fullDomainStart, DAY_MS * 45);
  const requestedSpan = getWindowSpan(zoomLevel, fullSpan);
  const clampedCenter = clampCenter(centerTs, fullDomainStart, fullDomainEnd, requestedSpan);
  const domainStart = zoomLevel === "life" ? fullDomainStart : clampedCenter - requestedSpan / 2;
  const domainEnd = zoomLevel === "life" ? fullDomainEnd : clampedCenter + requestedSpan / 2;

  const visibleEntries = useMemo(
    () => entriesWithTs.filter((entry) => entry.ts >= domainStart - DAY_MS * 2 && entry.ts <= domainEnd + DAY_MS * 2),
    [domainEnd, domainStart, entriesWithTs],
  );

  const plotWidth = Math.max(240, viewportWidth - 40);
  const frameHeight = collapsed ? 68 : HEIGHT_BY_ZOOM[zoomLevel];
  const labelBandHeight = !collapsed && zoomLevel === "week" ? 86 : 0;
  const waveformHeight = frameHeight - 54 - labelBandHeight;
  const centerY = 18 + waveformHeight / 2;
  const amplitude = waveformHeight * 0.36;
  const xScale = useMemo(
    () => scaleLinear().domain([domainStart, domainEnd]).range([20, plotWidth + 20]),
    [domainEnd, domainStart, plotWidth],
  );

  const areaPath = useMemo(() => {
    if (samples.length === 0) return "";
    const generator = area<SamplePoint>()
      .x((d) => xScale(d.ts))
      .y0((d) => centerY + d.intensity * amplitude)
      .y1((d) => centerY - d.intensity * amplitude)
      .curve(curveCatmullRom.alpha(0.5));
    return generator(samples) ?? "";
  }, [amplitude, centerY, samples, xScale]);

  const crestPath = useMemo(() => {
    if (samples.length === 0) return "";
    const generator = line<SamplePoint>()
      .x((d) => xScale(d.ts))
      .y((d) => centerY - d.intensity * amplitude)
      .curve(curveCatmullRom.alpha(0.5));
    return generator(samples) ?? "";
  }, [amplitude, centerY, samples, xScale]);

  const visibleGapSegments = useMemo(
    () => gaps.filter((gap) => gap.endTs >= domainStart && gap.startTs <= domainEnd),
    [domainEnd, domainStart, gaps],
  );

  const gradientStops = useMemo(() => {
    if (visibleEntries.length === 0) {
      return [
        { offset: "0%", color: "#7d8a8a" },
        { offset: "100%", color: "#7d8a8a" },
      ];
    }

    const span = Math.max(1, domainEnd - domainStart);
    return visibleEntries.map((entry) => ({
      offset: `${clamp(((entry.ts - domainStart) / span) * 100, 0, 100)}%`,
      color: colorForEmotion(entry.valence, entry.clarity, entry.intensity),
    }));
  }, [domainEnd, domainStart, visibleEntries]);

  const currentMarkerX = activeEntry ? xScale(activeEntry.ts) : null;

  const updateScrub = useCallback(
    (clientX: number, clientY: number, forceVisible = false) => {
      if (!outerRef.current || visibleEntries.length === 0) return;
      const bounds = outerRef.current.getBoundingClientRect();
      const relativeX = clamp(clientX - bounds.left, 20, plotWidth + 20);
      const targetTs = domainStart + ((relativeX - 20) / Math.max(1, plotWidth)) * (domainEnd - domainStart);
      const nearest = findNearestEntry(visibleEntries, targetTs);

      setScrubState({
        entry: nearest,
        x: relativeX,
        y: clamp(clientY - bounds.top, 14, frameHeight - 18),
        visible: forceVisible || zoomLevel !== "life",
      });
    },
    [domainEnd, domainStart, frameHeight, plotWidth, visibleEntries, zoomLevel],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startCenterTs: clampedCenter,
        moved: false,
      };
      target.setPointerCapture(event.pointerId);
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
      if (Math.abs(dx) > 4) {
        drag.moved = true;
      }

      if (zoomLevel !== "life" && drag.moved) {
        const span = requestedSpan;
        const nextCenter = drag.startCenterTs - (dx / Math.max(1, plotWidth)) * span;
        setCenterTs(clampCenter(nextCenter, fullDomainStart, fullDomainEnd, span));
      }

      updateScrub(event.clientX, event.clientY, true);
    },
    [fullDomainEnd, fullDomainStart, plotWidth, requestedSpan, updateScrub, zoomLevel],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      if (!drag.moved) {
        const bounds = outerRef.current?.getBoundingClientRect();
        const relativeX = bounds
          ? clamp(event.clientX - bounds.left, 20, plotWidth + 20)
          : 20;
        const targetTs = domainStart + ((relativeX - 20) / Math.max(1, plotWidth)) * (domainEnd - domainStart);
        const nearest = findNearestEntry(visibleEntries, targetTs);

        if (zoomLevel === "life") {
          setCenterTs(targetTs);
          setZoomLevel("season");
        } else if (zoomLevel === "season") {
          setCenterTs(targetTs);
          if (nearest) {
            setZoomLevel("week");
          }
        } else if (zoomLevel === "week" && nearest && onSelectEntry) {
          onSelectEntry(nearest);
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
        ? clamp((event.clientX - bounds.left - 20) / Math.max(1, plotWidth), 0, 1)
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

  const weekLabels = !collapsed && zoomLevel === "week" ? visibleEntries.slice(-10) : [];

  return (
    <div
      ref={outerRef}
      className="relative overflow-hidden rounded-[28px] border border-white/8 bg-[#11161c] shadow-[0_20px_80px_rgba(0,0,0,0.35)] transition-[height,opacity] duration-400"
      style={{
        height: frameHeight,
        backgroundImage:
          "radial-gradient(circle at 20% 20%, rgba(242,184,88,0.12), transparent 35%), radial-gradient(circle at 82% 0%, rgba(92,123,219,0.18), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0))",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onWheel={handleWheel}
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-white/45">
          <span>Inner Weather</span>
          <span className="text-white/20">/</span>
          <span>{zoomLevel}</span>
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
                    ? "bg-white/12 text-white shadow-[0_0_24px_rgba(255,255,255,0.08)]"
                    : "text-white/45 hover:text-white/72"
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
            className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-white/55 transition-colors hover:text-white"
          >
            {collapsed ? "Open" : "Mini"}
          </button>
        </div>
      </div>

      <svg
        width="100%"
        height={frameHeight - 8}
        viewBox={`0 0 ${plotWidth + 40} ${frameHeight - 8}`}
        className="block"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" x2="100%" y1="0%" y2="0%">
            {gradientStops.map((stop, index) => (
              <stop key={`${stop.offset}-${index}`} offset={stop.offset} stopColor={stop.color} />
            ))}
          </linearGradient>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={plotWidth + 40} height={frameHeight - 8} rx="24" />
          </clipPath>
          <pattern id={textureId} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
            <line x1="0" y1="0" x2="0" y2="12" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          </pattern>
          <filter id={glowId} x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="10" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g clipPath={`url(#${clipId})`}>
          <rect x="0" y="0" width={plotWidth + 40} height={frameHeight - 8} fill="rgba(7,10,14,0.22)" />

          {visibleGapSegments.map((gap) => {
            const x = xScale(gap.startTs);
            const width = Math.max(0, xScale(gap.endTs) - x);
            const labelX = x + width / 2;
            return (
              <g key={`${gap.startTs}-${gap.endTs}`}>
                <rect x={x} y={16} width={width} height={waveformHeight + 12} fill="rgba(255,255,255,0.03)" />
                <rect x={x} y={16} width={width} height={waveformHeight + 12} fill={`url(#${textureId})`} opacity={0.32} />
                {gap.days >= 7 && !collapsed && (
                  <text
                    x={labelX}
                    y={centerY + waveformHeight * 0.28}
                    fill="rgba(255,255,255,0.3)"
                    fontSize="10"
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    textAnchor="middle"
                    letterSpacing="0.18em"
                  >
                    {gap.days} days
                  </text>
                )}
              </g>
            );
          })}

          <line x1="20" x2={plotWidth + 20} y1={centerY} y2={centerY} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />

          {areaPath && (
            <>
              <path d={areaPath} fill={`url(#${gradientId})`} opacity={0.86} filter={`url(#${glowId})`} />
              <path d={areaPath} fill="rgba(255,255,255,0.05)" opacity={0.24} />
            </>
          )}

          {crestPath && (
            <path
              d={crestPath}
              fill="none"
              stroke="rgba(255,255,255,0.38)"
              strokeWidth="1.2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {currentMarkerX !== null && (
            <line
              x1={currentMarkerX}
              x2={currentMarkerX}
              y1={12}
              y2={waveformHeight + 22}
              stroke="rgba(255,255,255,0.18)"
              strokeDasharray="3 4"
            />
          )}

          {!collapsed && zoomLevel !== "life" &&
            visibleEntries.map((entry) => {
              const x = xScale(entry.ts);
              const topY = centerY - entry.intensity * amplitude;
              const size = entry.isPivot ? 5.2 : 3.2;
              const color = colorForEmotion(entry.valence, entry.clarity, entry.intensity);
              return (
                <g key={entry.id}>
                  {entry.isPivot && (
                    <line
                      x1={x}
                      x2={x}
                      y1={topY - 16}
                      y2={centerY + entry.intensity * amplitude + 18}
                      stroke="rgba(255,255,255,0.16)"
                      strokeWidth="1"
                    />
                  )}
                  <circle
                    cx={x}
                    cy={topY}
                    r={size}
                    fill={color}
                    stroke={entry.id === activeEntryId ? "rgba(255,255,255,0.82)" : "rgba(255,255,255,0.24)"}
                    strokeWidth={entry.id === activeEntryId ? 1.5 : 0.75}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (zoomLevel === "week") {
                        onSelectEntry?.(entry);
                      } else {
                        setCenterTs(entry.ts);
                        setZoomLevel(shiftZoom(zoomLevel, 1));
                      }
                    }}
                    className="cursor-pointer transition-transform duration-200 hover:scale-110"
                  />
                </g>
              );
            })}

          <text
            x="20"
            y={frameHeight - 20}
            fill="rgba(255,255,255,0.38)"
            fontSize="10"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            letterSpacing="0.16em"
          >
            {formatDate(entriesWithTs[0]?.date ?? "", true)}
          </text>
          <text
            x={plotWidth + 20}
            y={frameHeight - 20}
            fill="rgba(255,255,255,0.38)"
            fontSize="10"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            letterSpacing="0.16em"
            textAnchor="end"
          >
            {formatDate(entriesWithTs[entriesWithTs.length - 1]?.date ?? "", true)}
          </text>
        </g>
      </svg>

      {!collapsed && zoomLevel === "week" && weekLabels.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[88px] px-5">
          {weekLabels.map((entry, index) => {
            const x = xScale(entry.ts);
            const row = index % 2;
            const top = 10 + row * 36;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelectEntry?.(entry)}
                onPointerDown={(event) => event.stopPropagation()}
                className="pointer-events-auto absolute w-[156px] -translate-x-1/2 rounded-2xl border border-white/8 bg-black/25 px-3 py-2 text-left shadow-[0_12px_32px_rgba(0,0,0,0.22)] backdrop-blur-sm transition-transform duration-200 hover:-translate-y-0.5"
                style={{ left: x, top }}
              >
                <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/45">
                  <span>{formatDate(entry.date)}</span>
                  {entry.isPivot && <span className="rounded-full bg-white/8 px-1.5 py-0.5 text-[9px] text-[#ffbf57]">shift</span>}
                </div>
                <div className="line-clamp-2 text-[11px] leading-relaxed text-white/78">{entry.distilled}</div>
              </button>
            );
          })}
        </div>
      )}

      {!collapsed && scrubState.visible && scrubState.entry && (
        <div
          className="pointer-events-none absolute z-10 w-[230px] -translate-x-1/2 rounded-2xl border border-white/10 bg-[#0c1015]/92 px-3 py-3 shadow-[0_18px_40px_rgba(0,0,0,0.35)] backdrop-blur-md"
          style={{
            left: clamp(scrubState.x, 124, plotWidth - 84),
            top: Math.max(36, scrubState.y - 54),
          }}
        >
          <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">
            <span>{formatDate(scrubState.entry.date, true)}</span>
            {scrubState.entry.isPivot && <span className="text-[#ffbf57]">pivot</span>}
          </div>
          <p className="text-xs leading-relaxed text-white/82">{scrubState.entry.distilled}</p>
          <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-white/34">
            <span>{Math.round(scrubState.entry.intensity * 100)} intensity</span>
            <span>{scrubState.entry.wordCount} words</span>
          </div>
        </div>
      )}
    </div>
  );
}
