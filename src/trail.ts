/**
 * Generic trail renderer — captures named point snapshots and draws
 * fading skeletal echoes. Works for both simplex (4 points) and skeleton (13 joints).
 */

export interface TrailConfig {
  maxFrames: number;
  captureInterval: number;
  fadeExponent: number;
  maxAlpha: number;
}

type PointSnapshot = Record<string, { x: number; y: number }>;

export class TrailSystem {
  private history: PointSnapshot[] = [];
  private lastCapture = 0;
  private idleTime = 0;
  private cfg: TrailConfig;

  enabled = false;

  constructor(cfg?: Partial<TrailConfig>) {
    this.cfg = {
      maxFrames: 40,
      captureInterval: 33,
      fadeExponent: 2,
      maxAlpha: 0.55,
      ...cfg,
    };
  }

  capture(points: PointSnapshot, motionMag: number, now: number) {
    if (!this.enabled) return;

    if (motionMag < 0.008) {
      this.idleTime += (now - this.lastCapture) || 0;
    } else {
      this.idleTime = 0;
    }

    if (this.idleTime > 2000) {
      this.lastCapture = now;
      return;
    }

    if (now - this.lastCapture < this.cfg.captureInterval) return;
    this.lastCapture = now;

    const snap: PointSnapshot = {};
    for (const [k, v] of Object.entries(points)) {
      snap[k] = { x: v.x, y: v.y };
    }
    this.history.push(snap);
    if (this.history.length > this.cfg.maxFrames) this.history.shift();
  }

  draw(
    ctx: CanvasRenderingContext2D,
    bones: [string, string][],
    role: "self" | "peer",
    gap: number,
    activeJoint?: string,
  ) {
    if (!this.enabled || this.history.length < 2) return;

    const total = this.history.length;
    const baseColor = role === "self" ? "0,0,0" : "178,178,182";

    for (let i = 0; i < total - 1; i++) {
      const snap = this.history[i];
      const age = (i + 1) / total;
      const alpha = Math.pow(age, this.cfg.fadeExponent) * this.cfg.maxAlpha;
      if (alpha < 0.005) continue;

      const lw = 0.3 + age * 0.5;

      ctx.beginPath();
      for (const [a, b] of bones) {
        const pa = snap[a], pb = snap[b];
        if (!pa || !pb) continue;
        gappedLineTrail(ctx, pa.x, pa.y, pb.x, pb.y, gap);
      }
      ctx.strokeStyle = `rgba(${baseColor},${alpha})`;
      ctx.lineWidth = lw;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }

  clear() {
    this.history = [];
    this.idleTime = 0;
  }
}

function gappedLineTrail(
  ctx: CanvasRenderingContext2D,
  ax: number, ay: number, bx: number, by: number, gap: number,
) {
  let dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1e-8;
  dx /= len; dy /= len;
  const t = Math.max(0, len - 2 * gap);
  if (t < 1) return;
  ctx.moveTo(ax + dx * gap, ay + dy * gap);
  ctx.lineTo(ax + dx * (gap + t), ay + dy * (gap + t));
}
