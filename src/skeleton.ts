import type { Features } from "./dsp";
import {
  fillSolidDot,
  RGB_MERGE,
  RGB_PEER_FILL,
  RGB_PEER_STROKE,
  RGB_SELF_FILL,
  RGB_SELF_STROKE,
  RGB_THREAD,
  type Rgb,
  strokeGappedLineEndFade,
} from "./lineGradient";

// ---- Tunable parameters (exposed to sidebar) ----

export const SKEL_PARAMS = {
  damping: 0.968,
  forceScale: 5.5,
  driftScale: 0.35,
  breatheScale: 0.55,
  stiffness: 0.09,
  conductanceBase: 0.52,
  leanAmount: 45,
  headRadius: 8,
  peerAttraction: 0.06,
  snapDist: 22,
};

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
  a: string; b: string;
  rest: number; baseRest: number;
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

// ---- Joint definitions — more anatomical ----

const REST_POSITIONS: Record<string, { x: number; y: number }> = {
  head:       { x: 0,    y: -118 },
  torso_top:  { x: 0,    y: -90  },
  torso_bl:   { x: -24,  y: -26  },
  torso_br:   { x: 24,   y: -26  },
  shoulder_l: { x: -44,  y: -78  },
  shoulder_r: { x: 44,   y: -78  },
  hand_l:     { x: -74,  y: 6    },
  hand_r:     { x: 74,   y: 6    },
  hip:        { x: 0,    y: 6    },
  foot_l:     { x: -28,  y: 115  },
  foot_r:     { x: 28,   y: 115  },
};

const BONE_DEFS: { a: string; b: string; render: boolean }[] = [
  // neck (physics only — invisible, shorter than before)
  { a: "head",       b: "torso_top",  render: false },
  // torso triangle + light brace
  { a: "torso_top",  b: "torso_bl",   render: true  },
  { a: "torso_bl",   b: "torso_br",   render: true  },
  { a: "torso_br",   b: "torso_top",  render: true  },
  { a: "torso_top",  b: "torso_br",   render: false },
  // arms: shoulder ↔ hand (two points each side)
  { a: "shoulder_l", b: "torso_top",  render: true  },
  { a: "shoulder_r", b: "torso_top",  render: true  },
  { a: "shoulder_l", b: "hand_l",     render: true  },
  { a: "shoulder_r", b: "hand_r",     render: true  },
  // legs: single hip, hip ↔ foot (two points each side)
  { a: "torso_bl",   b: "hip",        render: true  },
  { a: "torso_br",   b: "hip",        render: true  },
  { a: "hip",        b: "foot_l",     render: true  },
  { a: "hip",        b: "foot_r",     render: true  },
  // structural bracing
  { a: "shoulder_l", b: "shoulder_r", render: false },
  { a: "torso_bl",   b: "foot_l",     render: false },
  { a: "torso_br",   b: "foot_r",     render: false },
];

const JOINT_NAMES = Object.keys(REST_POSITIONS);
const TORSO_JOINTS = new Set(["torso_top", "torso_bl", "torso_br"]);
const EXTREMITIES = new Set(["hand_l", "hand_r", "foot_l", "foot_r"]);

// ---- Adjacency ----

const ADJ: Record<string, string[]> = {};
for (const name of JOINT_NAMES) ADJ[name] = [];
for (const b of BONE_DEFS) {
  ADJ[b.a].push(b.b);
  ADJ[b.b].push(b.a);
}

// ---- Creation ----

function mkJoint(name: string, wx: number, wy: number): Joint {
  const rest = REST_POSITIONS[name];
  const x = wx + rest.x, y = wy + rest.y;
  const isExtrem = EXTREMITIES.has(name);
  const isTorso = TORSO_JOINTS.has(name);
  return {
    name, x, y, px: x, py: y, fx: 0, fy: 0,
    restX: rest.x, restY: rest.y,
    driftFreq: 0.15 + Math.random() * 0.35,
    driftAmp: isTorso ? 0.4 + Math.random() * 0.6
            : isExtrem ? 1.2 + Math.random() * 1.8
            : 0.6 + Math.random() * 1.0,
    driftPhase: Math.random() * Math.PI * 2,
  };
}

export function createSkeleton(cx: number, cy: number): Skeleton {
  const joints: Record<string, Joint> = {};
  for (const name of JOINT_NAMES) joints[name] = mkJoint(name, cx, cy);

  const bones: Bone[] = BONE_DEFS.map((def) => {
    const ja = joints[def.a], jb = joints[def.b];
    const d = Math.hypot(jb.x - ja.x, jb.y - ja.y);
    return { a: def.a, b: def.b, rest: d, baseRest: d,
      stiffness: def.render ? 0.12 : 0.05, render: def.render };
  });

  const s: Skeleton = {
    joints, bones, cx, cy,
    phase: Math.random() * Math.PI * 2,
    activeJoint: "torso_top",
    distances: {},
    focusTimer: 0,
    focusInterval: 4500 + Math.random() * 2500,
    leanX: 0, leanY: 0, tiltSmoothed: 0,
    smRawX: 0, smRawY: 0,
    _amp: 0, _freq: 0, _axis: 0.5, _smooth: 0,
    _speed: 0, _rhythm: 0,
  };
  s.distances = computeDistances(s.activeJoint);
  return s;
}

// ---- BFS ----

function computeDistances(from: string): Record<string, number> {
  const dist: Record<string, number> = { [from]: 0 };
  const queue = [from]; let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    for (const nb of ADJ[cur]) {
      if (dist[nb] === undefined) { dist[nb] = dist[cur] + 1; queue.push(nb); }
    }
  }
  return dist;
}

function conductance(hops: number): number {
  return Math.pow(SKEL_PARAMS.conductanceBase, hops);
}

// ---- Physics ----

function comXY(joints: Record<string, Joint>) {
  let x = 0, y = 0, n = 0;
  for (const j of Object.values(joints)) { x += j.x; y += j.y; n++; }
  return { x: x / n, y: y / n };
}

function lockCOM(s: Skeleton) {
  const { x: mx, y: my } = comXY(s.joints);
  const ax = s.cx + s.leanX, ay = s.cy + s.leanY;
  const dx = ax - mx, dy = ay - my;
  for (const j of Object.values(s.joints)) {
    j.x += dx; j.y += dy; j.px += dx; j.py += dy;
  }
}

function rotateAroundAnchor(s: Skeleton, ax: number, ay: number, dTheta: number) {
  if (Math.abs(dTheta) < 1e-7) return;
  const c = Math.cos(dTheta), si = Math.sin(dTheta);
  for (const j of Object.values(s.joints)) {
    let rx = j.x - ax, ry = j.y - ay;
    j.x = ax + rx * c - ry * si; j.y = ay + rx * si + ry * c;
    rx = j.px - ax; ry = j.py - ay;
    j.px = ax + rx * c - ry * si; j.py = ay + rx * si + ry * c;
  }
}

const ACC = 3000;
const RAW_SMOOTH = 0.042;
const RAW_DEAD = 0.018;

function integrate(s: Skeleton, dt: number, impulseMul = 1) {
  const a = dt * dt * ACC * impulseMul;
  const d = SKEL_PARAMS.damping - s._smooth * 0.04;
  for (const j of Object.values(s.joints)) {
    const vx = (j.x - j.px) * d, vy = (j.y - j.py) * d;
    j.px = j.x; j.py = j.y;
    j.x += vx + j.fx * a; j.y += vy + j.fy * a;
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
    const rate = b.render ? 0.06 : 0.012;
    const lo = b.baseRest * 0.5, hi = b.baseRest * 1.8;
    b.rest += (Math.max(lo, Math.min(hi, d)) - b.rest) * rate;
  }
}

function spreadPressure(s: Skeleton) {
  const { x: cx, y: cy } = comXY(s.joints);
  for (const j of Object.values(s.joints)) {
    const dx = j.x - cx, dy = j.y - cy;
    const d = Math.hypot(dx, dy);
    if (d < 14 && d > 0.01) {
      const push = ((14 - d) / 14) * 0.2;
      j.fx += (dx / d) * push; j.fy += (dy / d) * push;
    }
  }
}

function boneMinLength(s: Skeleton) {
  for (const b of s.bones) {
    if (!b.render) continue;
    const ja = s.joints[b.a], jb = s.joints[b.b];
    const dx = jb.x - ja.x, dy = jb.y - ja.y;
    const d = Math.hypot(dx, dy);
    if (d < 10 && d > 0.01) {
      const push = ((10 - d) / 10) * 0.2;
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
  s.focusInterval = 4500 + Math.random() * 2500;

  if (Math.random() > 0.38) return;

  const neighbors = ADJ[s.activeJoint];
  if (!neighbors.length) return;

  if (Math.random() < 0.06) {
    s.activeJoint = JOINT_NAMES[Math.floor(Math.random() * JOINT_NAMES.length)];
  } else {
    const active = s.joints[s.activeJoint];
    const weighted = neighbors.map((n) => {
      const nj = s.joints[n];
      const dx = nj.restX - active.restX, dy = nj.restY - active.restY;
      const len = Math.hypot(dx, dy) || 1;
      const dot = (dx / len) * rawAx + (dy / len) * rawAy;
      return { name: n, w: dot > 0.2 ? 3.5 : 1 };
    });
    let total = 0; for (const w of weighted) total += w.w;
    let r = Math.random() * total;
    for (const w of weighted) { r -= w.w; if (r <= 0) { s.activeJoint = w.name; break; } }
  }
  s.distances = computeDistances(s.activeJoint);
}

// ---- Drive ----

export function driveSkeleton(
  s: Skeleton, f: Features,
  rawAx: number, rawAy: number, dt: number,
) {
  s.smRawX += RAW_SMOOTH * (rawAx - s.smRawX);
  s.smRawY += RAW_SMOOTH * (rawAy - s.smRawY);
  let ax = s.smRawX, ay = s.smRawY;
  if (Math.hypot(ax, ay) < RAW_DEAD) { ax = 0; ay = 0; }

  const lr = 0.028;
  s._amp   += (f.amplitude  - s._amp)   * lr;
  s._freq  += (f.frequency  - s._freq)  * lr;
  s._axis  += (f.axis       - s._axis)  * lr;
  s._smooth += (f.smoothness - s._smooth) * lr;
  s._speed += (f.speed      - s._speed) * lr;
  s._rhythm += (f.rhythm     - s._rhythm) * lr;

  const spd = 0.15 + s._freq * 1.5;
  s.phase += spd * dt;

  const rawLen = Math.hypot(ax, ay);
  const amp = s._amp;
  const motionMag = Math.min(1, rawLen * 1.0);
  const express = Math.max(0.25, Math.min(1.15, 0.3 + amp * 0.32 + motionMag * 0.4));

  const P = SKEL_PARAMS;
  const eStiff = Math.max(0.035, (P.stiffness + s._smooth * 0.06) * (1 - 0.12 * motionMag));
  const bStiff = Math.max(0.015, (P.stiffness * 0.35 + s._smooth * 0.02) * (1 - 0.08 * motionMag));
  for (const b of s.bones) b.stiffness = b.render ? eStiff : bStiff;

  const maxLean = P.leanAmount * express;
  s.leanX += (ax * maxLean - s.leanX) * 0.065;
  s.leanY += (ay * maxLean - s.leanY) * 0.065;

  let tiltTarget = 0;
  if (rawLen > 0.04) {
    tiltTarget = Math.atan2(ay, ax) * 0.28;
    tiltTarget = Math.max(-0.55, Math.min(0.55, tiltTarget));
  }
  const prevTilt = s.tiltSmoothed;
  s.tiltSmoothed += (tiltTarget - s.tiltSmoothed) * 0.058;
  const dTilt = s.tiltSmoothed - prevTilt;

  updateFocus(s, dt, ax, ay);

  const fdx = rawLen > 0.015 ? ax / rawLen : 0;
  const fdy = rawLen > 0.015 ? ay / rawLen : 0;
  const forceMag = amp * Math.max(0.2, s._speed) * P.forceScale;

  const phaseSpread = (1 - s._rhythm) * 0.9;
  const t = performance.now() / 1000;
  const { x: comx, y: comy } = comXY(s.joints);

  for (const j of Object.values(s.joints)) {
    const hops = s.distances[j.name] ?? 7;
    const c = conductance(hops);
    const phaseOff = hops * phaseSpread * 0.35;

    // driven force
    j.fx += fdx * forceMag * c;
    j.fy += fdy * forceMag * c;

    // breathing
    const rx = j.x - comx, ry = j.y - comy;
    const rl = Math.hypot(rx, ry) || 1e-8;
    const ux = rx / rl, uy = ry / rl;
    const off = (JOINT_NAMES.indexOf(j.name) / JOINT_NAMES.length) * Math.PI * 2;
    const breathe = (0.04 + amp * 0.22 + motionMag * 0.16) * P.breatheScale *
      Math.sin(s.phase + off + phaseOff);
    j.fx += ux * breathe; j.fy += uy * breathe;

    // spontaneous drift — intentionally small
    const spontW = ((1 - c) * 0.03 + 0.006) * P.driftScale;
    j.fx += Math.sin(t * j.driftFreq + j.driftPhase) * j.driftAmp * spontW;
    j.fy += Math.cos(t * j.driftFreq * 0.7 + j.driftPhase) * j.driftAmp * spontW;

    // torque
    if (rawLen > 0.025) {
      const px = -fdy, py = fdx;
      const tw = (px * -uy + py * ux) * rawLen * (0.6 + motionMag * 0.45);
      j.fx += -uy * tw * c; j.fy += ux * tw * c;
    }
  }

  spreadPressure(s);
  boneMinLength(s);
  adaptRest(s);
  integrate(s, dt, 1 + motionMag * 0.4);
  solve(s, 7);
  lockCOM(s);
  rotateAroundAnchor(s, s.cx + s.leanX, s.cy + s.leanY, dTilt);
}

// ---- Rendering ----

const GAP = 7;
const NR = 1.8;
const ACTIVE_NR = 2.5;
const HEAD_STROKE_W = 0.9;

export type DrawRole = "self" | "peer";

export function drawSkeleton(
  ctx: CanvasRenderingContext2D, s: Skeleton,
  opacity: number, role: DrawRole = "self",
) {
  if (opacity <= 0.01) return;

  const sA = role === "self" ? opacity * 0.50 : opacity * 0.48;
  const fA = role === "self" ? opacity * 0.94 : opacity * 0.82;
  const strokeRgb = role === "self" ? RGB_SELF_STROKE : RGB_PEER_STROKE;
  const fillRgb = role === "self" ? RGB_SELF_FILL : RGB_PEER_FILL;
  const lw = role === "self" ? 1.0 : 0.85;

  // bones (skip neck — head→torso is invisible)
  for (const b of s.bones) {
    if (!b.render) continue;
    const ja = s.joints[b.a], jb = s.joints[b.b];
    strokeGappedLineEndFade(ctx, ja.x, ja.y, jb.x, jb.y, GAP, lw, strokeRgb, sA);
  }

  // joints (skip head — drawn separately as hollow circle)
  for (const j of Object.values(s.joints)) {
    if (j.name === "head") continue;
    const isActive = j.name === s.activeJoint;
    const r = isActive ? ACTIVE_NR : NR;
    fillSolidDot(ctx, j.x, j.y, r, fillRgb, fA);
  }

  // head: hollow circle
  const hd = s.joints.head;
  const hr = SKEL_PARAMS.headRadius;
  const [hr1, hg1, hb1] = strokeRgb;
  ctx.beginPath();
  ctx.arc(hd.x, hd.y, hr, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${hr1},${hg1},${hb1},${sA})`;
  ctx.lineWidth = HEAD_STROKE_W;
  ctx.stroke();

  // active joint pulse ring
  if (s.activeJoint !== "head") {
    const aj = s.joints[s.activeJoint];
    const pulse = 1.15 + 0.15 * Math.sin(s.phase * 1.3);
    ctx.beginPath();
    ctx.arc(aj.x, aj.y, ACTIVE_NR * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${hr1},${hg1},${hb1},${opacity * 0.14})`;
    ctx.lineWidth = 0.4;
    ctx.stroke();
  }
}

// ---- Peer attraction (always-on gentle pull + snap-merge on touch) ----

export function applyPeerAttraction(
  self: Skeleton, peer: Skeleton, dt: number,
) {
  const P = SKEL_PARAMS;
  for (const name of JOINT_NAMES) {
    const sj = self.joints[name], pj = peer.joints[name];
    if (!sj || !pj) continue;
    const dx = pj.x - sj.x, dy = pj.y - sj.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist, ny = dy / dist;

    // gentle gravity — 1/dist falloff
    const pull = P.peerAttraction / (1 + dist * 0.012);
    sj.fx += nx * pull; sj.fy += ny * pull;
    pj.fx -= nx * pull; pj.fy -= ny * pull;

    // snap-merge: when within snapDist, strong spring pulls them together
    if (dist < P.snapDist) {
      const closeness = 1 - dist / P.snapDist;
      const snap = closeness * closeness * 0.28;
      sj.fx += nx * snap; sj.fy += ny * snap;
      pj.fx -= nx * snap; pj.fy -= ny * snap;
    }
  }
}

export function drawPeerThreads(
  ctx: CanvasRenderingContext2D,
  self: Skeleton, peer: Skeleton,
  _time: number,
) {
  const P = SKEL_PARAMS;
  for (const name of JOINT_NAMES) {
    const sj = self.joints[name], pj = peer.joints[name];
    if (!sj || !pj) continue;
    const dx = pj.x - sj.x, dy = pj.y - sj.y;
    const dist = Math.hypot(dx, dy);

    // thread: visible when close enough
    if (dist < P.snapDist * 3 && dist > GAP * 2) {
      const alpha = Math.max(0, 1 - dist / (P.snapDist * 3)) * 0.22;
      if (alpha > 0.005) {
        strokeGappedLineEndFade(ctx, sj.x, sj.y, pj.x, pj.y, GAP,
          0.3 + alpha * 1.5, RGB_THREAD, alpha);
      }
    }

    // merge blob when touching
    if (dist < P.snapDist) {
      const closeness = 1 - dist / P.snapDist;
      const mx = (sj.x + pj.x) / 2, my = (sj.y + pj.y) / 2;
      const alpha = closeness * 0.45;
      const r = NR * (1.2 + closeness * 0.8);
      fillSolidDot(ctx, mx, my, r, RGB_MERGE, alpha);
    }
  }
}

// ---- Merge (similarity-gated, kept for backward compat) ----

const MERGE_REGIONS: { threshold: number; joints: string[] }[] = [
  { threshold: 0.15, joints: ["torso_top", "torso_bl", "torso_br", "hip"] },
  { threshold: 0.35, joints: ["shoulder_l", "shoulder_r"] },
  { threshold: 0.55, joints: ["head"] },
  { threshold: 0.78, joints: ["hand_l", "hand_r", "foot_l", "foot_r"] },
];

export function computeSkeletonMergePairs(similarity: number): SkeletonMergePair[] {
  const pairs: SkeletonMergePair[] = [];
  for (const region of MERGE_REGIONS) {
    if (similarity < region.threshold) continue;
    const fullAt = region.threshold + 0.18;
    const str = Math.min(1, Math.max(0,
      (similarity - region.threshold) / (fullAt - region.threshold)));
    for (const jn of region.joints) pairs.push({ joint: jn, strength: str });
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
    const f = strength * 0.10;
    sj.fx += (dx / dist) * f; sj.fy += (dy / dist) * f;
    pj.fx -= (dx / dist) * f; pj.fy -= (dy / dist) * f;
  }
  integrate(self, dt); integrate(peer, dt);
  solve(self, 3); solve(peer, 3);
  lockCOM(self); lockCOM(peer);
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
    const dist = Math.hypot(pj.x - sj.x, pj.y - sj.y);

    const threadAlpha = strength * 0.28;
    if (threadAlpha > 0.01 && dist > GAP * 2) {
      strokeGappedLineEndFade(ctx, sj.x, sj.y, pj.x, pj.y, GAP,
        0.4 + strength * 0.6, RGB_THREAD, threadAlpha);
    }

    if (dist < 28) {
      const closeness = 1 - dist / 28;
      const mx = (sj.x + pj.x) / 2, my = (sj.y + pj.y) / 2;
      const alpha = closeness * strength * 0.5;
      fillSolidDot(ctx, mx, my, NR * (1.2 + closeness), RGB_MERGE, alpha);
    }
  }
}

// ---- Utility ----

export function getSkeletonPoints(s: Skeleton): Record<string, { x: number; y: number }> {
  const pts: Record<string, { x: number; y: number }> = {};
  for (const [name, j] of Object.entries(s.joints)) pts[name] = { x: j.x, y: j.y };
  return pts;
}

export function getSkeletonBones(s: Skeleton): [string, string][] {
  return s.bones.filter((b) => b.render).map((b) => [b.a, b.b]);
}

export { JOINT_NAMES };
