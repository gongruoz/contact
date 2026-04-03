import type { Features } from "./dsp";

// --------------- Torus helpers (2D periodic boundary) ---------------

export function wrap(x: number, L: number): number {
  return ((x % L) + L) % L;
}

/** Shortest vector from a toward b on a torus of size (tw, th) */
function torusDelta(ax: number, ay: number, bx: number, by: number, tw: number, th: number) {
  let dx = bx - ax;
  let dy = by - ay;
  if (dx > tw / 2) dx -= tw;
  else if (dx < -tw / 2) dx += tw;
  if (dy > th / 2) dy -= th;
  else if (dy < -th / 2) dy += th;
  return { dx, dy };
}

// --------------- Verlet particle system ---------------

interface Particle {
  x: number;
  y: number;
  px: number;
  py: number;
  fx: number;
  fy: number;
  pinX: number;
  pinY: number;
  pinStrength: number;
  depth: number;
}

interface Constraint {
  a: number;
  b: number;
  rest: number;
  stiffness: number;
}

export interface Simplex {
  particles: Particle[];
  constraints: Constraint[];
  cx: number;
  cy: number;
  tw: number;
  th: number;
  phase: number;
  _amp: number;
  _freq: number;
  _axis: number;
  _smooth: number;
}

function makeParticle(x: number, y: number, depth: number): Particle {
  return {
    x, y, px: x, py: y,
    fx: 0, fy: 0,
    pinX: x, pinY: y, pinStrength: 0,
    depth,
  };
}

// --------------- Closed hexagon simplex (core + 6 ring vertices) ---------------

const RING_N = 6;
/** Circumradius — larger figure */
const RING_R = 118;
/** Edge length of regular hexagon with circumradius R */
const EDGE_REST = 2 * RING_R * Math.sin(Math.PI / RING_N);

export function createSimplex(cx: number, cy: number, tw: number, th: number): Simplex {
  const particles: Particle[] = [];
  const constraints: Constraint[] = [];

  const core = makeParticle(wrap(cx, tw), wrap(cy, th), 0);
  core.pinX = wrap(cx, tw);
  core.pinY = wrap(cy, th);
  core.pinStrength = 0.018;
  particles.push(core);

  for (let i = 0; i < RING_N; i++) {
    const ang = (i / RING_N) * Math.PI * 2 - Math.PI / 2;
    const px = wrap(cx + Math.cos(ang) * RING_R, tw);
    const py = wrap(cy + Math.sin(ang) * RING_R, th);
    const p = makeParticle(px, py, 1);
    const idx = particles.length;
    particles.push(p);
    constraints.push({ a: 0, b: idx, rest: RING_R, stiffness: 0.42 });
  }

  for (let i = 0; i < RING_N; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % RING_N);
    constraints.push({ a, b, rest: EDGE_REST, stiffness: 0.42 });
  }

  return {
    particles, constraints, cx, cy, tw, th,
    phase: Math.random() * Math.PI * 2,
    _amp: 0, _freq: 0, _axis: 0.5, _smooth: 0,
  };
}

// --------------- Physics ---------------

const DAMPING_BASE = 0.985;
const GRAVITY = 0;
/** Lower = calmer motion */
const ACC_SCALE = 7500;

function integrateParticles(s: Simplex, dt: number) {
  const { tw, th } = s;
  const acc = dt * dt * ACC_SCALE;
  for (const p of s.particles) {
    const vx = (p.x - p.px) * DAMPING_BASE;
    const vy = (p.y - p.py) * DAMPING_BASE;

    p.px = p.x;
    p.py = p.y;

    p.x += vx + p.fx * acc;
    p.y += vy + (p.fy + GRAVITY) * acc;

    if (p.pinStrength > 0) {
      const { dx, dy } = torusDelta(p.x, p.y, p.pinX, p.pinY, tw, th);
      p.x += dx * p.pinStrength;
      p.y += dy * p.pinStrength;
    }

    p.x = wrap(p.x, tw);
    p.y = wrap(p.y, th);

    p.fx = 0;
    p.fy = 0;
  }
}

function solveConstraints(s: Simplex, iterations: number) {
  const { tw, th } = s;
  for (let iter = 0; iter < iterations; iter++) {
    for (const c of s.constraints) {
      const pa = s.particles[c.a];
      const pb = s.particles[c.b];
      const { dx, dy } = torusDelta(pa.x, pa.y, pb.x, pb.y, tw, th);
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
      const diff = (dist - c.rest) / dist;
      const moveX = dx * diff * c.stiffness * 0.5;
      const moveY = dy * diff * c.stiffness * 0.5;
      if (pa.pinStrength < 1) {
        pa.x = wrap(pa.x + moveX, tw);
        pa.y = wrap(pa.y + moveY, th);
      }
      if (pb.pinStrength < 1) {
        pb.x = wrap(pb.x - moveX, tw);
        pb.y = wrap(pb.y - moveY, th);
      }
    }
  }
}

// --------------- Feature-driven forces ---------------

export function driveSimplex(
  s: Simplex,
  features: Features,
  rawAx: number,
  rawAy: number,
  dt: number,
) {
  const lerpRate = 0.08;
  s._amp += (features.amplitude - s._amp) * lerpRate;
  s._freq += (features.frequency - s._freq) * lerpRate;
  s._axis += (features.axis - s._axis) * lerpRate;
  s._smooth += (features.smoothness - s._smooth) * lerpRate;

  const stiffMul = 0.28 + s._smooth * 0.5;
  for (const c of s.constraints) {
    c.stiffness = stiffMul;
  }

  const dirAngle = s._axis * Math.PI;
  const speed = 0.6 + s._freq * 5.0;
  s.phase += speed * dt;
  const osc = Math.sin(s.phase);

  const forceMag = s._amp * 1.1;
  const core = s.particles[0];
  core.fx += Math.cos(dirAngle) * osc * forceMag;
  core.fy += Math.sin(dirAngle) * osc * forceMag;

  core.fx += rawAx * 2.4;
  core.fy += rawAy * 2.4;

  for (let i = 1; i < s.particles.length; i++) {
    const p = s.particles[i];
    const depthFalloff = 1 / (1 + p.depth * 0.5);
    const phaseShift = p.depth * 0.35;
    const localOsc = Math.sin(s.phase - phaseShift);
    p.fx += Math.cos(dirAngle) * localOsc * forceMag * depthFalloff * 0.28;
    p.fy += Math.sin(dirAngle) * localOsc * forceMag * depthFalloff * 0.28;
  }

  const breathAmp = 0.12 * (1 - s._amp * 0.85);
  for (let i = 1; i < s.particles.length; i++) {
    const p = s.particles[i];
    const { dx, dy } = torusDelta(s.cx, s.cy, p.x, p.y, s.tw, s.th);
    const angle = Math.atan2(dy, dx);
    const breathPhase = s.phase * 0.12 + p.depth * 0.25;
    p.fx += Math.cos(angle) * Math.sin(breathPhase) * breathAmp;
    p.fy += Math.sin(angle) * Math.sin(breathPhase) * breathAmp;
  }

  integrateParticles(s, dt);
  const constraintIter = s._smooth > 0.5 ? 5 : 4;
  solveConstraints(s, constraintIter);
}

// --------------- Rendering (torus-aware edges) ---------------

function drawTorusSegment(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  tw: number,
  th: number,
) {
  const { dx, dy } = torusDelta(ax, ay, bx, by, tw, th);
  const x1 = wrap(ax, tw);
  const y1 = wrap(ay, th);
  const x2 = wrap(ax + dx, tw);
  const y2 = wrap(ay + dy, th);
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
}

export function drawSimplex(
  ctx: CanvasRenderingContext2D,
  s: Simplex,
  opacity: number,
) {
  if (opacity <= 0.01) return;

  const hue = s._axis * 360;
  const sat = 15 + s._amp * 25;
  const { tw, th } = s;

  for (const c of s.constraints) {
    const pa = s.particles[c.a];
    const pb = s.particles[c.b];
    const avgDepth = (pa.depth + pb.depth) / 2;
    const lw = Math.max(0.7, 2.4 - avgDepth * 0.35);
    const edgeAlpha = opacity * (0.5 - avgDepth * 0.06);

    ctx.beginPath();
    drawTorusSegment(ctx, pa.x, pa.y, pb.x, pb.y, tw, th);
    ctx.strokeStyle = `hsla(${hue}, ${sat}%, 28%, ${Math.max(0.06, edgeAlpha)})`;
    ctx.lineWidth = lw;
    ctx.stroke();
  }

  for (const p of s.particles) {
    const r = p.depth === 0 ? 4.2 : Math.max(1.4, 3.2 - p.depth * 0.4);
    const nodeAlpha = opacity * (0.75 - p.depth * 0.08);
    const sx = wrap(p.x, tw);
    const sy = wrap(p.y, th);

    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, ${sat}%, 22%, ${Math.max(0.1, nodeAlpha)})`;
    ctx.fill();
  }
}

// --------------- Fusion (ring vertices = depth 1) ---------------

export function applyFusion(a: Simplex, b: Simplex, similarity: number, dt: number) {
  if (similarity < 0.25) return;

  const strength = (similarity - 0.25) / 0.75;
  const maxForce = 0.045 * strength;

  const tipsA = a.particles.filter((p) => p.depth >= 1);
  const tipsB = b.particles.filter((p) => p.depth >= 1);

  for (const ta of tipsA) {
    let bestD2 = Infinity;
    let bestTb: Particle | null = null;
    for (const tb of tipsB) {
      const { dx, dy } = torusDelta(ta.x, ta.y, tb.x, tb.y, a.tw, a.th);
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestTb = tb;
      }
    }
    if (!bestTb) continue;
    const dist = Math.sqrt(bestD2) || 1;
    const f = Math.min(maxForce, maxForce / (dist * 0.015 + 1));
    const { dx, dy } = torusDelta(ta.x, ta.y, bestTb.x, bestTb.y, a.tw, a.th);
    const nx = dx / dist;
    const ny = dy / dist;
    ta.fx += nx * f;
    ta.fy += ny * f;
    bestTb.fx -= nx * f * 0.35;
    bestTb.fy -= ny * f * 0.35;
  }

  integrateParticles(a, dt);
  integrateParticles(b, dt);
  const it = a._smooth > 0.5 ? 5 : 4;
  solveConstraints(a, it);
  solveConstraints(b, it);
}

export function drawFusionEdges(
  ctx: CanvasRenderingContext2D,
  a: Simplex,
  b: Simplex,
  similarity: number,
) {
  if (similarity < 0.35) return;
  const alpha = (similarity - 0.35) / 0.65;

  const tipsA = a.particles.filter((p) => p.depth >= 1);
  const tipsB = b.particles.filter((p) => p.depth >= 1);
  const maxDist = Math.min(a.tw, a.th) * 0.22;

  for (const ta of tipsA) {
    for (const tb of tipsB) {
      const { dx, dy } = torusDelta(ta.x, ta.y, tb.x, tb.y, a.tw, a.th);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDist) continue;

      const lineAlpha = alpha * (1 - dist / maxDist) * 0.32;
      ctx.beginPath();
      drawTorusSegment(ctx, ta.x, ta.y, tb.x, tb.y, a.tw, a.th);
      ctx.strokeStyle = `rgba(100, 85, 130, ${lineAlpha})`;
      ctx.lineWidth = 0.55;
      ctx.stroke();
    }
  }
}
