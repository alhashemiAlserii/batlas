// Highcrag — an original single-player mountain-climbing game for the Batlas site.
// Bootstrap, input, player controller (walk / climb / fall), survival meters, items, hazards, UI.
import * as THREE from '../../vendor/three.module.js';
import { Terrain, BANDS, bandAt, makeRng, R, HALF, fbm } from './terrain.js';
import { Sfx } from './audio.js';
import { HNet } from './net.js';

const $ = (s) => document.querySelector(s);
const V3 = THREE.Vector3;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isTouch = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && /iPad|iPhone|Android|Mobile/i.test(navigator.userAgent));
if (isTouch) document.body.classList.add('touch');

const store = {
  get(k, d) { try { const v = localStorage.getItem('highcrag.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('highcrag.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ---------------- renderer / scene ----------------
const renderer = new THREE.WebGLRenderer({ antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
$('#view').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 1400);
scene.fog = new THREE.Fog(0xbfe3f2, 60, 520);
scene.background = new THREE.Color(0x9fd4ef);
scene.add(new THREE.HemisphereLight(0xdff2ff, 0x5a4a38, 1.6));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
sun.position.set(220, 300, 120);
scene.add(sun);
const fireLight = new THREE.PointLight(0xff8a3d, 0, 18, 1.6);
scene.add(fireLight);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: 0x2f8fb8, transparent: true, opacity: 0.88 }));
sea.rotation.x = -Math.PI / 2;
sea.position.y = 0;
scene.add(sea);

const sfx = new Sfx();
sfx.setVolume(store.get('vol', 0.7));
let sens = store.get('sens', 1);

// ---------------- item definitions ----------------
const ITEMS = {
  berry: { name: 'Trailberries', icon: '🫐', color: 0x4a5cff, food: true },
  mushroom: { name: 'Glowcap', icon: '🍄', color: 0xff5a7a, food: true },
  ration: { name: 'Trail ration', icon: '🍫', color: 0x8a5a2b, food: true },
  bandage: { name: 'Bandage', icon: '🩹', color: 0xf3f3f3 },
  warmer: { name: 'Hand warmer', icon: '🧤', color: 0xff8a2a },
  piton: { name: 'Piton', icon: '📌', color: 0xb7c0cc },
  tonic: { name: 'Fizz tonic', icon: '🧃', color: 0x5cff9a },
};
const LOOT = {
  shore: ['berry', 'berry', 'ration', 'bandage', 'piton'],
  moss: ['berry', 'berry', 'mushroom', 'mushroom', 'bandage', 'piton', 'piton', 'ration'],
  frost: ['warmer', 'warmer', 'warmer', 'ration', 'piton', 'bandage', 'tonic', 'berry'],
  crown: ['warmer', 'tonic', 'tonic', 'piton', 'bandage', 'ration', 'warmer'],
};

function itemMesh(type) {
  const g = new THREE.Group();
  const c = ITEMS[type].color;
  const mat = new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.25 });
  if (type === 'berry') {
    for (const [x, y, z] of [[0, 0, 0], [0.12, 0.05, 0.05], [-0.08, 0.08, 0.1], [0.03, 0.15, -0.06]]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat);
      m.position.set(x, y, z);
      g.add(m);
    }
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 4), new THREE.MeshLambertMaterial({ color: 0x3e9a3a }));
    leaf.position.set(0, 0.25, 0);
    g.add(leaf);
  } else if (type === 'mushroom') {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.22, 6), new THREE.MeshLambertMaterial({ color: 0xf1e6cf }));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    cap.position.y = 0.1;
    g.add(stem, cap);
  } else if (type === 'piton') {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 5), mat);
    m.rotation.z = Math.PI / 2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 5, 10), mat);
    ring.position.x = 0.22;
    g.add(m, ring);
  } else if (type === 'tonic') {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.3, 8), mat));
  } else if (type === 'bandage') {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 10), mat));
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.13, 0.05), new THREE.MeshLambertMaterial({ color: 0xff3b4a }));
    g.add(s);
  } else {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(type === 'ration' ? 0.3 : 0.22, 0.1, 0.16), mat));
  }
  // Soft marker ring so loot is visible from a distance.
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.4, 16), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -0.3;
  g.add(halo);
  return g;
}

// ---------------- climber model (original design) ----------------
const SLOT_COLORS = [0xff7a29, 0x2f9bff, 0x3ddc84, 0xc86bff];
function makeClimber(color = SLOT_COLORS[0]) {
  const g = new THREE.Group();
  const jacket = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2b3550 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xf1c6a0 });
  const hat = new THREE.MeshLambertMaterial({ color: 0x1fc7c7 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.31, 0.72, 10), jacket);
  body.position.y = 1.0;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), skin);
  head.position.y = 1.58;
  const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.235, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hat);
  beanie.position.y = 1.62;
  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshLambertMaterial({ color: 0xfff1c9 }));
  pom.position.y = 1.86;
  const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.06), new THREE.MeshLambertMaterial({ color: 0x223, emissive: 0x3366aa, emissiveIntensity: 0.4 }));
  goggles.position.set(0, 1.6, 0.2);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.52, 0.24), new THREE.MeshLambertMaterial({ color: 0x5a6b2f }));
  pack.position.set(0, 1.05, -0.27);
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.46, 8), new THREE.MeshLambertMaterial({ color: 0xc23b3b }));
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0, 1.36, -0.27);
  g.add(body, head, beanie, pom, goggles, pack, roll);
  const limb = (w, h, mat, px, py) => {
    const pivot = new THREE.Group();
    pivot.position.set(px, py, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
    m.position.y = -h / 2;
    pivot.add(m);
    g.add(pivot);
    return pivot;
  };
  g.userData = {
    armL: limb(0.12, 0.56, jacket, -0.36, 1.3),
    armR: limb(0.12, 0.56, jacket, 0.36, 1.3),
    legL: limb(0.15, 0.62, dark, -0.13, 0.64),
    legR: limb(0.15, 0.62, dark, 0.13, 0.64),
    jacket,
  };
  return g;
}

// ---------------- world ----------------
let world = null; // everything built from a seed
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
  const n = isBeacon ? 10 : 7;
  const rr = isBeacon ? 1.5 : 0.75;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(isBeacon ? 0.45 : 0.22), stone);
    s.position.set(Math.cos(a) * rr, isBeacon ? 0.2 : 0.08, Math.sin(a) * rr);
    g.add(s);
  }
  if (isBeacon) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 2.6, 8), stone);
    pillar.position.y = 1.3;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 0.8, 0.6, 10), new THREE.MeshLambertMaterial({ color: 0x5a3b26 }));
    bowl.position.y = 2.9;
    g.add(pillar, bowl);
  } else {
    const logMat = new THREE.MeshLambertMaterial({ color: 0x6b4426 });
    for (const r of [0.6, -0.6]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.1, 6), logMat);
      l.rotation.z = Math.PI / 2;
      l.rotation.y = r;
      l.position.y = 0.12;
      g.add(l);
    }
    // Tall marker pole with a pennant, visible from far below.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.2, 5), logMat);
    pole.position.set(1.6, 2.1, 0);
    g.add(pole);
  }
  const flagMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a8, side: THREE.DoubleSide });
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6), flagMat);
  flag.position.set(isBeacon ? 0 : 2.15, isBeacon ? 5.2 : 3.9, 0);
  if (isBeacon) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5), new THREE.MeshLambertMaterial({ color: 0x6b4426 }));
    pole.position.set(-0.55, 4.6, 0);
    g.add(pole);
    flag.position.x = 0;
  }
  g.add(flag);
  const flame = new THREE.Group();
  const f1 = new THREE.Mesh(new THREE.ConeGeometry(isBeacon ? 1.0 : 0.38, isBeacon ? 2.6 : 1.0, 7), new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
  const f2 = new THREE.Mesh(new THREE.ConeGeometry(isBeacon ? 0.55 : 0.2, isBeacon ? 1.6 : 0.6, 6), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
  f1.position.y = isBeacon ? 4.4 : 0.55;
  f2.position.y = isBeacon ? 4.0 : 0.4;
  flame.add(f1, f2);
  flame.visible = false;
  g.add(flame);
  return { group: g, flame, flag, flagMat, pos: pos.clone(), lit: false, isBeacon };
}

function buildWorld(seed) {
  disposeWorld();
  const T = new Terrain(seed);
  const rng = makeRng(seed ^ 0x9e3779b9);
  const root = new THREE.Group();
  root.add(T.buildMesh());

  // Spawn on the beach on the +x side.
  let spawn = new V3(R + 20, 1.5, 0);
  for (let d = R + 40; d > 0; d -= 0.5) {
    const y = T.height(d, 0);
    if (y > 1.3) { spawn = new V3(d, y, 0); break; }
  }

  // Campfires at the foot of each higher band, spiralling around the mountain; beacon on the summit.
  const camps = [];
  const angles = [0.35, 1.5, 2.8];
  for (let b = 1; b < BANDS.length; b++) {
    const p = T.campSpot(BANDS[b].y0 + 1, angles[b - 1]);
    if (p) camps.push({ ...makeCamp(p, false), band: BANDS[b] });
  }
  const beacon = makeCamp(T.summit.clone(), true);
  for (const c of [...camps, beacon]) root.add(c.group);

  // Trees / rocks (instanced, decorative; tree trunks collide).
  const trees = [];
  const dummy = new THREE.Object3D();
  const addInstanced = (geo, mat, list, mapFn) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => {
      mapFn(dummy, p);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    });
    root.add(im);
  };
  const scatter = (count, y0, y1, minNy) => {
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = T.flatSpot(rng, y0, y1, minNy, 60);
      if (p && p.distanceTo(spawn) > 4 && camps.every((c) => c.pos.distanceTo(p) > 5) && beacon.pos.distanceTo(p) > 6) {
        p.userData = { s: 0.75 + rng() * 0.6, r: rng() * 6.28 };
        out.push(p);
      }
    }
    return out;
  };
  const palms = scatter(70, 1.5, 34, 0.9);
  const leafy = scatter(320, 37, 124, 0.88);
  const pines = scatter(200, 127, 205, 0.88);
  const rocks = scatter(260, 2, 260, 0.75);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5232, flatShading: true });
  const place = (yOff) => (d, p) => {
    const s = p.userData.s;
    d.position.set(p.x, p.y + yOff * s, p.z);
    d.scale.set(s, s, s);
    d.rotation.set(0, p.userData.r, 0);
  };
  addInstanced(new THREE.CylinderGeometry(0.16, 0.24, 4.2, 6), trunkMat, palms, place(2.1));
  addInstanced(new THREE.ConeGeometry(2.2, 1.0, 7), new THREE.MeshLambertMaterial({ color: 0x4fae4a, flatShading: true }), palms, place(4.3));
  addInstanced(new THREE.CylinderGeometry(0.2, 0.3, 2.4, 6), trunkMat, leafy, place(1.2));
  addInstanced(new THREE.IcosahedronGeometry(1.6, 0), new THREE.MeshLambertMaterial({ color: 0x3f8a34, flatShading: true }), leafy, place(3.2));
  addInstanced(new THREE.CylinderGeometry(0.18, 0.26, 1.8, 6), trunkMat, pines, place(0.9));
  addInstanced(new THREE.ConeGeometry(1.3, 3.6, 7), new THREE.MeshLambertMaterial({ color: 0x2f5e48, flatShading: true }), pines, place(3.4));
  addInstanced(new THREE.ConeGeometry(0.9, 1.2, 7), new THREE.MeshLambertMaterial({ color: 0xf4f8ff, flatShading: true }), pines, place(4.7));
  addInstanced(new THREE.DodecahedronGeometry(0.7, 0), new THREE.MeshLambertMaterial({ color: 0x8a8578, flatShading: true }), rocks, place(0.2));
  for (const p of [...palms, ...leafy, ...pines]) trees.push({ x: p.x, z: p.z, y: p.y, r: 0.35 * p.userData.s });

  // Thornbrush patches in Mossgrove.
  const thorns = [];
  const thornMat = new THREE.MeshLambertMaterial({ color: 0x7a2f4a, flatShading: true });
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
    }
  }

  // Loot on ledges, by band.
  const items = [];
  const counts = { shore: 10, moss: 28, frost: 24, crown: 16 };
  for (const band of BANDS) {
    const pool = LOOT[band.id];
    for (let i = 0; i < counts[band.id]; i++) {
      const p = T.flatSpot(rng, Math.max(1.5, band.y0 + 1), Math.min(band.y1, 262), 0.85, 80);
      if (p) items.push(spawnItem(root, pool[Math.floor(rng() * pool.length)], p));
    }
  }
  // Supply cache next to each campfire.
  for (const c of camps) {
    const pool = LOOT[c.band.id];
    for (let k = 0; k < 2; k++) {
      const a = rng() * 6.28;
      const x = c.pos.x + Math.cos(a) * 2.2, z = c.pos.z + Math.sin(a) * 2.2;
      items.push(spawnItem(root, pool[Math.floor(rng() * pool.length)], new V3(x, T.height(x, z), z)));
    }
  }
  // A starter piton and berries on the beach.
  items.push(spawnItem(root, 'piton', new V3(spawn.x - 2, T.height(spawn.x - 2, 1.5), 1.5)));
  items.push(spawnItem(root, 'berry', new V3(spawn.x - 2, T.height(spawn.x - 2, -1.5), -1.5)));

  // Weather particles (snow in Frostline, embers in the Crown).
  const PN = isTouch ? 700 : 1400;
  const pg = new THREE.BufferGeometry();
  const pp = new Float32Array(PN * 3);
  for (let i = 0; i < PN; i++) { pp[i * 3] = (Math.random() - 0.5) * 50; pp[i * 3 + 1] = Math.random() * 30; pp[i * 3 + 2] = (Math.random() - 0.5) * 50; }
  pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  const pmat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, transparent: true, opacity: 0, depthWrite: false });
  const particles = new THREE.Points(pg, pmat);
  particles.frustumCulled = false;
  root.add(particles);

  const pitonGroup = new THREE.Group();
  root.add(pitonGroup);
  scene.add(root);
  world = { seed, T, root, spawn, camps, beacon, items, trees, thorns, particles, pitonGroup, pitons: [] };
}

function spawnItem(root, type, pos) {
  const mesh = itemMesh(type);
  mesh.position.set(pos.x, pos.y + 0.45, pos.z);
  root.add(mesh);
  return { id: null, type, mesh, pos: pos.clone(), taken: false, phase: Math.random() * 6 };
}

// ---------------- player & game state ----------------
const climber = makeClimber();
scene.add(climber);
const P = {
  pos: new V3(), vel: new V3(), render: new V3(), mode: 'ground', cx: 0, cz: 0, facing: Math.PI,
  lungeT: 0, regrabLock: 0, peakY: 0, stepAcc: 0, regenDelay: 0, anim: 0, swimming: false,
};
const S = { stamina: 1, hunger: 0, cold: 0, injury: 0, boostT: 0 };
const inv = [null, null, null];
let sel = 0;
let state = 'menu'; // menu | play | paused | dead | won
let elapsed = 0, checkpoint = null, stats = null;
let blizzard = { t: 40, on: false, k: 0 };
let gust = { t: 8, on: false, k: 0, dir: new V3(1, 0, 0) };
const maxSt = () => Math.max(0, 1 - S.hunger - S.cold - S.injury);

const G = 22, WALK = 4.6, SPRINT = 7.4, JUMP = 7.4, CLIMB = 1.75, WALL_NY = 0.72;
const tmpN = new V3(), tmpN2 = new V3();

function gy(x, z) { return Math.max(world.T.height(x, z), -0.8); }

function resetRun(sameSeed, forceSeed) {
  const seed = forceSeed ?? (sameSeed && world ? world.seed : (Math.random() * 1e9) >>> 0);
  buildWorld(seed);
  inv.fill(null);
  sel = 0;
  Object.assign(S, { stamina: 1, hunger: 0, cold: 0, injury: 0, boostT: 0 });
  elapsed = 0;
  stats = { falls: 0, blackouts: 0, eaten: 0, pitons: 0, maxAlt: 0 };
  checkpoint = world.spawn.clone();
  teleport(checkpoint);
  P.facing = -Math.PI / 2;
  camYaw = Math.PI / 2;
  camPitch = 0.25;
  blizzard = { t: 45, on: false, k: 0 };
  gust = { t: 8, on: false, k: 0, dir: new V3(1, 0, 0) };
  renderInv();
  store.set('lastSeed', seed);
}

function teleport(p) {
  P.pos.copy(p);
  P.pos.y = gy(p.x, p.z);
  P.vel.set(0, 0, 0);
  P.mode = 'ground';
  P.render.copy(P.pos);
  P.peakY = P.pos.y;
}

// ---------------- input ----------------
const keys = new Set();
let mouseGrab = false, touchGrab = false, touchRun = false, jumpPressed = false;
let camYaw = 0, camPitch = 0.25;
const joy = { x: 0, y: 0, id: null, cx: 0, cy: 0 };
let lookTouch = null;

addEventListener('keydown', (e) => {
  if (e.code === 'Tab') e.preventDefault();
  if (state !== 'play') return;
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'Space') { jumpPressed = true; e.preventDefault(); }
  if (e.code === 'KeyE') interact();
  if (e.code === 'Enter' && P.isDown) giveUp();
  if (e.code === 'KeyF') useItem();
  if (e.code === 'KeyQ') dropItem();
  if (e.code.startsWith('Digit')) { const d = Number(e.code.slice(5)) - 1; if (d >= 0 && d < 3) { sel = d; renderInv(); } }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouseGrab = false; });
const canvas = renderer.domElement;
canvas.addEventListener('mousedown', (e) => {
  sfx.unlock();
  if (state !== 'play') return;
  if (!isTouch && document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; }
  if (e.button === 0 || e.button === 2) mouseGrab = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0 || e.button === 2) mouseGrab = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  if (state !== 'play' || document.pointerLockElement !== canvas) return;
  camYaw -= e.movementX * 0.0024 * sens;
  camPitch = clamp(camPitch + e.movementY * 0.0024 * sens, -0.5, 1.25);
});
addEventListener('wheel', (e) => {
  if (state !== 'play') return;
  sel = (sel + (e.deltaY > 0 ? 1 : 2)) % 3;
  renderInv();
}, { passive: true });
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && state === 'play' && !isTouch) pause();
});

// Touch: joystick (left), look drag (anywhere else), buttons.
if (isTouch) {
  $('#touch').classList.remove('hidden');
  const jEl = $('#joy'), knob = $('#joyKnob');
  jEl.addEventListener('touchstart', (e) => {
    sfx.unlock();
    const t = e.changedTouches[0];
    const r = jEl.getBoundingClientRect();
    Object.assign(joy, { id: t.identifier, cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
    e.preventDefault();
  }, { passive: false });
  addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) {
        let dx = (t.clientX - joy.cx) / 55, dy = (t.clientY - joy.cy) / 55;
        const l = Math.hypot(dx, dy);
        if (l > 1) { dx /= l; dy /= l; }
        joy.x = dx; joy.y = dy;
        knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
      } else if (lookTouch && t.identifier === lookTouch.id) {
        camYaw -= (t.clientX - lookTouch.x) * 0.006 * sens;
        camPitch = clamp(camPitch + (t.clientY - lookTouch.y) * 0.006 * sens, -0.5, 1.25);
        lookTouch.x = t.clientX; lookTouch.y = t.clientY;
      }
    }
  }, { passive: true });
  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) { joy.id = null; joy.x = joy.y = 0; knob.style.transform = ''; }
      if (lookTouch && t.identifier === lookTouch.id) lookTouch = null;
    }
  };
  addEventListener('touchend', endTouch);
  addEventListener('touchcancel', endTouch);
  canvas.addEventListener('touchstart', (e) => {
    sfx.unlock();
    const t = e.changedTouches[0];
    if (!lookTouch) lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
  }, { passive: true });
  const btn = (id, down, up) => {
    const el = $(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); sfx.unlock(); down(el); }, { passive: false });
    if (up) el.addEventListener('touchend', (e) => { e.preventDefault(); up(el); }, { passive: false });
  };
  btn('#tGrab', (el) => { touchGrab = true; el.classList.add('on'); }, (el) => { touchGrab = false; el.classList.remove('on'); });
  btn('#tJump', () => { jumpPressed = true; });
  btn('#tE', () => interact());
  btn('#tUse', () => useItem());
  btn('#tSlot', () => { sel = (sel + 1) % 3; renderInv(); });
  btn('#tRun', (el) => { touchRun = !touchRun; el.classList.toggle('on', touchRun); });
}

function inputVec() {
  let x = 0, y = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  x += joy.x;
  y -= joy.y;
  const l = Math.hypot(x, y);
  if (l > 1) { x /= l; y /= l; }
  return { x, y };
}
const grabHeld = () => mouseGrab || touchGrab || keys.has('KeyR');
const sprintHeld = () => keys.has('ShiftLeft') || keys.has('ShiftRight') || touchRun;

// ---------------- UI helpers ----------------
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3300);
  while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
}
const toastOnce = (() => { const last = {}; return (k, msg, gap = 6) => { if ((last[k] ?? -99) + gap < elapsed) { last[k] = elapsed; toast(msg); } }; })();

function renderInv() {
  document.querySelectorAll('#inv .slot').forEach((el, i) => {
    el.classList.toggle('sel', i === sel);
    el.querySelector('.ico').textContent = inv[i] ? ITEMS[inv[i]].icon : '';
  });
  $('#invName').textContent = inv[sel] ? ITEMS[inv[sel]].name : '';
}
const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// ---------------- interactions ----------------
function interact() {
  if (state !== 'play' || P.isDown) return;
  const me = P.mode === 'climb' ? climberWorldPos() : P.pos;
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
      // The server decides who gets it (first claim wins).
      if (!best.id) { toast('Still syncing the mountain…'); return; }
      if (!coop.pending.has(best.id)) { coop.pending.add(best.id); net.send({ t: 'take', id: best.id }); }
      return;
    }
    inv[slot] = best.type;
    best.taken = true;
    best.mesh.visible = false;
    sel = slot;
    renderInv();
    sfx.pickup();
    toast(`Picked up ${ITEMS[best.type].name}`);
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

function lightCamp(c, by = null, silent = false) {
  if (c.lit) return;
  c.lit = true;
  c.flame.visible = true;
  c.flagMat.color.setHex(0xff7a29);
  // The highest lit campfire is the (shared) checkpoint.
  const best = world.camps.filter((k) => k.lit).sort((a, b) => b.pos.y - a.pos.y)[0];
  checkpoint = best.pos.clone().add(new V3(1.6, 0, 1.2));
  if (silent) return;
  sfx.ignite();
  toast(by ? `🔥 ${by} lit the ${c.band.name} campfire. Checkpoint saved.` : `🔥 Campfire lit: ${c.band.name}. Checkpoint saved.`);
}

function addPiton(at) {
  const n = world.T.normal(at.x, at.z, new V3());
  const m = itemMesh('piton');
  m.children[m.children.length - 1].visible = false;
  m.position.copy(at);
  m.rotation.y = Math.atan2(-n.x, -n.z) + Math.PI / 2;
  world.pitonGroup.add(m);
  world.pitons.push(at);
}

function useItem() {
  if (state !== 'play' || P.isDown) return;
  const t = inv[sel];
  if (!t) return;
  let used = true;
  if (t === 'berry') { S.hunger = Math.max(0, S.hunger - 0.15); toast('Tart and juicy. Hunger down.'); }
  else if (t === 'ration') { S.hunger = Math.max(0, S.hunger - 0.35); toast('Chewy but filling.'); }
  else if (t === 'mushroom') {
    if (Math.random() < 0.7) { S.hunger = Math.max(0, S.hunger - 0.12); S.stamina = maxSt(); toast('The glowcap tingles. Stamina restored!'); }
    else { S.injury = Math.min(1, S.injury + 0.1); sfx.hurt(); toast('Ugh. That one was bad…'); }
  } else if (t === 'bandage') { S.injury = Math.max(0, S.injury - 0.3); toast('Patched up.'); }
  else if (t === 'warmer') { S.cold = Math.max(0, S.cold - 0.4); toast('Toasty fingers.'); }
  else if (t === 'tonic') { S.stamina = maxSt(); S.boostT = 9; toast('Fizz! No stamina drain for a few seconds.'); }
  else if (t === 'piton') {
    if (P.mode !== 'climb') { toast('Pitons go into a rock wall: use it while climbing.'); used = false; }
    else {
      const n = world.T.normal(P.cx, P.cz, tmpN);
      const at = new V3(P.cx, world.T.height(P.cx, P.cz), P.cz).addScaledVector(n, 0.12);
      addPiton(at);
      if (coop.on) net.send({ t: 'piton', p: [at.x, at.y, at.z] });
      stats.pitons++;
      sfx.piton();
      toast('Piton set. Hang here to rest.');
    }
  }
  if (!used) return;
  if (ITEMS[t].food) { stats.eaten++; sfx.eat(); } else if (t !== 'piton') sfx.pickup();
  inv[sel] = null;
  renderInv();
}

function dropItem() {
  if (state !== 'play' || !inv[sel] || P.mode !== 'ground' || P.isDown) return;
  const f = new V3(Math.sin(P.facing), 0, Math.cos(P.facing));
  const x = P.pos.x + f.x, z = P.pos.z + f.z;
  if (coop.on) net.send({ t: 'drop', type: inv[sel], p: [x, gy(x, z), z] }); // appears for everyone when the server confirms
  else world.items.push(spawnItem(world.root, inv[sel], new V3(x, gy(x, z), z)));
  inv[sel] = null;
  renderInv();
}

// ---------------- player physics ----------------
function climberWorldPos(out = new V3()) {
  const T = world.T;
  const n = T.normal(P.cx, P.cz, tmpN2);
  return out.set(P.cx, T.height(P.cx, P.cz), P.cz).addScaledVector(n, 0.42).add(new V3(0, -1.05, 0));
}

// Look along (dx, dz) for a rock wall at hand height and grab it.
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

function release(msg) {
  const T = world.T;
  const n = T.normal(P.cx, P.cz, tmpN);
  climberWorldPos(P.pos);
  P.pos.addScaledVector(n, 0.15);
  P.vel.set(n.x * 2, -0.5, n.z * 2);
  P.mode = 'air';
  P.peakY = P.pos.y;
  P.regrabLock = 0.3;
  if (msg) toast(msg);
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

let shake = 0;
function updatePlayer(dt) {
  const T = world.T;
  if (P.isDown && P.mode === 'climb') release();
  if (P.isDown && P.mode === 'ground') { P.pos.y = gy(P.pos.x, P.pos.z); return; }
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
      // Too steep to stand: slide off it (or grab it).
      const d = new V3(n.x, 0, n.z).normalize();
      P.pos.x += d.x * 6 * dt;
      P.pos.z += d.z * 6 * dt;
      P.pos.y = gy(P.pos.x, P.pos.z);
      if (grabHeld() && P.regrabLock <= 0) tryGrab(-n.x, -n.z, P.pos.y + 1.05);
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
      if (blocked && grabHeld() && P.regrabLock <= 0) tryGrab(move.x, move.z, P.pos.y + 1.05);
    }
    if (P.mode === 'ground' && grabHeld() && P.regrabLock <= 0) {
      tryGrab(Math.sin(P.facing), Math.cos(P.facing), P.pos.y + 1.05) || tryGrab(fwd.x, fwd.z, P.pos.y + 1.05);
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
      // Crown gusts shove you around on the ground.
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
      const water = T.height(P.pos.x, P.pos.z) < -0.8;
      land(water ? 0 : -P.vel.y);
    } else if (!P.isDown && grabHeld() && P.regrabLock <= 0 && S.stamina > 0.03 && -P.vel.y < 16) {
      const hy = P.pos.y + 1.05;
      const toPeak = new V3(world.T.summit.x - P.pos.x, 0, world.T.summit.z - P.pos.z);
      if (tryGrab(Math.sin(P.facing), Math.cos(P.facing), hy) || tryGrab(fwd.x, fwd.z, hy) || tryGrab(toPeak.x, toPeak.z, hy)) {
        S.stamina = Math.max(0, S.stamina - 0.08);
        toastOnce('catch', 'Caught the wall!', 4);
      }
    }
  } else if (P.mode === 'climb') {
    const n = T.normal(P.cx, P.cz, tmpN);
    if (!grabHeld()) { release(); return; }
    if (S.stamina <= 0) { release('Your grip gives out!'); return; }
    const u = new V3(-n.x * n.y, 1 - n.y * n.y, -n.z * n.y).normalize();
    const r = new V3(n.z, 0, -n.x).normalize();
    let iy = inp.y, ix = inp.x;
    if (jump && S.stamina >= 0.12 && P.lungeT <= 0) { P.lungeT = 0.28; S.stamina -= 0.12; sfx.grab(); }
    let spd = CLIMB;
    if (P.lungeT > 0) { iy = 1; spd = 6; }
    moving = Math.abs(iy) + Math.abs(ix) > 0.1;
    const d = u.multiplyScalar(iy * spd).addScaledVector(r, ix * spd * 0.85);
    if (gust.on && thin) d.addScaledVector(r, gust.dir.dot(r) * 0.5 * gust.k);
    const ncx = clamp(P.cx + d.x * dt, -HALF + 2, HALF - 2), ncz = clamp(P.cz + d.z * dt, -HALF + 2, HALF - 2);
    const n2 = T.normal(ncx, ncz, tmpN2);
    P.cx = ncx; P.cz = ncz;
    if (n2.y >= WALL_NY) {
      // Reached a ledge (or the foot of the wall): stand up.
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
  P.anim += dt * (moving ? (P.mode === 'climb' ? 6 : mlen * (sprintHeld() ? 13 : 9)) : 0);
}

function pushOutOfTrees() {
  for (const t of world.trees) {
    const dx = P.pos.x - t.x, dz = P.pos.z - t.z;
    if (Math.abs(dx) > 1.2 || Math.abs(dz) > 1.2 || Math.abs(P.pos.y - t.y) > 3) continue;
    const d = Math.hypot(dx, dz), min = t.r + 0.3;
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
    $('#downTxt').textContent = `A teammate can help you up (E). Respawning at the campfire in ${Math.max(0, Math.ceil(P.downT))} s.`;
    if (P.downT <= 0) giveUp();
    return;
  }
  const y = P.mode === 'climb' ? world.T.height(P.cx, P.cz) : P.pos.y;
  const band = bandAt(y);
  stats.maxAlt = Math.max(stats.maxAlt, y);
  S.hunger = Math.min(1, S.hunger + dt / (band.id === 'crown' ? 620 : 800));
  const me = P.mode === 'climb' ? climberWorldPos() : P.pos;
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

  // Blizzards in Frostline.
  blizzard.t -= dt;
  if (blizzard.t <= 0) {
    blizzard.on = !blizzard.on;
    blizzard.t = blizzard.on ? 22 : 50 + Math.random() * 35;
    if (blizzard.on && band.id === 'frost') { toast('❄ A blizzard rolls in. Find a fire or a warmer!'); sfx.gust(); }
  }
  blizzard.k += ((blizzard.on && band.id === 'frost' ? 1 : 0) - blizzard.k) * Math.min(1, dt * 0.8);
  // Gusts on the Ember Crown.
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
    // Co-op: you go down where you are and teammates have a short window to help you up.
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
  state = 'won';
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
    row('Pitons placed', String(stats.pitons));
    row('Mountain', `#${world.seed}`);
    if (isBest) row('', '★ New personal best!', 'best');
    const team = [...coop.remotes.values()].map((r) => r.name);
    $('#resTeam').textContent = coop.on ? `${by ? `${by} lit the beacon. ` : ''}${team.length ? `Climbed with ${team.join(', ')}.` : ''}` : '';
    $('#btnAgain').textContent = coop.on ? 'Back to menu' : 'Climb again';
    $('#btnNew2').classList.toggle('hidden', coop.on);
    $('#hud').classList.add('hidden');
    $('#results').classList.remove('hidden');
  }, 1800);
}

// ---------------- camera & rendering ----------------
const camTarget = new V3();
function updateCamera(dt) {
  const T = world.T;
  camTarget.copy(P.render).add(new V3(0, 1.45, 0));
  const fwd = new V3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
  let dist = 4.8;
  const dir = new V3(-fwd.x * Math.cos(camPitch), Math.sin(camPitch), -fwd.z * Math.cos(camPitch));
  for (let i = 1; i <= 14; i++) {
    const t = (i / 14) * dist;
    const p = camTarget.clone().addScaledVector(dir, t);
    if (T.height(p.x, p.z) + 0.35 > p.y) { dist = Math.max(0.6, t * 0.85); break; }
  }
  camera.position.copy(camTarget).addScaledVector(dir, dist);
  const floor = Math.max(T.height(camera.position.x, camera.position.z), 0) + 0.3;
  if (camera.position.y < floor) camera.position.y = floor;
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.4;
    camera.position.y += (Math.random() - 0.5) * shake * 0.4;
    shake = Math.max(0, shake - dt * 2);
  }
  camera.lookAt(camTarget);
  climber.visible = dist > 0.9;
}

const fogC = new THREE.Color(), skyC = new THREE.Color();
function updateScene(dt, now) {
  const T = world.T;
  const y = camera.position.y;
  // Sky/fog blend between bands.
  let a = BANDS[0], b = BANDS[0], k = 0;
  for (let i = 1; i < BANDS.length; i++) {
    if (y > BANDS[i].y0 - 15) { a = BANDS[i - 1]; b = BANDS[i]; k = clamp((y - (BANDS[i].y0 - 15)) / 30, 0, 1); }
  }
  fogC.setHex(a.fog).lerp(new THREE.Color(b.fog), k);
  const storm = blizzard.k;
  fogC.lerp(new THREE.Color(0xe8eef5), storm);
  skyC.copy(fogC).offsetHSL(0, 0.05, -0.04);
  scene.background.copy(skyC);
  scene.fog.color.copy(fogC);
  scene.fog.near = 60 - storm * 54;
  scene.fog.far = 520 - storm * 470;

  // Weather particles follow the camera.
  const band = bandAt(y);
  const pm = world.particles.material;
  const embers = band.id === 'crown';
  const want = band.id === 'frost' ? 0.35 + storm * 0.6 : embers ? 0.6 : 0;
  pm.opacity += (want - pm.opacity) * Math.min(1, dt * 2);
  pm.color.setHex(embers ? 0xff9a4a : 0xffffff);
  pm.size = embers ? 0.12 : 0.18;
  world.particles.visible = pm.opacity > 0.02;
  if (world.particles.visible) {
    const arr = world.particles.geometry.attributes.position.array;
    const fall = embers ? -1.2 : 3 + storm * 5;
    const wx = (embers ? gust.dir.x * 4 * gust.k : 2 + storm * 9) * dt, wz = (embers ? gust.dir.z * 4 * gust.k : 0.5) * dt;
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

  // Items bob; flames flicker; flags wave.
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
  if (nearest && nd < 40) {
    fireLight.position.copy(nearest.pos).add(new V3(0, nearest.isBeacon ? 4.5 : 1, 0));
    fireLight.intensity = (nearest.isBeacon ? 40 : 14) * (0.85 + Math.sin(now * 13) * 0.15);
    fireLight.distance = nearest.isBeacon ? 30 : 16;
  } else fireLight.intensity = 0;

  // Climber pose.
  const target = P.mode === 'climb' ? climberWorldPos() : P.pos;
  if (P.render.distanceTo(target) > 6) P.render.copy(target);
  P.render.lerp(target, 1 - Math.exp(-20 * dt));
  climber.position.copy(P.render);
  poseClimber(climber, P.isDown ? 'down' : P.mode, P.facing, P.anim);
  sfx.ambience(clamp((y - 20) / 260, 0.05, 0.4) + storm * 0.3 + gust.k * (band.id === 'crown' ? 0.3 : 0), nearest && nd < 12 ? 0.25 * (1 - nd / 12) : 0);
}

function poseClimber(model, mode, facing, anim) {
  const L = model.userData;
  const s = Math.sin(anim);
  model.rotation.set(0, facing, 0);
  L.armL.rotation.z = 0.08; L.armR.rotation.z = -0.08;
  if (mode === 'climb') {
    L.armL.rotation.x = -2.6 + s * 0.35;
    L.armR.rotation.x = -2.6 - s * 0.35;
    L.legL.rotation.x = -0.5 - s * 0.3;
    L.legR.rotation.x = -0.5 + s * 0.3;
    L.armL.rotation.z = 0.15; L.armR.rotation.z = -0.15;
  } else if (mode === 'air') {
    L.armL.rotation.x = L.armR.rotation.x = -1.2;
    L.armL.rotation.z = 0.8; L.armR.rotation.z = -0.8;
    L.legL.rotation.x = 0.3; L.legR.rotation.x = -0.3;
  } else if (mode === 'down') {
    // Lying on their back, arms out.
    model.rotation.set(-Math.PI / 2, facing, 0, 'YXZ');
    model.position.y += 0.25;
    L.armL.rotation.x = L.armR.rotation.x = 0;
    L.armL.rotation.z = 1.2; L.armR.rotation.z = -1.2;
    L.legL.rotation.x = L.legR.rotation.x = 0;
  } else {
    L.armL.rotation.x = s * 0.7; L.armR.rotation.x = -s * 0.7;
    L.legL.rotation.x = -s * 0.8; L.legR.rotation.x = s * 0.8;
  }
}

// ---------------- HUD ----------------
let hudAcc = 0;
function updateHud(dt) {
  hudAcc += dt;
  const ms = maxSt();
  $('#bSt').style.width = `${(Math.min(S.stamina, ms) * 100).toFixed(1)}%`;
  $('#bSt').classList.toggle('low', S.stamina < 0.2);
  $('#bHun').style.width = `${(S.hunger * 100).toFixed(1)}%`;
  $('#bCold').style.width = `${(S.cold * 100).toFixed(1)}%`;
  $('#bInj').style.width = `${(S.injury * 100).toFixed(1)}%`;
  if (hudAcc < 0.1) return;
  hudAcc = 0;
  const T = world.T;
  const y = P.mode === 'climb' ? T.height(P.cx, P.cz) : P.pos.y;
  $('#zone').textContent = bandAt(y).name;
  $('#alt').textContent = `${Math.max(0, Math.round(y))} m`;
  $('#timer').textContent = `⏱ ${fmtTime(elapsed)}`;

  const next = world.camps.find((c) => !c.lit && c.pos.y > y - 20) ?? world.beacon;
  const dx = next.pos.x - P.pos.x, dz = next.pos.z - P.pos.z;
  const ang = Math.atan2(dx, -dz) + camYaw; // bearing of target minus bearing of camera forward (-yaw)
  $('#goalArrow').style.transform = `rotate(${ang}rad)`;
  const up = Math.round(next.pos.y - y);
  $('#goalTxt').textContent = `${next.isBeacon ? 'Summit beacon' : 'Next campfire'} · ${up > 0 ? `${up} m up` : `${Math.round(Math.hypot(dx, dz))} m away`}`;

  const st = $('#status');
  st.replaceChildren();
  const tag = (txt, cls) => { const s = document.createElement('span'); s.textContent = txt; s.className = cls; st.appendChild(s); };
  if (blizzard.k > 0.3) tag('❄ Blizzard', 'warn');
  if (gust.on && bandAt(y).id === 'crown') tag('💨 Gust', 'hot');
  if (showStatus.fire) tag('🔥 Warming up', 'good');
  if (showStatus.piton) tag('📌 Resting', 'good');
  if (showStatus.thorns) tag('🌿 Thorns!', 'hot');
  if (S.boostT > 0) tag('🧃 Fizz', 'good');
  showStatus.piton = false;

  const ri = $('#roominfo');
  ri.classList.toggle('hidden', !coop.on);
  if (coop.on) {
    ri.replaceChildren();
    const head = document.createElement('div');
    head.append('Room ');
    const code = document.createElement('span'); code.className = 'code'; code.textContent = coop.code;
    head.append(code, ` · ${coop.remotes.size + 1}/4`);
    ri.append(head);
    const line = (name, slot, txt) => {
      const d = document.createElement('div'); d.className = 'pl';
      const n = document.createElement('span');
      const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = `#${SLOT_COLORS[slot % 4].toString(16).padStart(6, '0')}`;
      n.append(sw, name);
      const t = document.createElement('i'); t.textContent = txt;
      d.append(n, t); ri.append(d);
    };
    const tag = (m, alt) => (m === 'down' ? '💤 down' : `${m === 'climb' ? '🧗 ' : ''}${Math.max(0, Math.round(alt))} m`);
    line('You', coop.slot, tag(P.isDown ? 'down' : P.mode, y));
    for (const r of coop.remotes.values()) line(r.name, r.slot, r.st ? tag(r.st.m, r.st.alt) : '…');
  }

  // Context prompt.
  const me = P.mode === 'climb' ? climberWorldPos() : P.pos;
  let prompt = '';
  const key = isTouch ? 'E' : '[E]';
  if (coop.on && !P.isDown) {
    const downMate = [...coop.remotes.values()].find((r) => r.st?.m === 'down' && r.pos.distanceTo(me) < 2.8);
    const pullMate = pullTarget();
    if (downMate) prompt = `${key} help ${downMate.name} up`;
    else if (pullMate) prompt = `${key} pull ${pullMate.name} up`;
  }
  if (prompt || P.isDown) { /* co-op prompt above */ }
  else if (world.items.some((it) => !it.taken && it.mesh.position.distanceTo(me) < 3)) prompt = `${isTouch ? 'E' : '[E]'} pick up`;
  else if (world.camps.some((c) => !c.lit && c.pos.distanceTo(me) < 3.6)) prompt = `${isTouch ? 'E' : '[E]'} light campfire`;
  else if (!world.beacon.lit && world.beacon.pos.distanceTo(me) < 4.5) prompt = `${isTouch ? 'E' : '[E]'} light the summit beacon`;
  else if (P.mode === 'climb') prompt = isTouch ? 'Release ✋ to let go · ⤒ lunge' : 'Release to let go · Space lunge';
  else if (P.mode === 'ground') {
    const f = new V3(Math.sin(P.facing), 0, Math.cos(P.facing));
    const h = T.height(P.pos.x + f.x * 0.9, P.pos.z + f.z * 0.9);
    if (h > P.pos.y + 1.2 && T.normal(P.pos.x + f.x * 0.9, P.pos.z + f.z * 0.9, tmpN).y < WALL_NY) prompt = isTouch ? 'Hold ✋ to climb' : 'Hold left mouse to climb';
  }
  $('#prompt').textContent = prompt;
  $('#prompt').classList.toggle('hidden', !prompt);
}

// ---------------- co-op ----------------
const net = new HNet();
const coop = { on: false, code: null, slot: 0, remotes: new Map(), pending: new Set(), sendAcc: 0 };

function makeTag(text, bg = 'rgba(2,10,36,0.72)') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 28px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const w = Math.min(250, x.measureText(text).width + 30);
  x.fillStyle = bg;
  if (x.roundRect) { x.beginPath(); x.roundRect((256 - w) / 2, 8, w, 48, 14); x.fill(); } else x.fillRect((256 - w) / 2, 8, w, 48);
  x.fillStyle = '#fff';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 128, 33, 236);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, fog: false, transparent: true }));
  sp.scale.set(1.8, 0.45, 1);
  sp.renderOrder = 10;
  sp.visible = false;
  scene.add(sp);
  return sp;
}

function addRemote(p) {
  if (coop.remotes.has(p.cid) || p.cid === net.you?.cid) return;
  const model = makeClimber(SLOT_COLORS[p.slot % 4]);
  model.visible = false;
  scene.add(model);
  coop.remotes.set(p.cid, {
    cid: p.cid, name: p.name, slot: p.slot, model, st: null, pos: new V3(), facing: 0, anim: 0,
    tag: makeTag(p.name), help: makeTag('💤 Help me up!', 'rgba(140,30,40,0.8)'),
  });
}
function removeRemote(cid) {
  const r = coop.remotes.get(cid);
  if (!r) return;
  for (const o of [r.model, r.tag, r.help]) {
    scene.remove(o);
    o.traverse((k) => { k.geometry?.dispose(); k.material?.map?.dispose(); k.material?.dispose(); });
  }
  coop.remotes.delete(cid);
}
const clearRemotes = () => { for (const cid of [...coop.remotes.keys()]) removeRemote(cid); };
const nameOf = (cid) => coop.remotes.get(cid)?.name ?? 'A teammate';

function updateRemotes(dt) {
  const k = 1 - Math.exp(-12 * dt);
  for (const r of coop.remotes.values()) {
    if (!r.st) continue;
    const target = new V3(r.st.p[0], r.st.p[1], r.st.p[2]);
    if (!r.model.visible || r.pos.distanceTo(target) > 10) { r.pos.copy(target); r.model.visible = true; }
    const before = r.pos.clone();
    r.pos.lerp(target, k);
    r.anim += before.distanceTo(r.pos) * (r.st.m === 'climb' ? 3.4 : 2.2);
    r.facing = lerpAngle(r.facing, r.st.f, k);
    r.model.position.copy(r.pos);
    poseClimber(r.model, r.st.m, r.facing, r.anim);
    const down = r.st.m === 'down';
    r.tag.visible = true;
    r.tag.position.copy(r.pos).add(new V3(0, down ? 1.0 : 2.35, 0));
    r.help.visible = down;
    r.help.position.copy(r.pos).add(new V3(0, 1.55, 0));
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
  coop.slot = m.players.find((p) => p.cid === m.you)?.slot ?? 0;
  climber.userData.jacket.color.setHex(SLOT_COLORS[coop.slot]);
  for (const p of m.players) addRemote(p);
  for (const [cid, st] of Object.entries(m.states || {})) {
    const r = coop.remotes.get(Number(cid));
    if (r) r.st = st;
  }
  if (m.layout) applyLayout(m.layout.items, m.layout.camps);
  else net.send({ t: 'layout', items: world.items.map((i) => [i.type, i.pos.x, i.pos.y, i.pos.z]), camps: world.camps.map((c) => [c.pos.x, c.pos.y, c.pos.z]) });
  for (const i of m.lit || []) if (world.camps[i]) lightCamp(world.camps[i], null, true);
  for (const p of m.pitons || []) addPiton(new V3(p[0], p[1], p[2]));
  if (m.beacon) { world.beacon.lit = true; world.beacon.flame.visible = true; }
  try { history.replaceState(null, '', `?room=${m.code}`); } catch { /* ignore */ }
  setCoopUi();
  startPlay();
  toast(`Room ${m.code}: share this code so friends can join.`);
}

function leaveCoopLocal() {
  coop.on = false;
  coop.code = null;
  coop.pending.clear();
  clearRemotes();
  climber.userData.jacket.color.setHex(SLOT_COLORS[0]);
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
    case 'joined': addRemote(m.player); toast(`👋 ${m.player.name} joined the climb`); break;
    case 'left': toast(`${nameOf(m.cid)} left the room`); removeRemote(m.cid); break;
    case 'st': { const r = coop.remotes.get(m.cid); if (r) r.st = m; break; }
    case 'layout': applyLayout(m.items, m.camps); break;
    case 'taken': {
      coop.pending.delete(m.id);
      const it = world.items.find((i) => i.id === m.id);
      if (it) { it.taken = true; it.mesh.visible = false; }
      if (mine) {
        const slot = inv[sel] === null ? sel : inv.indexOf(null);
        if (slot < 0) {
          net.send({ t: 'drop', type: m.type, p: [P.pos.x, gy(P.pos.x, P.pos.z), P.pos.z] });
          toast('Your pack is full, so you set it down.');
        } else {
          inv[slot] = m.type;
          sel = slot;
          renderInv();
          sfx.pickup();
          toast(`Picked up ${ITEMS[m.type].name}`);
        }
      }
      break;
    }
    case 'take_no': coop.pending.delete(m.id); toast('Someone else grabbed it first!'); break;
    case 'dropped': { const it = spawnItem(world.root, m.type, new V3(m.p[0], m.p[1], m.p[2])); it.id = m.id; world.items.push(it); break; }
    case 'camp': if (world.camps[m.i]) lightCamp(world.camps[m.i], mine ? null : nameOf(m.by)); break;
    case 'piton': addPiton(new V3(m.p[0], m.p[1], m.p[2])); break;
    case 'beacon': if (state !== 'won' && state !== 'menu') lightBeacon(mine ? 'You' : m.name); break;
    case 'down': if (coop.remotes.has(m.cid)) toast(`💤 ${nameOf(m.cid)} is down! Get to them and press E.`); break;
    case 'revive': {
      const r = coop.remotes.get(m.from);
      if (P.isDown && r && r.pos.distanceTo(P.pos) < 4.5) revived(r.name);
      break;
    }
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
  toast('Lost the connection to the co-op room. You can keep climbing solo.');
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
$('#btnLeave').addEventListener('click', () => { leaveCoop(); showMenu(); });
$('#btnGiveUp').addEventListener('click', () => giveUp());
{
  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam) $('#roomCode').value = roomParam.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
  HNet.me().then((u) => {
    $('#coopSignedOut').classList.toggle('hidden', !!u);
    $('#coopSignedIn').classList.toggle('hidden', !u);
    if (!u && roomParam) $('#coopMsg').textContent = `Sign in to join room ${$('#roomCode').value}.`;
  });
}

// ---------------- menus ----------------
function showMenu() {
  state = 'menu';
  $('#menu').classList.remove('hidden');
  $('#pause').classList.add('hidden');
  $('#results').classList.add('hidden');
  $('#hud').classList.add('hidden');
  const best = store.get('best', null);
  $('#bestRow').textContent = best === null ? 'No summit yet.' : `Best summit time: ${fmtTime(best)}`;
  $('#seedRow').textContent = world ? `Mountain #${world.seed}` : '';
}
function startPlay() {
  sfx.unlock();
  sfx.click();
  $('#menu').classList.add('hidden');
  $('#pause').classList.add('hidden');
  $('#results').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  state = 'play';
  if (!isTouch) canvas.requestPointerLock?.();
  toastOnce('intro', 'Climb to the summit and light the beacon.', 999);
}
function pause() {
  if (state !== 'play') return;
  state = 'paused';
  keys.clear();
  mouseGrab = false;
  $('#pause').classList.remove('hidden');
  $('#setVol').value = String(sfx.vol);
  $('#setSens').value = String(sens);
}
$('#btnStart').addEventListener('click', () => { if (!world) resetRun(true); startPlay(); });
$('#btnNew').addEventListener('click', () => { resetRun(false); $('#seedRow').textContent = `Mountain #${world.seed}`; sfx.unlock(); sfx.click(); });
$('#btnResume').addEventListener('click', startPlay);
$('#btnRestart').addEventListener('click', () => { resetRun(true); startPlay(); });
$('#btnQuit').addEventListener('click', () => { if (coop.on) leaveCoop(); else resetRun(true); showMenu(); });
$('#btnAgain').addEventListener('click', () => { if (coop.on) { leaveCoop(); showMenu(); } else { resetRun(true); startPlay(); } });
$('#btnNew2').addEventListener('click', () => { resetRun(false); startPlay(); });
$('#btnPause').addEventListener('click', () => { if (isTouch) pause(); else document.exitPointerLock?.(); });
$('#setVol').addEventListener('input', (e) => { sfx.setVolume(Number(e.target.value)); store.set('vol', sfx.vol); });
$('#setSens').addEventListener('input', (e) => { sens = Number(e.target.value); store.set('sens', sens); });
addEventListener('keydown', (e) => { if (e.code === 'Escape' && state === 'paused') startPlay(); });

// ---------------- main loop ----------------
const params = new URLSearchParams(location.search);
const urlSeed = Number(params.get('seed'));
{
  const seed = Number.isFinite(urlSeed) && urlSeed > 0 ? urlSeed >>> 0 : store.get('lastSeed', (Math.random() * 1e9) >>> 0);
  resetRun(true, seed);
}
showMenu();

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;
  if (state === 'play') {
    elapsed += dt;
    // Two substeps keep climbing over sharp edges stable.
    updatePlayer(dt / 2);
    updatePlayer(dt / 2);
    updateSurvival(dt);
    updateHud(dt);
  } else if (state === 'menu') {
    camYaw += dt * 0.05;
  }
  if (coop.on && state !== 'menu') {
    coop.sendAcc += dt;
    if (coop.sendAcc >= 1 / 12) {
      coop.sendAcc = 0;
      const alt = P.mode === 'climb' ? world.T.height(P.cx, P.cz) : P.pos.y;
      net.send({ t: 'st', p: [P.render.x, P.render.y, P.render.z], f: Math.atan2(Math.sin(P.facing), Math.cos(P.facing)), m: P.isDown ? 'down' : P.mode, a: 0, alt });
    }
  }
  updateRemotes(dt);
  updateCamera(dt);
  updateScene(dt, now / 1000);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// Test/debug hook (read-only snapshot + teleport), used by the e2e smoke test.
window.__highcrag = {
  get state() { return state; },
  get player() { return { mode: P.mode, x: P.pos.x, y: P.mode === 'climb' ? world.T.height(P.cx, P.cz) : P.pos.y, z: P.pos.z }; },
  get vitals() { return { ...S }; },
  get inv() { return [...inv]; },
  get coop() { return { on: coop.on, code: coop.code, down: !!P.isDown, remotes: [...coop.remotes.values()].map((r) => ({ cid: r.cid, name: r.name, m: r.st?.m ?? null, x: r.pos.x, y: r.pos.y, z: r.pos.z })) }; },
  blackout: () => blackout('test'),
  world: () => world,
  teleport: (x, z) => teleport(new V3(x, 0, z)),
  setYaw: (y) => { camYaw = y; },
};
