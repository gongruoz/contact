/**
 * Segments: spindle profile (thin at both ends, thick at center) + alpha fade along length.
 * Dots: flat fill (no gradient).
 */

export type Rgb = readonly [number, number, number];

export const RGB_SELF_STROKE: Rgb = [0, 0, 0];
export const RGB_SELF_FILL: Rgb = [0, 0, 0];
export const RGB_PEER_STROKE: Rgb = [178, 178, 182];
export const RGB_PEER_FILL: Rgb = [188, 188, 192];
export const RGB_THREAD: Rgb = [100, 100, 105];
export const RGB_MERGE: Rgb = [60, 60, 65];

/** Visible segment after gapping from joint dots. */
export function gappedSegmentEndpoints(
  ax: number, ay: number, bx: number, by: number, gap: number,
): { x1: number; y1: number; x2: number; y2: number } | null {
  let dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1e-8;
  dx /= len; dy /= len;
  const t = Math.max(0, len - 2 * gap);
  if (t < 1) return null;
  return {
    x1: ax + dx * gap,
    y1: ay + dy * gap,
    x2: ax + dx * (gap + t),
    y2: ay + dy * (gap + t),
  };
}

/** Half-width at parameter t ∈ [0,1] along the segment (0 at ends, peak at center). */
function spindleEnvelope(t: number): number {
  return Math.sin(Math.PI * t);
}

/**
 * Filled spindle along (x1,y1)→(x2,y2): width ∝ sin(πt), alpha gradient along the spine.
 * `lineWidth` is the maximum thickness at the center (not stroke width).
 */
export function fillSpindleSegmentEndFade(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  lineWidth: number,
  rgb: Rgb,
  centerAlpha: number,
) {
  if (centerAlpha < 0.003 || lineWidth < 0.02) return;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const peakHalf = lineWidth * 0.5;
  const steps = Math.max(10, Math.min(56, Math.ceil(len / 5)));

  const [r, g, b] = rgb;
  const mid = `rgba(${r},${g},${b},${centerAlpha})`;
  const z = `rgba(${r},${g},${b},0)`;
  /** Longer opaque run along the spine; short fades only at the tips. */
  const e = 0.09;
  const lg = ctx.createLinearGradient(x1, y1, x2, y2);
  lg.addColorStop(0, z);
  lg.addColorStop(e, mid);
  lg.addColorStop(1 - e, mid);
  lg.addColorStop(1, z);

  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const w = peakHalf * spindleEnvelope(t);
    const cx = x1 + ux * len * t;
    const cy = y1 + uy * len * t;
    const px = cx + nx * w;
    const py = cy + ny * w;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const w = peakHalf * spindleEnvelope(t);
    const cx = x1 + ux * len * t;
    const cy = y1 + uy * len * t;
    ctx.lineTo(cx - nx * w, cy - ny * w);
  }
  ctx.closePath();
  ctx.fillStyle = lg;
  ctx.fill();
}

/** Same spindle profile, uniform alpha along the segment (reads as a solid stroke, no end gaps). */
export function fillSpindleSegmentSolid(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  lineWidth: number,
  rgb: Rgb,
  alpha: number,
) {
  if (alpha < 0.003 || lineWidth < 0.02) return;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const peakHalf = lineWidth * 0.5;
  const steps = Math.max(10, Math.min(56, Math.ceil(len / 5)));

  const [r, g, b] = rgb;
  const col = `rgba(${r},${g},${b},${alpha})`;
  const lg = ctx.createLinearGradient(x1, y1, x2, y2);
  lg.addColorStop(0, col);
  lg.addColorStop(0.5, col);
  lg.addColorStop(1, col);

  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const w = peakHalf * spindleEnvelope(t);
    const cx = x1 + ux * len * t;
    const cy = y1 + uy * len * t;
    const px = cx + nx * w;
    const py = cy + ny * w;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const w = peakHalf * spindleEnvelope(t);
    const cx = x1 + ux * len * t;
    const cy = y1 + uy * len * t;
    ctx.lineTo(cx - nx * w, cy - ny * w);
  }
  ctx.closePath();
  ctx.fillStyle = lg;
  ctx.fill();
}

export function strokeLineEndFade(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  lineWidth: number,
  rgb: Rgb,
  centerAlpha: number,
) {
  fillSpindleSegmentEndFade(ctx, x1, y1, x2, y2, lineWidth, rgb, centerAlpha);
}

export function strokeGappedLineEndFade(
  ctx: CanvasRenderingContext2D,
  ax: number, ay: number, bx: number, by: number,
  gap: number,
  lineWidth: number,
  rgb: Rgb,
  centerAlpha: number,
) {
  const seg = gappedSegmentEndpoints(ax, ay, bx, by, gap);
  if (!seg) return;
  fillSpindleSegmentEndFade(ctx, seg.x1, seg.y1, seg.x2, seg.y2, lineWidth, rgb, centerAlpha);
}

// ---- Sketch echoes (live figure only; trails should use strokeGappedLineEndFade — no sketch shadow) ----

const N_SKETCH_STROKES = 4;

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function unitFromSeed(seed: number, salt: number): number {
  const x = Math.sin((seed + salt * 374761393) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export interface SketchStrokeSpec {
  offsetPx: number;
  t0: number;
  t1: number;
  angleRad: number;
  alphaMul: number;
  widthMul: number;
}

export function sketchStrokesForSegment(
  segmentKey: string,
  lineWidth: number,
  segLen: number,
): SketchStrokeSpec[] {
  const seed = hashString(segmentKey);
  const offsetScale = Math.max(0.55, lineWidth * 1.35 + segLen * 0.006);
  const out: SketchStrokeSpec[] = [];
  for (let i = 0; i < N_SKETCH_STROKES; i++) {
    const base = i * 11;
    const u0 = unitFromSeed(seed, base + 1);
    const u1 = unitFromSeed(seed, base + 2);
    const u2 = unitFromSeed(seed, base + 3);
    const u3 = unitFromSeed(seed, base + 4);
    const u4 = unitFromSeed(seed, base + 5);
    const u5 = unitFromSeed(seed, base + 6);
    const sign = u0 < 0.5 ? -1 : 1;
    const offsetPx = sign * (0.45 + u1 * 1.75) * offsetScale;
    let t0 = 0.05 + u2 * 0.17;
    let t1 = 0.74 + u3 * 0.2;
    if (t1 - t0 < 0.1) t1 = Math.min(0.97, t0 + 0.12);
    out.push({
      offsetPx,
      t0,
      t1,
      angleRad: (u4 - 0.5) * 0.09,
      alphaMul: 0.14 + u5 * 0.2,
      widthMul: 0.26 + unitFromSeed(seed, base + 7) * 0.22,
    });
  }
  return out;
}

function rotateAround(
  cx: number, cy: number,
  px: number, py: number,
  c: number, s: number,
): { x: number; y: number } {
  const rx = px - cx, ry = py - cy;
  return { x: cx + rx * c - ry * s, y: cy + rx * s + ry * c };
}

/**
 * Main spindle + deterministic parallel “pencil” strokes. Use `strokeGappedLineEndFade` for trails
 * so sketch lines do not leave echoes / shadow.
 */
export function strokeGappedLineWithSketches(
  ctx: CanvasRenderingContext2D,
  ax: number, ay: number, bx: number, by: number,
  gap: number,
  lineWidth: number,
  rgb: Rgb,
  centerAlpha: number,
  segmentKey: string,
) {
  const seg = gappedSegmentEndpoints(ax, ay, bx, by, gap);
  if (!seg) return;
  const x1 = seg.x1, y1 = seg.y1, x2 = seg.x2, y2 = seg.y2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;

  const specs = sketchStrokesForSegment(segmentKey, lineWidth, len);

  for (const sp of specs) {
    const ea = centerAlpha * sp.alphaMul;
    if (ea < 0.004) continue;
    const ew = lineWidth * sp.widthMul;
    let sx1 = x1 + ux * len * sp.t0 + nx * sp.offsetPx;
    let sy1 = y1 + uy * len * sp.t0 + ny * sp.offsetPx;
    let sx2 = x1 + ux * len * sp.t1 + nx * sp.offsetPx;
    let sy2 = y1 + uy * len * sp.t1 + ny * sp.offsetPx;
    const mx = (sx1 + sx2) * 0.5, my = (sy1 + sy2) * 0.5;
    const cr = Math.cos(sp.angleRad), sr = Math.sin(sp.angleRad);
    const r1 = rotateAround(mx, my, sx1, sy1, cr, sr);
    const r2 = rotateAround(mx, my, sx2, sy2, cr, sr);
    fillSpindleSegmentEndFade(ctx, r1.x, r1.y, r2.x, r2.y, ew, rgb, ea);
  }

  fillSpindleSegmentEndFade(ctx, x1, y1, x2, y2, lineWidth, rgb, centerAlpha);
}

/** Stable id for a bone or edge (order-independent). */
export function segmentKeySorted(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Solid disc — uniform color, no radial gradient. */
export function fillSolidDot(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  radius: number,
  rgb: Rgb,
  alpha: number,
) {
  if (alpha < 0.003) return;
  const [r, g, b] = rgb;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
  ctx.fill();
}
