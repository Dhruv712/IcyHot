import { DEFAULT_HALF_LIVES, HEAT_PULSE } from "./constants";

export function computeTemperature(
  interactions: { occurredAt: Date }[],
  relationshipType: string,
  decayRateOverride: number | null,
  now: Date = new Date()
): number {
  const halfLife =
    decayRateOverride ?? DEFAULT_HALF_LIVES[relationshipType] ?? 14;
  const lambda = Math.LN2 / (halfLife * 24 * 60 * 60 * 1000);

  let temp = 0;
  for (const interaction of interactions) {
    const elapsed = now.getTime() - interaction.occurredAt.getTime();
    if (elapsed < 0) continue;
    temp += HEAT_PULSE * Math.exp(-lambda * elapsed);
  }

  return Math.min(1.0, temp);
}

export function temperatureToColor(t: number): string {
  if (t <= 0.5) {
    const ratio = t / 0.5;
    const r = Math.round(59 + (240 - 59) * ratio);
    const g = Math.round(130 + (240 - 130) * ratio);
    const b = Math.round(246 + (240 - 246) * ratio);
    return `rgb(${r},${g},${b})`;
  } else {
    const ratio = (t - 0.5) / 0.5;
    const r = Math.round(240 + (239 - 240) * ratio);
    const g = Math.round(240 + (68 - 240) * ratio);
    const b = Math.round(240 + (68 - 240) * ratio);
    return `rgb(${r},${g},${b})`;
  }
}

export function temperatureLabel(t: number): string {
  if (t < 0.15) return "Cold";
  if (t < 0.35) return "Cool";
  if (t < 0.55) return "Warm";
  if (t < 0.75) return "Hot";
  return "On Fire";
}
