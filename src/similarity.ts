import type { Simplex } from "./creature";

let smoothed = 0;

function particleOffsetsNorm(s: Simplex, w: number, h: number): [number, number][] {
  const scale = Math.min(w, h);
  const invS = scale > 1e-8 ? 1 / scale : 1;
  let sx = 0;
  let sy = 0;
  for (const p of s.particles) {
    sx += p.x;
    sy += p.y;
  }
  const n = s.particles.length;
  sx /= n;
  sy /= n;
  return s.particles.map((p) => [(p.x - sx) * invS, (p.y - sy) * invS]);
}

/** Compare intrinsic quad shape (translation-invariant) in normalized units. */
export function computeSimilarityFromParticles(self: Simplex, peer: Simplex, w: number, h: number): number {
  const A = particleOffsetsNorm(self, w, h);
  const B = particleOffsetsNorm(peer, w, h);
  const used = new Set<number>();
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    let best = Infinity;
    let bestJ = -1;
    for (let j = 0; j < 4; j++) {
      if (used.has(j)) continue;
      const dx = A[i][0] - B[j][0];
      const dy = A[i][1] - B[j][1];
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        bestJ = j;
      }
    }
    if (bestJ >= 0) {
      used.add(bestJ);
      sum += Math.sqrt(best);
    }
  }
  const mean = sum / 4;
  const raw = Math.max(0, 1 - mean / 0.55);
  smoothed += 0.06 * (raw - smoothed);
  return smoothed;
}

export function resetSimilarity() {
  smoothed = 0;
}
