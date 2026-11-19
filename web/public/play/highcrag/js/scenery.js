// Highcrag — scenery: sky, sun, water, clouds, terrain material, vegetation and set dressing.
// Everything is procedural low-poly; nothing is loaded from files.
import * as THREE from '../../vendor/three.module.js';
import { mergeGeometries } from '../../vendor/addons/BufferGeometryUtils.js';
import { BANDS, R } from './terrain.js';

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
  const mat = new THREE.MeshStandardMaterial({ color: 0x1f8fb6, roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.86, flatShading: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 wp = modelMatrix * vec4(transformed, 1.0);
      transformed.y += sin(wp.x * 0.06 + uTime * 1.1) * 0.35 + cos(wp.z * 0.05 + uTime * 0.8) * 0.3 + sin((wp.x + wp.z) * 0.13 + uTime * 1.9) * 0.12;`);
  };
  const m = new THREE.Mesh(geo, mat);
  m.position.y = -0.15;
  m.receiveShadow = !!q.shadows;
  return m;
}

// ---------------- terrain material (lava glow) ----------------
export function terrainMaterial(q) {
  const opts = { vertexColors: true, flatShading: true };
  const mat = q.standard ? new THREE.MeshStandardMaterial({ ...opts, roughness: 0.95, metalness: 0 }) : new THREE.MeshLambertMaterial(opts);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time;
    sh.vertexShader = 'attribute float glow;\nvarying float vGlow;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    sh.fragmentShader = 'uniform float uTime;\nvarying float vGlow;\n' + sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.32, 0.05) * vGlow * (0.9 + 0.35 * sin(uTime * 1.7 + vGlow * 6.0));',
    );
  };
  return mat;
}

// ---------------- lights ----------------
export function makeLights(scene, q) {
  const hemi = new THREE.HemisphereLight(0xe2f2ff, 0x6b5440, 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.6);
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
    const r = 120 + rng() * 300;
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
  const palms = scatter(90, 2.5, 34, 0.9);
  instanced(root, palm.trunk, lam(0x9b6b3e), palms, place(), sh);
  instanced(root, palm.top, lam(0x5cbf3f, { side: THREE.DoubleSide }), palms, place(), sh);

  const jt = jungleTreeGeometry(rng);
  const jungle = scatter(360, 37, 124, 0.88);
  instanced(root, jt.trunk, trunkMat, jungle, place(), sh);
  instanced(root, jt.top, lam(0x3e8f2f), jungle.filter((_, i) => i % 2 === 0), place(), sh);
  instanced(root, jt.top, lam(0x56a83a), jungle.filter((_, i) => i % 2 === 1), place(), sh);
  const bushes = scatter(420, 37, 124, 0.85, 1);
  instanced(root, bushGeometry(), lam(0x4b9a37), bushes, place(), sh);
  const flowers = scatter(260, 37, 124, 0.9, 1);
  const flowerGeo = new THREE.IcosahedronGeometry(0.16, 0);
  flowerGeo.translate(0, 0.25, 0);
  instanced(root, flowerGeo, lam(0xff6fa8, { emissive: 0x551133 }), flowers.filter((_, i) => i % 2), place(), false);
  instanced(root, flowerGeo, lam(0xffd23f, { emissive: 0x443300 }), flowers.filter((_, i) => !(i % 2)), place(), false);
  const grass = scatter(1600, 2.5, 124, 0.9, 0.5);
  instanced(root, grassGeometry(), lam(0x6cc24a), grass.filter((p) => p.y > 36), place(), false);
  instanced(root, grassGeometry(), lam(0xb9c96a), grass.filter((p) => p.y <= 36), place(), false);

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

  for (const p of [...palms, ...jungle, ...pines, ...dead]) trees.push({ x: p.x, z: p.z, y: p.y, r: 0.35 * p.userData.s });

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
