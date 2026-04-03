import { startSensor, isMobile, requestMotionPermission, type SensorSample } from "./sensor";
import { pushSample, extractFeatures, featuresToArray, arrayToFeatures, type Features } from "./dsp";
import { initRenderer, setSelfFeatures, setPeerFeatures, setPeerVisuals, renderFrame } from "./render";
import { computeSimilarity, resetSimilarity } from "./similarity";
import { createRoom, joinRoom, sendFeatures, onPeerData, onPeerConnected, onPeerDisconnected, isConnected } from "./peer";
import { setHint, showRoomCode, showConnected, showDisconnected, onCreateRoom, onJoinRoom, setStatus } from "./ui";

const canvas = document.getElementById("gl") as HTMLCanvasElement;
initRenderer(canvas);

let selfFeatures: Features = { amplitude: 0, frequency: 0, axis: 0, smoothness: 0 };
let peerFeatures: Features | null = null;
let connected = false;

function onSensorSample(s: SensorSample) {
  pushSample(s);
}

// Extract features at ~20Hz and send to peer
let lastExtract = 0;
function maybeExtractAndSend(now: number) {
  if (now - lastExtract < 50) return;
  lastExtract = now;

  selfFeatures = extractFeatures();
  setSelfFeatures(selfFeatures);

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
  setPeerFeatures(peerFeatures);
});

onPeerConnected(() => {
  connected = true;
  peerFeatures = null;
  resetSimilarity();
  showConnected();
  setHint("");
  selfFeatures = extractFeatures();
  setSelfFeatures(selfFeatures);
  sendFeatures(featuresToArray(selfFeatures));
});

onPeerDisconnected(() => {
  connected = false;
  peerFeatures = null;
  resetSimilarity();
  setPeerVisuals(0, 0.5, 0.5, 0);
  showDisconnected();
});

// Distance-to-visual mapping
// Peer blob must stay visible at low similarity so you can observe their motion and imitate.
// Similarity then pulls them toward the center and strengthens fusion in the shader.
function updateProximity() {
  if (!connected || !peerFeatures) {
    setPeerVisuals(0, 0.5, 0.5, 0);
    return;
  }

  const sim = computeSimilarity(selfFeatures, peerFeatures);

  const minOpacity = 0.42;
  const opacity = minOpacity + (1 - minOpacity) * sim;

  const cx = 0.5;
  const cyTop = 0.1;
  const cyNear = 0.44;
  const cy = cyTop + sim * (cyNear - cyTop);

  setPeerVisuals(opacity, cx, cy, sim);
}

// Render loop
function loop(time: number) {
  maybeExtractAndSend(time);
  updateProximity();
  renderFrame(time);
  requestAnimationFrame(loop);
}

// Boot
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
    } catch (e) {
      setStatus("failed to create room");
    }
  });

  onJoinRoom(async (code) => {
    setStatus("joining...");
    try {
      await joinRoom(code);
    } catch (e) {
      setStatus("failed to join");
    }
  });

  requestAnimationFrame(loop);
}

init();
