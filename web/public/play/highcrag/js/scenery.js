// Highcrag — scenery: sky, sun, water, clouds, terrain material, vegetation and set dressing.
// Everything is procedural low-poly; nothing is loaded from files.
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
  low: { shadows: false, shadowSize: 0, decor: 0.45, pixelRatio: 1.25, standard: false, aa: false, clouds: 22 },
  medium: { shadows: true, shadowSize: 1024, decor: 0.75, pixelRatio: 1.5, standard: true, aa: false, clouds: 34 },
  high: { shadows: true, shadowSize: 2048, decor: 1, pixelRatio: 2, standard: true, aa: true, clouds: 46 },
};

// ---------------- sky ----------------
export function makeSky() {
  const uniforms = {
    top: { value: new THREE.Color(0x3d8fe0) },
    horizon: { value: new THREE.Color(0xbfe6f5) },
    sunDir: { value: new THREE.Vector3(0.45, 0.55, 0.3).normalize() },
    sunColor: { value: new THREE.Color(0xfff2c8) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 c = mix(horizon, top, pow(max(h, 0.0), 0.55));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        c += sunColor * (pow(s, 900.0) * 1.6 + pow(s, 12.0) * 0.22);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1300, 32, 16), mat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return { mesh: sky, uniforms };
}

// ---------------- water ----------------
export function makeWater(q) {
  const geo = new THREE.PlaneGeometry(3600, 3600, q.standard ? 160 : 90, q.standard ? 160 : 90);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x14709c, roughness: 0.2, metalness: 0.05, flatShading: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 wp = modelMatrix * vec4(transformed, 1.0);
      transformed.y += sin(wp.x * 0.06 + uTime * 1.1) * 0.35 + cos(wp.z * 0.05 + uTime * 0.8) * 0.3 + sin((wp.x + wp.z) * 0.13 + uTime * 1.9) * 0.12;`);
  };
  const m = new THREE.Mesh(geo, mat);
  m.position.y = -1.3;
  return m;
}

// GLSL value noise shared by the terrain and water shaders.
const NOISE_GLSL = `
float hc_hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float hc_noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hc_hash(i), hc_hash(i + vec2(1,0)), u.x), mix(hc_hash(i + vec2(0,1)), hc_hash(i + vec2(1,1)), u.x), u.y); }
`;

/** Water over the island area: turquoise in the shallows, deep blue further out, foam along the shore.
 *  Depth comes from the terrain heightfield, baked per vertex. */
export function makeShoreWater(T, q) {
  const size = HALF * 2 + 120, seg = q.standard ? 260 : 180;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) depth[i] = Math.min(30, Math.max(-2, -T.height(pos.getX(i), pos.getZ(i))));
  geo.setAttribute('depth', new THREE.BufferAttribute(depth, 1));
  const Mat = q.standard ? THREE.MeshStandardMaterial : THREE.MeshLambertMaterial;
  const mat = new Mat({ color: 0xffffff, transparent: true, ...(q.standard ? { roughness: 0.12, metalness: 0.04 } : {}) });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time;
    sh.vertexShader = 'uniform float uTime;\nattribute float depth;\nvarying float vDepth;\nvarying vec2 vW;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vDepth = depth;
      vW = transformed.xz;
      float amp = smoothstep(0.0, 4.0, depth);
      transformed.y += amp * (sin(transformed.x * 0.08 + uTime * 1.1) * 0.22 + cos(transformed.z * 0.07 + uTime * 0.9) * 0.18);`);
    sh.fragmentShader = 'uniform float uTime;\nvarying float vDepth;\nvarying vec2 vW;\n' + NOISE_GLSL + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float d = vDepth;
      vec3 shallow = vec3(0.30, 0.86, 0.80);
      vec3 mid = vec3(0.10, 0.62, 0.74);
      vec3 deep = vec3(0.05, 0.36, 0.56);
      vec3 wc = mix(shallow, mid, smoothstep(0.0, 3.0, d));
      wc = mix(wc, deep, smoothstep(3.0, 14.0, d));
      float n = hc_noise(vW * 0.35 + vec2(uTime * 0.25, uTime * 0.18)) * 0.6 + hc_noise(vW * 1.3 - uTime * 0.4) * 0.4;
      float foam = smoothstep(0.75, 0.0, d + (n - 0.5) * 0.7);
      float sparkle = smoothstep(0.82, 0.95, hc_noise(vW * 2.2 + uTime * 0.6)) * smoothstep(1.0, 6.0, d) * 0.25;
      diffuseColor.rgb = mix(wc, vec3(1.0), clamp(foam * 0.9 + sparkle, 0.0, 1.0));
      diffuseColor.a = mix(0.62, 0.95, smoothstep(0.2, 6.0, d)) + foam * 0.3;`);
  };
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 0.02;
  m.receiveShadow = !!q.shadows;
  return m;
}

/** Gentle wind sway for instanced plants. k scales with height above the plant's base. */
export function sway(mat, k) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 ip = instanceMatrix[3].xz;
      #else
        vec2 ip = vec2(0.0);
      #endif
      float hh = max(transformed.y, 0.0);
      float ph = uTime * 1.7 + ip.x * 0.31 + ip.y * 0.23;
      transformed.x += sin(ph) * ${k.toFixed(4)} * hh * hh;
      transformed.z += cos(ph * 0.83) * ${(k * 0.7).toFixed(4)} * hh * hh;`);
  };
  return mat;
}

// ---------------- terrain material (lava glow) ----------------
export function terrainMaterial(q) {
  const opts = { vertexColors: true, flatShading: false };
  const mat = q.standard ? new THREE.MeshStandardMaterial({ ...opts, roughness: 0.95, metalness: 0 }) : new THREE.MeshLambertMaterial(opts);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time;
    sh.vertexShader = 'attribute float glow;\nvarying float vGlow;\nvarying vec3 vWP;\nvarying vec3 vWN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;\nvWP = transformed;\nvWN = normal;');
    sh.fragmentShader = 'uniform float uTime;\nvarying float vGlow;\nvarying vec3 vWP;\nvarying vec3 vWN;\n' + NOISE_GLSL + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      // Surface detail: soft blotches up close, grain further in, rock streaks on steep faces.
      float steep = 1.0 - smoothstep(0.55, 0.85, vWN.y);
      vec2 tp = mix(vWP.xz, vec2(vWP.x + vWP.z, vWP.y * 2.2), steep);
      float dn = hc_noise(tp * 0.35) * 0.55 + hc_noise(tp * 1.7) * 0.3 + hc_noise(tp * 6.0) * 0.15;
      diffuseColor.rgb *= 0.84 + dn * 0.32;`).replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.32, 0.05) * vGlow * (0.9 + 0.35 * sin(uTime * 1.7 + vGlow * 6.0));',
    );
  };
  return mat;
}

// ---------------- lights ----------------
export function makeLights(scene, q) {
  const hemi = new THREE.HemisphereLight(0xd8ecff, 0x7a6a4a, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe6bf, 3.1);
  sun.position.set(90, 120, 60);
  scene.add(sun, sun.target);
  if (q.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    const c = sun.shadow.camera;
    c.left = -45; c.right = 45; c.top = 45; c.bottom = -45; c.near = 1; c.far = 400;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.6;
  }
  return { hemi, sun };
}

// ---------------- clouds ----------------
export function makeClouds(q, rng) {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    g.scale(1 + rng() * 0.8, 0.55 + rng() * 0.25, 1 + rng() * 0.6);
    g.translate((rng() - 0.5) * 2.6, (rng() - 0.3) * 0.5, (rng() - 0.5) * 1.6);
    parts.push(g);
  }
  const geo = mergeGeometries(parts);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8899aa, emissiveIntensity: 0.35, flatShading: true, transparent: true, opacity: 0.92 });
  const im = new THREE.InstancedMesh(geo, mat, q.clouds);
  const d = new THREE.Object3D();
  for (let i = 0; i < q.clouds; i++) {
    const a = rng() * Math.PI * 2;
    const r = 180 + rng() * 460;
    const ring = i % 3 === 0;
    d.position.set(Math.cos(a) * r, ring ? 150 + rng() * 40 : 60 + rng() * 260, Math.sin(a) * r);
    const s = 9 + rng() * 14;
    d.scale.set(s, s * (0.7 + rng() * 0.4), s);
    d.rotation.y = rng() * 6;
    d.updateMatrix();
    im.setMatrixAt(i, d.matrix);
  }
  im.frustumCulled = false;
  const group = new THREE.Group();
  group.add(im);
  return group;
}

// ---------------- vegetation & props (merged, instanced) ----------------
const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

function palmGeometry() {
  const parts = [];
  // Curved trunk from stacked, offset segments.
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.CylinderGeometry(0.17 - i * 0.012, 0.2 - i * 0.012, 0.85, 6);
    seg.translate(Math.pow(i / 5, 2) * 0.9, 0.42 + i * 0.8, 0);
    parts.push(seg);
  }
  return { trunk: mergeGeometries(parts), top: (() => {
    const fronds = [];
    for (let i = 0; i < 7; i++) {
      const f = new THREE.ConeGeometry(0.5, 3.2, 3);
      f.scale(1, 1, 0.25);
      f.rotateZ(-Math.PI / 2 + 0.45);
      f.translate(1.5, 0, 0);
      f.rotateY((i / 7) * Math.PI * 2);
      f.translate(0.9, 5.0, 0);
      fronds.push(f);
    }
    const nut = new THREE.IcosahedronGeometry(0.28, 0);
    nut.translate(0.9, 4.75, 0.2);
    fronds.push(nut);
    return mergeGeometries(fronds.map((g) => (g.index ? g.toNonIndexed() : g)));
  })() };
}

function jungleTreeGeometry(rng) {
  const trunk = new THREE.CylinderGeometry(0.22, 0.38, 4.2, 6);
  trunk.translate(0, 2.1, 0);
  const blobs = [];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.IcosahedronGeometry(1.3 + rng() * 0.6, 1);
    b.translate((rng() - 0.5) * 1.8, 4.4 + rng() * 1.3, (rng() - 0.5) * 1.8);
    blobs.push(b);
  }
  return { trunk, top: mergeGeometries(blobs) };
}

function pineGeometry() {
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 1.6, 6);
  trunk.translate(0, 0.8, 0);
  const tiers = [], snow = [];
  for (let i = 0; i < 3; i++) {
    const c = new THREE.ConeGeometry(1.6 - i * 0.42, 1.9, 7);
    c.translate(0, 1.9 + i * 1.15, 0);
    tiers.push(c);
    const s = new THREE.ConeGeometry(1.0 - i * 0.28, 0.7, 7);
    s.translate(0, 2.55 + i * 1.15, 0);
    snow.push(s);
  }
  return { trunk, top: mergeGeometries(tiers), snow: mergeGeometries(snow) };
}

function deadTreeGeometry() {
  const parts = [];
  const t = new THREE.CylinderGeometry(0.1, 0.25, 3.4, 5);
  t.translate(0, 1.7, 0);
  parts.push(t);
  for (let i = 0; i < 3; i++) {
    const b = new THREE.CylinderGeometry(0.04, 0.08, 1.4, 4);
    b.rotateZ(0.9);
    b.translate(0.5, 0, 0);
    b.rotateY(i * 2.1);
    b.translate(0, 2 + i * 0.5, 0);
    parts.push(b);
  }
  return mergeGeometries(parts);
}

function bushGeometry() {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const b = new THREE.IcosahedronGeometry(0.55 + i * 0.1, 0);
    b.translate((i - 1) * 0.45, 0.35, (i % 2) * 0.3);
    parts.push(b);
  }
  return mergeGeometries(parts);
}

function grassGeometry() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const b = new THREE.ConeGeometry(0.05, 0.55 + (i % 3) * 0.15, 3);
    b.translate(Math.cos(i * 1.3) * 0.18, 0.28, Math.sin(i * 1.3) * 0.18);
    parts.push(b);
  }
  return mergeGeometries(parts);
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

/** Scatter vegetation and props over the mountain. Returns tree colliders. */
export function dressMountain(root, T, rng, q, avoid) {
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
  const trunkMat = lam(0x8a5a34);

  const palm = palmGeometry();
  const jt = jungleTreeGeometry(rng);
  const patch = (p) => Math.sin(p.x * 0.021) + Math.sin(p.z * 0.024 + 1.3) + Math.sin((p.x + p.z) * 0.013) > -0.4;
  const palms = [...scatter(130, 1.7, 5, 0.88), ...scatter(70, 5, 30, 0.9)];
  instanced(root, palm.trunk, lam(0x9b6b3e), palms, place(), sh);
  instanced(root, palm.top, sway(lam(0x5cbf3f, { side: THREE.DoubleSide }), 0.006), palms, place(), sh);
  // Lowland woods: broadleaf trees in clumps, with bushes, ferns and flowers.
  const woods = scatter(620, 4, 34, 0.9).filter(patch);
  instanced(root, jt.trunk, trunkMat, woods, place(), sh);
  instanced(root, jt.top, sway(lam(0x4fa83a), 0.004), woods.filter((_, i) => i % 3 === 0), place(), sh);
  instanced(root, jt.top, sway(lam(0x67b845), 0.004), woods.filter((_, i) => i % 3 === 1), place(), sh);
  instanced(root, jt.top, sway(lam(0x8fbf3f), 0.004), woods.filter((_, i) => i % 3 === 2), place(), sh);

  const jungle = scatter(360, 37, 124, 0.88);
  instanced(root, jt.trunk, trunkMat, jungle, place(), sh);
  instanced(root, jt.top, sway(lam(0x3e8f2f), 0.004), jungle.filter((_, i) => i % 2 === 0), place(), sh);
  instanced(root, jt.top, sway(lam(0x56a83a), 0.004), jungle.filter((_, i) => i % 2 === 1), place(), sh);
  const bushes = [...scatter(420, 37, 124, 0.85, 1), ...scatter(460, 3, 34, 0.88, 1)];
  instanced(root, bushGeometry(), sway(lam(0x4b9a37), 0.08), bushes, place(), sh);
  const flowers = scatter(620, 3, 124, 0.9, 1);
  const flowerGeo = new THREE.IcosahedronGeometry(0.16, 0);
  flowerGeo.translate(0, 0.25, 0);
  instanced(root, flowerGeo, sway(lam(0xff6fa8, { emissive: 0x551133 }), 0.2), flowers.filter((_, i) => i % 3 === 0), place(), false);
  instanced(root, flowerGeo, sway(lam(0xffd23f, { emissive: 0x443300 }), 0.2), flowers.filter((_, i) => i % 3 === 1), place(), false);
  instanced(root, flowerGeo, sway(lam(0xffffff, { emissive: 0x333333 }), 0.2), flowers.filter((_, i) => i % 3 === 2), place(), false);
  const grass = scatter(3400, 2.2, 124, 0.88, 0.5);
  instanced(root, grassGeometry(), sway(lam(0x6cc24a), 0.25), grass.filter((p) => p.y > 36), place(), false);
  instanced(root, grassGeometry(), sway(lam(0x7fc24a), 0.25), grass.filter((p) => p.y <= 36 && p.y > 3), place(), false);
  instanced(root, grassGeometry(), sway(lam(0xc8c47a), 0.25), grass.filter((p) => p.y <= 3), place(), false);

  const pine = pineGeometry();
  const pines = scatter(240, 127, 210, 0.88);
  instanced(root, pine.trunk, trunkMat, pines, place(), sh);
  instanced(root, pine.top, lam(0x2c5e4a), pines, place(), sh);
  instanced(root, pine.snow, lam(0xf6fbff), pines, place(), sh);
  const crystals = scatter(160, 127, 214, 0.85, 1);
  const crystalGeo = new THREE.OctahedronGeometry(0.5, 0);
  crystalGeo.scale(0.6, 1.6, 0.6);
  crystalGeo.translate(0, 0.6, 0);
  instanced(root, crystalGeo, new THREE.MeshLambertMaterial({ color: 0xaee6ff, emissive: 0x3a7fa8, emissiveIntensity: 0.5, flatShading: true, transparent: true, opacity: 0.85 }), crystals, place(), false);

  const dead = scatter(90, 218, 300, 0.85);
  instanced(root, deadTreeGeometry(), lam(0x2e2422), dead, place(), sh);

  const rocks = scatter(320, 2, 280, 0.75, 1);
  const rockGeo = new THREE.DodecahedronGeometry(0.75, 1);
  rockGeo.scale(1, 0.7, 1);
  instanced(root, rockGeo, lam(0x8d8678), rocks.filter((p) => p.y < 216), place(0.15), sh);
  instanced(root, rockGeo, lam(0x3d3433), rocks.filter((p) => p.y >= 216), place(0.15), sh);

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
  const vineGeo = new THREE.CylinderGeometry(0.06, 0.04, 1, 4);
  vineGeo.translate(0, -0.5, 0);
  const leafGeo = new THREE.ConeGeometry(0.22, 0.5, 3);
  instanced(root, vineGeo, lam(0x3f8a2a), vines, (d, v) => { d.position.set(v.x, v.y, v.z); d.scale.set(1, v.len, 1); d.rotation.set(0, v.r, 0); }, false);
  const leaves = [];
  for (const v of vines) for (let k = 1; k < v.len; k += 1.1) leaves.push({ x: v.x + Math.sin(v.r) * 0.1, y: v.y - k, z: v.z + Math.cos(v.r) * 0.1, r: v.r + k });
  instanced(root, leafGeo, lam(0x58b23a), leaves, (d, v) => { d.position.set(v.x, v.y, v.z); d.scale.setScalar(1); d.rotation.set(0.6, v.r, 0.4); }, false);

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
