import { startSensor, isMobile, requestMotionPermission, type SensorSample } from "./sensor";
import { pushSample, extractFeatures, featuresToArray, arrayToFeatures, type Features } from "./dsp";
import { computeSimilarity, resetSimilarity } from "./similarity";
import { createRoom, joinRoom, sendFeatures, onPeerData, onPeerConnected, onPeerDisconnected } from "./peer";
import { setHint, showRoomCode, showConnected, showDisconnected, onCreateRoom, onJoinRoom, setStatus } from "./ui";
import { createSimplex, driveSimplex, drawSimplex, applyFusion, drawFusionEdges, type Simplex } from "./creature";

const canvas = document.getElementById("gl") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

let selfFeatures: Features = { amplitude: 0, frequency: 0, axis: 0, smoothness: 0 };
let peerFeatures: Features | null = null;
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
  peerSimplex = createSimplex(w / 2, h * 0.15);
}

resizeCanvas();
initSimplexes();
window.addEventListener("resize", () => {
  resizeCanvas();
  const w = window.innerWidth;
  const h = window.innerHeight;
  selfSimplex.cx = w / 2;
  selfSimplex.cy = h / 2;
  selfSimplex.particles[0].pinX = w / 2;
  selfSimplex.particles[0].pinY = h / 2;
});

function onSensorSample(s: SensorSample) {
  pushSample(s);
  latestRawAx = s.ax;
  latestRawAy = s.ay;
}

let lastExtract = 0;
function maybeExtractAndSend(now: number) {
  if (now - lastExtract < 50) return;
  lastExtract = now;

  selfFeatures = extractFeatures();

  if (connected) {
    sendFeatures(featuresToArray(selfFeatures));
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
});

onPeerConnected(() => {
  connected = true;
  peerFeatures = null;
  resetSimilarity();
  showConnected();
  setHint("");
  selfFeatures = extractFeatures();
  sendFeatures(featuresToArray(selfFeatures));
});

onPeerDisconnected(() => {
  connected = false;
  peerFeatures = null;
  resetSimilarity();
  showDisconnected();
});

let lastTime = 0;

function loop(time: number) {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0.016;
  lastTime = time;

  maybeExtractAndSend(time);

  // Drive self simplex
  driveSimplex(selfSimplex, selfFeatures, latestRawAx, latestRawAy, dt);

  // Drive peer simplex
  let similarity = 0;
  let peerOpacity = 0;
  if (connected && peerFeatures) {
    similarity = computeSimilarity(selfFeatures, peerFeatures);
    peerOpacity = 0.3 + similarity * 0.7;

    // Position peer simplex based on similarity
    const w = window.innerWidth;
    const h = window.innerHeight;
    const topY = h * 0.18;
    const nearY = h * 0.42;
    const targetY = topY + similarity * (nearY - topY);
    peerSimplex.cx = w / 2;
    peerSimplex.cy = targetY;
    peerSimplex.particles[0].pinX = w / 2;
    peerSimplex.particles[0].pinY = targetY;

    driveSimplex(peerSimplex, peerFeatures, 0, 0, dt);
    applyFusion(selfSimplex, peerSimplex, similarity);
  }

  // Render
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  drawSimplex(ctx, selfSimplex, 1);

  if (connected && peerFeatures) {
    drawSimplex(ctx, peerSimplex, peerOpacity);
    drawFusionEdges(ctx, selfSimplex, peerSimplex, similarity);
  }

  requestAnimationFrame(loop);
}

async function init() {
  if (isMobile()) {
    setHint("tap to start, then move your phone");
    const startOnTap = async () => {
      document.removeEventListener("click", startOnTap);
      const ok = await requestMotionPermission();
      if (!ok) {
        setHint("motion permission denied");
        return;
      }
      setHint("move your phone");
      startSensor(onSensorSample);
    };
    document.addEventListener("click", startOnTap);
  } else {
    setHint("move your mouse");
    startSensor(onSensorSample);
  }

  onCreateRoom(async () => {
    setStatus("connecting...");
    try {
      const code = await createRoom();
      showRoomCode(code);
    } catch {
      setStatus("failed to create room");
    }
  });

  onJoinRoom(async (code) => {
    setStatus("joining...");
    try {
      await joinRoom(code);
    } catch {
      setStatus("failed to join");
    }
  });

  requestAnimationFrame(loop);
}

init();
