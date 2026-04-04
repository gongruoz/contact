import type { Features } from "./dsp";

// --------------- Verlet (Euclidean plane, no torus) ---------------

interface Particle {
  x: number;
  y: number;
  px: number;
  py: number;
  fx: number;
  fy: number;
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
  /** World anchor: center of mass is locked here; structure does not drift with motion */
  cx: number;
  cy: number;
  phase: number;
  _amp: number;
  _freq: number;
  _axis: number;
  _smooth: number;
}

function makeParticle(x: number, y: number, depth: number): Particle {
  return { x, y, px: x, py: y, fx: 0, fy: 0, depth };
}

// --------------- Four nodes, cycle only (edges can cross when twisted) ---------------

const N = 4;
/** Initial radius from anchor — large enough to read */
const R0 = 102;

export function createSimplex(cx: number, cy: number): Simplex {
  const particles: Particle[] = [];
  const constraints: Constraint[] = [];

  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(ang) * R0;
    const py = cy + Math.sin(ang) * R0;
    particles.push(makeParticle(px, py, 0));
  }

  for (let i = 0; i < N; i++) {
    const a = i;
    const b = (i + 1) % N;
    const pa = particles[a];
    const pb = particles[b];
    const d0 = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    constraints.push({ a, b, rest: d0, stiffness: 0.22 });
  }

  return {
    particles, constraints, cx, cy,
    phase: Math.random() * Math.PI * 2,
    _amp: 0, _freq: 0, _axis: 0.5, _smooth: 0,
  };
}

/** Keep centroid on anchor — motion never translates the whole figure */
function lockCenterOfMass(s: Simplex) {
  const ps = s.particles;
  let mx = 0;
  let my = 0;
  for (const p of ps) {
    mx += p.x;
    my += p.y;
  }
  mx /= ps.length;
  my /= ps.length;
  const dx = s.cx - mx;
  const dy = s.cy - my;
  for (const p of ps) {
    p.x += dx;
    p.y += dy;
    p.px += dx;
    p.py += dy;
  }
}

const DAMPING_BASE = 0.988;
const ACC_SCALE = 7200;

function integrateParticles(s: Simplex, dt: number) {
  const acc = dt * dt * ACC_SCALE;
  for (const p of s.particles) {
    const vx = (p.x - p.px) * DAMPING_BASE;
    const vy = (p.y - p.py) * DAMPING_BASE;
    p.px = p.x;
    p.py = p.y;
    p.x += vx + p.fx * acc;
    p.y += vy + p.fy * acc;
    p.fx = 0;
    p.fy = 0;
  }
}

function solveConstraints(s: Simplex, iterations: number) {
  for (let iter = 0; iter < iterations; iter++) {
    for (const c of s.constraints) {
      const pa = s.particles[c.a];
      const pb = s.particles[c.b];
      let dx = pb.x - pa.x;
      let dy = pb.y - pa.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
      const diff = (dist - c.rest) / dist;
      const moveX = dx * diff * c.stiffness * 0.5;
      const moveY = dy * diff * c.stiffness * 0.5;
      pa.x += moveX;
      pa.y += moveY;
      pb.x -= moveX;
      pb.y -= moveY;
    }
  }
}

/** Edge rest lengths breathe slowly toward current span — soft, twist-friendly */
function adaptRestLengths(s: Simplex) {
  for (const c of s.constraints) {
    const pa = s.particles[c.a];
    const pb = s.particles[c.b];
    const d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    c.rest += (d - c.rest) * 0.04;
  }
}

function com(s: Simplex) {
  let mx = 0;
  let my = 0;
  for (const p of s.particles) {
    mx += p.x;
    my += p.y;
  }
  const n = s.particles.length;
  return { x: mx / n, y: my / n };
}

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

  const stiffMul = 0.18 + s._smooth * 0.55;
  for (const c of s.constraints) {
    c.stiffness = stiffMul;
  }

  const dirAngle = s._axis * Math.PI;
  const speed = 0.55 + s._freq * 4.5;
  s.phase += speed * dt;
  const osc = Math.sin(s.phase);

  const { x: cx, y: cy } = com(s);

  const forceMag = s._amp * 0.95;
  // Tangential unit from (rawAx, rawAy) — twist, zero net linear push on COM
  const rawLen = Math.hypot(rawAx, rawAy) || 1e-8;
  const tx = -rawAy / rawLen;
  const ty = rawAx / rawLen;

  for (let i = 0; i < N; i++) {
    const p = s.particles[i];
    const rx = p.x - cx;
    const ry = p.y - cy;
    const rl = Math.hypot(rx, ry) || 1e-8;
    const ux = rx / rl;
    const uy = ry / rl;
    // radial breathing (alternating)
    const phase = (i / N) * Math.PI * 2;
    const rad = osc * forceMag * Math.cos(s.phase * 0.5 + phase);
    p.fx += ux * rad;
    p.fy += uy * rad;
    // twist: tangential to orbit, driven by sensor
    const twist = (tx * -uy + ty * ux) * rawLen * 2.8;
    p.fx += -uy * twist;
    p.fy += ux * twist;
    // axis-aligned oscillation (choreographic)
    p.fx += Math.cos(dirAngle) * osc * forceMag * 0.35;
    p.fy += Math.sin(dirAngle) * osc * forceMag * 0.35;
  }

  const breath = 0.1 * (1 - s._amp * 0.8);
  for (let i = 0; i < N; i++) {
    const p = s.particles[i];
    const rx = p.x - cx;
    const ry = p.y - cy;
    const rl = Math.hypot(rx, ry) || 1;
    const ux = rx / rl;
    const uy = ry / rl;
    const bp = s.phase * 0.15 + i * 0.9;
    p.fx += ux * Math.sin(bp) * breath;
    p.fy += uy * Math.sin(bp) * breath;
  }

  adaptRestLengths(s);

  integrateParticles(s, dt);
  const constraintIter = s._smooth > 0.5 ? 6 : 5;
  solveConstraints(s, constraintIter);
  lockCenterOfMass(s);
}

// --------------- Rendering: gap between edge and dot (breathing line) ---------------

const NODE_GAP = 6;
const NODE_R = 4;

function drawEdgeGapped(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  gap: number,
) {
  let dx = bx - ax;
  let dy = by - ay;
  const len = Math.hypot(dx, dy) || 1e-8;
  dx /= len;
  dy /= len;
  const t = Math.max(0, len - 2 * gap);
  if (t < 1) return;
  const x1 = ax + dx * gap;
  const y1 = ay + dy * gap;
  const x2 = ax + dx * (gap + t);
  const y2 = ay + dy * (gap + t);
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
}

export type SimplexDrawRole = "self" | "peer";

export function drawSimplex(
  ctx: CanvasRenderingContext2D,
  s: Simplex,
  opacity: number,
  role: SimplexDrawRole = "self",
) {
  if (opacity <= 0.01) return;

  const strokeA = role === "self" ? opacity * 0.52 : opacity * 0.55;
  const fillA = role === "self" ? opacity * 0.92 : opacity * 0.82;
  const strokeStyle =
    role === "self" ? `rgba(0,0,0,${strokeA})` : `rgba(178,178,182,${strokeA})`;
  const fillStyle =
    role === "self" ? `rgba(0,0,0,${fillA})` : `rgba(188,188,192,${fillA})`;

  ctx.beginPath();
  for (const c of s.constraints) {
    const pa = s.particles[c.a];
    const pb = s.particles[c.b];
    drawEdgeGapped(ctx, pa.x, pa.y, pb.x, pb.y, NODE_GAP);
  }
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = role === "self" ? 1.35 : 1.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();

  for (const p of s.particles) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, NODE_R, 0, Math.PI * 2);
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
}

// --------------- Fusion (pairwise nodes, Euclidean) ---------------

export function applyFusion(a: Simplex, b: Simplex, similarity: number, dt: number) {
  if (similarity < 0.22) return;

  const strength = (similarity - 0.22) / 0.78;
  const maxF = 0.05 * strength;

  for (const ta of a.particles) {
    let best = Infinity;
    let bestTb: Particle | null = null;
    for (const tb of b.particles) {
      const dx = tb.x - ta.x;
      const dy = tb.y - ta.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        bestTb = tb;
      }
    }
    if (!bestTb) continue;
    const dist = Math.sqrt(best) || 1;
    const f = Math.min(maxF, maxF / (dist * 0.012 + 1));
    const dx = bestTb.x - ta.x;
    const dy = bestTb.y - ta.y;
    const nx = dx / dist;
    const ny = dy / dist;
    ta.fx += nx * f;
    ta.fy += ny * f;
    bestTb.fx -= nx * f * 0.4;
    bestTb.fy -= ny * f * 0.4;
  }

  integrateParticles(a, dt);
  integrateParticles(b, dt);
  const it = a._smooth > 0.5 ? 5 : 4;
  solveConstraints(a, it);
  solveConstraints(b, it);
  lockCenterOfMass(a);
  lockCenterOfMass(b);
}

export function drawFusionEdges(
  ctx: CanvasRenderingContext2D,
  a: Simplex,
  b: Simplex,
  similarity: number,
) {
  if (similarity < 0.32) return;
  const alpha = (similarity - 0.32) / 0.68;
  const maxDist = 220;

  for (const ta of a.particles) {
    for (const tb of b.particles) {
      const dx = tb.x - ta.x;
      const dy = tb.y - ta.y;
      const dist = Math.hypot(dx, dy);
      if (dist > maxDist) continue;
      const lineAlpha = alpha * (1 - dist / maxDist) * 0.28;
      if (lineAlpha < 0.01) continue;
      ctx.beginPath();
      drawEdgeGapped(ctx, ta.x, ta.y, tb.x, tb.y, NODE_GAP);
      ctx.strokeStyle = `rgba(140, 140, 145, ${lineAlpha})`;
      ctx.lineWidth = 0.55;
      ctx.lineCap = "round";
      ctx.stroke();
    }
  }
}
