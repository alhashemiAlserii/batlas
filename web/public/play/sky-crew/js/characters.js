// Procedural low-poly characters + name tags with rank badges.
import * as THREE from '../../vendor/three.module.js';

export const RANK_COLORS = { DEVELOPER: '#f5c542', ADMIN: '#4a8cff', TRUSTED: '#3ddc84', PLAYER: '#f2f4fa' };
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xa66a3a];

const matCache = new Map();
const lam = (c) => { if (!matCache.has(c)) matCache.set(c, new THREE.MeshLambertMaterial({ color: c })); return matCache.get(c); };
const G = {
  torso: new THREE.CylinderGeometry(0.2, 0.15, 0.5, 8), chest: new THREE.SphereGeometry(0.21, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  hips: new THREE.CylinderGeometry(0.16, 0.17, 0.14, 8), neck: new THREE.CylinderGeometry(0.06, 0.07, 0.1, 6),
  head: new THREE.SphereGeometry(0.15, 14, 10), eye: new THREE.SphereGeometry(0.022, 6, 4), nose: new THREE.ConeGeometry(0.025, 0.06, 5),
  ear: new THREE.SphereGeometry(0.035, 6, 4),
  upper: new THREE.CylinderGeometry(0.055, 0.05, 0.3, 6), fore: new THREE.CylinderGeometry(0.048, 0.042, 0.28, 6), hand: new THREE.SphereGeometry(0.05, 6, 5),
  thigh: new THREE.CylinderGeometry(0.08, 0.07, 0.42, 7), shin: new THREE.CylinderGeometry(0.065, 0.055, 0.42, 7), shoe: new THREE.BoxGeometry(0.11, 0.08, 0.24),
  cap: new THREE.SphereGeometry(0.158, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), skirt: new THREE.CylinderGeometry(0.17, 0.27, 0.42, 10, 1, true),
  bun: new THREE.SphereGeometry(0.07, 8, 6), spike: new THREE.ConeGeometry(0.04, 0.12, 4), longHair: new THREE.BoxGeometry(0.28, 0.3, 0.08),
  hatTop: new THREE.CylinderGeometry(0.16, 0.165, 0.09, 12), brim: new THREE.CylinderGeometry(0.2, 0.2, 0.015, 12), badge: new THREE.BoxGeometry(0.05, 0.03, 0.01),
  vest: new THREE.CylinderGeometry(0.215, 0.165, 0.42, 8, 1, true), scarf: new THREE.TorusGeometry(0.085, 0.025, 5, 10), glasses: new THREE.TorusGeometry(0.03, 0.006, 4, 8),
};
const part = (geo, color, x, y, z, parent) => { const m = new THREE.Mesh(geo, lam(color)); m.position.set(x, y, z); parent.add(m); return m; };
const HAIR = [0x2b1b12, 0x5a3a22, 0x8a5a2b, 0xd9b26a, 0x111111, 0xb24a2a, 0x9a9a9a];

/**
 * Low-poly person. Joints: hips -> thigh -> knee -> shin; shoulder -> upper arm -> elbow -> forearm.
 * look: { shirt, pants, skin, hair: 'short'|'long'|'bun'|'spiky'|'bald'|'cap', hairColor, skirt, glasses, scale, uniform }
 */
export function makeCharacter(look = {}) {
  const { shirt = 0x1e6bff, pants = 0x1b2333, skin = SKIN[0], hair = 'short', hairColor = HAIR[0], skirt = false, glasses = false, scale = 1, uniform = null } = look;
  let hat = look.hat ?? null;
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const pelvis = new THREE.Group(); pelvis.position.y = 0.9; body.add(pelvis);
  part(G.hips, pants, 0, 0, 0, pelvis);
  const torso = new THREE.Group(); torso.position.y = 0.05; pelvis.add(torso);
  part(G.torso, shirt, 0, 0.25, 0, torso);
  const ch = part(G.chest, shirt, 0, 0.47, 0, torso); ch.scale.set(1, 0.45, 0.8);
  part(G.neck, skin, 0, 0.58, 0, torso);
  if (uniform === 'cargo') { const v = part(G.vest, 0xff8a1a, 0, 0.26, 0, torso); v.material = new THREE.MeshLambertMaterial({ color: 0xff8a1a, side: THREE.DoubleSide }); part(new THREE.BoxGeometry(0.42, 0.03, 0.34), 0xe8f060, 0, 0.32, 0, torso); }
  if (uniform === 'cabin') { const sc = part(G.scarf, 0x19d3c5, 0, 0.56, -0.02, torso); sc.rotation.x = Math.PI / 2; }
  if (uniform === 'pilot' || uniform === 'copilot') { part(G.badge, 0xf5c542, 0.09, 0.42, -0.19, torso); hat = hat ?? 0x0a1f5c; }
  const head = new THREE.Group(); head.position.y = 0.76; torso.add(head);
  part(G.head, skin, 0, 0, 0, head).scale.set(1, 1.08, 1);
  for (const s of [-1, 1]) { part(G.eye, 0x151515, s * 0.055, 0.02, -0.135, head); part(G.ear, skin, s * 0.15, 0, 0, head); }
  part(G.nose, skin, 0, -0.02, -0.155, head).rotation.x = -Math.PI / 2;
  if (glasses) for (const s of [-1, 1]) part(G.glasses, 0x222222, s * 0.055, 0.02, -0.145, head);
  if (hat) {
    part(G.hatTop, hat, 0, 0.11, 0, head); part(G.brim, uniform ? 0x111111 : hat, 0, 0.07, -0.04, head);
    if (uniform === 'pilot' || uniform === 'copilot') part(G.badge, 0xf5c542, 0, 0.12, -0.16, head);
  } else if (hair !== 'bald') {
    const cap = part(G.cap, hairColor, 0, 0.005, 0.01, head); cap.scale.set(1.02, 1.1, 1.05);
    if (hair === 'long') part(G.longHair, hairColor, 0, -0.1, 0.12, head);
    if (hair === 'bun') part(G.bun, hairColor, 0, 0.12, 0.12, head);
    if (hair === 'spiky') for (let i = 0; i < 6; i++) { const sp = part(G.spike, hairColor, Math.cos(i) * 0.08, 0.15, Math.sin(i) * 0.06, head); sp.rotation.z = Math.cos(i) * 0.5; }
  }
  const limbs = {};
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.09, -0.02, 0); pelvis.add(hip);
    part(G.thigh, pants, 0, -0.21, 0, hip);
    const knee = new THREE.Group(); knee.position.y = -0.42; hip.add(knee);
    part(G.shin, skirt ? skin : pants, 0, -0.21, 0, knee);
    part(G.shoe, 0x222222, 0, -0.44, -0.05, knee);
    const sh = new THREE.Group(); sh.position.set(s * 0.25, 0.5, 0); torso.add(sh);
    part(G.upper, shirt, 0, -0.15, 0, sh);
    const elbow = new THREE.Group(); elbow.position.y = -0.3; sh.add(elbow);
    part(G.fore, uniform === 'cargo' ? 0xff8a1a : skin, 0, -0.14, 0, elbow);
    part(G.hand, skin, 0, -0.3, 0, elbow);
    const k = s < 0 ? 'L' : 'R';
    limbs[`hip${k}`] = hip; limbs[`knee${k}`] = knee; limbs[`sh${k}`] = sh; limbs[`el${k}`] = elbow;
  }
  if (skirt) { const sk = new THREE.Mesh(G.skirt, new THREE.MeshLambertMaterial({ color: pants, side: THREE.DoubleSide })); sk.position.y = -0.2; pelvis.add(sk); }
  for (const m of g.children) m.castShadow = true;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.scale.setScalar(scale);
  g.userData = { body, pelvis, torso, head, limbs, t: Math.random() * 10 };
  return g;
}

/** Animate walk cycle / sitting / panic / dance / carrying. */
export function animateCharacter(ch, dt, { moving = false, sitting = false, panic = false, dance = false, carrying = false, sleep = false, flail = false } = {}) {
  const u = ch.userData; u.t += dt * (moving ? 8.5 : flail ? 14 : 2.5);
  const L = u.limbs, t = u.t;
  if (flail) { // being carried / thrown: arms and legs everywhere (cartoon style)
    u.body.position.set(0, 0, 0); u.torso.rotation.x = 0; u.head.rotation.x = Math.sin(t * 0.7) * 0.3; u.head.rotation.y = Math.sin(t * 0.5) * 0.5;
    L.shL.rotation.x = -2.4 + Math.sin(t) * 0.9; L.shR.rotation.x = -2.4 - Math.sin(t) * 0.9;
    L.shL.rotation.z = -0.5 - Math.sin(t * 1.3) * 0.4; L.shR.rotation.z = 0.5 + Math.sin(t * 1.3) * 0.4;
    L.elL.rotation.x = L.elR.rotation.x = -0.6;
    L.hipL.rotation.x = Math.sin(t * 1.1) * 0.9; L.hipR.rotation.x = -Math.sin(t * 1.1) * 0.9;
    L.kneeL.rotation.x = L.kneeR.rotation.x = 0.5;
    return;
  }
  if (sitting) {
    u.body.position.set(0, -0.4, 0.06);
    L.hipL.rotation.x = L.hipR.rotation.x = Math.PI / 2;
    L.kneeL.rotation.x = L.kneeR.rotation.x = -Math.PI / 2;
    u.torso.rotation.x = sleep ? 0.18 : 0.05;
    u.head.rotation.x = sleep ? 0.35 : Math.sin(t * 0.6) * 0.05;
    u.head.rotation.y = sleep ? 0 : Math.sin(t * 0.3) * 0.3;
    if (panic) { L.shL.rotation.x = L.shR.rotation.x = -2.6 + Math.sin(t * 10) * 0.3; L.elL.rotation.x = L.elR.rotation.x = -0.4; }
    else { L.shL.rotation.x = L.shR.rotation.x = -0.45; L.elL.rotation.x = L.elR.rotation.x = -0.9; }
    L.shL.rotation.z = L.shR.rotation.z = 0;
    return;
  }
  u.body.position.set(0, moving ? Math.abs(Math.sin(t)) * 0.04 : 0, 0);
  u.torso.rotation.x = 0; u.head.rotation.x = 0; u.head.rotation.y = 0;
  const sw = moving ? Math.sin(t) * 0.55 : 0;
  L.hipL.rotation.x = sw; L.hipR.rotation.x = -sw;
  L.kneeL.rotation.x = moving ? Math.max(0, -Math.sin(t)) * -0.0 + Math.max(0, Math.sin(t + 1.4)) * 0.7 : 0;
  L.kneeR.rotation.x = moving ? Math.max(0, Math.sin(t + Math.PI + 1.4)) * 0.7 : 0;
  L.shL.rotation.z = 0; L.shR.rotation.z = 0;
  if (carrying) { L.shL.rotation.x = L.shR.rotation.x = -1.25; L.elL.rotation.x = L.elR.rotation.x = -0.35; L.shL.rotation.z = -0.15; L.shR.rotation.z = 0.15; }
  else if (dance) { L.shL.rotation.x = -2.8 + Math.sin(t * 2) * 0.5; L.shR.rotation.x = -2.8 - Math.sin(t * 2) * 0.5; L.elL.rotation.x = L.elR.rotation.x = -0.6; u.body.position.y = Math.abs(Math.sin(t * 2)) * 0.1; }
  else if (panic) { L.shL.rotation.x = L.shR.rotation.x = -2.7 + Math.sin(t * 8) * 0.4; L.elL.rotation.x = L.elR.rotation.x = -0.5; }
  else { L.shL.rotation.x = -sw * 0.8; L.shR.rotation.x = sw * 0.8; L.elL.rotation.x = L.elR.rotation.x = moving ? -0.35 : -0.1; }
  if (dance) ch.rotation.y += dt * 3;
}

/** Passenger appearance from a seeded RNG, so every client builds identical people. */
export function randomPassengerLook(rnd = Math.random) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const shirts = [0xe74c3c, 0x27ae60, 0xf39c12, 0x8e44ad, 0x16a085, 0xd35400, 0x2c3e50, 0xc0392b, 0x7f8c8d, 0xe84393, 0xfdcb6e, 0x74b9ff];
  const hair = pick(['short', 'short', 'long', 'bun', 'spiky', 'bald', 'cap']);
  return {
    shirt: pick(shirts), pants: pick([0x2d3436, 0x34495e, 0x6c5ce7, 0x636e72, 0x1e3a5f, 0x8d6e63]), skin: pick(SKIN),
    hair: hair === 'cap' ? 'short' : hair, hat: hair === 'cap' ? pick([0xfdcb6e, 0x0984e3, 0xd63031, 0x2d3436]) : null,
    hairColor: pick(HAIR), skirt: rnd() < 0.25, glasses: rnd() < 0.25, scale: 0.9 + rnd() * 0.16,
  };
}

/** Billboard sprite with player name + rank badge. Colours come from the server-verified rank. */
export function nameTag(name, role) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  const color = RANK_COLORS[role] || RANK_COLORS.PLAYER;
  g.font = 'bold 44px -apple-system, Segoe UI, sans-serif';
  const label = role || 'PLAYER';
  g.font = 'bold 26px -apple-system, Segoe UI, sans-serif';
  const bw = g.measureText(label).width + 26;
  g.font = 'bold 44px -apple-system, Segoe UI, sans-serif';
  const nw = Math.min(330, g.measureText(name).width);
  const total = bw + 14 + nw + 28, x0 = (512 - total) / 2;
  g.fillStyle = 'rgba(2,10,36,0.72)'; roundRect(g, x0, 24, total, 80, 18); g.fill();
  g.fillStyle = role === 'PLAYER' ? 'rgba(0,0,0,0)' : color; roundRect(g, x0 + 12, 44, bw, 40, 9); g.fill();
  if (role === 'PLAYER') { g.strokeStyle = color; g.lineWidth = 3; roundRect(g, x0 + 12, 44, bw, 40, 9); g.stroke(); }
  g.font = 'bold 26px -apple-system, Segoe UI, sans-serif'; g.fillStyle = role === 'PLAYER' ? color : role === 'ADMIN' ? '#ffffff' : '#1a1200';
  g.textBaseline = 'middle'; g.fillText(label, x0 + 25, 65);
  g.font = 'bold 44px -apple-system, Segoe UI, sans-serif'; g.fillStyle = color; g.fillText(name, x0 + 12 + bw + 14, 66, 330);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.4, 1); s.position.y = 2.05; s.renderOrder = 10;
  return s;
}

const ICONS = { water: '💧', snack: '🍪', blanket: '🛏️', complaint: '😤', panic: '😱', happy: '😊', sleep: '💤' };
const iconCache = {};
export function bubble(kind) {
  if (!iconCache[kind]) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(64, 58, 50, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(50, 100); g.lineTo(64, 124); g.lineTo(78, 100); g.fill();
    g.font = '62px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ICONS[kind] || '❗', 64, 62);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    iconCache[kind] = new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true });
  }
  const s = new THREE.Sprite(iconCache[kind]); s.scale.set(0.45, 0.45, 1); s.position.y = 2.0; s.renderOrder = 11;
  return s;
}

function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
