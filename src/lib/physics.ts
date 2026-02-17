// Quantized temperature bands — each maps to a proportional orbital ring.
// The actual pixel radii are computed from viewport size via getOrbitRadii().
// Band proportions: 0.25, 0.5, 0.75, 1.0 of maxRadius
const ORBIT_PROPORTIONS = [0.25, 0.5, 0.75, 1.0];

// Default radii used by the server-side API (not viewport-aware)
export const ORBIT_RADII = [140, 280, 420, 560];

// Compute viewport-fitted orbit radii.
// maxRadius = half the smallest viewport dimension minus padding for
// node size (~38px max) + label text (~14px) + breathing room (~8px) = 60px
export function getOrbitRadii(width: number, height: number): number[] {
  const padding = 60;
  const maxRadius = Math.min(width, height) / 2 - padding;
  return ORBIT_PROPORTIONS.map((p) => Math.max(40, p * maxRadius));
}

export function temperatureBand(temperature: number): number {
  if (temperature > 0.75) return 0;
  if (temperature > 0.50) return 1;
  if (temperature > 0.25) return 2;
  return 3;
}

export function computeNodeProperties(
  temperature: number,
  importance: number
) {
  const mass = importance;

  // Quantized orbit based on temperature band
  const band = temperatureBand(temperature);
  const orbitalRadius = ORBIT_RADII[band];

  // Node size proportional to importance
  const nodeRadius = 8 + importance * 3; // 11..38 pixels

  return { mass, orbitalRadius, nodeRadius };
}

// Scale a node radius proportionally to the viewport.
// On the "design target" (outermost orbit ≈ 560px) the scale factor is ~1.0.
// On smaller viewports the nodes shrink to match, with a floor of 6px.
const DESIGN_TARGET_MAX_ORBIT = ORBIT_RADII[ORBIT_RADII.length - 1]; // 560

export function scaleNodeRadius(
  baseRadius: number,
  orbitRadii: number[]
): number {
  const actualMax = orbitRadii[orbitRadii.length - 1] || DESIGN_TARGET_MAX_ORBIT;
  const factor = Math.min(1, actualMax / DESIGN_TARGET_MAX_ORBIT);
  return Math.max(6, baseRadius * factor);
}

export function nudgeScore(temperature: number, importance: number): number {
  return importance * (1 - temperature);
}
