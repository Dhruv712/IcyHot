/**
 * Memory clustering — k-means on embeddings with anchor-based 2D projection.
 * Used for the Gravity Well Map visualization in the journal editor.
 */

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
} from "d3-force";

// ── Types ──────────────────────────────────────────────────────────────

export interface MemoryCluster {
  centroid: number[];
  label: string;
  memberCount: number;
  memberIds: string[];
  x: number;
  y: number;
}

export interface MemoryPoint {
  id: string;
  embedding: number[];
  content: string;
  contactIds: string[];
  source: string;
  strength: number;
}

// ── Cosine similarity ──────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}

// ── K-means++ ──────────────────────────────────────────────────────────

const MAX_ITERATIONS = 20;

function initCentroidsKMeansPP(
  embeddings: number[][],
  k: number,
): number[][] {
  const n = embeddings.length;
  const dim = embeddings[0].length;
  const centroids: number[][] = [];

  // Pick first centroid randomly
  centroids.push([...embeddings[Math.floor(Math.random() * n)]]);

  for (let c = 1; c < k; c++) {
    // Compute distance to nearest existing centroid for each point
    const distances = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      for (const centroid of centroids) {
        const sim = cosineSimilarity(embeddings[i], centroid);
        const dist = 1 - sim;
        if (dist < minDist) minDist = dist;
      }
      distances[i] = minDist * minDist; // Squared for probability weighting
    }

    // Weighted random selection
    const totalDist = distances.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalDist;
    for (let i = 0; i < n; i++) {
      r -= distances[i];
      if (r <= 0) {
        centroids.push([...embeddings[i]]);
        break;
      }
    }
    // Fallback if floating point drift
    if (centroids.length <= c) {
      centroids.push([...embeddings[Math.floor(Math.random() * n)]]);
    }
  }

  return centroids;
}

function normalizeCentroid(centroid: number[]): number[] {
  let mag = 0;
  for (const v of centroid) mag += v * v;
  mag = Math.sqrt(mag);
  if (mag === 0) return centroid;
  return centroid.map((v) => v / mag);
}

export function kMeansClusters(
  memories: MemoryPoint[],
  k: number,
): MemoryCluster[] {
  const embeddings = memories.map((m) => m.embedding);
  const n = embeddings.length;
  const dim = embeddings[0]?.length ?? 0;

  if (n === 0 || dim === 0 || k <= 0) return [];
  if (n <= k) {
    // Fewer points than clusters: each point is its own cluster
    return memories.map((m) => ({
      centroid: m.embedding,
      label: "",
      memberCount: 1,
      memberIds: [m.id],
      x: 0,
      y: 0,
    }));
  }

  let centroids = initCentroidsKMeansPP(embeddings, k);
  let assignments = new Int32Array(n);

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // Assign each point to nearest centroid
    let changed = false;
    for (let i = 0; i < n; i++) {
      let bestCluster = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < k; c++) {
        const sim = cosineSimilarity(embeddings[i], centroids[c]);
        if (sim > bestSim) {
          bestSim = sim;
          bestCluster = c;
        }
      }
      if (assignments[i] !== bestCluster) {
        assignments[i] = bestCluster;
        changed = true;
      }
    }

    if (!changed) break;

    // Recompute centroids as mean of assigned vectors
    const newCentroids = Array.from({ length: k }, () => new Float64Array(dim));
    const counts = new Int32Array(k);

    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let d = 0; d < dim; d++) {
        newCentroids[c][d] += embeddings[i][d];
      }
    }

    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        const raw = Array.from(newCentroids[c]).map((v) => v / counts[c]);
        centroids[c] = normalizeCentroid(raw);
      }
    }
  }

  // Build cluster objects
  const clusters: MemoryCluster[] = [];
  for (let c = 0; c < k; c++) {
    const memberIds: string[] = [];
    for (let i = 0; i < n; i++) {
      if (assignments[i] === c) memberIds.push(memories[i].id);
    }
    if (memberIds.length === 0) continue; // Skip empty clusters

    const members = memberIds.map((id) => memories.find((m) => m.id === id)!);
    const label = autoLabel(members);

    clusters.push({
      centroid: centroids[c],
      label,
      memberCount: memberIds.length,
      memberIds,
      x: 0,
      y: 0,
    });
  }

  return clusters;
}

// ── Auto-labeling ──────────────────────────────────────────────────────

// Common stop words to ignore
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "was", "are", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "no",
  "nor", "not", "only", "own", "same", "so", "than", "too", "very",
  "just", "because", "but", "and", "or", "if", "while", "about", "that",
  "this", "these", "those", "i", "me", "my", "myself", "we", "our",
  "you", "your", "he", "him", "his", "she", "her", "it", "its", "they",
  "them", "their", "what", "which", "who", "whom", "up", "also", "much",
  "many", "like", "even", "still", "got", "get", "really", "think",
  "things", "thing", "something", "going", "want", "went", "said",
]);

function autoLabel(members: MemoryPoint[]): string {
  // Count contact mentions
  const contactCounts = new Map<string, number>();
  for (const m of members) {
    for (const cid of m.contactIds) {
      contactCounts.set(cid, (contactCounts.get(cid) ?? 0) + 1);
    }
  }

  // Extract distinctive words (TF-IDF-like: frequent in cluster)
  const wordCounts = new Map<string, number>();
  for (const m of members) {
    const words = m.content
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

    const seen = new Set<string>();
    for (const w of words) {
      if (!seen.has(w)) {
        wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
        seen.add(w);
      }
    }
  }

  // Sort words by frequency (TF), take top 2
  const topWords = Array.from(wordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([word]) => word);

  // Build label
  if (topWords.length === 0) return "misc";
  return topWords.join(" & ");
}

// ── 2D layout via d3-force ─────────────────────────────────────────────

export function layoutClusters(clusters: MemoryCluster[]): void {
  if (clusters.length <= 1) {
    if (clusters.length === 1) {
      clusters[0].x = 0.5;
      clusters[0].y = 0.5;
    }
    return;
  }

  // Build links from pairwise similarity
  interface SimNode {
    index: number;
    x?: number;
    y?: number;
  }
  interface SimLink {
    source: number;
    target: number;
    similarity: number;
  }

  const nodes: SimNode[] = clusters.map((_, i) => ({ index: i }));
  const links: SimLink[] = [];

  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const sim = cosineSimilarity(clusters[i].centroid, clusters[j].centroid);
      links.push({ source: i, target: j, similarity: sim });
    }
  }

  // Similar clusters should be closer → shorter link distance
  const sim = forceSimulation(nodes as any)
    .force(
      "link",
      forceLink(links as any)
        .id((d: any) => d.index)
        .distance((d: any) => 100 * (1 - d.similarity))
        .strength(0.5),
    )
    .force("charge", forceManyBody().strength(-30))
    .force("center", forceCenter(0, 0))
    .stop();

  // Run synchronously
  for (let i = 0; i < 300; i++) sim.tick();

  // Normalize to [0, 1]
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const node of nodes) {
    const x = (node as any).x ?? 0;
    const y = (node as any).y ?? 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  // Add padding so dots don't sit on edges
  const PAD = 0.1;

  for (let i = 0; i < clusters.length; i++) {
    const nx = ((nodes[i] as any).x - minX) / rangeX;
    const ny = ((nodes[i] as any).y - minY) / rangeY;
    clusters[i].x = PAD + nx * (1 - 2 * PAD);
    clusters[i].y = PAD + ny * (1 - 2 * PAD);
  }
}

// ── Projection ─────────────────────────────────────────────────────────

const SHARPNESS = 3; // Exponent to sharpen similarity weights

export function projectToClusters(
  embedding: number[],
  clusters: Array<{ centroid: number[]; x: number; y: number }>,
): { x: number; y: number; similarities: number[] } {
  if (clusters.length === 0) return { x: 0.5, y: 0.5, similarities: [] };

  const sims = clusters.map((c) => cosineSimilarity(embedding, c.centroid));

  // Raise to power to sharpen — nearest cluster dominates pull
  const weights = sims.map((s) => Math.pow(Math.max(0, s), SHARPNESS));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

  const x =
    clusters.reduce((sum, c, i) => sum + c.x * weights[i], 0) / totalWeight;
  const y =
    clusters.reduce((sum, c, i) => sum + c.y * weights[i], 0) / totalWeight;

  return { x, y, similarities: sims };
}
