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
  const lg = ctx.createLinearGradient(x1, y1, x2, y2);
  lg.addColorStop(0, `rgba(${r},${g},${b},0)`);
  lg.addColorStop(0.5, `rgba(${r},${g},${b},${centerAlpha})`);
  lg.addColorStop(1, `rgba(${r},${g},${b},0)`);

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
