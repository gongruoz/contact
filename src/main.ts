import { startSensor, isMobile, isSensorRunning, requestMotionPermission, type SensorSample } from "./sensor";
import { pushSample, extractFeatures, type Features } from "./dsp";
import { computeSimilarityFromParticles, resetSimilarity } from "./similarity";
import {
  createRoom, joinRoom, sendFeatures, burstSendFeatures,
  onPeerData, onPeerConnected, onPeerDisconnected, destroyPeer,
} from "./relay";
import {
  setHint, showRoomCode, showConnected, showDisconnected,
  onCreateRoom, onJoinRoom, onExitRoom, setStatus, setPeerError,
} from "./ui";
import { describePeerError, shouldShowPeerDetailOnScreen } from "./peerErrors";
import {
  createSimplex, driveSimplex, drawSimplex,
  serializeSimplexNormalized, applyPeerDotsNormalized,
  computeMergePairs, applyFusionSelfOnly, drawMergeEffects,
  type Simplex, type MergePair,
} from "./creature";

const canvas = document.getElementById("gl") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

let selfFeatures: Features = { amplitude: 0, frequency: 0, axis: 0, smoothness: 0 };

const peerDots = new Float32Array(16);
let peerDotsSnapNext = false;
/** At least one 16-float payload received this session. */
let peerDotsValid = false;
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
let lastLoopDt = 0.016;

function maybeExtractAndSend(now: number) {
  selfFeatures = extractFeatures();
  if (now - lastSend < 50) return;
  lastSend = now;
  if (connected) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const arr = serializeSimplexNormalized(selfSimplex, w, h, lastLoopDt);
    sendFeatures(arr);
  }
}

function normalizePeerPayload(data: unknown): number[] | null {
  if (Array.isArray(data) && data.length >= 16) {
    const nums = data.map((x) => Number(x));
    if (nums.every((n) => !Number.isNaN(n))) return nums;
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const o = data as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));
    if (keys.length >= 16) {
      const ordered = keys.map((k) => Number(o[k]));
      if (ordered.every((n) => !Number.isNaN(n))) return ordered;
    }
  }
  return null;
}

onPeerData((data) => {
  const arr = normalizePeerPayload(data);
  if (!arr) return;
  for (let i = 0; i < 16; i++) peerDots[i] = arr[i]!;
  peerDotsSnapNext = true;
  peerDotsValid = true;
});

onPeerConnected(() => {
  connected = true;
  peerDotsValid = false;
  peerDotsSnapNext = false;
  peerDots.fill(0);
  resetSimilarity();
  showConnected();
  setHint("black is you · gray is them · try to sync");
  selfFeatures = extractFeatures();
  const w = window.innerWidth;
  const h = window.innerHeight;
  burstSendFeatures(serializeSimplexNormalized(selfSimplex, w, h, 1 / 60));
});

onPeerDisconnected(() => {
  connected = false;
  peerDotsValid = false;
  peerDotsSnapNext = false;
  peerDots.fill(0);
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

function loop(time: number) {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0.016;
  lastTime = time;
  lastLoopDt = dt;

  const w = window.innerWidth;
  const h = window.innerHeight;

  maybeExtractAndSend(time);

  let similarity = 0;
  let mergePairs: MergePair[] = [];

  if (connected && peerDotsValid) {
    similarity = computeSimilarityFromParticles(selfSimplex, peerSimplex, w, h);
    layoutAnchors(similarity);
  } else {
    selfSimplex.cx = w / 2;
    selfSimplex.cy = h / 2;
    peerSimplex.cx = w / 2;
    peerSimplex.cy = h / 2;
  }

  driveSimplex(selfSimplex, selfFeatures, latestRawAx, latestRawAy, dt);

  if (connected && peerDotsValid) {
    const snap = peerDotsSnapNext;
    peerDotsSnapNext = false;
    applyPeerDotsNormalized(
      peerSimplex,
      peerDots,
      peerSimplex.cx,
      peerSimplex.cy,
      w,
      h,
      dt,
      snap,
    );
    mergePairs = computeMergePairs(selfSimplex, peerSimplex, similarity);
    applyFusionSelfOnly(selfSimplex, peerSimplex, mergePairs, dt);
  }

  ctx.clearRect(0, 0, w, h);

  drawSimplex(ctx, selfSimplex, 1, "self");

  if (connected && peerDotsValid) {
    drawSimplex(ctx, peerSimplex, 1, "peer");
    drawMergeEffects(ctx, selfSimplex, peerSimplex, mergePairs, time);
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

  requestAnimationFrame(loop);
}

init();
