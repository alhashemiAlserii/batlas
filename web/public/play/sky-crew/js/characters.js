// Procedural low-poly characters + name tags with rank badges.
import * as THREE from '../../vendor/three.module.js';

export const RANK_COLORS = { DEVELOPER: '#f5c542', ADMIN: '#4a8cff', TRUSTED: '#3ddc84', PLAYER: '#f2f4fa' };
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xa66a3a];
const lam = (c) => new THREE.MeshLambertMaterial({ color: c });

export function makeCharacter({ shirt = 0x1e6bff, pants = 0x1b2333, skin = SKIN[0], hat = null, scale = 1 } = {}) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.62, 8), lam(shirt)); torso.position.y = 1.08; body.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), lam(skin)); head.position.y = 1.57; body.add(head);
  const eyeM = lam(0x111111);
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), eyeM); e.position.set(s * 0.06, 1.6, -0.15); body.add(e); }
  if (hat) { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.08, 10), lam(hat)); h.position.y = 1.72; body.add(h); const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.12), lam(hat)); b.position.set(0, 1.69, -0.18); body.add(b); }
  const limbs = {};
  for (const s of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(s * 0.11, 0.78, 0); body.add(leg);
    const lm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.76, 0.15), lam(pants)); lm.position.y = -0.38; leg.add(lm);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.24), lam(0x222222)); shoe.position.set(0, -0.74, -0.04); leg.add(shoe);
    const arm = new THREE.Group(); arm.position.set(s * 0.29, 1.35, 0); body.add(arm);
    const am = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.1), lam(shirt)); am.position.y = -0.27; arm.add(am);
    limbs[s < 0 ? 'legL' : 'legR'] = leg; limbs[s < 0 ? 'armL' : 'armR'] = arm;
  }
  g.scale.setScalar(scale);
  g.userData = { body, limbs, t: Math.random() * 10, sitting: false };
  return g;
}

/** Animate walk cycle / sitting / panic. */
export function animateCharacter(ch, dt, { moving = false, sitting = false, panic = false, dance = false, carrying = false } = {}) {
  const u = ch.userData; u.t += dt * (moving ? 9 : 3);
  const { legL, legR, armL, armR } = u.limbs;
  if (sitting) {
    u.body.position.y = -0.33; legL.rotation.x = legR.rotation.x = -1.45;
    armL.rotation.x = armR.rotation.x = panic ? -2.6 + Math.sin(u.t * 3) * 0.4 : -0.5;
  } else {
    u.body.position.y = dance ? Math.abs(Math.sin(u.t)) * 0.12 : 0;
    const sw = moving ? Math.sin(u.t) * 0.6 : 0;
    legL.rotation.x = sw; legR.rotation.x = -sw;
    if (carrying) { armL.rotation.x = armR.rotation.x = -1.3; }
    else if (dance) { armL.rotation.x = -2.8 + Math.sin(u.t * 2) * 0.5; armR.rotation.x = -2.8 - Math.sin(u.t * 2) * 0.5; }
    else if (panic) { armL.rotation.x = armR.rotation.x = -2.7 + Math.sin(u.t * 4) * 0.5; }
    else { armL.rotation.x = -sw * 0.8; armR.rotation.x = sw * 0.8; }
  }
  if (dance) ch.rotation.y += dt * 3;
}

export function randomPassengerLook() {
  const shirts = [0xe74c3c, 0x27ae60, 0xf39c12, 0x8e44ad, 0x16a085, 0xd35400, 0x2c3e50, 0xc0392b, 0x7f8c8d, 0xe84393];
  return { shirt: shirts[Math.floor(Math.random() * shirts.length)], pants: [0x2d3436, 0x34495e, 0x6c5ce7, 0x636e72][Math.floor(Math.random() * 4)], skin: SKIN[Math.floor(Math.random() * SKIN.length)], hat: Math.random() < 0.3 ? [0xfdcb6e, 0x0984e3, 0xd63031][Math.floor(Math.random() * 3)] : null, scale: 0.9 + Math.random() * 0.18 };
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
