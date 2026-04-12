import { startSensor, isMobile, isSensorRunning, requestMotionPermission, type SensorSample } from "./sensor";
import { pushSample, extractFeatures, arrayToFeatures, type Features } from "./dsp";
import { computeSimilarity, resetSimilarity } from "./similarity";
import {
  createRoom, joinRoom, sendFeatures, burstSendFeatures,
  onPeerData, onPeerConnected, onPeerDisconnected, destroyPeer,
} from "./relay";
import {
  setHint, showRoomCode, showConnected, showDisconnected,
  onCreateRoom, onJoinRoom, onExitRoom, setStatus, setPeerError,
  initFigureToolbar, syncFigureToolbar, initParamSidebar,
} from "./ui";
import { describePeerError, shouldShowPeerDetailOnScreen } from "./peerErrors";
import {
  createSimplex, driveSimplex, drawSimplex,
  computeMergePairs, applyFusion, drawMergeEffects,
  type Simplex, type MergePair,
} from "./creature";
import {
  createSkeleton, driveSkeleton, drawSkeleton,
  computeSkeletonMergePairs, applySkeletonFusion, drawSkeletonMergeEffects,
  getSkeletonPoints, getSkeletonBones,
  applyPeerAttraction, drawPeerThreads,
  SKEL_PARAMS,
  type Skeleton, type SkeletonMergePair,
} from "./skeleton";
import { TrailSystem } from "./trail";

const canvas = document.getElementById("gl") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

let selfFeatures: Features = { amplitude: 0, frequency: 0, axis: 0, smoothness: 0, speed: 0, rhythm: 0 };
/** While connected, always non-null so the peer diagram can render before the first packet. */
let peerFeatures: Features | null = null;

const PLACEHOLDER_PEER_FEATURES: Features = {
  amplitude: 0,
  frequency: 0,
  axis: 0.5,
  smoothness: 0,
  speed: 0,
  rhythm: 0,
};
let peerRawAx = 0;
let peerRawAy = 0;
let connected = false;

let latestRawAx = 0;
let latestRawAy = 0;

type FigureMode = "simplex" | "skeleton";
let mode: FigureMode = "simplex";

let selfSimplex: Simplex;
let peerSimplex: Simplex;
let selfSkel: Skeleton;
let peerSkel: Skeleton;

const selfTrail = new TrailSystem();
const peerTrail = new TrailSystem();

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function initFigures() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  selfSimplex = createSimplex(w / 2, h / 2);
  peerSimplex = createSimplex(w / 2, h / 2);
  selfSkel = createSkeleton(w / 2, h / 2);
  peerSkel = createSkeleton(w / 2, h / 2);
  selfTrail.clear();
  peerTrail.clear();
}

resizeCanvas();
initFigures();

window.addEventListener("resize", () => {
  resizeCanvas();
  const w = window.innerWidth;
  const h = window.innerHeight;
  selfSimplex.cx = w / 2;
  selfSimplex.cy = h / 2;
  selfSkel.cx = w / 2;
  selfSkel.cy = h / 2;
  if (!connected) {
    peerSimplex.cx = w / 2;
    peerSimplex.cy = h / 2;
    peerSkel.cx = w / 2;
    peerSkel.cy = h / 2;
  }
});

function layoutAnchors(sim: number) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const maxSep = Math.min(w, h) * 0.30;
  const half = (1 - sim) * maxSep * 0.5;
  selfSimplex.cx = w / 2 - half;
  selfSimplex.cy = h / 2;
  peerSimplex.cx = w / 2 + half;
  peerSimplex.cy = h / 2;
  selfSkel.cx = w / 2 - half;
  selfSkel.cy = h / 2;
  peerSkel.cx = w / 2 + half;
  peerSkel.cy = h / 2;
}

function onSensorSample(s: SensorSample) {
  pushSample(s);
  latestRawAx = s.ax;
  latestRawAy = s.ay;
}

let lastSend = 0;
function maybeExtractAndSend(now: number) {
  selfFeatures = extractFeatures();
  if (now - lastSend < 50) return;
  lastSend = now;
  if (connected) {
    const arr = new Float32Array([
      selfFeatures.amplitude, selfFeatures.frequency,
      selfFeatures.axis, selfFeatures.smoothness,
      latestRawAx, latestRawAy,
    ]);
    sendFeatures(arr);
  }
}

function normalizePeerPayload(data: unknown): number[] | null {
  if (Array.isArray(data) && data.length >= 4) {
    return data.map((x) => Number(x));
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const o = data as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));
    if (keys.length >= 4) {
      const ordered = keys.map((k) => Number(o[k]));
      if (ordered.every((n) => !Number.isNaN(n))) return ordered;
    }
    const v = Object.values(o).map((x) => Number(x));
    if (v.length >= 4 && v.every((n) => !Number.isNaN(n))) return v;
  }
  return null;
}

onPeerData((data) => {
  const arr = normalizePeerPayload(data);
  if (!arr) return;
  peerFeatures = arrayToFeatures(arr);
  peerRawAx = arr.length >= 6 ? arr[4] : 0;
  peerRawAy = arr.length >= 6 ? arr[5] : 0;
});

onPeerConnected(() => {
  connected = true;
  peerFeatures = { ...PLACEHOLDER_PEER_FEATURES };
  peerRawAx = 0;
  peerRawAy = 0;
  resetSimilarity();
  showConnected();
  setHint("black is you · gray is them · try to sync");
  selfFeatures = extractFeatures();
  const arr = new Float32Array([
    selfFeatures.amplitude, selfFeatures.frequency,
    selfFeatures.axis, selfFeatures.smoothness,
    latestRawAx, latestRawAy,
  ]);
  burstSendFeatures(arr);
});

onPeerDisconnected(() => {
  connected = false;
  peerFeatures = null;
  peerRawAx = 0;
  peerRawAy = 0;
  resetSimilarity();
  showDisconnected();
  if (isMobile()) {
    if (!window.isSecureContext) setHint("use HTTPS — motion needs a secure page");
    else if (!isSensorRunning()) setHint("create or join · then tap to dance");
    else setHint("move your phone — make it dance");
  } else {
    setHint("move your mouse — make it dance");
  }
});

let lastTime = 0;

function getSimplexPoints(s: Simplex): Record<string, { x: number; y: number }> {
  const pts: Record<string, { x: number; y: number }> = {};
  for (let i = 0; i < s.particles.length; i++) {
    pts[String(i)] = { x: s.particles[i].x, y: s.particles[i].y };
  }
  return pts;
}

function getSimplexBones(s: Simplex): [string, string][] {
  return s.constraints
    .filter((c) => !c.isDiag)
    .map((c) => [String(c.a), String(c.b)]);
}

function loop(time: number) {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0.016;
  lastTime = time;

  maybeExtractAndSend(time);

  let similarity = 0;

  if (connected && peerFeatures !== null) {
    similarity = computeSimilarity(selfFeatures, peerFeatures);
    layoutAnchors(similarity);
  } else {
    const w = window.innerWidth;
    const h = window.innerHeight;
    selfSimplex.cx = w / 2;
    selfSimplex.cy = h / 2;
    selfSkel.cx = w / 2;
    selfSkel.cy = h / 2;
  }

  const motionMag = Math.hypot(latestRawAx, latestRawAy);
  const w = window.innerWidth;
  const h = window.innerHeight;

  if (mode === "simplex") {
    let mergePairs: MergePair[] = [];

    driveSimplex(selfSimplex, selfFeatures, latestRawAx, latestRawAy, dt);

    if (connected && peerFeatures !== null) {
      driveSimplex(peerSimplex, peerFeatures, peerRawAx, peerRawAy, dt);
      mergePairs = computeMergePairs(selfSimplex, peerSimplex, similarity);
      applyFusion(selfSimplex, peerSimplex, mergePairs, dt);
    }

    selfTrail.capture(getSimplexPoints(selfSimplex), motionMag, time);
    if (connected && peerFeatures !== null) {
      peerTrail.capture(getSimplexPoints(peerSimplex), Math.hypot(peerRawAx, peerRawAy), time);
    }

    ctx.clearRect(0, 0, w, h);

    const simplexGap = 6;
    selfTrail.draw(ctx, getSimplexBones(selfSimplex), "self", simplexGap);
    if (connected && peerFeatures !== null) {
      peerTrail.draw(ctx, getSimplexBones(peerSimplex), "peer", simplexGap);
    }

    drawSimplex(ctx, selfSimplex, 1, "self");

    if (connected && peerFeatures !== null) {
      drawSimplex(ctx, peerSimplex, 1, "peer");
      drawMergeEffects(ctx, selfSimplex, peerSimplex, mergePairs, time);
    }
  } else {
    let skelMerge: SkeletonMergePair[] = [];

    driveSkeleton(selfSkel, selfFeatures, latestRawAx, latestRawAy, dt);

    if (connected && peerFeatures !== null) {
      driveSkeleton(peerSkel, peerFeatures, peerRawAx, peerRawAy, dt);
      applyPeerAttraction(selfSkel, peerSkel, dt);
      skelMerge = computeSkeletonMergePairs(similarity);
      applySkeletonFusion(selfSkel, peerSkel, skelMerge, dt);
    }

    selfTrail.capture(getSkeletonPoints(selfSkel), motionMag, time);
    if (connected && peerFeatures !== null) {
      peerTrail.capture(getSkeletonPoints(peerSkel), Math.hypot(peerRawAx, peerRawAy), time);
    }

    ctx.clearRect(0, 0, w, h);

    const skelGap = 7;
    selfTrail.draw(ctx, getSkeletonBones(selfSkel), "self", skelGap);
    if (connected && peerFeatures !== null) {
      peerTrail.draw(ctx, getSkeletonBones(peerSkel), "peer", skelGap);
    }

    drawSkeleton(ctx, selfSkel, 1, "self");

    if (connected && peerFeatures !== null) {
      drawSkeleton(ctx, peerSkel, 1, "peer");
      drawPeerThreads(ctx, selfSkel, peerSkel, time);
      drawSkeletonMergeEffects(ctx, selfSkel, peerSkel, skelMerge, time);
    }
  }

  requestAnimationFrame(loop);
}

/** Mobile: ignore taps on room UI when enabling motion (bubble phase so Join/Create run first). */
function isTargetInsideConnectUI(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Node)) return false;
  const area = document.getElementById("connect-area");
  return area ? area.contains(target) : false;
}

function warnBadDevOrigin(): void {
  if (typeof location === "undefined") return;
  const h = location.hostname;
  if (/^198\.18\./.test(h)) {
    setPeerError(
      "wrong address for phone pairing",
      "198.18.x.x is usually a VPN/proxy virtual IP (e.g. Clash/Surge), not your Wi‑Fi. On Mac and iPhone open only the https://192.168… line from the terminal. Turn VPN off on the Mac while testing if unsure.",
      true,
    );
    return;
  }
  if (isMobile() && (h === "localhost" || h === "127.0.0.1")) {
    setPeerError(
      "wrong address on phone",
      "localhost on the phone is the phone itself, not your Mac. Use the https://192.168… Network URL from npm run dev.",
      true,
    );
  }
}

async function init() {
  warnBadDevOrigin();
  if (isMobile()) {
    if (!window.isSecureContext) {
      setHint("use HTTPS — motion needs a secure page");
    } else {
      setHint("create or join · then tap to dance");
    }
    /** No `pointerdown` here: on iOS Safari it often fires before click/touchend and
     *  `DeviceMotionEvent.requestPermission()` then resolves denied with no system prompt. */
    const touchendOpts: AddEventListenerOptions = { passive: true };
    const detachGesture = () => {
      window.removeEventListener("touchend", startOnTap, touchendOpts);
      window.removeEventListener("click", startOnTap, false);
    };
    let started = false;
    const startOnTap = async (ev: Event) => {
      if (started) return;
      if (isTargetInsideConnectUI(ev.target)) return;
      if (ev.type === "click" && ev instanceof MouseEvent && ev.button !== 0) return;
      started = true;
      detachGesture();
      if (!window.isSecureContext) {
        setHint("use HTTPS — motion blocked");
        return;
      }
      const ok = await requestMotionPermission();
      if (!ok) {
        setHint("motion permission denied");
        return;
      }
      setHint("move your phone — make it dance");
      startSensor(onSensorSample);
    };
    window.addEventListener("touchend", startOnTap, touchendOpts);
    window.addEventListener("click", startOnTap, false);
  } else {
    setHint("move your mouse — make it dance");
    startSensor(onSensorSample);
  }

  onCreateRoom(async () => {
    setStatus("creating…");
    try {
      const code = await createRoom();
      showRoomCode(code);
    } catch (e) {
      console.error("[contact] createRoom failed", e);
      const { label, detail } = describePeerError(e);
      setPeerError(label, detail, shouldShowPeerDetailOnScreen());
    }
  });

  onJoinRoom(async (code) => {
    setStatus("joining…");
    try {
      await joinRoom(code);
    } catch (e) {
      console.error("[contact] joinRoom failed", { roomCode: code, err: e });
      const { label, detail } = describePeerError(e);
      setPeerError(label, detail, shouldShowPeerDetailOnScreen());
    }
  });

  onExitRoom(() => {
    destroyPeer();
  });

  function applyMode(next: FigureMode) {
    if (mode === next) return;
    mode = next;
    selfTrail.clear();
    peerTrail.clear();
    syncFigureToolbar(mode, selfTrail.enabled);
  }

  function applyTrailToggle() {
    const on = !selfTrail.enabled;
    selfTrail.enabled = on;
    peerTrail.enabled = on;
    if (!on) { selfTrail.clear(); peerTrail.clear(); }
    syncFigureToolbar(mode, on);
  }

  initFigureToolbar({
    onShape: () => applyMode("simplex"),
    onBody: () => applyMode("skeleton"),
    onTrail: applyTrailToggle,
  });

  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === "1") applyMode("simplex");
    else if (e.key === "2") applyMode("skeleton");
    else if (e.key === "t" || e.key === "T") applyTrailToggle();
  });

  initParamSidebar(
    [
      { key: "damping",         label: "damping",      min: 0.90, max: 0.995, step: 0.001 },
      { key: "forceScale",      label: "force",        min: 1,    max: 15,    step: 0.5   },
      { key: "driftScale",      label: "drift",        min: 0,    max: 1.5,   step: 0.05  },
      { key: "breatheScale",    label: "breathe",      min: 0,    max: 2,     step: 0.05  },
      { key: "stiffness",       label: "stiffness",    min: 0.01, max: 0.3,   step: 0.005 },
      { key: "conductanceBase", label: "conductance",  min: 0.2,  max: 0.85,  step: 0.01  },
      { key: "leanAmount",      label: "lean",         min: 0,    max: 100,   step: 1     },
      { key: "headRadius",      label: "head size",    min: 3,    max: 18,    step: 0.5   },
      { key: "peerAttraction",  label: "peer pull",    min: 0,    max: 0.3,   step: 0.005 },
      { key: "snapDist",        label: "snap dist",    min: 5,    max: 60,    step: 1     },
      { key: "gravity",         label: "gravity",      min: 0,    max: 3.5,   step: 0.05  },
      { key: "jointLimitRad",   label: "joint limit",  min: 0.2,  max: 0.95,  step: 0.02  },
      { key: "jumpImpulse",     label: "jump",         min: 0,    max: 16,    step: 0.5   },
      { key: "airFlipScale",    label: "air flip",     min: 0,    max: 5,     step: 0.1   },
    ],
    SKEL_PARAMS as unknown as Record<string, number>,
    (key, val) => { (SKEL_PARAMS as unknown as Record<string, number>)[key] = val; },
  );

  syncFigureToolbar(mode, selfTrail.enabled);
  requestAnimationFrame(loop);
}

init();
