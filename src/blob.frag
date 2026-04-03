precision highp float;

varying vec2 v_uv;

uniform float u_time;
uniform vec2 u_resolution;

// Blob A (self)
uniform float u_a_amplitude;
uniform float u_a_frequency;
uniform float u_a_hue;
uniform float u_a_smoothness;
uniform vec2 u_a_center;
uniform float u_a_opacity;

// Blob B (peer)
uniform float u_b_amplitude;
uniform float u_b_frequency;
uniform float u_b_hue;
uniform float u_b_smoothness;
uniform vec2 u_b_center;
uniform float u_b_opacity;

uniform float u_similarity;

// --- simplex 2D noise (Ashima Arts) ---
vec3 mod289(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec2 mod289v2(vec2 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289((x * 34.0 + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                      -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289v2(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                   + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x_ = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x_) - 0.5;
  vec3 ox = floor(x_ + 0.5);
  vec3 a0 = x_ - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// HSL to RGB
vec3 hsl2rgb(float h, float s, float l) {
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return l + s * (rgb - 0.5) * (1.0 - abs(2.0*l - 1.0));
}

float blobSDF(vec2 uv, vec2 center, float amplitude, float frequency, float smoothness) {
  float baseRadius = 0.08 + amplitude * 0.18;
  float t = u_time * (0.5 + frequency * 3.0);

  float noiseAmt = smoothness * 0.12;
  float n = snoise(uv * 6.0 + t * 0.8) * noiseAmt;
  n += snoise(uv * 12.0 - t * 1.2) * noiseAmt * 0.5;

  float d = length(uv - center) - baseRadius + n;
  return d;
}

float pulse(float t, float frequency) {
  float speed = 0.5 + frequency * 4.0;
  return 0.5 + 0.5 * sin(t * speed);
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv;
  uv.x *= aspect;

  vec2 cA = u_a_center;
  cA.x *= aspect;
  vec2 cB = u_b_center;
  cB.x *= aspect;

  float dA = blobSDF(uv, cA, u_a_amplitude, u_a_frequency, u_a_smoothness);
  float dB = blobSDF(uv, cB, u_b_amplitude, u_b_frequency, u_b_smoothness);

  // Metaball blend: smooth minimum of SDFs for fusion effect
  float k = 0.06;
  float blend = -log(exp(-dA/k) + exp(-dB/k) * u_b_opacity) * k;

  // Individual blobs for coloring
  float blobA = smoothstep(0.01, -0.005, dA);
  float blobB = smoothstep(0.01, -0.005, dB) * u_b_opacity;
  float blobAll = smoothstep(0.01, -0.005, blend);

  // Glow
  float glowA = exp(-max(dA, 0.0) * 18.0) * (0.3 + 0.3 * pulse(u_time, u_a_frequency));
  float glowB = exp(-max(dB, 0.0) * 18.0) * (0.3 + 0.3 * pulse(u_time, u_b_frequency)) * u_b_opacity;

  // Colors
  float satA = min(u_a_amplitude * 2.0, 0.7);
  vec3 colA = hsl2rgb(u_a_hue, satA, 0.75);

  float satB = min(u_b_amplitude * 2.0, 0.7);
  vec3 colB = hsl2rgb(u_b_hue, satB, 0.75);

  // Mix colors based on relative blob influence
  float totalBlob = blobA + blobB + 0.001;
  vec3 col = (colA * blobA + colB * blobB) / totalBlob;

  // Fusion shimmer when similarity is high
  float fusionNoise = snoise(uv * 20.0 + u_time * 2.0) * 0.5 + 0.5;
  float fusionGlow = u_similarity * u_similarity * fusionNoise * 0.3;

  vec3 finalColor = col * blobAll + colA * glowA + colB * glowB;
  finalColor += vec3(1.0) * fusionGlow * blobAll;

  // Subtle ambient pulse on self blob when idle
  float ambient = 0.02 * pulse(u_time * 0.3, 0.0);
  float selfGlow = exp(-max(dA, 0.0) * 40.0) * ambient;
  finalColor += vec3(1.0) * selfGlow;

  gl_FragColor = vec4(finalColor, 1.0);
}
