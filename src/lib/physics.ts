export function computeNodeProperties(
  temperature: number,
  importance: number
) {
  const mass = importance;

  // Important + warm = close orbit, unimportant + cold = far orbit
  const baseRadius = 100 + (10 - importance) * 40; // 100..460
  const coldnessFactor = 1 + (1 - temperature) * 1.5; // 1.0..2.5
  const orbitalRadius = baseRadius * coldnessFactor;

  // Node size proportional to importance
  const nodeRadius = 8 + importance * 3; // 11..38 pixels

  return { mass, orbitalRadius, nodeRadius };
}

export function nudgeScore(temperature: number, importance: number): number {
  return importance * (1 - temperature);
}
