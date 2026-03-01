export type JournalWaveformEntryKind =
  | "return"
  | "streak"
  | "steady"
  | "bridge"
  | "isolated";

export interface JournalWaveformEntry {
  id: string;
  date: string;
  label: string;
  intensity: number;
  distilled: string;
  streakLength: number;
  gapBefore: number;
  gapAfter: number;
  kind: JournalWaveformEntryKind;
}

interface JournalWaveformSourceEntry {
  date: string;
  name?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function daysBetween(a: string, b: string): number {
  const aDate = new Date(`${a}T12:00:00`);
  const bDate = new Date(`${b}T12:00:00`);
  return Math.round((bDate.getTime() - aDate.getTime()) / 86_400_000);
}

function labelForDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return parsed.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function classifyEntry(
  gapBefore: number,
  gapAfter: number,
  streakLength: number,
): JournalWaveformEntryKind {
  if (gapBefore >= 7) return "return";
  if (streakLength >= 5) return "streak";
  if (gapBefore <= 1 && gapAfter <= 1 && streakLength >= 3) return "steady";
  if (gapBefore >= 3 || gapAfter >= 3) return "bridge";
  return "isolated";
}

function buildDistilledSummary(
  kind: JournalWaveformEntryKind,
  gapBefore: number,
  gapAfter: number,
  streakLength: number,
): string {
  if (kind === "return") {
    if (streakLength >= 3) {
      return `You came back after ${gapBefore} quiet days and kept writing for ${streakLength} days.`;
    }
    return `You came back after ${gapBefore} quiet days.`;
  }

  if (kind === "streak") {
    return `Part of a ${streakLength}-day writing streak.`;
  }

  if (kind === "steady") {
    return "One entry inside a steady stretch of regular journaling.";
  }

  if (kind === "bridge") {
    if (gapBefore >= gapAfter && gapBefore >= 3) {
      return `This note broke a ${gapBefore}-day pause.`;
    }
    if (gapAfter >= 3) {
      return `This note came just before a ${gapAfter}-day quiet stretch.`;
    }
  }

  if (streakLength === 2) {
    return "Part of a brief two-day return to the page.";
  }

  return "A standalone journal check-in.";
}

export function buildJournalWaveformEntries(
  sourceEntries: JournalWaveformSourceEntry[],
  activeDate?: string,
): JournalWaveformEntry[] {
  const sourceMap = new Map<string, JournalWaveformSourceEntry>();
  for (const source of sourceEntries) {
    sourceMap.set(source.date, source);
  }

  if (activeDate && !sourceMap.has(activeDate)) {
    sourceMap.set(activeDate, { date: activeDate, name: labelForDate(activeDate) });
  }

  const sorted = Array.from(sourceMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return [];

  const streakLengths = new Array<number>(sorted.length).fill(1);
  let streakStart = 0;
  for (let index = 1; index <= sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const continues = current ? daysBetween(previous.date, current.date) <= 1 : false;

    if (continues) continue;

    const streakLength = index - streakStart;
    for (let fill = streakStart; fill < index; fill += 1) {
      streakLengths[fill] = streakLength;
    }
    streakStart = index;
  }

  const rawDensity = sorted.map((entry, index) => {
    let total = 0;

    for (let sample = 0; sample < sorted.length; sample += 1) {
      const distance = Math.abs(daysBetween(entry.date, sorted[sample].date));
      if (distance > 21) continue;

      const normalizedDistance = distance / 21;
      const weight = Math.pow(1 - normalizedDistance * normalizedDistance, 2);
      total += weight;
    }

    total += Math.min(0.22, (streakLengths[index] - 1) * 0.035);
    return total;
  });

  const minDensity = Math.min(...rawDensity);
  const maxDensity = Math.max(...rawDensity);
  const densityRange = Math.max(0.0001, maxDensity - minDensity);

  return sorted.map((entry, index) => {
    const gapBefore =
      index === 0 ? 0 : Math.max(0, daysBetween(sorted[index - 1].date, entry.date) - 1);
    const gapAfter =
      index === sorted.length - 1
        ? 0
        : Math.max(0, daysBetween(entry.date, sorted[index + 1].date) - 1);
    const kind = classifyEntry(gapBefore, gapAfter, streakLengths[index]);
    const normalizedDensity = (rawDensity[index] - minDensity) / densityRange;
    const intensity = clamp(
      0.24 + normalizedDensity * 0.52 + Math.min(0.12, (streakLengths[index] - 1) * 0.02),
      0.2,
      0.92,
    );

    return {
      id: entry.date,
      date: entry.date,
      label: entry.name || labelForDate(entry.date),
      intensity,
      distilled: buildDistilledSummary(kind, gapBefore, gapAfter, streakLengths[index]),
      streakLength: streakLengths[index],
      gapBefore,
      gapAfter,
      kind,
    } satisfies JournalWaveformEntry;
  });
}
