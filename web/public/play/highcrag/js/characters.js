// Highcrag — the climbers: round, chunky little explorers (original design).
// Looks are data: { c: outfit colour, h: hat, s: skin }. Everything is built from primitives.
import * as THREE from '../../vendor/three.module.js';
import { RoundedBoxGeometry } from '../../vendor/addons/RoundedBoxGeometry.js';

export const OUTFITS = [0xff7a29, 0x2f9bff, 0x3ddc84, 0xc86bff, 0xffd23f, 0xff4f6d, 0x23c7c7, 0x8a6bff, 0xf4f4f4, 0x4a5568];
export const OUTFIT_NAMES = ['Tangerine', 'Sky', 'Fern', 'Orchid', 'Sunny', 'Berry', 'Lagoon', 'Iris', 'Snow', 'Slate'];
export const HATS = ['Bobble beanie', 'Bucket hat', 'Trail cap', 'Explorer helmet', 'Trapper hat', 'No hat'];
export const SKINS = [0xf6d2b5, 0xeab88f, 0xd49a6a, 0xa86b45, 0x7a4a2e, 0x5a3622];
export const DEFAULT_LOOK = { c: 0, h: 0, s: 1 };
export const validLook = (l) => ({
  c: Number.isInteger(l?.c) && l.c >= 0 && l.c < OUTFITS.length ? l.c : 0,
  h: Number.isInteger(l?.h) && l.h >= 0 && l.h < HATS.length ? l.h : 0,
  s: Number.isInteger(l?.s) && l.s >= 0 && l.s < SKINS.length ? l.s : 1,
});

const mat = (color, extra) => new THREE.MeshLambertMaterial({ color, ...extra });

function hatFor(h, colour) {
  const g = new THREE.Group();
  const main = mat(colour);
  const dark = mat(new THREE.Color(colour).multiplyScalar(0.6));
  const cream = mat(0xfff3d6);
  if (h === 0) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.375, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), main);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.07, 6, 18), cream);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.04;
    const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 1), cream);
    pom.position.y = 0.4;
    g.add(cap, rim, pom);
    g.position.y = 0.06;
  } else if (h === 1) {
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.26, 14), mat(0xd9c38f));
    crown.position.y = 0.2;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.6, 0.04, 18), mat(0xc9b07a));
    brim.position.y = 0.08;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.365, 0.365, 0.07, 14), main);
    band.position.y = 0.12;
    g.add(crown, brim, band);
    g.position.y = 0.1;
  } else if (h === 2) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.375, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), main);
    const bill = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 14, 1, false, -Math.PI / 2, Math.PI), dark);
    bill.position.set(0, 0.03, 0.22);
    const btn = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), dark);
    btn.position.y = 0.37;
    g.add(cap, bill, btn);
    g.position.y = 0.08;
  } else if (h === 3) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xe8dcb5));
    dome.scale.y = 0.85;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.52, 0.04, 18), mat(0xd8c99c));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.405, 0.405, 0.06, 16), main);
    band.position.y = 0.04;
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 10), mat(0xfff6a8, { emissive: 0xffe066, emissiveIntensity: 0.8 }));
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(0, 0.16, 0.38);
    g.add(dome, brim, band, lamp);
    g.position.y = 0.1;
  } else if (h === 4) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.39, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), main);
    const fur = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.08, 6, 18), cream);
    fur.rotation.x = Math.PI / 2;
    fur.position.y = 0.04;
    for (const sx of [-1, 1]) {
      const flap = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.34, 0.24, 2, 0.04), main);
      flap.position.set(sx * 0.36, -0.12, 0);
      g.add(flap);
    }
    g.add(cap, fur);
    g.position.y = 0.04;
  } else {
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 5), mat(0x3b2a1e));
    tuft.position.set(0, 0.36, 0.05);
    tuft.rotation.x = 0.4;
    g.add(tuft);
  }
  return g;
}

/** Build a climber. The origin is at the feet; +z is forward. */
export function makeClimber(look = DEFAULT_LOOK, { shadows = false } = {}) {
  const L = validLook(look);
  const colour = OUTFITS[L.c];
  const root = new THREE.Group();
  const outfit = mat(colour);
  const outfitLight = mat(new THREE.Color(colour).lerp(new THREE.Color(0xffffff), 0.45));
  const skin = mat(SKINS[L.s]);
  const pants = mat(0x2f3a55);
  const boots = mat(0x5a3a22);
  const white = mat(0xffffff);
  const black = mat(0x1a1a24);
  const blush = mat(0xff8f9a, { transparent: true, opacity: 0.65 });

  const body = new THREE.Group();
  body.position.y = 0.72;
  root.add(body);
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), outfit);
  torso.scale.set(1, 1.12, 0.9);
  torso.position.y = 0.22;
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), outfitLight);
  belly.scale.set(1, 1.1, 0.6);
  belly.position.set(0, 0.16, 0.22);
  const zipper = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.42, 0.02), mat(0xd9d9d9));
  zipper.position.set(0, 0.2, 0.39);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.08, 8, 16), mat([0, 5].includes(L.c) ? 0x3c7be9 : 0xe94e3c));
  scarf.rotation.x = Math.PI / 2;
  scarf.position.y = 0.6;
  const tail = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.3, 0.06, 2, 0.03), scarf.material);
  tail.position.set(0.16, 0.45, 0.24);
  tail.rotation.z = -0.25;
  body.add(torso, belly, zipper, scarf, tail);

  const pack = new THREE.Group();
  pack.position.set(0, 0.25, -0.38);
  const bag = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.66, 0.32, 3, 0.1), mat(0x7a6a3a));
  const flap = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.22, 0.34, 2, 0.08), mat(0x5f522b));
  flap.position.y = 0.24;
  const pocket = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.22, 0.1, 2, 0.04), mat(0x5f522b));
  pocket.position.set(0, -0.12, -0.18);
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.66, 12), mat(0xc23b3b));
  roll.rotation.z = Math.PI / 2;
  roll.position.y = 0.45;
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.12, 10), mat(0xb7c0cc));
  cup.position.set(0.32, -0.05, 0);
  pack.add(bag, flap, pocket, roll, cup);
  body.add(pack);

  const head = new THREE.Group();
  head.position.y = 0.8;
  body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.37, 20, 16), skin);
  const eyes = new THREE.Group();
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 10), white);
    w.scale.set(0.9, 1.15, 0.5);
    w.position.set(sx * 0.13, 0.05, 0.31);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), black);
    p.position.set(sx * 0.13, 0.04, 0.355);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), white);
    glint.position.set(sx * 0.13 + 0.02, 0.07, 0.4);
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6), blush);
    cheek.scale.set(1, 0.6, 0.3);
    cheek.position.set(sx * 0.22, -0.09, 0.28);
    eyes.add(w, p, glint);
    head.add(cheek);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mat(new THREE.Color(SKINS[L.s]).multiplyScalar(0.88)));
  nose.position.set(0, -0.04, 0.36);
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.016, 6, 12, Math.PI), black);
  mouth.rotation.z = Math.PI;
  mouth.position.set(0, -0.13, 0.33);
  head.add(skull, eyes, nose, mouth, hatFor(L.h, colour));

  const limb = (parent, px, py, pz, len, radius, material, end, endMat) => {
    const pivot = new THREE.Group();
    pivot.position.set(px, py, pz);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, len, 4, 10), material);
    m.position.y = -len / 2 - radius * 0.5;
    pivot.add(m);
    if (end) {
      const e = new THREE.Mesh(end, endMat);
      e.position.y = -len - radius * 1.4;
      pivot.add(e);
    }
    parent.add(pivot);
    return pivot;
  };
  const glove = new THREE.SphereGeometry(0.1, 10, 8);
  const boot = new RoundedBoxGeometry(0.2, 0.14, 0.3, 2, 0.06);
  boot.translate(0, 0, 0.05);
  const armL = limb(body, -0.42, 0.42, 0, 0.36, 0.085, outfit, glove, skin);
  const armR = limb(body, 0.42, 0.42, 0, 0.36, 0.085, outfit, glove, skin);
  const legL = limb(root, -0.17, 0.62, 0, 0.36, 0.1, pants, boot, boots);
  const legR = limb(root, 0.17, 0.62, 0, 0.36, 0.1, pants, boot, boots);

  root.traverse((o) => { if (o.isMesh) { o.castShadow = shadows; o.receiveShadow = false; } });
  root.userData = { body, head, pack, eyes, armL, armR, legL, legR, look: L, blinkT: 2 + Math.random() * 3, emote: null, emoteT: 0, t: Math.random() * 10 };
  return root;
}

export function disposeClimber(model) {
  model.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
}

/** Animate a climber. mode: ground | air | climb | rope | down | lobby. phase advances with movement. */
export function poseClimber(model, mode, facing, phase, dt, moving = 0) {
  const U = model.userData;
  U.t += dt;
  const s = Math.sin(phase), c = Math.cos(phase);
  model.rotation.set(0, facing, 0);
  const { body, head, pack, armL, armR, legL, legR, eyes } = U;
  body.rotation.set(0, 0, 0);
  body.position.y = 0.72;
  head.rotation.set(0, 0, 0);
  pack.rotation.set(0, 0, 0);
  armL.rotation.set(0, 0, 0.12);
  armR.rotation.set(0, 0, -0.12);
  legL.rotation.set(0, 0, 0);
  legR.rotation.set(0, 0, 0);
  const breathe = 1 + Math.sin(U.t * 2.2) * 0.015;
  body.scale.set(1, breathe, 1);

  // Blink every few seconds.
  U.blinkT -= dt;
  eyes.scale.y = U.blinkT < 0.12 ? 0.1 : 1;
  if (U.blinkT < 0) U.blinkT = 2 + Math.random() * 4;

  if (mode === 'climb') {
    body.rotation.x = 0.28;
    armL.rotation.set(-2.75 + s * 0.4, 0, 0.2);
    armR.rotation.set(-2.75 - s * 0.4, 0, -0.2);
    legL.rotation.x = -0.7 - s * 0.35;
    legR.rotation.x = -0.7 + s * 0.35;
    head.rotation.x = -0.35;
    pack.rotation.x = 0.1 * c;
  } else if (mode === 'rope') {
    armL.rotation.set(-3.0 + s * 0.3, 0, 0.1);
    armR.rotation.set(-3.0 - s * 0.3, 0, -0.1);
    legL.rotation.x = -0.4 + c * 0.2;
    legR.rotation.x = -0.4 - c * 0.2;
    head.rotation.x = -0.3;
  } else if (mode === 'air') {
    const f = U.t * 14;
    armL.rotation.set(-1.6 + Math.sin(f) * 0.9, 0, 0.9);
    armR.rotation.set(-1.6 - Math.sin(f) * 0.9, 0, -0.9);
    legL.rotation.x = Math.sin(f * 0.8) * 0.6;
    legR.rotation.x = -Math.sin(f * 0.8) * 0.6;
    head.rotation.x = 0.2;
    pack.rotation.x = -0.3;
  } else if (mode === 'down') {
    model.rotation.set(-Math.PI / 2, facing, 0, 'YXZ');
    model.position.y += 0.35;
    armL.rotation.set(0, 0, 1.3);
    armR.rotation.set(0, 0, -1.3);
    legL.rotation.z = 0.2;
    legR.rotation.z = -0.2;
    eyes.scale.y = 0.1;
  } else {
    // Walking waddle (or idle sway).
    const w = Math.min(1, moving);
    body.rotation.z = s * 0.12 * w;
    body.position.y = 0.72 + Math.abs(c) * 0.06 * w;
    head.rotation.z = -s * 0.08 * w;
    head.rotation.x = Math.sin(U.t * 1.3) * 0.04;
    armL.rotation.x = s * 0.8 * w;
    armR.rotation.x = -s * 0.8 * w;
    legL.rotation.x = -s * 0.75 * w;
    legR.rotation.x = s * 0.75 * w;
    pack.rotation.z = -s * 0.1 * w;
  }

  // Emotes override the arms for a moment.
  if (U.emote && mode !== 'down') {
    U.emoteT -= dt;
    const e = U.t * 10;
    if (U.emote === 'wave') { armR.rotation.set(-0.2, 0, -2.6 + Math.sin(e) * 0.35); head.rotation.z = 0.12; }
    else if (U.emote === 'cheer') { armL.rotation.set(0, 0, 2.7 + Math.sin(e) * 0.2); armR.rotation.set(0, 0, -2.7 - Math.sin(e) * 0.2); body.position.y += Math.abs(Math.sin(e * 0.6)) * 0.15; }
    else if (U.emote === 'point') { armR.rotation.set(-1.55, 0, -0.1); head.rotation.x = -0.1; }
    if (U.emoteT <= 0) U.emote = null;
  }
}

export function playEmote(model, e) {
  model.userData.emote = e;
  model.userData.emoteT = e === 'point' ? 2.5 : 2.2;
}

/** Floating name tag sprite (always readable, visible through walls). */
export function makeTag(text, bg = 'rgba(30,20,10,0.72)') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = '800 28px ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const w = Math.min(250, x.measureText(text).width + 34);
  x.fillStyle = bg;
  if (x.roundRect) { x.beginPath(); x.roundRect((256 - w) / 2, 8, w, 48, 24); x.fill(); } else x.fillRect((256 - w) / 2, 8, w, 48);
  x.fillStyle = '#fff';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 128, 33, 230);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, fog: false, transparent: true }));
  sp.scale.set(1.8, 0.45, 1);
  sp.renderOrder = 10;
  return sp;
}
