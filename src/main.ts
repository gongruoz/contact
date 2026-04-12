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
  isRoomCodeInputFocused, registerRoomCodeInputTrailHandlers,
} from "./ui";
import { describePeerError, shouldShowPeerDetailOnScreen } from "./peerErrors";
import {
  createSkeleton, driveSkeleton, drawSkeleton,
  computeSkeletonMergePairs, applySkeletonFusion, drawSkeletonMergeEffects,
  getSkeletonPoints, getSkeletonBones,
  applyPeerAttraction, drawPeerThreads,
  type Skeleton, type SkeletonMergePair,
} from "./skeleton";
import { TrailSystem } from "./trail";
import { initTheme, wireThemeToggle } from "./theme";

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

let selfSkel: Skeleton;
let peerSkel: Skeleton;

const selfTrail = new TrailSystem();
const peerTrail = new TrailSystem();

selfTrail.enabled = true;
peerTrail.enabled = true;

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function initFigures() {
  const w = window.innerWidth;
  const h = window.innerHeight;
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
  selfSkel.cx = w / 2;
  selfSkel.cy = h / 2;
  if (!connected) {
    peerSkel.cx = w / 2;
    peerSkel.cy = h / 2;
  }
});

function layoutAnchors(sim: number) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const maxSep = Math.min(w, h) * 0.30;
  const half = (1 - sim) * maxSep * 0.5;
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
  selfTrail.clear();
  peerTrail.clear();
  showConnected();
  setHint("you are the black · they are the grey · try to make a contact");
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
  selfTrail.clear();
  peerTrail.clear();
  showDisconnected();
  if (isMobile()) {
    if (!window.isSecureContext) setHint("HTTPS only — the page needs a sealed room to listen");
    else if (!isSensorRunning()) setHint("tap anywhere to dance");
    else setHint("dance, dance... otherwise we're lost");
  } else {
    setHint("dance, dance... otherwise we're lost");
  }
});

let lastTime = 0;

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
    selfSkel.cx = w / 2;
    selfSkel.cy = h / 2;
  }

  const motionMag = Math.hypot(latestRawAx, latestRawAy);
  const w = window.innerWidth;
  const h = window.innerHeight;

  let skelMerge: SkeletonMergePair[] = [];

  driveSkeleton(selfSkel, selfFeatures, latestRawAx, latestRawAy, dt);

  if (connected && peerFeatures !== null) {
    driveSkeleton(peerSkel, peerFeatures, peerRawAx, peerRawAy, dt);
    applyPeerAttraction(selfSkel, peerSkel, dt);
    skelMerge = computeSkeletonMergePairs(similarity);
    applySkeletonFusion(selfSkel, peerSkel, skelMerge, dt);
  }

  const duo = connected && peerFeatures !== null;
  const typingCode = isRoomCodeInputFocused();
  if (!duo && !typingCode) {
    selfTrail.capture(getSkeletonPoints(selfSkel), motionMag, time);
  }

  ctx.clearRect(0, 0, w, h);

  const skelGap = 8;
  if (!duo && !typingCode) {
    selfTrail.draw(ctx, getSkeletonBones(selfSkel), "self", skelGap);
  }

  drawSkeleton(ctx, selfSkel, 1, "self");

  if (connected && peerFeatures !== null) {
    drawSkeleton(ctx, peerSkel, 1, "peer");
    drawPeerThreads(ctx, selfSkel, peerSkel, time);
    drawSkeletonMergeEffects(ctx, selfSkel, peerSkel, skelMerge, time);
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
      "that address won't reach them",
      "198.18.x.x is usually a VPN/proxy virtual IP (e.g. Clash/Surge), not your Wi‑Fi. On Mac and iPhone open only the https://192.168… line from the terminal. Turn VPN off on the Mac while testing if unsure.",
      true,
    );
    return;
  }
  if (isMobile() && (h === "localhost" || h === "127.0.0.1")) {
    setPeerError(
      "this URL is talking to the wrong room",
      "localhost on the phone is the phone itself, not your Mac. Use the https://192.168… Network URL from npm run dev.",
      true,
    );
  }
}

async function init() {
  warnBadDevOrigin();
  if (isMobile()) {
    if (!window.isSecureContext) {
      setHint("HTTPS only — the page needs a sealed room to listen");
    } else {
      setHint("tap anywhere to dance");
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
        setHint("HTTPS only — we can't hear you here");
        return;
      }
      const ok = await requestMotionPermission();
      if (!ok) {
        setHint("the phone said no — we never got to listen");
        return;
      }
      setHint("dance, dance... otherwise we're lost");
      startSensor(onSensorSample);
    };
    window.addEventListener("touchend", startOnTap, touchendOpts);
    window.addEventListener("click", startOnTap, false);
  } else {
    setHint("dance, dance... otherwise we're lost");
    startSensor(onSensorSample);
  }

  onCreateRoom(async () => {
    setStatus("creating a space...");
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
    setStatus("following their signal…");
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

  registerRoomCodeInputTrailHandlers(() => {
    selfTrail.clear();
  });

  requestAnimationFrame(loop);
}

initTheme();
wireThemeToggle();
void init();
