import { startSensor, isMobile, requestMotionPermission, type SensorSample } from "./sensor";
import { pushSample, extractFeatures, arrayToFeatures, type Features } from "./dsp";
import { computeSimilarity, resetSimilarity } from "./similarity";
import { createRoom, joinRoom, sendFeatures, onPeerData, onPeerConnected, onPeerDisconnected } from "./peer";
import { setHint, showRoomCode, showConnected, showDisconnected, onCreateRoom, onJoinRoom, setStatus, setPeerError, fadeOutHint } from "./ui";
import { describePeerError, shouldShowPeerDetailOnScreen } from "./peerErrors";
import {
  createSimplex, driveSimplex, drawSimplex,
  computeMergePairs, applyFusion, drawMergeEffects,
  type Simplex, type MergePair,
} from "./creature";

const canvas = document.getElementById("gl") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

let selfFeatures: Features = { amplitude: 0, frequency: 0, axis: 0, smoothness: 0 };
let peerFeatures: Features | null = null;
let peerRawAx = 0;
let peerRawAy = 0;
let connected = false;

let latestRawAx = 0;
let latestRawAy = 0;

let selfSimplex: Simplex;
let peerSimplex: Simplex;

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function initSimplexes() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  selfSimplex = createSimplex(w / 2, h / 2);
  peerSimplex = createSimplex(w / 2, h / 2);
}

resizeCanvas();
initSimplexes();

window.addEventListener("resize", () => {
  resizeCanvas();
  const w = window.innerWidth;
  const h = window.innerHeight;
  selfSimplex.cx = w / 2;
  selfSimplex.cy = h / 2;
  if (!connected) {
    peerSimplex.cx = w / 2;
    peerSimplex.cy = h / 2;
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
  if (data && typeof data === "object") {
    const v = Object.values(data as Record<string, unknown>).map((x) => Number(x));
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
  peerFeatures = null;
  peerRawAx = 0;
  peerRawAy = 0;
  resetSimilarity();
  showConnected();
  setHint("black is you · gray is them · try to sync");
  setTimeout(() => { if (connected) fadeOutHint(); }, 4500);
  selfFeatures = extractFeatures();
  const arr = new Float32Array([
    selfFeatures.amplitude, selfFeatures.frequency,
    selfFeatures.axis, selfFeatures.smoothness,
    latestRawAx, latestRawAy,
  ]);
  sendFeatures(arr);
});

onPeerDisconnected(() => {
  connected = false;
  peerFeatures = null;
  peerRawAx = 0;
  peerRawAy = 0;
  resetSimilarity();
  showDisconnected();
});

let lastTime = 0;

function loop(time: number) {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0.016;
  lastTime = time;

  maybeExtractAndSend(time);

  let similarity = 0;
  let mergePairs: MergePair[] = [];

  if (connected && peerFeatures) {
    similarity = computeSimilarity(selfFeatures, peerFeatures);
    layoutAnchors(similarity);
  } else {
    const w = window.innerWidth;
    const h = window.innerHeight;
    selfSimplex.cx = w / 2;
    selfSimplex.cy = h / 2;
  }

  driveSimplex(selfSimplex, selfFeatures, latestRawAx, latestRawAy, dt);

  if (connected && peerFeatures) {
    driveSimplex(peerSimplex, peerFeatures, peerRawAx, peerRawAy, dt);
    mergePairs = computeMergePairs(selfSimplex, peerSimplex, similarity);
    applyFusion(selfSimplex, peerSimplex, mergePairs, dt);
  }

  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);

  drawSimplex(ctx, selfSimplex, 1, "self");

  if (connected && peerFeatures) {
    drawSimplex(ctx, peerSimplex, 1, "peer");
    drawMergeEffects(ctx, selfSimplex, peerSimplex, mergePairs, time);
  }

  requestAnimationFrame(loop);
}

async function init() {
  if (isMobile()) {
    if (!window.isSecureContext) {
      setHint("use HTTPS — motion needs a secure page");
    } else {
      setHint("tap to start");
    }
    const detachGesture = () => {
      window.removeEventListener("pointerdown", startOnTap, true);
      window.removeEventListener("touchend", startOnTap, true);
      window.removeEventListener("click", startOnTap, true);
    };
    let started = false;
    const startOnTap = async (ev: Event) => {
      if (started) return;
      if (ev.type === "pointerdown" && (ev as PointerEvent).button !== 0) return;
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
      setHint("move your body — make it dance");
      startSensor(onSensorSample);
    };
    window.addEventListener("pointerdown", startOnTap, true);
    window.addEventListener("touchend", startOnTap, true);
    window.addEventListener("click", startOnTap, true);
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

  requestAnimationFrame(loop);
}

init();
