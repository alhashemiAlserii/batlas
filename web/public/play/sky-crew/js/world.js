// Scene construction: the BA-1 "Tidewing" airliner (exterior + walkable interior) and the world (sky, sea, airports).
// Aircraft parts live in the `plane` group's LOCAL frame: cabin floor y=0, nose toward -z.
// Static parts are merged into a few vertex-coloured batches so the whole aircraft is a handful of draw calls (iPad friendly).
import * as THREE from '../../vendor/three.module.js';
import { Batch, loft, slab, fin, canvasTexture, rng } from './geo.js';

export const GEAR_H = 2.4; // cabin floor height above ground when parked
export const HALF_W = 1.9; // interior half width
export const CEIL = 2.5;
export const Z_NOSE = -16, Z_TAIL = 13, Z_COCKPIT = -13, Z_CARGO = 4;
export const FRONT_DOOR = { x: -HALF_W, z0: -12.6, z1: -11.4 };
export const CARGO_DOOR = { x: HALF_W, z0: 7, z1: 9 };
export const ORIGIN = { code: 'HBF', name: 'Harbor Field', x: 0, z: 0, len: 2600, w: 46, style: 'harbor' };
export const ROUTES = {
  CRP: { code: 'CRP', name: 'Coral Point', x: 3200, z: -16500, len: 2600, w: 46, style: 'tropical', blurb: 'Tropical island with a turquoise lagoon' },
  DNB: { code: 'DNB', name: 'Dune Bay', x: -6000, z: -8500, len: 2600, w: 46, style: 'desert', blurb: 'Short hop to the desert coast' },
  PNR: { code: 'PNR', name: 'Pine Ridge', x: -9000, z: -24000, len: 2600, w: 46, style: 'mountain', blurb: 'Long flight into the mountains' },
};
for (const r of Object.values(ROUTES)) r.km = Math.round(Math.hypot(r.x - ORIGIN.x, r.z - ORIGIN.z) / 100) / 10;
/** The active destination. Mutated in place by setRoute() so every module sees the change. */
export const DEST = { ...ROUTES.CRP };
export function setRoute(code) { if (ROUTES[code]) Object.assign(DEST, ROUTES[code]); return DEST; }
/** Terrain obstacles (cones) the aircraft can crash into: {x, z, r, h}. Filled by buildWorld. */
export const OBSTACLES = [];

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const M = {
  dark: mat(0x1b2333), metal: mat(0x9aa4b5), cloud: mat(0xffffff),
  screen: new THREE.MeshBasicMaterial({ color: 0x19d3e6 }), warn: new THREE.MeshBasicMaterial({ color: 0xff3b4a }),
};
export const MATERIALS = M;
const C = { hull: 0xf4f6fb, navy: 0x0a1f5c, teal: 0x19d3c5, blue: 0x1e6bff, glassOut: 0x14243f, metal: 0x9aa4b5, dark: 0x1b2333, tire: 0x161616, grey: 0x6b7385, panel: 0xe4e8f0, panel2: 0xd2d8e4, bin: 0xeef1f6, seat: 0x1e5fe0, seatBack: 0x173f9e, headrest: 0xe8eef8, galley: 0xc9d1de, steel: 0xb8c0cc, cargo: 0x7b8494, cargoFloor: 0x4f5868 };

/** Axis-aligned collider in plane-local coordinates. */
function aabb(x0, y0, z0, x1, y1, z1, tag = 'solid') {
  return { min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)], tag };
}
function box(w, h, d, m, x, y, z, parent) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z); parent?.add(mesh); return mesh;
}
function textTexture(text, { w = 1024, h = 256, font = 'bold 150px -apple-system, Segoe UI, sans-serif', color = '#0a1f5c', bg = null } = {}) {
  return canvasTexture(w, h, (g) => { if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); } g.font = font; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2); });
}

// Fuselage cross-section: circle radius R centred at y = CY (floor at y = 0).
const R = 2.45, CY = 1.1;
const ring = (z, k = 1, cy = CY, ry = null) => ({ z, cy, rx: R * k, ry: ry ?? R * k });
/** theta range on the hull (0 = bottom) that covers y in [y0, y1] on one side (+1 = +x). */
function thetaSpan(y0, y1, side) {
  const a = Math.acos(Math.max(-1, Math.min(1, -(y0 - CY) / R))), b = Math.acos(Math.max(-1, Math.min(1, -(y1 - CY) / R)));
  return side > 0 ? [a, b] : [Math.PI * 2 - b, Math.PI * 2 - a];
}

export function buildPlane() {
  const plane = new THREE.Group();
  plane.name = 'plane';
  const colliders = [];
  const interact = [];
  const T = 0.15; // wall thickness
  const ext = new Batch(), int = new Batch(), glow = new Batch();
  const B = (b, w, h, d, c, x, y, z, rot) => b.add(new THREE.BoxGeometry(w, h, d), c, [x, y, z], rot || [0, 0, 0]);
  const CYL = (b, rt, rb, h, c, pos, rot, seg = 10) => b.add(new THREE.CylinderGeometry(rt, rb, h, seg), c, pos, rot || [0, 0, 0]);

  // =================== EXTERIOR ===================
  // Hull: nose cone + tube (with door holes) + upswept tail cone.
  const noseL = 4.8, nose = [];
  for (const s of [4.8, 4.72, 4.55, 4.25, 3.85, 3.3, 2.6, 1.8, 1.0, 0.4, 0]) {
    const k = s / noseL;
    const r = Math.max(0.04, Math.pow(1 - Math.pow(k, 2.3), 1 / 2.1));
    nose.push(ring(Z_NOSE - s, r, CY - 0.5 * Math.pow(k, 1.6), R * r * (1 - 0.06 * k)));
  }
  ext.add(loft(nose, 32), C.hull);
  // windshield band on the nose (outside); pilots look through the culled inner faces
  const wsRings = nose.filter((r) => r.z > Z_NOSE - 2.0 && r.z < Z_NOSE - 0.5).map((r) => ({ ...r, rx: r.rx * 1.006, ry: r.ry * 1.006 }));
  ext.add(loft(wsRings, 14, Math.PI - 0.95, 1.9), C.glassOut);
  ext.add(loft([{ ...ring(Z_NOSE - 1.0, 0.985 * 1.006) }, ring(Z_NOSE + 0.6, 1.006)], 6, Math.PI - 1.35, 0.32), C.glassOut);
  ext.add(loft([{ ...ring(Z_NOSE - 1.0, 0.985 * 1.006) }, ring(Z_NOSE + 0.6, 1.006)], 6, Math.PI + 1.03, 0.32), C.glassOut);
  // tube segments
  const fdoor = thetaSpan(0, 2.3, -1), cdoor = thetaSpan(0, 2.3, 1);
  const segs = [[Z_NOSE, FRONT_DOOR.z0, null], [FRONT_DOOR.z0, FRONT_DOOR.z1, fdoor], [FRONT_DOOR.z1, CARGO_DOOR.z0, null], [CARGO_DOOR.z0, CARGO_DOOR.z1, cdoor], [CARGO_DOOR.z1, Z_TAIL, null]];
  for (const [z0, z1, hole] of segs) {
    const rr = [ring(z0), ring(z1)];
    if (!hole) ext.add(loft(rr, 32), C.hull);
    else ext.add(loft(rr, 28, hole[1], Math.PI * 2 - (hole[1] - hole[0])), C.hull);
    const big = rr.map((r) => ({ ...r, rx: r.rx * 1.004, ry: r.ry * 1.004 }));
    ext.add(loft(big, 10, -0.8, 1.6), C.navy); // navy belly
    for (const side of [1, -1]) {
      if (hole && ((side < 0 && hole === fdoor) || (side > 0 && hole === cdoor))) continue;
      const t = side > 0 ? [1.30, 1.43] : [Math.PI * 2 - 1.43, Math.PI * 2 - 1.30];
      ext.add(loft(big, 2, t[0], t[1] - t[0]), C.teal);
      const t2 = side > 0 ? [1.16, 1.28] : [Math.PI * 2 - 1.28, Math.PI * 2 - 1.16];
      ext.add(loft(big, 2, t2[0], t2[1] - t2[0]), C.blue);
    }
  }
  const tailL = 7.5, tail = [];
  for (const s of [0, 0.8, 1.8, 3.0, 4.2, 5.4, 6.5, 7.2, 7.5]) {
    const k = s / tailL;
    const top = CY + R - 0.35 * k, bottom = CY - R + 3.75 * Math.pow(k, 1.15);
    tail.push({ z: Z_TAIL + s, cy: (top + bottom) / 2, ry: Math.max(0.12, (top - bottom) / 2), rx: Math.max(0.12, R * (1 - 0.88 * Math.pow(k, 1.1))) });
  }
  ext.add(loft(tail, 32), C.hull);
  ext.add(loft(tail.slice(0, 5).map((r) => ({ ...r, rx: r.rx * 1.004, ry: r.ry * 1.004 })), 10, -0.8, 1.6), C.navy);
  // wing-body fairing
  ext.add(loft([{ z: -4.5, cy: -0.55, rx: 1.2, ry: 0.4 }, { z: -3.2, cy: -0.75, rx: 2.4, ry: 0.75 }, { z: 3.8, cy: -0.75, rx: 2.5, ry: 0.78 }, { z: 6.0, cy: -0.5, rx: 1.4, ry: 0.4 }], 20, -Math.PI / 2 - 0.1, Math.PI + 0.2), C.panel);
  // windows (outside decals, aligned with the cabin windows) + cockpit side windows + doors outlines
  const WIN_Z = []; for (let r = 0; r < 10; r++) WIN_Z.push(-9.6 + r * 1.3 - 0.25, -9.6 + r * 1.3 + 0.4);
  const winX = Math.sqrt(R * R - (1.3 - CY) ** 2) + 0.012;
  for (const side of [-1, 1]) for (const z of WIN_Z) {
    const g = new THREE.CircleGeometry(0.17, 10); g.scale(0.9, 1.25, 1);
    ext.add(g, C.glassOut, [side * winX, 1.3, z], [0, side * Math.PI / 2, 0]);
  }
  // door outlines (painted seams around the openings)
  for (const [d, side] of [[FRONT_DOOR, -1], [CARGO_DOOR, 1]]) {
    const span = thetaSpan(-0.05, 2.38, side);
    for (const zz of [d.z0 - 0.04, d.z1 + 0.04]) ext.add(loft([ring(zz - 0.03, 1.005), ring(zz + 0.03, 1.005)], 6, span[0], span[1] - span[0]), C.grey);
  }
  // titles
  for (const side of [-1, 1]) {
    const name = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 1.0), new THREE.MeshLambertMaterial({ map: textTexture('BATLAS AIR'), transparent: true }));
    const y = 2.25, x = Math.sqrt(R * R - (y - CY) ** 2) + 0.02;
    name.position.set(side * x, y, -4); name.rotation.y = side * Math.PI / 2; plane.add(name);
  }
  // wings (swept, low-mounted, slight dihedral) + winglets + engines
  for (const side of [-1, 1]) {
    const pts = [[2.0, -2.9], [16.2, 3.7], [16.2, 5.0], [2.0, 3.2]].map(([x, z]) => [x * side, z]);
    const w = slab(pts, 0.34, 0.05);
    const dihedral = new THREE.Matrix4().makeRotationZ(side * 0.065);
    const m = new THREE.Matrix4().makeTranslation(0, -0.85, 0).multiply(dihedral);
    ext.addMatrix(w, C.hull, m);
    // navy leading-edge tip band
    const tip = slab([[13.4, 2.3], [16.25, 3.65], [16.25, 4.1], [13.4, 2.9]].map(([x, z]) => [x * side, z]), 0.36, 0.05);
    ext.addMatrix(tip, C.navy, m);
    // flap-track fairings
    for (const fx of [5.5, 9.0, 12.4]) { const z = 3.2 + (fx - 2) * (1.8 / 14.2); const g = new THREE.ConeGeometry(0.14, 1.4, 6); g.rotateX(Math.PI / 2); ext.addMatrix(g, C.panel2, m.clone().multiply(new THREE.Matrix4().makeTranslation(side * fx, -0.2, z + 0.4))); }
    // winglet
    const wl = fin([[3.7, 0], [5.0, 0], [5.6, 1.7], [4.9, 1.7]], 0.12, 0.03);
    ext.addMatrix(wl, C.navy, m.clone().multiply(new THREE.Matrix4().makeTranslation(side * 16.2, 0.1, 0)).multiply(new THREE.Matrix4().makeRotationZ(-side * 0.18)));
    // engine nacelle under the wing
    const ex = side * 6.6, ey = -1.95;
    const nac = loft([{ z: -4.6, cy: ey, rx: 0.86, ry: 0.86 }, { z: -4.35, cy: ey, rx: 0.95, ry: 0.95 }, { z: -3.2, cy: ey, rx: 0.98, ry: 0.98 }, { z: -1.4, cy: ey, rx: 0.9, ry: 0.9 }, { z: -0.4, cy: ey, rx: 0.62, ry: 0.62 }].map((r) => ({ ...r, cx: ex })), 20);
    ext.add(nac, C.panel);
    ext.add(loft([{ z: -4.62, cy: ey, rx: 0.88, ry: 0.88, cx: ex }, { z: -4.2, cy: ey, rx: 0.97, ry: 0.97, cx: ex }], 20), C.navy);
    const fan = new THREE.CircleGeometry(0.84, 20); fan.rotateY(Math.PI); ext.add(fan, C.dark, [ex, ey, -4.5]);
    const spin = new THREE.ConeGeometry(0.28, 0.55, 12); spin.rotateX(-Math.PI / 2); ext.add(spin, C.steel, [ex, ey, -4.62]);
    const exh = new THREE.ConeGeometry(0.5, 1.2, 14); exh.rotateX(-Math.PI / 2); ext.add(exh, C.grey, [ex, ey, 0.2]);
    ext.add(slab([[ex - 0.15 * side, -3.4], [ex + 0.15 * side, -3.4], [ex + 0.15 * side, 0.6], [ex - 0.15 * side, 0.6]], 0.9, 0.03), C.panel, [0, -1.25, 0]); // pylon
    // horizontal stabiliser
    const hs = slab([[0.6, Z_TAIL + 3.0], [6.0, Z_TAIL + 6.2], [6.0, Z_TAIL + 7.0], [0.6, Z_TAIL + 6.3]].map(([x, z]) => [x * side, z]), 0.2, 0.03);
    ext.addMatrix(hs, C.hull, new THREE.Matrix4().makeTranslation(0, 2.25, 0).multiply(new THREE.Matrix4().makeRotationZ(side * 0.08)));
  }
  // vertical fin with the Batlas wave livery (own textured mesh)
  const finPts = [[Z_TAIL + 1.2, 3.0], [Z_TAIL + 5.0, 8.9], [Z_TAIL + 6.7, 8.9], [Z_TAIL + 7.3, 3.0]];
  const finGeo = fin(finPts, 0.34, 0.06);
  const finTex = canvasTexture(512, 512, (g, w, h) => drawWaveLivery(g, w, h));
  const logo = new Image(); logo.src = '/img/batlas-mark.png';
  logo.onload = () => { const g = finTex.image.getContext('2d'); g.save(); g.globalAlpha = 0.95; g.drawImage(logo, 300, 150, 150, 150); g.restore(); finTex.needsUpdate = true; };
  finTex.wrapS = finTex.wrapT = THREE.ClampToEdgeWrapping;
  finTex.repeat.set(1 / 6.5, 1 / 6.2); finTex.offset.set(-(Z_TAIL + 1.0) / 6.5, -2.9 / 6.2);
  const finMesh = new THREE.Mesh(finGeo, new THREE.MeshLambertMaterial({ map: finTex }));
  finMesh.castShadow = true; plane.add(finMesh);
  // landing gear (nose + two mains)
  const gb = new Batch();
  for (const [gx, gz, main] of [[0, -12.8, false], [-3.0, 1.6, true], [3.0, 1.6, true]]) {
    const top = main ? -0.9 : -1.15, bot = -GEAR_H + 0.48;
    CYL(gb, 0.11, 0.11, top - bot, C.steel, [gx, (top + bot) / 2, gz], null, 8);
    gb.box(0.5, 0.08, 0.12, C.steel, gx, bot, gz);
    const wx = main ? [-0.36, 0.36] : [-0.2, 0.2];
    const wz = main ? [-0.55, 0.55] : [0];
    for (const dx of wx) for (const dz of wz) {
      CYL(gb, 0.48, 0.48, 0.3, C.tire, [gx + dx, -GEAR_H + 0.48, gz + dz], [0, 0, Math.PI / 2], 14);
      CYL(gb, 0.24, 0.24, 0.32, C.steel, [gx + dx, -GEAR_H + 0.48, gz + dz], [0, 0, Math.PI / 2], 10);
    }
    if (main) gb.box(0.06, 1.1, 1.2, C.hull, gx + Math.sign(gx) * 0.6, -1.2, gz); // gear door
  }
  const gear = gb.mesh(); plane.add(gear);

  // =================== INTERIOR ===================
  // floors (textured carpet + cargo deck)
  const carpet = canvasTexture(256, 256, drawCarpet, { repeat: [2, 12] });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, T, Z_CARGO - Z_COCKPIT), new THREE.MeshLambertMaterial({ map: carpet }));
  floor.position.set(0, -T / 2, (Z_COCKPIT + Z_CARGO) / 2); floor.receiveShadow = true; plane.add(floor);
  B(int, HALF_W * 2, T, Z_COCKPIT - Z_NOSE, C.dark, 0, -T / 2, (Z_NOSE + Z_COCKPIT) / 2);
  const deck = canvasTexture(256, 256, drawDeck, { repeat: [2, 5] });
  const cfloor = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, T, Z_TAIL - Z_CARGO), new THREE.MeshLambertMaterial({ map: deck }));
  cfloor.position.set(0, -T / 2, (Z_CARGO + Z_TAIL) / 2); plane.add(cfloor);
  colliders.push(aabb(-HALF_W, -T, Z_NOSE, HALF_W, 0, Z_TAIL));
  colliders.push(aabb(-HALF_W, CEIL, Z_NOSE, HALF_W, CEIL + T, Z_TAIL));
  // curved cabin ceiling (between the bins) + flat ceilings in cockpit / cargo
  const ceilR = 4.0, ceilCY = 2.62 - ceilR, ang = Math.asin(1.3 / ceilR);
  int.add(loft([{ z: Z_COCKPIT, cy: ceilCY, rx: ceilR, ry: ceilR }, { z: Z_CARGO, cy: ceilCY, rx: ceilR, ry: ceilR }], 12, Math.PI - ang, ang * 2), C.panel);
  B(int, HALF_W * 2, 0.05, Z_COCKPIT - Z_NOSE, C.panel2, 0, CEIL + 0.03, (Z_NOSE + Z_COCKPIT) / 2);
  B(int, HALF_W * 2, 0.05, Z_TAIL - Z_CARGO, C.cargo, 0, CEIL + 0.03, (Z_CARGO + Z_TAIL) / 2);

  // side walls: lower panel, window band with framed windows, upper panel; door gaps
  function sideWall(side, gaps) {
    const x = side * (HALF_W + T / 2);
    let z = Z_NOSE;
    const segsW = [];
    for (const g of [...gaps, { z0: Z_TAIL, z1: Z_TAIL }]) { if (g.z0 > z) segsW.push([z, g.z0]); z = g.z1; }
    for (const [a, b] of segsW) {
      colliders.push(aabb(x - T / 2, 0, a, x + T / 2, CEIL, b));
      const cargo = a >= Z_CARGO - 0.01;
      const col = cargo ? C.cargo : C.panel;
      if (cargo) { B(int, T, CEIL, b - a, col, x, CEIL / 2, (a + b) / 2); continue; }
      B(int, T, 1.0, b - a, C.panel2, x, 0.5, (a + b) / 2); // lower (dado) panel
      B(int, T * 0.6, 0.06, b - a, C.grey, x - side * 0.05, 1.0, (a + b) / 2); // dado rail
      B(int, T, CEIL - 1.6, b - a, col, x, (1.6 + CEIL) / 2, (a + b) / 2);
      // window band: pillars between windows
      const wins = (a < Z_COCKPIT ? [-15.2, -14.2] : WIN_Z).filter((wz) => wz - 0.22 > a && wz + 0.22 < b).sort((p, q) => p - q);
      let pz = a;
      for (const wz of wins) {
        if (wz - 0.2 > pz) B(int, T, 0.6, wz - 0.2 - pz, col, x, 1.3, (pz + wz - 0.2) / 2);
        // frame
        const fx = x - side * (T / 2 + 0.015);
        B(int, 0.04, 0.05, 0.44, C.panel2, fx, 1.03, wz); B(int, 0.04, 0.05, 0.44, C.panel2, fx, 1.57, wz);
        B(int, 0.04, 0.58, 0.05, C.panel2, fx, 1.3, wz - 0.2); B(int, 0.04, 0.58, 0.05, C.panel2, fx, 1.3, wz + 0.2);
        B(int, 0.02, 0.12, 0.34, C.grey, fx, 1.5, wz); // window shade (half open)
        pz = wz + 0.2;
      }
      if (b > pz) B(int, T, 0.6, b - pz, col, x, 1.3, (pz + b) / 2);
    }
  }
  sideWall(-1, [FRONT_DOOR]);
  sideWall(1, [CARGO_DOOR]);
  // door frames bridging wall -> hull, lintels, thresholds
  for (const [d, side, col] of [[FRONT_DOOR, -1, C.panel2], [CARGO_DOOR, 1, C.cargo]]) {
    const xm = side * (HALF_W + 0.25);
    B(int, 0.55, 0.3, d.z1 - d.z0, col, xm, CEIL - 0.15, (d.z0 + d.z1) / 2);
    for (const zz of [d.z0 - 0.05, d.z1 + 0.05]) B(int, 0.55, CEIL, 0.1, col, xm, CEIL / 2, zz);
    B(int, 0.55, 0.06, d.z1 - d.z0, C.steel, xm, -0.03, (d.z0 + d.z1) / 2);
  }
  // doors: a curved hull plug that slides out and aft when opened
  const doors = {};
  function door(name, d, side, color) {
    const g = new THREE.Group();
    const span = thetaSpan(0, 2.3, side);
    const geo = loft([ring(d.z0 - (d.z0 + d.z1) / 2), ring(d.z1 - (d.z0 + d.z1) / 2)], 8, span[0], span[1] - span[0]);
    const db = new Batch(); db.add(geo, color);
    db.box(0.06, 0.14, 0.3, C.steel, side * (R - 0.25), 1.1, 0); // handle
    db.box(0.03, 0.3, 0.25, 0x9fd8ff, side * (R - 0.02), 1.6, 0); // door window
    const m = db.mesh({ side: THREE.DoubleSide }); g.add(m);
    g.position.set(0, 0, (d.z0 + d.z1) / 2);
    plane.add(g);
    const col = aabb(side * HALF_W, 0, d.z0, side * (HALF_W + T), CEIL, d.z1, `door:${name}`);
    colliders.push(col);
    const closedZ = (d.z0 + d.z1) / 2;
    doors[name] = { group: g, open: true, collider: col, closedZ, side, apply(open) { g.position.x = open ? side * 0.45 : 0; g.position.z = closedZ + (open ? (name === 'front' ? 1.35 : -2.15) : 0); } };
  }
  door('front', FRONT_DOOR, -1, C.hull);
  door('cargo', CARGO_DOOR, 1, C.hull);

  // end walls / bulkheads
  B(int, HALF_W * 2, 1.05, T, C.dark, 0, 0.525, Z_NOSE - T / 2);
  colliders.push(aabb(-HALF_W, 0, Z_NOSE - T, HALF_W, CEIL, Z_NOSE));
  for (const px of [-1.2, 0, 1.2]) B(int, 0.1, 1.45, 0.08, C.dark, px, 1.75, Z_NOSE - 0.05); // windshield frames
  B(int, HALF_W * 2, 0.12, 0.1, C.dark, 0, 2.44, Z_NOSE - 0.05);
  const wsGlass = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, 1.4), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.12, depthWrite: false }));
  wsGlass.position.set(0, 1.75, Z_NOSE - 0.07); plane.add(wsGlass);
  B(int, HALF_W * 2, CEIL, T, C.cargo, 0, CEIL / 2, Z_TAIL + T / 2);
  colliders.push(aabb(-HALF_W, 0, Z_TAIL, HALF_W, CEIL, Z_TAIL + T));
  function partition(z, gap, col) {
    const wL = HALF_W - gap;
    B(int, wL, CEIL, 0.1, col, -(gap + wL / 2), CEIL / 2, z); B(int, wL, CEIL, 0.1, col, gap + wL / 2, CEIL / 2, z);
    B(int, gap * 2, 0.4, 0.1, col, 0, CEIL - 0.2, z);
    colliders.push(aabb(-HALF_W, 0, z - 0.05, -gap, CEIL, z + 0.05), aabb(gap, 0, z - 0.05, HALF_W, CEIL, z + 0.05));
  }
  partition(Z_COCKPIT, 0.5, C.galley);
  partition(Z_CARGO, 0.6, C.cargo);
  glow.box(0.5, 0.14, 0.02, 0x22e06b, 0, CEIL - 0.2, Z_COCKPIT + 0.07); // EXIT sign

  // ---------- cockpit ----------
  B(int, HALF_W * 2, 1.0, 0.45, C.dark, 0, 0.5, Z_NOSE + 0.22);
  B(int, HALF_W * 2 - 0.2, 0.2, 0.55, 0x24304a, 0, 1.08, Z_NOSE + 0.3, [-0.3, 0, 0]); // glare shield
  colliders.push(aabb(-HALF_W, 0, Z_NOSE, HALF_W, 1.0, Z_NOSE + 0.45));
  for (const sx of [-0.6, 0.6]) {
    pilotSeat(int, sx, -14.6);
    colliders.push(aabb(sx - 0.3, 0, -14.9, sx + 0.3, 0.48, -14.3));
    glow.box(0.46, 0.3, 0.03, 0x0b3a66, sx - 0.1, 1.02, Z_NOSE + 0.47); glow.box(0.42, 0.26, 0.031, 0x19b4e6, sx - 0.1, 1.02, Z_NOSE + 0.475); // PFD
    glow.box(0.3, 0.26, 0.031, 0x1fd58a, sx + 0.28, 1.02, Z_NOSE + 0.475); // ND
    CYL(int, 0.035, 0.035, 0.5, C.metal, [sx, 0.62, -15.3], [0.35, 0, 0]);
    B(int, 0.36, 0.06, 0.05, C.dark, sx, 0.88, -15.4); B(int, 0.06, 0.16, 0.05, C.dark, sx - 0.16, 0.83, -15.4); B(int, 0.06, 0.16, 0.05, C.dark, sx + 0.16, 0.83, -15.4);
  }
  B(int, 0.42, 0.75, 0.8, C.dark, 0, 0.38, -14.9); // centre pedestal
  glow.box(0.25, 0.18, 0.02, 0x19d3e6, 0, 0.76, -15.31);
  const throttleLever = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.07), new THREE.MeshLambertMaterial({ color: 0xcfd6e2 }));
  throttleLever.position.set(0, 0.86, -15.0); plane.add(throttleLever);
  B(int, 1.4, 0.08, 0.9, C.dark, 0, CEIL - 0.04, -15.2); // overhead panel
  for (let i = 0; i < 18; i++) glow.box(0.06, 0.02, 0.06, [0xffffff, 0x3ddc84, 0xf5c542][i % 3], -0.55 + (i % 9) * 0.14, CEIL - 0.09, -15.45 + Math.floor(i / 9) * 0.3);
  interact.push({ id: 'seat_captain', kind: 'pilot', label: 'Take the captain\'s seat (Pilot)', pos: new THREE.Vector3(-0.6, 0.9, -14.6) });
  interact.push({ id: 'seat_copilot', kind: 'copilot', label: 'Take the first officer\'s seat (Co-pilot)', pos: new THREE.Vector3(0.6, 0.9, -14.6) });

  // ---------- galley ----------
  B(int, 0.7, 1.0, 1.7, C.galley, HALF_W - 0.35, 0.5, -12.05);
  B(int, 0.72, 0.04, 1.72, C.steel, HALF_W - 0.35, 1.02, -12.05);
  for (let i = 0; i < 3; i++) B(int, 0.02, 0.4, 0.5, C.steel, HALF_W - 0.71, 0.45, -12.6 + i * 0.55); // trolley bays
  B(int, 0.45, 0.6, 1.7, C.galley, HALF_W - 0.22, 1.9, -12.05); // upper cabinets
  glow.box(0.02, 0.08, 0.2, 0xff8a3d, HALF_W - 0.45, 1.75, -12.3); // oven light
  colliders.push(aabb(HALF_W - 0.7, 0, -12.9, HALF_W, 1.0, -11.2));
  const items = [['water', 0x4cc3ff, -12.6, 'Grab a bottle of water'], ['snack', 0xf5a623, -12.05, 'Grab a snack box'], ['blanket', 0x7c5cff, -11.5, 'Grab a blanket']];
  for (const [kind, color, z, label] of items) {
    B(int, 0.4, 0.22, 0.38, color, HALF_W - 0.35, 1.15, z);
    interact.push({ id: `disp_${kind}`, kind: 'dispense', item: kind, label, pos: new THREE.Vector3(HALF_W - 0.35, 1.2, z) });
  }
  B(int, 0.05, 0.22, 0.12, C.dark, HALF_W - 0.03, 1.5, -10.95); // PA handset
  interact.push({ id: 'pa', kind: 'announce', label: 'Make a cabin announcement', pos: new THREE.Vector3(HALF_W - 0.1, 1.5, -10.95) });

  // ---------- cabin seats ----------
  const seats = [];
  for (let r = 0; r < 10; r++) {
    const z = -9.6 + r * 1.3;
    for (const sx of [-1.45, -0.85, 0.85, 1.45]) {
      cabinSeat(int, sx, z);
      colliders.push(aabb(sx - 0.28, 0, z - 0.25, sx + 0.28, 0.48, z + 0.25), aabb(sx - 0.28, 0, z + 0.19, sx + 0.28, 1.18, z + 0.31));
      seats.push({ x: sx, z, row: r + 1, letter: 'ABCD'[[-1.45, -0.85, 0.85, 1.45].indexOf(sx)] });
    }
  }
  // overhead bins with open doors, passenger service units, light strips, seatbelt signs
  const signMat = new THREE.MeshBasicMaterial({ color: 0x333a48 });
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xfff4e0 });
  const signs = new THREE.Group(); plane.add(signs);
  for (const side of [-1, 1]) {
    const x0 = side * 1.25, x1 = side * HALF_W, z0 = -10.4, z1 = Z_CARGO - 0.3, cz = (z0 + z1) / 2, L = z1 - z0;
    B(int, Math.abs(x1 - x0), 0.06, L, C.bin, (x0 + x1) / 2, 1.75, cz);
    B(int, 0.04, 0.7, L, C.bin, x1 - side * 0.02, 2.1, cz);
    B(int, 0.04, 0.16, L, C.panel2, x0, 1.86, cz);
    B(int, Math.abs(x1 - x0) + 0.05, 0.05, L, C.bin, (x0 + x1) / 2, 2.47, cz);
    for (let k = 0; k <= 4; k++) B(int, Math.abs(x1 - x0), 0.7, 0.04, C.panel2, (x0 + x1) / 2, 2.1, z0 + (L * k) / 4);
    for (let k = 0; k < 4; k++) { // bin doors swung up
      const zc = z0 + (L * (k + 0.5)) / 4;
      B(int, 0.04, 0.55, L / 4 - 0.08, C.bin, x0 - side * 0.18, 2.62, zc, [0, 0, side * 1.15]);
    }
    colliders.push(aabb(x0, 1.72, z0, x1, 1.78, z1), aabb(x0 - 0.02, 1.78, z0, x0 + 0.02, 1.94, z1));
    // light strip along the bin edge
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, L), stripMat); strip.position.set(x0 + side * 0.02, 2.5, cz); plane.add(strip);
    for (let r = 0; r < 10; r++) {
      const z = -9.6 + r * 1.3;
      B(int, 0.5, 0.05, 0.3, C.panel2, side * 1.5, 1.7, z - 0.1); // PSU
      glow.box(0.04, 0.02, 0.04, 0xfff2c8, side * 1.42, 1.67, z - 0.1); glow.box(0.04, 0.02, 0.04, 0xfff2c8, side * 1.58, 1.67, z - 0.1);
      if (r % 2 === 0) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.08), signMat); s.position.set(side * 1.3, 1.69, z - 0.15); signs.add(s); }
    }
  }
  glow.box(0.02, 0.14, 0.45, 0x22e06b, -HALF_W + 0.06, CEIL - 0.25, FRONT_DOOR.z1 + 0.6); // exit sign by the door

  // ---------- cargo hold ----------
  for (const z of [5.0, 10.0]) for (const s of [-1, 1]) { B(int, 0.06, CEIL, 0.06, C.metal, s * 1.3, CEIL / 2, z); }
  for (let i = 0; i < 6; i++) B(int, 0.02, 0.02, 2.6, 0x3a414d, -1.3 + 0.0, 0.4 + i * 0.35, 7.5 + 0 * i, [0, 0, 0]); // cargo net (left)
  for (let i = 0; i < 6; i++) B(int, 0.02, CEIL - 0.2, 0.02, 0x3a414d, -1.3, (CEIL - 0.2) / 2 + 0.1, 6.3 + i * 0.45);
  B(int, 0.9, 0.9, 0.9, 0x8a6a3a, -1.3, 0.45, 12.0); B(int, 0.6, 0.5, 0.7, 0x9b7b48, -1.4, 1.15, 12.1); // crates
  colliders.push(aabb(-1.75, 0, 11.55, -0.85, 0.9, 12.45));
  B(int, 0.08, 0.7, 0.9, C.dark, HALF_W - 0.05, 1.3, 11.5);
  const panelLight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.12), M.screen); panelLight.position.set(HALF_W - 0.1, 1.5, 11.5); plane.add(panelLight);
  for (let i = 0; i < 6; i++) glow.box(0.02, 0.05, 0.05, [0xf5c542, 0x3ddc84][i % 2], HALF_W - 0.1, 1.15, 11.25 + i * 0.1);
  interact.push({ id: 'panel', kind: 'panel', label: 'Maintenance panel', pos: new THREE.Vector3(HALF_W - 0.1, 1.3, 11.5) });
  interact.push({ id: 'door_front', kind: 'door', door: 'front', label: 'front door', pos: new THREE.Vector3(-HALF_W + 0.15, 1.2, FRONT_DOOR.z1 + 0.35) });
  interact.push({ id: 'door_cargo', kind: 'door', door: 'cargo', label: 'cargo door', pos: new THREE.Vector3(HALF_W - 0.15, 1.2, CARGO_DOOR.z0 - 0.35) });
  for (const it of interact.filter((i) => i.kind === 'door')) glow.box(0.06, 0.25, 0.18, 0xff3b4a, it.pos.x, it.pos.y, it.pos.z);

  // ---------- air-stairs (ground-only colliders) ----------
  function stairs(side, zc, width) {
    const sb = new Batch();
    const cols = [];
    for (let k = 1; k <= 6; k++) {
      const top = -0.4 * k;
      const xa = side * (HALF_W + 0.25 + 0.5 * (k - 1)), xb = side * (HALF_W + 0.25 + 0.5 * k);
      sb.box(0.5, 0.06, width, 0xc9d0dc, (xa + xb) / 2, top - 0.03, zc);
      sb.box(0.04, 0.4, width, 0x8e97a6, xb, top - 0.2 + 0.0, zc);
      cols.push(aabb(xa, -GEAR_H, zc - width / 2, xb, top, zc + width / 2, 'ground'));
    }
    sb.box(0.4, 0.08, width, 0xc9d0dc, side * (HALF_W + 0.1), -0.04, zc);
    cols.push(aabb(side * HALF_W, -0.4, zc - width / 2, side * (HALF_W + 0.25), 0, zc + width / 2, 'ground'));
    const run = Math.hypot(3.0, 2.4), ang = side * Math.atan2(2.4, 3.0);
    for (const dz of [-width / 2 - 0.03, width / 2 + 0.03]) {
      sb.box(run, 0.05, 0.05, 0xdfe5ee, side * (HALF_W + 1.75), -0.2 + 0.9, zc + dz, [0, 0, ang]); // handrail
      sb.box(run, 0.25, 0.06, 0x8e97a6, side * (HALF_W + 1.75), -1.25, zc + dz, [0, 0, ang]); // stringer
      for (let k = 0; k < 4; k++) sb.box(0.04, 0.9, 0.04, 0xdfe5ee, side * (HALF_W + 0.6 + k * 0.85), -0.25 - k * 0.68 + 0.45, zc + dz);
    }
    // stair truck base
    sb.box(3.4, 0.5, width + 0.5, 0xf5a623, side * (HALF_W + 2.6), -GEAR_H + 0.55, zc);
    for (const dx of [0.9, 2.9]) for (const dz of [-1, 1]) sb.add(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 10), C.tire, [side * (HALF_W + 0.4 + dx), -GEAR_H + 0.3, zc + dz * (width / 2 + 0.25)], [Math.PI / 2, 0, 0]);
    const g = sb.mesh(); plane.add(g);
    colliders.push(...cols);
    return g;
  }
  const stairFront = stairs(-1, (FRONT_DOOR.z0 + FRONT_DOOR.z1) / 2, 1.1);
  const stairCargo = stairs(1, (CARGO_DOOR.z0 + CARGO_DOOR.z1) / 2, 1.8);
  colliders.push(aabb(-80, -GEAR_H - 1, -80, 80, -GEAR_H, 80, 'ground')); // apron while parked
  colliders.push(aabb(-HALF_W - 0.4, CY - R, Z_NOSE - 3, HALF_W + 0.4, -0.16, Z_TAIL + 5, 'ground')); // belly

  // oxygen masks (shown during cabin-pressure emergencies)
  const mb = new Batch();
  for (const s of seats) { mb.box(0.12, 0.12, 0.08, 0xffd84a, s.x, 1.45, s.z - 0.15); mb.box(0.01, 0.25, 0.01, 0xdddddd, s.x, 1.6, s.z - 0.15); }
  const masks = mb.mesh({ shadows: false }); masks.visible = false; plane.add(masks);
  // cabin lights
  const cabinLight = new THREE.PointLight(0xfff4e0, 9, 16, 1.6); cabinLight.position.set(0, 2.2, -5); plane.add(cabinLight);
  const cabinLight2 = new THREE.PointLight(0xfff4e0, 6, 14, 1.6); cabinLight2.position.set(0, 2.2, 8); plane.add(cabinLight2);
  const cockpitLight = new THREE.PointLight(0xdfe8ff, 5, 6, 1.6); cockpitLight.position.set(0, 2.2, -14.5); plane.add(cockpitLight);
  const warnLight = new THREE.PointLight(0xff2030, 0, 30, 1.2); warnLight.position.set(0, 2.2, 0); plane.add(warnLight);

  const extMesh = ext.mesh(); plane.add(extMesh);
  const intMesh = int.mesh({ side: THREE.DoubleSide }); intMesh.castShadow = false; plane.add(intMesh);
  const glowMesh = glow.mesh({ basic: true, shadows: false }); plane.add(glowMesh);
  const cabin = {
    lights: [cabinLight, cabinLight2], base: [18, 12], strip: stripMat, sign: signMat,
    setLights(on) { cabinLight.intensity = on ? 9 : 2; cabinLight2.intensity = on ? 6 : 1.5; stripMat.color.setHex(on ? 0xfff4e0 : 0x5a6aa8); },
    setSeatbelt(on) { signMat.color.setHex(on ? 0xffb020 : 0x333a48); },
  };
  return { plane, colliders, interact, seats, doors, stairFront, stairCargo, gear, masks, panelLight, throttleLever, warnLight, cabin, exterior: extMesh };
}

function pilotSeat(b, x, z) {
  b.box(0.56, 0.14, 0.55, 0x3a4256, x, 0.42, z);
  b.box(0.56, 0.85, 0.14, 0x3a4256, x, 0.88, z + 0.3, [-0.12, 0, 0]);
  b.box(0.4, 0.22, 0.12, 0x2c3344, x, 1.42, z + 0.36);
  for (const s of [-1, 1]) b.box(0.06, 0.06, 0.4, 0x2c3344, x + s * 0.3, 0.66, z + 0.02);
  b.box(0.3, 0.36, 0.3, 0x2c3344, x, 0.18, z);
}
function cabinSeat(b, x, z) {
  b.box(0.5, 0.12, 0.47, C.seat, x, 0.42, z - 0.01); // cushion
  b.box(0.5, 0.06, 0.45, 0x0f2f7a, x, 0.34, z);
  b.box(0.5, 0.72, 0.12, C.seatBack, x, 0.82, z + 0.24, [-0.1, 0, 0]); // backrest
  b.box(0.42, 0.2, 0.06, C.headrest, x, 1.12, z + 0.21, [-0.1, 0, 0]); // headrest cover
  b.box(0.3, 0.2, 0.02, 0x0b1f52, x, 0.75, z + 0.31); // seat-back pocket
  for (const s of [-1, 1]) {
    b.box(0.05, 0.05, 0.42, C.grey, x + s * 0.255, 0.62, z + 0.02); // armrest
    b.box(0.04, 0.16, 0.04, C.grey, x + s * 0.255, 0.53, z + 0.18);
    b.box(0.04, 0.3, 0.04, C.metal, x + s * 0.2, 0.15, z - 0.15); b.box(0.04, 0.3, 0.04, C.metal, x + s * 0.2, 0.15, z + 0.15); // legs
  }
}

function drawWaveLivery(g, w, h) {
  g.fillStyle = '#0a1f5c'; g.fillRect(0, 0, w, h);
  const waves = [['#1e6bff', 0.55], ['#19d3c5', 0.38], ['#7fe9ff', 0.27]];
  for (const [color, base] of waves) {
    g.fillStyle = color; g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, h - (base * h + Math.sin(x / w * Math.PI * 2.2 + base * 9) * h * 0.06 - (x / w) * h * 0.18));
    g.lineTo(w, h); g.closePath(); g.fill();
  }
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 6; g.beginPath();
  for (let x = 0; x <= w; x += 8) g.lineTo(x, h - (0.62 * h + Math.sin(x / w * Math.PI * 2.2 + 2) * h * 0.05 - (x / w) * h * 0.18));
  g.stroke();
}
function drawCarpet(g, w, h) {
  g.fillStyle = '#14286a'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(${40 + Math.random() * 30},${60 + Math.random() * 40},${140 + Math.random() * 60},0.35)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  g.strokeStyle = 'rgba(25,211,197,0.55)'; g.lineWidth = 3;
  for (let y = 0; y < h; y += 64) { g.beginPath(); for (let x = 0; x <= w; x += 8) g.lineTo(x, y + 32 + Math.sin((x / w) * Math.PI * 4) * 8); g.stroke(); }
  g.fillStyle = 'rgba(245,197,66,0.6)'; for (let y = 16; y < h; y += 64) for (let x = 16; x < w; x += 64) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
}
function drawDeck(g, w, h) {
  g.fillStyle = '#4f5868'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#5e687a'; for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 6, h);
  g.fillStyle = '#3a414d'; for (let y = 0; y < h; y += 32) for (let x = 14; x < w; x += 32) { g.beginPath(); g.arc(x, y + 16, 4, 0, Math.PI * 2); g.fill(); }
}

// =================== WORLD ===================
const STYLES = {
  harbor: { grass: 0x5f9a4b, sand: 0xd9c48e, tree: 'broadleaf', apron: 0x8c939e },
  tropical: { grass: 0x4fae5a, sand: 0xf1dfa6, tree: 'palm', apron: 0x9aa1aa, lagoon: true },
  desert: { grass: 0xd8b77a, sand: 0xe7cf98, tree: 'cactus', apron: 0xa49580, dunes: true },
  mountain: { grass: 0x3f6f3c, sand: 0x8f8a76, tree: 'pine', apron: 0x7f868f, peaks: true },
};

/** Static world: sky dome, sea, airports with scenery, clouds. Returns handles used for lighting/weather. */
export function buildWorld(scene, { quality = 'medium' } = {}) {
  const R0 = rng(1234);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x1556d8) }, mid: { value: new THREE.Color(0x6fb2ff) }, bottom: { value: new THREE.Color(0xd8efff) }, sunDir: { value: new THREE.Vector3(0.35, 0.55, 0.25).normalize() }, dim: { value: 1.0 } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sunDir; uniform float dim; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.55, h)) : bottom; c = mix(bottom, c, smoothstep(-0.02, 0.12, h));
        float s = max(dot(normalize(vP), sunDir), 0.0); c += vec3(1.0,0.92,0.75) * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(c * dim, 1.0); }`,
  }));
  sky.renderOrder = -1;
  scene.add(sky);
  scene.fog = new THREE.Fog(0xcfe8ff, 900, 16000);
  const hemi = new THREE.HemisphereLight(0xdff2ff, 0x9aa3b0, 1.25); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.0);
  sun.position.set(350, 550, 250); scene.add(sun); scene.add(sun.target);
  sun.shadow.camera.left = -38; sun.shadow.camera.right = 38; sun.shadow.camera.top = 38; sun.shadow.camera.bottom = -38;
  sun.shadow.camera.near = 50; sun.shadow.camera.far = 1500; sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.04;

  const seaMat = new THREE.MeshLambertMaterial({ color: 0x1769b0, polygonOffset: true, polygonOffsetFactor: 6, polygonOffsetUnits: 6 }); // keeps islands from z-fighting the sea at altitude
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000), seaMat); sea.rotation.x = -Math.PI / 2; sea.position.y = -0.6; scene.add(sea);
  const land = new Batch(), deco = new Batch(), lights = new Batch();
  function disc(cx, cz, rx, rz, color, y, seg = 28) { const g = new THREE.CircleGeometry(1, seg); g.rotateX(-Math.PI / 2); land.add(g, color, [cx, y, cz], [0, 0, 0], [rx, 1, rz]); }
  function island(cx, cz, rx, rz, st) {
    if (st.lagoon) { disc(cx, cz, rx * 1.45, rz * 1.3, 0x2fc3c9, -0.45, 36); disc(cx, cz, rx * 1.22, rz * 1.15, 0x63dcd4, -0.4, 36); }
    disc(cx, cz, rx * 1.07, rz * 1.06, st.sand, -0.3);
    disc(cx, cz, rx, rz, st.grass, -0.05);
  }
  const tree = {
    broadleaf(x, z, s = 1) { deco.add(new THREE.CylinderGeometry(0.5, 0.7, 4, 5), 0x6b4a2b, [x, 2 * s, z], [0, 0, 0], [s, s, s]); deco.add(new THREE.IcosahedronGeometry(3.2, 0), 0x2f7a3a, [x, 6 * s, z], [0, R0() * 3, 0], [s, s * 0.9, s]); },
    palm(x, z, s = 1) {
      const lean = (R0() - 0.5) * 0.3;
      deco.add(new THREE.CylinderGeometry(0.25, 0.4, 9, 6), 0x8b6b45, [x, 4.5 * s, z], [lean, 0, lean], [s, s, s]);
      for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; deco.add(new THREE.BoxGeometry(0.6, 0.12, 4.2), 0x2e9a45, [x + Math.sin(a) * 1.8 * s + lean * 9 * s, 9 * s, z + Math.cos(a) * 1.8 * s + lean * 9 * s], [0.35, a, 0], [s, s, s]); }
    },
    pine(x, z, s = 1) { deco.add(new THREE.CylinderGeometry(0.35, 0.5, 3, 5), 0x5a3d22, [x, 1.5 * s, z], [0, 0, 0], [s, s, s]); for (let k = 0; k < 3; k++) deco.add(new THREE.ConeGeometry(3.4 - k * 0.9, 4.5, 7), 0x1f4f2c, [x, (3.5 + k * 2.6) * s, z], [0, 0, 0], [s, s, s]); },
    cactus(x, z, s = 1) {
      if (R0() < 0.5) { deco.add(new THREE.DodecahedronGeometry(1.6, 0), 0xa8865a, [x, 0.8, z], [R0(), R0(), 0], [s, s * 0.6, s]); return; }
      deco.add(new THREE.CylinderGeometry(0.45, 0.5, 5, 7), 0x4f8a43, [x, 2.5 * s, z], [0, 0, 0], [s, s, s]);
      deco.add(new THREE.CylinderGeometry(0.3, 0.3, 2, 6), 0x4f8a43, [x + 1.0 * s, 3 * s, z], [0, 0, 0], [s, s, s]);
      deco.add(new THREE.BoxGeometry(1.0, 0.4, 0.4), 0x4f8a43, [x + 0.6 * s, 2.1 * s, z], [0, 0, 0], [s, s, s]);
    },
  };
  function airport(ap, side) {
    const st = STYLES[ap.style] || STYLES.harbor;
    island(ap.x, ap.z - ap.len / 2 + 300, 1100, ap.len / 2 + 800, st);
    // runway, markings, edge + approach lights, taxiway, apron
    land.add(new THREE.BoxGeometry(ap.w, 0.1, ap.len), 0x2d3138, [ap.x, -0.02, ap.z - ap.len / 2 + 60]);
    land.add(new THREE.BoxGeometry(ap.w + 6, 0.08, ap.len + 20), 0x4a4f57, [ap.x, -0.04, ap.z - ap.len / 2 + 60]);
    for (let d = 40; d < ap.len - 80; d += 60) land.add(new THREE.BoxGeometry(1, 0.02, 24), 0xf2f2f2, [ap.x, 0.04, ap.z + 60 - d - 30]);
    for (const e of [ap.z + 30, ap.z - ap.len + 90]) for (let i = -4; i <= 4; i++) if (i) land.add(new THREE.BoxGeometry(1.6, 0.02, 22), 0xf2f2f2, [ap.x + i * 4.2, 0.04, e]);
    for (const s of [-1, 1]) land.add(new THREE.BoxGeometry(0.6, 0.02, ap.len - 40), 0xf2f2f2, [ap.x + s * (ap.w / 2 - 1.5), 0.04, ap.z - ap.len / 2 + 60]);
    for (let d = 0; d < ap.len; d += 60) for (const s of [-1, 1]) lights.box(0.5, 0.4, 0.5, 0xfff2c0, ap.x + s * (ap.w / 2 + 2), 0.2, ap.z + 60 - d);
    for (let k = 1; k <= 9; k++) { lights.box(10, 0.3, 0.5, 0xffffff, ap.x, 0.6, ap.z + 60 + k * 45); lights.box(0.6, 1.2, 0.6, 0x666666, ap.x, 0.0, ap.z + 60 + k * 45); }
    for (let i = 0; i < 4; i++) lights.box(1.0, 0.8, 1.0, 0xff4040, ap.x - (ap.w / 2 + 12 + i * 5), 0.4, ap.z - 280); // PAPI (static red/white look)
    land.add(new THREE.BoxGeometry(23, 0.08, ap.len * 0.7), 0x3b4048, [ap.x + side * 70, -0.03, ap.z - ap.len * 0.35]); // taxiway
    land.add(new THREE.BoxGeometry(140, 0.08, 180), st.apron, [ap.x + side * 85, -0.025, ap.z - 20]);
    for (let i = 0; i < 4; i++) land.add(new THREE.BoxGeometry(0.4, 0.02, 40), 0xf5c542, [ap.x + side * (60 + i * 25), 0.03, ap.z - 20]);
    // terminal: hall + glass facade + roof canopy + columns + jet bridges
    const tx = ap.x + side * 125, tz = ap.z - 20;
    deco.add(new THREE.BoxGeometry(40, 14, 130), 0xe3e8f0, [tx, 7, tz]);
    deco.add(new THREE.BoxGeometry(0.6, 9, 124), 0x2b5d8f, [tx - side * 20.1, 7, tz]);
    for (let i = -6; i <= 6; i++) deco.add(new THREE.BoxGeometry(0.8, 9.5, 0.6), 0xcfd6e2, [tx - side * 20.4, 7, tz + i * 10]);
    deco.add(new THREE.BoxGeometry(52, 1.2, 140), 0xf7f9fc, [tx - side * 4, 14.6, tz]);
    deco.add(new THREE.CylinderGeometry(36, 36, 140, 16, 1, false, 0, Math.PI), 0xdfe6ef, [tx, 15, tz], [Math.PI / 2, 0, 0], [0.55, 1, 0.12]);
    for (const bz of [-35, 15]) { deco.add(new THREE.BoxGeometry(26, 3.2, 3.2), 0xc7ced9, [tx - side * 33, 6, tz + bz]); deco.add(new THREE.CylinderGeometry(0.5, 0.5, 5, 6), 0x777f8c, [tx - side * 44, 2.5, tz + bz]); }
    deco.add(new THREE.CylinderGeometry(3, 4, 42, 10), 0xe3e8f0, [ap.x + side * 160, 21, ap.z + 70]);
    deco.add(new THREE.CylinderGeometry(7, 5.5, 5, 10), 0x2b5d8f, [ap.x + side * 160, 44, ap.z + 70]);
    deco.add(new THREE.CylinderGeometry(7.8, 7.8, 1, 10), 0xf7f9fc, [ap.x + side * 160, 47, ap.z + 70]);
    deco.add(new THREE.CylinderGeometry(24, 24, 60, 14, 1, false, 0, Math.PI), 0xb8c1cf, [ap.x + side * 140, 0, ap.z - 420], [Math.PI / 2, 0, Math.PI / 2], [1, 1, 0.9]); // hangar
    // ground vehicles
    deco.add(new THREE.BoxGeometry(3, 2.2, 7), 0xe74c3c, [ap.x + side * 60, 1.4, ap.z - 90]); deco.add(new THREE.CylinderGeometry(1.2, 1.2, 6, 10), 0xdfe5ee, [ap.x + side * 60, 2.2, ap.z - 96], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 3; i++) deco.add(new THREE.BoxGeometry(2, 1.2, 3), 0xf5a623, [ap.x + side * (45 + i * 4), 0.8, ap.z + 40]);
    deco.add(new THREE.CylinderGeometry(0.15, 0.15, 8, 5), 0xdddddd, [ap.x - side * 60, 4, ap.z - 200]); deco.add(new THREE.ConeGeometry(0.8, 3, 8), 0xff7a1a, [ap.x - side * 58.5, 7.5, ap.z - 200], [0, 0, Math.PI / 2]); // windsock
    const label = new THREE.Mesh(new THREE.PlaneGeometry(30, 8), new THREE.MeshBasicMaterial({ map: textTexture(ap.code, { color: '#ffffff' }), transparent: true }));
    label.rotation.x = -Math.PI / 2; label.position.set(ap.x, 0.08, ap.z - 30); scene.add(label);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(60, 9), new THREE.MeshBasicMaterial({ map: textTexture(ap.name.toUpperCase(), { color: '#ffffff', bg: '#0a1f5c' }) }));
    sign.position.set(tx - side * 20.8, 17.5, tz); sign.rotation.y = -side * Math.PI / 2; scene.add(sign);
    // vegetation & style features
    const plant = tree[st.tree];
    for (let i = 0; i < 70; i++) {
      const x = ap.x + (R0() - 0.5) * 2000, z = ap.z - R0() * ap.len * 1.3 + 500;
      if (Math.abs(x - ap.x) < 230 || (Math.abs(x - (ap.x + side * 125)) < 80)) continue;
      plant(x, z, 0.8 + R0() * 0.6);
    }
    if (st.dunes) for (let i = 0; i < 30; i++) { const x = ap.x + (R0() < 0.5 ? -1 : 1) * (300 + R0() * 900), z = ap.z - R0() * 3200 + 400; land.add(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xe0c084, [x, -0.5, z], [0, R0() * 3, 0], [60 + R0() * 120, 10 + R0() * 22, 30 + R0() * 60]); }
    if (st.peaks) for (let i = 0; i < 16; i++) {
      const sx = R0() < 0.5 ? -1 : 1; const x = ap.x + sx * (1400 + R0() * 3200), z = ap.z - R0() * 6000 + 1500;
      const h = 350 + R0() * 650, r = h * (1.3 + R0() * 0.6);
      if (Math.abs(x - ap.x) - r < 1200 && z + r > ap.z - 600) continue; // nothing on the extended centreline
      land.add(new THREE.ConeGeometry(r, h, 7), 0x55634e, [x, h / 2 - 1, z], [0, R0() * 3, 0]);
      land.add(new THREE.ConeGeometry(r * 0.32, h * 0.32, 7), 0xf4f7fb, [x, h - h * 0.16 + 0.5, z], [0, R0() * 3, 0]);
      OBSTACLES.push({ x, z, r, h });
    }
  }
  airport(ORIGIN, -1);
  for (const r of Object.values(ROUTES)) airport(r, 1);
  // small islands along the way
  for (let i = 0; i < 22; i++) {
    const t = R0(), dst = Object.values(ROUTES)[i % 3];
    const cx = dst.x * t + (R0() - 0.5) * 5000, cz = dst.z * t - 900 + (R0() - 0.5) * 3000;
    if (Math.hypot(cx - ORIGIN.x, cz - ORIGIN.z) < 2500) continue;
    // keep direct routes and final approaches clear so a straight flight never meets a hill
    const nearLine = Object.values(ROUTES).some((r) => { const L = Math.hypot(r.x, r.z), u = (cx * r.x + cz * r.z) / (L * L); const px = r.x * Math.min(1, Math.max(0, u)), pz = r.z * Math.min(1, Math.max(0, u)); return Math.hypot(cx - px, cz - pz) < 1300; });
    const onFinal = Object.values(ROUTES).some((r) => Math.abs(cx - r.x) < 1800 && cz > r.z - 3500 && cz < r.z + 14000);
    if (nearLine || onFinal) continue;
    island(cx, cz, 250 + R0() * 500, 250 + R0() * 500, STYLES.harbor);
    const h = 60 + R0() * 160, r = 120 + R0() * 200;
    land.add(new THREE.ConeGeometry(r, h, 6), 0x3e7a3e, [cx, h / 2, cz], [0, R0() * 3, 0]);
    OBSTACLES.push({ x: cx, z: cz, r, h });
  }
  const landMesh = land.mesh({ shadows: false }); landMesh.receiveShadow = true; scene.add(landMesh);
  const decoMesh = deco.mesh(); decoMesh.castShadow = false; decoMesh.receiveShadow = true; scene.add(decoMesh);
  const lightMesh = lights.mesh({ basic: true, shadows: false }); scene.add(lightMesh);
  // clouds: one merged mesh, flat shaded puffs with greyish undersides
  const cb = new Batch();
  const nClouds = quality === 'low' ? 45 : 110;
  for (let i = 0; i < nClouds; i++) {
    const cx = (R0() - 0.6) * 26000, cy = 500 + R0() * 1000, cz = 3000 - R0() * 32000;
    const n = 4 + Math.floor(R0() * 4);
    for (let k = 0; k < n; k++) { const s = 35 + R0() * 55; cb.add(new THREE.IcosahedronGeometry(1, 1), 0xffffff, [cx + (k - n / 2) * 55 + R0() * 20, cy + R0() * 25, cz + (R0() - 0.5) * 60], [R0(), R0(), 0], [s * 1.5, s * 0.75, s * 1.1]); }
  }
  const cg = cb.geometry();
  const N = cg.attributes.normal, Cc = cg.attributes.color;
  for (let i = 0; i < N.count; i++) { const shade = 0.78 + 0.22 * Math.max(0, N.getY(i)); Cc.setXYZ(i, shade, shade, Math.min(1, shade + 0.03)); }
  const clouds = new THREE.Mesh(cg, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x555a66 }));
  scene.add(clouds);
  return { sky, hemi, sun, clouds, sea };
}

export { box, aabb, textTexture };
