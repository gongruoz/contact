export interface SensorSample {
  ax: number;
  ay: number;
  az: number;
  t: number;
}

export type SensorCallback = (s: SensorSample) => void;

let cb: SensorCallback | null = null;
let devicemotionLogged = false;

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
    if (!g || g.x == null || g.y == null || g.z == null) {
      // #region agent log
      if (!devicemotionLogged) {
        devicemotionLogged = true;
        fetch("http://127.0.0.1:7807/ingest/97db18e8-8eed-43b7-8c7f-cd4d981d08ef", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ab4e8d" },
          body: JSON.stringify({
            sessionId: "ab4e8d",
            location: "sensor.ts:onDeviceMotion",
            message: "devicemotion no usable accel",
            data: {
              hasAccelObj: !!a,
              hasGravityObj: !!g,
            },
            timestamp: Date.now(),
            hypothesisId: "H4",
          }),
        }).catch(() => {});
      }
      // #endregion
      return;
    }
    ax = g.x;
    ay = g.y;
    az = g.z;
  }
  // #region agent log
  if (!devicemotionLogged) {
    devicemotionLogged = true;
    fetch("http://127.0.0.1:7807/ingest/97db18e8-8eed-43b7-8c7f-cd4d981d08ef", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ab4e8d" },
      body: JSON.stringify({
        sessionId: "ab4e8d",
        location: "sensor.ts:onDeviceMotion",
        message: "devicemotion first sample ok",
        data: { usedAccelNotGravity: !!(a && a.x != null) },
        timestamp: Date.now(),
        hypothesisId: "H4",
      }),
    }).catch(() => {});
  }
  // #endregion
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
  if (typeof DeviceMotionEvent !== "undefined" && navigator.maxTouchPoints > 0) return true;
  if (window.matchMedia?.("(pointer: coarse)")?.matches) return true;
  const ua = navigator.userAgent;
  if (/Mobi|Android|iPhone|iPad|Tablet/i.test(ua)) return true;
  try {
    const ud = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
    if (ud?.mobile === true) return true;
  } catch { /* ignore */ }
  return false;
}

export async function requestMotionPermission(): Promise<boolean> {
  const hasReq =
    typeof DeviceMotionEvent !== "undefined" &&
    typeof (DeviceMotionEvent as any).requestPermission === "function";
  // #region agent log
  fetch("http://127.0.0.1:7807/ingest/97db18e8-8eed-43b7-8c7f-cd4d981d08ef", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ab4e8d" },
    body: JSON.stringify({
      sessionId: "ab4e8d",
      location: "sensor.ts:requestMotionPermission",
      message: "permission branch",
      data: { usesIOSStylePrompt: hasReq },
      timestamp: Date.now(),
      hypothesisId: "H3",
    }),
  }).catch(() => {});
  // #endregion
  if (hasReq) {
    try {
      const perm = await (DeviceMotionEvent as any).requestPermission();
      // #region agent log
      fetch("http://127.0.0.1:7807/ingest/97db18e8-8eed-43b7-8c7f-cd4d981d08ef", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ab4e8d" },
        body: JSON.stringify({
          sessionId: "ab4e8d",
          location: "sensor.ts:requestMotionPermission",
          message: "iOS permission result",
          data: { perm },
          timestamp: Date.now(),
          hypothesisId: "H3",
        }),
      }).catch(() => {});
      // #endregion
      return perm === "granted";
    } catch {
      return false;
    }
  }
  return true;
}

export function startSensor(callback: SensorCallback) {
  cb = callback;
  const mobile = isMobile();
  // #region agent log
  fetch("http://127.0.0.1:7807/ingest/97db18e8-8eed-43b7-8c7f-cd4d981d08ef", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ab4e8d" },
    body: JSON.stringify({
      sessionId: "ab4e8d",
      location: "sensor.ts:startSensor",
      message: "listener branch",
      data: { isMobile: mobile, mode: mobile ? "devicemotion" : "mousemove" },
      timestamp: Date.now(),
      hypothesisId: "H1",
    }),
  }).catch(() => {});
  // #endregion
  if (mobile) {
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
