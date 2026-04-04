import type { Features } from "./dsp";

// ---- Verlet particle simulation (Euclidean) ----

interface Particle {
  x: number; y: number;
  px: number; py: number;
  fx: number; fy: number;
  depth: number;
}

interface Constraint {
  a: number; b: number;
  rest: number;
  baseRest: number;
  stiffness: number;
  isDiag: boolean;
}

export interface Simplex {
  particles: Particle[];
  constraints: Constraint[];
  cx: number; cy: number;
  phase: number;
  _amp: number; _freq: number; _axis: number; _smooth: number;
  /** Soft follow of input — whole body leans toward motion / cursor */
  leanX: number;
  leanY: number;
  /** Smoothed tilt (rad); applied incrementally so shape mimics device tilt */
  tiltSmoothed: number;
}

export interface MergePair {
  si: number;
  pi: number;
  strength: number;
}

function mkP(x: number, y: number): Particle {
  return { x, y, px: x, py: y, fx: 0, fy: 0, depth: 0 };
}

const N = 4;
const R0 = 100;

export function createSimplex(cx: number, cy: number): Simplex {
  const ps: Particle[] = [];
  const cs: Constraint[] = [];

  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    ps.push(mkP(cx + Math.cos(a) * R0, cy + Math.sin(a) * R0));
  }

  for (let i = 0; i < N; i++) {
    const a = i, b = (i + 1) % N;
    const d = Math.hypot(ps[b].x - ps[a].x, ps[b].y - ps[a].y);
    cs.push({ a, b, rest: d, baseRest: d, stiffness: 0.10, isDiag: false });
  }

  for (const [a, b] of [[0, 2], [1, 3]] as [number, number][]) {
    const d = Math.hypot(ps[b].x - ps[a].x, ps[b].y - ps[a].y);
    cs.push({ a, b, rest: d, baseRest: d, stiffness: 0.035, isDiag: true });
  }

  return {
    particles: ps, constraints: cs, cx, cy,
    phase: Math.random() * Math.PI * 2,
    _amp: 0, _freq: 0, _axis: 0.5, _smooth: 0,
    leanX: 0, leanY: 0, tiltSmoothed: 0,
  };
}

// ---- Physics helpers ----

function comXY(ps: Particle[]) {
  let x = 0, y = 0;
  for (const p of ps) { x += p.x; y += p.y; }
  const n = ps.length;
  return { x: x / n, y: y / n };
}

function lockCOM(s: Simplex) {
  const { x: mx, y: my } = comXY(s.particles);
  const ax = s.cx + s.leanX;
  const ay = s.cy + s.leanY;
  const dx = ax - mx, dy = ay - my;
  for (const p of s.particles) {
    p.x += dx; p.y += dy;
    p.px += dx; p.py += dy;
  }
}

function rotateAroundAnchor(s: Simplex, ax: number, ay: number, dTheta: number) {
  if (Math.abs(dTheta) < 1e-7) return;
  const c = Math.cos(dTheta);
  const si = Math.sin(dTheta);
  for (const p of s.particles) {
    const rx = p.x - ax, ry = p.y - ay;
    p.x = ax + rx * c - ry * si;
    p.y = ay + rx * si + ry * c;
    const rpx = p.px - ax, rpy = p.py - ay;
    p.px = ax + rpx * c - rpy * si;
    p.py = ay + rpx * si + rpy * c;
  }
}

const DAMP = 0.955;
const ACC = 4200;

function integrate(s: Simplex, dt: number, impulseMul = 1) {
  const a = dt * dt * ACC * impulseMul;
  const d = DAMP - s._smooth * 0.06;
  for (const p of s.particles) {
    const vx = (p.x - p.px) * d;
    const vy = (p.y - p.py) * d;
    p.px = p.x; p.py = p.y;
    p.x += vx + p.fx * a;
    p.y += vy + p.fy * a;
    p.fx = 0; p.fy = 0;
  }
}

function solve(s: Simplex, iter: number) {
  for (let k = 0; k < iter; k++) {
    for (const c of s.constraints) {
      const pa = s.particles[c.a], pb = s.particles[c.b];
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
      const diff = (dist - c.rest) / dist;
      const h = c.stiffness * 0.5;
      pa.x += dx * diff * h; pa.y += dy * diff * h;
      pb.x -= dx * diff * h; pb.y -= dy * diff * h;
    }
  }
}

function adaptRest(s: Simplex) {
  for (const c of s.constraints) {
    const pa = s.particles[c.a], pb = s.particles[c.b];
    const d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const rate = c.isDiag ? 0.015 : 0.10;
    const lo = c.baseRest * 0.35, hi = c.baseRest * 2.5;
    const target = Math.max(lo, Math.min(hi, d));
    c.rest += (target - c.rest) * rate;
  }
}

function spreadPressure(s: Simplex) {
  const { x: cx, y: cy } = comXY(s.particles);
  const minR = R0 * 0.28;
  for (const p of s.particles) {
    const dx = p.x - cx, dy = p.y - cy;
    const d = Math.hypot(dx, dy);
    if (d < minR && d > 0.01) {
      const push = ((minR - d) / minR) * 0.45;
      p.fx += (dx / d) * push;
      p.fy += (dy / d) * push;
    }
  }
}

function edgeMinLength(s: Simplex) {
  const minLen = R0 * 0.22;
  for (const c of s.constraints) {
    if (c.isDiag) continue;
    const pa = s.particles[c.a], pb = s.particles[c.b];
    const dx = pb.x - pa.x, dy = pb.y - pa.y;
    const d = Math.hypot(dx, dy);
    if (d < minLen && d > 0.01) {
      const push = ((minLen - d) / minLen) * 0.3;
      const nx = dx / d, ny = dy / d;
      pa.fx -= nx * push; pa.fy -= ny * push;
      pb.fx += nx * push; pb.fy += ny * push;
    }
  }
}

// ---- Drive (sensor → organic forces) ----

export function driveSimplex(
  s: Simplex, f: Features,
  rawAx: number, rawAy: number,
  dt: number,
) {
  const lr = 0.065;
  s._amp += (f.amplitude - s._amp) * lr;
  s._freq += (f.frequency - s._freq) * lr;
  s._axis += (f.axis - s._axis) * lr;
  s._smooth += (f.smoothness - s._smooth) * lr;

  const spd = 0.35 + s._freq * 3.0;
  s.phase += spd * dt;

  const rawLenEarly = Math.hypot(rawAx, rawAy);
  const amp = s._amp;
  const motionMag = Math.min(1, rawLenEarly * 1.2);
  const express = Math.max(0.35, Math.min(1.45, 0.38 + amp * 0.42 + motionMag * 0.55));

  const edgeScale = 1 - 0.22 * motionMag;
  const diagScale = 1 - 0.18 * motionMag;
  const eStiff = Math.max(0.028, (0.055 + s._smooth * 0.09) * edgeScale);
  const dStiff = Math.max(0.012, (0.018 + s._smooth * 0.036) * diagScale);
  for (const c of s.constraints) c.stiffness = c.isDiag ? dStiff : eStiff;

  const maxLean = 82 * express;
  const leanTx = rawAx * maxLean;
  const leanTy = rawAy * maxLean;
  const leanK = 0.155;
  s.leanX += (leanTx - s.leanX) * leanK;
  s.leanY += (leanTy - s.leanY) * leanK;

  let tiltTarget = 0;
  if (rawLenEarly > 0.02) {
    tiltTarget = Math.atan2(rawAy, rawAx) * 0.5;
    const lim = 0.88;
    tiltTarget = Math.max(-lim, Math.min(lim, tiltTarget));
  }
  const prevTilt = s.tiltSmoothed;
  s.tiltSmoothed += (tiltTarget - s.tiltSmoothed) * 0.14;
  const dTilt = s.tiltSmoothed - prevTilt;

  const { x: cx, y: cy } = comXY(s.particles);
  const dir = s._axis * Math.PI;

  for (let i = 0; i < N; i++) {
    const p = s.particles[i];
    const rx = p.x - cx, ry = p.y - cy;
    const rl = Math.hypot(rx, ry) || 1e-8;
    const ux = rx / rl, uy = ry / rl;
    const off = (i / N) * Math.PI * 2;

    const b1 = (0.10 + amp * 0.48 + motionMag * 0.38) * Math.sin(s.phase + off);
    const b2 = (0.028 + amp * 0.18 + motionMag * 0.12) * Math.sin(s.phase * 1.618 + off * 0.7 + 0.4);
    p.fx += ux * (b1 + b2);
    p.fy += uy * (b1 + b2);

    const dot = ux * Math.cos(dir) + uy * Math.sin(dir);
    const stretch = dot * (amp * 0.26 + motionMag * 0.14) * Math.sin(s.phase * 0.75 + 0.6);
    p.fx += ux * stretch;
    p.fy += uy * stretch;

    const w1 = 0.035 * Math.sin(s.phase * 0.11 + i * 1.3);
    const w2 = 0.02 * Math.cos(s.phase * 0.073 + i * 2.2);
    p.fx += -uy * w1 + ux * w2;
    p.fy += ux * w1 + uy * w2;
  }

  const rawLen = rawLenEarly;
  if (rawLen > 0.008) {
    const inv = 1 / rawLen;
    const tx = -rawAy * inv, ty = rawAx * inv;
    const mx = rawAx * inv, my = rawAy * inv;
    const px = -my, py = mx;
    for (let i = 0; i < N; i++) {
      const p = s.particles[i];
      const rx = p.x - cx, ry = p.y - cy;
      const rl = Math.hypot(rx, ry) || 1e-8;
      const ux = rx / rl, uy = ry / rl;
      const tw = (tx * -uy + ty * ux) * rawLen * (1.35 + motionMag * 1.1);
      p.fx += -uy * tw;
      p.fy += ux * tw;
      const align = Math.max(0, ux * mx + uy * my);
      const reach = align * rawLen * (0.32 + amp * 0.65) * express;
      p.fx += mx * reach;
      p.fy += my * reach;
      const side = ux * px + uy * py;
      const squash = side * rawLen * 0.62 * express;
      p.fx += px * squash;
      p.fy += py * squash;
    }
  }

  spreadPressure(s);
  edgeMinLength(s);
  adaptRest(s);
  integrate(s, dt, 1 + motionMag * 0.9);
  solve(s, 5);
  lockCOM(s);
  rotateAroundAnchor(s, s.cx + s.leanX, s.cy + s.leanY, dTilt);
}

// ---- Rendering ----

const GAP = 6;
const NR = 4;

function gappedLine(
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

export type DrawRole = "self" | "peer";

export function drawSimplex(
  ctx: CanvasRenderingContext2D, s: Simplex,
  opacity: number, role: DrawRole = "self",
) {
  if (opacity <= 0.01) return;

  const sA = role === "self" ? opacity * 0.52 : opacity * 0.55;
  const fA = role === "self" ? opacity * 0.92 : opacity * 0.82;
  const stroke = role === "self" ? `rgba(0,0,0,${sA})` : `rgba(178,178,182,${sA})`;
  const fill = role === "self" ? `rgba(0,0,0,${fA})` : `rgba(188,188,192,${fA})`;

  ctx.beginPath();
  for (const c of s.constraints) {
    if (c.isDiag) continue;
    const pa = s.particles[c.a], pb = s.particles[c.b];
    gappedLine(ctx, pa.x, pa.y, pb.x, pb.y, GAP);
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = role === "self" ? 1.35 : 1.15;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.stroke();

  for (const p of s.particles) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, NR, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

// ---- Merge system ----

const MERGE_ON   = [0.15, 0.35, 0.55, 0.78];
const MERGE_FULL = [0.33, 0.53, 0.73, 0.92];

export function computeMergePairs(
  self: Simplex, peer: Simplex, similarity: number,
): MergePair[] {
  let count = 0;
  for (let i = 0; i < N; i++) {
    if (similarity >= MERGE_ON[i]) count = i + 1;
  }
  if (count === 0) return [];

  const usedS = new Set<number>();
  const usedP = new Set<number>();
  const pairs: MergePair[] = [];

  for (let k = 0; k < count; k++) {
    let best = Infinity, bsi = -1, bpi = -1;
    for (let si = 0; si < N; si++) {
      if (usedS.has(si)) continue;
      for (let pi = 0; pi < N; pi++) {
        if (usedP.has(pi)) continue;
        const dx = self.particles[si].x - peer.particles[pi].x;
        const dy = self.particles[si].y - peer.particles[pi].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < best) { best = d2; bsi = si; bpi = pi; }
      }
    }
    if (bsi < 0) break;
    usedS.add(bsi); usedP.add(bpi);
    const on = MERGE_ON[k], full = MERGE_FULL[k];
    const str = Math.min(1, Math.max(0, (similarity - on) / (full - on)));
    pairs.push({ si: bsi, pi: bpi, strength: str });
  }
  return pairs;
}

export function applyFusion(
  self: Simplex, peer: Simplex,
  pairs: MergePair[], dt: number,
) {
  if (pairs.length === 0) return;

  for (const { si, pi, strength } of pairs) {
    if (strength < 0.01) continue;
    const sp = self.particles[si], pp = peer.particles[pi];
    const dx = pp.x - sp.x, dy = pp.y - sp.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist, ny = dy / dist;
    const f = strength * 0.12;
    sp.fx += nx * f; sp.fy += ny * f;
    pp.fx -= nx * f; pp.fy -= ny * f;
  }

  integrate(self, dt);
  integrate(peer, dt);
  solve(self, 3);
  solve(peer, 3);
  lockCOM(self);
  lockCOM(peer);
}

export function drawMergeEffects(
  ctx: CanvasRenderingContext2D,
  self: Simplex, peer: Simplex,
  pairs: MergePair[], time: number,
) {
  for (const { si, pi, strength } of pairs) {
    if (strength < 0.03) continue;
    const sp = self.particles[si], pp = peer.particles[pi];
    const dx = pp.x - sp.x, dy = pp.y - sp.y;
    const dist = Math.hypot(dx, dy);

    const threadAlpha = strength * 0.35;
    if (threadAlpha > 0.01 && dist > GAP * 2) {
      ctx.beginPath();
      gappedLine(ctx, sp.x, sp.y, pp.x, pp.y, GAP);
      ctx.strokeStyle = `rgba(100, 100, 105, ${threadAlpha})`;
      ctx.lineWidth = 0.5 + strength * 0.8;
      ctx.lineCap = "round";
      ctx.stroke();
    }

    const snapDist = 35;
    if (dist < snapDist) {
      const closeness = 1 - dist / snapDist;
      const mx = (sp.x + pp.x) / 2, my = (sp.y + pp.y) / 2;
      const alpha = closeness * strength * 0.65;
      const r = NR * (1.4 + closeness * 1.2);

      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(60, 60, 65, ${alpha})`;
      ctx.fill();

      const pulse = 1.15 + 0.15 * Math.sin(time * 0.005);
      ctx.beginPath();
      ctx.arc(mx, my, r * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(60, 60, 65, ${alpha * 0.35})`;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }
}
