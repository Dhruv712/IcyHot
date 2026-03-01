"use client";

import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { area, curveMonotoneX, line, scaleLinear } from "d3";
import type { JournalWaveformEntry } from "@/lib/journalWaveform";

type ZoomLevel = "life" | "season" | "week";

type SamplePoint = {
  ts: number;
  intensity: number;
};

type GapSegment = {
  startTs: number;
  endTs: number;
  days: number;
};

type TimelineEntry = JournalWaveformEntry & { ts: number };

interface JournalWaveformTimelineProps {
  entries: JournalWaveformEntry[];
  activeEntryId?: string;
  onSelectEntry?: (entry: JournalWaveformEntry) => void;
}

const DAY_MS = 86_400_000;
const ZOOM_ORDER: ZoomLevel[] = ["life", "season", "week"];
const WINDOW_DAYS: Record<Exclude<ZoomLevel, "life">, number> = {
  season: 96,
  week: 14,
};
const HEIGHT_BY_ZOOM: Record<ZoomLevel, number> = {
  life: 110,
  season: 124,
  week: 146,
};
const BANDWIDTH_DAYS: Record<ZoomLevel, number> = {
  life: 18,
  season: 9,
  week: 1.8,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toMiddayTs(date: string): number {
  return new Date(`${date}T12:00:00`).getTime();
}

function formatDate(dateStr: string, includeYear = false): string {
  const date = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  });
}

function formatWindowLabel(startTs: number, endTs: number): string {
  const start = new Date(startTs);
  const end = new Date(endTs);
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();

  if (sameMonth) {
    return `${start.toLocaleDateString("en-US", {
      month: "short",
    })} ${start.getDate()}-${end.getDate()}, ${start.getFullYear()}`;
  }

  return `${start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })} - ${end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

function kernel(distanceDays: number, bandwidthDays: number): number {
  const normalized = Math.abs(distanceDays) / bandwidthDays;
  if (normalized >= 1) return 0;
  const falloff = 1 - normalized * normalized;
  return falloff * falloff;
}

function buildDensitySamples(
  entries: TimelineEntry[],
  domainStart: number,
  domainEnd: number,
  plotWidth: number,
  zoomLevel: ZoomLevel,
): SamplePoint[] {
  if (entries.length === 0) return [];

  const bandwidth = BANDWIDTH_DAYS[zoomLevel];
  const sampleCount = clamp(
    Math.round(plotWidth / (zoomLevel === "week" ? 5 : 6)),
    zoomLevel === "life" ? 90 : 110,
    220,
  );

  const raw = Array.from({ length: sampleCount }, (_, index) => {
    const ratio = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    const ts = domainStart + ratio * (domainEnd - domainStart);
    let total = 0;

    for (const entry of entries) {
      const distanceDays = (entry.ts - ts) / DAY_MS;
      total += entry.intensity * kernel(distanceDays, bandwidth);
    }

    return { ts, intensity: total };
  });

  const maxIntensity = raw.reduce((best, point) => Math.max(best, point.intensity), 0.0001);

  return raw.map((point) => ({
    ts: point.ts,
    intensity: Math.pow(point.intensity / maxIntensity, zoomLevel === "life" ? 0.88 : 0.8),
  }));
}

function buildGaps(entries: TimelineEntry[]): GapSegment[] {
  const gaps: GapSegment[] = [];

  for (let index = 0; index < entries.length - 1; index += 1) {
    const current = entries[index];
    const next = entries[index + 1];
    const gapDays = Math.max(0, Math.round((next.ts - current.ts) / DAY_MS) - 1);

    if (gapDays >= 3) {
      gaps.push({
        startTs: current.ts + DAY_MS,
        endTs: next.ts - DAY_MS,
        days: gapDays,
      });
    }
  }

  return gaps;
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

function shiftZoom(current: ZoomLevel, direction: -1 | 1): ZoomLevel {
  return ZOOM_ORDER[clamp(ZOOM_ORDER.indexOf(current) + direction, 0, ZOOM_ORDER.length - 1)];
}

function describeEntry(entry: TimelineEntry): string {
  if (entry.kind === "return") return `${entry.distilled} A good place to revisit after time away.`;
  if (entry.kind === "streak") return `${entry.distilled} This was part of a sustained stretch.`;
  if (entry.kind === "steady") return `${entry.distilled} The rhythm stayed consistent here.`;
  if (entry.kind === "bridge") return `${entry.distilled} It marks a transition in your journaling cadence.`;
  return entry.distilled;
}

function findNearestEntry(entries: TimelineEntry[], targetTs: number): TimelineEntry | null {
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

function getHistorySummary(entries: TimelineEntry[]): string {
  if (entries.length === 0) return "No journal history yet.";

  const longestStreak = entries.reduce((best, entry) => Math.max(best, entry.streakLength), 1);
  const longestGap = entries.reduce(
    (best, entry) => Math.max(best, entry.gapBefore, entry.gapAfter),
    0,
  );
  const start = formatDate(entries[0].date, true);
  const end = formatDate(entries[entries.length - 1].date, true);

  return `${entries.length} entries from ${start} to ${end}. Longest streak ${longestStreak} day${longestStreak === 1 ? "" : "s"}${longestGap > 0 ? `, longest gap ${longestGap} days.` : "."}`;
}

export default function JournalWaveformTimeline({
  entries,
  activeEntryId,
  onSelectEntry,
}: JournalWaveformTimelineProps) {
  const gradientId = useId();
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
  const entriesWithTs = useMemo<TimelineEntry[]>(
    () => orderedEntries.map((entry) => ({ ...entry, ts: toMiddayTs(entry.date) })),
    [orderedEntries],
  );
  const activeEntry = useMemo(
    () =>
      entriesWithTs.find((entry) => entry.id === activeEntryId) ??
      entriesWithTs[entriesWithTs.length - 1] ??
      null,
    [activeEntryId, entriesWithTs],
  );

  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("season");
  const [collapsed, setCollapsed] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [fallbackNow] = useState(() => Date.now());
  const [centerTs, setCenterTs] = useState<number>(() => activeEntry?.ts ?? Date.now());
  const [scrubState, setScrubState] = useState<{
    entry: TimelineEntry | null;
    gap: GapSegment | null;
    x: number;
    visible: boolean;
  }>({
    entry: null,
    gap: null,
    x: 0,
    visible: false,
  });

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

  const plotWidth = Math.max(260, viewportWidth - 32);
  const frameHeight = collapsed ? 58 : HEIGHT_BY_ZOOM[zoomLevel];
  const topInset = 16;
  const footerHeight = collapsed ? 0 : 40;
  const chartHeight = Math.max(24, frameHeight - topInset - footerHeight - 18);
  const baselineY = topInset + chartHeight;
  const amplitude = chartHeight * (zoomLevel === "week" ? 0.82 : 0.76);

  const xScale = useMemo(
    () => scaleLinear().domain([domainStart, domainEnd]).range([16, plotWidth + 16]),
    [domainEnd, domainStart, plotWidth],
  );

  const visibleEntries = useMemo(
    () => entriesWithTs.filter((entry) => entry.ts >= domainStart && entry.ts <= domainEnd),
    [domainEnd, domainStart, entriesWithTs],
  );
  const allGaps = useMemo(() => buildGaps(entriesWithTs), [entriesWithTs]);
  const visibleGaps = useMemo(
    () => allGaps.filter((gap) => gap.endTs >= domainStart && gap.startTs <= domainEnd),
    [allGaps, domainEnd, domainStart],
  );
  const samples = useMemo(
    () => buildDensitySamples(entriesWithTs, domainStart, domainEnd, plotWidth, zoomLevel),
    [domainEnd, domainStart, entriesWithTs, plotWidth, zoomLevel],
  );

  const areaPath = useMemo(() => {
    if (samples.length === 0) return "";
    const generator = area<SamplePoint>()
      .x((sample) => xScale(sample.ts))
      .y0(baselineY)
      .y1((sample) => baselineY - sample.intensity * amplitude)
      .curve(curveMonotoneX);
    return generator(samples) ?? "";
  }, [amplitude, baselineY, samples, xScale]);

  const ridgePath = useMemo(() => {
    if (samples.length === 0) return "";
    const generator = line<SamplePoint>()
      .x((sample) => xScale(sample.ts))
      .y((sample) => baselineY - sample.intensity * amplitude)
      .curve(curveMonotoneX);
    return generator(samples) ?? "";
  }, [amplitude, baselineY, samples, xScale]);

  const updateScrub = useCallback(
    (clientX: number) => {
      if (!outerRef.current) return;
      const bounds = outerRef.current.getBoundingClientRect();
      const x = clamp(clientX - bounds.left, 16, plotWidth + 16);
      const targetTs =
        domainStart + ((x - 16) / Math.max(1, plotWidth)) * (domainEnd - domainStart);
      const gap =
        visibleGaps.find((item) => targetTs >= item.startTs && targetTs <= item.endTs) ?? null;

      setScrubState({
        entry: gap ? null : findNearestEntry(visibleEntries, targetTs),
        gap,
        x,
        visible: zoomLevel !== "life" || collapsed,
      });
    },
    [collapsed, domainEnd, domainStart, plotWidth, visibleEntries, visibleGaps, zoomLevel],
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
      updateScrub(event.clientX);
    },
    [clampedCenter, updateScrub],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        updateScrub(event.clientX);
        return;
      }

      const dx = event.clientX - drag.startX;
      if (Math.abs(dx) > 4) drag.moved = true;

      if (zoomLevel !== "life" && drag.moved) {
        const nextCenter = drag.startCenterTs - (dx / Math.max(1, plotWidth)) * requestedSpan;
        setCenterTs(clampCenter(nextCenter, fullDomainStart, fullDomainEnd, requestedSpan));
      }

      updateScrub(event.clientX);
    },
    [
      fullDomainEnd,
      fullDomainStart,
      plotWidth,
      requestedSpan,
      updateScrub,
      zoomLevel,
    ],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      const bounds = outerRef.current?.getBoundingClientRect();
      const x = bounds ? clamp(event.clientX - bounds.left, 16, plotWidth + 16) : 16;
      const targetTs =
        domainStart + ((x - 16) / Math.max(1, plotWidth)) * (domainEnd - domainStart);
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
    },
    [domainEnd, domainStart, onSelectEntry, plotWidth, visibleEntries, zoomLevel],
  );

  const handlePointerLeave = useCallback(() => {
    if (!dragStateRef.current) {
      setScrubState((current) => ({ ...current, visible: false }));
    }
  }, []);

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (entriesWithTs.length === 0) return;
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
        ? clamp((event.clientX - bounds.left - 16) / Math.max(1, plotWidth), 0, 1)
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
      entriesWithTs.length,
      fullDomainEnd,
      fullDomainStart,
      fullSpan,
      plotWidth,
      requestedSpan,
      zoomLevel,
    ],
  );

  const activeVisibleEntry = activeEntry
    ? visibleEntries.find((entry) => entry.id === activeEntry.id) ?? null
    : null;
  const detailEntry = scrubState.entry ?? activeVisibleEntry ?? activeEntry;
  const historySummary = useMemo(() => getHistorySummary(entriesWithTs), [entriesWithTs]);
  const detailTitle = scrubState.gap
    ? "Quiet stretch"
    : detailEntry
      ? formatDate(detailEntry.date, true)
      : "Journal rhythm";
  const detailBody = scrubState.gap
    ? `${scrubState.gap.days} days without a saved entry.`
    : detailEntry
      ? describeEntry(detailEntry)
      : historySummary;

  return (
    <div
      ref={outerRef}
      className="relative overflow-hidden rounded-[24px] border border-white/8 bg-[#101418] shadow-[0_14px_44px_rgba(0,0,0,0.28)]"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onWheel={handleWheel}
    >
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/34">
            Rhythm
          </div>
          {!collapsed && (
            <div className="mt-1 text-[11px] text-white/42">
              {formatWindowLabel(domainStart, domainEnd)}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-full border border-white/10 bg-white/[0.03] p-1">
            {ZOOM_ORDER.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setZoomLevel(level)}
                onPointerDown={(event) => event.stopPropagation()}
                className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
                  zoomLevel === level
                    ? "bg-[rgba(237,184,101,0.14)] text-[#e7b764]"
                    : "text-white/38 hover:text-white/65"
                }`}
              >
                {level === "life" ? "All" : level === "season" ? "90d" : "14d"}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            onPointerDown={(event) => event.stopPropagation()}
            className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/42 transition-colors hover:text-white/72"
          >
            {collapsed ? "Open" : "Mini"}
          </button>
        </div>
      </div>

      <svg
        width="100%"
        height={frameHeight}
        viewBox={`0 0 ${plotWidth + 32} ${frameHeight}`}
        className="block"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" x2="0%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="#edb865" stopOpacity="0.38" />
            <stop offset="72%" stopColor="#edb865" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#edb865" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width={plotWidth + 32} height={frameHeight} fill="#101418" />
        <line
          x1="16"
          x2={plotWidth + 16}
          y1={baselineY}
          y2={baselineY}
          stroke="rgba(237,184,101,0.14)"
          strokeWidth="1"
        />

        {scrubState.visible && (
          <line
            x1={scrubState.x}
            x2={scrubState.x}
            y1={topInset - 2}
            y2={baselineY}
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="1"
            strokeDasharray="3 4"
          />
        )}

        {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}
        {ridgePath && (
          <path
            d={ridgePath}
            fill="none"
            stroke="#edb865"
            strokeOpacity="0.9"
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {activeVisibleEntry && (
          <>
            <line
              x1={xScale(activeVisibleEntry.ts)}
              x2={xScale(activeVisibleEntry.ts)}
              y1={baselineY}
              y2={baselineY - activeVisibleEntry.intensity * amplitude - 10}
              stroke="rgba(237,184,101,0.3)"
              strokeWidth="1"
            />
            <circle
              cx={xScale(activeVisibleEntry.ts)}
              cy={baselineY - activeVisibleEntry.intensity * amplitude}
              r="2.8"
              fill="#edb865"
              fillOpacity="0.9"
            />
          </>
        )}

        {!collapsed &&
          zoomLevel === "week" &&
          visibleEntries.map((entry) => {
            const x = xScale(entry.ts);
            const y = baselineY - entry.intensity * amplitude;
            const isActive = activeVisibleEntry?.id === entry.id;

            return (
              <circle
                key={entry.id}
                cx={x}
                cy={y}
                r={isActive ? 3.2 : 2.2}
                fill="#edb865"
                fillOpacity={isActive ? 0.92 : 0.72}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectEntry?.(entry);
                }}
                className="cursor-pointer"
              />
            );
          })}
      </svg>

      {!collapsed && (
        <div className="flex flex-col gap-2 border-t border-white/6 px-4 py-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/34">
              {detailTitle}
            </div>
            <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-white/74">
              {detailBody}
            </p>
          </div>

          <div className="flex items-center gap-3 text-[10px] text-white/36 md:justify-end">
            <span className="font-mono uppercase tracking-[0.16em]">
              {zoomLevel === "life" ? "Click to zoom in" : zoomLevel === "season" ? "Drag to browse" : "Click a point to open"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
