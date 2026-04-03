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

const AMP_MAX = 4.0;
const FREQ_MAX = 12;
const JERK_MAX = 3.0;

export function extractFeatures(): Features {
  const amp = Math.min(rms(magBuf) / AMP_MAX, 1);

  const freqHz = dominantFrequency();
  const freq = Math.min(freqHz / FREQ_MAX, 1);

  const ex = mean(axBuf);
  const ey = mean(ayBuf);
  const ez = mean(azBuf);
  const total = ex + ey + ez + 1e-8;
  const hue = Math.atan2(ey / total - 0.333, ex / total - 0.333) / (2 * Math.PI) + 0.5;
  const axis = ((hue % 1) + 1) % 1;

  const jerkRms = rms(jerkBuf);
  const smoothness = Math.min(jerkRms / JERK_MAX, 1);

  return { amplitude: amp, frequency: freq, axis, smoothness };
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
