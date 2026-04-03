import type { Features } from "./dsp";

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
  pinStrength: number; // 0 = free, 1 = fully pinned
  depth: number; // 0 = core, increases outward
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
  phase: number;
  // smoothed drive params
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

// --------------- Topology builder ---------------

const ARM_COUNT = 5;
const ARM_SEGMENTS = 4;
const BRANCH_SEGMENTS = 2;
const BRANCH_FORK = 2;
const REST_LEN = 28;

export function createSimplex(cx: number, cy: number): Simplex {
  const particles: Particle[] = [];
  const constraints: Constraint[] = [];

  // Core
  const core = makeParticle(cx, cy, 0);
  core.pinX = cx;
  core.pinY = cy;
  core.pinStrength = 0.06;
  particles.push(core);

  for (let a = 0; a < ARM_COUNT; a++) {
    const angle = (a / ARM_COUNT) * Math.PI * 2 - Math.PI / 2;
    let prevIdx = 0;

    for (let s = 1; s <= ARM_SEGMENTS; s++) {
      const r = REST_LEN * s;
      const px = cx + Math.cos(angle) * r + (Math.random() - 0.5) * 4;
      const py = cy + Math.sin(angle) * r + (Math.random() - 0.5) * 4;
      const p = makeParticle(px, py, s);
      const idx = particles.length;
      particles.push(p);
      constraints.push({ a: prevIdx, b: idx, rest: REST_LEN, stiffness: 0.4 });
      prevIdx = idx;
    }

    // Branch forks from arm tip
    const tipIdx = prevIdx;
    for (let f = 0; f < BRANCH_FORK; f++) {
      const forkAngle = angle + ((f - (BRANCH_FORK - 1) / 2) * 0.7);
      let bPrev = tipIdx;
      for (let bs = 1; bs <= BRANCH_SEGMENTS; bs++) {
        const depth = ARM_SEGMENTS + bs;
        const r = REST_LEN * (ARM_SEGMENTS + bs);
        const bx = cx + Math.cos(forkAngle) * r + (Math.random() - 0.5) * 4;
        const by = cy + Math.sin(forkAngle) * r + (Math.random() - 0.5) * 4;
        const bp = makeParticle(bx, by, depth);
        const bIdx = particles.length;
        particles.push(bp);
        constraints.push({ a: bPrev, b: bIdx, rest: REST_LEN * 0.85, stiffness: 0.3 });
        bPrev = bIdx;
      }
    }
  }

  // Cross-brace: connect each arm root to adjacent arm roots for structural stability
  for (let a = 0; a < ARM_COUNT; a++) {
    const rootA = 1 + a * (ARM_SEGMENTS + BRANCH_FORK * BRANCH_SEGMENTS);
    const rootB = 1 + ((a + 1) % ARM_COUNT) * (ARM_SEGMENTS + BRANCH_FORK * BRANCH_SEGMENTS);
    if (rootA < particles.length && rootB < particles.length) {
      const dx = particles[rootA].x - particles[rootB].x;
      const dy = particles[rootA].y - particles[rootB].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      constraints.push({ a: rootA, b: rootB, rest: dist, stiffness: 0.15 });
    }
  }

  return {
    particles, constraints, cx, cy,
    phase: Math.random() * Math.PI * 2,
    _amp: 0, _freq: 0, _axis: 0.5, _smooth: 0,
  };
}

// --------------- Physics step ---------------

const DAMPING_BASE = 0.96;
const GRAVITY = 0;

function integrateParticles(s: Simplex, dt: number) {
  for (const p of s.particles) {
    const vx = (p.x - p.px) * DAMPING_BASE;
    const vy = (p.y - p.py) * DAMPING_BASE;

    p.px = p.x;
    p.py = p.y;

    p.x += vx + p.fx * dt * dt;
    p.y += vy + (p.fy + GRAVITY) * dt * dt;

    // Pin spring
    if (p.pinStrength > 0) {
      p.x += (p.pinX - p.x) * p.pinStrength;
      p.y += (p.pinY - p.y) * p.pinStrength;
    }

    p.fx = 0;
    p.fy = 0;
  }
}

function solveConstraints(s: Simplex, iterations: number) {
  for (let iter = 0; iter < iterations; iter++) {
    for (const c of s.constraints) {
      const pa = s.particles[c.a];
      const pb = s.particles[c.b];
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
      const diff = (dist - c.rest) / dist;
      const moveX = dx * diff * c.stiffness * 0.5;
      const moveY = dy * diff * c.stiffness * 0.5;
      if (pa.pinStrength < 1) { pa.x += moveX; pa.y += moveY; }
      if (pb.pinStrength < 1) { pb.x -= moveX; pb.y -= moveY; }
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

  // Smoothness --> damping and stiffness
  // smooth (low jerk) = low stiffness, high damping --> fluid
  // jerky (high jerk) = high stiffness, low damping --> snappy
  const stiffMul = 0.25 + s._smooth * 0.55;
  for (const c of s.constraints) {
    c.stiffness = stiffMul;
  }

  // Direction angle from axis feature
  const dirAngle = s._axis * Math.PI; // 0..PI maps to horizontal..vertical

  // Oscillation
  const speed = 1.0 + s._freq * 8.0;
  s.phase += speed * dt;
  const osc = Math.sin(s.phase);

  // Force magnitude
  const forceMag = s._amp * 420;

  // Oscillating directional force on core
  const core = s.particles[0];
  core.fx += Math.cos(dirAngle) * osc * forceMag * 0.5;
  core.fy += Math.sin(dirAngle) * osc * forceMag * 0.5;

  // Direct raw sensor force on core for instant responsiveness
  core.fx += rawAx * 280;
  core.fy += rawAy * 280;

  // Propagate attenuated force to arm roots and deeper particles
  for (let i = 1; i < s.particles.length; i++) {
    const p = s.particles[i];
    const depthFalloff = 1 / (1 + p.depth * 0.6);
    // Phase-shifted oscillation per depth for wave-like propagation
    const phaseShift = p.depth * 0.4;
    const localOsc = Math.sin(s.phase - phaseShift);
    p.fx += Math.cos(dirAngle) * localOsc * forceMag * depthFalloff * 0.3;
    p.fy += Math.sin(dirAngle) * localOsc * forceMag * depthFalloff * 0.3;
  }

  // Idle breath: ambient micro-motion so figure never looks dead
  const breathAmp = 8 * (1 - s._amp * 0.8);
  for (let i = 1; i < s.particles.length; i++) {
    const p = s.particles[i];
    const angle = Math.atan2(p.y - s.cy, p.x - s.cx);
    const breathPhase = s.phase * 0.15 + p.depth * 0.3;
    p.fx += Math.cos(angle) * Math.sin(breathPhase) * breathAmp;
    p.fy += Math.sin(angle) * Math.sin(breathPhase) * breathAmp;
  }

  // Step physics
  integrateParticles(s, dt);
  const constraintIter = s._smooth > 0.5 ? 4 : 3;
  solveConstraints(s, constraintIter);
}

// --------------- Rendering ---------------

export function drawSimplex(
  ctx: CanvasRenderingContext2D,
  s: Simplex,
  opacity: number,
) {
  if (opacity <= 0.01) return;

  const hue = s._axis * 360;
  const sat = 15 + s._amp * 25;

  // Edges
  for (const c of s.constraints) {
    const pa = s.particles[c.a];
    const pb = s.particles[c.b];
    const avgDepth = (pa.depth + pb.depth) / 2;
    const lw = Math.max(0.6, 2.2 - avgDepth * 0.25);
    const edgeAlpha = opacity * (0.55 - avgDepth * 0.04);

    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.strokeStyle = `hsla(${hue}, ${sat}%, 28%, ${Math.max(0.05, edgeAlpha)})`;
    ctx.lineWidth = lw;
    ctx.stroke();
  }

  // Nodes
  for (const p of s.particles) {
    const r = p.depth === 0 ? 3.5 : Math.max(1.2, 2.8 - p.depth * 0.3);
    const nodeAlpha = opacity * (0.7 - p.depth * 0.04);

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, ${sat}%, 22%, ${Math.max(0.08, nodeAlpha)})`;
    ctx.fill();
  }
}

// --------------- Fusion ---------------

export function applyFusion(a: Simplex, b: Simplex, similarity: number) {
  if (similarity < 0.3) return;

  const strength = (similarity - 0.3) / 0.7;
  const maxForce = 12 * strength;

  // Attract tip particles (highest depth) between the two figures
  const tipsA = a.particles.filter((p) => p.depth >= ARM_SEGMENTS);
  const tipsB = b.particles.filter((p) => p.depth >= ARM_SEGMENTS);

  for (const ta of tipsA) {
    let bestDist = Infinity;
    let bestTb: Particle | null = null;
    for (const tb of tipsB) {
      const dx = tb.x - ta.x;
      const dy = tb.y - ta.y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; bestTb = tb; }
    }
    if (!bestTb) continue;
    const dist = Math.sqrt(bestDist) || 1;
    const f = Math.min(maxForce, maxForce / (dist * 0.02 + 1));
    const dx = bestTb.x - ta.x;
    const dy = bestTb.y - ta.y;
    ta.fx += (dx / dist) * f;
    ta.fy += (dy / dist) * f;
    bestTb.fx -= (dx / dist) * f * 0.3;
    bestTb.fy -= (dy / dist) * f * 0.3;
  }
}

// --------------- Fusion edge rendering ---------------

export function drawFusionEdges(
  ctx: CanvasRenderingContext2D,
  a: Simplex,
  b: Simplex,
  similarity: number,
) {
  if (similarity < 0.4) return;
  const alpha = (similarity - 0.4) / 0.6;

  const tipsA = a.particles.filter((p) => p.depth >= ARM_SEGMENTS);
  const tipsB = b.particles.filter((p) => p.depth >= ARM_SEGMENTS);

  const maxDist = 120;

  for (const ta of tipsA) {
    for (const tb of tipsB) {
      const dx = tb.x - ta.x;
      const dy = tb.y - ta.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDist) continue;

      const lineAlpha = alpha * (1 - dist / maxDist) * 0.35;
      ctx.beginPath();
      ctx.moveTo(ta.x, ta.y);
      ctx.lineTo(tb.x, tb.y);
      ctx.strokeStyle = `rgba(120, 100, 140, ${lineAlpha})`;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }
}
