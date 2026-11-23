// Highcrag — scenery: sky, environment lighting, water, clouds, terrain material, vegetation and set dressing.
// Everything is procedural (canvas textures and generated geometry); nothing is loaded from files.
import * as THREE from '../../vendor/three.module.js';
import { mergeGeometries } from '../../vendor/addons/BufferGeometryUtils.js';
import { BANDS, R, COAST, HALF } from './terrain.js';

export const shared = { time: { value: 0 } };

// ---------------- quality ----------------
export function pickQuality(isTouch) {
  let pref = 'auto';
  try { pref = localStorage.getItem('highcrag.quality') || 'auto'; } catch { /* ignore */ }
  if (pref !== 'auto') return pref;
  const small = Math.min(screen.width, screen.height) < 520;
  if (isTouch && small) return 'low';
  if (isTouch) return 'medium';
  return 'high';
}
export const QUALITY = {
  low: { shadows: false, shadowSize: 0, decor: 0.45, pixelRatio: 1.25, standard: false, aa: false, clouds: 18, detail: false, post: false, grass: 0, outline: false },
  medium: { shadows: true, shadowSize: 1024, decor: 0.75, pixelRatio: 1.5, standard: true, aa: false, clouds: 26, detail: true, post: true, grass: 7000, outline: true },
  high: { shadows: true, shadowSize: 2048, decor: 1, pixelRatio: 2, standard: true, aa: true, clouds: 36, detail: true, post: true, grass: 15000, outline: true },
};

// Material factory: physically based on Medium/High, Lambert on Low (much cheaper on phones).
let USE_STD = true;
const pbr = (color, extra = {}) => {
  const { roughness = 0.85, metalness = 0, ...rest } = extra;
  return USE_STD ? new THREE.MeshStandardMaterial({ color, roughness, metalness, ...rest }) : new THREE.MeshLambertMaterial({ color, ...rest });
};
const lam = (color, extra = {}) => pbr(color, extra);

// ---------------- procedural textures ----------------
const texCache = {};
function canvasTex(key, w, h, draw, { repeat = null, srgb = true } = {}) {
  if (texCache[key]) return texCache[key];
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  texCache[key] = t;
  return t;
}
const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

function leafTex(key, hue, sat, light) {
  return canvasTex(key, 256, 256, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const r = Math.sqrt(rnd()) * 118, a = rnd() * Math.PI * 2;
      const px = 128 + Math.cos(a) * r, py = 128 + Math.sin(a) * r;
      const L = light + (rnd() - 0.5) * 18 - r * 0.06;
      x.save();
      x.translate(px, py);
      x.rotate(rnd() * Math.PI * 2);
      x.fillStyle = hsl(hue + (rnd() - 0.5) * 16, sat, Math.max(8, L));
      x.beginPath();
      x.ellipse(0, 0, 5 + rnd() * 5, 11 + rnd() * 8, 0, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = hsl(hue, sat, Math.max(5, L - 14), 0.6);
      x.lineWidth = 1;
      x.beginPath(); x.moveTo(0, -12); x.lineTo(0, 12); x.stroke();
      x.restore();
    }
  });
}
function needleTex(key, snowy) {
  return canvasTex(key, 256, 256, (x) => {
    x.clearRect(0, 0, 256, 256);
    // A drooping branch: a central twig with needles fanning out.
    for (let b = 0; b < 5; b++) {
      const y0 = 30 + b * 44;
      x.strokeStyle = '#3a2a1c'; x.lineWidth = 3;
      x.beginPath(); x.moveTo(128, y0); x.lineTo(128, y0 + 40); x.stroke();
      for (let i = 0; i < 140; i++) {
        const t = rnd();
        const sx = 128 + (rnd() - 0.5) * 6, sy = y0 + t * 40;
        const len = 18 + rnd() * 34 * (1 - t * 0.4);
        const ang = (rnd() < 0.5 ? -1 : 1) * (0.4 + rnd() * 1.1) + Math.PI / 2;
        x.strokeStyle = hsl(150 + rnd() * 20, 35 + rnd() * 15, 18 + rnd() * 14);
        x.lineWidth = 1.6;
        x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len * 0.45 + len * 0.3); x.stroke();
      }
      if (snowy) {
        for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(245,250,255,${0.6 + rnd() * 0.4})`; x.beginPath(); x.ellipse(128 + (rnd() - 0.5) * 90, y0 + rnd() * 18, 5 + rnd() * 8, 2 + rnd() * 3, 0, 0, Math.PI * 2); x.fill(); }
      }
    }
  });
}
function frondTex() {
  return canvasTex('frond', 64, 256, (x) => {
    x.clearRect(0, 0, 64, 256);
    for (let i = 0; i < 60; i++) {
      const y = 8 + i * 4;
      const len = 28 * Math.sin((i / 60) * Math.PI) + 4;
      x.strokeStyle = hsl(95 + rnd() * 20, 50, 26 + rnd() * 14);
      x.lineWidth = 2.4;
      x.beginPath(); x.moveTo(32, y); x.lineTo(32 - len, y + 12); x.stroke();
      x.beginPath(); x.moveTo(32, y); x.lineTo(32 + len, y + 12); x.stroke();
    }
    x.strokeStyle = '#6b7a3a'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(32, 0); x.lineTo(32, 256); x.stroke();
  });
}
function grassTex(key, hue, light) {
  return canvasTex(key, 128, 128, (x) => {
    x.clearRect(0, 0, 128, 128);
    for (let i = 0; i < 46; i++) {
      const bx = 6 + rnd() * 116, h = 50 + rnd() * 74, lean = (rnd() - 0.5) * 30;
      // Each blade: darker at the root, sunlit toward the tip.
      const hh = hue + (rnd() - 0.5) * 14, sat = 40 + rnd() * 12, li = light + (rnd() - 0.5) * 8;
      const gr = x.createLinearGradient(0, 128, 0, 128 - h);
      gr.addColorStop(0, hsl(hh + 4, sat, li * 0.55));
      gr.addColorStop(0.55, hsl(hh, sat, li));
      gr.addColorStop(1, hsl(hh - 10, sat - 6, li * 1.35));
      x.fillStyle = gr;
      x.beginPath();
      x.moveTo(bx - 2.2, 128);
      x.quadraticCurveTo(bx + lean * 0.4, 128 - h * 0.6, bx + lean, 128 - h);
      x.quadraticCurveTo(bx + lean * 0.4 + 1, 128 - h * 0.6, bx + 2.2, 128);
      x.fill();
    }
  });
}
function flowerTex(key, hue) {
  return canvasTex(key, 128, 128, (x) => {
    x.clearRect(0, 0, 128, 128);
    for (let i = 0; i < 14; i++) {
      const bx = 10 + rnd() * 108, top = 30 + rnd() * 50;
      x.strokeStyle = hsl(110, 40, 28); x.lineWidth = 2;
      x.beginPath(); x.moveTo(bx, 128); x.quadraticCurveTo(bx + 4, (128 + top) / 2, bx + (rnd() - 0.5) * 8, top); x.stroke();
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2;
        x.fillStyle = hsl(hue + (rnd() - 0.5) * 10, 80, 62);
        x.beginPath(); x.ellipse(bx + Math.cos(a) * 4, top + Math.sin(a) * 4, 4, 2.4, a, 0, Math.PI * 2); x.fill();
      }
      x.fillStyle = hsl(48, 90, 55); x.beginPath(); x.arc(bx, top, 2.2, 0, Math.PI * 2); x.fill();
    }
  });
}
function barkTex(key, base) {
  return canvasTex(key, 64, 256, (x) => {
    x.fillStyle = base; x.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 90; i++) {
      x.strokeStyle = `rgba(${rnd() < 0.5 ? '20,12,6' : '140,110,80'},${0.15 + rnd() * 0.3})`;
      x.lineWidth = 1 + rnd() * 2.5;
      const bx = rnd() * 64;
      x.beginPath(); x.moveTo(bx, rnd() * 256); x.lineTo(bx + (rnd() - 0.5) * 6, rnd() * 256); x.stroke();
    }
  }, { repeat: [1, 2] });
}
function rockTex() {
  return canvasTex('rock', 128, 128, (x) => {
    const img = x.createImageData(128, 128);
    for (let j = 0; j < 128; j++) for (let i = 0; i < 128; i++) {
      const v = 150 + Math.sin(i * 0.2 + j * 0.05) * 10 + (rnd() - 0.5) * 60;
      const k = (j * 128 + i) * 4;
      img.data[k] = v; img.data[k + 1] = v * 0.97; img.data[k + 2] = v * 0.92; img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
  }, { repeat: [2, 2] });
}
function cloudTex() {
  return canvasTex('cloud', 256, 256, (x) => {
    x.clearRect(0, 0, 256, 256);
    for (let i = 0; i < 26; i++) {
      const px = 128 + (rnd() - 0.5) * 120, py = 140 + (rnd() - 0.5) * 50, r = 30 + rnd() * 50;
      const g = x.createRadialGradient(px, py - r * 0.2, r * 0.1, px, py, r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.6, 'rgba(240,244,250,0.3)');
      g.addColorStop(1, 'rgba(225,232,242,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
    }
  });
}

// ---------------- sky ----------------
export function makeSky() {
  const uniforms = {
    top: { value: new THREE.Color(0x3b78c9) },
    horizon: { value: new THREE.Color(0xc9dfea) },
    sunDir: { value: new THREE.Vector3(0.45, 0.5, 0.3).normalize() },
    sunColor: { value: new THREE.Color(0xfff0d0) },
    uTime: shared.time,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float uTime; varying vec3 vDir;
      ${NOISE_GLSL}
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        // Rayleigh-ish gradient: deep zenith, pale hazy horizon, darker below the horizon (sea haze).
        vec3 c = mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.45));
        c = mix(c, horizon * 0.82, smoothstep(0.0, -0.25, h));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += sunColor * (pow(s, 1400.0) * 3.0 + pow(s, 60.0) * 0.35 + pow(s, 6.0) * 0.12);
        // Warm the horizon toward the sun.
        c += vec3(0.25, 0.14, 0.04) * pow(s, 3.0) * (1.0 - clamp(h * 3.0, 0.0, 1.0)) * 0.6;
        // Thin, slowly drifting high cloud streaks, lit warmer near the sun.
        if (h > 0.015) {
          vec2 p = d.xz / (h + 0.15);
          float n = hc_fbm(p * vec2(0.9, 2.6) + vec2(uTime * 0.006, 0.0)) * 0.7 + hc_fbm(p * 3.1 - vec2(0.0, uTime * 0.004)) * 0.3;
          float cir = smoothstep(0.52, 0.82, n) * smoothstep(0.015, 0.18, h) * (1.0 - smoothstep(0.55, 0.95, h)) * 0.42;
          c = mix(c, mix(vec3(0.97, 0.98, 1.0), vec3(1.0, 0.9, 0.76), pow(s, 4.0)), cir);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1300, 48, 24), mat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return { mesh: sky, uniforms };
}

/** Image-based lighting: a pre-filtered environment rendered from the sky, so PBR materials pick up
 *  realistic ambient light and reflections. Call update() when the sky colours change. */
export function makeEnvironment(renderer, sky) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const skyCopy = new THREE.Mesh(sky.mesh.geometry, sky.mesh.material);
  envScene.add(skyCopy);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 24), new THREE.MeshBasicMaterial({ color: 0x55603f }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -60;
  envScene.add(ground);
  let rt = null;
  return {
    update() {
      const next = pmrem.fromScene(envScene, 0.02);
      if (rt) rt.dispose();
      rt = next;
      return rt.texture;
    },
  };
}

// GLSL noise shared by the terrain and water shaders.
const NOISE_GLSL = `
float hc_hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float hc_noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hc_hash(i), hc_hash(i + vec2(1,0)), u.x), mix(hc_hash(i + vec2(0,1)), hc_hash(i + vec2(1,1)), u.x), u.y); }
float hc_fbm(vec2 p){ return hc_noise(p) * 0.5 + hc_noise(p * 2.03 + 7.1) * 0.3 + hc_noise(p * 4.1 + 3.7) * 0.2; }
float hc_hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hc_noise3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hc_hash3(i), hc_hash3(i + vec3(1,0,0)), f.x), mix(hc_hash3(i + vec3(0,1,0)), hc_hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hc_hash3(i + vec3(0,0,1)), hc_hash3(i + vec3(1,0,1)), f.x), mix(hc_hash3(i + vec3(0,1,1)), hc_hash3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float hc_bump(vec3 p){ return hc_noise3(p * 1.4) * 0.55 + hc_noise3(p * 4.2) * 0.3 + hc_noise3(p * 11.0) * 0.15; }
`;

// ---------------- water ----------------
function waterShader(sh, { shore }) {
  sh.uniforms.uTime = shared.time;
  sh.vertexShader = 'uniform float uTime;\n' + (shore ? 'attribute float depth;\nvarying float vDepth;\n' : '') + 'varying vec2 vW;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    vW = (modelMatrix * vec4(transformed, 1.0)).xz;
    ${shore ? 'vDepth = depth; float amp = smoothstep(0.0, 4.0, depth);' : 'float amp = 1.0;'}
    transformed.y += amp * (sin(vW.x * 0.07 + uTime * 1.0) * 0.18 + cos(vW.y * 0.06 + uTime * 0.8) * 0.15 + sin((vW.x + vW.y) * 0.15 + uTime * 1.7) * 0.06);`);
  sh.fragmentShader = 'uniform float uTime;\n' + (shore ? 'varying float vDepth;\n' : '') + 'varying vec2 vW;\n' + NOISE_GLSL + sh.fragmentShader
    .replace('#include <color_fragment>', `#include <color_fragment>
      float d = ${shore ? 'vDepth' : '20.0'};
      vec3 shallow = vec3(0.32, 0.70, 0.62);
      vec3 mid = vec3(0.07, 0.42, 0.52);
      vec3 deep = vec3(0.02, 0.17, 0.30);
      vec3 wc = mix(shallow, mid, smoothstep(0.0, 3.5, d));
      wc = mix(wc, deep, smoothstep(3.5, 18.0, d));
      float n = hc_fbm(vW * 0.3 + vec2(uTime * 0.22, uTime * 0.15));
      float foam = smoothstep(0.55, 0.0, d + (n - 0.5) * 0.6) * (0.65 + 0.35 * hc_noise(vW * 2.5 - uTime * 0.5));
      ${shore ? `// Lines of surf rolling in toward the beach, breaking up as they go.
      float surf = smoothstep(0.86, 1.0, sin(d * 2.3 + uTime * 1.5 + n * 3.0)) * smoothstep(2.8, 0.5, d) * smoothstep(-0.1, 0.35, d);
      foam = max(foam, surf * (0.45 + 0.55 * hc_noise(vW * 1.7 + uTime * 0.3)));` : ''}
      diffuseColor.rgb = mix(wc, vec3(0.95, 0.97, 0.97), clamp(foam, 0.0, 1.0));
      diffuseColor.a = mix(0.55, 0.96, smoothstep(0.1, 5.0, d)) + foam * 0.35;`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      // Moving ripples: perturb the normal with the gradient of animated noise.
      vec2 q = vW * 0.55;
      float e = 0.08;
      float r0 = hc_fbm(q + uTime * vec2(0.18, 0.11)) + hc_noise(q * 3.0 - uTime * 0.6) * 0.35;
      float rx = hc_fbm(q + vec2(e, 0.0) + uTime * vec2(0.18, 0.11)) + hc_noise((q + vec2(e, 0.0)) * 3.0 - uTime * 0.6) * 0.35;
      float rz = hc_fbm(q + vec2(0.0, e) + uTime * vec2(0.18, 0.11)) + hc_noise((q + vec2(0.0, e)) * 3.0 - uTime * 0.6) * 0.35;
      vec3 rg = vec3(rx - r0, 0.0, rz - r0) / e;
      normal = normalize(normal - (viewMatrix * vec4(rg * 0.12, 0.0)).xyz);`);
}

export function makeWater(q) {
  const geo = new THREE.PlaneGeometry(3600, 3600, q.standard ? 120 : 70, q.standard ? 120 : 70);
  geo.rotateX(-Math.PI / 2);
  const mat = q.standard ? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.07, metalness: 0.02 }) : new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (sh) => waterShader(sh, { shore: false });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = -1.3;
  return m;
}

/** Water over the island area: clear shallows, deep blue offshore, foam at the shoreline.
 *  Depth comes from the terrain heightfield, baked per vertex. */
export function makeShoreWater(T, q) {
  const size = HALF * 2 + 120, seg = q.standard ? 260 : 180;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) depth[i] = Math.min(30, Math.max(-2, -T.height(pos.getX(i), pos.getZ(i))));
  geo.setAttribute('depth', new THREE.BufferAttribute(depth, 1));
  const mat = q.standard ? new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, roughness: 0.06, metalness: 0.02 }) : new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true });
  mat.onBeforeCompile = (sh) => waterShader(sh, { shore: true });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 0.02;
  m.receiveShadow = !!q.shadows;
  return m;
}

/** Gentle wind sway for instanced plants. k scales with height above the plant's base. */
export function sway(mat, k) {
  const prev = mat.onBeforeCompile;
  // Each sway strength is baked into the shader text, so give each its own program cache key.
  mat.customProgramCacheKey = () => `sway:${k.toFixed(4)}:${mat.userData.unpremul ? 1 : 0}`;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.uniforms.uTime = shared.time;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 ip = instanceMatrix[3].xz;
      #else
        vec2 ip = vec2(0.0);
      #endif
      float hh = max(transformed.y, 0.0);
      float ph = uTime * 1.7 + ip.x * 0.31 + ip.y * 0.23;
      float gust = 0.75 + 0.25 * sin(uTime * 0.4 + ip.x * 0.01);
      transformed.x += sin(ph) * ${k.toFixed(4)} * hh * hh * gust;
      transformed.z += cos(ph * 0.83) * ${(k * 0.7).toFixed(4)} * hh * hh * gust;`);
  };
  return mat;
}

// ---------------- terrain material ----------------
export function terrainMaterial(q) {
  USE_STD = !!q.standard;
  const opts = { vertexColors: true, flatShading: false };
  const mat = q.standard ? new THREE.MeshStandardMaterial({ ...opts, roughness: 0.93, metalness: 0 }) : new THREE.MeshLambertMaterial(opts);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time;
    sh.vertexShader = 'attribute float glow;\nvarying float vGlow;\nvarying vec3 vWP;\nvarying vec3 vWN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;\nvWP = transformed;\nvWN = normal;');
    let frag = 'uniform float uTime;\nvarying float vGlow;\nvarying vec3 vWP;\nvarying vec3 vWN;\n' + NOISE_GLSL + sh.fragmentShader;
    frag = frag.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 Nw = normalize(vWN);
      float steep = 1.0 - smoothstep(0.58, 0.82, Nw.y);
      // Ground: grass clumps, soil patches and fine grain. Rock: strata, streaks and cracks.
      vec2 pg = vWP.xz;
      vec2 pr = abs(Nw.x) > abs(Nw.z) ? vWP.zy : vWP.xy;
      float clump = hc_fbm(pg * 0.35);
      float grain = hc_noise(pg * 3.5) * 0.6 + hc_noise(pg * 9.0) * 0.4;
      float g = 0.7 + clump * 0.32 + grain * 0.16;
      // Soft horizontal layering, vertical rain streaks and fine grit (no hard lines).
      float strata = sin(vWP.y * 1.9 + hc_fbm(pr * 0.18) * 3.0) * 0.5 + 0.5;
      float streak = hc_fbm(pr * vec2(2.2, 0.35));
      float r = 0.8 + strata * 0.08 + (streak - 0.5) * 0.22 + (hc_noise(pr * 6.0) - 0.5) * 0.1;
      diffuseColor.rgb *= mix(g, r, steep);
      // Moss and lichen creeping onto lower rock faces, dust settling on ledges.
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 1.05, 0.75), steep * smoothstep(0.55, 0.75, hc_fbm(pr * 0.5)) * 0.6 * (1.0 - smoothstep(120.0, 140.0, vWP.y)));`);
    if (q.detail) {
      frag = frag.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 Nw2 = normalize(vWN);
          float st = 1.0 - smoothstep(0.58, 0.82, Nw2.y);
          float e = 0.12;
          vec3 P = vWP * mix(1.0, 0.6, st);
          float h0 = hc_bump(P);
          vec3 grad = vec3(hc_bump(P + vec3(e, 0.0, 0.0)) - h0, hc_bump(P + vec3(0.0, e, 0.0)) - h0, hc_bump(P + vec3(0.0, 0.0, e)) - h0) / e;
          vec3 gt = grad - dot(grad, Nw2) * Nw2;
          float strength = mix(0.16, 0.3, st);
          normal = normalize(normal - (viewMatrix * vec4(gt * strength, 0.0)).xyz);
        }`);
    }
    frag = frag.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.32, 0.05) * vGlow * (0.9 + 0.35 * sin(uTime * 1.7 + vGlow * 6.0));');
    sh.fragmentShader = frag;
  };
  return mat;
}

// ---------------- lights ----------------
export function makeLights(scene, q) {
  USE_STD = !!q.standard;
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a5440, q.standard ? 0.45 : 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe8c4, q.standard ? 3.0 : 2.8);
  sun.position.set(90, 110, 60);
  scene.add(sun, sun.target);
  if (q.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    const c = sun.shadow.camera;
    c.left = -50; c.right = 50; c.top = 50; c.bottom = -50; c.near = 1; c.far = 420;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.5;
  }
  return { hemi, sun };
}

// ---------------- clouds: soft billboard puffs ----------------
export function makeClouds(q, rng) {
  const group = new THREE.Group();
  const tex = cloudTex();
  for (let i = 0; i < q.clouds; i++) {
    const a = rng() * Math.PI * 2;
    const r = 220 + rng() * 520;
    const cy = i % 3 === 0 ? 150 + rng() * 40 : 90 + rng() * 240;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const puffs = 4 + Math.floor(rng() * 4);
    const size = 40 + rng() * 50;
    for (let k = 0; k < puffs; k++) {
      const m = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color().setScalar(0.92 + rng() * 0.08), transparent: true, depthWrite: false, opacity: 0.85 });
      const s = new THREE.Sprite(m);
      s.position.set(cx + (rng() - 0.5) * size, cy + (rng() - 0.4) * size * 0.25, cz + (rng() - 0.5) * size * 0.6);
      s.scale.set(size * (0.7 + rng() * 0.6), size * (0.45 + rng() * 0.3), 1);
      group.add(s);
    }
  }
  return group;
}

// ---------------- vegetation geometry ----------------
/** Make a card mesh's normals point away from a centre, so a clump of leaf cards shades like a volume. */
function sphericalNormals(geo, cx, cy, cz, sy = 1) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i) - cx, (p.getY(i) - cy) / sy, p.getZ(i) - cz).normalize();
    v.y = v.y * 0.7 + 0.3;
    v.normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  n.needsUpdate = true;
  return geo;
}
function cardCluster(count, center, radius, size, rng, flatten = 1) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const g = new THREE.PlaneGeometry(size * (0.8 + rng() * 0.4), size * (0.8 + rng() * 0.4));
    g.rotateX(rng() * Math.PI);
    g.rotateY(rng() * Math.PI);
    g.rotateZ((rng() - 0.5) * 0.8);
    const r = Math.cbrt(rng()) * radius, a = rng() * Math.PI * 2, b = Math.acos(rng() * 2 - 1);
    g.translate(center.x + Math.sin(b) * Math.cos(a) * r, center.y + Math.cos(b) * r * flatten, center.z + Math.sin(b) * Math.sin(a) * r);
    parts.push(g);
  }
  return sphericalNormals(mergeGeometries(parts), center.x, center.y, center.z, flatten);
}
function crossedCards(w, h, n = 3) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const g = new THREE.PlaneGeometry(w, h);
    g.translate(0, h / 2, 0);
    g.rotateY((i / n) * Math.PI);
    parts.push(g);
  }
  const geo = mergeGeometries(parts);
  // Upward-leaning normals so blades light like the ground they grow from.
  const nrm = geo.attributes.normal;
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, nrm.getX(i) * 0.3, 0.95, nrm.getZ(i) * 0.3);
  return geo;
}
function trunkGeometry(height, r0, r1, bend = 0, segs = 6) {
  const parts = [];
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const seg = new THREE.CylinderGeometry(r0 + (r1 - r0) * t1, r0 + (r1 - r0) * t0, height / segs, 8, 1, true);
    seg.translate(Math.pow(t0 + 0.5 / segs, 2) * bend, height * (t0 + 0.5 / segs), 0);
    parts.push(seg);
  }
  return mergeGeometries(parts);
}
function broadleafTree(rng) {
  const trunk = trunkGeometry(4.6, 0.32, 0.14, 0.4, 5);
  const branches = [];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.CylinderGeometry(0.05, 0.1, 1.8, 6, 1, true);
    b.rotateZ(0.9 + rng() * 0.3);
    b.translate(0.7, 0, 0);
    b.rotateY(i * 1.6 + rng());
    b.translate(0.3, 3.2 + rng() * 0.8, 0);
    branches.push(b);
  }
  const wood = mergeGeometries([trunk, ...branches]);
  const crown = cardCluster(22, new THREE.Vector3(0.3, 5.2, 0), 1.9, 2.2, rng, 0.75);
  return { wood, crown };
}
function palmGeometry() {
  const trunk = trunkGeometry(5.2, 0.2, 0.13, 1.0, 8);
  const fronds = [];
  for (let i = 0; i < 9; i++) {
    const g = new THREE.PlaneGeometry(0.75, 3.4, 1, 10);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k) + 1.7; // 0..3.4 along the frond
      p.setXYZ(k, p.getX(k) * (0.4 + 0.6 * Math.sin((y / 3.4) * Math.PI)), -0.18 * y * y, y);
    }
    g.computeVertexNormals();
    g.rotateX(-0.35);
    g.rotateY((i / 9) * Math.PI * 2 + (i % 2) * 0.2);
    g.translate(1.0, 5.25, 0);
    fronds.push(g);
  }
  const top = sphericalNormals(mergeGeometries(fronds), 1.0, 4.8, 0, 0.6);
  return { trunk, top };
}
function pineGeometry(rng) {
  const trunk = trunkGeometry(5.5, 0.22, 0.06, 0, 4);
  const parts = [];
  for (let tier = 0; tier < 6; tier++) {
    const y = 1.3 + tier * 0.75;
    const len = 2.1 - tier * 0.3;
    for (let k = 0; k < 6; k++) {
      const g = new THREE.PlaneGeometry(len, 1.1);
      g.translate(len / 2, 0, 0);
      g.rotateX(Math.PI / 2 + (rng() - 0.5) * 0.3);
      g.rotateZ(-0.35);
      g.rotateY((k / 6) * Math.PI * 2 + tier * 0.5);
      g.translate(0, y, 0);
      parts.push(g);
    }
  }
  const top = mergeGeometries(parts);
  const p = top.attributes.position, n = top.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.set(p.getX(i), 0.6, p.getZ(i)).normalize(); n.setXYZ(i, v.x, v.y, v.z); }
  return { trunk, top };
}
function deadTreeGeometry() {
  const parts = [trunkGeometry(3.4, 0.22, 0.08, 0.3, 4)];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.CylinderGeometry(0.03, 0.07, 1.4, 5, 1, true);
    b.rotateZ(0.9);
    b.translate(0.5, 0, 0);
    b.rotateY(i * 1.7);
    b.translate(0, 1.8 + i * 0.4, 0);
    parts.push(b);
  }
  return mergeGeometries(parts);
}
function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(0.8, 3);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const n = Math.sin(v.x * 3.1 + seed) * Math.cos(v.z * 2.7 + seed * 1.3) * 0.12 + Math.sin(v.y * 6 + v.x * 5 + seed) * 0.05;
    v.multiplyScalar(1 + n);
    v.y = v.y < 0 ? v.y * 0.35 : v.y * 0.75;
    v.x *= 1.25;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function instanced(root, geo, mat, list, place, shadows) {
  if (!list.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  const d = new THREE.Object3D();
  list.forEach((p, i) => { place(d, p); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
  im.castShadow = !!shadows;
  im.receiveShadow = !!shadows;
  root.add(im);
  return im;
}

// Canvas cut-outs store black in their transparent pixels; mipmaps blend that black into every blade and leaf edge,
// which turns distant grass and tree crowns almost black. Dividing by the filtered alpha restores the true colour.
const foliage = (map, tint = 0xffffff, extra = {}) => {
  const m = pbr(tint, { map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, ...extra });
  m.userData.unpremul = true;
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      #ifdef USE_MAP
        diffuseColor.rgb /= max(sampledDiffuseColor.a, 0.08);
      #endif`)
      // Double-sided cards normally flip the normal on their back face, which points it at the ground and
      // turns half the blades and leaves nearly black. Keep the (upward-leaning) normal on both faces.
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      #ifndef FLAT_SHADED
        normal = normalize(vNormal);
        nonPerturbedNormal = normal;
      #endif`);
  };
  m.customProgramCacheKey = () => 'foliage';
  return m;
};
const barkMat = (key, base) => pbr(0xffffff, { map: barkTex(key, base), roughness: 0.95 });

/** Scatter vegetation and props over the island. Returns tree colliders. */
export function dressMountain(root, T, rng, q, avoid) {
  USE_STD = !!q.standard;
  const trees = [];
  const ok = (p, r) => avoid.every((a) => a.p.distanceTo(p) > a.r + r);
  const scatter = (count, y0, y1, minNy, r = 3) => {
    const out = [];
    const n = Math.round(count * q.decor);
    for (let i = 0; i < n; i++) {
      const p = T.flatSpot(rng, y0, y1, minNy, 40);
      if (p && ok(p, r)) { p.userData = { s: 0.75 + rng() * 0.6, r: rng() * 6.28 }; out.push(p); }
    }
    return out;
  };
  const place = (yOff = 0) => (d, p) => {
    const s = p.userData.s;
    d.position.set(p.x, p.y + yOff, p.z);
    d.scale.setScalar(s);
    d.rotation.set(0, p.userData.r, 0);
  };
  const sh = q.shadows;
  const patch = (p) => Math.sin(p.x * 0.021) + Math.sin(p.z * 0.024 + 1.3) + Math.sin((p.x + p.z) * 0.013) > -0.4;

  // Palms along the beach and scattered inland.
  const palm = palmGeometry();
  const palms = [...scatter(130, 1.7, 5, 0.88), ...scatter(70, 5, 30, 0.9)];
  instanced(root, palm.trunk, barkMat('barkPalm', '#8a6a48'), palms, place(), sh);
  instanced(root, palm.top, sway(foliage(frondTex()), 0.006), palms, place(), sh);

  // Broadleaf woods in the lowlands and dense jungle on the lower mountain.
  const bl = broadleafTree(rng);
  const bl2 = broadleafTree(rng);
  const woods = scatter(620, 4, 34, 0.9).filter(patch);
  const jungle = scatter(360, 37, 124, 0.88);
  const allBroad = [...woods, ...jungle];
  const wood = barkMat('bark', '#5e4632');
  instanced(root, bl.wood, wood, allBroad.filter((_, i) => i % 2 === 0), place(), sh);
  instanced(root, bl2.wood, wood, allBroad.filter((_, i) => i % 2 === 1), place(), sh);
  const leafA = sway(foliage(leafTex('leafA', 105, 45, 30)), 0.004);
  const leafB = sway(foliage(leafTex('leafB', 92, 50, 36)), 0.004);
  const leafC = sway(foliage(leafTex('leafC', 120, 40, 24)), 0.004);
  instanced(root, bl.crown, leafA, woods.filter((_, i) => i % 2 === 0), place(), sh);
  instanced(root, bl2.crown, leafB, woods.filter((_, i) => i % 2 === 1), place(), sh);
  instanced(root, bl.crown, leafC, jungle.filter((_, i) => i % 2 === 0), place(), sh);
  instanced(root, bl2.crown, leafA, jungle.filter((_, i) => i % 2 === 1), place(), sh);

  // Bushes, flowers and grass.
  const bushGeo = cardCluster(9, new THREE.Vector3(0, 0.55, 0), 0.6, 1.0, rng, 0.7);
  const bushes = [...scatter(420, 37, 124, 0.85, 1), ...scatter(460, 3, 34, 0.88, 1)];
  instanced(root, bushGeo, sway(foliage(leafTex('leafBush', 100, 42, 28)), 0.08), bushes, place(), sh);
  const flowers = scatter(620, 3, 124, 0.9, 1);
  const flowerGeo = crossedCards(0.6, 0.45, 2);
  instanced(root, flowerGeo, sway(foliage(flowerTex('flPink', 330)), 0.25), flowers.filter((_, i) => i % 3 === 0), place(), false);
  instanced(root, flowerGeo, sway(foliage(flowerTex('flYel', 48)), 0.25), flowers.filter((_, i) => i % 3 === 1), place(), false);
  instanced(root, flowerGeo, sway(foliage(flowerTex('flWht', 220)), 0.25), flowers.filter((_, i) => i % 3 === 2), place(), false);
  const grass = scatter(4200, 2.2, 124, 0.88, 0.5);
  const grassGeo = crossedCards(0.9, 0.55, 3);
  instanced(root, grassGeo, sway(foliage(grassTex('grassG', 100, 32)), 0.3), grass.filter((p) => p.y > 3), place(), false);
  instanced(root, grassGeo, sway(foliage(grassTex('grassD', 62, 48)), 0.3), grass.filter((p) => p.y <= 3), place(), false);

  // Conifers higher up, some dusted with snow.
  const pine = pineGeometry(rng);
  const pines = scatter(260, 127, 212, 0.88);
  instanced(root, pine.trunk, barkMat('barkPine', '#4a3526'), pines, place(), sh);
  instanced(root, pine.top, sway(foliage(needleTex('needle', false)), 0.003), pines.filter((_, i) => i % 3 === 0), place(), sh);
  instanced(root, pine.top, sway(foliage(needleTex('needleSnow', true)), 0.003), pines.filter((_, i) => i % 3 !== 0), place(), sh);
  const crystals = scatter(160, 127, 214, 0.85, 1);
  const crystalGeo = new THREE.OctahedronGeometry(0.5, 0);
  crystalGeo.scale(0.6, 1.6, 0.6);
  crystalGeo.translate(0, 0.6, 0);
  instanced(root, crystalGeo, pbr(0xbfe8ff, { roughness: 0.08, transparent: true, opacity: 0.75, emissive: 0x204a66, emissiveIntensity: 0.4 }), crystals, place(), false);

  const dead = scatter(90, 218, 300, 0.85);
  instanced(root, deadTreeGeometry(), barkMat('barkDead', '#2c2420'), dead, place(), sh);

  // Boulders.
  const rocks = scatter(380, 2, 280, 0.75, 1);
  const rockMat = pbr(0x9a9284, { map: rockTex(), roughness: 0.92 });
  const darkRock = pbr(0x4a403c, { map: rockTex(), roughness: 0.9 });
  const rg = [rockGeometry(1), rockGeometry(2.7), rockGeometry(5.3)];
  rg.forEach((g, k) => {
    instanced(root, g, rockMat, rocks.filter((p, i) => p.y < 216 && i % 3 === k), place(0.05), sh);
    instanced(root, g, darkRock, rocks.filter((p, i) => p.y >= 216 && i % 3 === k), place(0.05), sh);
  });

  for (const p of [...palms, ...woods, ...jungle, ...pines, ...dead]) trees.push({ x: p.x, z: p.z, y: p.y, r: 0.35 * p.userData.s });

  // Vines hanging down jungle cliff faces.
  const vines = [];
  const n = new THREE.Vector3();
  for (let i = 0; i < 900 * q.decor && vines.length < 260 * q.decor; i++) {
    const a = rng() * Math.PI * 2, d = rng() * R;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const y = T.height(x, z);
    if (y < 42 || y > 124) continue;
    T.normal(x, z, n);
    if (n.y > 0.5) continue;
    vines.push({ x: x + n.x * 0.25, y, z: z + n.z * 0.25, len: 3 + rng() * 6, r: Math.atan2(n.x, n.z) });
  }
  const vineGeo = new THREE.PlaneGeometry(0.8, 1);
  vineGeo.translate(0, -0.5, 0);
  instanced(root, vineGeo, foliage(leafTex('vine', 110, 45, 26)), vines, (d, v) => { d.position.set(v.x, v.y, v.z); d.scale.set(1, v.len, 1); d.rotation.set(0, v.r, 0); }, false);

  return trees;
}

// ---------------- smoke ----------------
export class Smoke {
  constructor(root, origin, opts = {}) {
    this.n = opts.count ?? 24;
    this.origin = origin.clone();
    this.rise = opts.rise ?? 2.2;
    this.life = opts.life ?? 6;
    this.size = opts.size ?? 2.4;
    this.spread = opts.spread ?? 0.5;
    const tex = smokeTexture();
    this.sprites = [];
    for (let i = 0; i < this.n; i++) {
      const m = new THREE.SpriteMaterial({ map: tex, color: opts.color ?? 0x55504c, transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(m);
      s.userData.t = (i / this.n) * this.life;
      s.userData.dx = (Math.random() - 0.5) * this.spread;
      s.userData.dz = (Math.random() - 0.5) * this.spread;
      root.add(s);
      this.sprites.push(s);
    }
  }
  update(dt, wind = 0.6) {
    for (const s of this.sprites) {
      const u = s.userData;
      u.t = (u.t + dt) % this.life;
      const k = u.t / this.life;
      s.position.set(this.origin.x + u.dx * (1 + k * 6) + wind * k * 6, this.origin.y + k * this.rise * this.life, this.origin.z + u.dz * (1 + k * 6));
      s.scale.setScalar(this.size * (0.4 + k * 1.6));
      s.material.opacity = Math.sin(k * Math.PI) * 0.55;
    }
  }
}
let _smokeTex = null;
function smokeTexture() {
  if (_smokeTex) return _smokeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  _smokeTex = new THREE.CanvasTexture(c);
  return _smokeTex;
}
export function glowSprite(color, size) {
  const m = new THREE.SpriteMaterial({ map: smokeTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  return s;
}

export function bandSkyColors(y) {
  let a = BANDS[0], b = BANDS[0], k = 0;
  for (let i = 1; i < BANDS.length; i++) {
    if (y > BANDS[i].y0 - 15) { a = BANDS[i - 1]; b = BANDS[i]; k = Math.min(1, Math.max(0, (y - (BANDS[i].y0 - 15)) / 30)); }
  }
  return {
    fog: new THREE.Color(a.fog).lerp(new THREE.Color(b.fog), k),
    sky: new THREE.Color(a.sky).lerp(new THREE.Color(b.sky), k),
  };
}


// ---------------- lowland landmarks ----------------
function signTex(lines) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#c8955a'; x.fillRect(0, 0, 256, 64);
  x.strokeStyle = '#7a5532'; x.lineWidth = 6; x.strokeRect(3, 3, 250, 58);
  x.fillStyle = '#2a1a08'; x.font = '900 30px ui-rounded, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(lines, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Lighthouse, ruins and a signpost in the lowlands. Returns colliders and things to animate. */
export function buildLandmarks(root, T, rng, q, spawn, summit) {
  const colliders = [];
  const anim = {};
  const n = new THREE.Vector3();
  const flatAt = (x, z, r = 2.5) => {
    const y = T.height(x, z);
    for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) if (Math.abs(T.height(x + ox, z + oz) - y) > 1.2) return false;
    return T.normal(x, z, n).y > 0.88;
  };

  // Lighthouse on a coastal rise a little way along from the crash site.
  const sa = Math.atan2(spawn.z, spawn.x) - 0.55;
  let lh = null;
  for (let d = COAST + 60; d > R + 40 && !lh; d -= 1) {
    const x = Math.cos(sa) * d, z = Math.sin(sa) * d;
    if (T.height(x, z) > 2.2 && flatAt(x, z)) lh = new THREE.Vector3(x, T.height(x, z), z);
  }
  if (lh) {
    const g = new THREE.Group();
    g.position.copy(lh);
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(2.0 - (i + 1) * 0.08, 2.0 - i * 0.08, 2.4, 16), lam(i % 2 ? 0xe94e3c : 0xfaf6ee));
      seg.position.y = 1.2 + i * 2.4;
      g.add(seg);
    }
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.3, 16), lam(0x2a3140));
    gallery.position.y = 14.6;
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 1.8, 12), new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xffd23f, emissiveIntensity: 0.9 }));
    lamp.position.y = 15.7;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.6, 12), lam(0xe94e3c));
    roof.position.y = 17.4;
    const glow = glowSprite(0xffe08a, 9);
    glow.position.y = 15.8;
    const beam = new THREE.Mesh(new THREE.ConeGeometry(3.5, 60, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
    beam.geometry.translate(0, -30, 0);
    beam.rotation.z = Math.PI / 2;
    const beamPivot = new THREE.Group();
    beamPivot.position.y = 15.8;
    beamPivot.add(beam);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.3, 0.8, 16), lam(0x9a9286));
    base.position.y = 0.2;
    g.add(gallery, lamp, roof, glow, beamPivot, base);
    g.traverse((o) => { if (o.isMesh && o !== beam) { o.castShadow = !!q.shadows; o.receiveShadow = !!q.shadows; } });
    root.add(g);
    colliders.push({ x: lh.x, z: lh.z, y: lh.y, r: 2.6 });
    anim.beam = beamPivot;
    anim.lighthouse = lh;
  }

  // Two old ruins: a ring of broken pillars and a stone arch.
  const stone = lam(0xb9ad98);
  const mossy = lam(0x8ea07a);
  const ruins = [];
  for (let t = 0; t < 600 && ruins.length < 2; t++) {
    const a = rng() * Math.PI * 2, d = R + 30 + rng() * (COAST - R - 80);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const y = T.height(x, z);
    if (y < 3 || y > 30 || !flatAt(x, z, 6) || Math.hypot(x - spawn.x, z - spawn.z) < 40 || ruins.some((r) => r.distanceTo(new THREE.Vector3(x, y, z)) < 80)) continue;
    ruins.push(new THREE.Vector3(x, y, z));
  }
  for (const c of ruins) {
    const g = new THREE.Group();
    g.position.copy(c);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = 1 + rng() * 3.5;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, h, 8), i % 3 ? stone : mossy);
      p.position.set(Math.cos(a) * 6, h / 2, Math.sin(a) * 6);
      g.add(p);
      colliders.push({ x: c.x + Math.cos(a) * 6, z: c.z + Math.sin(a) * 6, y: c.y, r: 0.6 });
    }
    for (const sx of [-1.6, 1.6]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 4.2, 0.9), stone);
      p.position.set(sx, 2.1, 0);
      g.add(p);
      colliders.push({ x: c.x + sx, z: c.z, y: c.y, r: 0.6 });
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.8, 1.1), mossy);
    lintel.position.y = 4.5;
    g.add(lintel);
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.8 + rng(), 0.5, 0.6 + rng() * 0.5), stone);
      b.position.set((rng() - 0.5) * 10, 0.2, (rng() - 0.5) * 10);
      b.rotation.set(rng() * 0.4, rng() * 6, rng() * 0.4);
      g.add(b);
    }
    g.rotation.y = rng() * 6;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = !!q.shadows; o.receiveShadow = !!q.shadows; } });
    root.add(g);
  }

  // A signpost just inland from the crash, pointing at the summit and the lighthouse.
  const toSummit = new THREE.Vector3(summit.x - spawn.x, 0, summit.z - spawn.z).normalize();
  const sp = spawn.clone().addScaledVector(toSummit, 7).add(new THREE.Vector3(-toSummit.z * 3, 0, toSummit.x * 3));
  sp.y = T.height(sp.x, sp.z);
  const sg = new THREE.Group();
  sg.position.copy(sp);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.6, 6), lam(0x7a5532));
  post.position.y = 1.3;
  sg.add(post);
  const board = (text, dir, y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45), new THREE.MeshLambertMaterial({ map: signTex(text), side: THREE.DoubleSide }));
    m.position.y = y;
    m.rotation.y = Math.atan2(dir.x, dir.z) - Math.PI / 2;
    m.translateX(0.8);
    sg.add(m);
  };
  board('SUMMIT ▶', toSummit, 2.2);
  if (anim.lighthouse) board('LIGHTHOUSE ▶', new THREE.Vector3(anim.lighthouse.x - sp.x, 0, anim.lighthouse.z - sp.z).normalize(), 1.7);
  root.add(sg);
  colliders.push({ x: sp.x, z: sp.z, y: sp.y, r: 0.3 });
  return { colliders, anim };
}

// ---------------- seagulls ----------------
export class Gulls {
  constructor(root, center, count = 10) {
    this.birds = [];
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const grey = new THREE.MeshLambertMaterial({ color: 0x9aa3ad, side: THREE.DoubleSide });
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.25, 0, 0, -0.2, 1.1, 0, -0.05], 3));
    wingGeo.computeVertexNormals();
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.45, 3, 6), white);
      body.rotation.x = Math.PI / 2;
      const wl = new THREE.Mesh(wingGeo, grey);
      const wr = new THREE.Mesh(wingGeo, grey);
      wr.scale.x = -1;
      g.add(body, wl, wr);
      root.add(g);
      this.birds.push({ g, wl, wr, r: 25 + Math.random() * 45, h: 14 + Math.random() * 22, sp: (0.25 + Math.random() * 0.25) * (Math.random() < 0.5 ? 1 : -1), ph: Math.random() * 6.28, c: center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 60, 0, (Math.random() - 0.5) * 60)) });
    }
  }
  update(t) {
    for (const b of this.birds) {
      const a = b.ph + t * b.sp;
      b.g.position.set(b.c.x + Math.cos(a) * b.r, b.c.y + b.h + Math.sin(t * 0.7 + b.ph) * 2, b.c.z + Math.sin(a) * b.r);
      b.g.rotation.set(0, -a + (b.sp > 0 ? 0 : Math.PI), Math.sin(t + b.ph) * 0.25);
      const flap = Math.sin(t * 9 + b.ph) * 0.6;
      b.wl.rotation.z = flap;
      b.wr.rotation.z = -flap;
    }
  }
}

// ---------------- dense grass around the player ----------------
/** A field of grass tufts on a grid around the player, rebuilt as you move (Medium/High only). */
export function makeGrassField(T, q) {
  if (!q.grass) return null;
  USE_STD = !!q.standard;
  const geo = crossedCards(0.75, 0.5, 3);
  const mat = sway(foliage(grassTex('grassField', 98, 34)), 0.35);
  const im = new THREE.InstancedMesh(geo, mat, q.grass);
  im.count = 0;
  im.frustumCulled = false;
  im.receiveShadow = !!q.shadows;
  const d = new THREE.Object3D();
  const col = new THREE.Color();
  const n = new THREE.Vector3();
  const step = 0.55;
  const half = Math.floor(Math.sqrt(q.grass) / 2);
  const hash = (i, j, k) => {
    let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  let cx = NaN, cz = NaN;
  return {
    mesh: im,
    update(px, pz) {
      const gx = Math.round(px / 6) * 6, gz = Math.round(pz / 6) * 6;
      if (gx === cx && gz === cz) return;
      cx = gx; cz = gz;
      const i0 = Math.round(gx / step), j0 = Math.round(gz / step);
      let k = 0;
      outer: for (let j = -half; j < half; j++) {
        for (let i = -half; i < half; i++) {
          const r2 = (i * i + j * j) / (half * half);
          if (r2 > 1) continue;
          const ii = i0 + i, jj = j0 + j;
          const x = ii * step + (hash(ii, jj, 1) - 0.5) * step, z = jj * step + (hash(ii, jj, 2) - 0.5) * step;
          const y = T.height(x, z);
          if (y < 2.6 || y > 124 || T.normal(x, z, n).y < 0.86) continue;
          const s = (0.55 + hash(ii, jj, 3) * 0.7) * (1 - r2 * 0.45);
          d.position.set(x, y, z);
          d.rotation.set(0, hash(ii, jj, 4) * 6.28, 0);
          d.scale.set(s, s * (0.8 + hash(ii, jj, 5) * 0.6), s);
          d.updateMatrix();
          im.setMatrixAt(k, d.matrix);
          // Gentle tint: brighter and greener in the jungle, sun-dried patches in the lowlands.
          const v = 0.88 + hash(ii, jj, 6) * 0.18;
          const dry = y < 36 ? hash(ii >> 4, jj >> 4, 7) * 0.45 : 0;
          col.setRGB(v * (0.94 + dry * 0.22), v, v * (0.9 - dry * 0.25));
          im.setColorAt(k, col);
          if (++k >= q.grass) break outer;
        }
      }
      im.count = k;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    },
  };
}
