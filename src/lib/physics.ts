export function computeNodeProperties(
  temperature: number,
  importance: number
) {
  const mass = importance;

  // Temperature is the PRIMARY driver of orbit distance (cold = far)
  // Importance is a subtle secondary factor (important = slightly closer)
  const baseRadius = 80 + (10 - importance) * 15; // 80..215
  const coldnessFactor = 1 + (1 - temperature) * 2.5; // 1.0..3.5
  const orbitalRadius = baseRadius * coldnessFactor;

  // Node size proportional to importance
  const nodeRadius = 8 + importance * 3; // 11..38 pixels

  return { mass, orbitalRadius, nodeRadius };
}

export function nudgeScore(temperature: number, importance: number): number {
  return importance * (1 - temperature);
}
