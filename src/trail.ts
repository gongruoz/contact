/**
 * Generic trail renderer — bone echoes only (no joint motion polylines / point “shadows”).
 */

import { type Rgb, strokeGappedLineEndFade } from "./lineGradient";

export interface TrailConfig {
  maxFrames: number;
  captureInterval: number;
  fadeExponent: number;
  maxAlpha: number;
}

type PointSnapshot = Record<string, { x: number; y: number }>;

const TRAIL_SELF: Rgb = [0, 0, 0];
const TRAIL_PEER: Rgb = [200, 200, 204];

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
      fadeExponent: 2.2,
      maxAlpha: 0.2,
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
  ) {
    if (!this.enabled || this.history.length < 2) return;

    const total = this.history.length;
    const rgb = role === "self" ? TRAIL_SELF : TRAIL_PEER;
    const h = this.history;

    // Bone echoes: skip newest snapshot — live figure draws current pose.
    for (let i = 0; i < total - 1; i++) {
      const snap = h[i];
      const age = (i + 1) / total;
      const layerAlpha = Math.pow(age, this.cfg.fadeExponent) * this.cfg.maxAlpha;
      if (layerAlpha < 0.003) continue;

      const lw = 0.18 + age * 0.32;

      for (const [a, b] of bones) {
        const pa = snap[a], pb = snap[b];
        if (!pa || !pb) continue;
        strokeGappedLineEndFade(ctx, pa.x, pa.y, pb.x, pb.y, gap, lw, rgb, layerAlpha);
      }
    }
  }

  clear() {
    this.history = [];
    this.idleTime = 0;
  }
}
