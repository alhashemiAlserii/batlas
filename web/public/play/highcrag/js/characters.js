// Highcrag — the climbers: realistic proportions, jointed limbs and PBR fabric/skin materials.
// Looks are data: { c: jacket colour, h: headwear, s: skin tone }. Everything is built from primitives.
import * as THREE from '../../vendor/three.module.js';
import { RoundedBoxGeometry } from '../../vendor/addons/RoundedBoxGeometry.js';

export const OUTFITS = [0xb8322a, 0x2b3d63, 0x56643a, 0xe0702a, 0x1f7373, 0xc29a28, 0x63406b, 0x7a8285, 0xe6e3dc, 0x2a2b30];
export const OUTFIT_NAMES = ['Summit red', 'Navy', 'Olive', 'Blaze orange', 'Glacier teal', 'Mustard', 'Plum', 'Granite', 'Snow white', 'Midnight'];
export const HATS = ['Beanie', 'Sun hat', 'Trail cap', 'Climbing helmet', 'Trapper hat', 'No hat'];
export const SKINS = [0xf1d1bb, 0xdfb38f, 0xc48c63, 0x9d6844, 0x7a4b2f, 0x4e2f20];
const HAIR = [0x2b1d14, 0x5a3b22, 0x8a5a2e, 0x1b1714, 0xb98b4e, 0x3b2a1e];
export const DEFAULT_LOOK = { c: 0, h: 0, s: 1 };
export const validLook = (l) => ({
  c: Number.isInteger(l?.c) && l.c >= 0 && l.c < OUTFITS.length ? l.c : 0,
  h: Number.isInteger(l?.h) && l.h >= 0 && l.h < HATS.length ? l.h : 0,
  s: Number.isInteger(l?.s) && l.s >= 0 && l.s < SKINS.length ? l.s : 1,
});

// ---------------- shared procedural textures ----------------
let _fabric = null, _knit = null;
function fabricTexture() {
  if (_fabric) return _fabric;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const img = x.createImageData(128, 128);
  for (let j = 0; j < 128; j++) {
    for (let i = 0; i < 128; i++) {
      // Ripstop weave: fine twill lines plus a grid, with grain noise.
      const twill = ((i + j) % 4 < 2 ? 10 : -10);
      const grid = (i % 32 === 0 || j % 32 === 0) ? -22 : 0;
      const v = 214 + twill + grid + (Math.random() - 0.5) * 24;
      const k = (j * 128 + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
      img.data[k + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  _fabric = new THREE.CanvasTexture(c);
  _fabric.wrapS = _fabric.wrapT = THREE.RepeatWrapping;
  _fabric.repeat.set(3, 3);
  _fabric.colorSpace = THREE.SRGBColorSpace;
  return _fabric;
}
function knitTexture() {
  if (_knit) return _knit;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#d6d6d6';
  x.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 64; i += 8) {
    for (let j = 0; j < 64; j += 8) {
      x.fillStyle = `rgb(${190 + Math.random() * 40 | 0},${190 + Math.random() * 40 | 0},${190 + Math.random() * 40 | 0})`;
      x.beginPath(); x.ellipse(i + 2, j + 4, 2.2, 3.8, 0.4, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.ellipse(i + 6, j + 4, 2.2, 3.8, -0.4, 0, Math.PI * 2); x.fill();
    }
  }
  _knit = new THREE.CanvasTexture(c);
  _knit.wrapS = _knit.wrapT = THREE.RepeatWrapping;
  _knit.repeat.set(4, 2);
  _knit.colorSpace = THREE.SRGBColorSpace;
  return _knit;
}

const std = (color, rough = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
const fabric = (color, rough = 0.85) => std(color, rough, { map: fabricTexture(), bumpMap: fabricTexture(), bumpScale: 0.6 });

function headwear(h, colour, hairCol) {
  const g = new THREE.Group();
  if (h === 0) {
    const knit = std(colour, 0.95, { map: knitTexture(), bumpMap: knitTexture(), bumpScale: 1.2 });
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.108, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), knit);
    cap.scale.set(0.95, 1.18, 1.05);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 8, 24), knit);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = 0.012;
    g.add(cap, cuff);
    g.position.y = 0.06;
  } else if (h === 1) {
    const straw = std(0xcdb27a, 0.95, { map: knitTexture() });
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.105, 0.08, 20), straw);
    crown.position.y = 0.05;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.012, 28), straw);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.106, 0.106, 0.022, 20), fabric(colour));
    band.position.y = 0.022;
    g.add(crown, brim, band);
    g.position.y = 0.105;
  } else if (h === 2) {
    const f = fabric(colour);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.106, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), f);
    cap.scale.set(0.96, 0.9, 1.05);
    const bill = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.01, 20, 1, false, -Math.PI / 2, Math.PI), f);
    bill.position.set(0, 0.005, 0.07);
    bill.rotation.x = 0.12;
    g.add(cap, bill);
    g.position.y = 0.075;
  } else if (h === 3) {
    const shell = std(colour, 0.35);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.118, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), shell);
    dome.scale.set(0.95, 0.95, 1.08);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.008, 6, 28), std(0x222222, 0.6));
    rim.rotation.x = Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.01, 0.05), std(0x1a1a1a, 0.5));
      vent.position.set((i - 1.5) * 0.04, 0.115, -0.01);
      g.add(vent);
    }
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 12), new THREE.MeshStandardMaterial({ color: 0xfff6c8, emissive: 0xffe9a0, emissiveIntensity: 1.2 }));
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(0, 0.06, 0.12);
    g.add(dome, rim, lamp);
    g.position.y = 0.075;
  } else if (h === 4) {
    const f = fabric(colour);
    const fur = std(0xe8dcc6, 1.0, { map: knitTexture(), bumpMap: knitTexture(), bumpScale: 2 });
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), f);
    cap.scale.set(0.97, 1.08, 1.05);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.104, 0.02, 8, 24), fur);
    rim.rotation.x = Math.PI / 2;
    for (const sx of [-1, 1]) {
      const flap = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.1, 0.075, 2, 0.012), fur);
      flap.position.set(sx * 0.1, -0.06, 0);
      g.add(flap);
    }
    g.add(cap, rim);
    g.position.y = 0.055;
  } else {
    // Hair only: a short tousled cut.
    const hair = std(hairCol, 0.75);
    for (let i = 0; i < 7; i++) {
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), hair);
      tuft.position.set((i % 3 - 1) * 0.045, 0.1 + (i % 2) * 0.012, 0.02 - Math.floor(i / 3) * 0.04);
      tuft.scale.set(1.2, 0.6, 1.2);
      g.add(tuft);
    }
  }
  return g;
}

/** Build a climber. The origin is at the feet; +z is forward. */
export function makeClimber(look = DEFAULT_LOOK, { shadows = false } = {}) {
  const L = validLook(look);
  const colour = OUTFITS[L.c];
  const hairCol = HAIR[(L.c + L.s * 2) % HAIR.length];
  const root = new THREE.Group();
  const jacket = fabric(colour);
  const jacketDark = fabric(new THREE.Color(colour).multiplyScalar(0.62));
  const pants = fabric(0x8a7c62);
  const skin = std(SKINS[L.s], 0.55);
  const glove = std(0x4a4038, 0.7);
  const bootMat = std(0x5a3d26, 0.65);
  const sole = std(0x1e1b18, 0.9);
  const packMat = fabric(0x5d6248);
  const strap = std(0x232526, 0.7);
  const hair = std(hairCol, 0.75);

  const mesh = (geo, m, x = 0, y = 0, z = 0) => { const k = new THREE.Mesh(geo, m); k.position.set(x, y, z); return k; };
  const capsule = (r, len, m) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), m);

  const hips = new THREE.Group();
  hips.position.y = 0.96;
  root.add(hips);
  const pelvis = capsule(0.135, 0.1, pants);
  pelvis.rotation.z = Math.PI / 2;
  pelvis.scale.set(1, 1, 0.78);
  hips.add(pelvis);
  const belt = mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.04, 20), strap, 0, 0.06, 0);
  belt.scale.z = 0.75;
  hips.add(belt);

  const spine = new THREE.Group();
  spine.position.y = 0.05;
  hips.add(spine);
  const torso = capsule(0.17, 0.27, jacket);
  torso.position.y = 0.27;
  torso.scale.set(1.22, 1, 0.78);
  const zip = mesh(new THREE.BoxGeometry(0.012, 0.4, 0.01), std(0x9a9a9a, 0.3, { metalness: 0.6 }), 0, 0.29, 0.136);
  const hem = mesh(new THREE.CylinderGeometry(0.2, 0.195, 0.05, 20), jacketDark, 0, 0.08, 0);
  hem.scale.z = 0.76;
  const collar = mesh(new THREE.TorusGeometry(0.075, 0.03, 8, 20), jacketDark, 0, 0.55, 0);
  collar.rotation.x = Math.PI / 2;
  for (const sx of [-1, 1]) {
    const pocket = mesh(new RoundedBoxGeometry(0.07, 0.09, 0.02, 2, 0.008), jacketDark, sx * 0.085, 0.3, 0.13);
    spine.add(pocket);
  }
  spine.add(torso, zip, hem, collar);

  // Neck and head.
  const neck = new THREE.Group();
  neck.position.y = 0.55;
  spine.add(neck);
  neck.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 12), skin, 0, 0.04, 0));
  const head = new THREE.Group();
  head.position.y = 0.11;
  neck.add(head);
  const skull = mesh(new THREE.SphereGeometry(0.1, 24, 18), skin, 0, 0.065, 0);
  skull.scale.set(0.88, 1.12, 1.0);
  const jaw = mesh(new THREE.SphereGeometry(0.082, 20, 14), skin, 0, 0.01, 0.018);
  jaw.scale.set(0.82, 0.62, 0.92);
  const nose = mesh(new THREE.SphereGeometry(0.02, 10, 8), skin, 0, 0.05, 0.098);
  nose.scale.set(0.75, 1.15, 1.2);
  const lips = mesh(new THREE.BoxGeometry(0.034, 0.007, 0.008), std(new THREE.Color(SKINS[L.s]).multiplyScalar(0.72), 0.5), 0, 0.006, 0.092);
  head.add(skull, jaw, nose, lips);
  const eyes = new THREE.Group();
  for (const sx of [-1, 1]) {
    const white = mesh(new THREE.SphereGeometry(0.015, 12, 10), std(0xf4f1ec, 0.25), sx * 0.034, 0.083, 0.083);
    const iris = mesh(new THREE.SphereGeometry(0.0085, 10, 8), std(0x3b2b1e, 0.2), sx * 0.034, 0.083, 0.096);
    const brow = mesh(new THREE.BoxGeometry(0.034, 0.007, 0.01), hair, sx * 0.035, 0.108, 0.093);
    brow.rotation.z = -sx * 0.12;
    const ear = mesh(new THREE.SphereGeometry(0.022, 10, 8), skin, sx * 0.088, 0.065, -0.005);
    ear.scale.set(0.45, 1, 0.8);
    eyes.add(white, iris);
    head.add(brow, ear);
  }
  head.add(eyes);
  // Hair under the headwear (sides and back).
  const hairCap = mesh(new THREE.SphereGeometry(0.104, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), hair, 0, 0.07, -0.006);
  hairCap.scale.set(0.92, 1.12, 1.04);
  hairCap.rotation.x = -0.25;
  head.add(hairCap, headwear(L.h, colour, hairCol));

  // Backpack with shoulder straps and a bedroll.
  const pack = new THREE.Group();
  pack.position.set(0, 0.3, -0.16);
  spine.add(pack);
  pack.add(mesh(new RoundedBoxGeometry(0.3, 0.44, 0.17, 3, 0.05), packMat));
  pack.add(mesh(new RoundedBoxGeometry(0.31, 0.12, 0.18, 2, 0.04), fabric(0x474b37), 0, 0.17, 0.003));
  pack.add(mesh(new RoundedBoxGeometry(0.2, 0.14, 0.05, 2, 0.02), fabric(0x474b37), 0, -0.08, -0.1));
  const roll = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.36, 16), fabric(0x8c2f2a), 0, 0.27, 0);
  roll.rotation.z = Math.PI / 2;
  pack.add(roll);
  const bottle = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.15, 12), std(0x9fb2c4, 0.25, { metalness: 0.7 }), 0.18, -0.05, 0);
  pack.add(bottle);
  for (const sx of [-1, 1]) {
    const over = mesh(new THREE.BoxGeometry(0.045, 0.014, 0.24), strap, sx * 0.1, 0.275, 0.08);
    const down = mesh(new THREE.BoxGeometry(0.045, 0.3, 0.012), strap, sx * 0.11, 0.07, 0.305);
    down.rotation.x = 0.08;
    pack.add(over, down);
  }

  // Arms: shoulder -> elbow -> glove.
  const arm = (sx) => {
    const sh = new THREE.Group();
    sh.position.set(sx * 0.235, 0.47, 0);
    spine.add(sh);
    const upper = capsule(0.064, 0.19, jacket);
    upper.position.y = -0.14;
    const el = new THREE.Group();
    el.position.y = -0.29;
    const fore = capsule(0.056, 0.17, jacket);
    fore.position.y = -0.12;
    const cuff = mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.035, 14), jacketDark, 0, -0.22, 0);
    const hand = mesh(new RoundedBoxGeometry(0.065, 0.095, 0.035, 2, 0.015), glove, 0, -0.28, 0.005);
    const thumb = mesh(new THREE.CapsuleGeometry(0.012, 0.03, 4, 8), glove, -sx * 0.03, -0.27, 0.025);
    thumb.rotation.z = sx * 0.6;
    el.add(fore, cuff, hand, thumb);
    sh.add(upper, el);
    return { sh, el };
  };
  const leg = (sx) => {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.1, -0.02, 0);
    hips.add(hip);
    const thigh = capsule(0.088, 0.24, pants);
    thigh.position.y = -0.21;
    const knee = new THREE.Group();
    knee.position.y = -0.43;
    const shin = capsule(0.07, 0.25, pants);
    shin.position.y = -0.2;
    const foot = new THREE.Group();
    foot.position.y = -0.44;
    const boot = mesh(new RoundedBoxGeometry(0.11, 0.11, 0.25, 3, 0.035), bootMat, 0, 0.015, 0.035);
    const cuffB = mesh(new THREE.CylinderGeometry(0.062, 0.058, 0.08, 14), bootMat, 0, 0.07, 0);
    const soleM = mesh(new RoundedBoxGeometry(0.115, 0.03, 0.26, 2, 0.01), sole, 0, -0.04, 0.035);
    const lace = mesh(new THREE.BoxGeometry(0.04, 0.008, 0.1), std(0xc9a46a, 0.8), 0, 0.072, 0.09);
    foot.add(boot, cuffB, soleM, lace);
    knee.add(shin, foot);
    hip.add(thigh, knee);
    return { hip, knee, foot };
  };

  const U = {
    hips, spine, neck, head, eyes, pack,
    armL: arm(-1), armR: arm(1), legL: leg(-1), legR: leg(1),
    look: L, blinkT: 2 + Math.random() * 3, emote: null, emoteT: 0, t: Math.random() * 10,
  };
  root.traverse((o) => { if (o.isMesh) { o.castShadow = shadows; o.receiveShadow = shadows; } });
  root.userData = U;
  return root;
}

export function disposeClimber(model) {
  // Shared canvas textures stay alive for the next climber.
  model.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
}

/** Animate a climber. mode: ground | air | climb | rope | down. phase advances with movement. */
export function poseClimber(model, mode, facing, phase, dt, moving = 0) {
  const U = model.userData;
  U.t += dt;
  const t = U.t;
  const s = Math.sin(phase);
  model.rotation.set(0, facing, 0);
  const { hips, spine, neck, head, eyes, pack, armL, armR, legL, legR } = U;
  // Rest pose.
  hips.position.y = 0.96;
  hips.rotation.set(0, 0, 0);
  spine.rotation.set(Math.sin(t * 2.1) * 0.012, 0, 0);
  neck.rotation.set(0, 0, 0);
  head.rotation.set(Math.sin(t * 0.7) * 0.03, Math.sin(t * 0.45) * 0.08, 0);
  pack.rotation.set(0, 0, 0);
  for (const [a, sx] of [[armL, -1], [armR, 1]]) { a.sh.rotation.set(0.05, 0, sx * 0.1); a.el.rotation.set(-0.18, 0, 0); }
  for (const l of [legL, legR]) { l.hip.rotation.set(0, 0, 0); l.knee.rotation.set(0.04, 0, 0); l.foot.rotation.set(0, 0, 0); }

  U.blinkT -= dt;
  eyes.scale.y = U.blinkT < 0.1 ? 0.1 : 1;
  if (U.blinkT < 0) U.blinkT = 2.5 + Math.random() * 4;

  if (mode === 'climb') {
    // Reaching up the wall: alternate hands and feet.
    spine.rotation.x = 0.18;
    head.rotation.x = -0.45;
    armL.sh.rotation.set(-2.55 + s * 0.35, 0, -0.18);
    armR.sh.rotation.set(-2.55 - s * 0.35, 0, 0.18);
    armL.el.rotation.x = -0.35 - Math.max(0, -s) * 0.6;
    armR.el.rotation.x = -0.35 - Math.max(0, s) * 0.6;
    legL.hip.rotation.x = -0.75 - Math.max(0, s) * 0.45;
    legR.hip.rotation.x = -0.75 - Math.max(0, -s) * 0.45;
    legL.knee.rotation.x = 1.1 + Math.max(0, s) * 0.4;
    legR.knee.rotation.x = 1.1 + Math.max(0, -s) * 0.4;
    legL.foot.rotation.x = legR.foot.rotation.x = -0.4;
    hips.position.y = 0.9;
  } else if (mode === 'rope') {
    spine.rotation.x = 0.08;
    head.rotation.x = -0.35;
    armL.sh.rotation.set(-2.85 + s * 0.25, 0, -0.08);
    armR.sh.rotation.set(-2.85 - s * 0.25, 0, 0.08);
    armL.el.rotation.x = -0.25 - Math.max(0, -s) * 0.5;
    armR.el.rotation.x = -0.25 - Math.max(0, s) * 0.5;
    legL.hip.rotation.x = -0.45;
    legR.hip.rotation.x = -0.3;
    legL.knee.rotation.x = 0.8;
    legR.knee.rotation.x = 0.6;
    legL.hip.rotation.z = 0.08;
    legR.hip.rotation.z = -0.08;
  } else if (mode === 'air') {
    const f = t * 11;
    armL.sh.rotation.set(-1.2 + Math.sin(f) * 0.5, 0, -1.1);
    armR.sh.rotation.set(-1.2 - Math.sin(f) * 0.5, 0, 1.1);
    armL.el.rotation.x = armR.el.rotation.x = -0.5;
    legL.hip.rotation.x = -0.5 + Math.sin(f * 0.7) * 0.4;
    legR.hip.rotation.x = -0.5 - Math.sin(f * 0.7) * 0.4;
    legL.knee.rotation.x = legR.knee.rotation.x = 0.9;
    head.rotation.x = 0.25;
  } else if (mode === 'down') {
    model.rotation.set(-Math.PI / 2, facing, 0, 'YXZ');
    model.position.y += 0.18;
    armL.sh.rotation.set(0, 0, -1.25);
    armR.sh.rotation.set(0, 0, 1.25);
    armL.el.rotation.x = armR.el.rotation.x = -0.3;
    legL.hip.rotation.set(-0.15, 0, -0.12);
    legR.hip.rotation.set(-0.35, 0, 0.12);
    legL.knee.rotation.x = 0.3;
    legR.knee.rotation.x = 0.7;
    head.rotation.set(0, 0.5, 0);
    eyes.scale.y = 0.1;
  } else {
    // Walking / running gait with knee and elbow bend; idle sway when still.
    const w = Math.min(1, moving);
    const run = Math.max(0, (moving - 0.75) * 4);
    hips.position.y = 0.96 - 0.02 * w + Math.abs(Math.cos(phase)) * 0.035 * w;
    hips.rotation.y = s * 0.12 * w;
    spine.rotation.x += 0.05 * w + 0.12 * run;
    spine.rotation.y = -s * 0.2 * w;
    head.rotation.y *= 1 - w;
    const sw = 0.55 + 0.25 * run;
    legL.hip.rotation.x = -s * sw * w;
    legR.hip.rotation.x = s * sw * w;
    legL.knee.rotation.x = 0.05 + w * (0.25 + 0.9 * Math.max(0, Math.sin(phase + 1.3)));
    legR.knee.rotation.x = 0.05 + w * (0.25 + 0.9 * Math.max(0, Math.sin(phase + 1.3 + Math.PI)));
    legL.foot.rotation.x = -0.25 * w * Math.max(0, -s);
    legR.foot.rotation.x = -0.25 * w * Math.max(0, s);
    armL.sh.rotation.x = s * 0.5 * w + 0.05;
    armR.sh.rotation.x = -s * 0.5 * w + 0.05;
    armL.el.rotation.x = -0.25 - (0.35 + 0.5 * run) * w * (0.5 + 0.5 * Math.max(0, s));
    armR.el.rotation.x = -0.25 - (0.35 + 0.5 * run) * w * (0.5 + 0.5 * Math.max(0, -s));
    pack.rotation.z = -s * 0.04 * w;
  }

  if (U.emote && mode !== 'down') {
    U.emoteT -= dt;
    const e = t * 9;
    if (U.emote === 'wave') {
      armR.sh.rotation.set(0, 0, 2.55);
      armR.el.rotation.set(0, 0, 0.35 + Math.sin(e) * 0.45);
      head.rotation.z = 0.08;
    } else if (U.emote === 'cheer') {
      armL.sh.rotation.set(-0.3, 0, -2.75 - Math.sin(e) * 0.12);
      armR.sh.rotation.set(-0.3, 0, 2.75 + Math.sin(e) * 0.12);
      armL.el.rotation.x = armR.el.rotation.x = -0.2;
      hips.position.y += Math.abs(Math.sin(e * 0.55)) * 0.12;
    } else if (U.emote === 'point') {
      armR.sh.rotation.set(-1.5, 0, 0.12);
      armR.el.rotation.x = 0;
      head.rotation.x = -0.05;
    }
    if (U.emoteT <= 0) U.emote = null;
  }
}

export function playEmote(model, e) {
  model.userData.emote = e;
  model.userData.emoteT = e === 'point' ? 2.5 : 2.2;
}

/** Floating name tag sprite (always readable, visible through walls). */
export function makeTag(text, bg = 'rgba(20,16,12,0.7)') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = '700 26px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const w = Math.min(250, x.measureText(text).width + 30);
  x.fillStyle = bg;
  if (x.roundRect) { x.beginPath(); x.roundRect((256 - w) / 2, 10, w, 44, 22); x.fill(); } else x.fillRect((256 - w) / 2, 10, w, 44);
  x.fillStyle = '#fff';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 128, 33, 230);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, fog: false, transparent: true }));
  sp.scale.set(1.6, 0.4, 1);
  sp.renderOrder = 10;
  return sp;
}
