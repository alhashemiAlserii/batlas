// Scene construction: sky, ground, airports, and the BA-1 "Tidewing" airliner.
// All aircraft parts live in the `plane` group's LOCAL frame: cabin floor y=0, nose toward -z.
import * as THREE from '../../vendor/three.module.js';

export const GEAR_H = 2.4; // cabin floor height above ground when parked
export const HALF_W = 1.9; // interior half width
export const CEIL = 2.5;
export const Z_NOSE = -16, Z_TAIL = 13, Z_COCKPIT = -13, Z_CARGO = 4;
export const FRONT_DOOR = { x: -HALF_W, z0: -12.6, z1: -11.4 };
export const CARGO_DOOR = { x: HALF_W, z0: 7, z1: 9 };
export const ORIGIN = { code: 'HBF', name: 'Harbor Field', x: 0, z: 0, len: 2600, w: 46 };
export const DEST = { code: 'CRP', name: 'Coral Point', x: 3200, z: -16500, len: 2600, w: 46 };

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const M = {
  hull: mat(0xf4f6fb), navy: mat(0x0a1f5c), teal: mat(0x19d3e6), blue: mat(0x1e6bff),
  floor: mat(0x15306e), seat: mat(0x1e6bff), seatDark: mat(0x0e2a6b), ceiling: mat(0xe9edf5),
  bin: mat(0xd3dae8), metal: mat(0x9aa4b5), dark: mat(0x1b2333), tire: mat(0x111111),
  galley: mat(0xc8d0de), cargoFloor: mat(0x5a6475), cargoWall: mat(0x8790a0),
  glass: new THREE.MeshLambertMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.35, depthWrite: false }),
  runway: mat(0x2d3138), mark: mat(0xf2f2f2), grass: mat(0x5f9a4b), sand: mat(0xd9c48e), sea: mat(0x1d6fb8),
  terminal: mat(0xdfe5ef), terminalGlass: mat(0x2b5d8f), tree: mat(0x2f7a3a), trunk: mat(0x6b4a2b), cloud: mat(0xffffff),
  stair: mat(0xb9c2d0), cart: mat(0xf5a623), screen: new THREE.MeshBasicMaterial({ color: 0x19d3e6 }),
  warn: new THREE.MeshBasicMaterial({ color: 0xff3b4a }),
};
export const MATERIALS = M;

function box(w, h, d, m, x, y, z, parent) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  parent?.add(mesh);
  return mesh;
}
/** Axis-aligned collider in plane-local coordinates. */
function aabb(x0, y0, z0, x1, y1, z1, tag = 'solid') {
  return { min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)], tag };
}

function textTexture(text, { w = 1024, h = 256, font = 'bold 150px -apple-system, Segoe UI, sans-serif', color = '#0a1f5c', bg = null } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.font = font; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function buildPlane() {
  const plane = new THREE.Group();
  plane.name = 'plane';
  const colliders = [];
  const interact = []; // static interaction points (local)
  const hull = new THREE.Group(); plane.add(hull);
  const T = 0.15; // wall thickness

  // ---------- floor / belly / roof ----------
  box(HALF_W * 2, T, Z_CARGO - Z_NOSE, M.floor, 0, -T / 2, (Z_NOSE + Z_CARGO) / 2, plane);
  box(HALF_W * 2, T, Z_TAIL - Z_CARGO, M.cargoFloor, 0, -T / 2, (Z_CARGO + Z_TAIL) / 2, plane);
  colliders.push(aabb(-HALF_W, -T, Z_NOSE, HALF_W, 0, Z_TAIL));
  box(HALF_W * 2 + 0.3, 1.6, Z_TAIL - Z_NOSE, M.hull, 0, -T - 0.8, (Z_NOSE + Z_TAIL) / 2, hull); // belly
  box(HALF_W * 2 + 0.3, T, Z_TAIL - Z_NOSE, M.ceiling, 0, CEIL + T / 2, (Z_NOSE + Z_TAIL) / 2, plane);
  box(HALF_W * 2 - 0.4, 0.5, Z_TAIL - Z_NOSE, M.hull, 0, CEIL + 0.4, (Z_NOSE + Z_TAIL) / 2, hull); // roof hump
  colliders.push(aabb(-HALF_W, CEIL, Z_NOSE, HALF_W, CEIL + T, Z_TAIL));

  // ---------- side walls with window strip and door gaps ----------
  // Visual: lower wall (0..1.05), window band with pillars (1.05..1.55), upper wall (1.55..CEIL).
  // Collision: full height, with door gaps.
  function sideWall(side, gaps) {
    const x = side * (HALF_W + T / 2);
    const segs = [];
    let z = Z_NOSE;
    for (const g of [...gaps, { z0: Z_TAIL, z1: Z_TAIL }]) { if (g.z0 > z) segs.push([z, g.z0]); z = g.z1; }
    for (const [a, b] of segs) {
      const L = b - a, cz = (a + b) / 2;
      const inner = a >= Z_CARGO ? M.cargoWall : M.hull;
      box(T, 1.05, L, inner, x, 0.525, cz, plane);
      box(T, CEIL - 1.55, L, inner, x, (1.55 + CEIL) / 2, cz, plane);
      // pillars every 1.1 m (windows between them) — none in the cargo hold
      if (a >= Z_CARGO) box(T, 0.5, L, inner, x, 1.3, cz, plane);
      else {
        for (let pz = a; pz < b; pz += 1.1) box(T, 0.5, Math.min(0.55, b - pz), inner, x, 1.3, pz + Math.min(0.55, b - pz) / 2, plane);
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(L, 0.5), M.glass);
        glass.position.set(x, 1.3, cz); glass.rotation.y = Math.PI / 2; plane.add(glass);
      }
      colliders.push(aabb(x - T / 2, 0, a, x + T / 2, CEIL, b));
      // livery stripe outside
      box(0.02, 0.22, L, M.navy, x + side * (T / 2 + 0.01), 0.75, cz, hull);
      box(0.02, 0.08, L, M.teal, x + side * (T / 2 + 0.01), 0.58, cz, hull);
    }
  }
  sideWall(-1, [FRONT_DOOR]);
  sideWall(1, [CARGO_DOOR]);
  // lintels above doors (visual + collider)
  box(T, 0.3, FRONT_DOOR.z1 - FRONT_DOOR.z0, M.hull, -HALF_W - T / 2, CEIL - 0.15, (FRONT_DOOR.z0 + FRONT_DOOR.z1) / 2, plane);
  box(T, 0.3, CARGO_DOOR.z1 - CARGO_DOOR.z0, M.cargoWall, HALF_W + T / 2, CEIL - 0.15, (CARGO_DOOR.z0 + CARGO_DOOR.z1) / 2, plane);

  // Doors: slabs that slide outward/along when open; collider active when closed.
  const doors = {};
  function door(name, d, side, m) {
    const g = new THREE.Group();
    const slab = box(T * 0.8, CEIL - 0.3, d.z1 - d.z0, m, 0, (CEIL - 0.3) / 2, 0, g);
    slab.name = name;
    g.position.set(side * (HALF_W + T), 0, (d.z0 + d.z1) / 2);
    plane.add(g);
    const col = aabb(side * HALF_W, 0, d.z0, side * (HALF_W + T), CEIL, d.z1, `door:${name}`);
    colliders.push(col);
    doors[name] = { group: g, open: true, collider: col, closedZ: (d.z0 + d.z1) / 2, side };
  }
  door('front', FRONT_DOOR, -1, M.hull);
  door('cargo', CARGO_DOOR, 1, M.cargoWall);

  // end walls
  box(HALF_W * 2, 1.0, T, M.dark, 0, 0.5, Z_NOSE - T / 2, plane); // below windshield
  colliders.push(aabb(-HALF_W, 0, Z_NOSE - T, HALF_W, CEIL, Z_NOSE));
  const wind = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, 1.4), M.glass); wind.position.set(0, 1.75, Z_NOSE - 0.05); plane.add(wind);
  box(0.12, 1.4, T, M.hull, 0, 1.75, Z_NOSE - T / 2, plane); // center pillar
  box(HALF_W * 2, T, T, M.hull, 0, CEIL - 0.05, Z_NOSE - T / 2, plane);
  box(HALF_W * 2, CEIL, T, M.cargoWall, 0, CEIL / 2, Z_TAIL + T / 2, plane);
  colliders.push(aabb(-HALF_W, 0, Z_TAIL, HALF_W, CEIL, Z_TAIL + T));

  // partitions with doorways
  function partition(z, gap, m) {
    const wL = HALF_W - gap;
    box(wL, CEIL, 0.1, m, -(gap + wL / 2), CEIL / 2, z, plane);
    box(wL, CEIL, 0.1, m, gap + wL / 2, CEIL / 2, z, plane);
    box(gap * 2, 0.4, 0.1, m, 0, CEIL - 0.2, z, plane);
    colliders.push(aabb(-HALF_W, 0, z - 0.05, -gap, CEIL, z + 0.05), aabb(gap, 0, z - 0.05, HALF_W, CEIL, z + 0.05));
  }
  partition(Z_COCKPIT, 0.5, M.galley);
  partition(Z_CARGO, 0.6, M.cargoWall);

  // ---------- cockpit ----------
  box(HALF_W * 2, 1.0, 0.45, M.dark, 0, 0.5, Z_NOSE + 0.22, plane);
  colliders.push(aabb(-HALF_W, 0, Z_NOSE, HALF_W, 1.0, Z_NOSE + 0.45));
  for (const sx of [-0.6, 0.6]) {
    box(0.6, 0.45, 0.6, M.navy, sx, 0.225, -14.6, plane); box(0.6, 0.9, 0.12, M.navy, sx, 0.75, -14.25, plane);
    colliders.push(aabb(sx - 0.3, 0, -14.9, sx + 0.3, 0.48, -14.3));
    box(0.5, 0.25, 0.05, M.screen, sx, 1.05, Z_NOSE + 0.46, plane); // displays
    box(0.08, 0.45, 0.08, M.metal, sx, 0.62, -15.35, plane); // yoke column
    box(0.35, 0.06, 0.06, M.dark, sx, 0.86, -15.35, plane);
  }
  const throttleLever = box(0.06, 0.25, 0.06, M.metal, 0, 1.0, -15.2, plane);
  interact.push({ id: 'seat_captain', kind: 'pilot', label: 'Take the captain\'s seat', pos: new THREE.Vector3(-0.6, 0.9, -14.6) });

  // ---------- galley ----------
  box(0.7, 1.0, 1.7, M.galley, HALF_W - 0.35, 0.5, -12.05, plane);
  colliders.push(aabb(HALF_W - 0.7, 0, -12.9, HALF_W, 1.0, -11.2));
  const items = [['water', 0x4cc3ff, -12.6, 'Grab a bottle of water'], ['snack', 0xf5a623, -12.05, 'Grab a snack box'], ['blanket', 0x7c5cff, -11.5, 'Grab a blanket']];
  for (const [kind, color, z, label] of items) {
    box(0.4, 0.25, 0.35, mat(color), HALF_W - 0.35, 1.13, z, plane);
    interact.push({ id: `disp_${kind}`, kind: 'dispense', item: kind, label, pos: new THREE.Vector3(HALF_W - 0.35, 1.2, z) });
  }

  // ---------- cabin seats & bins ----------
  const seats = [];
  const ROWS = 10;
  for (let r = 0; r < ROWS; r++) {
    const z = -9.6 + r * 1.3;
    for (const sx of [-1.45, -0.85, 0.85, 1.45]) {
      box(0.56, 0.48, 0.5, M.seat, sx, 0.24, z, plane);
      box(0.56, 0.75, 0.12, M.seatDark, sx, 0.8, z + 0.25, plane);
      colliders.push(aabb(sx - 0.28, 0, z - 0.25, sx + 0.28, 0.48, z + 0.25), aabb(sx - 0.28, 0, z + 0.19, sx + 0.28, 1.18, z + 0.31));
      seats.push({ x: sx, z, row: r + 1, letter: 'ABCD'[[-1.45, -0.85, 0.85, 1.45].indexOf(sx)] });
    }
  }
  // overhead bins: shelf colliders so bags can rest on them
  for (const side of [-1, 1]) {
    const x0 = side * 1.25, x1 = side * HALF_W, cz = (-10.4 + Z_CARGO - 0.3) / 2, L = Z_CARGO - 0.3 + 10.4;
    box(Math.abs(x1 - x0), 0.06, L, M.bin, (x0 + x1) / 2, 1.75, cz, plane);
    box(0.04, 0.7, L, M.bin, x1 - side * 0.02, 2.1, cz, plane); // back panel (open shelf bins)
    box(0.04, 0.16, L, M.bin, x0, 1.86, cz, plane); // lip
    colliders.push(aabb(x0, 1.72, -10.4, x1, 1.78, Z_CARGO - 0.3), aabb(x0 - 0.02, 1.78, -10.4, x0 + 0.02, 1.94, Z_CARGO - 0.3));
  }

  // ---------- cargo hold ----------
  for (let i = 0; i < 4; i++) box(0.06, 1.8, 0.06, M.metal, i % 2 ? 1.3 : -1.3, 0.9, 6 + Math.floor(i / 2) * 5, plane); // tie-down posts (visual)
  const panel = box(0.08, 0.6, 0.8, M.dark, HALF_W - 0.05, 1.3, 11.5, plane);
  const panelLight = box(0.02, 0.12, 0.12, M.screen, HALF_W - 0.1, 1.5, 11.5, plane);
  interact.push({ id: 'panel', kind: 'panel', label: 'Maintenance panel', pos: new THREE.Vector3(HALF_W - 0.1, 1.3, 11.5) });
  // door switches (inside)
  interact.push({ id: 'door_front', kind: 'door', door: 'front', label: 'front door', pos: new THREE.Vector3(-HALF_W + 0.15, 1.2, FRONT_DOOR.z1 + 0.35) });
  interact.push({ id: 'door_cargo', kind: 'door', door: 'cargo', label: 'cargo door', pos: new THREE.Vector3(HALF_W - 0.15, 1.2, CARGO_DOOR.z0 - 0.35) });
  for (const it of interact.filter((i) => i.kind === 'door')) box(0.06, 0.25, 0.18, M.warn, it.pos.x, it.pos.y, it.pos.z, plane);

  // ---------- air-stairs (ground-only colliders) ----------
  function stairs(side, zc, width) {
    const g = new THREE.Group(); plane.add(g);
    const cols = [];
    for (let k = 1; k <= 6; k++) {
      const top = -0.4 * k + 0.0;
      const xa = side * (HALF_W + 0.25 + 0.5 * (k - 1)), xb = side * (HALF_W + 0.25 + 0.5 * k);
      const h = top + GEAR_H;
      box(0.5, h, width, M.stair, (xa + xb) / 2, -GEAR_H + h / 2, zc, g);
      cols.push(aabb(xa, -GEAR_H, zc - width / 2, xb, top, zc + width / 2, 'ground'));
    }
    // top landing bridging the door threshold
    box(0.4, 0.1, width, M.stair, side * (HALF_W + 0.1), -0.05, zc, g);
    cols.push(aabb(side * HALF_W, -0.4, zc - width / 2, side * (HALF_W + 0.25), 0, zc + width / 2, 'ground'));
    // rails
    for (const dz of [-width / 2, width / 2]) {
      const rail = box(3.2, 0.05, 0.05, M.metal, side * (HALF_W + 1.7), -0.2, zc + dz, g);
      rail.rotation.z = side * Math.atan2(2.4, 3.0);
    }
    colliders.push(...cols);
    return g;
  }
  const stairFront = stairs(-1, (FRONT_DOOR.z0 + FRONT_DOOR.z1) / 2, 1.1);
  const stairCargo = stairs(1, (CARGO_DOOR.z0 + CARGO_DOOR.z1) / 2, 1.8);
  // apron (ground, only while parked) — large slab below the plane
  colliders.push(aabb(-80, -GEAR_H - 1, -80, 80, -GEAR_H, 80, 'ground'));
  // belly (so people on the apron can't walk through the fuselage)
  colliders.push(aabb(-HALF_W - 0.15, -1.75, Z_NOSE - 3, HALF_W + 0.15, -0.16, Z_TAIL + 5, 'ground'));

  // ---------- exterior ----------
  // nose: tapered box
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 2.05, 4, 8, 1), M.hull);
  nose.rotation.x = -Math.PI / 2; nose.rotation.y = Math.PI / 8; nose.scale.set(1, 1, 0.5);
  nose.position.set(0, -0.1, Z_NOSE - 2.0); hull.add(nose);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 0.4, 6, 8, 1), M.hull);
  tail.rotation.x = -Math.PI / 2; tail.rotation.y = Math.PI / 8; tail.scale.set(1, 1, 0.8);
  tail.position.set(0, 1.0, Z_TAIL + 3.0); hull.add(tail);
  // wings
  for (const side of [-1, 1]) {
    const wing = box(13.5, 0.35, 4.2, M.hull, side * (HALF_W + 6.75), -0.9, 0.5, hull);
    wing.rotation.y = side * -0.18;
    box(3, 0.36, 4.21, M.navy, side * (HALF_W + 12.2), -0.9, 1.6 + 0.0, hull).rotation.y = side * -0.18;
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.75, 3.4, 12), M.metal);
    eng.rotation.x = Math.PI / 2; eng.position.set(side * 6.2, -1.9, -1.3); hull.add(eng);
    const intake = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.05, 12), M.dark); intake.rotation.x = Math.PI / 2; intake.position.set(side * 6.2, -1.9, -3.02); hull.add(intake);
    box(0.3, 0.7, 1.5, M.metal, side * 6.2, -1.25, -1.1, hull); // pylon
    const hs = box(5, 0.2, 2.2, M.hull, side * 3.2, 1.6, Z_TAIL + 4.6, hull); hs.rotation.y = side * -0.25;
  }
  const fin = box(0.3, 5.0, 3.6, M.navy, 0, 4.4, Z_TAIL + 4.4, hull);
  fin.rotation.x = -0.35;
  const tailLogo = new THREE.TextureLoader().load('/img/batlas-mark.png');
  tailLogo.colorSpace = THREE.SRGBColorSpace;
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 2.0), new THREE.MeshBasicMaterial({ map: tailLogo, transparent: true }));
    p.position.set(side * 0.17, 4.5, Z_TAIL + 4.3); p.rotation.y = side * Math.PI / 2; p.rotation.x = 0; hull.add(p);
    const name = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.1), new THREE.MeshBasicMaterial({ map: textTexture('BATLAS AIR'), transparent: true }));
    name.position.set(side * (HALF_W + T + 0.03), 1.95, -6); name.rotation.y = side * Math.PI / 2; hull.add(name);
  }
  // landing gear
  const gear = new THREE.Group(); hull.add(gear);
  for (const [gx, gz] of [[0, -13], [-2.6, 1.5], [2.6, 1.5]]) {
    box(0.18, GEAR_H - 0.9, 0.18, M.metal, gx, -1.0 - (GEAR_H - 0.9) / 2 + 0.05, gz, gear);
    for (const dx of [-0.3, 0.3]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 12), M.tire);
      w.rotation.z = Math.PI / 2; w.position.set(gx + dx, -GEAR_H + 0.45, gz); gear.add(w);
    }
  }
  // oxygen masks (shown during cabin-pressure emergencies)
  const masks = new THREE.Group(); masks.visible = false; plane.add(masks);
  for (const s of seats) box(0.12, 0.12, 0.08, mat(0xffd84a), s.x, 1.6, s.z - 0.15, masks);
  // cabin lights
  const cabinLight = new THREE.PointLight(0xfff4e0, 18, 16, 1.6); cabinLight.position.set(0, 2.2, -5); plane.add(cabinLight);
  const cabinLight2 = new THREE.PointLight(0xfff4e0, 12, 14, 1.6); cabinLight2.position.set(0, 2.2, 8); plane.add(cabinLight2);
  const warnLight = new THREE.PointLight(0xff2030, 0, 30, 1.2); warnLight.position.set(0, 2.2, 0); plane.add(warnLight);

  return { plane, colliders, interact, seats, doors, stairFront, stairCargo, gear, masks, panelLight, throttleLever, warnLight };
}

/** Static world: sky dome, ground, both airports, scenery, clouds. */
export function buildWorld(scene) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(0x1e6bff) }, bottom: { value: new THREE.Color(0xbfe6ff) }, dim: { value: 1.0 } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; uniform float dim; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.15,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, h)*dim, 1.0); }',
  }));
  scene.add(sky);
  scene.fog = new THREE.Fog(0xbfe6ff, 800, 14000);
  const hemi = new THREE.HemisphereLight(0xdff2ff, 0x9aa3b0, 1.4); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(300, 800, 200); scene.add(sun);

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(80000, 80000), M.sea); sea.rotation.x = -Math.PI / 2; sea.position.y = -0.6; scene.add(sea);
  function island(cx, cz, rx, rz) {
    const g = new THREE.Mesh(new THREE.CircleGeometry(1, 20), M.grass); g.rotation.x = -Math.PI / 2; g.scale.set(rx, rz, 1); g.position.set(cx, -0.05, cz); scene.add(g);
    const b = new THREE.Mesh(new THREE.CircleGeometry(1, 20), M.sand); b.rotation.x = -Math.PI / 2; b.scale.set(rx * 1.06, rz * 1.06, 1); b.position.set(cx, -0.3, cz); scene.add(b);
  }
  function airport(ap, terminalSide) {
    island(ap.x, ap.z - ap.len / 2 + 300, 900, ap.len / 2 + 700);
    const rw = new THREE.Mesh(new THREE.PlaneGeometry(ap.w, ap.len), M.runway); rw.rotation.x = -Math.PI / 2; rw.position.set(ap.x, 0.01, ap.z - ap.len / 2 + 60); scene.add(rw);
    for (let d = 40; d < ap.len - 80; d += 60) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 24), M.mark); m.rotation.x = -Math.PI / 2; m.position.set(ap.x, 0.02, ap.z + 60 - d - 30); scene.add(m); }
    for (const e of [ap.z + 30, ap.z - ap.len + 90]) for (let i = -4; i <= 4; i++) { if (!i) continue; const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 22), M.mark); m.rotation.x = -Math.PI / 2; m.position.set(ap.x + i * 4.2, 0.02, e); scene.add(m); }
    const label = new THREE.Mesh(new THREE.PlaneGeometry(30, 8), new THREE.MeshBasicMaterial({ map: textTexture(ap.code, { color: '#ffffff' }), transparent: true }));
    label.rotation.x = -Math.PI / 2; label.position.set(ap.x, 0.03, ap.z - 30); scene.add(label);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(120, 160), mat(0x8c939e)); apron.rotation.x = -Math.PI / 2; apron.position.set(ap.x + terminalSide * 80, 0.008, ap.z - 20); scene.add(apron);
    box(40, 14, 120, M.terminal, ap.x + terminalSide * 120, 7, ap.z - 20, scene);
    box(0.5, 6, 110, M.terminalGlass, ap.x + terminalSide * 99.8, 8, ap.z - 20, scene);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(60, 9), new THREE.MeshBasicMaterial({ map: textTexture(ap.name.toUpperCase(), { color: '#ffffff', bg: '#0a1f5c' }) }));
    sign.position.set(ap.x + terminalSide * 99.5, 16.5, ap.z - 20); sign.rotation.y = -terminalSide * Math.PI / 2; scene.add(sign);
    box(6, 40, 6, M.terminal, ap.x + terminalSide * 150, 20, ap.z + 50, scene); // tower
    box(10, 5, 10, M.terminalGlass, ap.x + terminalSide * 150, 42, ap.z + 50, scene);
    for (let i = 0; i < 40; i++) {
      const tx = ap.x + (Math.random() - 0.5) * 1500, tz = ap.z - Math.random() * ap.len * 1.2 + 300;
      if (Math.abs(tx - ap.x) < 220) continue;
      tree(tx, tz, scene);
    }
  }
  airport(ORIGIN, -1);
  airport(DEST, 1);
  // scattered islands & hills between
  for (let i = 0; i < 14; i++) {
    const t = i / 14, cx = DEST.x * t + (Math.random() - 0.5) * 4000, cz = DEST.z * t - 800 + (Math.random() - 0.5) * 3000;
    island(cx, cz, 300 + Math.random() * 600, 300 + Math.random() * 600);
    const hill = new THREE.Mesh(new THREE.ConeGeometry(150 + Math.random() * 200, 80 + Math.random() * 160, 6), M.tree);
    hill.position.set(cx, 30, cz); scene.add(hill);
  }
  // clouds
  const clouds = new THREE.Group(); scene.add(clouds);
  const puff = new THREE.IcosahedronGeometry(1, 0);
  for (let i = 0; i < 90; i++) {
    const c = new THREE.Group();
    const n = 3 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) { const m = new THREE.Mesh(puff, M.cloud); const s = 40 + Math.random() * 60; m.scale.set(s * 1.4, s * 0.7, s); m.position.set((k - n / 2) * 60, Math.random() * 20, (Math.random() - 0.5) * 50); c.add(m); }
    c.position.set((Math.random() - 0.3) * 12000, 450 + Math.random() * 900, 2000 - Math.random() * 22000);
    clouds.add(c);
  }
  // baggage cart next to the cargo door (static visual; bags are physics objects)
  return { sky, hemi, sun, clouds };
}

function tree(x, z, scene) {
  const t = new THREE.Mesh(new THREE.ConeGeometry(4 + Math.random() * 3, 12 + Math.random() * 6, 6), M.tree); t.position.set(x, 8, z); scene.add(t);
  const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 4, 5), M.trunk); tr.position.set(x, 2, z); scene.add(tr);
}

export { box, aabb, textTexture };
