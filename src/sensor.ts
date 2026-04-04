export interface SensorSample {
  ax: number;
  ay: number;
  az: number;
  t: number;
}

export type SensorCallback = (s: SensorSample) => void;

let cb: SensorCallback | null = null;
let loggedMotionFail = false;
let loggedMotionOk = false;

const DM_OPTS: AddEventListenerOptions = { passive: true };

/** m/s² — compress to ~[-1,1] so phone matches mouse tanh domain */
const PHONE_ACCEL_REF = 2.2;
/** rotationRate is deg/s in WebKit; scale to similar magnitude as accel */
const RR_REF = 90;

function accelTriplet(o: DeviceMotionEventAcceleration | null): [number, number, number] | null {
  if (!o) return null;
  const x = o.x;
  const y = o.y;
  const z = o.z;
  if (x == null || y == null || z == null) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}

function onDeviceMotion(e: DeviceMotionEvent) {
  let ax = 0;
  let ay = 0;
  let az = 0;
  let source = "";

  const lin = accelTriplet(e.acceleration);
  if (lin) {
    [ax, ay, az] = lin;
    source = "accel";
  } else {
    const grav = accelTriplet(e.accelerationIncludingGravity);
    if (grav) {
      [ax, ay, az] = grav;
      source = "gravity";
    } else {
      const rr = e.rotationRate;
      const rb = rr?.beta;
      const rg = rr?.gamma;
      const ra = rr?.alpha;
      if (
        typeof rb === "number" &&
        typeof rg === "number" &&
        Number.isFinite(rb) &&
        Number.isFinite(rg)
      ) {
        ax = rb;
        ay = rg;
        az = typeof ra === "number" && Number.isFinite(ra) ? ra : 0;
        source = "gyro";
      } else {
        // #region agent log
        if (!loggedMotionFail) {
          loggedMotionFail = true;
          fetch("http://127.0.0.1:7807/ingest/97db18e8-8eed-43b7-8c7f-cd4d981d08ef", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ab4e8d" },
            body: JSON.stringify({
              sessionId: "ab4e8d",
              location: "sensor.ts:onDeviceMotion",
              message: "no accel/gravity/gyro triplet",
              data: {
                hasLin: !!e.acceleration,
                hasGrav: !!e.accelerationIncludingGravity,
                hasRR: !!e.rotationRate,
              },
              timestamp: Date.now(),
              hypothesisId: "H4",
            }),
          }).catch(() => {});
        }
        // #endregion
        return;
      }
    }
  }

  const ref = source === "gyro" ? RR_REF : PHONE_ACCEL_REF;
  // #region agent log
  if (!loggedMotionOk) {
    loggedMotionOk = true;
    fetch("http://127.0.0.1:7807/ingest/97db18e8-8eed-43b7-8c7f-cd4d981d08ef", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ab4e8d" },
      body: JSON.stringify({
        sessionId: "ab4e8d",
        location: "sensor.ts:onDeviceMotion",
        message: "devicemotion first sample",
        data: { source },
        timestamp: Date.now(),
        hypothesisId: "H4",
      }),
    }).catch(() => {});
  }
  // #endregion

  cb?.({
    ax: Math.tanh(ax / ref),
    ay: Math.tanh(ay / ref),
    az: Math.tanh(az / ref),
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

  const alpha = 0.15;
  smoothVx += alpha * (rawVx - smoothVx);
  smoothVy += alpha * (rawVy - smoothVy);

  const V_REF = 2200;
  cb?.({
    ax: Math.tanh(smoothVx / V_REF),
    ay: Math.tanh(smoothVy / V_REF),
    az: 0,
    t: now,
  });
}

/**
 * Touch-first: motion path when DeviceMotion exists + touch, or coarse pointer, or mobile UA.
 */
export function isMobile(): boolean {
  if (typeof DeviceMotionEvent !== "undefined" && navigator.maxTouchPoints > 0) return true;
  if (window.matchMedia?.("(pointer: coarse)")?.matches) return true;
  const ua = navigator.userAgent;
  if (/Mobi|Android|iPhone|iPad|Tablet/i.test(ua)) return true;
  try {
    const ud = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
    if (ud?.mobile === true) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export async function requestMotionPermission(): Promise<boolean> {
  const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
  const hasMotionReq = typeof DeviceMotionEvent !== "undefined" && typeof DME.requestPermission === "function";

  // #region agent log
  fetch("http://127.0.0.1:7807/ingest/97db18e8-8eed-43b7-8c7f-cd4d981d08ef", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ab4e8d" },
    body: JSON.stringify({
      sessionId: "ab4e8d",
      location: "sensor.ts:requestMotionPermission",
      message: "permission branch",
      data: { hasMotionReq },
      timestamp: Date.now(),
      hypothesisId: "H3",
    }),
  }).catch(() => {});
  // #endregion

  if (hasMotionReq) {
    try {
      const perm = await DME.requestPermission!();
      // #region agent log
      fetch("http://127.0.0.1:7807/ingest/97db18e8-8eed-43b7-8c7f-cd4d981d08ef", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ab4e8d" },
        body: JSON.stringify({
          sessionId: "ab4e8d",
          location: "sensor.ts:requestMotionPermission",
          message: "DeviceMotion permission",
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
  loggedMotionFail = false;
  loggedMotionOk = false;
  const mobile = isMobile();
  // #region agent log
  fetch("http://127.0.0.1:7807/ingest/97db18e8-8eed-43b7-8c7f-cd4d981d08ef", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ab4e8d" },
    body: JSON.stringify({
      sessionId: "ab4e8d",
      location: "sensor.ts:startSensor",
      message: "listener branch",
      data: { isMobile: mobile, mode: mobile ? "devicemotion" : "mousemove", secure: window.isSecureContext },
      timestamp: Date.now(),
      hypothesisId: "H1",
    }),
  }).catch(() => {});
  // #endregion
  if (mobile) {
    window.addEventListener("devicemotion", onDeviceMotion, DM_OPTS);
  } else {
    window.addEventListener("mousemove", onMouseMove);
  }
}

export function stopSensor() {
  cb = null;
  window.removeEventListener("devicemotion", onDeviceMotion, DM_OPTS);
  window.removeEventListener("mousemove", onMouseMove);
}
