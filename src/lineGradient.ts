/**
 * Line strokes: transparent at both ends, solid in the middle (linear along segment).
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

/** Stroke one segment: ends fade to transparent, peak alpha at center. */
export function strokeLineEndFade(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  lineWidth: number,
  rgb: Rgb,
  centerAlpha: number,
) {
  if (centerAlpha < 0.003) return;
  const [r, g, b] = rgb;
  const lg = ctx.createLinearGradient(x1, y1, x2, y2);
  lg.addColorStop(0, `rgba(${r},${g},${b},0)`);
  lg.addColorStop(0.5, `rgba(${r},${g},${b},${centerAlpha})`);
  lg.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = lg;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
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
  strokeLineEndFade(ctx, seg.x1, seg.y1, seg.x2, seg.y2, lineWidth, rgb, centerAlpha);
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
