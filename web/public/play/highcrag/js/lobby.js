// Highcrag — the airport you start in, the airliner, and its wreck on the beach.
import * as THREE from '../../vendor/three.module.js';
import { RoundedBoxGeometry } from '../../vendor/addons/RoundedBoxGeometry.js';

export const LOBBY_ORIGIN = new THREE.Vector3(1200, 0, 1200);
export const LOBBY_FLOOR = 1;
const lam = (color, extra) => new THREE.MeshLambertMaterial({ color, ...extra });

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const FONT = 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// ---------------- airliner (original design) ----------------
export function buildAirliner({ withGear = true } = {}) {
  const g = new THREE.Group();
  const white = lam(0xf7f7f2);
  const stripe = lam(0xff7a29);
  const teal = lam(0x1fb5b5);
  const grey = lam(0x9aa3ad);
  const dark = lam(0x2a3140);
  const L = 26;
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, L, 20), white);
  fus.rotation.x = Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1.9, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), white);
  nose.rotation.x = Math.PI / 2;
  nose.scale.y = 1.6;
  nose.position.z = L / 2;
  const tail = new THREE.Mesh(new THREE.ConeGeometry(1.9, 7, 20), white);
  tail.rotation.x = -Math.PI / 2;
  tail.position.set(0, 0.5, -L / 2 - 3.4);
  tail.scale.set(1, 1, 0.75);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.915, 1.915, L, 20, 1, true, Math.PI * 0.42, Math.PI * 0.16), stripe);
  band.rotation.x = Math.PI / 2;
  band.rotation.y = Math.PI;
  const band2 = band.clone();
  band2.rotation.y = 0;
  const belly = new THREE.Mesh(new THREE.CylinderGeometry(1.91, 1.91, L, 20, 1, true, Math.PI * 0.85, Math.PI * 0.3), teal);
  belly.rotation.x = Math.PI / 2;
  const cockpit = new THREE.Mesh(new RoundedBoxGeometry(2.2, 0.6, 1.2, 2, 0.2), dark);
  cockpit.position.set(0, 0.85, L / 2 + 1.6);
  cockpit.rotation.x = -0.45;
  g.add(fus, nose, tail, band, band2, belly, cockpit);
  // Windows.
  const win = new THREE.BoxGeometry(0.06, 0.42, 0.32);
  for (let i = 0; i < 18; i++) {
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(win, dark);
      w.position.set(sx * 1.88, 0.55, -L / 2 + 2 + i * 1.3);
      g.add(w);
    }
  }
  // Wings, engines, tailplane, fin.
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(new RoundedBoxGeometry(13, 0.35, 3.6, 2, 0.12), white);
    wing.position.set(sx * 7.6, -0.7, 0.5);
    wing.rotation.y = sx * 0.32;
    wing.rotation.z = sx * 0.06;
    const tip = new THREE.Mesh(new RoundedBoxGeometry(0.3, 1.6, 1.2, 2, 0.1), stripe);
    tip.position.set(sx * 14, 0.2, -1.8);
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.8, 3.4, 16), grey);
    eng.rotation.x = Math.PI / 2;
    eng.position.set(sx * 5.4, -1.6, 2.4);
    const intake = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.12, 8, 16), white);
    intake.position.set(sx * 5.4, -1.6, 4.1);
    const hstab = new THREE.Mesh(new RoundedBoxGeometry(5.5, 0.22, 1.8, 2, 0.08), white);
    hstab.position.set(sx * 2.8, 0.9, -L / 2 - 3.5);
    hstab.rotation.y = sx * 0.3;
    g.add(wing, tip, eng, intake, hstab);
  }
  const fin = new THREE.Mesh(new RoundedBoxGeometry(0.35, 5.2, 3.6, 2, 0.12), stripe);
  fin.position.set(0, 3.6, -L / 2 - 3.2);
  fin.rotation.x = -0.45;
  const finMark = new THREE.Mesh(new THREE.CircleGeometry(0.9, 3), lam(0xffffff));
  finMark.position.set(0.19, 3.8, -L / 2 - 3.4);
  finMark.rotation.y = Math.PI / 2;
  const finMark2 = finMark.clone();
  finMark2.position.x = -0.19;
  finMark2.rotation.y = -Math.PI / 2;
  g.add(fin, finMark, finMark2);
  if (withGear) {
    for (const [x, z] of [[0, L / 2 - 1], [-2.4, -1], [2.4, -1]]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.6, 6), grey);
      strut.position.set(x, -2.4, z);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.4, 12), dark);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, -3.2, z);
      g.add(strut, wheel);
    }
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ---------------- the wreck on the beach ----------------
/** Broken airliner pieces laid along the beach. `place(x, z)` gives ground height. Returns the group and colliders. */
export function buildWreck(origin, along, heightAt, rng) {
  const g = new THREE.Group();
  const white = lam(0xe8e6de);
  const burnt = lam(0x3b3632);
  const stripe = lam(0xff7a29);
  const teal = lam(0x1fb5b5);
  const colliders = [];
  const side = new THREE.Vector3(-along.z, 0, along.x);
  const at = (d, s) => origin.clone().addScaledVector(along, d).addScaledVector(side, s);
  const yaw = Math.atan2(along.x, along.z);

  // Front section, nose buried in the sand at an angle.
  const front = new THREE.Group();
  const f1 = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 11, 18, 1, true), white);
  f1.rotation.x = Math.PI / 2;
  f1.material.side = THREE.DoubleSide;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1.9, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), white);
  nose.rotation.x = Math.PI / 2;
  nose.scale.y = 1.5;
  nose.position.z = 5.5;
  const s1 = new THREE.Mesh(new THREE.CylinderGeometry(1.92, 1.92, 11, 18, 1, true, Math.PI * 0.42, Math.PI * 0.16), stripe);
  s1.rotation.x = Math.PI / 2;
  const torn = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.18, 6, 18), burnt);
  torn.position.z = -5.5;
  for (let i = 0; i < 8; i++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.3), lam(0x2a3140));
    w.position.set(1.88, 0.55, -4 + i * 1.2);
    front.add(w);
  }
  front.add(f1, nose, s1, torn);
  const fp = at(5, 0);
  front.position.set(fp.x, heightAt(fp.x, fp.z) + 1.1, fp.z);
  front.rotation.set(0.1, yaw, 0.18);
  g.add(front);
  for (let k = -4; k <= 6; k += 2.5) { const p = at(5 + k, 0); colliders.push({ x: p.x, z: p.z, y: heightAt(p.x, p.z), r: 1.9 }); }

  // Rear section with the tail fin, lying a little apart.
  const rear = new THREE.Group();
  const r1 = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 8, 18, 1, true), white);
  r1.rotation.x = Math.PI / 2;
  r1.material.side = THREE.DoubleSide;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.9, 6, 18), white);
  cone.rotation.x = -Math.PI / 2;
  cone.position.z = -7;
  const fin = new THREE.Mesh(new RoundedBoxGeometry(0.35, 4.6, 3.2, 2, 0.12), stripe);
  fin.position.set(0, 3.2, -7);
  fin.rotation.x = -0.45;
  const belly = new THREE.Mesh(new THREE.CylinderGeometry(1.91, 1.91, 8, 18, 1, true, Math.PI * 0.85, Math.PI * 0.3), teal);
  belly.rotation.x = Math.PI / 2;
  const torn2 = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.2, 6, 18), burnt);
  torn2.position.z = 4;
  rear.add(r1, cone, fin, belly, torn2);
  const rp = at(-9, 1.5);
  rear.position.set(rp.x, heightAt(rp.x, rp.z) + 1.3, rp.z);
  rear.rotation.set(-0.05, yaw + 0.35, -0.6);
  g.add(rear);
  for (let k = -9; k <= 3; k += 2.5) { const p = rp.clone().addScaledVector(new THREE.Vector3(Math.sin(yaw + 0.35), 0, Math.cos(yaw + 0.35)), k); colliders.push({ x: p.x, z: p.z, y: heightAt(p.x, p.z), r: 1.8 }); }

  // A snapped-off wing stuck in the sand, plus an engine.
  const wing = new THREE.Mesh(new RoundedBoxGeometry(10, 0.35, 3.4, 2, 0.12), white);
  const wp = at(-1, 7);
  wing.position.set(wp.x, heightAt(wp.x, wp.z) + 1.4, wp.z);
  wing.rotation.set(0.2, yaw + 1.1, 0.35);
  const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.8, 3.2, 14), lam(0x7d858f));
  const ep = at(2, -6);
  eng.position.set(ep.x, heightAt(ep.x, ep.z) + 0.7, ep.z);
  eng.rotation.set(Math.PI / 2, 0, yaw + 0.8);
  g.add(wing, eng);
  colliders.push({ x: ep.x, z: ep.z, y: heightAt(ep.x, ep.z), r: 1.1 });

  // Scattered suitcases and debris.
  const caseCols = [0x2f9bff, 0xff4f6d, 0x3ddc84, 0xffd23f, 0x8a6bff, 0x4a5568, 0xff7a29];
  for (let i = 0; i < 16; i++) {
    const p = at(-14 + rng() * 26, (rng() - 0.5) * 16);
    const c = new THREE.Mesh(new RoundedBoxGeometry(0.7 + rng() * 0.3, 0.5, 0.3, 2, 0.06), lam(caseCols[i % caseCols.length]));
    c.position.set(p.x, heightAt(p.x, p.z) + 0.2, p.z);
    c.rotation.set((rng() - 0.5) * 1.2, rng() * 6, Math.PI / 2 * (rng() < 0.5 ? 1 : 0));
    g.add(c);
  }
  for (let i = 0; i < 18; i++) {
    const p = at(-16 + rng() * 30, (rng() - 0.5) * 18);
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.4 + rng() * 1.2, 0.05, 0.3 + rng() * 0.8), rng() < 0.5 ? white : burnt);
    d.position.set(p.x, heightAt(p.x, p.z) + 0.05, p.z);
    d.rotation.set((rng() - 0.5) * 0.6, rng() * 6, (rng() - 0.5) * 0.6);
    g.add(d);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group: g, colliders, smokeAt: [at(-5, 0.5), at(-1, 6)] };
}

// ---------------- the airport terminal ----------------
export function buildLobby() {
  const O = LOBBY_ORIGIN;
  const F = LOBBY_FLOOR;
  const g = new THREE.Group();
  g.position.copy(O);
  const colliders = [];
  const box = (w, h, d, m, x, y, z, collide = true) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(0.12, w / 4, h / 4, d / 4)), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    if (collide) colliders.push({ minX: O.x + x - w / 2 - 0.3, maxX: O.x + x + w / 2 + 0.3, minZ: O.z + z - d / 2 - 0.3, maxZ: O.z + z + d / 2 + 0.3 });
    return mesh;
  };
  const W = 34, D = 22, H = 8;

  // Tarmac outside, with painted lines.
  const tarmac = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), lam(0x5d646d));
  tarmac.rotation.x = -Math.PI / 2;
  tarmac.position.y = F - 0.05;
  tarmac.receiveShadow = true;
  g.add(tarmac);
  const lineMat = lam(0xffd23f);
  for (let i = 0; i < 14; i++) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 4), lineMat);
    l.rotation.x = -Math.PI / 2;
    l.position.set(0, F - 0.03, D / 2 + 6 + i * 6);
    g.add(l);
  }

  // Floor with a tiled texture.
  const floorTex = canvasTex(256, 256, (x) => {
    x.fillStyle = '#e9e1d2'; x.fillRect(0, 0, 256, 256);
    x.fillStyle = '#ddd2bf';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) x.fillRect(i * 64, j * 64, 64, 64);
    x.strokeStyle = '#cfc3ae'; x.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 256); x.stroke(); x.beginPath(); x.moveTo(0, i * 64); x.lineTo(256, i * 64); x.stroke(); }
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(W / 4, D / 4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = F;
  floor.receiveShadow = true;
  g.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshBasicMaterial({ color: 0xe8dfcf }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = F + H;
  g.add(ceil);
  for (let i = -3; i <= 3; i++) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.2), new THREE.MeshBasicMaterial({ color: 0xfffbe8 }));
    panel.rotation.x = Math.PI / 2;
    panel.position.set(i * 4.5, F + H - 0.02, 0);
    g.add(panel);
  }

  // Walls: solid back and sides, glass front facing the tarmac.
  const wallMat = lam(0xf2e4c9);
  const accent = lam(0x1fb5b5);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat);
  back.position.set(0, F + H / 2, -D / 2);
  g.add(back);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(D, H), wallMat);
    side.position.set(sx * W / 2, F + H / 2, 0);
    side.rotation.y = -sx * Math.PI / 2;
    g.add(side);
  }
  const stripeWall = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.6), accent);
  stripeWall.position.set(0, F + 1.2, -D / 2 + 0.02);
  g.add(stripeWall);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshLambertMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  glass.position.set(0, F + H / 2, D / 2);
  g.add(glass);
  const frameMat = lam(0x3a4252);
  for (let i = -4; i <= 4; i++) {
    const mull = new THREE.Mesh(new THREE.BoxGeometry(0.25, H, 0.25), frameMat);
    mull.position.set(i * (W / 8), F + H / 2, D / 2);
    g.add(mull);
  }
  const transom = new THREE.Mesh(new THREE.BoxGeometry(W, 0.25, 0.25), frameMat);
  transom.position.set(0, F + 3, D / 2);
  g.add(transom);

  // Check-in counters along the back wall, with a departures board above.
  const counterMat = lam(0x3a4252);
  const topMat = lam(0xff7a29);
  for (let i = -2; i <= 2; i++) {
    box(4, 1.1, 1.2, counterMat, i * 5.5, F + 0.55, -D / 2 + 2.2);
    const top = new THREE.Mesh(new RoundedBoxGeometry(4.1, 0.12, 1.3, 1, 0.05), topMat);
    top.position.set(i * 5.5, F + 1.15, -D / 2 + 2.2);
    g.add(top);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.7), new THREE.MeshBasicMaterial({ map: canvasTex(256, 76, (x) => {
      x.fillStyle = '#1fb5b5'; x.fillRect(0, 0, 256, 76);
      x.fillStyle = '#fff'; x.font = `800 40px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(`CHECK-IN ${i + 3}`, 128, 40);
    }) }));
    sign.position.set(i * 5.5, F + 3.2, -D / 2 + 0.03);
    g.add(sign);
  }
  const boardTex = canvasTex(1024, 320, (x, w, h) => {
    x.fillStyle = '#121722'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#ffd23f'; x.font = `800 44px ${FONT}`; x.fillText('DEPARTURES', 30, 58);
    const rows = [
      ['HC 207', 'HIGHCRAG ISLAND', 'GATE 7', 'BOARDING', '#3ddc84'],
      ['HC 311', 'SALTWIND BAY', 'GATE 2', 'DELAYED', '#ff7a29'],
      ['HC 415', 'PINE RIDGE', 'GATE 4', 'ON TIME', '#9fb3d9'],
      ['HC 502', 'CORAL POINT', 'GATE 5', 'CANCELLED', '#ff4f6d'],
    ];
    x.font = `700 34px ${FONT}`;
    rows.forEach((r, i) => {
      const y = 120 + i * 52;
      x.fillStyle = '#ffffff'; x.fillText(r[0], 30, y); x.fillText(r[1], 200, y); x.fillText(r[2], 600, y);
      x.fillStyle = r[4]; x.fillText(r[3], 770, y);
    });
  });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.8), new THREE.MeshBasicMaterial({ map: boardTex }));
  board.position.set(0, F + 5.6, -D / 2 + 0.04);
  g.add(board);

  // Rows of seats.
  const seatMat = lam(0x2f9bff);
  const legMat = lam(0x9aa3ad);
  for (const z of [-2.5, 2]) {
    for (const x of [-9, 0, 9]) {
      const row = new THREE.Group();
      for (let k = -2; k <= 2; k++) {
        const seat = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.18, 0.8, 2, 0.06), seatMat);
        seat.position.set(k, 0.55, 0);
        const backr = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.8, 0.15, 2, 0.06), seatMat);
        backr.position.set(k, 0.95, -0.38);
        row.add(seat, backr);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(5, 0.1, 0.2), legMat);
      beam.position.y = 0.4;
      row.add(beam);
      for (const lx of [-2.2, 2.2]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.5), legMat);
        leg.position.set(lx, 0.2, 0);
        row.add(leg);
      }
      row.position.set(x, F, z);
      row.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.add(row);
      colliders.push({ minX: O.x + x - 2.8, maxX: O.x + x + 2.8, minZ: O.z + z - 0.8, maxZ: O.z + z + 0.7 });
    }
  }

  // Potted plants and pillars.
  for (const [x, z] of [[-15.5, -9.5], [15.5, -9.5], [-15.5, 9.5], [-4.5, 8.5]]) {
    box(0.9, 0.8, 0.9, lam(0xc8794a), x, F + 0.4, z);
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), lam(0x4f9a35, { flatShading: true }));
    leaf.position.set(x, F + 1.6, z);
    leaf.castShadow = true;
    g.add(leaf);
  }
  for (const x of [-6, 6]) box(0.8, H, 0.8, lam(0xe6d6b8), x, F + H / 2, -5.2);

  // Wardrobe kiosk.
  const wardrobe = new THREE.Vector3(O.x - 13, F, O.z - 3);
  box(2.4, 2.6, 1, lam(0x8a6bff), -13, F + 1.3, -4);
  const mirror = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshLambertMaterial({ color: 0xcfe9ff, emissive: 0x5a7a99, emissiveIntensity: 0.4 }));
  mirror.position.set(-13, F + 1.6, -3.48);
  const wsign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: canvasTex(256, 64, (x) => {
    x.fillStyle = '#ffd23f'; x.fillRect(0, 0, 256, 64);
    x.fillStyle = '#2a1a05'; x.font = `800 34px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('WARDROBE', 128, 34);
  }) }));
  wsign.position.set(-13, F + 2.9, -3.48);
  g.add(mirror, wsign);

  // Gate 7: a doorway in the glass wall that leads to the parked plane.
  const gate = new THREE.Vector3(O.x + 11, F, O.z + D / 2 - 1);
  box(0.4, 3.4, 0.4, accent, 9.4, F + 1.7, D / 2 - 0.2, false);
  box(0.4, 3.4, 0.4, accent, 12.6, F + 1.7, D / 2 - 0.2, false);
  const gsign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshBasicMaterial({ map: canvasTex(320, 80, (x) => {
    x.fillStyle = '#3ddc84'; x.fillRect(0, 0, 320, 80);
    x.fillStyle = '#062b14'; x.font = `800 44px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('GATE 7 ▶', 160, 42);
  }) }));
  gsign.position.set(11, F + 3.9, D / 2 - 0.25);
  gsign.rotation.y = Math.PI;
  const gsign2 = gsign.clone();
  gsign2.rotation.y = 0;
  gsign2.position.z = D / 2 - 0.15;
  g.add(gsign, gsign2);
  const desk = box(2.2, 1.1, 0.8, counterMat, 11, F + 0.55, D / 2 - 3.2);
  desk.material = topMat;

  // The plane parked outside, nose toward the terminal.
  const plane = buildAirliner();
  plane.position.set(4, F + 3.6, D / 2 + 26);
  plane.rotation.y = Math.PI * 0.5;
  g.add(plane);
  // A jet bridge from the gate to the plane door.
  const bridge = new THREE.Mesh(new RoundedBoxGeometry(2.6, 2.6, 12, 2, 0.2), lam(0xd9d9d9));
  bridge.position.set(11, F + 3.4, D / 2 + 7);
  bridge.castShadow = true;
  g.add(bridge);
  const tower = new THREE.Group();
  const tw = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2, 20, 10), lam(0xf2e4c9));
  tw.position.y = 10;
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(3, 2.4, 3, 10), lam(0x1fb5b5));
  cab.position.y = 21.5;
  tower.add(tw, cab);
  tower.position.set(-40, F, 60);
  g.add(tower);

  // Inside lights.
  const lamp = new THREE.PointLight(0xfff1d6, 30, 40, 1.4);
  lamp.position.set(0, F + H - 1, 0);
  g.add(lamp);

  return {
    group: g,
    colliders,
    bounds: { minX: O.x - W / 2 + 0.6, maxX: O.x + W / 2 - 0.6, minZ: O.z - D / 2 + 0.6, maxZ: O.z + D / 2 - 0.6 },
    spawn: new THREE.Vector3(O.x - 4, F, O.z + 4.5),
    gate,
    wardrobe,
    planeWorld: () => plane.getWorldPosition(new THREE.Vector3()),
    floor: F,
    height: H,
  };
}
