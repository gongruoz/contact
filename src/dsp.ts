import type { SensorSample } from "./sensor";

export interface Features {
  amplitude: number; // [0,1]
  frequency: number; // [0,1]
  axis: number; // hue angle [0,1]
  smoothness: number; // [0,1]  0=smooth, 1=jerky
}

const BUFFER_SIZE = 128;

const magBuf = new Float32Array(BUFFER_SIZE);
const axBuf = new Float32Array(BUFFER_SIZE);
const ayBuf = new Float32Array(BUFFER_SIZE);
const azBuf = new Float32Array(BUFFER_SIZE);
let head = 0;
let count = 0;
let prevMag = 0;
const jerkBuf = new Float32Array(BUFFER_SIZE);

export function pushSample(s: SensorSample) {
  const mag = Math.sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az);
  const jerk = Math.abs(mag - prevMag);
  prevMag = mag;

  magBuf[head] = mag;
  axBuf[head] = s.ax * s.ax;
  ayBuf[head] = s.ay * s.ay;
  azBuf[head] = s.az * s.az;
  jerkBuf[head] = jerk;
  head = (head + 1) % BUFFER_SIZE;
  if (count < BUFFER_SIZE) count++;
}

function rms(buf: Float32Array): number {
  if (count === 0) return 0;
  let sum = 0;
  const n = Math.min(count, BUFFER_SIZE);
  for (let i = 0; i < n; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / n);
}

function mean(buf: Float32Array): number {
  if (count === 0) return 0;
  let sum = 0;
  const n = Math.min(count, BUFFER_SIZE);
  for (let i = 0; i < n; i++) sum += buf[i];
  return sum / n;
}

function maxMagInBuffer(): number {
  if (count === 0) return 0;
  let m = 0;
  const n = Math.min(count, BUFFER_SIZE);
  for (let i = 0; i < n; i++) {
    const idx = (head - n + i + BUFFER_SIZE) % BUFFER_SIZE;
    const v = magBuf[idx];
    if (v > m) m = v;
  }
  return m;
}

/**
 * Simple dominant-frequency estimation via zero-crossing rate
 * on the de-meaned magnitude signal. Avoids full FFT for v1.
 */
function dominantFrequency(): number {
  const n = Math.min(count, BUFFER_SIZE);
  if (n < 4) return 0;

  let sum = 0;
  for (let i = 0; i < n; i++) sum += magBuf[i];
  const avg = sum / n;

  let crossings = 0;
  let prevSign = magBuf[(head - n + BUFFER_SIZE) % BUFFER_SIZE] - avg >= 0;
  for (let i = 1; i < n; i++) {
    const idx = (head - n + i + BUFFER_SIZE) % BUFFER_SIZE;
    const sign = magBuf[idx] - avg >= 0;
    if (sign !== prevSign) crossings++;
    prevSign = sign;
  }

  const sampleRate = 60;
  const freqHz = (crossings / 2) * (sampleRate / n);
  return freqHz;
}

const FREQ_MAX = 12;
/** jerk on tanh-normalized magnitude (same units mouse vs phone) */
const JERK_MAX = 0.35;
/** EMA on extracted features (reduces feature flicker from noisy buffers) */
const FEATURE_EMA = 0.16;

let featSmooth: Features = { amplitude: 0, frequency: 0, axis: 0.5, smoothness: 0 };

export function extractFeatures(): Features {
  const magRms = rms(magBuf);
  const peak = maxMagInBuffer();
  // Relative intensity: comparable across mouse (velocity→tanh) vs phone (accel→tanh)
  const amp =
    peak < 1e-4 ? 0 : Math.min(magRms / (peak + 0.04), 1);

  const freqHz = dominantFrequency();
  const freq = Math.min(freqHz / FREQ_MAX, 1);

  const ex = mean(axBuf);
  const ey = mean(ayBuf);
  const ez = mean(azBuf);
  // Blend Z into the 2D angle so phone-only depth shake is not stuck at atan2(0,0); mouse has ez≈0
  const axisRaw = Math.atan2(ey + 0.35 * ez + 1e-12, ex + 0.35 * ez + 1e-12) / (Math.PI / 2);
  const axis = Math.min(Math.max(axisRaw, 0), 1);

  const jerkRms = rms(jerkBuf);
  const smoothness = Math.min(jerkRms / JERK_MAX, 1);

  const k = FEATURE_EMA;
  featSmooth.amplitude += k * (amp - featSmooth.amplitude);
  featSmooth.frequency += k * (freq - featSmooth.frequency);
  featSmooth.axis += k * (axis - featSmooth.axis);
  featSmooth.smoothness += k * (smoothness - featSmooth.smoothness);
  return {
    amplitude: featSmooth.amplitude,
    frequency: featSmooth.frequency,
    axis: featSmooth.axis,
    smoothness: featSmooth.smoothness,
  };
}

export function featuresToArray(f: Features): Float32Array {
  return new Float32Array([f.amplitude, f.frequency, f.axis, f.smoothness]);
}

export function arrayToFeatures(a: Float32Array | number[]): Features {
  return {
    amplitude: a[0],
    frequency: a[1],
    axis: a[2],
    smoothness: a[3],
  };
}
