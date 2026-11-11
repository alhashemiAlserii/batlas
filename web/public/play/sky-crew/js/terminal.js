// Pre-flight airport terminal (original design): check-in -> security (X-ray belt + walk-through scanner) -> gate ->
// covered walkway -> the rear air-stairs. Built in the parked aircraft's LOCAL frame behind the tail (floor y = -GEAR_H),
// merged into a few vertex-coloured batches. Shown only while the plane is at the gate.
// Which steps a player has done is decided by the GAME SERVER (server/src/game-server/terminal.ts); the per-player
// barriers here are just the physical version of that (an open scanner / gate door for you once you're cleared).
import * as THREE from '../../vendor/three.module.js';
import { RoundedBoxGeometry } from '../../vendor/addons/RoundedBoxGeometry.js';
import { Batch, canvasTexture } from './geo.js';
import { GEAR_H, Z_TAIL } from './world.js';
import { makeCrew, animateCharacter } from './characters.js';

const F = -GEAR_H;
/** Must match server/src/game-server/terminal.ts (STATIONS). */
export const STATIONS = {
  spawn: { x: 0, z: 59.5 },
  checkin: { x: -4.2, z: 53.6 },
  belt: { x: -3.2, z: 47.3 },
  arch: { x: 1.6, z: 44 },
  gatedesk: { x: 2.6, z: 30.6 },
  gate: { x: 0, z: 26 },
};
export const TERM_SPAWN = new THREE.Vector3(STATIONS.spawn.x, F, STATIONS.spawn.z);
export const TERM_BOUNDS = { x0: -9, x1: 9, z0: 26, z1: 62 };
export const STEPS = ['none', 'checkin', 'security', 'gate', 'boarded'];
export const stepIdx = (s) => Math.max(0, STEPS.indexOf(s || 'none'));
const W0 = TERM_BOUNDS.x0, W1 = TERM_BOUNDS.x1, ZG = TERM_BOUNDS.z0, ZE = TERM_BOUNDS.z1, HT = 4.6;
const rbox = (w, h, d, r = 0.05) => new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
const aabb = (x0, y0, z0, x1, y1, z1, tag = 'ground') => ({ min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)], tag });

function signTex(lines, { bg = '#0a1f5c', fg = '#ffffff', accent = '#f5c542', w = 1024, h = 256 } = {}) {
  return canvasTexture(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = accent; g.fillRect(0, h - 18, w, 18);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    const n = lines.length;
    lines.forEach((t, i) => { g.font = `bold ${i === 0 ? Math.round(h * 0.42 / Math.max(1, n * 0.7)) : Math.round(h * 0.2)}px -apple-system, Segoe UI, sans-serif`; g.fillText(t, w / 2, (h - 18) * (i + 0.5) / n); });
  });
}
function boardTex(dest) {
  return canvasTexture(1024, 384, (g, w, h) => {
    g.fillStyle = '#101826'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f5c542'; g.font = 'bold 44px -apple-system, Segoe UI, sans-serif'; g.textBaseline = 'middle';
    g.fillText('DEPARTURES', 28, 40); g.fillStyle = '#7fa2d6'; g.font = '28px -apple-system, Segoe UI, sans-serif'; g.fillText('Batlas Air · Harbor Field', 560, 42);
    const rows = [['BA 101', dest.name.toUpperCase(), 'A1', 'BOARDING'], ['BA 233', 'SUNNY SPIT', 'B4', 'DELAYED'], ['BA 317', 'MOON BAY', 'C2', 'ON TIME'], ['BA 404', 'NOWHERE', '—', 'CANCELLED']];
    rows.forEach((r, i) => {
      const y = 110 + i * 66;
      g.fillStyle = i === 0 ? '#1d3a26' : i % 2 ? '#141f31' : '#0f1828'; g.fillRect(16, y - 28, w - 32, 56);
      g.font = 'bold 34px ui-monospace, Menlo, monospace';
      g.fillStyle = '#ffffff'; g.fillText(r[0], 30, y); g.fillText(r[1].slice(0, 16), 220, y); g.fillText(r[2], 640, y);
      g.fillStyle = r[3] === 'BOARDING' ? '#3ddc84' : r[3] === 'DELAYED' ? '#ffb627' : r[3] === 'CANCELLED' ? '#ff6b6b' : '#9fb0d8'; g.fillText(r[3], 760, y);
    });
  });
}

export function buildTerminal(ship) {
  const group = new THREE.Group(); group.name = 'terminal';
  const b = new Batch(), glow = new Batch(), cols = [];
  const wall = (x0, z0, x1, z1, color = 0xcfe8ff, h = HT) => { b.add(new THREE.BoxGeometry(Math.abs(x1 - x0) || 0.3, h, Math.abs(z1 - z0) || 0.3), color, [(x0 + x1) / 2, F + h / 2, (z0 + z1) / 2]); cols.push(aabb(x0 - (x0 === x1 ? 0.15 : 0), F, z0 - (z0 === z1 ? 0.15 : 0), x1 + (x0 === x1 ? 0.15 : 0), F + h, z1 + (z0 === z1 ? 0.15 : 0))); };
  // floor: warm tiles + a teal "follow me" line, gate carpet, walkway
  b.add(new THREE.BoxGeometry(W1 - W0, 0.06, ZE - ZG), 0xf2e8d5, [0, F + 0.02, (ZG + ZE) / 2]);
  for (let z = ZG + 1; z < ZE; z += 2) for (let x = W0 + 1; x < W1; x += 2) if (((x + z) / 2) % 2 === 0) b.add(new THREE.BoxGeometry(1.96, 0.065, 1.96), 0xe8dcc4, [x, F + 0.021, z]);
  const path = [[0, 61], [0, 56], [-2.6, 55], [-2.6, 50], [1.6, 48.5], [1.6, 39], [1.4, 32], [0, 29], [0, 26.5]];
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i], [bx, bz] = path[i + 1], len = Math.hypot(bx - ax, bz - az);
    b.add(new THREE.BoxGeometry(0.22, 0.07, len), 0x19d3c5, [(ax + bx) / 2, F + 0.03, (az + bz) / 2], [0, Math.atan2(bx - ax, bz - az), 0]);
  }
  b.add(new THREE.BoxGeometry(7, 0.07, 9), 0x3b5bd9, [-5.5, F + 0.025, 34]); b.add(new THREE.BoxGeometry(4.2, 0.07, 9), 0x3b5bd9, [6.6, F + 0.025, 34]); // lounge carpets
  // outer walls with a window band, entrance doors (back) and the gate (front)
  for (const x of [W0, W1]) { wall(x, ZG, x, ZE, 0xbfe0ff); for (let z = ZG + 2; z < ZE - 1; z += 4) b.add(new THREE.BoxGeometry(0.34, 1.5, 3.2), 0x8fd0ff, [x, F + 2.4, z]); }
  wall(W0, ZE, -1.5, ZE, 0xffd27a); wall(1.5, ZE, W1, ZE, 0xffd27a); b.add(new THREE.BoxGeometry(3, HT - 2.6, 0.3), 0xffd27a, [0, F + 2.6 + (HT - 2.6) / 2, ZE]);
  b.add(new THREE.BoxGeometry(3.2, 0.12, 0.4), 0x9aa4b5, [0, F + 2.58, ZE]);
  wall(W0, ZG, -0.95, ZG, 0xbfe0ff); wall(0.95, ZG, W1, ZG, 0xbfe0ff); b.add(new THREE.BoxGeometry(1.9, HT - 2.4, 0.3), 0xbfe0ff, [0, F + 2.4 + (HT - 2.4) / 2, ZG]);
  for (const x of [-6.5, -3.5, 3.5, 6.5]) b.add(new THREE.BoxGeometry(2.4, 2.0, 0.34), 0x8fd0ff, [x, F + 2.3, ZG]); // big windows onto the apron
  // roof (no shadows, so the hall stays bright) + ceiling light panels
  const roof = new Batch(); roof.add(new THREE.BoxGeometry(W1 - W0 + 0.6, 0.25, ZE - ZG + 0.6), 0xffffff, [0, F + HT + 0.12, (ZG + ZE) / 2]);
  roof.add(new THREE.BoxGeometry(W1 - W0 + 1.2, 0.3, 1.0), 0x1e6bff, [0, F + HT + 0.1, ZE + 0.6]);
  for (let z = ZG + 3; z < ZE; z += 6) for (const x of [-4.5, 0, 4.5]) glow.add(new THREE.BoxGeometry(2.4, 0.04, 0.6), 0xfff7e0, [x, F + HT - 0.02, z]);
  // ---- 1. CHECK-IN: orange counters, bag scales, conveyor behind, agent
  b.add(rbox(6, 0.82, 0.9, 0.08), 0xff8a3d, [-4.5, F + 0.41, 52.6]); b.add(rbox(6.1, 0.08, 1.0, 0.03), 0xffffff, [-4.5, F + 0.86, 52.6]);
  for (const x of [-6.6, -4.2, -2.0]) { b.add(new THREE.BoxGeometry(0.42, 0.26, 0.3), 0x1b2333, [x + 1.05, F + 1.02, 52.4], [-0.4, 0, 0]); b.add(new THREE.BoxGeometry(0.9, 0.1, 0.7), 0x9aa4b5, [x + 0.9, F + 0.3, 53.4]); }
  b.add(new THREE.BoxGeometry(6.5, 0.5, 0.8), 0x5f6b7d, [-4.5, F + 0.6, 51.2]); b.add(new THREE.BoxGeometry(1.2, 1.8, 0.4), 0x5f6b7d, [-7.9, F + 0.9, 51.2]);
  cols.push(aabb(-7.5, F, 52.1, -1.5, F + 0.9, 53.1), aabb(-8.2, F, 50.7, -1.2, F + 1.8, 51.7));
  for (const z of [55.2, 56.6]) for (let x = -7; x <= -1.4; x += 1.4) { b.add(new THREE.CylinderGeometry(0.05, 0.08, 0.95, 8), 0xc9d0dc, [x, F + 0.48, z]); } // queue posts
  for (const z of [55.2, 56.6]) glow.add(new THREE.BoxGeometry(5.6, 0.06, 0.03), 0xe8453c, [-4.2, F + 0.86, z]); // queue ribbons
  // ---- 2. SECURITY: partition, X-ray belt + tunnel, walk-through scanner arch, trays, officer
  const SZ = STATIONS.arch.z;
  const part = (x0, x1) => { b.add(new THREE.BoxGeometry(x1 - x0, 1.1, 0.2), 0x2b5d8f, [(x0 + x1) / 2, F + 0.55, SZ]); cols.push(aabb(x0, F, SZ - 0.15, x1, F + HT, SZ + 0.15)); };
  part(W0, -3.9); part(-2.5, 1.0); part(2.2, W1);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(W1 - W0, HT - 1.1, 0.06), new THREE.MeshLambertMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.22, depthWrite: false }));
  glass.position.set(0, F + 1.1 + (HT - 1.1) / 2, SZ); group.add(glass);
  const BX = STATIONS.belt.x;
  b.add(new THREE.BoxGeometry(1.1, 0.72, 7.2), 0x3b3f4a, [BX, F + 0.36, 44.2]); b.add(new THREE.BoxGeometry(0.95, 0.04, 7.2), 0x1b1d22, [BX, F + 0.74, 44.2]);
  for (let z = 41; z < 48; z += 0.5) b.add(new THREE.CylinderGeometry(0.035, 0.035, 0.96, 6), 0x9aa4b5, [BX, F + 0.7, z], [0, 0, Math.PI / 2]);
  b.add(rbox(1.5, 1.5, 1.8, 0.12), 0x8e5bd9, [BX, F + 1.15, SZ]); b.add(new THREE.BoxGeometry(1.1, 0.7, 0.05), 0x1b2333, [BX, F + 1.08, SZ + 0.92]); b.add(new THREE.BoxGeometry(1.1, 0.7, 0.05), 0x1b2333, [BX, F + 1.08, SZ - 0.92]);
  for (let i = 0; i < 6; i++) glow.add(new THREE.BoxGeometry(0.15, 0.6, 0.02), 0x6b7385, [BX - 0.4 + i * 0.16, F + 1.05, SZ + 0.95]); // lead curtain strips
  b.add(new THREE.BoxGeometry(0.6, 0.42, 0.06), 0x1b2333, [BX + 1.0, F + 1.5, 42.4]); glow.add(new THREE.BoxGeometry(0.5, 0.34, 0.02), 0x47e0ff, [BX + 1.0, F + 1.5, 42.44]); // x-ray screen
  for (let i = 0; i < 3; i++) b.add(new THREE.BoxGeometry(0.7, 0.1, 0.5), 0x9aa4b5, [BX - 1.1, F + 0.8 + i * 0.1, 47.6]); // tray stack
  cols.push(aabb(BX - 0.75, F, 40.6, BX + 0.75, F + 2.0, 47.8));
  const AX = STATIONS.arch.x;
  for (const dx of [-0.65, 0.65]) { b.add(rbox(0.26, 2.3, 0.5, 0.06), 0xf3f0e6, [AX + dx, F + 1.15, SZ]); cols.push(aabb(AX + dx - 0.14, F, SZ - 0.26, AX + dx + 0.14, F + 2.4, SZ + 0.26)); }
  b.add(rbox(1.56, 0.28, 0.5, 0.06), 0xf3f0e6, [AX, F + 2.4, SZ]);
  const archMat = new THREE.MeshBasicMaterial({ color: 0x3ddc84 });
  const archLights = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.07, 0.52), archMat); archLights.position.set(AX, F + 2.3, SZ); group.add(archLights);
  for (const dx of [-0.52, 0.52]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.8, 0.4), archMat); l.position.set(AX + dx, F + 1.25, SZ); group.add(l); }
  // ---- 3. GATE A1: lounge seats, plants, boarding desk, departure board
  const seatRow = (x, z, n, col) => { for (let i = 0; i < n; i++) { b.add(rbox(0.62, 0.12, 0.6, 0.04), col, [x + i * 0.7, F + 0.46, z]); b.add(rbox(0.62, 0.6, 0.1, 0.04), col, [x + i * 0.7, F + 0.8, z + 0.3]); } b.add(new THREE.BoxGeometry(n * 0.7, 0.06, 0.12), 0x6b7385, [x + (n - 1) * 0.35, F + 0.22, z]); cols.push(aabb(x - 0.35, F, z - 0.32, x + n * 0.7 - 0.35, F + 0.9, z + 0.4)); };
  const SC = [0x2f7bff, 0xff5a6e, 0x23c4a6, 0xffb627, 0x8f5cff];
  for (let r = 0; r < 3; r++) { seatRow(-8.2, 31.2 + r * 2.6, 6, SC[r]); seatRow(5.2, 31.2 + r * 2.6, 4, SC[r + 2]); }
  for (const [x, z] of [[-8.3, 39.5], [8.3, 39.5], [-8.3, 27], [8.3, 27]]) { b.add(new THREE.CylinderGeometry(0.35, 0.28, 0.6, 10), 0xf5a623, [x, F + 0.3, z]); b.add(new THREE.IcosahedronGeometry(0.55, 0), 0x2bb673, [x, F + 1.0, z]); }
  b.add(rbox(2.2, 0.82, 0.8, 0.08), 0x19d3c5, [STATIONS.gatedesk.x, F + 0.41, 29.7]); b.add(rbox(2.3, 0.08, 0.9, 0.03), 0xffffff, [STATIONS.gatedesk.x, F + 0.86, 29.7]);
  b.add(new THREE.BoxGeometry(0.36, 0.26, 0.28), 0x1b2333, [STATIONS.gatedesk.x - 0.8, F + 1.02, 29.6], [-0.4, 0, 0]);
  cols.push(aabb(STATIONS.gatedesk.x - 1.1, F, 29.3, STATIONS.gatedesk.x + 1.1, F + 0.9, 30.1));
  for (const [x, z, w] of [[-4.5, 51.95, 6], [STATIONS.gatedesk.x, 29.0, 2.2]]) b.add(new THREE.BoxGeometry(w, 0.22, 0.6), 0x6b7385, [x, F + 0.11, z]); // staff platforms
  // café kiosk (decor)
  b.add(rbox(2.6, 1.1, 1.2, 0.1), 0xe8453c, [-6.8, F + 0.55, 46.5]); b.add(new THREE.BoxGeometry(2.8, 0.15, 1.4), 0xffffff, [-6.8, F + 2.6, 46.5]); for (const dx of [-1.25, 1.25]) b.add(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6), 0xffffff, [-6.8 + dx, F + 1.85, 46.5]);
  cols.push(aabb(-8.1, F, 45.9, -5.5, F + 1.1, 47.1));
  // ---- outside: covered walkway from the gate to the rear stairs + canopy posts
  const zw1 = ZG - 0.2, zw0 = Z_TAIL + 3.3;
  b.add(new THREE.BoxGeometry(1.9, 0.06, zw1 - zw0), 0x2f6fde, [0, F + 0.02, (zw0 + zw1) / 2]);
  roof.add(new THREE.BoxGeometry(2.6, 0.12, zw1 - zw0 + 0.4), 0xffffff, [0, F + 2.85, (zw0 + zw1) / 2]);
  for (let z = zw0 + 0.3; z <= zw1; z += 3) for (const x of [-1.15, 1.15]) { b.add(new THREE.CylinderGeometry(0.06, 0.06, 2.85, 8), 0xf5c542, [x, F + 1.42, z]); cols.push(aabb(x - 0.08, F, z - 0.08, x + 0.08, F + 2.85, z + 0.08)); }
  // signs (hanging) + departure board
  const signs = [];
  const sign = (tex, w, h, x, y, z, ry = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.y = ry; group.add(m); signs.push(m); return m; };
  sign(signTex(['① CHECK-IN', 'hand over your passport'], { bg: '#ff8a3d', accent: '#ffffff' }), 3.2, 0.8, -4.5, F + 3.4, 53.2);
  sign(signTex(['② SECURITY', 'bag on the belt · walk through'], { bg: '#8e5bd9', accent: '#ffffff' }), 3.6, 0.9, -1, F + 3.5, SZ + 0.3);
  sign(signTex(['③ GATE A1', 'show your boarding pass'], { bg: '#19a89d', accent: '#ffffff' }), 3.2, 0.8, 2.2, F + 3.4, 31.2);
  sign(signTex(['BATLAS AIR · HARBOR FIELD'], { bg: '#1e6bff', accent: '#f5c542', w: 2048 }), 9, 1.1, 0, F + HT - 0.5, ZE + 0.2);
  sign(signTex(['✈ TO THE PLANE ✈'], { bg: '#f5c542', fg: '#0a1f5c', accent: '#0a1f5c' }), 2.4, 0.5, 0, F + 2.95, ZG + 0.25);
  const board = sign(boardTex({ name: 'Coral Point' }), 4.6, 1.72, -3.2, F + 3.4, ZG + 0.2);
  let boardDest = '';
  // staff NPCs: original crew-style characters in Batlas uniforms
  const staff = [
    { id: 'checkin', mesh: makeCrew({ outfit: 'attendant', hat: 'pillbox', color: 7, skin: 2 }), x: -4.2, z: 51.95, ry: Math.PI },
    { id: 'security', mesh: makeCrew({ outfit: 'mechanic', hat: 'cap', color: 8, skin: 4 }), x: AX + 1.5, z: SZ - 0.9, ry: Math.PI / 2 },
    { id: 'gate', mesh: makeCrew({ outfit: 'attendant', hat: 'pillbox', color: 6, skin: 0 }), x: STATIONS.gatedesk.x, z: 29.0, ry: Math.PI },
  ];
  for (const s of staff) { s.mesh.position.set(s.x, F + (s.id === 'security' ? 0 : 0.22), s.z); s.mesh.rotation.y = s.ry; s.cheer = 0; group.add(s.mesh); }
  // my bag riding the X-ray belt
  const bagMesh = new THREE.Mesh(rbox(0.5, 0.34, 0.26, 0.06), new THREE.MeshLambertMaterial({ color: 0xe8453c })); bagMesh.visible = false; group.add(bagMesh);
  const statics = b.mesh({ shadows: true }); statics.castShadow = false; group.add(statics);
  group.add(roof.mesh({ shadows: false })); group.add(glow.mesh({ basic: true, shadows: false }));
  ship.plane.add(group);
  // per-player barriers: the scanner arch (until your bag is on the belt) and the gate door (until the gate agent scans your pass)
  const archBar = aabb(AX - 0.52, F, SZ - 0.2, AX + 0.52, F + 2.4, SZ + 0.2, 'term:arch');
  const gateBar = aabb(-0.95, F, ZG - 0.2, 0.95, F + HT, ZG + 0.2, 'term:gate');
  ship.colliders.push(...cols, archBar, gateBar);
  ship.interact.push(
    { id: 'term_checkin', kind: 'term_checkin', term: true, label: 'Check in', pos: new THREE.Vector3(STATIONS.checkin.x, F + 1.2, 52.9) },
    { id: 'term_belt', kind: 'term_belt', term: true, label: 'X-ray belt', pos: new THREE.Vector3(BX, F + 0.9, 47.4) },
    { id: 'term_gate', kind: 'term_gate', term: true, label: 'Gate A1', pos: new THREE.Vector3(STATIONS.gatedesk.x, F + 1.2, 30.0) },
  );
  const T = {
    group, staff, archBar, gateBar, bag: { t: -1 }, archFlash: 0, archColor: 0x3ddc84,
    /** bag on the belt: rides through the X-ray tunnel (about 2.4 s) */
    startBag() { T.bag.t = 0; bagMesh.visible = true; },
    bagDone() { return T.bag.t >= 2.4; },
    resetBag() { T.bag.t = -1; bagMesh.visible = false; },
    flashArch(color, t = 1.2) { T.archColor = color; T.archFlash = t; },
    cheer(id, t = 1.6) { const s = staff.find((q) => q.id === id); if (s) s.cheer = t; },
    update(dt, { dest, visible }) {
      group.visible = visible;
      if (!visible) return;
      if (dest && dest.code !== boardDest) { boardDest = dest.code; board.material.map?.dispose(); board.material.map = boardTex(dest); board.material.needsUpdate = true; }
      for (const s of staff) { if (s.cheer > 0) s.cheer -= dt; animateCharacter(s.mesh, dt, { cheer: s.cheer > 0, happy: true }); }
      if (T.bag.t >= 0 && T.bag.t < 2.4) T.bag.t += dt;
      if (bagMesh.visible) { const k = Math.min(1, Math.max(0, T.bag.t) / 2.4); bagMesh.position.set(BX, F + 0.94, 47.2 - k * 5.6); if (T.bag.t >= 2.4 && T.bag.t < 99) { T.bag.t = 99; setTimeout(() => { bagMesh.visible = false; }, 1500); } }
      if (T.archFlash > 0) { T.archFlash -= dt; archMat.color.setHex(Math.floor(T.archFlash * 6) % 2 ? T.archColor : 0xffffff); } else archMat.color.setHex(0x3ddc84);
    },
  };
  return T;
}

/** Passenger route through the terminal (waypoints with short pauses at the desks), ending at the stairs bottom. */
export function paxTerminalPath(i) {
  const lane = i % 2 ? 0.7 : -0.7;
  const P = (x, z, pause = 0) => { const v = new THREE.Vector3(x, F, z); if (pause) v.pause = pause; return v; };
  return [P(0, 61), P(-2.6 + lane * 0.3, 56.2), P(STATIONS.checkin.x + lane, STATIONS.checkin.z, 0.9), P(-0.4, 49.5), P(STATIONS.arch.x, 45.4), P(STATIONS.arch.x, 42.6, 0.4), P(STATIONS.gatedesk.x - 0.4, 31.3, 0.5), P(0, 27.4), P(0, 24.6)];
}
export function paxTerminalStart(i) { return new THREE.Vector3((i % 2 ? 0.6 : -0.6), F, ZE + 1.4 + Math.floor(i / 2) * 1.1); }
