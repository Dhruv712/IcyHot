export interface JournalWaveformEntry {
  id: string;
  date: string;
  intensity: number;
  valence: number;
  clarity: number;
  distilled: string;
  isPivot: boolean;
  wordCount: number;
}

interface JournalWaveformSourceEntry {
  date: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hash01(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

function pick<T>(items: readonly T[], seed: string): T {
  const index = Math.floor(hash01(seed) * items.length) % items.length;
  return items[index];
}

function buildNarrativeArc(t: number): {
  valence: number;
  intensity: number;
  clarity: number;
  chapter: "descent" | "friction" | "repair" | "plateau" | "breakthrough";
} {
  if (t < 0.18) {
    const local = t / 0.18;
    return {
      valence: 0.28 - local * 0.7,
      intensity: 0.42 + local * 0.18,
      clarity: 0.55 - local * 0.08,
      chapter: "descent",
    };
  }

  if (t < 0.42) {
    const local = (t - 0.18) / 0.24;
    return {
      valence: -0.4 - local * 0.18,
      intensity: 0.64 + Math.sin(local * Math.PI) * 0.18,
      clarity: 0.36 + local * 0.12,
      chapter: "friction",
    };
  }

  if (t < 0.66) {
    const local = (t - 0.42) / 0.24;
    return {
      valence: -0.22 + local * 0.62,
      intensity: 0.52 - local * 0.12,
      clarity: 0.48 + local * 0.22,
      chapter: "repair",
    };
  }

  if (t < 0.88) {
    const local = (t - 0.66) / 0.22;
    return {
      valence: 0.18 + Math.sin(local * Math.PI) * 0.16,
      intensity: 0.34 + local * 0.1,
      clarity: 0.62 + local * 0.08,
      chapter: "plateau",
    };
  }

  const local = (t - 0.88) / 0.12;
  return {
    valence: 0.24 + local * 0.38,
    intensity: 0.58 + Math.sin(local * Math.PI) * 0.22,
    clarity: 0.68 + local * 0.14,
    chapter: "breakthrough",
  };
}

function buildDistilledSummary(
  date: string,
  chapter: "descent" | "friction" | "repair" | "plateau" | "breakthrough",
  valence: number,
  intensity: number,
  clarity: number,
): string {
  const subjects = [
    "the relationship",
    "work and ambition",
    "the version of you that performs",
    "what you owe your future self",
    "the story you keep telling about intimacy",
    "why the week felt heavier than it looked",
    "how much of this is instinct versus fear",
    "the cost of being endlessly available",
    "whether the excitement is real or borrowed",
    "what changed when you stopped over-explaining",
  ] as const;

  const pivots = [
    "something small suddenly felt definitive",
    "the energy turned before the facts did",
    "you noticed the tension instead of narrating around it",
    "one line from the day kept echoing after everything else faded",
    "the emotional weather shifted faster than the plan did",
  ] as const;

  const actions = [
    "asked for less performance and more honesty",
    "stopped trying to smooth the contradiction away",
    "kept circling the same unresolved question",
    "felt the relief of naming what had been blurry",
    "recognized the pattern before it could hide again",
    "saw the tradeoff more clearly than usual",
    "realized the feeling was older than today's event",
  ] as const;

  const subject = pick(subjects, `${date}:subject`);
  const pivot = pick(pivots, `${date}:pivot`);
  const action = pick(actions, `${date}:action`);

  if (chapter === "friction") {
    if (clarity < 0.45) {
      return `You were tangled up in ${subject}, and it was hard to tell whether the tension was signal or static.`;
    }
    return `You hit a charged edge around ${subject} and ${action}.`;
  }

  if (chapter === "repair") {
    return `A gentler reading of ${subject} emerged once you ${action}.`;
  }

  if (chapter === "plateau") {
    return intensity < 0.4
      ? `The day stayed quiet, but ${subject} kept glowing underneath it.`
      : `There was steadiness here: ${subject} felt less dramatic and more true.`;
  }

  if (chapter === "breakthrough") {
    return valence > 0.45
      ? `A real lift arrived around ${subject}; ${pivot}.`
      : `The breakthrough was mixed, but ${action} changed the shape of ${subject}.`;
  }

  return `You were on the way into a deeper chapter with ${subject}, and ${pivot}.`;
}

export function buildJournalWaveformEntries(
  sourceEntries: JournalWaveformSourceEntry[],
  activeDate?: string,
): JournalWaveformEntry[] {
  const dateSet = new Set(sourceEntries.map((entry) => entry.date));
  if (activeDate) dateSet.add(activeDate);

  const dates = Array.from(dateSet).sort((a, b) => a.localeCompare(b));
  if (dates.length === 0) return [];

  const total = Math.max(1, dates.length - 1);
  return dates.map((date, index) => {
    const t = index / total;
    const arc = buildNarrativeArc(t);
    const longWave = Math.sin(t * Math.PI * 2.4 + hash01(`${date}:season`) * 1.4) * 0.07;
    const jitter = (hash01(`${date}:jitter`) - 0.5) * 0.08;
    const pressure = (hash01(`${date}:pressure`) - 0.5) * 0.09;

    const valence = clamp(arc.valence + longWave + jitter, -1, 1);
    const intensity = clamp(
      arc.intensity + Math.abs(longWave) * 0.08 + pressure + (1 - Math.abs(valence)) * 0.03,
      0.12,
      0.92,
    );
    const clarity = clamp(
      arc.clarity + Math.abs(valence) * 0.12 - (0.5 - intensity) * 0.05 + (hash01(`${date}:clarity`) - 0.5) * 0.1,
      0.18,
      0.94,
    );

    return {
      id: date,
      date,
      intensity,
      valence,
      clarity,
      distilled: buildDistilledSummary(date, arc.chapter, valence, intensity, clarity),
      isPivot: false,
      wordCount: Math.round(220 + intensity * 880 + hash01(`${date}:words`) * 260),
    } satisfies JournalWaveformEntry;
  });
}
