const DEFAULT_MIN_FRAMES = 12;

export function getPredictiveMinFrames(): number {
  const raw = Number(process.env.PREDICTIVE_MIN_FRAMES ?? DEFAULT_MIN_FRAMES);
  if (!Number.isFinite(raw)) return DEFAULT_MIN_FRAMES;
  const normalized = Math.floor(raw);
  if (normalized < 1) return 1;
  return normalized;
}
