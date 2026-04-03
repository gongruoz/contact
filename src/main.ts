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

onPeerData((data) => {
  peerFeatures = arrayToFeatures(data);
  setPeerFeatures(peerFeatures);
});

onPeerConnected(() => {
  connected = true;
  peerFeatures = null;
  resetSimilarity();
  showConnected();
  setHint("");
});

onPeerDisconnected(() => {
  connected = false;
  peerFeatures = null;
  resetSimilarity();
  setPeerVisuals(0, 0.5, 0.5, 0);
  showDisconnected();
});

// Distance-to-visual mapping
function updateProximity() {
  if (!connected || !peerFeatures) {
    setPeerVisuals(0, 0.5, 0.5, 0);
    return;
  }

  const sim = computeSimilarity(selfFeatures, peerFeatures);

  let opacity: number;
  let cx: number;
  let cy: number;

  if (sim < 0.15) {
    opacity = 0;
    cx = 0.5;
    cy = -0.2;
  } else if (sim < 0.5) {
    // Emerging from edge, moving toward center
    const t = (sim - 0.15) / 0.35;
    opacity = t * 0.6;
    cx = 0.5;
    cy = -0.1 + t * 0.4;
  } else if (sim < 0.75) {
    // Approaching, both visible
    const t = (sim - 0.5) / 0.25;
    opacity = 0.6 + t * 0.4;
    cx = 0.5;
    cy = 0.3 + t * 0.15;
  } else {
    // Close/fusion
    opacity = 1;
    cx = 0.5;
    cy = 0.45 + (sim - 0.75) * 0.2;
  }

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
