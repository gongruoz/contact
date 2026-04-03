import type { Features } from "./dsp";

let smoothed = 0;

export function computeSimilarity(a: Features, b: Features): number {
  const dAmp = a.amplitude - b.amplitude;
  const dFreq = a.frequency - b.frequency;
  const dSmooth = a.smoothness - b.smoothness;

  let dAxis = Math.abs(a.axis - b.axis);
  if (dAxis > 0.5) dAxis = 1 - dAxis;

  const dist = Math.sqrt(dAmp * dAmp + dFreq * dFreq + dAxis * dAxis * 4 + dSmooth * dSmooth);
  const maxDist = 2.0;
  const raw = Math.max(0, 1 - dist / maxDist);

  smoothed = smoothed + 0.06 * (raw - smoothed);
  return smoothed;
}

export function resetSimilarity() {
  smoothed = 0;
}
