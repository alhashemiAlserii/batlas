// Highcrag — an original survival climbing game for the Batlas site (1–4 players).
// Flow: title → airport terminal → flight → crash on the beach → climb → summit beacon.
import * as THREE from '../../vendor/three.module.js';
import { Terrain, BANDS, bandAt, zoneName, makeRng, R, HALF, COAST } from './terrain.js';
import { Sfx } from './audio.js';
import { HNet } from './net.js';
import { pickQuality, QUALITY, makeSky, makeEnvironment, makeWater, makeShoreWater, terrainMaterial, makeLights, makeClouds, dressMountain, buildLandmarks, Gulls, Smoke, glowSprite, bandSkyColors, shared } from './scenery.js';
import { makeClimber, poseClimber, playEmote, makeTag, disposeClimber, OUTFITS, WARDROBE, DEFAULT_LOOK, validLook, randomLook } from './characters.js';
import { buildLobby, buildAirliner, buildWreck, LOBBY_FLOOR } from './lobby.js';
import { TouchControls } from './touch.js';

const $ = (s) => document.querySelector(s);
const V3 = THREE.Vector3;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isTouch = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && /iPad|iPhone|Android|Mobile|Macintosh/i.test(navigator.userAgent) && 'ontouchend' in document);
if (isTouch) document.body.classList.add('touch');

// iOS Safari ignores user-scalable=no, so block its zoom gestures ourselves:
// pinch (gesture* events, and two-finger touchmove), double-tap (a second tap within 320 ms) and dblclick.
{
  const stop = (e) => e.preventDefault();
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) document.addEventListener(ev, stop, { passive: false });
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  // Only a second tap close to the first one (that's what Safari zooms on); quick taps on different buttons pass.
  let lastTap = 0, lastX = -999, lastY = -999;
  document.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    const now = performance.now();
    const near = t && Math.hypot(t.clientX - lastX, t.clientY - lastY) < 40;
    if (now - lastTap < 320 && near && !e.target.closest?.('input, select, textarea')) e.preventDefault();
    lastTap = now;
    if (t) { lastX = t.clientX; lastY = t.clientY; }
  }, { passive: false });
}

const store = {
  get(k, d) { try { const v = localStorage.getItem('highcrag.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('highcrag.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ---------------- renderer / scene ----------------
const qName = pickQuality(isTouch);
const Q = QUALITY[qName] ?? QUALITY.medium;
const renderer = new THREE.WebGLRenderer({ antialias: Q.aa, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, Q.pixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = Q.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;
$('#view').appendChild(renderer.domElement);
const canvas = renderer.domElement;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 2600);
scene.fog = new THREE.Fog(0xbfe6f5, 80, 700);
const sky = makeSky();
scene.add(sky.mesh);
// Image-based lighting from the sky (Medium/High): realistic ambient light and reflections.
const env = Q.standard ? makeEnvironment(renderer, sky) : null;
let envKey = '';
const { sun } = makeLights(scene, Q);
const water = makeWater(Q);
scene.add(water);
const clouds = makeClouds(Q, makeRng(77));
scene.add(clouds);
const fireLight = new THREE.PointLight(0xff8a3d, 0, 18, 1.6);
scene.add(fireLight);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  checkRotate();
});

const sfx = new Sfx();
sfx.setVolume(store.get('vol', 0.7));
let sens = store.get('sens', 1);
let invertY = store.get('invertY', false);
let look = validLook(store.get('look', DEFAULT_LOOK));

// ---------------- items ----------------
const ITEMS = {
  berry: { name: 'Trailberries', icon: '🫐', color: 0x4a5cff, food: true, hint: 'Eat: less hungry' },
  mushroom: { name: 'Glowcap', icon: '🍄', color: 0xff5a7a, food: true, hint: 'Eat: a gamble' },
  ration: { name: 'Trail ration', icon: '🍫', color: 0x8a5a2b, food: true, hint: 'Eat: much less hungry' },
  bandage: { name: 'Bandage', icon: '🩹', color: 0xf3f3f3, hint: 'Heal some injury' },
  medkit: { name: 'First-aid kit', icon: '🧰', color: 0xff3b4a, hint: 'Heal a lot of injury' },
  warmer: { name: 'Hand warmer', icon: '🧤', color: 0xff8a2a, hint: 'Warm up' },
  piton: { name: 'Piton', icon: '📌', color: 0xb7c0cc, hint: 'Use while climbing to make a rest spot' },
  tonic: { name: 'Fizz tonic', icon: '🧃', color: 0x5cff9a, hint: 'Full stamina, no drain for 9 s' },
  compass: { name: 'Compass', icon: '🧭', color: 0xd4a017, hint: 'Carry it to see directions' },
  rope: { name: 'Rope coil', icon: '🪢', color: 0xb8864b, hint: 'Use at a ledge edge to hang a rope' },
  flare: { name: 'Flare', icon: '🎇', color: 0xff2a3d, hint: 'Plant a bright signal everyone can see' },
};
const LOOT = {
  shore: ['berry', 'berry', 'ration', 'bandage', 'piton'],
  moss: ['berry', 'berry', 'mushroom', 'mushroom', 'bandage', 'piton', 'piton', 'ration', 'rope'],
  frost: ['warmer', 'warmer', 'warmer', 'ration', 'piton', 'bandage', 'tonic', 'berry', 'rope'],
  crown: ['warmer', 'tonic', 'tonic', 'piton', 'bandage', 'ration', 'warmer', 'medkit'],
};
const CRASH_LOOT = ['compass', 'compass', 'rope', 'rope', 'rope', 'flare', 'flare', 'medkit', 'ration', 'ration', 'tonic', 'bandage', 'bandage', 'berry', 'piton', 'warmer'];

function itemMesh(type) {
  const g = new THREE.Group();
  const c = ITEMS[type].color;
  const m = new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.22 });
  const add = (geo, mat = m, x = 0, y = 0, z = 0, rx = 0, rz = 0) => { const k = new THREE.Mesh(geo, mat); k.position.set(x, y, z); k.rotation.set(rx, 0, rz); g.add(k); return k; };
  if (type === 'berry') {
    for (const [x, y, z] of [[0, 0, 0], [0.12, 0.05, 0.05], [-0.08, 0.08, 0.1], [0.03, 0.15, -0.06]]) add(new THREE.SphereGeometry(0.09, 8, 6), m, x, y, z);
    add(new THREE.ConeGeometry(0.08, 0.2, 4), new THREE.MeshLambertMaterial({ color: 0x3e9a3a }), 0, 0.25, 0);
  } else if (type === 'mushroom') {
    add(new THREE.CylinderGeometry(0.05, 0.07, 0.22, 6), new THREE.MeshLambertMaterial({ color: 0xf1e6cf }));
    add(new THREE.SphereGeometry(0.18, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, 0.1, 0);
  } else if (type === 'piton') {
    add(new THREE.ConeGeometry(0.06, 0.4, 5), m, 0, 0, 0, 0, Math.PI / 2);
    add(new THREE.TorusGeometry(0.08, 0.02, 5, 10), m, 0.22, 0, 0);
  } else if (type === 'tonic') {
    add(new THREE.CylinderGeometry(0.08, 0.08, 0.3, 10));
  } else if (type === 'bandage') {
    add(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 10));
    add(new THREE.BoxGeometry(0.2, 0.13, 0.05), new THREE.MeshLambertMaterial({ color: 0xff3b4a }));
  } else if (type === 'medkit') {
    add(new THREE.BoxGeometry(0.42, 0.28, 0.2), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x333333 }));
    add(new THREE.BoxGeometry(0.22, 0.06, 0.21), m, 0, 0, 0);
    add(new THREE.BoxGeometry(0.06, 0.2, 0.21), m, 0, 0, 0);
  } else if (type === 'compass') {
    add(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 18), m);
    add(new THREE.CylinderGeometry(0.15, 0.15, 0.065, 18), new THREE.MeshLambertMaterial({ color: 0xfff8e6 }));
    add(new THREE.ConeGeometry(0.04, 0.24, 4), new THREE.MeshLambertMaterial({ color: 0xff2a3d }), 0, 0.05, 0, Math.PI / 2);
  } else if (type === 'rope') {
    for (let i = 0; i < 3; i++) add(new THREE.TorusGeometry(0.2 - i * 0.03, 0.04, 6, 16), m, 0, i * 0.05, 0, Math.PI / 2);
  } else if (type === 'flare') {
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 8), m, 0, 0, 0, 0, 0.3);
    add(new THREE.CylinderGeometry(0.055, 0.055, 0.08, 8), new THREE.MeshLambertMaterial({ color: 0x222222 }), -0.05, 0.17, 0, 0, 0.3);
  } else {
    add(new THREE.BoxGeometry(type === 'ration' ? 0.3 : 0.22, 0.1, 0.16));
  }
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.4, 20), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -0.3;
  g.add(halo);
  g.userData.halo = halo;
  return g;
}

// ---------------- airport (built once) ----------------
const lobby = buildLobby();
scene.add(lobby.group);
const flightPlane = buildAirliner({ withGear: false });
flightPlane.visible = false;
scene.add(flightPlane);
const planeSmoke = [];

// ---------------- island world (per seed) ----------------
let world = null;
function disposeWorld() {
  if (!world) return;
  scene.remove(world.root);
  world.root.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
  world = null;
}

function makeCamp(pos, isBeacon) {
  const g = new THREE.Group();
  g.position.copy(pos);
  const stone = new THREE.MeshLambertMaterial({ color: 0x8b8f96, flatShading: true });
  const n = isBeacon ? 10 : 8;
  const rr = isBeacon ? 1.5 : 0.8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(isBeacon ? 0.45 : 0.24), stone);
    s.position.set(Math.cos(a) * rr, isBeacon ? 0.2 : 0.1, Math.sin(a) * rr);
    s.castShadow = true;
    g.add(s);
  }
  const logMat = new THREE.MeshLambertMaterial({ color: 0x6b4426 });
  if (isBeacon) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 2.6, 8), stone);
    pillar.position.y = 1.3;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 0.8, 0.6, 10), new THREE.MeshLambertMaterial({ color: 0x5a3b26 }));
    bowl.position.y = 2.9;
    g.add(pillar, bowl);
  } else {
    for (const r of [0.6, -0.6, 1.6]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.1, 6), logMat);
      l.rotation.z = Math.PI / 2;
      l.rotation.y = r;
      l.position.y = 0.14;
      g.add(l);
    }
    for (const a of [0.4, 2.5, 4.4]) {
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.4, 8), logMat);
      seat.rotation.z = Math.PI / 2;
      seat.rotation.y = a + Math.PI / 2;
      seat.position.set(Math.cos(a) * 2.2, 0.22, Math.sin(a) * 2.2);
      g.add(seat);
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.2, 5), logMat);
    pole.position.set(1.6, 2.1, 0);
    g.add(pole);
  }
  const flagMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a8, side: THREE.DoubleSide });
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6), flagMat);
  flag.position.set(isBeacon ? 0 : 2.15, isBeacon ? 5.2 : 3.9, 0);
  if (isBeacon) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5), logMat);
    pole.position.set(-0.55, 4.6, 0);
    g.add(pole);
  }
  g.add(flag);
  const flame = new THREE.Group();
  const f1 = new THREE.Mesh(new THREE.ConeGeometry(isBeacon ? 1.0 : 0.38, isBeacon ? 2.6 : 1.0, 7), new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
  const f2 = new THREE.Mesh(new THREE.ConeGeometry(isBeacon ? 0.55 : 0.2, isBeacon ? 1.6 : 0.6, 6), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
  f1.position.y = isBeacon ? 4.4 : 0.55;
  f2.position.y = isBeacon ? 4.0 : 0.4;
  const glow = glowSprite(0xff8a3d, isBeacon ? 9 : 3.5);
  glow.position.y = isBeacon ? 4.3 : 0.6;
  flame.add(f1, f2, glow);
  flame.visible = false;
  g.add(flame);
  return { group: g, flame, flag, flagMat, pos: pos.clone(), lit: false, isBeacon };
}

function spawnItem(root, type, pos) {
  const mesh = itemMesh(type);
  mesh.position.set(pos.x, pos.y + 0.45, pos.z);
  root.add(mesh);
  return { id: null, type, mesh, pos: pos.clone(), taken: false, phase: Math.random() * 6 };
}

function buildWorld(seed) {
  disposeWorld();
  const T = new Terrain(seed);
  const rng = makeRng(seed ^ 0x9e3779b9);
  const root = new THREE.Group();
  const terrain = new THREE.Mesh(T.buildMesh(), terrainMaterial(Q));
  terrain.receiveShadow = Q.shadows;
  terrain.matrixAutoUpdate = false;
  root.add(terrain);

  // The crash site: spawn on the beach on the +x side, wreck alongside it.
  let spawn = new V3(COAST, 1.5, 0);
  for (let d = COAST + 90; d > 0; d -= 0.5) {
    const y = T.height(d, 0);
    if (y > 1.4) { spawn = new V3(d, y, 0); break; }
  }
  const wreckOrigin = spawn.clone().add(new V3(1, 0, 25));
  const wreck = buildWreck(wreckOrigin, new V3(0, 0, 1), (x, z) => Math.max(T.height(x, z), 0), rng);
  root.add(wreck.group);

  const camps = [];
  const angles = [0.35, 1.5, 2.8];
  for (let b = 1; b < BANDS.length; b++) {
    const p = T.campSpot(BANDS[b].y0 + 1, angles[b - 1]);
    if (p) camps.push({ ...makeCamp(p, false), band: BANDS[b] });
  }
  const beacon = makeCamp(T.summit.clone(), true);
  for (const c of [...camps, beacon]) root.add(c.group);

  const avoid = [{ p: spawn, r: 4 }, { p: wreckOrigin, r: 16 }, ...camps.map((c) => ({ p: c.pos, r: 5 })), { p: beacon.pos, r: 6 }];
  const trees = dressMountain(root, T, rng, Q, avoid);
  trees.push(...wreck.colliders);
  const marks = buildLandmarks(root, T, rng, Q, spawn, T.summit);
  trees.push(...marks.colliders);
  root.add(makeShoreWater(T, Q));
  const gulls = new Gulls(root, spawn.clone().add(new V3(-20, 0, 10)), Q.decor > 0.5 ? 12 : 7);

  const thorns = [];
  const thornMat = new THREE.MeshLambertMaterial({ color: 0x7a2f4a, flatShading: true });
  const spikeMat = new THREE.MeshLambertMaterial({ color: 0xd9c38f, flatShading: true });
  for (let i = 0; i < 18; i++) {
    const p = T.flatSpot(rng, 38, 124, 0.9, 80);
    if (!p || camps.some((c) => c.pos.distanceTo(p) < 8)) continue;
    const r = 1.4 + rng() * 1.2;
    thorns.push({ pos: p, r });
    for (let k = 0; k < 6; k++) {
      const a = rng() * 6.28, d = rng() * r;
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45 + rng() * 0.3, 0), thornMat);
      m.position.set(x, T.height(x, z) + 0.25, z);
      m.scale.y = 0.7;
      root.add(m);
      for (let s = 0; s < 3; s++) {
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.35, 4), spikeMat);
        sp.position.set(x + (rng() - 0.5) * 0.6, m.position.y + 0.3, z + (rng() - 0.5) * 0.6);
        sp.rotation.set((rng() - 0.5) * 1.4, 0, (rng() - 0.5) * 1.4);
        root.add(sp);
      }
    }
  }

  const items = [];
  const counts = { shore: 28, moss: 28, frost: 24, crown: 16 };
  for (const band of BANDS) {
    const pool = LOOT[band.id];
    for (let i = 0; i < counts[band.id]; i++) {
      const p = T.flatSpot(rng, Math.max(1.5, band.y0 + 1), Math.min(band.y1, 262), 0.85, 80);
      if (p) items.push(spawnItem(root, pool[Math.floor(rng() * pool.length)], p));
    }
  }
  CRASH_LOOT.forEach((type, i) => {
    const a = (i / CRASH_LOOT.length) * Math.PI * 2 + rng() * 0.3;
    const d = 4 + rng() * 5;
    const x = wreckOrigin.x - 3 + Math.cos(a) * d * 0.7, z = wreckOrigin.z - 6 + Math.sin(a) * d;
    items.push(spawnItem(root, type, new V3(x, Math.max(T.height(x, z), 0.2), z)));
  });
  for (const c of camps) {
    const pool = LOOT[c.band.id];
    for (let k = 0; k < 2; k++) {
      const a = rng() * 6.28;
      const x = c.pos.x + Math.cos(a) * 2.2, z = c.pos.z + Math.sin(a) * 2.2;
      items.push(spawnItem(root, pool[Math.floor(rng() * pool.length)], new V3(x, T.height(x, z), z)));
    }
  }

  const smokes = wreck.smokeAt.map((p) => new Smoke(root, new V3(p.x, Math.max(T.height(p.x, p.z), 0) + 1, p.z), { count: Q.decor > 0.5 ? 26 : 14, size: 3, color: 0x4a4440 }));
  for (let i = 0; i < 8; i++) {
    const p = T.flatSpot(rng, 220, 270, 0.85, 60);
    if (p) smokes.push(new Smoke(root, p, { count: 12, size: 2.2, color: 0xc9b7a8, rise: 1.6, life: 5 }));
  }

  const PN = isTouch ? 700 : 1400;
  const pg = new THREE.BufferGeometry();
  const pp = new Float32Array(PN * 3);
  for (let i = 0; i < PN; i++) { pp[i * 3] = (Math.random() - 0.5) * 50; pp[i * 3 + 1] = Math.random() * 30; pp[i * 3 + 2] = (Math.random() - 0.5) * 50; }
  pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  const particles = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, transparent: true, opacity: 0, depthWrite: false }));
  particles.frustumCulled = false;
  root.add(particles);

  const pitonGroup = new THREE.Group();
  root.add(pitonGroup);
  scene.add(root);
  world = { seed, T, root, spawn, wreckOrigin, camps, beacon, items, trees, thorns, particles, pitonGroup, pitons: [], ropes: [], flares: [], smokes, gulls, marks: marks.anim };
}

// ---------------- player & game state ----------------
let climber = makeClimber(look, { shadows: Q.shadows });
scene.add(climber);
const P = {
  pos: new V3(), vel: new V3(), render: new V3(), mode: 'ground', cx: 0, cz: 0, facing: Math.PI,
  lungeT: 0, regrabLock: 0, peakY: 0, stepAcc: 0, regenDelay: 0, anim: 0, swimming: false,
  isDown: false, downT: 0, wakeT: 0, rope: null, ropeY: 0, moveAmt: 0,
};
const S = { stamina: 1, hunger: 0, cold: 0, injury: 0, boostT: 0 };
const inv = [null, null, null];
let sel = 0;
let state = 'title'; // title | lobby | flight | play | paused | dead | won
let pausedFrom = 'play';
let elapsed = 0, checkpoint = null, stats = null, lastBand = null;
let blizzard = { t: 40, on: false, k: 0 };
let gust = { t: 8, on: false, k: 0, dir: new V3(1, 0, 0) };
const maxSt = () => Math.max(0, 1 - S.hunger - S.cold - S.injury);
const onIsland = () => state === 'play' || state === 'dead' || ((state === 'paused' || state === 'won') && pausedFrom !== 'lobby');

const G = 22, WALK = 4.6, SPRINT = 7.4, JUMP = 7.4, CLIMB = 1.75, WALL_NY = 0.72, HAND = 1.05;
const tmpN = new V3(), tmpN2 = new V3();
const gy = (x, z) => Math.max(world.T.height(x, z), -0.8);

function resetRun(sameSeed, forceSeed) {
  const seed = forceSeed ?? (sameSeed && world ? world.seed : (Math.random() * 1e9) >>> 0);
  buildWorld(seed);
  inv.fill(null);
  sel = 0;
  Object.assign(S, { stamina: 1, hunger: 0, cold: 0, injury: 0, boostT: 0 });
  elapsed = 0;
  stats = { falls: 0, blackouts: 0, eaten: 0, pitons: 0, ropes: 0, maxAlt: 0 };
  checkpoint = world.spawn.clone();
  blizzard = { t: 45, on: false, k: 0 };
  gust = { t: 8, on: false, k: 0, dir: new V3(1, 0, 0) };
  lastBand = null;
  P.isDown = false;
  P.wakeT = 0;
  renderInv();
  store.set('lastSeed', seed);
}

function teleport(p) {
  P.pos.copy(p);
  P.pos.y = gy(p.x, p.z);
  P.vel.set(0, 0, 0);
  P.mode = 'ground';
  P.rope = null;
  P.render.copy(P.pos);
  P.peakY = P.pos.y;
}
function toLobby() {
  P.pos.copy(lobby.spawn);
  P.vel.set(0, 0, 0);
  P.mode = 'ground';
  P.rope = null;
  P.render.copy(P.pos);
  P.facing = 0;
  camYaw = Math.PI;
  camPitch = 0.2;
}

// ---------------- input ----------------
const keys = new Set();
let mouseGrab = false, jumpPressed = false;
let camYaw = 0, camPitch = 0.25;
let touch = null;
const overlayOpen = () => !$('#wardrobe').classList.contains('hidden');

addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select')) return;
  if (e.code === 'Tab') e.preventDefault();
  if (state === 'flight' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape')) { skipFlight(); return; }
  if (state !== 'play' && state !== 'lobby') return;
  if (overlayOpen()) { if (e.code === 'Escape' || e.code === 'KeyE') closeWardrobe(); return; }
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'Space') { jumpPressed = true; e.preventDefault(); }
  if (e.code === 'KeyE') interact();
  if (e.code === 'KeyF') useItem();
  if (e.code === 'KeyQ') dropItem();
  if (e.code === 'KeyT') emote('wave');
  if (e.code === 'KeyG') emote('cheer');
  if (e.code === 'KeyY') emote('point');
  if (e.code === 'Enter' && P.isDown) giveUp();
  if (e.code.startsWith('Digit')) { const d = Number(e.code.slice(5)) - 1; if (d >= 0 && d < 3) { sel = d; renderInv(); } }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouseGrab = false; });
canvas.addEventListener('mousedown', (e) => {
  sfx.unlock();
  if (state !== 'play' && state !== 'lobby') return;
  if (!isTouch && document.pointerLockElement !== canvas) { if (!overlayOpen()) canvas.requestPointerLock?.(); return; }
  if (e.button === 0 || e.button === 2) mouseGrab = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0 || e.button === 2) mouseGrab = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
const lookBy = (dx, dy, k) => {
  camYaw -= dx * k * sens;
  camPitch = clamp(camPitch + dy * k * sens * (invertY ? -1 : 1), -0.55, 1.25);
};
addEventListener('mousemove', (e) => {
  if ((state !== 'play' && state !== 'lobby') || document.pointerLockElement !== canvas) return;
  lookBy(e.movementX, e.movementY, 0.0024);
});
addEventListener('wheel', (e) => {
  if (state !== 'play') return;
  sel = (sel + (e.deltaY > 0 ? 1 : 2)) % 3;
  renderInv();
}, { passive: true });
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && (state === 'play' || state === 'lobby') && !isTouch && !overlayOpen() && !P.isDown) pause();
});

if (isTouch) {
  touch = new TouchControls({
    onLook: (dx, dy) => { if (state === 'play' || state === 'lobby') lookBy(dx, dy, 0.0065); },
    onAct: () => (P.isDown ? giveUp() : overlayOpen() ? closeWardrobe() : interact()),
    onUse: () => useItem(),
    onDrop: () => dropItem(),
    onEmote: () => emote(['wave', 'cheer', 'point'][Math.floor(Math.random() * 3)]),
    onJump: () => { if (state === 'flight') skipFlight(); else jumpPressed = true; },
    onGrabToggle: () => sfx.click(),
  });
  $('#touch').classList.add('hidden');
  document.querySelectorAll('#inv .slot').forEach((el) => el.addEventListener('pointerdown', (e) => { e.stopPropagation(); sel = Number(el.dataset.i); renderInv(); }));
}

function inputVec() {
  let x = 0, y = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (touch) { x += touch.move.x; y -= touch.move.y; }
  const l = Math.hypot(x, y);
  if (l > 1) { x /= l; y /= l; }
  return { x, y };
}
const grabHeld = () => mouseGrab || keys.has('KeyR') || !!touch?.grab;
const sprintHeld = () => keys.has('ShiftLeft') || keys.has('ShiftRight') || !!touch?.running;

// ---------------- UI helpers ----------------
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3300);
  while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
}
const toastOnce = (() => { const last = {}; return (k, msg, gap = 6) => { const now = performance.now() / 1000; if ((last[k] ?? -1e9) + gap < now) { last[k] = now; toast(msg); } }; })();
function zoneCard(title, sub) {
  const c = $('#zonecard');
  c.querySelector('b').textContent = title;
  c.querySelector('span').textContent = sub;
  c.classList.remove('show');
  void c.offsetWidth;
  c.classList.add('show');
}
const ZONE_SUB = {
  shore: 'Gather what you can from the wreck.',
  moss: 'Watch out for thornbrush.',
  frost: 'Keep warm. Blizzards roll in fast.',
  crown: 'Thin air and fierce gusts. The beacon is close.',
};

function renderInv() {
  document.querySelectorAll('#inv .slot').forEach((el, i) => {
    el.classList.toggle('sel', i === sel);
    el.classList.toggle('full', !!inv[i]);
    el.querySelector('.ico').textContent = inv[i] ? ITEMS[inv[i]].icon : '';
  });
  const it = inv[sel] ? ITEMS[inv[sel]] : null;
  $('#invName').textContent = it ? `${it.name} · ${it.hint}` : '';
}
const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// ---------------- interactions ----------------
const myPos = () => (P.mode === 'climb' ? climberWorldPos() : P.pos);

function interact() {
  if (P.isDown || overlayOpen()) return;
  if (state === 'lobby') {
    if (P.pos.distanceTo(lobby.wardrobe) < 3) { openWardrobe(); return; }
    if (P.pos.distanceTo(lobby.gate) < 3.5) { board(); return; }
    return;
  }
  if (state !== 'play' || P.wakeT > 0) return;
  const me = myPos();
  if (coop.on && coopInteract(me)) return;
  let best = null, bd = 2.4;
  for (const it of world.items) {
    if (it.taken) continue;
    const d = it.mesh.position.distanceTo(me) - 0.6;
    if (d < bd) { bd = d; best = it; }
  }
  if (best) {
    const slot = inv[sel] === null ? sel : inv.indexOf(null);
    if (slot < 0) { toast('Your pack is full (Q drops the selected item)'); return; }
    if (coop.on) {
      if (!best.id) { toast('Still syncing the mountain…'); return; }
      if (!coop.pending.has(best.id)) { coop.pending.add(best.id); net.send({ t: 'take', id: best.id }); }
      return;
    }
    giveItem(slot, best.type);
    best.taken = true;
    best.mesh.visible = false;
    return;
  }
  for (const [i, c] of world.camps.entries()) {
    if (!c.lit && c.pos.distanceTo(me) < 3.6) {
      if (coop.on) net.send({ t: 'camp', i }); else lightCamp(c);
      return;
    }
  }
  if (!world.beacon.lit && world.beacon.pos.distanceTo(me) < 4.5) {
    if (coop.on) net.send({ t: 'beacon' }); else lightBeacon();
  }
}

function giveItem(slot, type) {
  inv[slot] = type;
  sel = slot;
  renderInv();
  sfx.pickup();
  toast(`Picked up ${ITEMS[type].name}`);
  if (type === 'compass') toastOnce('compass', '🧭 With a compass in your pack you can see which way to go.', 999);
}

function lightCamp(c, by = null, silent = false) {
  if (c.lit) return;
  c.lit = true;
  c.flame.visible = true;
  c.flagMat.color.setHex(0xff7a29);
  const best = world.camps.filter((k) => k.lit).sort((a, b) => b.pos.y - a.pos.y)[0];
  checkpoint = best.pos.clone().add(new V3(1.6, 0, 1.2));
  if (silent) return;
  sfx.ignite();
  toast(by ? `🔥 ${by} lit the ${c.band.name} campfire. Checkpoint saved.` : `🔥 Campfire lit: ${c.band.name}. Checkpoint saved.`);
}

function addPiton(at) {
  const n = world.T.normal(at.x, at.z, new V3());
  const m = itemMesh('piton');
  m.userData.halo.visible = false;
  m.position.copy(at);
  m.rotation.y = Math.atan2(-n.x, -n.z) + Math.PI / 2;
  world.pitonGroup.add(m);
  world.pitons.push(at);
}

function addRope(top, bottom, anchor) {
  const len = Math.max(0.5, top.y - bottom.y);
  const g = new THREE.Group();
  const ropeMat = new THREE.MeshLambertMaterial({ color: 0xc8955a });
  const line = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, len, 6), ropeMat);
  line.position.set(top.x, (top.y + bottom.y) / 2, top.z);
  const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.04, 0.6, 6), new THREE.MeshLambertMaterial({ color: 0x8a8f99 }));
  stake.position.set(anchor.x, anchor.y + 0.1, anchor.z);
  g.add(line, stake);
  for (let y = top.y - 1; y > bottom.y; y -= 1.2) {
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), ropeMat);
    k.position.set(top.x, y, top.z);
    g.add(k);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = Q.shadows; });
  world.root.add(g);
  world.ropes.push({ top: top.clone(), bottom: bottom.clone(), anchor: anchor.clone(), mesh: g });
}

function addFlare(p) {
  const g = new THREE.Group();
  g.position.copy(p);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), new THREE.MeshLambertMaterial({ color: 0xff2a3d }));
  stick.position.y = 0.25;
  const glow = glowSprite(0xff3348, 3.2);
  glow.position.y = 0.6;
  g.add(stick, glow);
  world.root.add(g);
  world.smokes.push(new Smoke(world.root, p.clone().add(new V3(0, 0.6, 0)), { count: 18, size: 1.6, color: 0xff5a6e, rise: 5, life: 6, spread: 0.3 }));
  world.flares.push({ p: p.clone(), glow });
}

function findRopeEdge() {
  const f = new V3(Math.sin(P.facing), 0, Math.cos(P.facing));
  for (let d = 0.6; d <= 3.2; d += 0.2) {
    const x = P.pos.x + f.x * d, z = P.pos.z + f.z * d;
    const g = gy(x, z);
    if (P.pos.y - g > 2.5) {
      const back = Math.max(0.2, d - 0.5);
      const ax = P.pos.x + f.x * back, az = P.pos.z + f.z * back;
      const hx = P.pos.x + f.x * (d + 0.4), hz = P.pos.z + f.z * (d + 0.4);
      const anchor = new V3(ax, gy(ax, az), az);
      const top = new V3(hx, anchor.y + 0.3, hz);
      const bottom = new V3(hx, Math.max(gy(hx, hz) + 0.2, top.y - 30), hz);
      return { top, bottom, anchor };
    }
  }
  return null;
}

function useItem() {
  if (state !== 'play' || P.isDown || P.wakeT > 0) return;
  const t = inv[sel];
  if (!t) return;
  let used = true;
  if (t === 'berry') { S.hunger = Math.max(0, S.hunger - 0.15); toast('Tart and juicy. Hunger down.'); }
  else if (t === 'ration') { S.hunger = Math.max(0, S.hunger - 0.35); toast('Chewy but filling.'); }
  else if (t === 'mushroom') {
    if (Math.random() < 0.7) { S.hunger = Math.max(0, S.hunger - 0.12); S.stamina = maxSt(); toast('The glowcap tingles. Stamina restored!'); }
    else { S.injury = Math.min(1, S.injury + 0.1); sfx.hurt(); toast('Ugh. That one was bad…'); }
  } else if (t === 'bandage') { S.injury = Math.max(0, S.injury - 0.3); toast('Patched up.'); }
  else if (t === 'medkit') { S.injury = Math.max(0, S.injury - 0.6); S.cold = Math.max(0, S.cold - 0.15); toast('Bandaged, splinted and ready to go.'); }
  else if (t === 'warmer') { S.cold = Math.max(0, S.cold - 0.4); toast('Toasty fingers.'); }
  else if (t === 'tonic') { S.stamina = maxSt(); S.boostT = 9; toast('Fizz! No stamina drain for a few seconds.'); }
  else if (t === 'compass') { toast('🧭 The compass shows the way at the top of the screen while you carry it.'); used = false; }
  else if (t === 'piton') {
    if (P.mode !== 'climb') { toast('Pitons go into a rock wall: use one while climbing.'); used = false; }
    else {
      const n = world.T.normal(P.cx, P.cz, tmpN);
      const at = new V3(P.cx, world.T.height(P.cx, P.cz), P.cz).addScaledVector(n, 0.12);
      addPiton(at);
      if (coop.on) net.send({ t: 'piton', p: [at.x, at.y, at.z] });
      stats.pitons++;
      sfx.piton();
      toast('Piton set. Hang here to rest.');
    }
  } else if (t === 'rope') {
    const edge = P.mode === 'ground' ? findRopeEdge() : null;
    if (!edge) { toast('Stand at the edge of a ledge, facing the drop, to hang a rope.'); used = false; }
    else {
      addRope(edge.top, edge.bottom, edge.anchor);
      if (coop.on) net.send({ t: 'rope', top: edge.top.toArray(), bottom: edge.bottom.toArray(), a: edge.anchor.toArray() });
      stats.ropes++;
      sfx.rope();
      toast('🪢 Rope hung! Anyone can climb it for very little stamina.');
    }
  } else if (t === 'flare') {
    if (P.mode !== 'ground') { toast('Plant a flare on solid ground.'); used = false; }
    else {
      const p = P.pos.clone();
      addFlare(p);
      if (coop.on) net.send({ t: 'flare', p: [p.x, p.y, p.z] });
      sfx.flare();
      toast('🎇 Flare planted. Its smoke can be seen from far away.');
    }
  }
  if (!used) return;
  if (ITEMS[t].food) { stats.eaten++; sfx.eat(); } else if (!['piton', 'rope', 'flare'].includes(t)) sfx.pickup();
  inv[sel] = null;
  renderInv();
}

function dropItem() {
  if (state !== 'play' || !inv[sel] || P.mode !== 'ground' || P.isDown) return;
  const f = new V3(Math.sin(P.facing), 0, Math.cos(P.facing));
  const x = P.pos.x + f.x, z = P.pos.z + f.z;
  if (coop.on) net.send({ t: 'drop', type: inv[sel], p: [x, gy(x, z), z] });
  else world.items.push(spawnItem(world.root, inv[sel], new V3(x, gy(x, z), z)));
  inv[sel] = null;
  renderInv();
}

function emote(e) {
  if ((state !== 'play' && state !== 'lobby') || P.isDown || P.mode === 'climb' || P.mode === 'rope') return;
  playEmote(climber, e);
  if (coop.on) net.send({ t: 'emote', e });
}

// ---------------- player physics ----------------
function climberWorldPos(out = new V3()) {
  const T = world.T;
  const n = T.normal(P.cx, P.cz, tmpN2);
  return out.set(P.cx, T.height(P.cx, P.cz), P.cz).addScaledVector(n, 0.5).add(new V3(0, -HAND, 0));
}

function tryGrab(dx, dz, handY) {
  const T = world.T;
  const l = Math.hypot(dx, dz);
  if (l < 1e-4) return false;
  dx /= l; dz /= l;
  let prev = 0;
  for (let s = 0.1; s <= 1.3; s += 0.05) {
    const h = T.height(P.pos.x + dx * s, P.pos.z + dz * s);
    if (h >= handY) {
      let a = prev, b = s;
      for (let k = 0; k < 10; k++) {
        const m = (a + b) / 2;
        if (T.height(P.pos.x + dx * m, P.pos.z + dz * m) >= handY) b = m; else a = m;
      }
      const qx = P.pos.x + dx * b, qz = P.pos.z + dz * b;
      if (T.normal(qx, qz, tmpN).y >= WALL_NY) return false;
      P.cx = qx; P.cz = qz;
      P.mode = 'climb';
      P.vel.set(0, 0, 0);
      S.stamina = Math.max(0, S.stamina - 0.02);
      sfx.grab();
      return true;
    }
    prev = s;
  }
  return false;
}

function tryRope() {
  for (const r of world.ropes) {
    // Standing by the stake at the top: swing onto the rope and start climbing down.
    if (P.mode === 'ground' && Math.hypot(P.pos.x - r.anchor.x, P.pos.z - r.anchor.z) < 3 && Math.abs(P.pos.y - r.anchor.y) < 1.2) {
      P.mode = 'rope';
      P.rope = r;
      P.ropeY = r.top.y;
      P.vel.set(0, 0, 0);
      sfx.rope();
      return true;
    }
    const hd = Math.hypot(P.pos.x - r.top.x, P.pos.z - r.top.z);
    const hy = P.pos.y + HAND;
    if (hd < (P.mode === 'ground' ? 1.9 : 1.2) && hy > r.bottom.y - 0.3 && P.pos.y < r.top.y + 0.5) {
      P.mode = 'rope';
      P.rope = r;
      P.ropeY = clamp(hy, r.bottom.y + HAND, r.top.y);
      P.vel.set(0, 0, 0);
      sfx.rope();
      return true;
    }
  }
  return false;
}

function release(msg) {
  const T = world.T;
  if (P.mode === 'rope') {
    P.pos.set(P.rope.top.x - Math.sin(P.facing) * 0.4, P.ropeY - HAND, P.rope.top.z - Math.cos(P.facing) * 0.4);
    P.vel.set(-Math.sin(P.facing) * 1.5, 0, -Math.cos(P.facing) * 1.5);
    P.rope = null;
  } else {
    const n = T.normal(P.cx, P.cz, tmpN);
    climberWorldPos(P.pos);
    P.pos.addScaledVector(n, 0.15);
    P.vel.set(n.x * 2, -0.5, n.z * 2);
  }
  P.mode = 'air';
  P.peakY = P.pos.y;
  P.regrabLock = 0.3;
  if (msg) {
    toast(msg);
    touch?.setGrab(false);
  }
}

function land(impact) {
  P.mode = 'ground';
  P.vel.y = 0;
  if (impact > 32) { sfx.land(true); stats.falls++; if (!P.isDown) blackout('You fell too far…'); return; }
  if (impact > 12) {
    const dmg = (impact - 12) * 0.028;
    S.injury = Math.min(1, S.injury + dmg);
    stats.falls++;
    sfx.land(true);
    sfx.hurt();
    shake = Math.min(1, dmg * 3);
    toast(dmg > 0.25 ? 'Ouch! That was a nasty fall.' : 'Oof. Bruised.');
  } else if (impact > 4) sfx.land(false);
}

function updateLobbyPlayer(dt) {
  const inp = overlayOpen() ? { x: 0, y: 0 } : inputVec();
  const fwd = new V3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
  const right = new V3(Math.cos(camYaw), 0, -Math.sin(camYaw));
  const move = fwd.multiplyScalar(inp.y).addScaledVector(right, inp.x);
  const mlen = move.length();
  const speed = sprintHeld() ? SPRINT : WALK;
  const B = lobby.bounds;
  const blocked = (x, z) => lobby.colliders.some((c) => x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ);
  if (mlen > 0.05) {
    const nx = clamp(P.pos.x + move.x * speed * dt, B.minX, B.maxX);
    const nz = clamp(P.pos.z + move.z * speed * dt, B.minZ, B.maxZ);
    if (!blocked(nx, P.pos.z)) P.pos.x = nx;
    if (!blocked(P.pos.x, nz)) P.pos.z = nz;
    P.facing = lerpAngle(P.facing, Math.atan2(move.x, move.z), 1 - Math.exp(-12 * dt));
    P.stepAcc += speed * dt;
    if (P.stepAcc > 1.6) { P.stepAcc = 0; sfx.step(); }
  }
  if (jumpPressed && P.pos.y <= LOBBY_FLOOR + 0.01) P.vel.y = JUMP * 0.8;
  jumpPressed = false;
  P.vel.y -= G * dt;
  P.pos.y += P.vel.y * dt;
  if (P.pos.y <= LOBBY_FLOOR) { P.pos.y = LOBBY_FLOOR; P.vel.y = 0; }
  P.mode = P.pos.y > LOBBY_FLOOR + 0.05 ? 'air' : 'ground';
  P.moveAmt = mlen;
  P.anim += dt * mlen * (sprintHeld() ? 13 : 9);
}

let shake = 0;
function updatePlayer(dt) {
  const T = world.T;
  if (P.isDown && (P.mode === 'climb' || P.mode === 'rope')) release();
  if ((P.isDown || P.wakeT > 0) && P.mode === 'ground') { P.pos.y = gy(P.pos.x, P.pos.z); P.moveAmt = 0; return; }
  const inp = inputVec();
  const fwd = new V3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
  const right = new V3(Math.cos(camYaw), 0, -Math.sin(camYaw));
  const move = fwd.clone().multiplyScalar(inp.y).addScaledVector(right, inp.x);
  const mlen = move.length();
  const band = bandAt(P.mode === 'climb' ? T.height(P.cx, P.cz) : P.pos.y);
  const thin = band.id === 'crown';
  P.regrabLock = Math.max(0, P.regrabLock - dt);
  P.lungeT = Math.max(0, P.lungeT - dt);
  S.boostT = Math.max(0, S.boostT - dt);
  const drain = (r) => { if (S.boostT <= 0) S.stamina = Math.max(0, S.stamina - r * dt); };
  const jump = jumpPressed;
  jumpPressed = false;
  let moving = false;

  if (P.mode === 'ground') {
    const n = T.normal(P.pos.x, P.pos.z, tmpN);
    P.swimming = T.height(P.pos.x, P.pos.z) < -0.8;
    const running = sprintHeld() && S.stamina > 0.02 && mlen > 0.1 && !P.swimming;
    let speed = running ? SPRINT : WALK;
    if (P.swimming) speed *= 0.55;
    if (n.y < 0.6 && !P.swimming) {
      const d = new V3(n.x, 0, n.z).normalize();
      P.pos.x += d.x * 6 * dt;
      P.pos.z += d.z * 6 * dt;
      P.pos.y = gy(P.pos.x, P.pos.z);
      if (grabHeld() && P.regrabLock <= 0) tryGrab(-n.x, -n.z, P.pos.y + HAND);
    } else if (mlen > 0.05) {
      moving = true;
      const sx = move.x * speed * dt, sz = move.z * speed * dt;
      let blocked = false;
      const tryStep = (dx, dz) => {
        const nx = clamp(P.pos.x + dx, -HALF + 2, HALF - 2), nz = clamp(P.pos.z + dz, -HALF + 2, HALF - 2);
        const g = gy(nx, nz);
        const len = Math.hypot(dx, dz);
        if (g - P.pos.y > Math.max(0.3, len * 1.4)) return false;
        P.pos.x = nx; P.pos.z = nz;
        if (g >= P.pos.y - 0.45) P.pos.y = g;
        else { P.mode = 'air'; P.vel.set(move.x * speed, 0, move.z * speed); P.peakY = P.pos.y; }
        return true;
      };
      if (!tryStep(sx, sz)) { blocked = true; if (!tryStep(sx, 0)) tryStep(0, sz); }
      P.facing = lerpAngle(P.facing, Math.atan2(move.x, move.z), 1 - Math.exp(-12 * dt));
      P.stepAcc += speed * dt;
      if (P.stepAcc > (running ? 1.9 : 1.5)) { P.stepAcc = 0; sfx.step(); }
      if (blocked && grabHeld() && P.regrabLock <= 0) tryGrab(move.x, move.z, P.pos.y + HAND);
    }
    if (P.mode === 'ground' && grabHeld() && P.regrabLock <= 0) {
      tryRope() || tryGrab(Math.sin(P.facing), Math.cos(P.facing), P.pos.y + HAND) || tryGrab(fwd.x, fwd.z, P.pos.y + HAND);
    }
    if (P.mode === 'ground') {
      if (jump && S.stamina >= 0.06 && !P.swimming) {
        P.mode = 'air';
        P.vel.set(move.x * speed, JUMP, move.z * speed);
        P.peakY = P.pos.y;
        S.stamina -= 0.06;
        P.regenDelay = 0.7;
      }
      if (running) { drain(0.16); P.regenDelay = 0.7; }
      else {
        P.regenDelay -= dt;
        if (P.regenDelay <= 0) S.stamina += (thin ? 0.24 : 0.38) * dt;
      }
      if (gust.on && thin) {
        const nx = P.pos.x + gust.dir.x * 3.2 * gust.k * dt, nz = P.pos.z + gust.dir.z * 3.2 * gust.k * dt;
        const g = gy(nx, nz);
        if (g - P.pos.y < 0.3) { P.pos.x = nx; P.pos.z = nz; if (g >= P.pos.y - 0.45) P.pos.y = g; else { P.mode = 'air'; P.vel.set(gust.dir.x * 3, 0, gust.dir.z * 3); P.peakY = P.pos.y; } }
      }
      pushOutOfTrees();
    }
  } else if (P.mode === 'air') {
    P.vel.y -= G * dt;
    P.vel.x += move.x * 5 * dt;
    P.vel.z += move.z * 5 * dt;
    const hs = Math.hypot(P.vel.x, P.vel.z);
    if (hs > SPRINT) { P.vel.x *= SPRINT / hs; P.vel.z *= SPRINT / hs; }
    const nx = clamp(P.pos.x + P.vel.x * dt, -HALF + 2, HALF - 2), nz = clamp(P.pos.z + P.vel.z * dt, -HALF + 2, HALF - 2);
    if (gy(nx, nz) > P.pos.y + 0.6) { P.vel.x = 0; P.vel.z = 0; } else { P.pos.x = nx; P.pos.z = nz; }
    P.pos.y += P.vel.y * dt;
    P.peakY = Math.max(P.peakY, P.pos.y);
    const g = gy(P.pos.x, P.pos.z);
    if (P.pos.y <= g) {
      P.pos.y = g;
      const wet = T.height(P.pos.x, P.pos.z) < -0.8;
      land(wet ? 0 : -P.vel.y);
    } else if (!P.isDown && grabHeld() && P.regrabLock <= 0 && S.stamina > 0.03 && -P.vel.y < 16) {
      const hy = P.pos.y + HAND;
      const toPeak = new V3(world.T.summit.x - P.pos.x, 0, world.T.summit.z - P.pos.z);
      if (tryRope() || tryGrab(Math.sin(P.facing), Math.cos(P.facing), hy) || tryGrab(fwd.x, fwd.z, hy) || tryGrab(toPeak.x, toPeak.z, hy)) {
        S.stamina = Math.max(0, S.stamina - 0.08);
        toastOnce('catch', 'Caught it!', 4);
      }
    }
  } else if (P.mode === 'rope') {
    const r = P.rope;
    if (!grabHeld()) { release(); return; }
    if (S.stamina <= 0) { release('Your hands slip off the rope!'); return; }
    if (jump) { release(); P.vel.y = 4; return; }
    const iy = inp.y;
    moving = Math.abs(iy) > 0.1;
    P.ropeY += iy * 2.4 * dt;
    if (moving && iy > 0) drain(0.016);
    else if (!moving) S.stamina += 0.05 * dt;
    P.facing = Math.atan2(r.anchor.x - r.top.x, r.anchor.z - r.top.z);
    if (P.ropeY >= r.top.y + 0.2) {
      P.mode = 'ground';
      P.pos.set(r.anchor.x, gy(r.anchor.x, r.anchor.z), r.anchor.z);
      P.rope = null;
      P.regrabLock = 0.6;
      sfx.grab();
      return;
    }
    const feet = P.ropeY - HAND;
    if (iy < 0 && feet <= gy(r.top.x, r.top.z) + 0.05) {
      P.mode = 'ground';
      P.pos.set(r.top.x - Math.sin(P.facing) * 0.5, 0, r.top.z - Math.cos(P.facing) * 0.5);
      P.pos.y = gy(P.pos.x, P.pos.z);
      P.rope = null;
      P.regrabLock = 0.6;
      return;
    }
    P.ropeY = Math.max(P.ropeY, r.bottom.y + HAND * 0.5);
    P.pos.set(r.top.x - Math.sin(P.facing) * 0.35, P.ropeY - HAND, r.top.z - Math.cos(P.facing) * 0.35);
    P.regenDelay = 0.6;
    if (moving) { P.stepAcc += dt * 2.4; if (P.stepAcc > 0.8) { P.stepAcc = 0; sfx.rope(); } }
  } else if (P.mode === 'climb') {
    const n = T.normal(P.cx, P.cz, tmpN);
    if (!grabHeld()) { release(); return; }
    if (S.stamina <= 0) { release('Your grip gives out!'); return; }
    const u = new V3(-n.x * n.y, 1 - n.y * n.y, -n.z * n.y).normalize();
    const r = new V3(n.z, 0, -n.x).normalize();
    let iy = inp.y, ix = inp.x;
    if (jump && S.stamina >= 0.12 && P.lungeT <= 0) { P.lungeT = 0.28; S.stamina -= 0.12; sfx.whoosh(); }
    let spd = CLIMB;
    if (P.lungeT > 0) { iy = 1; spd = 6; }
    moving = Math.abs(iy) + Math.abs(ix) > 0.1;
    const d = u.multiplyScalar(iy * spd).addScaledVector(r, ix * spd * 0.85);
    if (gust.on && thin) d.addScaledVector(r, gust.dir.dot(r) * 0.5 * gust.k);
    const ncx = clamp(P.cx + d.x * dt, -HALF + 2, HALF - 2), ncz = clamp(P.cz + d.z * dt, -HALF + 2, HALF - 2);
    const n2 = T.normal(ncx, ncz, tmpN2);
    P.cx = ncx; P.cz = ncz;
    if (n2.y >= WALL_NY) {
      P.mode = 'ground';
      P.pos.set(ncx + (iy > 0 ? -n.x * 0.3 : 0), 0, ncz + (iy > 0 ? -n.z * 0.3 : 0));
      P.pos.y = gy(P.pos.x, P.pos.z);
      P.regrabLock = 0.35;
      P.regenDelay = 0.5;
      if (iy > 0) sfx.grab();
      return;
    }
    P.facing = Math.atan2(-n.x, -n.z);
    const here = new V3(P.cx, T.height(P.cx, P.cz), P.cz);
    const onPiton = world.pitons.some((p) => p.distanceTo(here) < 1.5);
    if (onPiton && !moving) { S.stamina += 0.16 * dt; showStatus.piton = true; }
    else {
      let rate = moving ? (iy > 0.2 ? 0.065 : 0.045) : 0.035;
      if (gust.on && thin) rate += 0.08 * gust.k;
      if (band.id === 'frost' && S.cold > 0.3) rate *= 1.15;
      drain(rate);
    }
    P.regenDelay = 0.6;
    if (moving) { P.stepAcc += spd * dt; if (P.stepAcc > 0.9) { P.stepAcc = 0; sfx.grab(); } }
  }
  S.stamina = Math.min(S.stamina, maxSt());
  P.moveAmt = moving ? (P.mode === 'ground' ? mlen : 1) : 0;
  P.anim += dt * (moving ? (P.mode === 'climb' || P.mode === 'rope' ? 6 : mlen * (sprintHeld() ? 13 : 9)) : 0);
}

function pushOutOfTrees() {
  for (const t of world.trees) {
    const dx = P.pos.x - t.x, dz = P.pos.z - t.z;
    const lim = t.r + 1.2;
    if (Math.abs(dx) > lim || Math.abs(dz) > lim || Math.abs(P.pos.y - t.y) > 3) continue;
    const d = Math.hypot(dx, dz), min = t.r + 0.35;
    if (d < min && d > 1e-4) { P.pos.x = t.x + (dx / d) * min; P.pos.z = t.z + (dz / d) * min; P.pos.y = gy(P.pos.x, P.pos.z); }
  }
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ---------------- survival, hazards, events ----------------
const showStatus = {};
function updateSurvival(dt) {
  if (P.isDown) {
    P.downT -= dt;
    $('#downTxt').textContent = `A teammate can help you up. Respawning at the campfire in ${Math.max(0, Math.ceil(P.downT))} s.`;
    if (P.downT <= 0) giveUp();
    return;
  }
  const y = P.mode === 'climb' ? world.T.height(P.cx, P.cz) : P.pos.y;
  const band = bandAt(y);
  if (band !== lastBand && P.wakeT <= 0) {
    if (lastBand && BANDS.indexOf(band) > BANDS.indexOf(lastBand)) { zoneCard(band.name, ZONE_SUB[band.id]); sfx.ding(); }
    lastBand = band;
  }
  stats.maxAlt = Math.max(stats.maxAlt, y);
  S.hunger = Math.min(1, S.hunger + dt / (band.id === 'crown' ? 620 : 800));
  const me = myPos();
  const nearFire = world.camps.some((c) => c.lit && c.pos.distanceTo(me) < 7);
  showStatus.fire = nearFire;
  if (nearFire) { S.cold = Math.max(0, S.cold - 0.1 * dt); S.injury = Math.max(0, S.injury - 0.006 * dt); }
  else if (band.id === 'frost') S.cold = Math.min(1, S.cold + (blizzard.on ? 0.013 : 0.0045) * dt);
  else if (band.id === 'crown') S.cold = Math.min(1, S.cold + 0.0028 * dt);
  else S.cold = Math.max(0, S.cold - 0.02 * dt);

  showStatus.thorns = false;
  if (P.mode === 'ground' && band.id === 'moss') {
    for (const t of world.thorns) {
      if (Math.hypot(P.pos.x - t.pos.x, P.pos.z - t.pos.z) < t.r && Math.abs(P.pos.y - t.pos.y) < 2) {
        S.injury = Math.min(1, S.injury + 0.05 * dt);
        showStatus.thorns = true;
        toastOnce('thorn', 'Thornbrush! Get out of it.', 5);
      }
    }
  }
  blizzard.t -= dt;
  if (blizzard.t <= 0) {
    blizzard.on = !blizzard.on;
    blizzard.t = blizzard.on ? 22 : 50 + Math.random() * 35;
    if (blizzard.on && band.id === 'frost') { toast('❄ A blizzard rolls in. Find a fire or a warmer!'); sfx.gust(); }
  }
  blizzard.k += ((blizzard.on && band.id === 'frost' ? 1 : 0) - blizzard.k) * Math.min(1, dt * 0.8);
  gust.t -= dt;
  if (gust.t <= 0) {
    gust.on = !gust.on;
    gust.t = gust.on ? 2.4 : 7 + Math.random() * 6;
    if (gust.on) {
      const a = Math.random() * Math.PI * 2;
      gust.dir.set(Math.cos(a), 0, Math.sin(a));
      if (band.id === 'crown') { sfx.gust(); toastOnce('gust', '💨 Gust! Hold on tight!', 3); }
    }
  }
  gust.k += ((gust.on ? 1 : 0) - gust.k) * Math.min(1, dt * 4);
  if (S.hunger > 0.5) toastOnce('hungry', 'Your stomach growls. Eat something.', 30);
  if (S.cold > 0.4) toastOnce('cold', 'You are freezing. Get warm.', 25);
  if (S.hunger + S.cold + S.injury >= 1) blackout('Everything goes dark…');
}

function blackout(msg) {
  if (state !== 'play' || P.isDown) return;
  stats.blackouts++;
  if (coop.on && coop.remotes.size > 0) {
    P.isDown = true;
    P.downT = 25;
    sfx.blackout();
    toast(msg);
    net.send({ t: 'down' });
    $('#downbox').classList.remove('hidden');
    return;
  }
  respawnAtCamp(msg);
}
function giveUp() {
  if (!P.isDown) return;
  P.isDown = false;
  $('#downbox').classList.add('hidden');
  net.send({ t: 'up' });
  respawnAtCamp('Everything goes dark…');
}
function revived(byName) {
  if (!P.isDown) return;
  P.isDown = false;
  $('#downbox').classList.add('hidden');
  S.cold = 0;
  S.injury = Math.min(S.injury, 0.2);
  S.hunger = Math.min(S.hunger, 0.4);
  S.stamina = maxSt() * 0.5;
  net.send({ t: 'up' });
  sfx.pickup();
  toast(`🤝 ${byName} helped you up!`);
}
function respawnAtCamp(msg) {
  state = 'dead';
  sfx.blackout();
  touch?.setGrab(false);
  $('#fadeTxt').textContent = msg;
  const f = $('#fade');
  f.classList.remove('hidden');
  f.style.animation = 'none';
  void f.offsetWidth;
  f.style.animation = '';
  setTimeout(() => {
    inv.fill(null);
    renderInv();
    S.cold = 0;
    S.injury = Math.min(S.injury, 0.2);
    S.hunger = Math.min(S.hunger, 0.4);
    S.stamina = maxSt();
    teleport(checkpoint);
    state = 'play';
    toast('You wake by the fire. Your pack is empty.');
  }, 1300);
  setTimeout(() => f.classList.add('hidden'), 2600);
}

function lightBeacon(by = null) {
  if (world.beacon.lit) return;
  world.beacon.lit = true;
  world.beacon.flame.visible = true;
  world.beacon.flagMat.color.setHex(0xff7a29);
  sfx.win();
  P.isDown = false;
  $('#downbox').classList.add('hidden');
  $('#pause').classList.add('hidden');
  pausedFrom = 'play';
  state = 'won';
  playEmote(climber, 'cheer');
  document.exitPointerLock?.();
  const best = store.get('best', null);
  const isBest = best === null || elapsed < best;
  if (isBest) store.set('best', elapsed);
  setTimeout(() => {
    const dl = $('#resList');
    dl.replaceChildren();
    const row = (k, v, cls) => {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v; if (cls) dd.className = cls;
      dl.append(dt, dd);
    };
    row('Climb time', fmtTime(elapsed), isBest ? 'best' : '');
    row('Best time', fmtTime(isBest ? elapsed : best), 'best');
    row('Summit altitude', `${Math.round(world.beacon.pos.y)} m`);
    row('Hard falls', String(stats.falls));
    row('Blackouts', String(stats.blackouts));
    row('Snacks eaten', String(stats.eaten));
    row('Pitons · ropes', `${stats.pitons} · ${stats.ropes}`);
    row('Mountain', `#${world.seed}`);
    if (isBest) row('', '★ New personal best!', 'best');
    const team = [...coop.remotes.values()].map((r) => r.name);
    $('#resTeam').textContent = coop.on ? `${by ? `${by} lit the beacon. ` : ''}${team.length ? `Climbed with ${team.join(', ')}.` : ''}` : '';
    $('#btnAgain').textContent = coop.on ? 'Back to the menu' : 'Fly again';
    $('#btnNew2').classList.toggle('hidden', coop.on);
    $('#hud').classList.add('hidden');
    if (touch) $('#touch').classList.add('hidden');
    $('#results').classList.remove('hidden');
  }, 2200);
}

// ---------------- airport → flight → crash ----------------
function board() {
  if (state !== 'lobby') return;
  if (coop.on) { net.send({ t: 'board' }); return; }
  startFlight();
}
let flight = null;
function startFlight() {
  if (state !== 'lobby') return;
  closeWardrobe();
  state = 'flight';
  document.exitPointerLock?.();
  $('#hud').classList.add('hidden');
  $('#flightui').classList.remove('hidden');
  if (touch) $('#touch').classList.add('hidden');
  const dir = new V3(world.spawn.x, 0, world.spawn.z).normalize();
  const crash = world.wreckOrigin.clone();
  flight = { t: 0, crash, start: dir.clone().multiplyScalar(COAST + 620).add(new V3(0, 120, 0)), mid: dir.clone().multiplyScalar(COAST + 170).add(new V3(0, 70, 0)), caption: -1, crashed: false };
  flightPlane.visible = true;
  flightPlane.position.copy(flight.start);
  camera.position.copy(flight.start).add(new V3(30, 10, 30));
  clearPlaneSmoke();
  planeSmoke.push(new Smoke(scene, flight.start, { count: 30, size: 3.5, color: 0x3a3532, rise: 0.6, life: 3, spread: 1 }));
  sfx.ding();
}
function clearPlaneSmoke() {
  for (const s of planeSmoke) s.sprites.forEach((k) => { k.removeFromParent(); k.material.dispose(); });
  planeSmoke.length = 0;
}
const CAPTIONS = [
  [0, 'Flight HC 207 · Cruising over the Saltwind Sea'],
  [3.4, '⚠ Engine failure!'],
  [6.2, 'Brace! Brace! Brace!'],
];
function updateFlight(dt) {
  const f = flight;
  f.t += dt;
  const t = f.t;
  let pos;
  if (t < 6) { pos = f.start.clone().lerp(f.mid, t / 6); pos.y += Math.sin(t * 0.8) * 1.5 - (t > 3.4 ? (t - 3.4) * 4 : 0); }
  else { const k = Math.min(1, (t - 6) / 2.4); pos = f.mid.clone().lerp(f.crash.clone().add(new V3(0, 2, 0)), k * k); }
  const ahead = t < 6 ? f.mid : f.crash;
  flightPlane.position.copy(pos);
  flightPlane.lookAt(ahead.x, pos.y - (t > 3.4 ? 12 : 0), ahead.z);
  flightPlane.rotateZ(t > 3.4 ? Math.sin(t * 9) * 0.12 * Math.min(1, t - 3.4) : Math.sin(t) * 0.04);
  for (const s of planeSmoke) {
    s.origin.copy(flightPlane.localToWorld(new V3(5.4, -1.6, -2)));
    s.update(dt, 0);
    s.sprites.forEach((k) => { if (t < 3.4) k.material.opacity = 0; });
  }
  const capIdx = CAPTIONS.findLastIndex((c) => t >= c[0]);
  if (capIdx !== f.caption) {
    f.caption = capIdx;
    const el = $('#caption');
    el.textContent = CAPTIONS[capIdx][1];
    el.classList.toggle('alarm', capIdx > 0);
    if (capIdx === 1) { sfx.gust(); sfx.hurt(); }
  }
  const back = flightPlane.localToWorld(new V3(10, 5, -30));
  camera.position.lerp(back, 1 - Math.exp(-4 * dt));
  const sh = t > 3.4 ? Math.min(1, (t - 3.4) / 3) * 0.6 : 0.03;
  camera.position.x += (Math.random() - 0.5) * sh;
  camera.position.y += (Math.random() - 0.5) * sh;
  camera.lookAt(pos);
  sfx.zone({ engine: t < 8.4 ? 1 : 0, surf: 0.3 }, dt);
  updateSkyFor(pos.y, false);
  if (t >= 8.4 && !f.crashed) {
    f.crashed = true;
    sfx.crash();
    $('#flash').classList.remove('hidden');
    setTimeout(wakeOnBeach, 900);
  }
}
function skipFlight() {
  if (state !== 'flight' || flight?.crashed) return;
  flight.crashed = true;
  sfx.crash();
  $('#flash').classList.remove('hidden');
  setTimeout(wakeOnBeach, 500);
}
function wakeOnBeach() {
  flightPlane.visible = false;
  clearPlaneSmoke();
  $('#flightui').classList.add('hidden');
  teleport(world.spawn);
  P.facing = 0;
  camYaw = Math.PI - 0.35; // facing the wreck down the beach
  camPitch = 0.22;
  P.wakeT = 2;
  elapsed = 0;
  lastBand = null;
  state = 'play';
  showHud();
  if (touch) $('#touch').classList.remove('hidden');
  sfx.zone({ engine: 0 }, 0);
  setTimeout(() => $('#flash').classList.add('hidden'), 1600);
  setTimeout(() => {
    zoneCard('Saltwind Shore', 'You survived the crash! Grab supplies from the wreck and head for the summit.');
    sfx.ding();
  }, 1200);
  if (!isTouch) canvas.requestPointerLock?.();
}

// ---------------- camera ----------------
const camTarget = new V3();
function updateCamera(dt) {
  if (state === 'title') {
    const t = (performance.now() / 1000) * 0.05;
    camera.position.set(Math.cos(t) * 600, 190, Math.sin(t) * 600);
    camera.lookAt(0, 80, 0);
    climber.visible = false;
    return;
  }
  const inLobby = state === 'lobby' || (state === 'paused' && pausedFrom === 'lobby');
  camTarget.copy(P.render).add(new V3(0, 1.5, 0));
  const fwd = new V3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
  let dist = inLobby ? 4.2 : 5;
  if (overlayOpen()) dist = 3.2;
  const dir = new V3(-fwd.x * Math.cos(camPitch), Math.sin(camPitch), -fwd.z * Math.cos(camPitch));
  if (!inLobby) {
    for (let i = 1; i <= 14; i++) {
      const t = (i / 14) * dist;
      const p = camTarget.clone().addScaledVector(dir, t);
      if (world.T.height(p.x, p.z) + 0.35 > p.y) { dist = Math.max(0.6, t * 0.85); break; }
    }
  }
  camera.position.copy(camTarget).addScaledVector(dir, dist);
  if (inLobby) {
    const B = lobby.bounds;
    camera.position.x = clamp(camera.position.x, B.minX - 0.3, B.maxX + 0.3);
    camera.position.z = clamp(camera.position.z, B.minZ - 0.3, B.maxZ + 0.3);
    camera.position.y = clamp(camera.position.y, LOBBY_FLOOR + 0.4, LOBBY_FLOOR + lobby.height - 0.4);
  } else {
    const floor = Math.max(world.T.height(camera.position.x, camera.position.z), 0) + 0.3;
    if (camera.position.y < floor) camera.position.y = floor;
  }
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.4;
    camera.position.y += (Math.random() - 0.5) * shake * 0.4;
    shake = Math.max(0, shake - dt * 2);
  }
  camera.lookAt(camTarget);
  climber.visible = camera.position.distanceTo(camTarget) > 0.9;
}

// ---------------- scene update ----------------
const stormFog = new THREE.Color(0xe8eef5);
function updateSkyFor(y, indoor) {
  const c = bandSkyColors(y);
  const storm = indoor ? 0 : blizzard.k;
  c.fog.lerp(stormFog, storm);
  sky.uniforms.top.value.copy(c.sky);
  sky.uniforms.horizon.value.copy(c.fog);
  scene.fog.color.copy(c.fog);
  if (env) {
    // Re-bake the environment when the sky noticeably changes (zone change, storm, indoors).
    const key = `${c.sky.getHexString()}${c.fog.getHexString()}`.replace(/(.)./g, '$1');
    if (key !== envKey) { envKey = key; scene.environment = env.update(); }
  }
  scene.fog.near = indoor ? 120 : 80 - storm * 74;
  scene.fog.far = indoor ? 900 : 900 - storm * 840;
  sky.mesh.position.copy(camera.position);
}

function updateScene(dt, now) {
  shared.time.value = now;
  const inLobby = state === 'lobby' || (state === 'paused' && pausedFrom === 'lobby');
  if (state !== 'flight') updateSkyFor(state === 'title' ? 60 : inLobby ? 10 : camera.position.y, inLobby);
  clouds.rotation.y += dt * 0.004;
  water.position.x = Math.round(camera.position.x / 40) * 40;
  water.position.z = Math.round(camera.position.z / 40) * 40;
  const focus = state === 'title' ? new V3(0, 60, 0) : state === 'flight' ? flightPlane.position : P.render;
  sun.position.copy(focus).add(new V3(70, 110, 45));
  sun.target.position.copy(focus);

  if (world) {
    const band = bandAt(camera.position.y);
    const pm = world.particles.material;
    const embers = band.id === 'crown' && onIsland();
    const want = !onIsland() ? 0 : band.id === 'frost' ? 0.35 + blizzard.k * 0.6 : embers ? 0.6 : 0;
    pm.opacity += (want - pm.opacity) * Math.min(1, dt * 2);
    pm.color.setHex(embers ? 0xff9a4a : 0xffffff);
    pm.size = embers ? 0.12 : 0.18;
    world.particles.visible = pm.opacity > 0.02;
    if (world.particles.visible) {
      const arr = world.particles.geometry.attributes.position.array;
      const fall = embers ? -1.2 : 3 + blizzard.k * 5;
      const wx = (embers ? gust.dir.x * 4 * gust.k : 2 + blizzard.k * 9) * dt, wz = (embers ? gust.dir.z * 4 * gust.k : 0.5) * dt;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] += wx; arr[i + 2] += wz; arr[i + 1] -= fall * dt;
        if (arr[i + 1] < -5) arr[i + 1] += 30;
        if (arr[i + 1] > 25) arr[i + 1] -= 30;
        if (arr[i] > 25) arr[i] -= 50;
        if (arr[i] < -25) arr[i] += 50;
        if (arr[i + 2] > 25) arr[i + 2] -= 50;
        if (arr[i + 2] < -25) arr[i + 2] += 50;
      }
      world.particles.geometry.attributes.position.needsUpdate = true;
      world.particles.position.set(camera.position.x, camera.position.y - 10, camera.position.z);
    }
    for (const s of world.smokes) if (s.origin.distanceTo(camera.position) < 420) s.update(dt, 0.4 + gust.k * 2);
    for (const it of world.items) {
      if (it.taken) continue;
      if (Math.abs(it.pos.x - P.pos.x) > 120 || Math.abs(it.pos.z - P.pos.z) > 120) { it.mesh.visible = false; continue; }
      it.mesh.visible = true;
      it.mesh.position.y = it.pos.y + 0.45 + Math.sin(now * 2 + it.phase) * 0.08;
      it.mesh.rotation.y += dt * 1.2;
    }
    let nearest = null, nd = 1e9;
    for (const c of [...world.camps, world.beacon]) {
      c.flag.rotation.y = Math.sin(now * 2.3 + c.pos.x) * 0.35;
      if (c.lit) {
        c.flame.scale.set(1 + Math.sin(now * 17) * 0.06, 1 + Math.sin(now * 11 + 1) * 0.12, 1 + Math.cos(now * 15) * 0.06);
        const d = c.pos.distanceTo(P.render);
        if (d < nd) { nd = d; nearest = c; }
      }
    }
    for (const f of world.flares) f.glow.material.opacity = 0.75 + Math.sin(now * 23 + f.p.x) * 0.25;
    world.gulls.update(now);
    if (world.marks.beam) world.marks.beam.rotation.y = now * 0.6;
    if (nearest && nd < 40 && onIsland()) {
      fireLight.position.copy(nearest.pos).add(new V3(0, nearest.isBeacon ? 4.5 : 1, 0));
      fireLight.intensity = (nearest.isBeacon ? 40 : 14) * (0.85 + Math.sin(now * 13) * 0.15);
      fireLight.distance = nearest.isBeacon ? 30 : 16;
    } else fireLight.intensity = 0;
    if (onIsland()) {
      const y = P.render.y;
      sfx.zone({ surf: clamp(1 - y / 30, 0, 1), birds: y > 36 && y < 126 ? 1 : 0, rumble: y > 210 ? 1 : 0 }, dt);
      sfx.ambience(clamp((y - 20) / 260, 0.05, 0.4) + blizzard.k * 0.3 + gust.k * (y > 216 ? 0.3 : 0), nearest && nd < 12 ? 0.25 * (1 - nd / 12) : 0);
    }
  }
  if (inLobby) { sfx.zone({ hum: 1 }, dt); sfx.ambience(0, 0); }
  if (state === 'title') { sfx.zone({ surf: 0.4 }, dt); sfx.ambience(0.08, 0); }

  if (state !== 'title' && state !== 'flight') {
    const target = P.mode === 'climb' && onIsland() ? climberWorldPos() : P.pos;
    if (P.render.distanceTo(target) > 6) P.render.copy(target);
    P.render.lerp(target, 1 - Math.exp(-20 * dt));
    climber.position.copy(P.render);
    const mode = P.isDown || P.wakeT > 0 ? 'down' : P.mode;
    poseClimber(climber, mode, P.facing, P.anim, dt, P.moveAmt);
  } else climber.visible = false;
}

// ---------------- HUD ----------------
let hudAcc = 0;
const bearingTo = (x, z) => Math.atan2(x - P.pos.x, -(z - P.pos.z));
function showHud() {
  $('#hud').classList.remove('hidden');
  $('#hud').classList.toggle('lobbyhud', state === 'lobby');
}
function updateHud(dt) {
  hudAcc += dt;
  if (state === 'play') {
    const ms = maxSt();
    $('#bSt').style.width = `${(Math.min(S.stamina, ms) * 100).toFixed(1)}%`;
    $('#bar').classList.toggle('low', S.stamina < 0.2 && (P.mode === 'climb' || P.mode === 'rope'));
    $('#bHun').style.width = `${(S.hunger * 100).toFixed(1)}%`;
    $('#bCold').style.width = `${(S.cold * 100).toFixed(1)}%`;
    $('#bInj').style.width = `${(S.injury * 100).toFixed(1)}%`;
  }
  if (hudAcc < 0.1) return;
  hudAcc = 0;
  const lobbyMode = state === 'lobby';
  $('#hud').classList.toggle('lobbyhud', lobbyMode);
  let prompt = '';
  let act = '';
  const key = isTouch ? '' : '[E] ';

  if (lobbyMode) {
    $('#zone').textContent = 'Terminal · Gate 7';
    $('#alt').textContent = 'Flight HC 207';
    $('#timer').textContent = coop.on ? 'Board when your crew is ready' : 'Walk to Gate 7 to board';
    const dx = lobby.gate.x - P.pos.x, dz = lobby.gate.z - P.pos.z;
    $('#goalTxt').textContent = `Gate 7 · ${Math.round(Math.hypot(dx, dz))} m`;
    $('#goalArrow').style.display = '';
    $('#goalArrow').style.transform = `rotate(${Math.atan2(dx, -dz) + camYaw}rad)`;
    $('#compass').classList.add('hidden');
    if (P.pos.distanceTo(lobby.wardrobe) < 3) { prompt = `${key}Change your outfit`; act = 'Outfit'; }
    else if (P.pos.distanceTo(lobby.gate) < 3.5) { prompt = coop.on ? `${key}Board flight HC 207 (the whole room flies)` : `${key}Board flight HC 207`; act = 'Board'; }
  } else if (world && onIsland()) {
    const T = world.T;
    const y = P.mode === 'climb' ? T.height(P.cx, P.cz) : P.pos.y;
    $('#zone').textContent = zoneName(y);
    $('#alt').textContent = `${Math.max(0, Math.round(y))} m`;
    $('#timer').textContent = `⏱ ${fmtTime(elapsed)}`;
    const next = world.camps.find((c) => !c.lit && c.pos.y > y - 20) ?? world.beacon;
    const up = Math.round(next.pos.y - y);
    const hasCompass = inv.includes('compass');
    $('#goalTxt').textContent = `${next.isBeacon ? 'Summit beacon' : 'Next campfire'} · ${up > 0 ? `${up} m up` : `${Math.round(Math.hypot(next.pos.x - P.pos.x, next.pos.z - P.pos.z))} m away`}`;
    $('#goalArrow').style.display = 'none';
    $('#compass').classList.toggle('hidden', !hasCompass);
    if (hasCompass) {
      const camB = -camYaw;
      const PX = isTouch ? 1.3 : 2.2;
      const place = (el, b) => {
        let rel = ((b - camB) * 180) / Math.PI;
        rel = ((rel % 360) + 540) % 360 - 180;
        el.style.display = Math.abs(rel) > 85 ? 'none' : '';
        el.style.left = `calc(50% + ${(rel * PX).toFixed(1)}px)`;
      };
      document.querySelectorAll('#compassTape .dir').forEach((el) => place(el, (Number(el.dataset.b) * Math.PI) / 180));
      place($('#cmpGoal'), bearingTo(next.pos.x, next.pos.z));
      $('#cmpGoal').textContent = next.isBeacon ? '🔥' : '⛺';
    }

    const st = $('#status');
    st.replaceChildren();
    const tag = (txt, cls) => { const s = document.createElement('span'); s.textContent = txt; s.className = cls; st.appendChild(s); };
    if (blizzard.k > 0.3) tag('❄ Blizzard', 'warn');
    if (gust.on && bandAt(y).id === 'crown') tag('💨 Gust', 'hot');
    if (showStatus.fire) tag('🔥 Warming up', 'good');
    if (showStatus.piton) tag('📌 Resting', 'good');
    if (showStatus.thorns) tag('🌿 Thorns!', 'hot');
    if (S.boostT > 0) tag('🧃 Fizz', 'good');
    if (P.mode === 'rope') tag('🪢 On a rope', 'good');
    showStatus.piton = false;

    const me = myPos();
    if (coop.on && !P.isDown) {
      const downMate = [...coop.remotes.values()].find((r) => r.st?.m === 'down' && r.pos.distanceTo(me) < 2.8);
      const pullMate = pullTarget();
      if (downMate) { prompt = `${key}Help ${downMate.name} up`; act = 'Help'; }
      else if (pullMate) { prompt = `${key}Pull ${pullMate.name} up`; act = 'Pull'; }
    }
    if (prompt || P.isDown || P.wakeT > 0) { /* already set */ }
    else if (world.items.some((it) => !it.taken && it.mesh.position.distanceTo(me) < 3)) { prompt = `${key}Pick up`; act = 'Take'; }
    else if (world.camps.some((c) => !c.lit && c.pos.distanceTo(me) < 3.6)) { prompt = `${key}Light the campfire`; act = 'Light'; }
    else if (!world.beacon.lit && world.beacon.pos.distanceTo(me) < 4.5) { prompt = `${key}Light the summit beacon!`; act = 'Light'; }
    else if (P.mode === 'climb') prompt = isTouch ? 'Tap ✋ to let go · ⤒ to lunge' : 'Release to let go · Space to lunge';
    else if (P.mode === 'rope') prompt = isTouch ? 'Stick up/down to climb the rope' : 'W/S to climb the rope';
    else if (P.mode === 'ground') {
      const f = new V3(Math.sin(P.facing), 0, Math.cos(P.facing));
      const h = T.height(P.pos.x + f.x * 0.9, P.pos.z + f.z * 0.9);
      if (h > P.pos.y + 1.2 && T.normal(P.pos.x + f.x * 0.9, P.pos.z + f.z * 0.9, tmpN).y < WALL_NY) prompt = isTouch ? 'Turn on ✋ Grab to climb' : 'Hold left mouse to climb';
    }
  }
  if (overlayOpen()) prompt = '';
  $('#prompt').textContent = prompt;
  $('#prompt').classList.toggle('hidden', !prompt);
  touch?.setAct(P.isDown ? 'Respawn' : act);

  const ri = $('#roominfo');
  ri.classList.toggle('hidden', !coop.on);
  if (coop.on) {
    ri.replaceChildren();
    const head = document.createElement('div');
    head.className = 'rhead';
    head.append('Room ');
    const code = document.createElement('span'); code.className = 'code'; code.textContent = coop.code;
    head.append(code, ` · ${coop.remotes.size + 1}/4`);
    ri.append(head);
    const line = (name, c, txt) => {
      const d = document.createElement('div'); d.className = 'pl';
      const n = document.createElement('span');
      const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = `#${OUTFITS[c].toString(16).padStart(6, '0')}`;
      n.append(sw, name);
      const t = document.createElement('i'); t.textContent = txt;
      d.append(n, t); ri.append(d);
    };
    const tagTxt = (m, alt, lob) => (lob ? 'in terminal' : m === 'down' ? '💤 down' : `${m === 'climb' || m === 'rope' ? '🧗 ' : ''}${Math.max(0, Math.round(alt))} m`);
    const myAlt = P.mode === 'climb' && world ? world.T.height(P.cx, P.cz) : P.pos.y;
    line('You', look.c, tagTxt(P.isDown ? 'down' : P.mode, myAlt, lobbyMode));
    for (const r of coop.remotes.values()) line(r.name, r.look.c, r.st ? tagTxt(r.st.m, r.st.alt, r.st.l) : '…');
  }
}

// ---------------- wardrobe ----------------
function buildWardrobeUi() {
  const wrap = $('#wSections');
  wrap.replaceChildren();
  for (const sec of WARDROBE) {
    const label = document.createElement('div');
    label.className = 'wlabel';
    label.textContent = sec.label;
    const row = document.createElement('div');
    row.className = 'swatches';
    sec.items.forEach((v, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      if (sec.type === 'color') {
        b.style.background = `#${v.toString(16).padStart(6, '0')}`;
        const name = sec.names ? sec.names[i] : `${sec.label} ${i + 1}`;
        b.title = name;
        b.setAttribute('aria-label', name);
      } else {
        b.classList.add('wide');
        b.textContent = v;
      }
      b.classList.toggle('on', look[sec.key] === i);
      b.addEventListener('click', () => { look = { ...look, [sec.key]: i }; applyLook(); markWardrobe(); sfx.click(); });
      row.appendChild(b);
    });
    wrap.append(label, row);
  }
}
function markWardrobe() {
  const rows = $('#wSections').querySelectorAll('.swatches');
  WARDROBE.forEach((sec, k) => rows[k]?.querySelectorAll('.swatch').forEach((b, i) => b.classList.toggle('on', look[sec.key] === i)));
}
function applyLook() {
  store.set('look', look);
  const pos = climber.position.clone();
  scene.remove(climber);
  disposeClimber(climber);
  climber = makeClimber(look, { shadows: Q.shadows });
  climber.position.copy(pos);
  scene.add(climber);
  if (coop.on) net.send({ t: 'look', look });
}
function openWardrobe() {
  buildWardrobeUi();
  $('#wardrobe').classList.remove('hidden');
  if (touch) $('#touch').classList.add('hidden');
  document.exitPointerLock?.();
  keys.clear();
  // Stand in front of the mirror, facing the camera, so you can see the outfit.
  if (state === 'lobby') { P.pos.set(lobby.wardrobe.x, LOBBY_FLOOR, lobby.wardrobe.z + 2.2); P.render.copy(P.pos); }
  P.facing = 0;
  camYaw = -0.35;
  camPitch = 0.08;
}
function closeWardrobe() {
  if (!overlayOpen()) return;
  $('#wardrobe').classList.add('hidden');
  if (touch && (state === 'lobby' || state === 'play')) $('#touch').classList.remove('hidden');
  if (!isTouch && (state === 'lobby' || state === 'play')) canvas.requestPointerLock?.();
}
$('#wDone').addEventListener('click', closeWardrobe);
$('#wRandom').addEventListener('click', () => { look = validLook(randomLook()); applyLook(); markWardrobe(); sfx.click(); });

// ---------------- co-op ----------------
const net = new HNet();
const coop = { on: false, code: null, remotes: new Map(), pending: new Set(), sendAcc: 0 };

function addRemote(p) {
  if (coop.remotes.has(p.cid) || p.cid === net.you?.cid) return;
  const lk = validLook(p.look);
  const model = makeClimber(lk, { shadows: Q.shadows });
  model.visible = false;
  scene.add(model);
  const tag = makeTag(p.name);
  const help = makeTag('💤 Help me up!', 'rgba(150,30,40,0.85)');
  tag.visible = help.visible = false;
  scene.add(tag, help);
  coop.remotes.set(p.cid, { cid: p.cid, name: p.name, look: lk, model, st: null, pos: new V3(), facing: 0, anim: 0, tag, help });
}
function setRemoteLook(cid, lk) {
  const r = coop.remotes.get(cid);
  if (!r) return;
  r.look = validLook(lk);
  scene.remove(r.model);
  disposeClimber(r.model);
  r.model = makeClimber(r.look, { shadows: Q.shadows });
  r.model.visible = false;
  scene.add(r.model);
}
function removeRemote(cid) {
  const r = coop.remotes.get(cid);
  if (!r) return;
  scene.remove(r.model);
  disposeClimber(r.model);
  for (const o of [r.tag, r.help]) { scene.remove(o); o.material.map.dispose(); o.material.dispose(); }
  coop.remotes.delete(cid);
}
const clearRemotes = () => { for (const cid of [...coop.remotes.keys()]) removeRemote(cid); };
const nameOf = (cid) => coop.remotes.get(cid)?.name ?? 'A teammate';

function updateRemotes(dt) {
  const k = 1 - Math.exp(-12 * dt);
  const hide = state === 'flight' || state === 'title';
  for (const r of coop.remotes.values()) {
    if (!r.st) continue;
    const target = new V3(r.st.p[0], r.st.p[1], r.st.p[2]);
    if (!r.model.visible || r.pos.distanceTo(target) > 10) r.pos.copy(target);
    const before = r.pos.clone();
    r.pos.lerp(target, k);
    const moved = before.distanceTo(r.pos);
    r.anim += moved * (r.st.m === 'climb' ? 3.4 : 2.2);
    r.facing = lerpAngle(r.facing, r.st.f, k);
    r.model.position.copy(r.pos);
    poseClimber(r.model, r.st.m, r.facing, r.anim, dt, clamp(moved / Math.max(dt, 1e-3) / WALK, 0, 1));
    const down = r.st.m === 'down';
    r.model.visible = !hide;
    r.tag.visible = !hide;
    r.tag.position.copy(r.pos).add(new V3(0, down ? 1.0 : 2.1, 0));
    r.help.visible = down && !hide;
    r.help.position.copy(r.pos).add(new V3(0, 1.6, 0));
  }
}

function pullTarget() {
  if (!coop.on || P.mode !== 'ground' || P.isDown) return null;
  for (const r of coop.remotes.values()) {
    if (r.st?.m !== 'climb') continue;
    const hd = Math.hypot(r.pos.x - P.pos.x, r.pos.z - P.pos.z);
    const dy = P.pos.y - r.pos.y;
    if (hd < 2.6 && dy > 0.3 && dy < 3.4) return r;
  }
  return null;
}

function coopInteract(me) {
  for (const r of coop.remotes.values()) {
    if (r.st?.m === 'down' && r.pos.distanceTo(me) < 2.8) {
      net.send({ t: 'revive', to: r.cid });
      toast(`🤝 Helping ${r.name} up…`);
      return true;
    }
  }
  const pr = pullTarget();
  if (pr) {
    net.send({ t: 'pull', to: pr.cid, p: [P.pos.x, P.pos.y, P.pos.z] });
    S.stamina = Math.max(0, S.stamina - 0.1);
    sfx.grab();
    toast(`💪 You haul ${pr.name} up!`);
    return true;
  }
  return false;
}

function applyLayout(items, camps) {
  for (const it of world.items) {
    world.root.remove(it.mesh);
    it.mesh.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }
  world.items = items.map(([id, type, x, y, z, taken]) => {
    const it = spawnItem(world.root, type, new V3(x, y, z));
    it.id = id;
    if (taken) { it.taken = true; it.mesh.visible = false; }
    return it;
  });
  (camps || []).forEach((p, i) => {
    const c = world.camps[i];
    if (c && !c.lit) { c.pos.set(p[0], p[1], p[2]); c.group.position.copy(c.pos); }
  });
}

function enterRoom(m) {
  clearRemotes();
  coop.on = true;
  coop.code = m.code;
  coop.pending.clear();
  resetRun(true, m.seed);
  for (const p of m.players) addRemote(p);
  for (const [cid, st] of Object.entries(m.states || {})) { const r = coop.remotes.get(Number(cid)); if (r) r.st = st; }
  if (m.layout) applyLayout(m.layout.items, m.layout.camps);
  else net.send({ t: 'layout', items: world.items.map((i) => [i.type, i.pos.x, i.pos.y, i.pos.z]), camps: world.camps.map((c) => [c.pos.x, c.pos.y, c.pos.z]) });
  for (const i of m.lit || []) if (world.camps[i]) lightCamp(world.camps[i], null, true);
  for (const p of m.pitons || []) addPiton(new V3(p[0], p[1], p[2]));
  for (const r of m.ropes || []) addRope(new V3(...r[0]), new V3(...r[1]), new V3(...r[2]));
  for (const p of m.flares || []) addFlare(new V3(p[0], p[1], p[2]));
  if (m.beacon) { world.beacon.lit = true; world.beacon.flame.visible = true; }
  net.send({ t: 'look', look });
  try { history.replaceState(null, '', `?room=${m.code}`); } catch { /* ignore */ }
  setCoopUi();
  hideMenus();
  if (m.boarded) {
    state = 'lobby';
    toast('Your crew already flew. Catching up on the beach…');
    wakeOnBeach();
  } else {
    toLobby();
    state = 'lobby';
    showHud();
    if (touch) $('#touch').classList.remove('hidden');
    if (!isTouch) canvas.requestPointerLock?.();
  }
  toast(`Room ${m.code}: share this code so friends can join.`);
}

function leaveCoopLocal() {
  coop.on = false;
  coop.code = null;
  coop.pending.clear();
  clearRemotes();
  if (P.isDown) { P.isDown = false; $('#downbox').classList.add('hidden'); }
  try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
  setCoopUi();
}
function leaveCoop() {
  net.leave();
  leaveCoopLocal();
  resetRun(true);
}
function setCoopUi() {
  $('#btnRestart').classList.toggle('hidden', coop.on);
  $('#btnLeave').classList.toggle('hidden', !coop.on);
  $('#roominfo').classList.toggle('hidden', !coop.on);
}

net.addEventListener('msg', (e) => {
  const m = e.detail;
  if (!world || !coop.on) return;
  const mine = m.by === net.you?.cid;
  switch (m.t) {
    case 'joined': addRemote(m.player); toast(`👋 ${m.player.name} joined`); break;
    case 'left': toast(`${nameOf(m.cid)} left the room`); removeRemote(m.cid); break;
    case 'st': { const r = coop.remotes.get(m.cid); if (r) r.st = m; break; }
    case 'look': setRemoteLook(m.cid, m.look); break;
    case 'emote': { const r = coop.remotes.get(m.cid); if (r) playEmote(r.model, m.e); break; }
    case 'layout': applyLayout(m.items, m.camps); break;
    case 'board':
      if (state === 'paused' && pausedFrom === 'lobby') { $('#pause').classList.add('hidden'); state = 'lobby'; }
      if (state === 'lobby') { toast(mine ? 'Boarding…' : `${nameOf(m.by)} boarded the plane. Here we go!`); startFlight(); }
      break;
    case 'taken': {
      coop.pending.delete(m.id);
      const it = world.items.find((i) => i.id === m.id);
      if (it) { it.taken = true; it.mesh.visible = false; }
      if (mine) {
        const slot = inv[sel] === null ? sel : inv.indexOf(null);
        if (slot < 0) { net.send({ t: 'drop', type: m.type, p: [P.pos.x, gy(P.pos.x, P.pos.z), P.pos.z] }); toast('Your pack is full, so you set it down.'); }
        else giveItem(slot, m.type);
      }
      break;
    }
    case 'take_no': coop.pending.delete(m.id); toast('Someone else grabbed it first!'); break;
    case 'dropped': { const it = spawnItem(world.root, m.type, new V3(m.p[0], m.p[1], m.p[2])); it.id = m.id; world.items.push(it); break; }
    case 'camp': if (world.camps[m.i]) lightCamp(world.camps[m.i], mine ? null : nameOf(m.by)); break;
    case 'piton': addPiton(new V3(m.p[0], m.p[1], m.p[2])); break;
    case 'rope': addRope(new V3(...m.top), new V3(...m.bottom), new V3(...m.a)); toast(`🪢 ${nameOf(m.by)} hung a rope.`); break;
    case 'flare': addFlare(new V3(m.p[0], m.p[1], m.p[2])); toast(`🎇 ${nameOf(m.by)} planted a flare.`); break;
    case 'beacon': if (onIsland() && state !== 'won') lightBeacon(mine ? 'You' : m.name); break;
    case 'down': if (coop.remotes.has(m.cid)) toast(`💤 ${nameOf(m.cid)} is down! Get to them and press E.`); break;
    case 'revive': { const r = coop.remotes.get(m.from); if (P.isDown && r && (!r.st || new V3(r.st.p[0], r.st.p[1], r.st.p[2]).distanceTo(P.pos) < 9)) revived(r.name); break; }
    case 'pull': {
      const r = coop.remotes.get(m.from);
      if (!r || P.mode !== 'climb' || P.isDown || !m.p) break;
      const at = new V3(m.p[0], m.p[1], m.p[2]);
      if (at.distanceTo(climberWorldPos()) > 5.5) break;
      P.mode = 'ground';
      P.pos.set(at.x, gy(at.x, at.z), at.z);
      P.vel.set(0, 0, 0);
      P.regrabLock = 0.8;
      P.regenDelay = 0.4;
      sfx.grab();
      toast(`💪 ${r.name} pulled you up!`);
      break;
    }
  }
});
net.addEventListener('close', () => {
  if (!coop.on) return;
  leaveCoopLocal();
  toast('Lost the connection to the co-op room. You can keep playing solo.');
});

async function coopAction(kind) {
  const msg = $('#coopMsg');
  msg.className = 'small';
  sfx.unlock();
  const code = $('#roomCode').value.trim().toUpperCase();
  if (kind === 'join' && !/^[A-Z]{5}$/.test(code)) { msg.className = 'small err'; msg.textContent = 'Type the 5-letter room code.'; return; }
  msg.textContent = 'Connecting…';
  try {
    await net.connect();
    const m = kind === 'create' ? await net.create(world.seed) : await net.join(code);
    msg.textContent = '';
    enterRoom(m);
  } catch (err) {
    msg.className = 'small err';
    msg.textContent = err?.status === 401 ? 'Please sign in again.' : err?.message || 'Something went wrong.';
  }
}
$('#btnCreate').addEventListener('click', () => coopAction('create'));
$('#btnJoin').addEventListener('click', () => coopAction('join'));
$('#roomCode').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') coopAction('join'); });
$('#roomCode').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5); });

// ---------------- menus ----------------
function hideMenus() {
  for (const id of ['#title', '#pause', '#results', '#settings']) $(id).classList.add('hidden');
}
function showTitle() {
  state = 'title';
  hideMenus();
  $('#title').classList.remove('hidden');
  $('#hud').classList.add('hidden');
  $('#flightui').classList.add('hidden');
  $('#downbox').classList.add('hidden');
  $('#wardrobe').classList.add('hidden');
  if (touch) $('#touch').classList.add('hidden');
  const best = store.get('best', null);
  $('#bestRow').textContent = best === null ? 'No summit yet' : `Best summit time ${fmtTime(best)}`;
  $('#seedRow').textContent = world ? `Mountain #${world.seed}` : '';
}
function startSolo() {
  sfx.unlock();
  sfx.click();
  if (coop.on) leaveCoop();
  hideMenus();
  toLobby();
  state = 'lobby';
  showHud();
  if (touch) $('#touch').classList.remove('hidden');
  if (!isTouch) canvas.requestPointerLock?.();
  toastOnce('lobbyintro', 'Welcome to the airport! Walk to Gate 7 to board. Change your outfit at the Wardrobe.', 999);
}
function resume() {
  sfx.unlock();
  $('#pause').classList.add('hidden');
  state = pausedFrom;
  if (touch) $('#touch').classList.remove('hidden');
  if (!isTouch) canvas.requestPointerLock?.();
}
function pause() {
  if (state !== 'play' && state !== 'lobby') return;
  pausedFrom = state;
  state = 'paused';
  keys.clear();
  mouseGrab = false;
  $('#pause').classList.remove('hidden');
  $('#setVol').value = String(sfx.vol);
  $('#setSens').value = String(sens);
}
$('#btnPlay').addEventListener('click', startSolo);
$('#btnNew').addEventListener('click', () => { resetRun(false); $('#seedRow').textContent = `Mountain #${world.seed}`; sfx.unlock(); sfx.click(); });
$('#btnWardrobeTitle').addEventListener('click', () => { startSolo(); setTimeout(openWardrobe, 50); });
$('#btnSettings').addEventListener('click', () => { $('#settings').classList.remove('hidden'); syncSettings(); });
$('#btnSettings2').addEventListener('click', () => { $('#settings').classList.remove('hidden'); syncSettings(); });
$('#btnSetClose').addEventListener('click', () => $('#settings').classList.add('hidden'));
$('#btnResume').addEventListener('click', resume);
$('#btnRestart').addEventListener('click', () => { resetRun(true); startSolo(); });
$('#btnQuit').addEventListener('click', () => { if (coop.on) leaveCoop(); else resetRun(true); showTitle(); });
$('#btnLeave').addEventListener('click', () => { leaveCoop(); showTitle(); });
$('#btnAgain').addEventListener('click', () => { if (coop.on) { leaveCoop(); showTitle(); } else { resetRun(true); startSolo(); } });
$('#btnNew2').addEventListener('click', () => { resetRun(false); startSolo(); });
$('#btnPause').addEventListener('click', () => { if (isTouch) pause(); else document.exitPointerLock?.(); });
$('#btnGiveUp').addEventListener('click', () => giveUp());
$('#btnSkip').addEventListener('click', skipFlight);
addEventListener('keydown', (e) => { if (e.code === 'Escape' && state === 'paused') resume(); });

function syncSettings() {
  $('#setVol2').value = String(sfx.vol);
  $('#setSens2').value = String(sens);
  $('#setInvert').checked = !!invertY;
  $('#setQuality').value = store.get('qualityPref', 'auto');
  $('#qualityNow').textContent = `Now using: ${qName}`;
}
for (const id of ['#setVol', '#setVol2']) $(id).addEventListener('input', (e) => { sfx.setVolume(Number(e.target.value)); store.set('vol', sfx.vol); });
for (const id of ['#setSens', '#setSens2']) $(id).addEventListener('input', (e) => { sens = Number(e.target.value); store.set('sens', sens); });
$('#setInvert').addEventListener('change', (e) => { invertY = e.target.checked; store.set('invertY', invertY); });
$('#setQuality').addEventListener('change', (e) => {
  const v = e.target.value;
  store.set('qualityPref', v);
  try { localStorage.setItem('highcrag.quality', v); } catch { /* ignore */ }
  $('#qualityNow').textContent = 'Reload the page to apply.';
});
$('#btnReload').addEventListener('click', () => location.reload());

// Phones held upright: suggest turning sideways.
function checkRotate() {
  const phone = isTouch && Math.min(screen.width, screen.height) < 600;
  $('#rotate').classList.toggle('hidden', !(phone && innerHeight > innerWidth) || store.get('rotateDismissed', false));
}
$('#btnRotateOk').addEventListener('click', () => { store.set('rotateDismissed', true); checkRotate(); });
checkRotate();

{
  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam) $('#roomCode').value = roomParam.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
  HNet.me().then((u) => {
    $('#coopSignedOut').classList.toggle('hidden', !!u);
    $('#coopSignedIn').classList.toggle('hidden', !u);
    if (!u && roomParam) $('#coopMsg').textContent = `Sign in to join room ${$('#roomCode').value}.`;
  });
}

// ---------------- main loop ----------------
{
  const urlSeed = Number(new URLSearchParams(location.search).get('seed'));
  const seed = Number.isFinite(urlSeed) && urlSeed > 0 ? urlSeed >>> 0 : store.get('lastSeed', (Math.random() * 1e9) >>> 0);
  resetRun(true, seed);
}
toLobby();
showTitle();
$('#loading').classList.add('hidden');

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;
  if (state === 'play') {
    elapsed += dt;
    if (P.wakeT > 0) P.wakeT -= dt;
    updatePlayer(dt / 2);
    updatePlayer(dt / 2);
    updateSurvival(dt);
  } else if (state === 'lobby') updateLobbyPlayer(dt);
  else if (state === 'flight') updateFlight(dt);
  if (state === 'play' || state === 'lobby') updateHud(dt);
  if (coop.on && state !== 'title') {
    coop.sendAcc += dt;
    if (coop.sendAcc >= 1 / 12) {
      coop.sendAcc = 0;
      const alt = P.mode === 'climb' && world ? world.T.height(P.cx, P.cz) : P.pos.y;
      const inLobby = state === 'lobby' || (state === 'paused' && pausedFrom === 'lobby');
      net.send({ t: 'st', p: [P.render.x, P.render.y, P.render.z], f: Math.atan2(Math.sin(P.facing), Math.cos(P.facing)), m: P.isDown || P.wakeT > 0 ? 'down' : P.mode, a: 0, alt: inLobby ? 0 : alt, l: inLobby ? 1 : 0 });
    }
  }
  updateRemotes(dt);
  if (state !== 'flight') updateCamera(dt);
  updateScene(dt, now / 1000);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// Test/debug hook (read-only snapshot + teleport), used by the e2e smoke tests.
window.__highcrag = {
  get state() { return state; },
  get player() { return { mode: P.mode, x: P.pos.x, y: P.mode === 'climb' ? world.T.height(P.cx, P.cz) : P.pos.y, z: P.pos.z }; },
  get vitals() { return { ...S }; },
  get inv() { return [...inv]; },
  get coop() { return { on: coop.on, code: coop.code, down: !!P.isDown, remotes: [...coop.remotes.values()].map((r) => ({ cid: r.cid, name: r.name, m: r.st?.m ?? null, x: r.pos.x, y: r.pos.y, z: r.pos.z })) }; },
  get quality() { return qName; },
  get wake() { return P.wakeT; },
  world: () => world,
  lobby: () => lobby,
  blackout: () => blackout('test'),
  teleport: (x, z) => teleport(new V3(x, 0, z)),
  lobbyTo: (x, z) => { P.pos.set(x, LOBBY_FLOOR, z); P.render.copy(P.pos); },
  setYaw: (y) => { camYaw = y; },
  setFacing: (f) => { P.facing = f; },
  give: (type) => { const s = inv.indexOf(null); if (s >= 0) { inv[s] = type; sel = s; renderInv(); } },
};
