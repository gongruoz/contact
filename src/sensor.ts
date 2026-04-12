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
/** Low-pass when only gyro is available */
const DEVICE_EMA_GYRO = 0.14;
/**
 * Faster follow for gravity tilt: components are already in ~[-1,1] after normalization,
 * so we can track phone pose without the old heavy low-pass that hid direction.
 */
const DEVICE_EMA_GRAVITY = 0.42;

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

  const alpha = 0.085;
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
  const mobile = isMobile();
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
