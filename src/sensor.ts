export interface SensorSample {
  ax: number;
  ay: number;
  az: number;
  t: number;
}

export type SensorCallback = (s: SensorSample) => void;

let cb: SensorCallback | null = null;

const DM_OPTS: AddEventListenerOptions = { passive: true };

/** m/s² — user linear acceleration → ~[-1,1] (matches mouse tanh domain) */
const PHONE_ACCEL_REF = 2.2;
/** rotationRate is deg/s in WebKit; scale to similar magnitude as accel */
const RR_REF = 90;
/**
 * Final smoothing — same order as mouse velocity EMA (0.085) so phone tilt + tilt-rate
 * feels as intuitive as cursor movement.
 */
const UNIFIED_INPUT_EMA = 0.088;
/** EMA step for device-motion tilt vs gyro fallback (same order as mouse velocity smoothing). */
const DEVICE_EMA_GRAVITY = UNIFIED_INPUT_EMA;
const DEVICE_EMA_GYRO = UNIFIED_INPUT_EMA;
/** Blend: static tilt vs rate-of-tilt (mirrors “where you point” vs “how you flick the mouse”). */
const PHONE_POS_WEIGHT = 0.5;
const PHONE_VEL_WEIGHT = 0.5;
/** Scale tilt velocity (in [-1,1] domain per second) into tanh like mouse V_REF. */
const PHONE_VEL_REF = 6.2;
const MOUSE_VEL_ALPHA = 0.085;

function accelTriplet(o: DeviceMotionEventAcceleration | null): [number, number, number] | null {
  if (!o) return null;
  const x = o.x;
  const y = o.y;
  const z = o.z;
  if (x == null || y == null || z == null) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}

/**
 * Map device-frame gravity (m/s²) to screen-style axes the skeleton uses (canvas: +x right, +y down).
 * Uses a unit vector so tilt angle maps ~linearly to lean, instead of tanh-saturating ~9.8 m/s² values.
 */
function gravityToScreenTilt(gx: number, gy: number, gz: number): { sx: number; sy: number; uz: number } {
  const len = Math.hypot(gx, gy, gz);
  if (len < 0.35) return { sx: 0, sy: 0, uz: 0 };
  const nx = gx / len;
  const ny = gy / len;
  const nz = gz / len;

  const landscape =
    typeof window !== "undefined" && window.matchMedia?.("(orientation: landscape)")?.matches === true;

  if (landscape) {
    // Long edge horizontal: swap which device axis reads as screen-left-right vs in/out tilt.
    return { sx: ny, sy: -nz, uz: -nx };
  }

  const portraitSecondary =
    typeof screen !== "undefined" && screen.orientation?.type === "portrait-secondary";
  if (portraitSecondary) {
    return { sx: -nx, sy: nz, uz: -ny };
  }

  return { sx: nx, sy: -nz, uz: ny };
}

let emaAx = 0;
let emaAy = 0;
let emaAz = 0;

function onDeviceMotion(e: DeviceMotionEvent) {
  if (touchDragActive) return;

  const lin = accelTriplet(e.acceleration);
  const grav = accelTriplet(e.accelerationIncludingGravity);

  let tx = 0;
  let ty = 0;
  let tz = 0;
  let emaK = DEVICE_EMA_GYRO;

  if (grav) {
    const [gdx, gdy, gdz] = grav;
    const { sx, sy, uz } = gravityToScreenTilt(gdx, gdy, gdz);
    tx = sx;
    ty = sy;
    tz = uz;
    emaK = DEVICE_EMA_GRAVITY;

    if (lin) {
      const [lx, ly, lz] = lin;
      const shakeScale = 0.42;
      tx += Math.tanh(lx / PHONE_ACCEL_REF) * shakeScale;
      ty += Math.tanh(ly / PHONE_ACCEL_REF) * shakeScale;
      tz += Math.tanh(lz / PHONE_ACCEL_REF) * shakeScale * 0.5;
    }
  } else if (lin) {
    const [lx, ly, lz] = lin;
    tx = Math.tanh(lx / PHONE_ACCEL_REF);
    ty = Math.tanh(ly / PHONE_ACCEL_REF);
    tz = Math.tanh(lz / PHONE_ACCEL_REF);
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
      tx = Math.tanh(rb / RR_REF);
      ty = Math.tanh(rg / RR_REF);
      tz =
        typeof ra === "number" && Number.isFinite(ra)
          ? Math.tanh(ra / RR_REF)
          : 0;
    } else {
      return;
    }
  }

  emaAx += emaK * (tx - emaAx);
  emaAy += emaK * (ty - emaAy);
  emaAz += emaK * (tz - emaAz);
  cb?.({
    ax: emaAx,
    ay: emaAy,
    az: emaAz,
    t: performance.now(),
  });
}

let lastMx = -1;
let lastMy = -1;
let lastT = 0;
let smoothVx = 0;
let smoothVy = 0;

/** True after a touch has moved; same frame as desktop mousemove, and pauses devicemotion while dragging. */
let touchDragActive = false;

function feedVelocityFromClient(clientX: number, clientY: number, now: number) {
  if (!cb) return;
  if (lastMx < 0) {
    lastMx = clientX;
    lastMy = clientY;
    lastT = now;
    return;
  }
  const dt = (now - lastT) / 1000;
  lastT = now;
  if (dt <= 0 || dt > 0.2) {
    lastMx = clientX;
    lastMy = clientY;
    return;
  }

  const rawVx = (clientX - lastMx) / dt;
  const rawVy = (clientY - lastMy) / dt;
  lastMx = clientX;
  lastMy = clientY;

  smoothVx += MOUSE_VEL_ALPHA * (rawVx - smoothVx);
  smoothVy += MOUSE_VEL_ALPHA * (rawVy - smoothVy);

  const V_REF = 2200;
  cb({
    ax: Math.tanh(smoothVx / V_REF),
    ay: Math.tanh(smoothVy / V_REF),
    az: 0,
    t: now,
  });
}

function onMouseMove(e: MouseEvent) {
  feedVelocityFromClient(e.clientX, e.clientY, performance.now());
}

function onTouchStart() {
  lastMx = -1;
  lastMy = -1;
}

function onTouchMove(e: TouchEvent) {
  if (e.touches.length === 0) return;
  touchDragActive = true;
  const t = e.touches[0]!;
  feedVelocityFromClient(t.clientX, t.clientY, performance.now());
}

function onTouchEnd(e: TouchEvent) {
  if (e.touches.length === 0) {
    touchDragActive = false;
    lastMx = -1;
    lastMy = -1;
  }
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

  if (hasMotionReq) {
    try {
      const perm = await DME.requestPermission!();
      return perm === "granted";
    } catch {
      return false;
    }
  }
  return true;
}

export function isSensorRunning(): boolean {
  return cb !== null;
}

export function startSensor(callback: SensorCallback) {
  cb = callback;
  emaAx = 0;
  emaAy = 0;
  emaAz = 0;
  touchDragActive = false;
  lastMx = -1;
  lastMy = -1;
  const mobile = isMobile();
  if (mobile) {
    window.addEventListener("devicemotion", onDeviceMotion, DM_OPTS);
    window.addEventListener("touchstart", onTouchStart, DM_OPTS);
    window.addEventListener("touchmove", onTouchMove, DM_OPTS);
    window.addEventListener("touchend", onTouchEnd, DM_OPTS);
    window.addEventListener("touchcancel", onTouchEnd, DM_OPTS);
  } else {
    window.addEventListener("mousemove", onMouseMove);
  }
}

export function stopSensor() {
  cb = null;
  touchDragActive = false;
  window.removeEventListener("devicemotion", onDeviceMotion, DM_OPTS);
  window.removeEventListener("mousemove", onMouseMove);
  window.removeEventListener("touchstart", onTouchStart, DM_OPTS);
  window.removeEventListener("touchmove", onTouchMove, DM_OPTS);
  window.removeEventListener("touchend", onTouchEnd, DM_OPTS);
  window.removeEventListener("touchcancel", onTouchEnd, DM_OPTS);
}
