import type { Features } from "./dsp";

// ---- Types ----

export interface Joint {
  name: string;
  x: number; y: number;
  px: number; py: number;
  fx: number; fy: number;
  restX: number; restY: number;
  driftFreq: number;
  driftAmp: number;
  driftPhase: number;
}

export interface Bone {
  a: string;
  b: string;
  rest: number;
  baseRest: number;
  stiffness: number;
  render: boolean;
}

export interface Skeleton {
  joints: Record<string, Joint>;
  bones: Bone[];
  cx: number; cy: number;
  phase: number;
  activeJoint: string;
  distances: Record<string, number>;
  focusTimer: number;
  focusInterval: number;
  leanX: number; leanY: number;
  tiltSmoothed: number;
  smRawX: number; smRawY: number;
  _amp: number; _freq: number; _axis: number; _smooth: number;
  _speed: number; _rhythm: number;
}

export interface SkeletonMergePair {
  joint: string;
  strength: number;
}

// ---- Joint definitions (rest positions relative to center) ----

const REST_POSITIONS: Record<string, { x: number; y: number }> = {
  head:       { x: 0,    y: -110 },
  torso:      { x: 0,    y: -50  },
  shoulder_l: { x: -38,  y: -75  },
  shoulder_r: { x: 38,   y: -75  },
  elbow_l:    { x: -62,  y: -38  },
  elbow_r:    { x: 62,   y: -38  },
  hand_l:     { x: -78,  y: 2    },
  hand_r:     { x: 78,   y: 2    },
  hip:        { x: 0,    y: 10   },
  knee_l:     { x: -24,  y: 62   },
  knee_r:     { x: 24,   y: 62   },
  foot_l:     { x: -32,  y: 115  },
  foot_r:     { x: 32,   y: 115  },
};

const BONE_DEFS: { a: string; b: string; render: boolean }[] = [
  // spine
  { a: "head",       b: "torso",      render: true  },
  { a: "torso",      b: "hip",        render: true  },
  // arms
  { a: "torso",      b: "shoulder_l", render: true  },
  { a: "torso",      b: "shoulder_r", render: true  },
  { a: "shoulder_l", b: "elbow_l",    render: true  },
  { a: "shoulder_r", b: "elbow_r",    render: true  },
  { a: "elbow_l",    b: "hand_l",     render: true  },
  { a: "elbow_r",    b: "hand_r",     render: true  },
  // legs
  { a: "hip",        b: "knee_l",     render: true  },
  { a: "hip",        b: "knee_r",     render: true  },
  { a: "knee_l",     b: "foot_l",     render: true  },
  { a: "knee_r",     b: "foot_r",     render: true  },
  // cross-bracing (structural only)
  { a: "shoulder_l", b: "hip",        render: false },
  { a: "shoulder_r", b: "hip",        render: false },
  { a: "shoulder_l", b: "shoulder_r", render: false },
  { a: "knee_l",     b: "knee_r",     render: false },
];

const JOINT_NAMES = Object.keys(REST_POSITIONS);

// ---- Adjacency for BFS (uses ALL bones, including cross-bracing) ----

const ADJ: Record<string, string[]> = {};
for (const name of JOINT_NAMES) ADJ[name] = [];
for (const b of BONE_DEFS) {
  ADJ[b.a].push(b.b);
  ADJ[b.b].push(b.a);
}

// ---- Creation ----

const EXTREMITIES = new Set(["hand_l", "hand_r", "foot_l", "foot_r", "head"]);

function mkJoint(name: string, wx: number, wy: number): Joint {
  const rest = REST_POSITIONS[name];
  const x = wx + rest.x;
  const y = wy + rest.y;
  const isExtremity = EXTREMITIES.has(name);
  return {
    name, x, y, px: x, py: y, fx: 0, fy: 0,
    restX: rest.x, restY: rest.y,
    driftFreq: 0.22 + Math.random() * 0.5,
    driftAmp: isExtremity ? 2.5 + Math.random() * 4.0 : 1.2 + Math.random() * 2.8,
    driftPhase: Math.random() * Math.PI * 2,
  };
}

export function createSkeleton(cx: number, cy: number): Skeleton {
  const joints: Record<string, Joint> = {};
  for (const name of JOINT_NAMES) {
    joints[name] = mkJoint(name, cx, cy);
  }

  const bones: Bone[] = BONE_DEFS.map((def) => {
    const ja = joints[def.a], jb = joints[def.b];
    const d = Math.hypot(jb.x - ja.x, jb.y - ja.y);
    return {
      a: def.a, b: def.b, rest: d, baseRest: d,
      stiffness: def.render ? 0.12 : 0.04,
      render: def.render,
    };
  });

  const s: Skeleton = {
    joints, bones, cx, cy,
    phase: Math.random() * Math.PI * 2,
    activeJoint: "torso",
    distances: {},
    focusTimer: 0,
    focusInterval: 2500 + Math.random() * 1500,
    leanX: 0, leanY: 0, tiltSmoothed: 0,
    smRawX: 0, smRawY: 0,
    _amp: 0, _freq: 0, _axis: 0.5, _smooth: 0,
    _speed: 0, _rhythm: 0,
  };

  s.distances = computeDistances(s.activeJoint);
  return s;
}

// ---- BFS distance computation ----

function computeDistances(from: string): Record<string, number> {
  const dist: Record<string, number> = { [from]: 0 };
  const queue = [from];
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    for (const neighbor of ADJ[cur]) {
      if (dist[neighbor] === undefined) {
        dist[neighbor] = dist[cur] + 1;
        queue.push(neighbor);
      }
    }
  }
  return dist;
}

function conductance(hops: number): number {
  return Math.pow(0.58, hops);
}

// ---- Physics ----

function comXY(joints: Record<string, Joint>) {
  let x = 0, y = 0, n = 0;
  for (const j of Object.values(joints)) {
    x += j.x; y += j.y; n++;
  }
  return { x: x / n, y: y / n };
}

function lockCOM(s: Skeleton) {
  const { x: mx, y: my } = comXY(s.joints);
  const ax = s.cx + s.leanX;
  const ay = s.cy + s.leanY;
  const dx = ax - mx, dy = ay - my;
  for (const j of Object.values(s.joints)) {
    j.x += dx; j.y += dy;
    j.px += dx; j.py += dy;
  }
}

function rotateAroundAnchor(s: Skeleton, ax: number, ay: number, dTheta: number) {
  if (Math.abs(dTheta) < 1e-7) return;
  const c = Math.cos(dTheta), si = Math.sin(dTheta);
  for (const j of Object.values(s.joints)) {
    const rx = j.x - ax, ry = j.y - ay;
    j.x = ax + rx * c - ry * si;
    j.y = ay + rx * si + ry * c;
    const rpx = j.px - ax, rpy = j.py - ay;
    j.px = ax + rpx * c - rpy * si;
    j.py = ay + rpx * si + rpy * c;
  }
}

const DAMP = 0.952;
const ACC = 4000;

function integrate(s: Skeleton, dt: number, impulseMul = 1) {
  const a = dt * dt * ACC * impulseMul;
  const d = DAMP - s._smooth * 0.05;
  for (const j of Object.values(s.joints)) {
    const vx = (j.x - j.px) * d;
    const vy = (j.y - j.py) * d;
    j.px = j.x; j.py = j.y;
    j.x += vx + j.fx * a;
    j.y += vy + j.fy * a;
    j.fx = 0; j.fy = 0;
  }
}

function solve(s: Skeleton, iter: number) {
  for (let k = 0; k < iter; k++) {
    for (const b of s.bones) {
      const ja = s.joints[b.a], jb = s.joints[b.b];
      const dx = jb.x - ja.x, dy = jb.y - ja.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
      const diff = (dist - b.rest) / dist;
      const h = b.stiffness * 0.5;
      ja.x += dx * diff * h; ja.y += dy * diff * h;
      jb.x -= dx * diff * h; jb.y -= dy * diff * h;
    }
  }
}

function adaptRest(s: Skeleton) {
  for (const b of s.bones) {
    const ja = s.joints[b.a], jb = s.joints[b.b];
    const d = Math.hypot(jb.x - ja.x, jb.y - ja.y);
    const rate = b.render ? 0.08 : 0.015;
    const lo = b.baseRest * 0.4, hi = b.baseRest * 2.2;
    const target = Math.max(lo, Math.min(hi, d));
    b.rest += (target - b.rest) * rate;
  }
}

function spreadPressure(s: Skeleton) {
  const { x: cx, y: cy } = comXY(s.joints);
  const minR = 18;
  for (const j of Object.values(s.joints)) {
    const dx = j.x - cx, dy = j.y - cy;
    const d = Math.hypot(dx, dy);
    if (d < minR && d > 0.01) {
      const push = ((minR - d) / minR) * 0.3;
      j.fx += (dx / d) * push;
      j.fy += (dy / d) * push;
    }
  }
}

function boneMinLength(s: Skeleton) {
  const minLen = 12;
  for (const b of s.bones) {
    if (!b.render) continue;
    const ja = s.joints[b.a], jb = s.joints[b.b];
    const dx = jb.x - ja.x, dy = jb.y - ja.y;
    const d = Math.hypot(dx, dy);
    if (d < minLen && d > 0.01) {
      const push = ((minLen - d) / minLen) * 0.25;
      const nx = dx / d, ny = dy / d;
      ja.fx -= nx * push; ja.fy -= ny * push;
      jb.fx += nx * push; jb.fy += ny * push;
    }
  }
}

// ---- Focus migration ----

function updateFocus(s: Skeleton, dt: number, rawAx: number, rawAy: number) {
  s.focusTimer += dt * 1000;
  if (s.focusTimer < s.focusInterval) return;
  s.focusTimer = 0;
  s.focusInterval = 2500 + Math.random() * 1500;

  if (Math.random() > 0.4) return;

  const neighbors = ADJ[s.activeJoint];
  if (!neighbors.length) return;

  if (Math.random() < 0.08) {
    const all = JOINT_NAMES;
    s.activeJoint = all[Math.floor(Math.random() * all.length)];
  } else {
    const active = s.joints[s.activeJoint];
    const weighted: { name: string; w: number }[] = neighbors.map((n) => {
      const nj = s.joints[n];
      const dx = nj.restX - active.restX;
      const dy = nj.restY - active.restY;
      const len = Math.hypot(dx, dy) || 1;
      const dot = (dx / len) * rawAx + (dy / len) * rawAy;
      return { name: n, w: dot > 0.1 ? 3 : 1 };
    });
    let total = 0;
    for (const w of weighted) total += w.w;
    let r = Math.random() * total;
    for (const w of weighted) {
      r -= w.w;
      if (r <= 0) { s.activeJoint = w.name; break; }
    }
  }

  s.distances = computeDistances(s.activeJoint);
}

// ---- Drive (sensor → forces) ----

export function driveSkeleton(
  s: Skeleton, f: Features,
  rawAx: number, rawAy: number,
  dt: number,
) {
  const lr = 0.065;
  s._amp += (f.amplitude - s._amp) * lr;
  s._freq += (f.frequency - s._freq) * lr;
  s._axis += (f.axis - s._axis) * lr;
  s._smooth += (f.smoothness - s._smooth) * lr;
  s._speed += (f.speed - s._speed) * lr;
  s._rhythm += (f.rhythm - s._rhythm) * lr;

  const spd = 0.3 + s._freq * 2.8;
  s.phase += spd * dt;

  const rawLen = Math.hypot(rawAx, rawAy);
  const amp = s._amp;
  const motionMag = Math.min(1, rawLen * 1.2);
  const express = Math.max(0.3, Math.min(1.4, 0.35 + amp * 0.4 + motionMag * 0.55));

  const eStiff = Math.max(0.03, (0.06 + s._smooth * 0.08) * (1 - 0.2 * motionMag));
  const bStiff = Math.max(0.01, (0.02 + s._smooth * 0.03) * (1 - 0.15 * motionMag));
  for (const b of s.bones) b.stiffness = b.render ? eStiff : bStiff;

  // lean toward motion
  const maxLean = 70 * express;
  const leanTx = rawAx * maxLean;
  const leanTy = rawAy * maxLean;
  s.leanX += (leanTx - s.leanX) * 0.14;
  s.leanY += (leanTy - s.leanY) * 0.14;

  // tilt
  let tiltTarget = 0;
  if (rawLen > 0.02) {
    tiltTarget = Math.atan2(rawAy, rawAx) * 0.4;
    tiltTarget = Math.max(-0.75, Math.min(0.75, tiltTarget));
  }
  const prevTilt = s.tiltSmoothed;
  s.tiltSmoothed += (tiltTarget - s.tiltSmoothed) * 0.12;
  const dTilt = s.tiltSmoothed - prevTilt;

  // focus migration
  updateFocus(s, dt, rawAx, rawAy);

  // force direction from raw input
  const fdx = rawLen > 0.01 ? rawAx / rawLen : 0;
  const fdy = rawLen > 0.01 ? rawAy / rawLen : 0;
  const forceMag = amp * Math.max(0.3, s._speed) * 14;

  // rhythm → phase spread: high rhythm = small spread, low = large
  const phaseSpread = (1 - s._rhythm) * 1.4;

  const t = performance.now() / 1000;
  const { x: comx, y: comy } = comXY(s.joints);

  for (const j of Object.values(s.joints)) {
    const hops = s.distances[j.name] ?? 6;
    const c = conductance(hops);

    const phaseOff = hops * phaseSpread * 0.4;

    // driven force scaled by conductance
    j.fx += fdx * forceMag * c;
    j.fy += fdy * forceMag * c;

    // breathing: radial push/pull from COM
    const rx = j.x - comx, ry = j.y - comy;
    const rl = Math.hypot(rx, ry) || 1e-8;
    const ux = rx / rl, uy = ry / rl;
    const off = (JOINT_NAMES.indexOf(j.name) / JOINT_NAMES.length) * Math.PI * 2;

    const breathe = (0.10 + amp * 0.45 + motionMag * 0.35) *
      Math.sin(s.phase + off + phaseOff);
    j.fx += ux * breathe;
    j.fy += uy * breathe;

    // spontaneous drift (inverse of conductance — distant joints have more autonomy)
    const spontW = (1 - c) * 0.12 + 0.02;
    j.fx += Math.sin(t * j.driftFreq + j.driftPhase) * j.driftAmp * spontW;
    j.fy += Math.cos(t * j.driftFreq * 0.7 + j.driftPhase) * j.driftAmp * spontW;

    // torque from raw motion (perpendicular shear for organic twist)
    if (rawLen > 0.008) {
      const px = -fdy, py = fdx;
      const tw = (px * -uy + py * ux) * rawLen * (1.1 + motionMag * 0.9);
      j.fx += -uy * tw * c;
      j.fy += ux * tw * c;
    }
  }

  spreadPressure(s);
  boneMinLength(s);
  adaptRest(s);
  integrate(s, dt, 1 + motionMag * 0.8);
  solve(s, 6);
  lockCOM(s);
  rotateAroundAnchor(s, s.cx + s.leanX, s.cy + s.leanY, dTilt);
}

// ---- Rendering ----

const GAP = 7;
const NR = 2.8;
const ACTIVE_NR = 4;

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

export function drawSkeleton(
  ctx: CanvasRenderingContext2D, s: Skeleton,
  opacity: number, role: DrawRole = "self",
) {
  if (opacity <= 0.01) return;

  const sA = role === "self" ? opacity * 0.48 : opacity * 0.50;
  const fA = role === "self" ? opacity * 0.88 : opacity * 0.78;
  const stroke = role === "self" ? `rgba(0,0,0,${sA})` : `rgba(178,178,182,${sA})`;
  const fill = role === "self" ? `rgba(0,0,0,${fA})` : `rgba(188,188,192,${fA})`;

  // bones
  ctx.beginPath();
  for (const b of s.bones) {
    if (!b.render) continue;
    const ja = s.joints[b.a], jb = s.joints[b.b];
    gappedLine(ctx, ja.x, ja.y, jb.x, jb.y, GAP);
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = role === "self" ? 1.0 : 0.85;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.stroke();

  // joints
  for (const j of Object.values(s.joints)) {
    const isActive = j.name === s.activeJoint;
    const r = isActive ? ACTIVE_NR : NR;
    ctx.beginPath();
    ctx.arc(j.x, j.y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  // subtle pulse ring on active joint
  const aj = s.joints[s.activeJoint];
  const pulse = 1.2 + 0.2 * Math.sin(s.phase * 1.5);
  ctx.beginPath();
  ctx.arc(aj.x, aj.y, ACTIVE_NR * pulse, 0, Math.PI * 2);
  ctx.strokeStyle = role === "self"
    ? `rgba(0,0,0,${opacity * 0.18})`
    : `rgba(178,178,182,${opacity * 0.18})`;
  ctx.lineWidth = 0.5;
  ctx.stroke();
}

// ---- Merge ----

const MERGE_REGIONS: { threshold: number; joints: string[] }[] = [
  { threshold: 0.15, joints: ["torso", "hip"] },
  { threshold: 0.35, joints: ["shoulder_l", "shoulder_r", "knee_l", "knee_r"] },
  { threshold: 0.55, joints: ["elbow_l", "elbow_r", "head"] },
  { threshold: 0.78, joints: ["hand_l", "hand_r", "foot_l", "foot_r"] },
];

export function computeSkeletonMergePairs(
  similarity: number,
): SkeletonMergePair[] {
  const pairs: SkeletonMergePair[] = [];
  for (const region of MERGE_REGIONS) {
    if (similarity < region.threshold) continue;
    const fullAt = region.threshold + 0.18;
    const str = Math.min(1, Math.max(0,
      (similarity - region.threshold) / (fullAt - region.threshold)));
    for (const jn of region.joints) {
      pairs.push({ joint: jn, strength: str });
    }
  }
  return pairs;
}

export function applySkeletonFusion(
  self: Skeleton, peer: Skeleton,
  pairs: SkeletonMergePair[], dt: number,
) {
  if (pairs.length === 0) return;

  for (const { joint, strength } of pairs) {
    if (strength < 0.01) continue;
    const sj = self.joints[joint], pj = peer.joints[joint];
    if (!sj || !pj) continue;
    const dx = pj.x - sj.x, dy = pj.y - sj.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist, ny = dy / dist;
    const f = strength * 0.10;
    sj.fx += nx * f; sj.fy += ny * f;
    pj.fx -= nx * f; pj.fy -= ny * f;
  }

  integrate(self, dt);
  integrate(peer, dt);
  solve(self, 3);
  solve(peer, 3);
  lockCOM(self);
  lockCOM(peer);
}

export function drawSkeletonMergeEffects(
  ctx: CanvasRenderingContext2D,
  self: Skeleton, peer: Skeleton,
  pairs: SkeletonMergePair[], time: number,
) {
  for (const { joint, strength } of pairs) {
    if (strength < 0.03) continue;
    const sj = self.joints[joint], pj = peer.joints[joint];
    if (!sj || !pj) continue;
    const dx = pj.x - sj.x, dy = pj.y - sj.y;
    const dist = Math.hypot(dx, dy);

    const threadAlpha = strength * 0.30;
    if (threadAlpha > 0.01 && dist > GAP * 2) {
      ctx.beginPath();
      gappedLine(ctx, sj.x, sj.y, pj.x, pj.y, GAP);
      ctx.strokeStyle = `rgba(100, 100, 105, ${threadAlpha})`;
      ctx.lineWidth = 0.4 + strength * 0.6;
      ctx.lineCap = "round";
      ctx.stroke();
    }

    const snapDist = 30;
    if (dist < snapDist) {
      const closeness = 1 - dist / snapDist;
      const mx = (sj.x + pj.x) / 2, my = (sj.y + pj.y) / 2;
      const alpha = closeness * strength * 0.55;
      const r = NR * (1.3 + closeness * 1.0);

      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(60, 60, 65, ${alpha})`;
      ctx.fill();

      const pulse = 1.1 + 0.12 * Math.sin(time * 0.005);
      ctx.beginPath();
      ctx.arc(mx, my, r * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(60, 60, 65, ${alpha * 0.3})`;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }
}

// ---- Utility: get all joint positions for trail capture ----

export function getSkeletonPoints(s: Skeleton): Record<string, { x: number; y: number }> {
  const pts: Record<string, { x: number; y: number }> = {};
  for (const [name, j] of Object.entries(s.joints)) {
    pts[name] = { x: j.x, y: j.y };
  }
  return pts;
}

export function getSkeletonBones(s: Skeleton): [string, string][] {
  return s.bones.filter((b) => b.render).map((b) => [b.a, b.b]);
}

export { JOINT_NAMES };
