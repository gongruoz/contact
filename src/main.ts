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
  // #region agent log — on-screen debug for phones
  const _dbg = {
    mobile: isMobile(),
    tp: navigator.maxTouchPoints,
    coarse: window.matchMedia?.("(pointer: coarse)")?.matches,
    ua: navigator.userAgent.slice(0, 120),
    hasDM: typeof DeviceMotionEvent !== "undefined",
    hasReqPerm:
      typeof DeviceMotionEvent !== "undefined" &&
      typeof (DeviceMotionEvent as any).requestPermission === "function",
    platform: navigator.platform,
  };
  const _dbgEl = document.createElement("div");
  _dbgEl.id = "dbg-overlay";
  _dbgEl.style.cssText =
    "position:fixed;bottom:0;left:0;right:0;z-index:9999;background:rgba(0,0,0,0.75);color:#0f0;" +
    "font:11px/1.4 monospace;padding:8px 10px;white-space:pre-wrap;word-break:break-all;pointer-events:none";
  _dbgEl.textContent = JSON.stringify(_dbg);
  document.body.appendChild(_dbgEl);

  fetch("http://127.0.0.1:7807/ingest/97db18e8-8eed-43b7-8c7f-cd4d981d08ef", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ab4e8d" },
    body: JSON.stringify({
      sessionId: "ab4e8d",
      location: "main.ts:init",
      message: "sensor path bootstrap",
      data: _dbg,
      timestamp: Date.now(),
      hypothesisId: "H1",
    }),
  }).catch(() => {});
  // #endregion

  if (isMobile()) {
    setHint("tap to start");
    const startOnTap = async () => {
      // #region agent log
      fetch("http://127.0.0.1:7807/ingest/97db18e8-8eed-43b7-8c7f-cd4d981d08ef", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ab4e8d" },
        body: JSON.stringify({
          sessionId: "ab4e8d",
          location: "main.ts:startOnTap",
          message: "user gesture received",
          data: {},
          timestamp: Date.now(),
          hypothesisId: "H2",
        }),
      }).catch(() => {});
      _dbgEl.textContent += "\ntap!";
      // #endregion
      document.removeEventListener("click", startOnTap);
      const ok = await requestMotionPermission();
      // #region agent log
      _dbgEl.textContent += `\nperm=${ok}`;
      // #endregion
      if (!ok) {
        setHint("motion permission denied");
        return;
      }
      setHint("move your body — make it dance");
      startSensor(onSensorSample);
    };
    document.addEventListener("click", startOnTap);
  } else {
    // #region agent log
    _dbgEl.textContent += "\npath=mouse";
    fetch("http://127.0.0.1:7807/ingest/97db18e8-8eed-43b7-8c7f-cd4d981d08ef", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ab4e8d" },
      body: JSON.stringify({
        sessionId: "ab4e8d",
        location: "main.ts:init",
        message: "desktop sensor path (mousemove)",
        data: {},
        timestamp: Date.now(),
        hypothesisId: "H1",
      }),
    }).catch(() => {});
    // #endregion
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
