export interface SensorSample {
  ax: number;
  ay: number;
  az: number;
  t: number;
}

export type SensorCallback = (s: SensorSample) => void;

let cb: SensorCallback | null = null;

function onDeviceMotion(e: DeviceMotionEvent) {
  const a = e.acceleration;
  if (!a || a.x == null || a.y == null || a.z == null) return;
  cb?.({ ax: a.x, ay: a.y, az: a.z, t: performance.now() });
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

  // Emit smoothed velocity as the "acceleration" signal.
  // Mouse velocity is the conceptual equivalent of phone acceleration
  // (how fast you're swinging it).
  const scale = 1 / 800;
  cb?.({ ax: smoothVx * scale, ay: smoothVy * scale, az: 0, t: now });
}

export function isMobile(): boolean {
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
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
