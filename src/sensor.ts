export interface SensorSample {
  ax: number;
  ay: number;
  az: number;
  t: number;
}

export type SensorCallback = (s: SensorSample) => void;

let cb: SensorCallback | null = null;

/** m/s² — compress to ~[-1,1] so phone matches mouse tanh domain */
const PHONE_ACCEL_REF = 2.2;

function onDeviceMotion(e: DeviceMotionEvent) {
  let ax = 0;
  let ay = 0;
  let az = 0;
  const a = e.acceleration;
  if (a && a.x != null && a.y != null && a.z != null) {
    ax = a.x;
    ay = a.y;
    az = a.z;
  } else {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null || g.y == null || g.z == null) return;
    ax = g.x;
    ay = g.y;
    az = g.z;
  }
  cb?.({
    ax: Math.tanh(ax / PHONE_ACCEL_REF),
    ay: Math.tanh(ay / PHONE_ACCEL_REF),
    az: Math.tanh(az / PHONE_ACCEL_REF),
    t: performance.now(),
  });
}

let lastMx = -1;
let lastMy = -1;
let lastT = 0;
let smoothVx = 0;
let smoothVy = 0;

function onMouseMove(e: MouseEvent) {
  const now = performance.now();
  if (lastMx < 0) {
    lastMx = e.clientX;
    lastMy = e.clientY;
    lastT = now;
    return;
  }
  const dt = (now - lastT) / 1000;
  lastT = now;
  if (dt <= 0 || dt > 0.2) {
    lastMx = e.clientX;
    lastMy = e.clientY;
    return;
  }

  const rawVx = (e.clientX - lastMx) / dt;
  const rawVy = (e.clientY - lastMy) / dt;
  lastMx = e.clientX;
  lastMy = e.clientY;

  // EMA-smoothed velocity — removes jitter from discrete pixel steps
  const alpha = 0.15;
  smoothVx += alpha * (rawVx - smoothVx);
  smoothVy += alpha * (rawVy - smoothVy);

  // Same ~[-1,1] range as phone (tanh) so feature extraction is cross-device comparable
  const V_REF = 2200;
  cb?.({
    ax: Math.tanh(smoothVx / V_REF),
    ay: Math.tanh(smoothVy / V_REF),
    az: 0,
    t: now,
  });
}

/**
 * Whether to use device motion (accelerometer) instead of mouse.
 * Tablets work the same as phones when the browser exposes DeviceMotionEvent
 * (after permission on iOS Safari). This must catch iPad “desktop” UA
 * (MacIntel + touch) so we don’t fall back to mouse on large iPads.
 */
export function isMobile(): boolean {
  const ua = navigator.userAgent;
  if (/Mobi|Android|iPhone|iPad|Tablet|Silk|PlayBook/i.test(ua)) return true;
  try {
    const ud = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
    if (ud?.mobile === true) return true;
  } catch {
    /* ignore */
  }
  if (navigator.maxTouchPoints > 1 && /MacIntel/i.test(navigator.platform)) {
    return true;
  }
  return false;
}

export async function requestMotionPermission(): Promise<boolean> {
  if (
    typeof DeviceMotionEvent !== "undefined" &&
    typeof (DeviceMotionEvent as any).requestPermission === "function"
  ) {
    try {
      const perm = await (DeviceMotionEvent as any).requestPermission();
      return perm === "granted";
    } catch {
      return false;
    }
  }
  return true;
}

export function startSensor(callback: SensorCallback) {
  cb = callback;
  if (isMobile()) {
    window.addEventListener("devicemotion", onDeviceMotion);
  } else {
    window.addEventListener("mousemove", onMouseMove);
  }
}

export function stopSensor() {
  cb = null;
  window.removeEventListener("devicemotion", onDeviceMotion);
  window.removeEventListener("mousemove", onMouseMove);
}
