import type { Features } from "./dsp";
import {
  segmentKeySorted,
  strokeGappedLineEndFade,
  strokeGappedLineWithSketches,
} from "./lineGradient";
import { getFigurePalette } from "./theme";
import { isRoomCodeInputFocused } from "./ui";

// ---- Tunable parameters (exposed to sidebar) ----

export const SKEL_PARAMS = {
  damping: 0.968,
  forceScale: 6.2,
  driftScale: 0.35,
  breatheScale: 0.55,
  stiffness: 0.11,
  leanAmount: 45,
  headRadius: 18,
  peerAttraction: 0.06,
  snapDist: 50,
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
  /** Seconds of continuous low input; drives slow return to upright rest pose. */
  idleTimer: number;
  /** High-frequency input → tremor, then template pull brings silhouette back. */
  shakeAmp: number;
  shakePhase: number;
  _prevDriveRawX: number;
  _prevDriveRawY: number;
  _driveJerkInited: boolean;
}

export interface SkeletonMergePair {
  joint: string;
  strength: number;
}

// ---- Joint definitions — p1: inverted △ torso, 3-point limbs; FIG_SCALE + narrow shoulders ----

/** World scale of the physique figure (2.25 = prior 1.5× layout × another 1.5×). */
const FIG_SCALE = 2.25;
/** Extra narrowing on shoulder x (torso reads smaller vs limbs). */
const SHOULDER_X_NARROW = 0.63;

/** Prior layout scale (FIG_SCALE was 1.5); used to scale interaction radii with figure size. */
const FIG_SCALE_PREV = 1.5;
const SIZE_RATIO = FIG_SCALE / FIG_SCALE_PREV;

const IDLE_INPUT_THRESH = 0.028;
/** No motion: start easing back toward upright after this brief hold. */
const IDLE_GRACE_SEC = 0.45;
/** Seconds after grace over which idle strength reaches full (shorter = snappier return to template). */
const IDLE_REC_FULL_SEC = 3.2;

function smoothstep01(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

const REST_TEMPLATE: Record<string, { x: number; y: number }> = {
  /** Closer to torso (shorter neck). */
  head:       { x: 0,    y: -104 },
  /** Base of neck / top of torso. */
  neck:       { x: 0,    y: -81  },
  shoulder_l: { x: -38,  y: -69  },
  shoulder_r: { x: 38,   y: -69  },
  hip:        { x: 0,    y: 5    },
  elbow_l:    { x: -52,  y: -37  },
  elbow_r:    { x: 52,   y: -37  },
  hand_l:     { x: -66,  y: 8    },
  hand_r:     { x: 66,   y: 8    },
  knee_l:     { x: -21,  y: 60   },
  knee_r:     { x: 21,   y: 60   },
  foot_l:     { x: -26,  y: 112  },
  foot_r:     { x: 26,   y: 112  },
};

/** Pull each limb joint toward its parent so segments read shorter / more human. */
const LIMB_SEGMENT = 0.86;

function blendToward(
  ax: number, ay: number, bx: number, by: number, t: number,
): { x: number; y: number } {
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t };
}

function buildRestPositions(): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  for (const [name, p] of Object.entries(REST_TEMPLATE)) {
    let x = p.x * FIG_SCALE;
    const y = p.y * FIG_SCALE;
    if (name === "shoulder_l" || name === "shoulder_r") x *= SHOULDER_X_NARROW;
    out[name] = { x, y };
  }

  const L = LIMB_SEGMENT;
  const sl = out.shoulder_l, sr = out.shoulder_r, hip = out.hip;

  out.elbow_l = blendToward(sl.x, sl.y, out.elbow_l.x, out.elbow_l.y, L);
  out.hand_l = blendToward(out.elbow_l.x, out.elbow_l.y, out.hand_l.x, out.hand_l.y, L);
  out.elbow_r = blendToward(sr.x, sr.y, out.elbow_r.x, out.elbow_r.y, L);
  out.hand_r = blendToward(out.elbow_r.x, out.elbow_r.y, out.hand_r.x, out.hand_r.y, L);

  out.knee_l = blendToward(hip.x, hip.y, out.knee_l.x, out.knee_l.y, L);
  out.foot_l = blendToward(out.knee_l.x, out.knee_l.y, out.foot_l.x, out.foot_l.y, L);
  out.knee_r = blendToward(hip.x, hip.y, out.knee_r.x, out.knee_r.y, L);
  out.foot_r = blendToward(out.knee_r.x, out.knee_r.y, out.foot_r.x, out.foot_r.y, L);

  return out;
}

const REST_POSITIONS = buildRestPositions();

/** COM of the upright template (joint targets are offset from anchor by rest − COM_REST). */
const COM_REST: { x: number; y: number } = (() => {
  let sx = 0, sy = 0;
  const vals = Object.values(REST_POSITIONS);
  for (const p of vals) {
    sx += p.x;
    sy += p.y;
  }
  const n = vals.length || 1;
  return { x: sx / n, y: sy / n };
})();

const BONE_DEFS: { a: string; b: string; render: boolean }[] = [
  { a: "head",       b: "neck",       render: false },
  { a: "neck",       b: "shoulder_l", render: false },
  { a: "neck",       b: "shoulder_r", render: false },
  // torso: inverted triangle (shoulder line + sides to single hip)
  { a: "shoulder_l", b: "shoulder_r", render: true  },
  { a: "shoulder_l", b: "hip",        render: true  },
  { a: "shoulder_r", b: "hip",        render: true  },
  // arms: 3 points
  { a: "shoulder_l", b: "elbow_l",    render: true  },
  { a: "elbow_l",    b: "hand_l",     render: true  },
  { a: "shoulder_r", b: "elbow_r",    render: true  },
  { a: "elbow_r",    b: "hand_r",     render: true  },
  // legs: 3 points from single hip
  { a: "hip",        b: "knee_l",     render: true  },
  { a: "knee_l",     b: "foot_l",     render: true  },
  { a: "hip",        b: "knee_r",     render: true  },
  { a: "knee_r",     b: "foot_r",     render: true  },
  // structural bracing
  { a: "shoulder_l", b: "knee_r",     render: false },
  { a: "shoulder_r", b: "knee_l",     render: false },
];

const JOINT_NAMES = Object.keys(REST_POSITIONS);
const TORSO_JOINTS = new Set(["shoulder_l", "shoulder_r", "hip"]);
const NECK_JOINTS = new Set(["neck"]);
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
  const isNeck = NECK_JOINTS.has(name);
  const isHead = name === "head";
  return {
    name, x, y, px: x, py: y, fx: 0, fy: 0,
    restX: rest.x, restY: rest.y,
    driftFreq: 0.15 + Math.random() * 0.35,
    driftAmp: isTorso ? 0.4 + Math.random() * 0.6
            : isHead ? 0.32 + Math.random() * 0.38
            : isNeck ? 0.28 + Math.random() * 0.35
            : isExtrem ? 1.2 + Math.random() * 1.8
            : 0.65 + Math.random() * 0.95,
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
    activeJoint: "hip",
    distances: {},
    focusTimer: 0,
    focusInterval: 4500 + Math.random() * 2500,
    leanX: 0, leanY: 0, tiltSmoothed: 0,
    smRawX: 0, smRawY: 0,
    _amp: 0, _freq: 0, _axis: 0.5, _smooth: 0,
    _speed: 0, _rhythm: 0,
    idleTimer: 0,
    shakeAmp: 0,
    shakePhase: Math.random() * Math.PI * 2,
    _prevDriveRawX: 0,
    _prevDriveRawY: 0,
    _driveJerkInited: false,
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
    j.x += dx; j.y += dy;
    j.px += dx; j.py += dy;
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
/** |Δraw|/s above this (after sensor parity) counts as “fast wiggle” → shake + recovery. */
const JERK_REF = 17;
const SHAKE_DECAY_PER_S = 5.8;
const SHAKE_INJECT = 0.28;

function integrate(s: Skeleton, dt: number, impulseMul = 1) {
  const a = dt * dt * ACC * impulseMul;
  const d = SKEL_PARAMS.damping - s._smooth * 0.04;
  for (const j of Object.values(s.joints)) {
    const vx = (j.x - j.px) * d, vy = (j.y - j.py) * d;
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

/** Rest length softly tracks actual span so bones stretch and rebound elastically. */
function adaptRest(s: Skeleton, idleRec: number) {
  for (const b of s.bones) {
    const ja = s.joints[b.a], jb = s.joints[b.b];
    const d = Math.hypot(jb.x - ja.x, jb.y - ja.y);
    const rate = b.render ? 0.11 : 0.055;
    const lo = b.baseRest * (b.render ? 0.42 : 0.32);
    const hi = b.baseRest * (b.render ? 1.72 : 1.9);
    let target = Math.max(lo, Math.min(hi, d));
    if (idleRec > 0.04) {
      target += (b.baseRest - target) * (0.42 * idleRec);
    }
    b.rest += (target - b.rest) * rate;
    if (idleRec > 0.08) {
      b.rest += (b.baseRest - b.rest) * (0.1 + 0.22 * idleRec);
    }
  }
}

function spreadPressure(s: Skeleton, strength = 0.2) {
  const minD = 14 * SIZE_RATIO;
  const { x: cx, y: cy } = comXY(s.joints);
  for (const j of Object.values(s.joints)) {
    if (j.name === "head") continue;
    const dx = j.x - cx, dy = j.y - cy;
    const d = Math.hypot(dx, dy);
    if (d < minD && d > 0.01) {
      const push = ((minD - d) / minD) * strength;
      j.fx += (dx / d) * push; j.fy += (dy / d) * push;
    }
  }
}

function boneMinLength(s: Skeleton) {
  const minLen = 10 * SIZE_RATIO;
  for (const b of s.bones) {
    if (!b.render) continue;
    const ja = s.joints[b.a], jb = s.joints[b.b];
    const dx = jb.x - ja.x, dy = jb.y - ja.y;
    const d = Math.hypot(dx, dy);
    if (d < minLen && d > 0.01) {
      const push = ((minLen - d) / minLen) * 0.2;
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

  if (Math.random() > 0.30) return;

  const neighbors = ADJ[s.activeJoint];
  if (!neighbors.length) return;

  if (Math.random() < 0.06) {
    const pool = JOINT_NAMES.filter((n) => n !== "head");
    s.activeJoint = pool[Math.floor(Math.random() * pool.length)] || "neck";
  } else {
    const active = s.joints[s.activeJoint];
    const weighted = neighbors
      .filter((n) => n !== "head")
      .map((n) => {
        const nj = s.joints[n];
        const dx = nj.restX - active.restX, dy = nj.restY - active.restY;
        const len = Math.hypot(dx, dy) || 1;
        const dot = (dx / len) * rawAx + (dy / len) * rawAy;
        return { name: n, w: dot > 0.2 ? 3.5 : 1 };
      });
    if (weighted.length === 0) return;
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
  const inputLen = Math.hypot(rawAx, rawAy);
  if (inputLen < IDLE_INPUT_THRESH) s.idleTimer += dt;
  else s.idleTimer = 0;

  if (s.activeJoint === "head") s.activeJoint = "neck";

  let idleRec = 0;
  if (s.idleTimer > IDLE_GRACE_SEC) {
    idleRec = smoothstep01((s.idleTimer - IDLE_GRACE_SEC) / IDLE_REC_FULL_SEC);
  }

  let jerkNorm = 0;
  if (!s._driveJerkInited) {
    s._prevDriveRawX = rawAx;
    s._prevDriveRawY = rawAy;
    s._driveJerkInited = true;
  } else {
    const ddx = rawAx - s._prevDriveRawX;
    const ddy = rawAy - s._prevDriveRawY;
    s._prevDriveRawX = rawAx;
    s._prevDriveRawY = rawAy;
    const jerk = Math.hypot(ddx, ddy) / Math.max(dt, 1e-4);
    jerkNorm = Math.min(1, jerk / JERK_REF);
  }
  s.shakeAmp *= Math.exp(-dt * SHAKE_DECAY_PER_S);
  s.shakeAmp = Math.min(1, s.shakeAmp + jerkNorm * SHAKE_INJECT);
  s.shakePhase += dt * (26 + 48 * s.shakeAmp);

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
  const neckStiff = Math.max(0.088, (P.stiffness * 0.82 + s._smooth * 0.05) * (1 - 0.08 * motionMag));
  for (const b of s.bones) {
    const touchesNeck = b.a === "neck" || b.b === "neck" || b.a === "head" || b.b === "head";
    b.stiffness = touchesNeck ? neckStiff : (b.render ? eStiff : bStiff);
  }

  const maxLean = P.leanAmount * express;
  const leanMotion = (1 - idleRec);
  const leanRate = 0.065 * leanMotion + (0.42 + 0.95 * idleRec) * idleRec;
  const shakeLeanMul = 1 / (1 + 1.7 * s.shakeAmp);
  const targetLeanX = ax * maxLean * leanMotion * shakeLeanMul;
  const targetLeanY = ay * maxLean * leanMotion * shakeLeanMul;
  s.leanX += (targetLeanX - s.leanX) * leanRate;
  s.leanY += (targetLeanY - s.leanY) * leanRate;

  let tiltTarget = 0;
  if (rawLen > 0.04) {
    tiltTarget = Math.atan2(ay, ax) * 0.28;
    tiltTarget = Math.max(-0.55, Math.min(0.55, tiltTarget));
  }
  tiltTarget *= leanMotion;
  const prevTilt = s.tiltSmoothed;
  const tiltFollow = 0.058 * leanMotion + (0.24 + 0.72 * idleRec) * idleRec;
  s.tiltSmoothed += (tiltTarget - s.tiltSmoothed) * tiltFollow;
  const dTilt = s.tiltSmoothed - prevTilt;

  if (idleRec < 0.48) updateFocus(s, dt, ax, ay);

  const fdx = rawLen > 0.015 ? ax / rawLen : 0;
  const fdy = rawLen > 0.015 ? ay / rawLen : 0;
  const forceMag = amp * Math.max(0.2, s._speed) * P.forceScale;

  const phaseSpread = (1 - s._rhythm) * 0.9;
  const t = performance.now() / 1000;
  const { x: comx, y: comy } = comXY(s.joints);
  const active = s.activeJoint;
  const aj = s.joints[active];
  const danceMul = 1 - idleRec * 0.9;

  for (const j of Object.values(s.joints)) {
    if (j.name !== active || j.name === "head") continue;

    const phaseOff = phaseSpread * 0.35;

    j.fx += fdx * forceMag * danceMul;
    j.fy += fdy * forceMag * danceMul;

    const rx = aj.x - comx, ry = aj.y - comy;
    const rl = Math.hypot(rx, ry) || 1e-8;
    const ux = rx / rl, uy = ry / rl;
    const off = (JOINT_NAMES.indexOf(active) / JOINT_NAMES.length) * Math.PI * 2;
    const breathe = (0.04 + amp * 0.22 + motionMag * 0.16) * P.breatheScale *
      Math.sin(s.phase + off + phaseOff) * danceMul;
    j.fx += ux * breathe; j.fy += uy * breathe;

    const spontW = 0.036 * P.driftScale * danceMul;
    j.fx += Math.sin(t * j.driftFreq + j.driftPhase) * j.driftAmp * spontW;
    j.fy += Math.cos(t * j.driftFreq * 0.7 + j.driftPhase) * j.driftAmp * spontW;

    if (rawLen > 0.025) {
      const px = -fdy, py = fdx;
      const tw = (px * -uy + py * ux) * rawLen * (0.6 + motionMag * 0.45) * danceMul;
      j.fx += -uy * tw; j.fy += ux * tw;
    }
  }

  const sk = s.shakeAmp * danceMul * 2.05;
  if (sk > 0.006) {
    for (const j of Object.values(s.joints)) {
      if (j.name === "head") continue;
      j.fx += Math.sin(s.shakePhase * 1.28 + j.driftPhase) * sk;
      j.fy += Math.cos(s.shakePhase * 0.93 + j.driftPhase * 0.74) * sk;
    }
  }

  spreadPressure(s, 0.11);
  boneMinLength(s);
  adaptRest(s, idleRec);
  const impulseMul = 1 + motionMag * 0.38 * danceMul;
  integrate(s, dt, impulseMul);
  solve(s, 10);
  rotateAroundAnchor(s, s.cx + s.leanX, s.cy + s.leanY, dTilt);
  lockCOM(s);
  if (idleRec < 0.58) {
    const nw =
      (0.01 + 0.022 * (1 - Math.min(1, motionMag))) * (1 - idleRec * 0.88);
    const nudgeBoost = 1 + 4.5 * s.shakeAmp;
    nudgeTowardRestTemplate(s, nw * nudgeBoost);
    lockCOM(s);
  }
  recoverJointsTowardRest(s, idleRec, dt);
}

/** After physics, gently pull joints toward upright template; recenters COM. */
function recoverJointsTowardRest(s: Skeleton, rec: number, dt: number) {
  if (rec < 0.002) return;
  const pullLambda = 0.38 + 1.35 * rec;
  const w = 1 - Math.exp(-pullLambda * dt);
  const mx = s.cx + s.leanX;
  const my = s.cy + s.leanY;
  for (const j of Object.values(s.joints)) {
    const tx = mx + j.restX - COM_REST.x;
    const ty = my + j.restY - COM_REST.y;
    j.x += (tx - j.x) * w;
    j.px += (tx - j.px) * w;
    j.y += (ty - j.y) * w;
    j.py += (ty - j.py) * w;
  }
  lockCOM(s);
}

/** Light pull toward upright template while moving (mobile: keeps silhouette from drifting apart). */
function nudgeTowardRestTemplate(s: Skeleton, w: number) {
  if (w < 1e-6) return;
  const mx = s.cx + s.leanX;
  const my = s.cy + s.leanY;
  for (const j of Object.values(s.joints)) {
    const tx = mx + j.restX - COM_REST.x;
    const ty = my + j.restY - COM_REST.y;
    j.x += (tx - j.x) * w;
    j.px += (tx - j.px) * w * 0.9;
    j.y += (ty - j.y) * w;
    j.py += (ty - j.py) * w * 0.9;
  }
}

// ---- Rendering ----

const GAP = 7.5 * SIZE_RATIO;

export type DrawRole = "self" | "peer";

export function drawSkeleton(
  ctx: CanvasRenderingContext2D, s: Skeleton,
  opacity: number, role: DrawRole = "self",
) {
  if (opacity <= 0.01) return;

  const pal = getFigurePalette();
  const sA = role === "self" ? opacity * 0.50 : opacity * 0.48;
  const strokeRgb = role === "self" ? pal.selfStroke : pal.peerStroke;
  const lw = role === "self" ? 1.38 : 1.18;
  /** Room-code field focused: skip parallel sketch strokes (they stack to solid black on mobile). */
  const codeTyping = role === "self" && isRoomCodeInputFocused();

  for (const b of s.bones) {
    if (!b.render) continue;
    const ja = s.joints[b.a], jb = s.joints[b.b];
    const key = segmentKeySorted(b.a, b.b);
    if (codeTyping) {
      strokeGappedLineEndFade(ctx, ja.x, ja.y, jb.x, jb.y, GAP, lw, strokeRgb, sA * 0.92);
    } else {
      strokeGappedLineWithSketches(
        ctx, ja.x, ja.y, jb.x, jb.y, GAP, lw, strokeRgb, sA, key,
      );
    }
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
  const threadRgb = getFigurePalette().thread;
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
          0.3 + alpha * 1.5, threadRgb, alpha);
      }
    }

  }
}

// ---- Merge (similarity-gated, kept for backward compat) ----

const MERGE_REGIONS: { threshold: number; joints: string[] }[] = [
  { threshold: 0.15, joints: ["shoulder_l", "shoulder_r", "hip"] },
  { threshold: 0.35, joints: ["elbow_l", "elbow_r", "knee_l", "knee_r"] },
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
  solve(self, 5); solve(peer, 5);
  lockCOM(self); lockCOM(peer);
}

export function drawSkeletonMergeEffects(
  ctx: CanvasRenderingContext2D,
  self: Skeleton, peer: Skeleton,
  pairs: SkeletonMergePair[], _time: number,
) {
  const threadRgb = getFigurePalette().thread;
  for (const { joint, strength } of pairs) {
    if (strength < 0.03) continue;
    const sj = self.joints[joint], pj = peer.joints[joint];
    if (!sj || !pj) continue;
    const dist = Math.hypot(pj.x - sj.x, pj.y - sj.y);

    const threadAlpha = strength * 0.28;
    if (threadAlpha > 0.01 && dist > GAP * 2) {
      strokeGappedLineEndFade(ctx, sj.x, sj.y, pj.x, pj.y, GAP,
        0.4 + strength * 0.6, threadRgb, threadAlpha);
    }

  }
}

// ---- Utility ----

/** Trail snapshots omit `head` so the dot leaves no trail echo. */
export function getSkeletonPoints(s: Skeleton): Record<string, { x: number; y: number }> {
  const pts: Record<string, { x: number; y: number }> = {};
  for (const [name, j] of Object.entries(s.joints)) {
    if (name === "head") continue;
    pts[name] = { x: j.x, y: j.y };
  }
  return pts;
}

export function getSkeletonBones(s: Skeleton): [string, string][] {
  return s.bones.filter((b) => b.render).map((b) => [b.a, b.b] as [string, string]);
}

export { JOINT_NAMES };
