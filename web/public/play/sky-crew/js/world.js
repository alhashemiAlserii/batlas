// Scene construction: the BA-2 "Tidewing" airliner (exterior + walkable interior) and the world (sky, sea, airports).
// Aircraft parts live in the `plane` group's LOCAL frame: cabin floor y=0, nose toward -z.
// Layout (nose -> tail): cockpit, forward cargo hold (cargo door on the right), passenger cabin with a
// wide blue aisle, rear galley + lavatories, and the MAIN ENTRANCE in the REAR WALL (z = Z_TAIL) with
// air-stairs behind the aircraft. Static parts are merged into vertex-coloured batches (few draw calls).
import * as THREE from '../../vendor/three.module.js';
import { RoundedBoxGeometry } from '../../vendor/addons/RoundedBoxGeometry.js';
import { Batch, loft, slab, fin, canvasTexture, rng } from './geo.js';

export const GEAR_H = 2.4; // cabin floor height above ground when parked
export const HALF_W = 2.2; // interior half width (wide cabin, 1.4 m aisle)
export const CEIL = 2.6;
export const Z_NOSE = -16, Z_TAIL = 13, Z_COCKPIT = -13;
export const Z_HOLD0 = -13, Z_HOLD1 = -8; // forward cargo hold
export const Z_CARGO = Z_HOLD0; // legacy name: start of the cargo hold
export const CARGO_DOOR = { x: HALF_W, z0: -11.9, z1: -9.9 };
/** Main entrance / exit: a plug door in the rear wall, opening outward and swinging to the right. */
export const REAR_DOOR = { z: Z_TAIL, x0: -0.6, x1: 0.6, h: 2.1 };
export const ROW_Z0 = -6.9, ROW_PITCH = 1.25, ROWS = 12;
export const SEAT_X = [-1.62, -1.0, 1.0, 1.62];
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
const C = { hull: 0xf4f6fb, navy: 0x0a1f5c, teal: 0x19d3c5, blue: 0x1e6bff, glassOut: 0x14243f, metal: 0x9aa4b5, dark: 0x1b2333, tire: 0x161616, grey: 0x6b7385, panel: 0xeef1f7, panel2: 0xd5dbe7, bin: 0xf6f7fb, galley: 0xcfd6e2, steel: 0xb8c0cc, cargo: 0x7b8494, cargoFloor: 0x4f5868, wood: 0x8a6a3a };
/** Colourful seat palette: cushion / backrest pairs (the pattern repeats in blocks of rows). */
const SEAT_COLORS = [[0x2f7bff, 0x1f56c9], [0xff5a6e, 0xd63b51], [0x23c4a6, 0x139a82], [0xffb627, 0xe0901a], [0x8f5cff, 0x6c3fd6]];

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
const rbox = (w, h, d, r = 0.04, seg = 1) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
/** Rounded rectangle as a THREE.Path/Shape (centre cx, cy). */
function rrect(path, cx, cy, w, h, r) {
  const x = cx - w / 2, y = cy - h / 2;
  path.moveTo(x + r, y); path.lineTo(x + w - r, y); path.quadraticCurveTo(x + w, y, x + w, y + r); path.lineTo(x + w, y + h - r); path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h); path.quadraticCurveTo(x, y + h, x, y + h - r); path.lineTo(x, y + r); path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

// Fuselage cross-section: circle radius R centred at y = CY (floor at y = 0).
const R = 2.75, CY = 1.2;
const ring = (z, k = 1, cy = CY, ry = null) => ({ z, cy, rx: R * k, ry: ry ?? R * k });
/** theta range on the hull (0 = bottom) that covers y in [y0, y1] on one side (+1 = +x). */
function thetaSpan(y0, y1, side) {
  const a = Math.acos(Math.max(-1, Math.min(1, -(y0 - CY) / R))), b = Math.acos(Math.max(-1, Math.min(1, -(y1 - CY) / R)));
  return side > 0 ? [a, b] : [Math.PI * 2 - b, Math.PI * 2 - a];
}
export const WIN_Y = 1.3;
const rowZ = (r) => ROW_Z0 + r * ROW_PITCH;
const WIN_Z = []; for (let r = 0; r < ROWS; r++) WIN_Z.push(rowZ(r) - 0.12);

export function buildPlane() {
  const plane = new THREE.Group();
  plane.name = 'plane';
  const colliders = [];
  const interact = [];
  const T = 0.12; // wall thickness
  const ext = new Batch(), int = new Batch(), glow = new Batch();
  const B = (b, w, h, d, c, x, y, z, rot) => b.add(new THREE.BoxGeometry(w, h, d), c, [x, y, z], rot || [0, 0, 0]);
  const RB = (b, w, h, d, r, c, x, y, z, rot) => b.add(rbox(w, h, d, r), c, [x, y, z], rot || [0, 0, 0]);
  const CYL = (b, rt, rb, h, c, pos, rot, seg = 10) => b.add(new THREE.CylinderGeometry(rt, rb, h, seg), c, pos, rot || [0, 0, 0]);

  // =================== EXTERIOR ===================
  const noseL = 5.0, nose = [];
  for (const s of [5.0, 4.92, 4.75, 4.45, 4.0, 3.4, 2.7, 1.9, 1.05, 0.4, 0]) {
    const k = s / noseL;
    const r = Math.max(0.04, Math.pow(1 - Math.pow(k, 2.3), 1 / 2.1));
    nose.push(ring(Z_NOSE - s, r, CY - 0.55 * Math.pow(k, 1.6), R * r * (1 - 0.06 * k)));
  }
  ext.add(loft(nose, 32), C.hull);
  const wsRings = nose.filter((r) => r.z > Z_NOSE - 2.1 && r.z < Z_NOSE - 0.5).map((r) => ({ ...r, rx: r.rx * 1.006, ry: r.ry * 1.006 }));
  ext.add(loft(wsRings, 14, Math.PI - 0.95, 1.9), C.glassOut);
  for (const t0 of [Math.PI - 1.35, Math.PI + 1.03]) ext.add(loft([ring(Z_NOSE - 1.0, 0.985 * 1.006), ring(Z_NOSE + 0.6, 1.006)], 6, t0, 0.32), C.glassOut);
  // tube: one hole for the cargo door (right side, forward)
  const cdoor = thetaSpan(-0.05, 2.0, 1);
  const segs = [[Z_NOSE, CARGO_DOOR.z0, null], [CARGO_DOOR.z0, CARGO_DOOR.z1, cdoor], [CARGO_DOOR.z1, Z_TAIL, null]];
  for (const [z0, z1, hole] of segs) {
    const rr = [ring(z0), ring(z1)];
    if (!hole) ext.add(loft(rr, 36), C.hull);
    else ext.add(loft(rr, 30, hole[1], Math.PI * 2 - (hole[1] - hole[0])), C.hull);
    const big = rr.map((r) => ({ ...r, rx: r.rx * 1.004, ry: r.ry * 1.004 }));
    ext.add(loft(big, 10, -0.8, 1.6), C.navy);
    for (const side of [1, -1]) {
      if (hole && side > 0) continue;
      const t = side > 0 ? [1.36, 1.47] : [Math.PI * 2 - 1.47, Math.PI * 2 - 1.36];
      ext.add(loft(big, 2, t[0], t[1] - t[0]), C.teal);
      const t2 = side > 0 ? [1.2, 1.32] : [Math.PI * 2 - 1.32, Math.PI * 2 - 1.2];
      ext.add(loft(big, 2, t2[0], t2[1] - t2[0]), C.blue);
    }
  }
  // Upswept tail boom: starts ABOVE the rear door so the rear wall (with the main door) faces aft.
  const tailL = 7.5, tail = [];
  const TOP = CY + R, DOOR_TOP = REAR_DOOR.h + 0.35;
  for (const s of [0, 0.6, 1.4, 2.4, 3.5, 4.6, 5.7, 6.6, 7.2, 7.5]) {
    const k = s / tailL;
    const top = TOP - 0.5 * Math.pow(k, 1.5), bottom = DOOR_TOP + 0.95 * Math.pow(k, 0.85);
    tail.push({ z: Z_TAIL + s, cy: (top + bottom) / 2, ry: Math.max(0.1, (top - bottom) / 2), rx: Math.max(0.1, 2.3 * (1 - 0.93 * Math.pow(k, 1.05))) });
  }
  ext.add(loft(tail, 32), C.hull);
  ext.add(loft(tail.slice(0, 6).map((r) => ({ ...r, rx: r.rx * 1.004, ry: r.ry * 1.004 })), 10, -0.7, 1.4), C.navy);
  // rear bulkhead (outside face): the full hull cross-section with the door opening
  {
    const sh = new THREE.Shape(); sh.absarc(0, CY, R * 1.002, 0, Math.PI * 2, false);
    const hole = new THREE.Path(); rrect(hole, 0, REAR_DOOR.h / 2 + 0.02, REAR_DOOR.x1 - REAR_DOOR.x0 + 0.04, REAR_DOOR.h + 0.04, 0.14); sh.holes.push(hole);
    const g = new THREE.ShapeGeometry(sh, 40);
    ext.add(g, C.hull, [0, 0, Z_TAIL + 0.002]);
    // navy lower band + teal stripe continue round the back
    const band = new THREE.Shape(); band.absarc(0, CY, R * 1.003, Math.PI * 1.22, Math.PI * 1.78, false); band.lineTo(Math.cos(Math.PI * 1.22) * R, CY + Math.sin(Math.PI * 1.22) * R);
    ext.add(new THREE.ShapeGeometry(band, 16), C.navy, [0, 0, Z_TAIL + 0.004]);
    // door frame with yellow/black warning stripes (own textured mesh), and the tail light
    const frame = new THREE.Shape(); rrect(frame, 0, REAR_DOOR.h / 2 + 0.02, 1.6, REAR_DOOR.h + 0.36, 0.22);
    const fh = new THREE.Path(); rrect(fh, 0, REAR_DOOR.h / 2 + 0.02, REAR_DOOR.x1 - REAR_DOOR.x0 + 0.04, REAR_DOOR.h + 0.04, 0.14); frame.holes.push(fh);
    const fg = new THREE.ShapeGeometry(frame, 12);
    const stripes = canvasTexture(128, 128, (g2, w, h) => { g2.fillStyle = '#ffc61a'; g2.fillRect(0, 0, w, h); g2.fillStyle = '#1b1b1b'; for (let i = -4; i < 8; i++) { g2.beginPath(); g2.moveTo(i * 32, 0); g2.lineTo(i * 32 + 16, 0); g2.lineTo(i * 32 + 16 + h, h); g2.lineTo(i * 32 + h, h); g2.fill(); } }, { repeat: [3, 3] });
    const fm = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ map: stripes })); fm.position.z = Z_TAIL + 0.012; plane.add(fm);
    const fmIn = fm.clone(); fmIn.rotation.y = Math.PI; fmIn.position.z = Z_TAIL - T - 0.012; plane.add(fmIn);
    glow.box(0.25, 0.12, 0.04, 0xffffff, 0, TOP - 0.25, Z_TAIL + 7.4); // tail light
  }
  // wing-body fairing
  ext.add(loft([{ z: -4.5, cy: -0.75, rx: 1.2, ry: 0.4 }, { z: -3.2, cy: -0.95, rx: 2.55, ry: 0.8 }, { z: 3.8, cy: -0.95, rx: 2.65, ry: 0.82 }, { z: 6.0, cy: -0.7, rx: 1.4, ry: 0.4 }], 20, -Math.PI / 2 - 0.1, Math.PI + 0.2), C.panel2);
  // window decals (outside), aligned with the cabin windows; cockpit side windows
  const winX = Math.sqrt(R * R - (WIN_Y - CY) ** 2) + 0.012;
  for (const side of [-1, 1]) for (const z of WIN_Z) {
    const g = new THREE.CircleGeometry(0.2, 14); g.scale(0.85, 1.25, 1);
    ext.add(g, C.glassOut, [side * winX, WIN_Y, z], [0, side * Math.PI / 2, 0]);
  }
  // cargo door seams
  { const span = thetaSpan(-0.1, 2.08, 1); for (const zz of [CARGO_DOOR.z0 - 0.04, CARGO_DOOR.z1 + 0.04]) ext.add(loft([ring(zz - 0.03, 1.005), ring(zz + 0.03, 1.005)], 6, span[0], span[1] - span[0]), C.grey); }
  for (const side of [-1, 1]) {
    const name = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 1.0), new THREE.MeshLambertMaterial({ map: textTexture('BATLAS AIR'), transparent: true }));
    const y = 2.45, x = Math.sqrt(R * R - (y - CY) ** 2) + 0.02;
    name.position.set(side * x, y, -1); name.rotation.y = side * Math.PI / 2; plane.add(name);
  }
  // wings + winglets + engines + stabilisers
  for (const side of [-1, 1]) {
    const pts = [[1.6, -2.9], [16.2, 3.7], [16.2, 5.0], [1.6, 3.2]].map(([x, z]) => [x * side, z]);
    const w = slab(pts, 0.36, 0.05);
    const m = new THREE.Matrix4().makeTranslation(0, -1.0, 0).multiply(new THREE.Matrix4().makeRotationZ(side * 0.065));
    ext.addMatrix(w, C.hull, m);
    ext.addMatrix(slab([[13.4, 2.3], [16.25, 3.65], [16.25, 4.1], [13.4, 2.9]].map(([x, z]) => [x * side, z]), 0.38, 0.05), C.navy, m);
    for (const fx of [5.5, 9.0, 12.4]) { const z = 3.2 + (fx - 2) * (1.8 / 14.2); const g = new THREE.ConeGeometry(0.14, 1.4, 6); g.rotateX(Math.PI / 2); ext.addMatrix(g, C.panel2, m.clone().multiply(new THREE.Matrix4().makeTranslation(side * fx, -0.2, z + 0.4))); }
    ext.addMatrix(fin([[3.7, 0], [5.0, 0], [5.6, 1.7], [4.9, 1.7]], 0.12, 0.03), C.navy, m.clone().multiply(new THREE.Matrix4().makeTranslation(side * 16.2, 0.1, 0)).multiply(new THREE.Matrix4().makeRotationZ(-side * 0.18)));
    const ex = side * 6.6, ey = -2.1;
    ext.add(loft([{ z: -4.6, cy: ey, rx: 0.86, ry: 0.86 }, { z: -4.35, cy: ey, rx: 0.95, ry: 0.95 }, { z: -3.2, cy: ey, rx: 0.98, ry: 0.98 }, { z: -1.4, cy: ey, rx: 0.9, ry: 0.9 }, { z: -0.4, cy: ey, rx: 0.62, ry: 0.62 }].map((r) => ({ ...r, cx: ex })), 20), C.panel);
    ext.add(loft([{ z: -4.62, cy: ey, rx: 0.88, ry: 0.88, cx: ex }, { z: -4.2, cy: ey, rx: 0.97, ry: 0.97, cx: ex }], 20), C.navy);
    const fan = new THREE.CircleGeometry(0.84, 20); fan.rotateY(Math.PI); ext.add(fan, C.dark, [ex, ey, -4.5]);
    const spin = new THREE.ConeGeometry(0.28, 0.55, 12); spin.rotateX(-Math.PI / 2); ext.add(spin, C.steel, [ex, ey, -4.62]);
    const exh = new THREE.ConeGeometry(0.5, 1.2, 14); exh.rotateX(-Math.PI / 2); ext.add(exh, C.grey, [ex, ey, 0.2]);
    ext.add(slab([[ex - 0.15 * side, -3.4], [ex + 0.15 * side, -3.4], [ex + 0.15 * side, 0.6], [ex - 0.15 * side, 0.6]], 0.9, 0.03), C.panel, [0, -1.4, 0]);
    const hs = slab([[0.4, Z_TAIL + 3.0], [5.6, Z_TAIL + 6.0], [5.6, Z_TAIL + 6.9], [0.4, Z_TAIL + 6.4]].map(([x, z]) => [x * side, z]), 0.2, 0.03);
    ext.addMatrix(hs, C.hull, new THREE.Matrix4().makeTranslation(0, 3.3, 0).multiply(new THREE.Matrix4().makeRotationZ(side * 0.08)));
  }
  const finPts = [[Z_TAIL + 1.6, 3.4], [Z_TAIL + 5.0, 9.2], [Z_TAIL + 6.7, 9.2], [Z_TAIL + 7.4, 3.4]];
  const finGeo = fin(finPts, 0.34, 0.06);
  const finTex = canvasTexture(512, 512, (g, w, h) => drawWaveLivery(g, w, h));
  const logo = new Image(); logo.src = '/img/batlas-mark.png';
  logo.onload = () => { const g = finTex.image.getContext('2d'); g.save(); g.globalAlpha = 0.95; g.drawImage(logo, 300, 150, 150, 150); g.restore(); finTex.needsUpdate = true; };
  finTex.wrapS = finTex.wrapT = THREE.ClampToEdgeWrapping;
  finTex.repeat.set(1 / 6.5, 1 / 6.2); finTex.offset.set(-(Z_TAIL + 1.3) / 6.5, -3.3 / 6.2);
  const finMesh = new THREE.Mesh(finGeo, new THREE.MeshLambertMaterial({ map: finTex }));
  finMesh.castShadow = true; plane.add(finMesh);
  // landing gear
  const gb = new Batch();
  for (const [gx, gz, main] of [[0, -12.8, false], [-3.0, 1.6, true], [3.0, 1.6, true]]) {
    const top = main ? -1.0 : -1.3, bot = -GEAR_H + 0.48;
    CYL(gb, 0.11, 0.11, top - bot, C.steel, [gx, (top + bot) / 2, gz], null, 8);
    gb.box(0.5, 0.08, 0.12, C.steel, gx, bot, gz);
    for (const dx of main ? [-0.36, 0.36] : [-0.2, 0.2]) for (const dz of main ? [-0.55, 0.55] : [0]) {
      CYL(gb, 0.48, 0.48, 0.3, C.tire, [gx + dx, -GEAR_H + 0.48, gz + dz], [0, 0, Math.PI / 2], 14);
      CYL(gb, 0.24, 0.24, 0.32, C.steel, [gx + dx, -GEAR_H + 0.48, gz + dz], [0, 0, Math.PI / 2], 10);
    }
    if (main) gb.box(0.06, 1.1, 1.2, C.hull, gx + Math.sign(gx) * 0.6, -1.3, gz);
  }
  const gear = gb.mesh(); plane.add(gear);

  // =================== INTERIOR ===================
  const Z_CAB0 = Z_HOLD1, Z_CAB1 = Z_TAIL;
  // ---- floors: patterned blue aisle carpet, seat-area carpet, cockpit & hold decks
  const aisleTex = canvasTexture(256, 512, drawAisle, { repeat: [1, 10] });
  const aisle = new THREE.Mesh(new THREE.PlaneGeometry(1.36, Z_CAB1 - Z_CAB0), new THREE.MeshLambertMaterial({ map: aisleTex }));
  aisle.rotation.x = -Math.PI / 2; aisle.position.set(0, 0.004, (Z_CAB0 + Z_CAB1) / 2); aisle.receiveShadow = true; plane.add(aisle);
  const seatFloorTex = canvasTexture(256, 256, drawCarpet, { repeat: [2, 14] });
  const sfl = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, T, Z_CAB1 - Z_CAB0), new THREE.MeshLambertMaterial({ map: seatFloorTex }));
  sfl.position.set(0, -T / 2, (Z_CAB0 + Z_CAB1) / 2); sfl.receiveShadow = true; plane.add(sfl);
  for (const s of [-1, 1]) B(int, 0.06, 0.012, Z_CAB1 - Z_CAB0, 0xffc93c, s * 0.7, 0.006, (Z_CAB0 + Z_CAB1) / 2); // aisle edge trims (also emergency floor lighting)
  for (const s of [-1, 1]) for (let z = Z_CAB0 + 0.5; z < Z_CAB1 - 2.5; z += 0.9) glow.box(0.04, 0.012, 0.12, 0xfff0b0, s * 0.74, 0.012, z);
  B(int, HALF_W * 2, T, Z_COCKPIT - Z_NOSE, C.dark, 0, -T / 2, (Z_NOSE + Z_COCKPIT) / 2);
  const deck = canvasTexture(256, 256, drawDeck, { repeat: [3, 4] });
  const cfloor = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, T, Z_HOLD1 - Z_HOLD0), new THREE.MeshLambertMaterial({ map: deck }));
  cfloor.position.set(0, -T / 2, (Z_HOLD0 + Z_HOLD1) / 2); cfloor.receiveShadow = true; plane.add(cfloor);
  colliders.push(aabb(-HALF_W, -T, Z_NOSE, HALF_W, 0, Z_TAIL));
  colliders.push(aabb(-HALF_W, CEIL, Z_NOSE, HALF_W, CEIL + T, Z_TAIL));

  // ---- side walls: dado + sidewall panels with rounded windows (ShapeGeometry with holes) + window reveals + shades
  const BIN_Y = 1.9;
  function sideWall(side) {
    const x = side * HALF_W;
    // passenger cabin: one panel per side with all the window holes
    const sh = new THREE.Shape(); sh.moveTo(-Z_CAB0, 0.32); sh.lineTo(-Z_CAB1, 0.32); sh.lineTo(-Z_CAB1, BIN_Y); sh.lineTo(-Z_CAB0, BIN_Y); sh.closePath();
    for (const wz of WIN_Z) { const h = new THREE.Path(); rrect(h, -wz, WIN_Y, 0.36, 0.5, 0.15); sh.holes.push(h); }
    const g = new THREE.ShapeGeometry(sh, 8); g.rotateY(Math.PI / 2);
    int.add(g, C.panel, [x, 0, 0]);
    B(int, 0.04, 0.32, Z_CAB1 - Z_CAB0, C.panel2, x - side * 0.02, 0.16, (Z_CAB0 + Z_CAB1) / 2); // dado
    B(int, 0.05, 0.035, Z_CAB1 - Z_CAB0, 0x9aa6bb, x - side * 0.04, 0.33, (Z_CAB0 + Z_CAB1) / 2); // dado rail
    for (const wz of WIN_Z) {
      // reveal tunnel from the wall out to the hull, frame ring, half-drawn shade
      const tun = new THREE.Shape(); rrect(tun, 0, 0, 0.44, 0.58, 0.19); const th = new THREE.Path(); rrect(th, 0, 0, 0.36, 0.5, 0.15); tun.holes.push(th);
      const ring2 = new THREE.ExtrudeGeometry(tun, { depth: 0.38, bevelEnabled: false, curveSegments: 6 });
      ring2.rotateY(Math.PI / 2);
      int.add(ring2, 0xdde3ee, [x - side * 0.02, WIN_Y, wz], [0, side > 0 ? 0 : Math.PI, 0]);
      const shade = rbox(0.03, 0.18, 0.34, 0.012); int.add(shade, 0xb9c2d3, [x + side * 0.05, WIN_Y + 0.15, wz]);
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.5), glassMat); gl.position.set(x + side * 0.3, WIN_Y, wz); gl.rotation.y = side * Math.PI / 2; plane.add(gl);
    }
    // cockpit & hold walls (plain)
    colliders.push(aabb(x, 0, Z_NOSE, x + side * T, CEIL, Z_TAIL - 0.001 > 0 ? (side > 0 ? CARGO_DOOR.z0 : Z_TAIL) : Z_TAIL));
    if (side > 0) colliders.push(aabb(x, 0, CARGO_DOOR.z1, x + side * T, CEIL, Z_TAIL));
    const holdSegs = side > 0 ? [[Z_HOLD0, CARGO_DOOR.z0], [CARGO_DOOR.z1, Z_HOLD1]] : [[Z_HOLD0, Z_HOLD1]];
    for (const [a, b] of holdSegs) B(int, T, CEIL, b - a, C.cargo, x + side * T / 2, CEIL / 2, (a + b) / 2);
    B(int, T, CEIL, Z_COCKPIT - Z_NOSE, C.panel2, x + side * T / 2, CEIL / 2, (Z_NOSE + Z_COCKPIT) / 2);
    for (const wz of [-15.3, -14.4]) { const hz = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.42), glassMat); hz.position.set(x - side * 0.01, 1.55, wz); hz.rotation.y = -side * Math.PI / 2; plane.add(hz); }
  }
  sideWall(-1); sideWall(1);
  // cargo door frame (inside)
  { const xm = HALF_W + 0.2, d = CARGO_DOOR; B(int, 0.45, 0.3, d.z1 - d.z0, C.cargo, xm, CEIL - 0.15, (d.z0 + d.z1) / 2); for (const zz of [d.z0 - 0.05, d.z1 + 0.05]) B(int, 0.45, CEIL, 0.1, C.cargo, xm, CEIL / 2, zz); B(int, 0.45, 0.06, d.z1 - d.z0, C.steel, xm, -0.03, (d.z0 + d.z1) / 2); }

  // ---- doors
  const doors = {};
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function makeDoor(name, group, col, pose, dur = 1.1) {
    colliders.push(col);
    const d = {
      group, open: true, collider: col, t: 1, target: 1, onPassable: null, passable: true,
      apply(open, instant = false) { d.open = open; d.target = open ? 1 : 0; if (instant) { d.t = d.target; pose(ease(d.t)); d.sync(); } },
      update(dt) { if (d.t === d.target) return; d.t = d.target > d.t ? Math.min(d.target, d.t + dt / dur) : Math.max(d.target, d.t - dt / dur); pose(ease(d.t)); d.sync(); },
      sync() { const p = d.t > 0.55; if (p !== d.passable) { d.passable = p; col.tag = p ? `door:${name}:open` : `door:${name}`; d.onPassable?.(p); } },
      get progress() { return d.t; },
    };
    pose(1); col.tag = `door:${name}:open`;
    doors[name] = d;
  }
  // REAR MAIN DOOR: plug door in the rear wall. Pops out 12 cm, then swings outward on its right-hand hinge.
  {
    const W = REAR_DOOR.x1 - REAR_DOOR.x0, H = REAR_DOOR.h;
    const hinge = new THREE.Group(); hinge.position.set(REAR_DOOR.x1 + 0.02, 0, Z_TAIL); plane.add(hinge);
    const leaf = new THREE.Group(); leaf.position.set(-W / 2 - 0.02, 0, 0); hinge.add(leaf);
    const db = new Batch();
    const ds = new THREE.Shape(); rrect(ds, 0, H / 2 + 0.02, W, H, 0.13);
    const pw = new THREE.Path(); pw.absarc(0, 1.55, 0.15, 0, Math.PI * 2, true); ds.holes.push(pw);
    const dg = new THREE.ExtrudeGeometry(ds, { depth: T, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 10 });
    db.add(dg, C.hull, [0, 0, -T]);
    const lower = new THREE.Shape(); rrect(lower, 0, 0.5, W - 0.12, 0.72, 0.08); db.add(new THREE.ExtrudeGeometry(lower, { depth: 0.015, bevelEnabled: false }), C.navy, [0, 0, 0.005]);
    db.add(new THREE.ExtrudeGeometry(lower, { depth: 0.015, bevelEnabled: false }), C.panel2, [0, 0, -T - 0.035]);
    db.add(new THREE.TorusGeometry(0.17, 0.035, 6, 18), C.steel, [0, 1.55, 0.01]); db.add(new THREE.TorusGeometry(0.17, 0.035, 6, 18), C.steel, [0, 1.55, -T - 0.02]);
    db.add(rbox(0.36, 0.07, 0.07, 0.03), C.steel, [-0.2, 1.08, -T - 0.07]); db.add(rbox(0.05, 0.05, 0.08, 0.02), C.steel, [-0.36, 1.08, -T - 0.03]); // inner lever handle
    db.add(rbox(0.26, 0.06, 0.06, 0.025), 0x444b59, [-0.25, 1.05, 0.05]); // outer flush handle
    db.add(rbox(0.5, 0.12, 0.012, 0.02), 0xff3b4a, [0, 1.9, -T - 0.03]); // EXIT placard
    for (const y of [0.35, 1.7]) db.add(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 8), C.steel, [W / 2 + 0.0, y, -T / 2]);
    const leafMesh = db.mesh({ side: THREE.DoubleSide }); leaf.add(leafMesh);
    const pg = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), glassMat); pg.position.set(0, 1.55, -T / 2); leaf.add(pg);
    const exitTex = textTexture('EXIT', { w: 256, h: 64, font: 'bold 48px -apple-system, Segoe UI, sans-serif', color: '#ffffff', bg: '#d81e2c' });
    const exitPl = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.11), new THREE.MeshBasicMaterial({ map: exitTex })); exitPl.position.set(0, 1.9, -T - 0.038); exitPl.rotation.y = Math.PI; leaf.add(exitPl);
    const col = aabb(REAR_DOOR.x0, 0, Z_TAIL - T, REAR_DOOR.x1, REAR_DOOR.h, Z_TAIL + 0.05, 'door:rear');
    makeDoor('rear', hinge, col, (k) => { const pop = Math.min(1, k / 0.2); hinge.position.z = Z_TAIL + 0.14 * pop; hinge.rotation.y = Math.max(0, (k - 0.15) / 0.85) * 1.78; });
  }
  // cargo door: hull plug that slides out and forward
  {
    const d = CARGO_DOOR, g = new THREE.Group();
    const span = thetaSpan(-0.05, 2.0, 1);
    const geo = loft([ring(d.z0 - (d.z0 + d.z1) / 2), ring(d.z1 - (d.z0 + d.z1) / 2)], 8, span[0], span[1] - span[0]);
    const db = new Batch(); db.add(geo, C.hull); db.box(0.06, 0.14, 0.4, C.steel, R - 0.25, 1.0, 0); db.box(0.03, 0.3, 0.6, 0xffc61a, R - 0.05, 0.2, 0);
    g.add(db.mesh({ side: THREE.DoubleSide })); g.position.set(0, 0, (d.z0 + d.z1) / 2); plane.add(g);
    const col = aabb(HALF_W, 0, d.z0, HALF_W + T, CEIL, d.z1, 'door:cargo');
    const cz = (d.z0 + d.z1) / 2;
    makeDoor('cargo', g, col, (k) => { g.position.x = Math.min(1, k / 0.3) * 0.45; g.position.z = cz - Math.max(0, (k - 0.3) / 0.7) * 2.2; }, 1.3);
  }

  // ---- end walls / bulkheads / partitions
  B(int, HALF_W * 2, 1.05, T, C.dark, 0, 0.525, Z_NOSE - T / 2);
  colliders.push(aabb(-HALF_W, 0, Z_NOSE - T, HALF_W, CEIL, Z_NOSE));
  for (const px of [-1.3, 0, 1.3]) B(int, 0.1, 1.45, 0.08, C.dark, px, 1.75, Z_NOSE - 0.05);
  B(int, HALF_W * 2, 0.12, 0.1, C.dark, 0, 2.44, Z_NOSE - 0.05);
  const wsGlass = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, 1.4), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.12, depthWrite: false }));
  wsGlass.position.set(0, 1.75, Z_NOSE - 0.07); plane.add(wsGlass);
  // rear wall (inside face) with the door opening
  {
    const sh = new THREE.Shape(); sh.moveTo(-HALF_W, 0); sh.lineTo(HALF_W, 0); sh.lineTo(HALF_W, CEIL); sh.lineTo(-HALF_W, CEIL); sh.closePath();
    const hole = new THREE.Path(); rrect(hole, 0, REAR_DOOR.h / 2 + 0.02, REAR_DOOR.x1 - REAR_DOOR.x0 + 0.04, REAR_DOOR.h + 0.04, 0.14); sh.holes.push(hole);
    int.add(new THREE.ExtrudeGeometry(sh, { depth: T, bevelEnabled: false, curveSegments: 8 }), C.panel2, [0, 0, Z_TAIL - T]);
    colliders.push(aabb(-HALF_W, 0, Z_TAIL - T, REAR_DOOR.x0, CEIL, Z_TAIL), aabb(REAR_DOOR.x1, 0, Z_TAIL - T, HALF_W, CEIL, Z_TAIL), aabb(REAR_DOOR.x0, REAR_DOOR.h, Z_TAIL - T, REAR_DOOR.x1, CEIL, Z_TAIL));
    B(int, REAR_DOOR.x1 - REAR_DOOR.x0 + 0.1, 0.05, 0.3, C.steel, 0, 0.0, Z_TAIL - 0.05); // threshold plate
    glow.box(0.5, 0.14, 0.03, 0x22e06b, 0, REAR_DOOR.h + 0.25, Z_TAIL - T - 0.02); // EXIT sign
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.12), new THREE.MeshBasicMaterial({ map: textTexture('EXIT ⇩', { w: 256, h: 64, font: 'bold 46px -apple-system, Segoe UI, sans-serif', color: '#ffffff', bg: '#12a84f' }) }));
    sign.position.set(0, REAR_DOOR.h + 0.25, Z_TAIL - T - 0.04); sign.rotation.y = Math.PI; plane.add(sign);
  }
  function partition(z, gap, col, colFrame) {
    const wL = HALF_W - gap;
    RB(int, wL, CEIL, 0.1, 0.03, col, -(gap + wL / 2), CEIL / 2, z); RB(int, wL, CEIL, 0.1, 0.03, col, gap + wL / 2, CEIL / 2, z);
    B(int, gap * 2, 0.45, 0.1, col, 0, CEIL - 0.225, z);
    for (const s of [-1, 1]) RB(int, 0.08, CEIL - 0.45, 0.14, 0.03, colFrame, s * gap, (CEIL - 0.45) / 2, z);
    colliders.push(aabb(-HALF_W, 0, z - 0.05, -gap, CEIL, z + 0.05), aabb(gap, 0, z - 0.05, HALF_W, CEIL, z + 0.05));
  }
  partition(Z_COCKPIT, 0.5, C.galley, C.steel);
  partition(Z_HOLD1, 0.7, C.panel2, 0x9aa6bb);
  // cabin bulkhead decoration (front of the cabin): Batlas wave mural
  { const tex = canvasTexture(512, 256, (g, w, h) => drawWaveLivery(g, w, h)); for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.2), new THREE.MeshLambertMaterial({ map: tex })); m.position.set(s * 1.45, 1.35, Z_HOLD1 + 0.055); plane.add(m); } }

  // ---- cockpit
  B(int, HALF_W * 2, 1.0, 0.45, C.dark, 0, 0.5, Z_NOSE + 0.22);
  B(int, HALF_W * 2 - 0.2, 0.2, 0.55, 0x24304a, 0, 1.08, Z_NOSE + 0.3, [-0.3, 0, 0]);
  colliders.push(aabb(-HALF_W, 0, Z_NOSE, HALF_W, 1.0, Z_NOSE + 0.45));
  for (const sx of [-0.6, 0.6]) {
    pilotSeat(int, sx, -14.6);
    colliders.push(aabb(sx - 0.3, 0, -14.9, sx + 0.3, 0.48, -14.3));
    glow.box(0.46, 0.3, 0.03, 0x0b3a66, sx - 0.1, 1.02, Z_NOSE + 0.47); glow.box(0.42, 0.26, 0.031, 0x19b4e6, sx - 0.1, 1.02, Z_NOSE + 0.475);
    glow.box(0.3, 0.26, 0.031, 0x1fd58a, sx + 0.28, 1.02, Z_NOSE + 0.475);
    CYL(int, 0.035, 0.035, 0.5, C.metal, [sx, 0.62, -15.3], [0.35, 0, 0]);
    B(int, 0.36, 0.06, 0.05, C.dark, sx, 0.88, -15.4); B(int, 0.06, 0.16, 0.05, C.dark, sx - 0.16, 0.83, -15.4); B(int, 0.06, 0.16, 0.05, C.dark, sx + 0.16, 0.83, -15.4);
  }
  RB(int, 0.42, 0.75, 0.8, 0.05, C.dark, 0, 0.38, -14.9);
  glow.box(0.25, 0.18, 0.02, 0x19d3e6, 0, 0.76, -15.31);
  const throttleLever = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.07), new THREE.MeshLambertMaterial({ color: 0xcfd6e2 }));
  throttleLever.position.set(0, 0.86, -15.0); plane.add(throttleLever);
  B(int, 1.4, 0.08, 0.9, C.dark, 0, CEIL - 0.04, -15.2);
  for (let i = 0; i < 18; i++) glow.box(0.06, 0.02, 0.06, [0xffffff, 0x3ddc84, 0xf5c542][i % 3], -0.55 + (i % 9) * 0.14, CEIL - 0.09, -15.45 + Math.floor(i / 9) * 0.3);
  interact.push({ id: 'seat_captain', kind: 'pilot', label: 'Take the captain\'s seat (Pilot)', pos: new THREE.Vector3(-0.6, 0.9, -14.6) });
  interact.push({ id: 'seat_copilot', kind: 'copilot', label: 'Take the first officer\'s seat (Co-pilot)', pos: new THREE.Vector3(0.6, 0.9, -14.6) });

  // ---- forward cargo hold: nets, tie-down rails, crates, maintenance panel
  for (const z of [Z_HOLD0 + 0.6, Z_HOLD1 - 0.6]) for (const s of [-1, 1]) B(int, 0.07, CEIL, 0.07, C.metal, s * 1.5, CEIL / 2, z);
  for (let i = 0; i < 7; i++) B(int, 0.02, 0.02, Z_HOLD1 - Z_HOLD0 - 1.2, 0x3a414d, -1.5, 0.3 + i * 0.32, (Z_HOLD0 + Z_HOLD1) / 2);
  for (let i = 0; i < 10; i++) B(int, 0.02, CEIL - 0.2, 0.02, 0x3a414d, -1.5, (CEIL - 0.2) / 2 + 0.1, Z_HOLD0 + 0.8 + i * 0.38);
  for (const s of [-1, 1]) B(int, 0.06, 0.03, Z_HOLD1 - Z_HOLD0, 0xc0c6d0, s * 0.9, 0.015, (Z_HOLD0 + Z_HOLD1) / 2);
  RB(int, 0.9, 0.9, 0.9, 0.05, C.wood, -1.75, 0.45, Z_HOLD1 - 1.1); RB(int, 0.6, 0.5, 0.7, 0.04, 0x9b7b48, -1.8, 1.15, Z_HOLD1 - 1.05);
  colliders.push(aabb(-2.2, 0, Z_HOLD1 - 1.55, -1.3, 0.9, Z_HOLD1 - 0.65));
  B(int, 0.08, 0.7, 0.9, C.dark, HALF_W - 0.05, 1.3, Z_HOLD1 - 0.9);
  const panelLight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.12), M.screen); panelLight.position.set(HALF_W - 0.1, 1.5, Z_HOLD1 - 0.9); plane.add(panelLight);
  for (let i = 0; i < 6; i++) glow.box(0.02, 0.05, 0.05, [0xf5c542, 0x3ddc84][i % 2], HALF_W - 0.1, 1.15, Z_HOLD1 - 1.15 + i * 0.1);
  interact.push({ id: 'panel', kind: 'panel', label: 'Maintenance panel', pos: new THREE.Vector3(HALF_W - 0.1, 1.3, Z_HOLD1 - 0.9) });
  B(int, HALF_W * 2, 0.05, Z_HOLD1 - Z_HOLD0, C.cargo, 0, CEIL + 0.03, (Z_HOLD0 + Z_HOLD1) / 2);
  B(int, HALF_W * 2, 0.05, Z_COCKPIT - Z_NOSE, C.panel2, 0, CEIL + 0.03, (Z_NOSE + Z_COCKPIT) / 2);

  // ---- passenger seats: rounded cushions, backrests, headrest covers, armrests, legs, tray tables
  const seats = [];
  for (let r = 0; r < ROWS; r++) {
    const z = rowZ(r);
    const [cu, bk] = SEAT_COLORS[Math.floor(r / 2) % SEAT_COLORS.length];
    SEAT_X.forEach((sx, i) => {
      cabinSeat(int, sx, z, cu, bk, i === 0 || i === 3 ? 'wall' : 'aisle');
      colliders.push(aabb(sx - 0.3, 0, z - 0.27, sx + 0.3, 0.5, z + 0.22), aabb(sx - 0.3, 0, z + 0.2, sx + 0.3, 1.2, z + 0.34));
      seats.push({ x: sx, z, row: r + 1, letter: 'ABCD'[i] });
    });
  }
  // ---- overhead bins: closed lids with latches, some open showing the luggage inside; PSU strip below
  const signMat = new THREE.MeshBasicMaterial({ color: 0x333a48 });
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xfff4e0 });
  const coveMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff });
  const signs = new THREE.Group(); plane.add(signs);
  const bins = [];
  const BZ0 = Z_CAB0 + 0.35, BZ1 = rowZ(ROWS - 1) + 0.8, BX0 = 1.32;
  const binRand = rng(4242);
  for (const side of [-1, 1]) {
    const x0 = side * BX0, x1 = side * HALF_W, L = BZ1 - BZ0, cz = (BZ0 + BZ1) / 2;
    RB(int, Math.abs(x1 - x0) + 0.02, 0.07, L, 0.03, C.bin, (x0 + x1) / 2, BIN_Y, cz); // bin floor
    B(int, 0.03, 0.6, L, 0x8a93a6, x1 - side * 0.02, BIN_Y + 0.33, cz); // back wall (dark interior)
    B(int, Math.abs(x1 - x0), 0.03, L, 0x8a93a6, (x0 + x1) / 2, BIN_Y + 0.62, cz); // ceiling of the bin
    const nSec = Math.round(L / ROW_PITCH);
    for (let k = 0; k <= nSec; k++) B(int, Math.abs(x1 - x0), 0.6, 0.03, 0x8a93a6, (x0 + x1) / 2, BIN_Y + 0.33, BZ0 + (L * k) / nSec);
    for (let k = 0; k < nSec; k++) {
      const zc = BZ0 + (L * (k + 0.5)) / nSec, len = L / nSec - 0.04;
      const open = (k + (side > 0 ? 1 : 0)) % 3 === 0;
      // luggage inside every bin (visible when open)
      let zz = zc - len / 2 + 0.08;
      while (zz < zc + len / 2 - 0.25) {
        const t = binRand(), w = 0.26 + binRand() * 0.3, colB = [0xe74c3c, 0x2980b9, 0x27ae60, 0x8e44ad, 0xf39c12, 0x34495e, 0xff7eb6, 0x16a085, 0xd35400][Math.floor(binRand() * 9)];
        if (zz + w > zc + len / 2 - 0.05) break;
        const bx = side * (HALF_W - 0.42);
        if (t < 0.55) { RB(int, 0.48, 0.34, w, 0.05, colB, bx, BIN_Y + 0.21, zz + w / 2, [0, 0, 0]); B(int, 0.05, 0.03, w * 0.5, 0x222831, bx - side * 0.25, BIN_Y + 0.28, zz + w / 2); }
        else if (t < 0.85) { int.add(new THREE.CapsuleGeometry(0.15, Math.max(0.05, w - 0.3), 4, 10), colB, [bx, BIN_Y + 0.19, zz + w / 2], [Math.PI / 2, 0, 0]); B(int, 0.04, 0.04, w * 0.6, 0x222831, bx, BIN_Y + 0.35, zz + w / 2); }
        else { RB(int, 0.36, 0.44, w * 0.8, 0.08, colB, bx, BIN_Y + 0.26, zz + w / 2); RB(int, 0.2, 0.16, w * 0.6, 0.05, 0xf5f0e1, bx - side * 0.12, BIN_Y + 0.2, zz + w / 2); }
        zz += w + 0.04;
      }
      // lid: curved-looking rounded panel hinged at the top edge
      const lid = rbox(0.05, 0.6, len, 0.025, 2);
      if (open) int.add(lid, C.bin, [x0 - side * 0.24, BIN_Y + 0.82, zc], [0, 0, side * 1.25]);
      else { int.add(lid, C.bin, [x0 - side * 0.03, BIN_Y + 0.33, zc], [0, 0, side * 0.18]); RB(int, 0.04, 0.05, 0.22, 0.02, 0x6f7a8e, x0 - side * 0.09, BIN_Y + 0.08, zc); glow.box(0.012, 0.012, 0.04, 0x3ddc84, x0 - side * 0.1, BIN_Y + 0.12, zc + 0.15); }
      bins.push({ side, z: zc, open });
    }
    colliders.push(aabb(x0, BIN_Y - 0.04, BZ0, x1, BIN_Y + 0.65, BZ1));
    // cove light strip along the bin top, and the cove (light blue mood lighting)
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, L), stripMat); strip.position.set(x0 - side * 0.02, BIN_Y + 0.68, cz); plane.add(strip);
    const cove = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, L), coveMat); cove.position.set(x0 - side * 0.05, BIN_Y + 0.64, cz); plane.add(cove);
    // passenger service units under the bins: reading lights, air vents (gaspers), seatbelt signs
    for (let r = 0; r < ROWS; r++) {
      const z = rowZ(r);
      RB(int, 0.72, 0.05, 0.36, 0.02, C.panel2, side * 1.68, BIN_Y - 0.06, z - 0.15);
      for (const dx of [-0.2, 0, 0.2]) { glow.add(new THREE.CircleGeometry(0.025, 10), 0xfff2c8, [side * 1.68 + dx, BIN_Y - 0.087, z - 0.08], [Math.PI / 2, 0, 0]); int.add(new THREE.CylinderGeometry(0.022, 0.028, 0.03, 10), 0xaab4c6, [side * 1.68 + dx, BIN_Y - 0.1, z - 0.24]); }
      const s = new THREE.Mesh(rbox(0.16, 0.012, 0.07, 0.005), signMat); s.position.set(side * 1.42, BIN_Y - 0.09, z - 0.2); signs.add(s);
    }
  }
  // ---- ceiling: curved centre panel, transverse seams, recessed lights, air ducts, exit signs
  const ceilR = 4.4, ceilTop = CEIL + 0.05, ceilCY = ceilTop - ceilR, ang = Math.asin((BX0 + 0.02) / ceilR);
  int.add(loft([{ z: Z_CAB0, cy: ceilCY, rx: ceilR, ry: ceilR }, { z: Z_CAB1, cy: ceilCY, rx: ceilR, ry: ceilR }], 16, Math.PI - ang, ang * 2), C.panel);
  for (let z = Z_CAB0 + ROW_PITCH / 2; z < Z_CAB1; z += ROW_PITCH) {
    int.add(loft([{ z: z - 0.015, cy: ceilCY - 0.004, rx: ceilR, ry: ceilR }, { z: z + 0.015, cy: ceilCY - 0.004, rx: ceilR, ry: ceilR }], 10, Math.PI - ang, ang * 2), 0xc5cddc);
    const lp = new THREE.Mesh(rbox(0.5, 0.012, 0.22, 0.005), stripMat); lp.position.set(0, ceilTop - 0.012, z + ROW_PITCH / 2); plane.add(lp);
  }
  for (const s of [-1, 1]) B(int, 0.1, 0.03, Z_CAB1 - Z_CAB0, 0xdfe5ef, s * 0.55, ceilTop - 0.03, (Z_CAB0 + Z_CAB1) / 2);
  // ---- rear galley (right), stowage + crew seat (left), two lavatories in the rear corners
  const GZ0 = rowZ(ROWS - 1) + 1.1, GZ1 = GZ0 + 2.0, LZ0 = Z_TAIL - 2.0;
  // galley: base cabinets with trolley bays, counter, upper cabinets, coffee maker, oven, dispensers
  RB(int, 0.72, 1.0, GZ1 - GZ0, 0.03, C.galley, HALF_W - 0.36, 0.5, (GZ0 + GZ1) / 2);
  RB(int, 0.76, 0.05, GZ1 - GZ0 + 0.04, 0.02, C.steel, HALF_W - 0.38, 1.02, (GZ0 + GZ1) / 2);
  for (let i = 0; i < 3; i++) { RB(int, 0.03, 0.8, 0.6, 0.02, i === 1 ? 0x1f56c9 : 0x9aa6bb, HALF_W - 0.73, 0.45, GZ0 + 0.35 + i * 0.65); B(int, 0.04, 0.04, 0.3, 0x2b2f3a, HALF_W - 0.76, 0.75, GZ0 + 0.35 + i * 0.65); }
  RB(int, 0.45, 0.7, GZ1 - GZ0, 0.03, C.galley, HALF_W - 0.23, 1.95, (GZ0 + GZ1) / 2);
  for (let i = 0; i < 4; i++) B(int, 0.02, 0.6, 0.46, 0xe4e9f1, HALF_W - 0.46, 1.95, GZ0 + 0.27 + i * 0.49);
  RB(int, 0.3, 0.35, 0.3, 0.04, 0x2b2f3a, HALF_W - 0.25, 1.22, GZ1 - 0.25); glow.box(0.02, 0.06, 0.1, 0xff8a3d, HALF_W - 0.41, 1.3, GZ1 - 0.25); // coffee maker
  colliders.push(aabb(HALF_W - 0.75, 0, GZ0, HALF_W, 1.05, GZ1));
  const items = [['water', 0x4cc3ff, GZ0 + 0.3, 'Grab a bottle of water'], ['snack', 0xf5a623, GZ0 + 0.85, 'Grab a snack box'], ['blanket', 0x7c5cff, GZ0 + 1.4, 'Grab a blanket']];
  for (const [kind, color, z, label] of items) {
    RB(int, 0.4, 0.24, 0.38, 0.05, color, HALF_W - 0.38, 1.17, z);
    interact.push({ id: `disp_${kind}`, kind: 'dispense', item: kind, label, pos: new THREE.Vector3(HALF_W - 0.38, 1.2, z) });
  }
  // left: stowage cabinets, folding crew seat, PA handset
  RB(int, 0.6, 2.2, GZ1 - GZ0, 0.04, C.galley, -HALF_W + 0.3, 1.1, (GZ0 + GZ1) / 2);
  for (let i = 0; i < 3; i++) { B(int, 0.02, 0.62, 0.56, 0xe4e9f1, -HALF_W + 0.61, 0.4 + i * 0.7, (GZ0 + GZ1) / 2); B(int, 0.03, 0.03, 0.18, 0x2b2f3a, -HALF_W + 0.63, 0.55 + i * 0.7, (GZ0 + GZ1) / 2); }
  colliders.push(aabb(-HALF_W, 0, GZ0, -HALF_W + 0.62, 2.2, GZ1));
  RB(int, 0.05, 0.22, 0.12, 0.02, C.dark, -HALF_W + 0.63, 1.45, GZ1 + 0.25);
  interact.push({ id: 'pa', kind: 'announce', label: 'Make a cabin announcement', pos: new THREE.Vector3(-HALF_W + 0.65, 1.45, GZ1 + 0.25) });
  // lavatory pods: rounded walls, folding doors with OCCUPIED/VACANT indicators, lights above
  for (const s of [-1, 1]) {
    const xi = s * 0.72, xo = s * HALF_W, cx = (xi + xo) / 2, wpod = Math.abs(xo - xi);
    RB(int, wpod, CEIL - 0.02, 0.08, 0.03, C.panel2, cx, (CEIL - 0.02) / 2, LZ0); // front wall
    RB(int, 0.08, CEIL - 0.02, Z_TAIL - LZ0, 0.03, C.panel2, xi, (CEIL - 0.02) / 2, (LZ0 + Z_TAIL) / 2); // aisle-side wall
    RB(int, 0.04, 2.0, 0.75, 0.03, 0xdfe5ef, xi - s * 0.05, 1.02, LZ0 + 0.9); // door
    for (let k = 0; k < 3; k++) B(int, 0.045, 1.9, 0.01, 0xc5cddc, xi - s * 0.07, 1.0, LZ0 + 0.6 + k * 0.25);
    RB(int, 0.03, 0.06, 0.16, 0.01, 0x2b2f3a, xi - s * 0.08, 1.05, LZ0 + 1.15);
    glow.box(0.02, 0.06, 0.14, s < 0 ? 0xff3b4a : 0x3ddc84, xi - s * 0.07, 2.2, LZ0 + 0.9);
    glow.box(0.02, 0.1, 0.1, 0x7fd3ff, xi - s * 0.07, 2.38, LZ0 + 0.9); // lavatory symbol light
    colliders.push(aabb(Math.min(xi, xo), 0, LZ0 - 0.05, Math.max(xi, xo), CEIL, Z_TAIL));
  }
  // ---- door controls: rear door panel on the lavatory wall by the door (inside) + outside handle; cargo door switch in the hold
  interact.push({ id: 'door_rear', kind: 'door', door: 'rear', label: 'rear door', pos: new THREE.Vector3(-0.66, 1.2, Z_TAIL - 0.45) });
  interact.push({ id: 'door_rear_out', kind: 'door', door: 'rear', label: 'rear door', pos: new THREE.Vector3(-0.3, 1.05, Z_TAIL + 0.25) });
  interact.push({ id: 'door_cargo', kind: 'door', door: 'cargo', label: 'cargo door', pos: new THREE.Vector3(HALF_W - 0.15, 1.2, CARGO_DOOR.z0 - 0.35) });
  RB(int, 0.04, 0.34, 0.24, 0.02, 0x2b2f3a, -0.69, 1.2, Z_TAIL - 0.45); glow.box(0.02, 0.1, 0.1, 0xff3b4a, -0.665, 1.25, Z_TAIL - 0.45); glow.box(0.02, 0.05, 0.1, 0x3ddc84, -0.665, 1.1, Z_TAIL - 0.45);
  RB(int, 0.06, 0.3, 0.2, 0.02, 0x2b2f3a, HALF_W - 0.03, 1.2, CARGO_DOOR.z0 - 0.35); glow.box(0.02, 0.1, 0.1, 0xff3b4a, HALF_W - 0.07, 1.25, CARGO_DOOR.z0 - 0.35);
  // ---- air-stairs (ground-only colliders): the main stair truck behind the REAR DOOR, a belt-loader ramp at the cargo door
  function rearStairs() {
    const sb = new Batch(), cols = [], width = 1.25, z0 = Z_TAIL + 0.05;
    for (let k = 1; k <= 6; k++) {
      const top = -0.4 * k, za = z0 + 0.5 * (k - 1), zb = z0 + 0.5 * k;
      sb.add(rbox(width, 0.07, 0.5, 0.02), 0xc9d0dc, [0, top - 0.035, (za + zb) / 2]);
      sb.add(new THREE.BoxGeometry(width, 0.4, 0.035), 0x8e97a6, [0, top - 0.2, zb]);
      cols.push(aabb(-width / 2, -GEAR_H, za, width / 2, top, zb, 'ground'));
    }
    sb.add(rbox(width + 0.1, 0.08, 0.4, 0.02), 0xc9d0dc, [0, -0.04, z0 - 0.15]);
    cols.push(aabb(-width / 2, -0.4, Z_TAIL - 0.2, width / 2, 0, z0, 'ground'));
    const run = Math.hypot(3.0, 2.4), ang = Math.atan2(2.4, 3.0);
    for (const dx of [-width / 2 - 0.04, width / 2 + 0.04]) {
      sb.add(new THREE.CylinderGeometry(0.03, 0.03, run, 8), 0xffc61a, [dx, 0.75, z0 + 1.6], [Math.PI / 2 - ang, 0, 0]); // handrail
      sb.add(rbox(0.07, 0.26, run, 0.02), 0x8e97a6, [dx, -1.3, z0 + 1.5], [ang, 0, 0]); // stringer
      for (let k = 0; k < 4; k++) sb.add(new THREE.CylinderGeometry(0.022, 0.022, 0.9, 6), 0xdfe5ee, [dx, -0.35 - k * 0.6 + 0.45, z0 + 0.4 + k * 0.78]);
      cols.push(aabb(dx - 0.05, -GEAR_H, z0, dx + 0.05, 1.0, z0 + 3.2, 'ground'));
    }
    sb.add(rbox(width + 0.9, 0.5, 3.6, 0.08), 0xf5a623, [0, -GEAR_H + 0.55, z0 + 2.4]);
    sb.add(rbox(width + 0.95, 0.12, 3.62, 0.04), 0x1b2333, [0, -GEAR_H + 0.86, z0 + 2.4]);
    for (const dz of [1.0, 3.6]) for (const dx of [-1, 1]) sb.add(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12), C.tire, [dx * (width / 2 + 0.35), -GEAR_H + 0.3, z0 + dz], [0, 0, Math.PI / 2]);
    const g = sb.mesh(); plane.add(g); colliders.push(...cols); return g;
  }
  function cargoStairs() {
    const sb = new Batch(), cols = [], width = 1.8, zc = (CARGO_DOOR.z0 + CARGO_DOOR.z1) / 2, side = 1;
    for (let k = 1; k <= 6; k++) {
      const top = -0.4 * k, xa = side * (HALF_W + 0.25 + 0.5 * (k - 1)), xb = side * (HALF_W + 0.25 + 0.5 * k);
      sb.add(rbox(0.5, 0.06, width, 0.02), 0xc9d0dc, [(xa + xb) / 2, top - 0.03, zc]);
      sb.box(0.04, 0.4, width, 0x8e97a6, xb, top - 0.2, zc);
      cols.push(aabb(xa, -GEAR_H, zc - width / 2, xb, top, zc + width / 2, 'ground'));
    }
    sb.box(0.4, 0.08, width, 0xc9d0dc, side * (HALF_W + 0.1), -0.04, zc);
    cols.push(aabb(side * HALF_W, -0.4, zc - width / 2, side * (HALF_W + 0.25), 0, zc + width / 2, 'ground'));
    const run = Math.hypot(3.0, 2.4), ang = side * Math.atan2(2.4, 3.0);
    for (const dz of [-width / 2 - 0.03, width / 2 + 0.03]) { sb.box(run, 0.05, 0.05, 0xdfe5ee, side * (HALF_W + 1.75), 0.7, zc + dz, [0, 0, ang]); sb.box(run, 0.25, 0.06, 0x8e97a6, side * (HALF_W + 1.75), -1.25, zc + dz, [0, 0, ang]); }
    sb.add(rbox(3.4, 0.5, width + 0.5, 0.08), 0xf5a623, [side * (HALF_W + 2.6), -GEAR_H + 0.55, zc]);
    for (const dx of [0.9, 2.9]) for (const dz of [-1, 1]) sb.add(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 10), C.tire, [side * (HALF_W + 0.4 + dx), -GEAR_H + 0.3, zc + dz * (width / 2 + 0.25)], [Math.PI / 2, 0, 0]);
    const g = sb.mesh(); plane.add(g); colliders.push(...cols); return g;
  }
  const stairFront = rearStairs(); // kept name for compatibility: the passenger stairs (now at the rear door)
  const stairCargo = cargoStairs();
  colliders.push(aabb(-80, -GEAR_H - 1, -80, 80, -GEAR_H, 80, 'ground'));
  colliders.push(aabb(-HALF_W - 0.4, CY - R, Z_NOSE - 3, HALF_W + 0.4, -0.16, Z_TAIL - 0.3, 'ground')); // belly

  // oxygen masks (cabin-pressure emergencies)
  const mb = new Batch();
  for (const s of seats) { mb.box(0.12, 0.12, 0.08, 0xffd84a, s.x, 1.5, s.z - 0.15); mb.box(0.01, 0.3, 0.01, 0xdddddd, s.x, 1.7, s.z - 0.15); }
  const masks = mb.mesh({ shadows: false }); masks.visible = false; plane.add(masks);
  // ---- lighting: warm fills, a cockpit light, a red warning light and an overhead cabin KEY light with soft shadows
  const cabinLight = new THREE.PointLight(0xfff1dc, 10, 16, 1.5); cabinLight.position.set(0, 2.3, -2); plane.add(cabinLight);
  const cabinLight2 = new THREE.PointLight(0xfff1dc, 8, 14, 1.5); cabinLight2.position.set(0, 2.3, 8); plane.add(cabinLight2);
  const holdLight = new THREE.PointLight(0xe8f0ff, 5, 9, 1.6); holdLight.position.set(0, 2.2, -10.5); plane.add(holdLight);
  const cockpitLight = new THREE.PointLight(0xdfe8ff, 5, 6, 1.6); cockpitLight.position.set(0, 2.2, -14.5); plane.add(cockpitLight);
  const warnLight = new THREE.PointLight(0xff2030, 0, 30, 1.2); warnLight.position.set(0, 2.2, 0); plane.add(warnLight);
  // directional "ceiling" key light: its shadow camera starts just under the ceiling so the hull above casts nothing
  const key = new THREE.DirectionalLight(0xfff6e8, 1.1);
  key.position.set(0.6, CEIL - 0.05, 2.5); key.target.position.set(0, 0, 3.5); plane.add(key); plane.add(key.target);
  key.shadow.camera.left = -11.5; key.shadow.camera.right = 11.5; key.shadow.camera.top = 2.6; key.shadow.camera.bottom = -2.6;
  key.shadow.camera.near = 0.02; key.shadow.camera.far = 4; key.shadow.bias = -0.0015; key.shadow.normalBias = 0.02; key.shadow.radius = 3;
  key.shadow.camera.up.set(1, 0, 0);

  const extMesh = ext.mesh(); plane.add(extMesh);
  const intMesh = int.mesh({ side: THREE.DoubleSide }); intMesh.castShadow = true; intMesh.receiveShadow = true; plane.add(intMesh);
  const glowMesh = glow.mesh({ basic: true, shadows: false }); plane.add(glowMesh);
  const cabin = {
    lights: [cabinLight, cabinLight2], strip: stripMat, sign: signMat, key,
    setLights(on) { cabinLight.intensity = on ? 10 : 2; cabinLight2.intensity = on ? 8 : 1.5; key.intensity = on ? 1.1 : 0.25; stripMat.color.setHex(on ? 0xfff4e0 : 0x5a6aa8); coveMat.color.setHex(on ? 0x9fd8ff : 0x4a3cff); },
    setSeatbelt(on) { signMat.color.setHex(on ? 0xffb020 : 0x333a48); },
  };
  const update = (dt) => { for (const d of Object.values(doors)) d.update(dt); };
  return { plane, colliders, interact, seats, doors, stairFront, stairRear: stairFront, stairCargo, gear, masks, panelLight, throttleLever, warnLight, cabin, exterior: extMesh, interior: intMesh, bins, update, key };
}
const glassMat = new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide });

function pilotSeat(b, x, z) {
  b.add(rbox(0.56, 0.16, 0.55, 0.06), 0x3a4256, [x, 0.42, z]);
  b.add(rbox(0.56, 0.85, 0.16, 0.07), 0x3a4256, [x, 0.88, z + 0.3], [-0.12, 0, 0]);
  b.add(rbox(0.4, 0.22, 0.14, 0.05), 0x2c3344, [x, 1.42, z + 0.36]);
  for (const s of [-1, 1]) b.add(rbox(0.07, 0.07, 0.4, 0.03), 0x2c3344, [x + s * 0.3, 0.66, z + 0.02]);
  b.add(new THREE.CylinderGeometry(0.06, 0.12, 0.36, 10), 0x2c3344, [x, 0.18, z]);
}
/** A proper economy seat: padded cushion, contoured backrest, white headrest cover, armrests, legs, tray table. */
function cabinSeat(b, x, z, cushion, back, kind) {
  b.add(rbox(0.54, 0.13, 0.48, 0.05, 2), cushion, [x, 0.43, z - 0.02]);
  b.add(rbox(0.52, 0.06, 0.44, 0.02), 0x2b3140, [x, 0.34, z]);
  b.add(rbox(0.54, 0.74, 0.13, 0.06, 2), back, [x, 0.84, z + 0.26], [-0.1, 0, 0]);
  b.add(rbox(0.5, 0.62, 0.05, 0.04), cushion, [x, 0.84, z + 0.19], [-0.1, 0, 0]); // padded front of the backrest
  b.add(rbox(0.44, 0.22, 0.07, 0.05), 0xf4f6fb, [x, 1.13, z + 0.22], [-0.1, 0, 0]); // headrest cover
  b.add(new THREE.BoxGeometry(0.3, 0.025, 0.08), 0x1e6bff, [x, 1.21, z + 0.205], [-0.1, 0, 0]); // Batlas stripe on the cover
  b.add(rbox(0.4, 0.26, 0.025, 0.02), 0x2b3140, [x, 0.84, z + 0.34], [-0.1, 0, 0]); // tray table (back)
  b.add(rbox(0.32, 0.16, 0.02, 0.01), _dark(back), [x, 0.55, z + 0.33]); // seat-back pocket
  for (const s of [-1, 1]) {
    b.add(rbox(0.06, 0.06, 0.44, 0.025), 0x5d6678, [x + s * 0.28, 0.63, z + 0.02]); // armrest
    b.add(rbox(0.04, 0.2, 0.05, 0.015), 0x5d6678, [x + s * 0.28, 0.52, z + 0.19]);
    b.add(new THREE.CylinderGeometry(0.022, 0.026, 0.32, 6, 1, true), C.metal, [x + s * 0.2, 0.16, z - 0.15]); b.add(new THREE.CylinderGeometry(0.022, 0.026, 0.32, 6, 1, true), C.metal, [x + s * 0.2, 0.16, z + 0.15]);
  }
  b.add(new THREE.BoxGeometry(0.44, 0.03, 0.03), C.metal, [x, 0.03, z - 0.15]); b.add(new THREE.BoxGeometry(0.44, 0.03, 0.03), C.metal, [x, 0.03, z + 0.15]);
  if (kind === 'aisle') b.add(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 10), 0xfff2c8, [x + Math.sign(x) * -0.3, 0.665, z - 0.12]);
}
const _dark = (c) => new THREE.Color(c).multiplyScalar(0.55).getHex();

function drawAisle(g, w, h) {
  g.fillStyle = '#1e5fe0'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${30 + Math.random() * 40},${90 + Math.random() * 50},${220 + Math.random() * 35},0.35)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  g.fillStyle = '#7fd3ff'; g.fillRect(0, 0, 10, h); g.fillRect(w - 10, 0, 10, h);
  g.fillStyle = '#ffffff'; g.globalAlpha = 0.18; for (let y = 0; y < h; y += 64) { g.beginPath(); g.moveTo(w / 2, y + 12); g.lineTo(w / 2 + 40, y + 44); g.lineTo(w / 2 - 40, y + 44); g.closePath(); g.fill(); }
  g.globalAlpha = 1;
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
