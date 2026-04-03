import * as twgl from "twgl.js";
import vertSrc from "./blob.vert?raw";
import fragSrc from "./blob.frag?raw";
import type { Features } from "./dsp";

let gl: WebGLRenderingContext;
let programInfo: twgl.ProgramInfo;
let bufferInfo: twgl.BufferInfo;

const uniforms: Record<string, number | number[]> = {
  u_time: 0,
  u_resolution: [1, 1],
  u_a_amplitude: 0,
  u_a_frequency: 0,
  u_a_hue: 0,
  u_a_smoothness: 0,
  u_a_center: [0.5, 0.5],
  u_a_opacity: 1,
  u_b_amplitude: 0,
  u_b_frequency: 0,
  u_b_hue: 0,
  u_b_smoothness: 0,
  u_b_center: [0.5, 0.5],
  u_b_opacity: 0,
  u_similarity: 0,
};

const smooth = {
  a_amp: 0, a_freq: 0, a_hue: 0, a_smooth: 0,
  b_amp: 0, b_freq: 0, b_hue: 0, b_smooth: 0,
  b_opacity: 0, b_cx: 0.5, b_cy: 0.5, similarity: 0,
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function initRenderer(canvas: HTMLCanvasElement) {
  gl = canvas.getContext("webgl", { alpha: false, antialias: false })!;
  if (!gl) throw new Error("WebGL not supported");

  programInfo = twgl.createProgramInfo(gl, [vertSrc, fragSrc]);
  bufferInfo = twgl.createBufferInfoFromArrays(gl, {
    position: { numComponents: 2, data: [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1] },
  });
}

export function setSelfFeatures(f: Features) {
  smooth.a_amp = f.amplitude;
  smooth.a_freq = f.frequency;
  smooth.a_hue = f.axis;
  smooth.a_smooth = f.smoothness;
}

export function setPeerFeatures(f: Features) {
  smooth.b_amp = f.amplitude;
  smooth.b_freq = f.frequency;
  smooth.b_hue = f.axis;
  smooth.b_smooth = f.smoothness;
}

export function setPeerVisuals(opacity: number, cx: number, cy: number, similarity: number) {
  smooth.b_opacity = opacity;
  smooth.b_cx = cx;
  smooth.b_cy = cy;
  smooth.similarity = similarity;
}

export function renderFrame(time: number) {
  twgl.resizeCanvasToDisplaySize(gl.canvas as HTMLCanvasElement);
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

  const t = 0.035;

  uniforms.u_time = time / 1000;
  uniforms.u_resolution = [gl.canvas.width, gl.canvas.height];

  uniforms.u_a_amplitude = lerp(uniforms.u_a_amplitude as number, smooth.a_amp, t);
  uniforms.u_a_frequency = lerp(uniforms.u_a_frequency as number, smooth.a_freq, t);
  uniforms.u_a_hue = lerp(uniforms.u_a_hue as number, smooth.a_hue, t);
  uniforms.u_a_smoothness = lerp(uniforms.u_a_smoothness as number, smooth.a_smooth, t);
  (uniforms.u_a_center as number[])[0] = 0.5;
  (uniforms.u_a_center as number[])[1] = 0.5;
  uniforms.u_a_opacity = 1;

  uniforms.u_b_amplitude = lerp(uniforms.u_b_amplitude as number, smooth.b_amp, t);
  uniforms.u_b_frequency = lerp(uniforms.u_b_frequency as number, smooth.b_freq, t);
  uniforms.u_b_hue = lerp(uniforms.u_b_hue as number, smooth.b_hue, t);
  uniforms.u_b_smoothness = lerp(uniforms.u_b_smoothness as number, smooth.b_smooth, t);
  uniforms.u_b_opacity = lerp(uniforms.u_b_opacity as number, smooth.b_opacity, t);
  (uniforms.u_b_center as number[])[0] = lerp((uniforms.u_b_center as number[])[0], smooth.b_cx, t);
  (uniforms.u_b_center as number[])[1] = lerp((uniforms.u_b_center as number[])[1], smooth.b_cy, t);
  uniforms.u_similarity = lerp(uniforms.u_similarity as number, smooth.similarity, t);

  gl.useProgram(programInfo.program);
  twgl.setBuffersAndAttributes(gl, programInfo, bufferInfo);
  twgl.setUniforms(programInfo, uniforms);
  twgl.drawBufferInfo(gl, bufferInfo);
}
