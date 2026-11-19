// Sky Crew crew and passengers: original procedural people with a jelly wobble.
// One skinned mesh (vertex colours, one draw call) on a 19-bone skeleton. Keyframe clips still
// choose the action (walk, sit, carry, cheer...) and a cheap local ragdoll layer — springs, not a
// cannon body per bone — makes the body wobble, the arms flop, and a hard bump fold them onto
// the floor until they get back up. Every client runs that layer from motion it already has,
// so the network only needs a knockdown timer, not a bone stream.
// Proportions: a round head on a short neck, a soft torso with shoulders that taper to the hips,
// and longer floppy arms and legs. Cartoon, chunky, and drawn only for this game.
import * as THREE from '../../vendor/three.module.js';
import { mergeGeometries } from '../../vendor/addons/BufferGeometryUtils.js';

export const RANK_COLORS = { DEVELOPER: '#f5c542', ADMIN: '#4a8cff', TRUSTED: '#3ddc84', PLAYER: '#f2f4fa' };
export const SKIN = [0xffd9b8, 0xf1c27d, 0xe0ac69, 0xc68642, 0x9c6136, 0x70432a, 0xffe3cf];
const HAIRC = [0x2b1b12, 0x5a3a22, 0x8a5a2b, 0xe0b45e, 0x151515, 0xc2502e, 0xb8b8b8, 0xf2efe6, 0x6a3fb5, 0x2aa7c9];
const SHIRTS = [0xff5a5f, 0x2ec4b6, 0xffbe0b, 0x8338ec, 0x3a86ff, 0xfb5607, 0xff006e, 0x06d6a0, 0xf15bb5, 0x9bde7e, 0xffd166, 0x118ab2, 0xef476f, 0x7b2cbf];
const PANTS = [0x2b2d42, 0x3d5a80, 0x6c584c, 0x264653, 0x5e548e, 0x8d99ae, 0x1d3557, 0xa3623a];

// ---------------------------------------------------------------- skeleton
const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'shoulder.L', 'arm.L', 'forearm.L', 'hand.L', 'shoulder.R', 'arm.R', 'forearm.R', 'hand.R', 'thigh.L', 'shin.L', 'foot.L', 'thigh.R', 'shin.R', 'foot.R'];
const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));
const PARENT = { spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', 'shoulder.L': 'chest', 'arm.L': 'shoulder.L', 'forearm.L': 'arm.L', 'hand.L': 'forearm.L', 'shoulder.R': 'chest', 'arm.R': 'shoulder.R', 'forearm.R': 'arm.R', 'hand.R': 'forearm.R', 'thigh.L': 'hips', 'shin.L': 'thigh.L', 'foot.L': 'shin.L', 'thigh.R': 'hips', 'shin.R': 'thigh.R', 'foot.R': 'shin.R' };

/** Body measurements (metres) from a look. Front of the character is -z (same as the aircraft nose).
 *  A round head on a short neck, shoulders wider than the hips, legs long enough to reach the floor when seated. */
function dims(look) {
  const s = look.height ?? 1, g = look.girth ?? 1;
  const leg = 0.62 * s * (look.legs ?? 1), torso = 0.40 * s, headR = (look.headSize ?? 1) * 0.20;
  const neck = 0.09 * s;
  const belly = 0.20 * g, chest = 0.235 * (0.82 + 0.18 * g) * (look.shoulders ?? 1);
  const footH = 0.05, hipY = footH + leg;
  const thigh = leg * 0.44, shin = leg * 0.56;
  const top = hipY + torso + neck + headR * 1.95;
  return { s, g, leg, torso, headR, neck, belly, chest, footH, hipY, thigh, shin, arm: 0.23 * s, fore: 0.21 * s, limbR: 0.052 * (0.84 + 0.2 * g), legR: 0.068 * (0.8 + 0.22 * g), hipW: Math.max(0.08, belly * 0.55), top };
}
/** Rest-pose joint positions in character space. */
function joints(d) {
  const J = {};
  J.hips = [0, d.hipY, 0];
  J.spine = [0, d.hipY + d.torso * 0.36, 0];
  J.chest = [0, d.hipY + d.torso * 0.7, 0];
  J.neck = [0, d.hipY + d.torso, 0];
  J.head = [0, d.hipY + d.torso + d.neck, 0];
  const shY = d.hipY + d.torso * 0.9;
  for (const [k, sx] of [['L', 1], ['R', -1]]) {
    const ax = d.chest * 0.88;
    J[`shoulder.${k}`] = [sx * ax, shY, 0];
    J[`arm.${k}`] = [sx * ax, shY - 0.015, 0];
    J[`forearm.${k}`] = [sx * ax, shY - 0.015 - d.arm, 0];
    J[`hand.${k}`] = [sx * ax, shY - 0.015 - d.arm - d.fore, 0];
    J[`thigh.${k}`] = [sx * d.hipW, d.hipY - 0.02, 0];
    J[`shin.${k}`] = [sx * d.hipW, d.hipY - d.thigh, 0];
    J[`foot.${k}`] = [sx * d.hipW, d.footH + 0.02, 0];
  }
  return J;
}
/** Lathe profile: narrow hips, a soft belly, then a shoulder shelf that closes into the neck. */
function torsoProfile(d) {
  const y0 = d.hipY - 0.03, y1 = Jneck(d);
  const span = y1 - y0;
  const neckR = Math.max(0.045, d.headR * 0.46);
  const hip = Math.max(d.belly * 0.82, d.chest * 0.72);
  const belly = Math.max(d.belly, hip * 0.92);
  const waist = belly * 0.9;
  const chest = Math.max(d.chest * 0.96, waist);
  const shoulder = Math.max(d.chest, chest);
  const samples = [[0.045, 0], [hip * 0.78, 0.08], [hip, 0.18], [belly, 0.36], [waist, 0.52], [chest, 0.7], [shoulder, 0.86], [shoulder * 0.98, 0.93], [neckR * 1.45, 0.975], [neckR, 1]];
  return samples.map(([r, t]) => new THREE.Vector2(Math.max(0.02, r), y0 + t * span));
}
const Jneck = (d) => d.hipY + d.torso;

// ---------------------------------------------------------------- geometry helpers
const _c = new THREE.Color();
/** Prepare a part: move into place, paint it, skin it to bones. */
function part(geo, color, bone, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], paint = null, weights = null } = {}) {
  const g = geo.index ? geo : geo; // keep indexed
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
  g.applyMatrix4(m);
  const n = g.attributes.position.count, P = g.attributes.position;
  const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    _c.set(paint ? paint(x, y, z, color) : color);
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    const w = weights ? weights(x, y, z) : [[BI[bone], 1]];
    for (let k = 0; k < Math.min(4, w.length); k++) { si[i * 4 + k] = w[k][0]; sw[i * 4 + k] = w[k][1]; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
  return g;
}
const sphere = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
const capsule = (r, len, cap = 4, rad = 10) => new THREE.CapsuleGeometry(r, len, cap, rad);
const smooth = (t) => t * t * (3 - 2 * t);
/** Blend weights between two bones along y (for soft joints). */
const blendY = (a, b, y0, y1) => (x, y) => { const t = smooth(Math.max(0, Math.min(1, (y - y0) / (y1 - y0)))); return t <= 0 ? [[BI[a], 1]] : t >= 1 ? [[BI[b], 1]] : [[BI[a], 1 - t], [BI[b], t]]; };

// ---------------------------------------------------------------- face meshes (shared)
const FACE_MAT = {
  white: new THREE.MeshBasicMaterial({ color: 0xffffff }), dark: new THREE.MeshBasicMaterial({ color: 0x1b1420 }),
  mouth: new THREE.MeshBasicMaterial({ color: 0x5a1a22, side: THREE.DoubleSide }), tongue: new THREE.MeshBasicMaterial({ color: 0xff6b81 }),
  blush: new THREE.MeshBasicMaterial({ color: 0xff8fa3, transparent: true, opacity: 0.45, depthWrite: false }),
};
const FG = {
  eye: new THREE.SphereGeometry(1, 12, 8), pupil: new THREE.SphereGeometry(1, 10, 6),
  smile: new THREE.TorusGeometry(1, 0.22, 5, 12, Math.PI), oh: new THREE.CircleGeometry(1, 14), lid: new THREE.TorusGeometry(1, 0.25, 4, 10, Math.PI),
  brow: new THREE.CapsuleGeometry(0.22, 1, 2, 6), blush: new THREE.CircleGeometry(1, 10),
};
function buildFace(d, look) {
  const r = d.headR, face = new THREE.Group(); face.name = 'face';
  const zf = -r * 0.93, ex = r * 0.38, ey = r * 0.12, es = r * (look.eyeSize ?? 0.26);
  const open = new THREE.Group(), closed = new THREE.Group();
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(FG.eye, FACE_MAT.white); e.scale.set(es, es * 1.02, es * 0.42); e.position.set(s * ex, ey, zf + es * 0.12); open.add(e);
    const p = new THREE.Mesh(FG.pupil, FACE_MAT.dark); p.scale.set(es * 0.62, es * 0.62, es * 0.26); p.position.set(s * ex - s * es * 0.06, ey - es * 0.06, zf - es * 0.2); open.add(p);
    const h = new THREE.Mesh(FG.pupil, FACE_MAT.white); h.scale.setScalar(es * 0.16); h.position.set(s * ex + es * 0.12, ey + es * 0.18, zf - es * 0.48); open.add(h);
    const l = new THREE.Mesh(FG.lid, FACE_MAT.dark); l.scale.setScalar(es * 0.8); l.rotation.z = Math.PI; l.position.set(s * ex, ey, zf - 0.005); closed.add(l);
    const b = new THREE.Mesh(FG.blush, FACE_MAT.blush); b.scale.setScalar(r * 0.13); b.position.set(s * r * 0.58, -r * 0.12, -r * 0.8); b.rotation.y = s * 0.6 + Math.PI; face.add(b);
  }
  closed.visible = false;
  const brows = [];
  for (const s of [-1, 1]) { const b = new THREE.Mesh(FG.brow, FACE_MAT.dark); b.scale.set(r * 0.1, r * 0.17, r * 0.08); b.rotation.z = Math.PI / 2; b.position.set(s * ex, ey + es * 1.55, zf + 0.01); face.add(b); brows.push(b); }
  const mouthY = -r * 0.36, mz = -r * 0.86;
  const smile = new THREE.Mesh(FG.smile, FACE_MAT.mouth); smile.scale.set(r * 0.2, r * 0.16, r * 0.2); smile.rotation.z = Math.PI; smile.position.set(0, mouthY + r * 0.08, mz);
  const frown = new THREE.Mesh(FG.smile, FACE_MAT.mouth); frown.scale.set(r * 0.16, r * 0.1, r * 0.2); frown.position.set(0, mouthY - r * 0.04, mz);
  const oh = new THREE.Group(); { const m = new THREE.Mesh(FG.oh, FACE_MAT.mouth); m.rotation.y = Math.PI; oh.add(m); const t = new THREE.Mesh(FG.oh, FACE_MAT.tongue); t.scale.set(0.6, 0.35, 1); t.position.set(0, -0.45, -0.01); t.rotation.y = Math.PI; oh.add(t); }
  oh.scale.set(r * 0.16, r * 0.2, 1); oh.position.set(0, mouthY - r * 0.02, -r * 0.9);
  const grin = new THREE.Group(); { const m = new THREE.Mesh(new THREE.CircleGeometry(1, 14, Math.PI, Math.PI), FACE_MAT.mouth); m.rotation.y = Math.PI; grin.add(m); const t = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.3), FACE_MAT.white); t.position.set(0, -0.15, -0.01); t.rotation.y = Math.PI; grin.add(t); }
  grin.scale.set(r * 0.24, r * 0.2, 1); grin.position.set(0, mouthY + r * 0.06, -r * 0.88);
  face.add(open, closed, smile, frown, oh, grin);
  face.userData = { open, closed, brows, mouths: { smile, frown, oh, grin }, ey, es };
  for (const o of [smile, frown, oh, grin]) o.visible = false; smile.visible = true;
  face.traverse((o) => { o.castShadow = false; });
  return face;
}
const EXPR = {
  happy: { m: 'smile', brow: 0.08, eyes: true }, neutral: { m: 'smile', brow: 0, eyes: true, small: true },
  scared: { m: 'oh', brow: 0.35, eyes: true, lift: 1 }, angry: { m: 'frown', brow: -0.45, eyes: true, drop: 1 },
  joy: { m: 'grin', brow: 0.2, eyes: true }, sleep: { m: 'smile', brow: 0, eyes: false, small: true }, grumpy: { m: 'frown', brow: -0.2, eyes: true },
};
function setExpression(ch, kind) {
  const u = ch.userData; if (u.expr === kind) return; u.expr = kind;
  const f = u.face.userData, e = EXPR[kind] || EXPR.neutral;
  for (const [k, m] of Object.entries(f.mouths)) m.visible = k === e.m;
  f.mouths.smile.scale.x = u.dims.headR * (e.small ? 0.1 : 0.15);
  f.open.visible = e.eyes; f.closed.visible = !e.eyes;
  const pop = kind === 'scared' ? 1.35 : kind === 'angry' ? 0.85 : 1; // cartoon eye-pop when scared
  f.open.scale.set(pop, pop * (kind === 'joy' ? 0.8 : 1), 1);
  f.brows.forEach((b, i) => { const s = i ? 1 : -1; b.rotation.z = Math.PI / 2 + s * e.brow; b.position.y = f.ey + f.es * (1.55 + (e.lift ? 0.35 : 0) - (e.drop ? 0.2 : 0)); });
}

// ---------------------------------------------------------------- the character
const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02, envMapIntensity: 0.35 });
/**
 * look: { skin, shirt, shirt2, pattern: plain|stripes|dots|split, pants, skirt, dress, shoes, hair, hairColor, hat, hatColor,
 *         glasses: 0|1|2(sun), beard, moustache, height, girth, headSize, legs, shoulders, eyeSize, uniform: pilot|copilot|cabin|cargo|null, bag }
 */
export function makeCharacter(look = {}) {
  look = { skin: SKIN[1], shirt: 0x3a86ff, pants: 0x2b2d42, shoes: 0x2b2b33, hair: 'short', hairColor: HAIRC[0], ...look };
  const u = look.uniform;
  if (u === 'pilot' || u === 'copilot') {
    const stripes = look.stripes ?? (u === 'copilot' ? 3 : 4);
    Object.assign(look, { shirt: 0x14285e, shirt2: 0xffffff, pattern: 'jacket', pants: 0x14285e, shoes: 0x111111, tie: look.tie ?? 0xf5c542, stripes, sleeves: 'long', hat: look.hat === undefined ? 'pilot' : look.hat, hatColor: look.hatColor ?? 0x14285e });
  }
  if (u === 'cabin') {
    const vest = look.accent ?? 0x19b3a6;
    Object.assign(look, { shirt: vest, shirt2: 0xffffff, pattern: 'vest', pants: 0x14285e, scarf: look.scarf ?? 0xffc93c, hat: look.hat === undefined ? 'pillbox' : look.hat, hatColor: look.hatColor ?? vest });
  }
  if (u === 'cargo') Object.assign(look, { shirt: 0xff8a1a, shirt2: 0x263238, pattern: 'hivis', pants: 0x37474f, shoes: 0x4e342e, gloves: look.gloves ?? 0x37474f, hat: look.hat === undefined ? 'hardhat' : look.hat, hatColor: look.hatColor ?? 0xffd23f });
  const d = dims(look), J = joints(d);
  const parts = [];
  const skin = look.skin, shirt = look.shirt, pants = look.pants;
  const pantsTop = d.hipY + d.torso * 0.08;
  const yN = J.neck[1];
  // --- torso: shoulders widest, tapering to the hips. One low-segment lathe, still one draw call.
  const torsoW = (x, y) => (y < J.spine[1] ? blendY('hips', 'spine', J.hips[1] + 0.02, J.spine[1])(x, y) : blendY('spine', 'chest', J.spine[1], J.chest[1])(x, y));
  const paintTorso = (x, y, z) => {
    if (look.dress) return y < d.hipY + d.torso * 0.62 && Math.abs(Math.sin(y * 40)) > 0.97 ? look.shirt2 ?? 0xffffff : shirt;
    if (y < pantsTop) return pants;
    if (y < pantsTop + 0.025) return look.belt ?? 0x3b2a1e;
    const p = look.pattern;
    if (p === 'stripes') return Math.floor((y - pantsTop) / 0.055) % 2 ? look.shirt2 ?? 0xffffff : shirt;
    if (p === 'dots') return (Math.sin(x * 55) * Math.sin(y * 50) * Math.sin(z * 55)) > 0.35 ? look.shirt2 ?? 0xffffff : shirt;
    if (p === 'split') return y > d.hipY + d.torso * 0.5 ? look.shirt2 ?? 0xffffff : shirt;
    if (p === 'jacket') return z < -d.chest * 0.2 && Math.abs(x) < 0.018 + (yN - y) * 0.2 && y > d.hipY + d.torso * 0.38 ? look.shirt2 : shirt;
    if (p === 'vest') return z < -d.chest * 0.12 && Math.abs(x) < d.chest * 0.32 ? (look.shirt2 ?? 0xffffff) : shirt;
    if (p === 'hivis') return shirt;
    if (p === 'hoodie') return z < 0 && Math.abs(x) < d.chest * 0.42 && y > d.hipY + d.torso * 0.16 && y < d.hipY + d.torso * 0.46 ? shade(shirt, 0.8) : shirt;
    if (p === 'explorer') {
      if (Math.abs(y - (d.hipY + d.torso * 0.18)) < 0.016) return 0x5d4037;
      if (z < 0 && Math.abs(x) < 0.012) return 0x8d6e3f;
      return shirt;
    }
    if (p === 'overalls') {
      if (z < 0 && Math.abs(x) < 0.045 && Math.abs(y - (d.hipY + d.torso * 0.42)) < 0.035) return shade(shirt, 0.72);
      if (z < 0 && Math.abs(x) < d.chest * 0.5 && y > d.hipY + d.torso * 0.3) return shade(shirt, 1.12);
      return y < d.hipY + d.torso * 0.3 ? shirt : 0xc5ced6;
    }
    if (p === 'astronaut') return Math.abs(y - (d.hipY + d.torso * 0.55)) < 0.014 ? (look.accent ?? 0x1e6bff) : shirt;
    if (p === 'dino') {
      const by = d.hipY + d.torso * 0.42;
      if (z < 0 && (x / (d.chest * 0.65)) ** 2 + ((y - by) / (d.torso * 0.26)) ** 2 < 1) return shade(shirt, 1.35);
      return shirt;
    }
    return shirt;
  };
  parts.push(part(new THREE.LatheGeometry(torsoProfile(d), 12), shirt, 'chest', { paint: paintTorso, weights: torsoW, scale: [1, 1, 0.86] }));
  if (look.skirt || look.dress) {
    const sk = new THREE.CylinderGeometry(d.belly * 0.9, d.belly * 1.35, d.thigh * 0.85, 12, 1, true);
    parts.push(part(sk, look.dress ? shirt : look.skirtColor ?? pants, 'hips', { pos: [0, d.hipY - d.thigh * 0.35, 0], scale: [1, 1, 0.88] }));
  }
  if (look.scarf) {
    parts.push(part(new THREE.TorusGeometry(Math.max(0.06, d.headR * 0.78), 0.016, 5, 12), look.scarf, 'neck', { pos: [0, J.neck[1] + 0.02, 0], rot: [Math.PI / 2, 0, 0.35] }));
    parts.push(part(new THREE.BoxGeometry(0.04, 0.16, 0.012), look.scarf, 'chest', { pos: [0.03, J.neck[1] - 0.1, -d.chest * 0.78], rot: [0.15, 0, 0.2] }));
  }
  if (look.tie) {
    parts.push(part(new THREE.BoxGeometry(0.028, 0.03, 0.018), shade(look.tie, 0.75), 'chest', { pos: [0, J.neck[1] - 0.03, -d.chest * 0.72] }));
    parts.push(part(new THREE.ConeGeometry(0.032, 0.2, 4), look.tie, 'chest', { pos: [0, J.neck[1] - 0.14, -d.chest * 0.78], rot: [Math.PI, 0, 0] }));
  }
  if (look.pattern === 'hivis' || u === 'cargo') {
    for (const t of [0.42, 0.66]) parts.push(part(new THREE.TorusGeometry(Math.max(0.08, d.chest * 0.9), 0.01, 4, 14), 0xf4f7fb, 'chest', { pos: [0, d.hipY + d.torso * t, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.86, 1] }));
  }
  if (look.stripes) {
    const n = look.stripes;
    for (const [k, sx] of [['L', 1], ['R', -1]]) {
      const sh = J[`shoulder.${k}`];
      const y = sh[1] + d.limbR * 1.45;
      parts.push(part(new THREE.BoxGeometry(0.11, 0.012, 0.046), 0x0c1838, `shoulder.${k}`, { pos: [sh[0], y, -0.025] }));
      for (let i = 0; i < n; i++) {
        const x = sh[0] + sx * ((i - (n - 1) / 2) * 0.02);
        const gold = !(u === 'copilot' && i === n - 1);
        parts.push(part(new THREE.BoxGeometry(0.014, 0.01, 0.042), gold ? 0xf5c542 : 0xe7eef8, `shoulder.${k}`, { pos: [x, y + 0.01, -0.028] }));
      }
    }
  }
  if (look.pattern === 'hoodie') {
    parts.push(part(new THREE.TorusGeometry(d.headR * 0.85, 0.028, 5, 12), shade(shirt, 0.85), 'neck', { pos: [0, J.neck[1] + 0.02, 0.02], rot: [Math.PI / 2 - 0.3, 0, 0] }));
    for (const sx of [-1, 1]) parts.push(part(capsule(0.006, 0.08, 2, 4), 0xffffff, 'chest', { pos: [sx * 0.03, J.neck[1] - 0.08, -d.chest * 0.8] }));
  }
  if (look.pattern === 'explorer') {
    for (const sx of [-1, 1]) parts.push(part(new THREE.BoxGeometry(0.06, 0.05, 0.02), 0xa9844c, 'chest', { pos: [sx * d.chest * 0.45, d.hipY + d.torso * 0.62, -d.chest * 0.72] }));
  }
  if (look.pattern === 'dino') {
    for (let i = 0; i < 5; i++) {
      const y = d.hipY + 0.06 + i * (d.torso / 5);
      parts.push(part(new THREE.ConeGeometry(0.035, 0.09, 5), shade(shirt, 1.25), i > 3 ? 'neck' : 'chest', { pos: [0, y, d.chest * 0.72], rot: [Math.PI / 2 - 0.4, 0, 0] }));
    }
    parts.push(part(new THREE.ConeGeometry(0.07, 0.32, 7), shirt, 'hips', { pos: [0, d.hipY - 0.02, d.belly + 0.12], rot: [Math.PI / 2 + 0.4, 0, 0] }));
  }
  if (look.pattern === 'astronaut') {
    parts.push(part(new THREE.BoxGeometry(0.16, 0.18, 0.06), 0xb0b7c3, 'chest', { pos: [0, J.chest[1], -d.chest * 0.78] }));
    parts.push(part(new THREE.TorusGeometry(d.headR * 0.7, 0.02, 5, 12), 0x9aa3ad, 'neck', { pos: [0, J.neck[1], 0], rot: [Math.PI / 2, 0, 0] }));
  }
  // --- head: round, a little large, sitting on a short neck. The face is parented to the head bone.
  const hc = [0, J.head[1] + d.headR * 0.92, 0];
  const headW = blendY('neck', 'head', J.neck[1], J.head[1]);
  parts.push(part(sphere(d.headR, 14, 10), skin, 'head', { pos: hc, scale: [1.04, 1, 1.02] }));
  parts.push(part(new THREE.CylinderGeometry(d.headR * 0.4, d.headR * 0.48, d.neck * 0.92, 8), skin, 'neck', { pos: [0, (J.neck[1] + J.head[1]) / 2, 0], weights: headW }));
  parts.push(part(new THREE.CylinderGeometry(d.headR * 0.58, d.chest * 0.42, 0.028, 10), shirt, 'neck', { pos: [0, J.neck[1] + 0.012, 0] }));
  for (const s of [-1, 1]) parts.push(part(sphere(d.headR * 0.18, 7, 5), skin, 'head', { pos: [s * d.headR * 1.02, hc[1] - d.headR * 0.08, 0], scale: [0.55, 1, 0.75] }));
  const noseKind = look.nose ?? 'round';
  if (noseKind === 'round') parts.push(part(sphere(d.headR * 0.13, 8, 6), _c.set(skin).multiplyScalar(0.92).getHex(), 'head', { pos: [0, hc[1] - d.headR * 0.1, hc[2] - d.headR * 0.98] }));
  else parts.push(part(new THREE.ConeGeometry(d.headR * 0.1, d.headR * 0.32, 6), skin, 'head', { pos: [0, hc[1] - d.headR * 0.08, hc[2] - d.headR * 1.08], rot: [-Math.PI / 2, 0, 0] }));
  // --- hair styles
  const hr = d.headR, hcol = look.hairColor;
  const cap = (k = 0.56, sc = [1.08, 1.06, 1.08], dy = 0.02) => part(new THREE.SphereGeometry(hr, 14, 8, 0, Math.PI * 2, 0, Math.PI * k), hcol, 'head', { pos: [0, hc[1] + dy, hc[2] + 0.01], scale: sc });
  const hat = look.hat;
  const hairUnderHat = hat && !['pilot', 'pillbox'].includes(hat) ? null : look.hair;
  switch (hat ? (['pilot', 'pillbox'].includes(hat) ? look.hair : 'none') : look.hair) {
    case 'bald': break;
    case 'none': break;
    case 'long': parts.push(cap(0.6)); parts.push(part(capsule(hr * 0.7, hr * 0.7, 4, 12), hcol, 'head', { pos: [0, hc[1] - hr * 0.35, hr * 0.45], scale: [1.3, 1, 0.6] })); break;
    case 'bun': parts.push(cap(0.55)); parts.push(part(sphere(hr * 0.38, 12, 8), hcol, 'head', { pos: [0, hc[1] + hr * 0.95, hr * 0.35] })); break;
    case 'ponytail': parts.push(cap(0.56)); parts.push(part(capsule(hr * 0.18, hr * 0.8, 3, 8), hcol, 'head', { pos: [0, hc[1] - hr * 0.1, hr * 1.1], rot: [0.5, 0, 0] })); break;
    case 'afro': for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; parts.push(part(sphere(hr * 0.5, 10, 8), hcol, 'head', { pos: [Math.cos(a) * hr * 0.72, hc[1] + hr * 0.5 + Math.sin(i * 2.3) * hr * 0.12, hc[2] + Math.sin(a) * hr * 0.72 + hr * 0.1] })); } parts.push(part(sphere(hr * 0.75, 12, 8), hcol, 'head', { pos: [0, hc[1] + hr * 0.75, hr * 0.1] })); break;
    case 'spiky': parts.push(cap(0.5)); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; parts.push(part(new THREE.ConeGeometry(hr * 0.16, hr * 0.55, 5), hcol, 'head', { pos: [Math.cos(a) * hr * 0.55, hc[1] + hr * 0.8, hc[2] + Math.sin(a) * hr * 0.5], rot: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5] })); } break;
    case 'mohawk': parts.push(cap(0.45, [1.05, 1.03, 1.05], 0)); for (let i = 0; i < 6; i++) parts.push(part(new THREE.ConeGeometry(hr * 0.13, hr * 0.6, 4), look.hairColor2 ?? 0xff2fa0, 'head', { pos: [0, hc[1] + hr * 0.95 - Math.abs(i - 2.5) * 0.02, hc[2] - hr * 0.6 + i * hr * 0.25], rot: [-0.3 + i * 0.12, 0, 0] })); break;
    case 'bob': parts.push(cap(0.62, [1.12, 1.08, 1.12])); parts.push(part(new THREE.CylinderGeometry(hr * 1.12, hr * 1.18, hr * 0.7, 18, 1, true, Math.PI * 0.32, Math.PI * 1.36), hcol, 'head', { pos: [0, hc[1] - hr * 0.15, hc[2]] })); break;
    case 'curly': for (let i = 0; i < 14; i++) { const a = i * 2.39996, yy = 0.15 + (i % 3) * 0.28; parts.push(part(sphere(hr * 0.3, 8, 6), hcol, 'head', { pos: [Math.cos(a) * hr * 0.85 * Math.sqrt(1 - yy * yy), hc[1] + hr * yy + hr * 0.2, hc[2] + Math.sin(a) * hr * 0.85 * Math.sqrt(1 - yy * yy) + 0.03] })); } break;
    default: parts.push(cap(0.56)); parts.push(part(sphere(hr * 0.35, 10, 6), hcol, 'head', { pos: [hr * 0.35, hc[1] + hr * 0.72, hc[2] - hr * 0.55], scale: [1.4, 0.5, 0.8] })); // side-swept fringe
  }
  void hairUnderHat;
  if (look.beard) parts.push(part(new THREE.SphereGeometry(hr * 0.75, 14, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.45), hcol, 'head', { pos: [0, hc[1] - hr * 0.05, hc[2] - hr * 0.3], scale: [1.1, 1.1, 0.9] }));
  if (look.moustache) for (const s of [-1, 1]) parts.push(part(capsule(hr * 0.07, hr * 0.22, 2, 6), hcol, 'head', { pos: [s * hr * 0.15, hc[1] - hr * 0.25, hc[2] - hr * 0.95], rot: [0, 0, s * 1.2] }));
  // --- hats
  const hcolr = look.hatColor ?? 0xd63031;
  const top = hc[1] + hr * 0.62;
  if (hat === 'pilot') { parts.push(part(new THREE.CylinderGeometry(hr * 1.08, hr * 0.95, hr * 0.42, 18), hcolr, 'head', { pos: [0, top + hr * 0.1, 0.02] })); parts.push(part(new THREE.CylinderGeometry(hr * 0.75, hr * 0.75, hr * 0.04, 14, 1, false, Math.PI * 0.6, Math.PI * 0.8), 0x111111, 'head', { pos: [0, top - hr * 0.08, -hr * 0.3], rot: [0.25, 0, 0] })); parts.push(part(sphere(hr * 0.12, 8, 6), 0xf5c542, 'head', { pos: [0, top + hr * 0.12, -hr * 1.02], scale: [1, 1, 0.4] })); parts.push(part(new THREE.TorusGeometry(hr * 0.98, hr * 0.035, 4, 18), 0xf5c542, 'head', { pos: [0, top - hr * 0.04, 0.02], rot: [Math.PI / 2, 0, 0] })); }
  if (hat === 'pillbox') { parts.push(part(new THREE.CylinderGeometry(hr * 0.78, hr * 0.86, hr * 0.22, 12), hcolr, 'head', { pos: [0, hc[1] + hr * 0.82, 0.02] })); parts.push(part(new THREE.TorusGeometry(hr * 0.8, hr * 0.035, 4, 12), 0xf5c542, 'head', { pos: [0, hc[1] + hr * 0.74, 0.02], rot: [Math.PI / 2, 0, 0] })); }
  if (hat === 'hardhat') { parts.push(part(new THREE.SphereGeometry(hr * 1.08, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hcolr, 'head', { pos: [0, hc[1] + hr * 0.15, 0] })); parts.push(part(new THREE.CylinderGeometry(hr * 1.25, hr * 1.25, hr * 0.05, 18), hcolr, 'head', { pos: [0, hc[1] + hr * 0.15, -hr * 0.1] })); parts.push(part(capsule(hr * 0.1, hr * 1.2, 2, 6), _c.set(hcolr).multiplyScalar(0.85).getHex(), 'head', { pos: [0, hc[1] + hr * 1.1, 0], rot: [Math.PI / 2, 0, 0] })); for (const s of [-1, 1]) parts.push(part(sphere(hr * 0.3, 10, 6), 0x263238, 'head', { pos: [s * hr * 1.02, hc[1], 0], scale: [0.5, 1, 1] })); }
  if (hat === 'cap') { parts.push(part(new THREE.SphereGeometry(hr * 1.06, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hcolr, 'head', { pos: [0, hc[1] + hr * 0.12, 0] })); parts.push(part(new THREE.CylinderGeometry(hr * 0.75, hr * 0.75, hr * 0.05, 14, 1, false, Math.PI * 0.6, Math.PI * 0.8), hcolr, 'head', { pos: [0, hc[1] + hr * 0.16, -hr * 0.55], rot: [0.15, 0, 0] })); }
  if (hat === 'beanie') { parts.push(part(new THREE.SphereGeometry(hr * 1.07, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hcolr, 'head', { pos: [0, hc[1] + hr * 0.1, 0], paint: (x, y) => (Math.floor(y * 30) % 2 ? hcolr : 0xffffff) })); parts.push(part(sphere(hr * 0.25, 8, 6), 0xffffff, 'head', { pos: [0, hc[1] + hr * 1.15, 0] })); }
  if (hat === 'tophat') { parts.push(part(new THREE.CylinderGeometry(hr * 0.7, hr * 0.7, hr * 1.1, 16), hcolr, 'head', { pos: [0, top + hr * 0.5, 0] })); parts.push(part(new THREE.CylinderGeometry(hr * 1.15, hr * 1.15, hr * 0.06, 18), hcolr, 'head', { pos: [0, top - hr * 0.02, 0] })); parts.push(part(new THREE.CylinderGeometry(hr * 0.71, hr * 0.71, hr * 0.15, 16), 0xd63031, 'head', { pos: [0, top + hr * 0.1, 0] })); }
  if (hat === 'sunhat') { parts.push(part(new THREE.CylinderGeometry(hr * 1.8, hr * 1.8, hr * 0.05, 22), hcolr, 'head', { pos: [0, top - hr * 0.1, 0] })); parts.push(part(new THREE.SphereGeometry(hr * 0.95, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hcolr, 'head', { pos: [0, top - hr * 0.12, 0] })); parts.push(part(new THREE.TorusGeometry(hr * 0.92, hr * 0.06, 4, 18), 0xff5a5f, 'head', { pos: [0, top - hr * 0.02, 0], rot: [Math.PI / 2, 0, 0] })); }
  if (hat === 'party') parts.push(part(new THREE.ConeGeometry(hr * 0.45, hr * 1.1, 12), hcolr, 'head', { pos: [hr * 0.15, top + hr * 0.5, 0], rot: [0, 0, -0.2], paint: (x, y) => (Math.floor(y * 25) % 2 ? hcolr : 0xffffff) }));
  if (hat === 'cowboy') { parts.push(part(new THREE.CylinderGeometry(hr * 1.6, hr * 1.6, hr * 0.06, 16), hcolr, 'head', { pos: [0, top - hr * 0.05, 0], scale: [1, 1, 0.8] })); parts.push(part(new THREE.CylinderGeometry(hr * 0.75, hr * 0.85, hr * 0.6, 12), hcolr, 'head', { pos: [0, top + hr * 0.25, 0] })); }
  if (hat === 'bucket') { parts.push(part(new THREE.CylinderGeometry(hr * 0.9, hr * 1.05, hr * 0.5, 12), hcolr, 'head', { pos: [0, hc[1] + hr * 0.35, 0] })); parts.push(part(new THREE.CylinderGeometry(hr * 1.55, hr * 1.55, hr * 0.04, 14), shade(hcolr, 0.85), 'head', { pos: [0, hc[1] + hr * 0.1, 0] })); }
  if (hat === 'headphones') { parts.push(part(new THREE.TorusGeometry(hr * 1.05, hr * 0.07, 5, 12, Math.PI), 0x2d3436, 'head', { pos: [0, hc[1] + hr * 0.02, 0], rot: [0, Math.PI / 2, 0] })); for (const s of [-1, 1]) parts.push(part(new THREE.CylinderGeometry(hr * 0.28, hr * 0.28, hr * 0.14, 8), hcolr, 'head', { pos: [s * hr * 1.02, hc[1], 0], rot: [0, 0, Math.PI / 2] })); }
  // --- glasses
  if (look.glasses) {
    const gc = look.glasses === 2 ? 0x111111 : 0x2d2d2d;
    for (const s of [-1, 1]) {
      parts.push(part(new THREE.TorusGeometry(hr * 0.17, hr * 0.03, 5, 14), gc, 'head', { pos: [s * hr * 0.38, hc[1] + hr * 0.12, hc[2] - hr * 0.99] }));
      if (look.glasses === 2) parts.push(part(new THREE.CircleGeometry(hr * 0.17, 12), 0x10131a, 'head', { pos: [s * hr * 0.38, hc[1] + hr * 0.12, hc[2] - hr * 1.0], rot: [0, Math.PI, 0] }));
    }
    parts.push(part(new THREE.BoxGeometry(hr * 0.22, hr * 0.03, hr * 0.03), gc, 'head', { pos: [0, hc[1] + hr * 0.15, hc[2] - hr * 1.0] }));
  }
  // --- arms (longer, still soft) with a palm, a thumb and three fingers; legs end in shoes
  const sleeveCol = look.sleeves === 'short' ? skin : shirt;
  const foreBase = look.pattern === 'hivis' || look.pattern === 'overalls' ? (look.shirt2 ?? 0x263238) : (u === 'pilot' || u === 'copilot' ? shirt : sleeveCol);
  const handC = look.gloves ?? (look.pattern === 'dino' ? shirt : look.pattern === 'astronaut' ? 0xffffff : skin);
  for (const [k, sx] of [['L', 1], ['R', -1]]) {
    const a = J[`arm.${k}`], f = J[`forearm.${k}`], h = J[`hand.${k}`];
    const sh = J[`shoulder.${k}`];
    const armSleeve = look.pattern === 'hivis' ? (look.shirt2 ?? 0x263238) : shirt;
    parts.push(part(sphere(d.limbR * 1.65, 8, 6), shirt, `shoulder.${k}`, { pos: sh, scale: [1.15, 0.85, 1.05] }));
    parts.push(part(capsule(d.limbR, Math.max(0.05, d.arm - d.limbR * 0.15), 2, 6), armSleeve, `arm.${k}`, { pos: [a[0], a[1] - d.arm / 2, a[2]] }));
    parts.push(part(capsule(d.limbR * 0.9, Math.max(0.05, d.fore - d.limbR * 0.1), 2, 6), foreBase, `forearm.${k}`, { pos: [f[0], f[1] - d.fore / 2, f[2]], paint: (x, y) => (u === 'pilot' || u === 'copilot') && y < f[1] - d.fore * 0.55 ? 0xf5c542 : foreBase }));
    const hrim = d.limbR * 1.15;
    parts.push(part(sphere(hrim, 7, 5), handC, `hand.${k}`, { pos: [h[0], h[1] - hrim * 0.55, h[2] - hrim * 0.15], scale: [1.2, 0.85, 0.7] }));
    parts.push(part(capsule(hrim * 0.32, hrim * 0.55, 2, 4), handC, `hand.${k}`, { pos: [h[0] - sx * hrim * 0.85, h[1] - hrim * 0.25, h[2] - hrim * 0.45], rot: [0.5, 0, sx * 0.9] }));
    for (let i = 0; i < 3; i++) parts.push(part(capsule(hrim * 0.22, hrim * 0.62, 2, 4), handC, `hand.${k}`, { pos: [h[0] + (i - 1) * hrim * 0.48, h[1] - hrim * 1.15, h[2] - hrim * 0.2] }));
    const t = J[`thigh.${k}`], shn = J[`shin.${k}`], ft = J[`foot.${k}`];
    const legCol = look.skirt || look.dress ? skin : pants;
    const thighCol = look.shorts ? pants : legCol;
    const shinCol = look.shorts || look.skirt || look.dress ? skin : pants;
    parts.push(part(capsule(d.legR, Math.max(0.05, d.thigh - d.legR * 0.15), 2, 7), thighCol, `thigh.${k}`, { pos: [t[0], t[1] - d.thigh / 2, t[2]] }));
    parts.push(part(capsule(d.legR * 0.86, Math.max(0.05, d.shin - d.legR * 0.1), 2, 7), shinCol, `shin.${k}`, { pos: [shn[0], shn[1] - d.shin / 2, shn[2]] }));
    const shoe = look.shoes;
    parts.push(part(new THREE.BoxGeometry(d.legR * 1.55, 0.028, d.legR * 2.6), shade(shoe, 0.72), `foot.${k}`, { pos: [ft[0], ft[1] - 0.012, ft[2] - d.legR * 0.45] }));
    parts.push(part(new THREE.BoxGeometry(d.legR * 1.35, 0.05, d.legR * 1.55), shoe, `foot.${k}`, { pos: [ft[0], ft[1] + 0.02, ft[2] - d.legR * 0.2] }));
    parts.push(part(sphere(d.legR * 0.52, 7, 5), shoe, `foot.${k}`, { pos: [ft[0], ft[1] + 0.028, ft[2] - d.legR * 1.2], scale: [1.15, 0.62, 1.2] }));
  }
  if (look.backpack) parts.push(part(new THREE.CapsuleGeometry(d.chest * 0.6, d.torso * 0.25, 3, 10), look.backpack, 'chest', { pos: [0, J.chest[1], d.chest * 0.95], scale: [1, 1, 0.55] }));
  const geo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  geo.computeBoundingSphere();
  // --- bones
  const bones = BONES.map((n) => { const b = new THREE.Bone(); b.name = n; return b; });
  for (const n of BONES) {
    const b = bones[BI[n]], p = PARENT[n];
    const wp = J[n], pp = p ? J[p] : [0, 0, 0];
    b.position.set(wp[0] - pp[0], wp[1] - pp[1], wp[2] - pp[2]);
    if (p) bones[BI[p]].add(b);
  }
  const mesh = new THREE.SkinnedMesh(geo, MAT);
  mesh.castShadow = true; mesh.frustumCulled = false; // skinned bounds move with the animation
  const g = new THREE.Group();
  g.add(bones[0]); g.add(mesh);
  g.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  const face = buildFace(d, look); face.position.set(hc[0] - J.head[0], hc[1] - J.head[1], hc[2] - J.head[2]); bones[BI.head].add(face);
  if (look.pattern === 'astronaut') {
    const hel = new THREE.Mesh(new THREE.SphereGeometry(d.headR * 1.28, 14, 10), HELMET);
    hel.position.set(hc[0] - J.head[0], hc[1] - J.head[1], 0);
    hel.renderOrder = 2; bones[BI.head].add(hel);
  }
  const mixer = new THREE.AnimationMixer(g);
  g.userData = { mesh, bones, boneByName: Object.fromEntries(bones.map((b) => [b.name, b])), face, dims: d, mixer, clips: clipsFor(d), actions: {}, current: null, expr: null, t: Math.random() * 10, look, oneShot: null, wob: { k: look.wobble ?? 1.15 }, rag: { phase: '', k: 0 } };
  setExpression(g, 'neutral');
  play(g, 'idle', 0);
  return g;
}

// ---------------------------------------------------------------- authored animation clips
// Each clip is sampled from a pose function f(t) -> { bone: [rx, ry, rz], hipsPos: [x, y, z] } so it can be authored in code.
const clipCache = new Map();
function clipsFor(d) {
  const key = `${d.hipY.toFixed(2)}|${d.thigh.toFixed(2)}`;
  if (!clipCache.has(key)) clipCache.set(key, buildClips(d));
  return clipCache.get(key);
}
function sampleClip(name, dur, fps, fn, rest) {
  const n = Math.max(2, Math.round(dur * fps) + 1);
  const times = [], tracks = new Map();
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * dur; times.push(t);
    const pose = fn(t, t / dur);
    for (const [bone, v] of Object.entries(pose)) {
      if (bone === 'hipsPos') { if (!tracks.has('hips.position')) tracks.set('hips.position', []); tracks.get('hips.position').push(rest[0] + v[0], rest[1] + v[1], rest[2] + v[2]); continue; }
      e.set(v[0] || 0, v[1] || 0, v[2] || 0, 'XYZ'); q.setFromEuler(e);
      const k = `${bone}.quaternion`; if (!tracks.has(k)) tracks.set(k, []); tracks.get(k).push(q.x, q.y, q.z, q.w);
    }
  }
  const out = [];
  for (const [k, vals] of tracks) out.push(k.endsWith('position') ? new THREE.VectorKeyframeTrack(k, times, vals) : new THREE.QuaternionKeyframeTrack(k, times, vals));
  return new THREE.AnimationClip(name, dur, out);
}
const ALL = ['hips', 'spine', 'chest', 'neck', 'head', 'arm.L', 'forearm.L', 'hand.L', 'arm.R', 'forearm.R', 'hand.R', 'thigh.L', 'shin.L', 'foot.L', 'thigh.R', 'shin.R', 'foot.R', 'shoulder.L', 'shoulder.R'];
/** Start every pose from rest so clips never leak rotations into each other. */
const base = () => Object.fromEntries(ALL.map((b) => [b, [0, 0, 0]]));
const S = Math.sin, C = Math.cos, PI = Math.PI, TAU = Math.PI * 2;
function buildClips(d) {
  const rest = [0, d.hipY, 0];
  const legDrop = d.hipY; // sitting lowers the hips by about this much minus the seat height
  const seatY = 0.47; // top of the seat cushion
  const sitDY = seatY + d.legR - d.hipY, sitDZ = 0.08;
  const arms = (p, l, r) => { p['arm.L'] = l; p['arm.R'] = r; };
  const walk = (ph, amp = 1, bounce = 0.035) => {
    const p = base(), s = S(ph * TAU);
    p['thigh.L'] = [s * 0.55 * amp, 0, 0]; p['thigh.R'] = [-s * 0.55 * amp, 0, 0];
    p['shin.L'] = [-Math.max(0, S(ph * TAU + 1.6)) * 0.9 * amp, 0, 0]; p['shin.R'] = [-Math.max(0, S(ph * TAU + 1.6 + PI)) * 0.9 * amp, 0, 0];
    p['foot.L'] = [Math.max(0, -s) * 0.3 * amp, 0, 0]; p['foot.R'] = [Math.max(0, s) * 0.3 * amp, 0, 0];
    arms(p, [-s * 0.6 * amp, 0, 0.12], [s * 0.6 * amp, 0, -0.12]);
    p['forearm.L'] = [0.3 + Math.max(0, -s) * 0.4 * amp, 0, 0]; p['forearm.R'] = [0.3 + Math.max(0, s) * 0.4 * amp, 0, 0];
    p.hips = [0, s * 0.12 * amp, S(ph * TAU) * 0.05];
    p.chest = [0.04 * amp, -s * 0.18 * amp, 0]; p.head = [0, s * 0.08, 0];
    p.hipsPos = [0, Math.abs(C(ph * TAU)) * bounce * amp - bounce * 0.3, 0];
    return p;
  };
  const sitPose = (t) => {
    const p = base();
    p['thigh.L'] = p['thigh.R'] = [PI / 2, 0, 0];
    p['shin.L'] = p['shin.R'] = [-PI / 2 + 0.1, 0, 0];
    p['thigh.L'][2] = 0.06; p['thigh.R'] = [PI / 2, 0, -0.06];
    arms(p, [0.55, 0, 0.18], [0.55, 0, -0.18]); p['forearm.L'] = p['forearm.R'] = [0.75, 0, 0];
    p.spine = [-0.05, 0, 0]; p.chest = [-0.04 + S(t * 1.8) * 0.015, 0, 0];
    p.head = [S(t * 0.7) * 0.05, S(t * 0.4) * 0.35, 0];
    p.hipsPos = [0, sitDY, sitDZ];
    return p;
  };
  const lerpPose = (a, b, k) => { const p = {}; for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) { const va = a[key] || [0, 0, 0], vb = b[key] || [0, 0, 0]; p[key] = [0, 1, 2].map((i) => va[i] + (vb[i] - va[i]) * k); } return p; };
  const idlePose = (t) => { const p = base(); p.chest = [S(t * 2.2) * 0.025, 0, 0]; p.head = [S(t * 0.9) * 0.05, S(t * 0.55) * 0.25, S(t * 0.7) * 0.04]; arms(p, [S(t * 2.2) * 0.04, 0, 0.1], [S(t * 2.2) * 0.04, 0, -0.1]); p['forearm.L'] = p['forearm.R'] = [0.2, 0, 0]; p.hipsPos = [0, S(t * 2.2) * 0.006, 0]; return p; };
  const clips = {};
  clips.idle = sampleClip('idle', 2 * PI / 0.55 / 2, 10, (t) => idlePose(t), rest);
  clips.walk = sampleClip('walk', 0.9, 24, (t, k) => walk(k, 1), rest);
  clips.run = sampleClip('run', 0.55, 30, (t, k) => { const p = walk(k, 1.45, 0.07); p.chest[0] = 0.22; p.spine = [0.12, 0, 0]; p['forearm.L'] = [1.3, 0, 0]; p['forearm.R'] = [1.3, 0, 0]; return p; }, rest);
  clips.sitDown = sampleClip('sitDown', 0.7, 24, (t, k) => lerpPose(idlePose(0), sitPose(0), smooth(k)), rest);
  clips.standUp = sampleClip('standUp', 0.6, 24, (t, k) => { const p = lerpPose(sitPose(0), idlePose(0), smooth(k)); p.spine = [0.35 * S(k * PI), 0, 0]; return p; }, rest);
  clips.sit = sampleClip('sit', 2 * PI / 0.2, 6, (t) => sitPose(t), rest);
  clips.sitSleep = sampleClip('sitSleep', 4, 8, (t, k) => { const p = sitPose(0); p.head = [0.45 + S(k * TAU) * 0.05, 0.25, 0.2]; p.chest = [0.08 + S(k * TAU) * 0.03, 0, 0]; arms(p, [0.5, 0, 0.1], [0.5, 0, -0.1]); return p; }, rest);
  clips.sitPanic = sampleClip('sitPanic', 0.5, 24, (t, k) => { const p = sitPose(0); const w = S(k * TAU * 2); arms(p, [-2.6 + w * 0.35, 0, 0.5 + w * 0.2], [-2.6 - w * 0.35, 0, -0.5 + w * 0.2]); p['forearm.L'] = p['forearm.R'] = [-0.3, 0, 0]; p.head = [-0.2, S(k * TAU * 2) * 0.4, 0]; p.chest = [-0.1, S(k * TAU) * 0.15, 0]; p['shin.L'][0] += S(k * TAU * 2) * 0.4; p['shin.R'][0] -= S(k * TAU * 2) * 0.4; return p; }, rest);
  clips.sitCheer = sampleClip('sitCheer', 0.8, 20, (t, k) => { const p = sitPose(0); const w = S(k * TAU); arms(p, [-2.8, 0, 0.3 + w * 0.3], [-2.8, 0, -0.3 - w * 0.3]); p.head = [-0.15, 0, w * 0.15]; p.hipsPos[1] += Math.abs(w) * 0.04; return p; }, rest);
  clips.sitAngry = sampleClip('sitAngry', 1.2, 16, (t, k) => { const p = sitPose(0); arms(p, [1.2, -0.9, 0.2], [1.2, 0.9, -0.2]); p['forearm.L'] = [1.6, 0, 0]; p['forearm.R'] = [1.6, 0, 0]; p.head = [0.1, S(k * TAU) * 0.35, 0]; return p; }, rest);
  clips.panic = sampleClip('panic', 0.45, 30, (t, k) => { const p = walk(k * 2, 1.2, 0.08); const w = S(k * TAU * 2); arms(p, [-2.7 + w * 0.4, 0, 0.6 + w * 0.25], [-2.7 - w * 0.4, 0, -0.6 + w * 0.25]); p['forearm.L'] = p['forearm.R'] = [-0.35, 0, 0]; p.head = [-0.25, S(k * TAU * 2) * 0.5, 0]; p.chest = [-0.12, 0, S(k * TAU) * 0.12]; return p; }, rest);
  clips.cheer = sampleClip('cheer', 0.7, 24, (t, k) => { const p = base(); const j = Math.max(0, S(k * TAU)); arms(p, [-2.9, 0, 0.35 + j * 0.3], [-2.9, 0, -0.35 - j * 0.3]); p['forearm.L'] = p['forearm.R'] = [-0.2, 0, 0]; p.hipsPos = [0, j * 0.22, 0]; p['thigh.L'] = p['thigh.R'] = [j * 0.5, 0, 0]; p['shin.L'] = p['shin.R'] = [-j * 0.9, 0, 0]; p.head = [-0.2, 0, 0]; return p; }, rest);
  clips.dance = sampleClip('dance', 1.0, 24, (t, k) => { const p = base(); const w = S(k * TAU), w2 = S(k * TAU * 2); p.hips = [0, w * 0.4, w2 * 0.12]; p.hipsPos = [w * 0.06, Math.abs(w2) * 0.06, 0]; arms(p, [-2.4 + w * 0.6, 0, 0.6], [1.0 - w * 0.6, 0, -0.9]); p['forearm.L'] = [0.6, 0, 0]; p['forearm.R'] = [1.2, 0, 0]; p.chest = [0, -w * 0.3, -w2 * 0.1]; p.head = [0, w * 0.3, w2 * 0.2]; p['thigh.L'] = [Math.max(0, w) * 0.7, 0, 0.1]; p['thigh.R'] = [Math.max(0, -w) * 0.7, 0, -0.1]; p['shin.L'] = [-Math.max(0, w) * 1.0, 0, 0]; p['shin.R'] = [-Math.max(0, -w) * 1.0, 0, 0]; return p; }, rest);
  clips.wave = sampleClip('wave', 0.8, 20, (t, k) => { const p = idlePose(t); p['arm.R'] = [-0.2, 0, -2.6]; p['forearm.R'] = [0, 0, -0.35 + S(k * TAU * 2) * 0.45]; p.head = [-0.05, -0.2, 0.1]; return p; }, rest);
  const carryArms = (p) => { arms(p, [1.35, 0, 0.2], [1.35, 0, -0.2]); p['forearm.L'] = p['forearm.R'] = [0.35, 0, 0]; p['hand.L'] = [0, 0, -0.3]; p['hand.R'] = [0, 0, 0.3]; p.chest[0] = -0.08; return p; };
  clips.carryIdle = sampleClip('carryIdle', 2, 8, (t) => carryArms(idlePose(t)), rest);
  clips.carryWalk = sampleClip('carryWalk', 0.9, 24, (t, k) => carryArms(walk(k, 0.85)), rest);
  clips.flail = sampleClip('flail', 0.4, 30, (t, k) => { const p = base(); const w = S(k * TAU), w2 = C(k * TAU * 2); arms(p, [-2.3 + w * 0.9, 0, 0.6 + w2 * 0.5], [-2.3 - w * 0.9, 0, -0.6 - w2 * 0.5]); p['forearm.L'] = [-0.5 + w2 * 0.4, 0, 0]; p['forearm.R'] = [-0.5 - w2 * 0.4, 0, 0]; p['thigh.L'] = [w * 0.9, 0, 0.2]; p['thigh.R'] = [-w * 0.9, 0, -0.2]; p['shin.L'] = [-0.6 - w2 * 0.4, 0, 0]; p['shin.R'] = [-0.6 + w2 * 0.4, 0, 0]; p.head = [-0.3, w * 0.5, 0]; return p; }, rest);
  clips.parachute = sampleClip('parachute', 1.6, 12, (t, k) => { const p = base(); const w = S(k * TAU); arms(p, [-2.9, 0, 0.55], [-2.9, 0, -0.55]); p['forearm.L'] = p['forearm.R'] = [-0.25, 0, 0]; p['thigh.L'] = [0.25 + w * 0.2, 0, 0.1]; p['thigh.R'] = [0.25 - w * 0.2, 0, -0.1]; p['shin.L'] = p['shin.R'] = [-0.4, 0, 0]; p.head = [-0.35, w * 0.2, 0]; return p; }, rest);
  clips.jump = sampleClip('jump', 0.5, 20, (t, k) => { const p = base(); arms(p, [-0.8, 0, 0.9], [-0.8, 0, -0.9]); p['thigh.L'] = [0.7, 0, 0]; p['thigh.R'] = [0.2, 0, 0]; p['shin.L'] = [-1.0, 0, 0]; p['shin.R'] = [-0.5, 0, 0]; return p; }, rest);
  clips.pilotSit = sampleClip('pilotSit', 3, 8, (t, k) => { const p = sitPose(t); arms(p, [1.15, 0.22, 0.4], [1.15, -0.22, -0.4]); p['forearm.L'] = p['forearm.R'] = [0.85, 0, 0]; p.head = [-0.06, S(k * TAU) * 0.08, 0]; return p; }, rest);
  void legDrop;
  return clips;
}
const ONE_SHOT = new Set(['sitDown', 'standUp']);
function play(ch, name, fade = 0.3) {
  const u = ch.userData;
  if (u.current === name) return;
  const clip = u.clips[name]; if (!clip) return;
  let a = u.actions[name];
  if (!a) { a = u.mixer.clipAction(clip); u.actions[name] = a; if (ONE_SHOT.has(name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } }
  a.reset().setEffectiveWeight(1).play();
  if (!ONE_SHOT.has(name)) a.time = Math.random() * clip.duration * 0.5; // desync crowds
  const prev = u.current && u.actions[u.current];
  if (prev && fade > 0) prev.crossFadeTo(a, fade, false); else if (prev) prev.stop();
  u.current = name;
  u.oneShot = ONE_SHOT.has(name) ? { name, left: clip.duration } : null;
}

/**
 * A hard nudge. `power` below 1 is a stumble (they keep their feet); 1 or more is only a hint —
 * the caller also sets `falling` on animateCharacter for a real knockdown, which is what other
 * clients see. Sitting and parachuting ignore it.
 */
export function pokeRagdoll(ch, power = 0.7) {
  const rag = ch.userData?.rag;
  if (!rag || ch.userData.sitting) return;
  if (rag.phase === 'down' || rag.phase === 'rise') return;
  rag.phase = 'stumble';
  rag.k = Math.min(1, Math.max(rag.k, power));
}

/**
 * Pick the animation and face for this frame and advance the mixer.
 * flags: moving, running, sitting, panic, dance, carrying, sleep, flail, cheer, angry, parachute, wave, pilot, falling
 */
export function animateCharacter(ch, dt, f = {}) {
  const u = ch.userData; if (!u?.mixer) return;
  u.t += dt;
  const rag = u.rag;
  if (rag && dt > 0) {
    if (f.sitting || f.parachute) { rag.phase = ''; rag.k = 0; }
    else if (f.falling) { rag.phase = 'down'; rag.k = Math.min(1, rag.k + dt * 3.8); }
    else if (rag.phase === 'down' || rag.phase === 'rise') {
      rag.phase = 'rise';
      rag.k = Math.max(0, rag.k - dt * 1.7);
      if (rag.k <= 0.001) { rag.phase = ''; rag.k = 0; }
    } else if (rag.phase === 'stumble') {
      rag.k = Math.max(0, rag.k - dt * 1.5);
      if (rag.k <= 0.001) { rag.phase = ''; rag.k = 0; }
    }
  }
  let want;
  if (f.parachute) want = 'parachute';
  else if (f.flail) want = 'flail';
  else if (f.sitting) want = f.pilot ? 'pilotSit' : f.panic ? 'sitPanic' : f.sleep ? 'sitSleep' : f.cheer || f.dance ? 'sitCheer' : f.angry ? 'sitAngry' : 'sit';
  else if (f.dance) want = 'dance';
  else if (f.cheer) want = 'cheer';
  else if (f.panic) want = f.moving ? 'run' : 'panic';
  else if (f.carrying) want = f.moving ? 'carryWalk' : 'carryIdle';
  else if (f.moving) want = f.running ? 'run' : 'walk';
  else if (f.jumping) want = 'jump';
  else if (f.wave) want = 'wave';
  else want = 'idle';
  const wasSit = u.sitting;
  const sitNow = want.startsWith('sit') || want === 'pilotSit';
  if (sitNow && wasSit === false && !f.instant) { u.after = want; want = 'sitDown'; }
  else if (!sitNow && wasSit && !f.instant && !f.flail && !f.parachute) { u.after = want; want = 'standUp'; }
  u.sitting = sitNow;
  if (!sitNow && (rag?.phase === 'down' || rag?.phase === 'rise')) want = 'idle';
  if (u.oneShot) { u.oneShot.left -= dt; if (u.oneShot.left > 0) { if (want !== 'sitDown' && want !== 'standUp') u.after = want; } else { const nxt = u.after || want; u.oneShot = null; play(ch, nxt, 0.2); } }
  if (!u.oneShot) play(ch, want, want === 'flail' || want === 'parachute' ? 0.12 : 0.3);
  // face
  const downFace = rag?.phase === 'down' || rag?.phase === 'rise';
  const expr = f.sleep ? 'sleep' : f.panic || f.flail || f.parachute || downFace ? 'scared' : f.cheer || f.dance ? 'joy' : f.angry ? 'angry' : f.grumpy ? 'grumpy' : f.happy ? 'happy' : 'neutral';
  setExpression(ch, expr);
  // blink
  const fu = u.face.userData;
  if (expr !== 'sleep') { const b = (u.t % 4.3) < 0.12; fu.open.visible = !b; fu.closed.visible = b; }
  u.mixer.update(dt * (f.speed ?? 1));
  jelly(ch, dt, f);
}

// ---------------------------------------------------------------- local active ragdoll
// Springs on top of the clip. No extra physics bodies: a handful of floats per character,
// driven by the motion every client already has (position + the falling flag).
const _wv = new THREE.Vector3();
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
function jelly(ch, dt, f) {
  const u = ch.userData; if (!u.wob || dt <= 0) return;
  const w = u.wob, p = ch.position, B = u.boneByName, rag = u.rag;
  if (!w.last) { w.last = p.clone(); w.v = new THREE.Vector3(); w.s = [0, 0]; w.sv = [0, 0]; w.step = Math.random() * 6; w.arm = [0, 0, 0, 0]; return; }
  _wv.copy(p).sub(w.last).divideScalar(Math.max(dt, 1 / 120));
  if (_wv.lengthSq() > 400) _wv.set(0, 0, 0); // teleports / seat snaps are not accelerations
  const ax = (_wv.x - w.v.x) / Math.max(dt, 1 / 120), az = (_wv.z - w.v.z) / Math.max(dt, 1 / 120);
  w.v.copy(_wv); w.last.copy(p);
  const ry = ch.rotation.y, c = Math.cos(ry), s = Math.sin(ry);
  const lx = ax * c - az * s, lz = ax * s + az * c; // acceleration in the character's frame (front = -z)
  const K = 38, C = 4.6, G = 0.011 * (w.k || 1);
  for (const [i, a] of [[0, lx], [1, lz]]) {
    const acc = -K * w.s[i] - C * w.sv[i] - clampN(a, -70, 70) * G;
    w.sv[i] += acc * dt; w.s[i] = clampN(w.s[i] + w.sv[i] * dt, -0.7, 0.7);
  }
  const moving = !!f.moving && !f.sitting;
  const spd = Math.hypot(w.v.x, w.v.z);
  w.step += dt * (moving ? (f.running ? 12.5 : 8.2) : 2.1);
  const step = Math.sin(w.step), step2 = Math.sin(w.step * 2);
  const amp = (moving ? (f.running ? 1.35 : 1) : 0.28) * (w.k || 1);
  const hold = !!(f.carrying || f.sitting || f.parachute); // hands stay on the bag / armrests
  const flop = hold ? 0.18 : 1;
  const downK = rag && (rag.phase === 'down' || rag.phase === 'rise') ? rag.k : 0;
  const stumble = rag?.phase === 'stumble' ? rag.k : 0;
  // footfalls feed the same spring so a steady walk still jiggles
  if (moving) { w.sv[1] += step2 * dt * 7 * amp; w.sv[0] += step * dt * 4 * amp; }
  const leanX = w.s[1], leanZ = w.s[0];
  const squash = (1 - downK) * clampN((moving ? Math.abs(step2) * 0.07 * amp : Math.sin(u.t * 2.4) * 0.025) + Math.max(0, -w.v.y) * 0.012, -0.04, 0.12);
  if (B.hips) {
    B.hips.scale.set(1 + squash, 1 - squash * 0.8, 1 + squash * 0.55);
    B.hips.position.y += (moving ? Math.abs(step2) * 0.03 * amp : Math.sin(u.t * 2.4) * 0.008) - (u.dims?.hipY || 0.3) * 0.72 * downK;
    B.hips.rotateZ(step * 0.1 * amp * (1 - downK) + leanZ * 0.4 + stumble * 0.28);
    B.hips.rotateX(leanX * 0.28 + stumble * 0.45 + downK * 1.15);
  }
  B.spine?.rotateX(leanX * 0.4 + stumble * 0.3 + downK * 0.35);
  B.spine?.rotateZ(leanZ * 0.5 + step * 0.05 * amp);
  B.chest?.rotateX(-leanX * 0.3 * (1 - downK));
  B.chest?.rotateZ(leanZ * 0.4 + Math.sin(u.t * 2.1) * 0.02 * (w.k || 1));
  B.head?.rotateX(-leanX * 1.15 + step2 * 0.05 * amp - downK * 0.45);
  B.head?.rotateZ(-leanZ * 0.95 + Math.sin(u.t * 1.7) * 0.03 * (w.k || 1));
  // arms lag the body: a slow follow toward a loose target, so they overshoot and dangle
  if (!w.arm) w.arm = [0, 0, 0, 0];
  const follow = Math.min(1, dt * (hold ? 16 : 5.5));
  const targets = [
    (moving ? step * 0.45 * amp : Math.sin(u.t * 1.6) * 0.08) * flop + leanX * 0.85 * flop,
    (moving ? -step * 0.45 * amp : Math.sin(u.t * 1.6 + 1) * 0.08) * flop + leanX * 0.85 * flop,
    (Math.max(0, leanZ) * 1.5 + Math.abs(step) * 0.3 * amp) * flop + downK * 1.15,
    (Math.min(0, leanZ) * 1.5 - Math.abs(step) * 0.3 * amp) * flop - downK * 1.25,
  ];
  for (let i = 0; i < 4; i++) w.arm[i] += (targets[i] - w.arm[i]) * follow;
  B['arm.L']?.rotateX(w.arm[0]); B['arm.R']?.rotateX(w.arm[1]);
  B['arm.L']?.rotateZ(w.arm[2]); B['arm.R']?.rotateZ(w.arm[3]);
  B['forearm.L']?.rotateX(clampN(Math.sin(u.t * 6.5) * 0.22 * flop + Math.max(0, -leanX) * 0.45 * flop + downK * 0.55, -0.2, 1.1));
  B['forearm.R']?.rotateX(clampN(Math.sin(u.t * 6.5 + 1.3) * 0.22 * flop + Math.max(0, -leanX) * 0.45 * flop + downK * 0.5, -0.2, 1.1));
  B['forearm.L']?.rotateZ(Math.sin(u.t * 5.2) * 0.16 * flop);
  B['forearm.R']?.rotateZ(-Math.sin(u.t * 5.2 + 0.7) * 0.16 * flop);
  if (!f.sitting) {
    B['shin.L']?.rotateX(-Math.max(0, step) * 0.4 * amp - downK * 0.3);
    B['shin.R']?.rotateX(-Math.max(0, -step) * 0.4 * amp - downK * 0.25);
    B['thigh.L']?.rotateZ(downK * 0.4);
    B['thigh.R']?.rotateZ(-downK * 0.45);
  }
}
/** Name of the clip currently playing (tests). */
export const currentClip = (ch) => ch.userData?.current || null;
export const CLIP_NAMES = ['idle', 'walk', 'run', 'sitDown', 'sit', 'standUp', 'sitSleep', 'sitPanic', 'sitCheer', 'sitAngry', 'panic', 'cheer', 'dance', 'wave', 'carryIdle', 'carryWalk', 'flail', 'parachute', 'jump', 'pilotSit'];

/** Passenger appearance from a seeded RNG, so every client builds identical people. */
export function randomPassengerLook(rnd = Math.random) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const fem = rnd() < 0.5;
  // same people as the crew, with their own shapes: round, lanky, pear-shaped, broad, short, elder
  const shape = pick(['ball', 'noodle', 'pear', 'brick', 'egg', 'tiny', 'average', 'elder', 'ball', 'pear']);
  const sh = { average: [1, 1.12, 1.05, 1], ball: [0.86, 1.5, 0.95, 1.05], noodle: [1.16, 0.78, 1.05, 0.72], pear: [0.96, 1.4, 1.05, 0.78], brick: [1.02, 1.25, 0.95, 1.35], egg: [0.9, 1.3, 1.1, 0.88], tiny: [0.72, 1.05, 1.15, 0.92], elder: [0.94, 1.22, 1.02, 0.95] }[shape];
  const hair = fem ? pick(['long', 'bun', 'ponytail', 'bob', 'curly', 'afro', 'short']) : pick(['short', 'short', 'spiky', 'bald', 'mohawk', 'curly', 'afro', 'bob']);
  const hats = ['cap', 'beanie', 'tophat', 'sunhat', 'cowboy', 'party'];
  const pattern = pick(['plain', 'plain', 'stripes', 'dots', 'split']);
  return {
    skin: pick(SKIN), shirt: pick(SHIRTS), shirt2: pick([0xffffff, 0xfff3b0, 0x1d3557, pick(SHIRTS)]), pattern, pants: pick(PANTS), shoes: pick([0x2b2b33, 0xffffff, 0xd62828, 0x6d4c41, 0x3a86ff]),
    hair, hairColor: shape === 'elder' ? pick([0xb8b8b8, 0xf2efe6]) : pick(HAIRC), hairColor2: pick([0xff2fa0, 0x2aa7c9, 0x9bde7e]),
    hat: rnd() < 0.3 ? pick(hats) : null, hatColor: pick([0xd63031, 0x0984e3, 0xfdcb6e, 0x2d3436, 0x6ab04c, 0xe84393, 0xf5f0e1]),
    skirt: fem && rnd() < 0.35, dress: fem && rnd() < 0.15, shorts: !fem && rnd() < 0.2, sleeves: rnd() < 0.45 ? 'short' : 'long',
    glasses: rnd() < 0.3 ? (rnd() < 0.4 ? 2 : 1) : 0, beard: !fem && rnd() < 0.18, moustache: !fem && rnd() < 0.15, tie: !fem && rnd() < 0.15 ? pick([0xd62828, 0x1d3557, 0xffbe0b]) : null,
    height: sh[0] * (0.95 + rnd() * 0.1), girth: sh[1] * (0.92 + rnd() * 0.14), headSize: sh[2] * (0.95 + rnd() * 0.1), shoulders: sh[3], legs: shape === 'tiny' || shape === 'ball' ? 0.8 : shape === 'noodle' ? 1.16 : 0.92,
    eyeSize: 0.28 + rnd() * 0.08, wobble: shape === 'ball' || shape === 'pear' ? 1.65 : 1.25, nose: rnd() < 0.7 ? 'round' : 'pointy', backpack: rnd() < 0.15 ? pick(SHIRTS) : null, shape,
  };
}

/** Billboard sprite with player name + rank badge. Colours come from the server-verified rank. */
export function nameTag(name, role, badge = '') {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  const color = RANK_COLORS[role] || RANK_COLORS.PLAYER;
  const label = role || 'PLAYER';
  g.font = 'bold 26px -apple-system, Segoe UI, sans-serif';
  const bw = g.measureText(label).width + 26;
  g.font = 'bold 44px -apple-system, Segoe UI, sans-serif';
  if (badge) name = `${badge} ${name}`; // class badge (from the server-checked class pick)
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
  s.scale.set(1.6, 0.4, 1); s.position.y = 1.95; s.renderOrder = 10;
  return s;
}

const ICONS = { water: '💧', snack: '🍪', blanket: '🛏️', complaint: '😤', panic: '😱', happy: '😊', sleep: '💤', party: '🎉', vip: '⭐', frozen: '🧊', drink: '🥤', meal: '🍱', lav: '🚻', sick: '🤢', cry: '😭', unruly: '😡', charm: '🔑' };
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
  const s = new THREE.Sprite(iconCache[kind]); s.scale.set(0.45, 0.45, 1); s.position.y = 1.5; s.renderOrder = 11;
  return s;
}

function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

// ================================================================ crew (players)
// Same people as the passengers, with the shop outfit or the co-op job uniform and a looser wobble.
// role (pilot | copilot | cabin | cargo) dresses the job; hat, colour and skin stay the player's.
export const OUTFIT_PALETTE = [0x2f6fde, 0xe8453c, 0x2bb673, 0xf6b93b, 0x8e5bd9, 0xff7eb6, 0x1fb5c9, 0xff8a1a, 0x3b3f4a, 0xf3f0e6];
export const CREW_SKINS = [0xffe0c4, 0xf1c27d, 0xe0ac69, 0xc68642, 0x9c6136, 0x70432a, 0xfff0e0];
export const OUTFIT_NAMES = { captain: 'Captain uniform', attendant: 'Flight attendant', mechanic: 'Mechanic overalls', hoodie: 'Comfy hoodie', explorer: 'Explorer jacket', dino: 'Dino costume', astronaut: 'Space suit' };
const HELMET = new THREE.MeshPhongMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.28, shininess: 120, specular: 0xffffff, depthWrite: false });
const shade = (c, k) => _c.set(c).multiplyScalar(k).getHex();

export function makeCrew(o = {}) {
  o = { outfit: 'captain', hat: 'captain', color: 0, skin: 1, role: null, ...o };
  const col = OUTFIT_PALETTE[o.color] ?? OUTFIT_PALETTE[0];
  const skin = CREW_SKINS[o.skin] ?? CREW_SKINS[1];
  const hat = o.hat === 'none' ? null : o.hat === 'captain' ? 'pilot' : o.hat;
  const base = {
    skin, hair: 'short', hairColor: 0x2b1b12, hat, hatColor: col, accent: col,
    shoulders: 1.18, height: 1.02, girth: 1.12, headSize: 1.08, legs: 1,
    eyeSize: 0.36, wobble: 1.85, nose: 'round',
  };
  const role = o.role;
  let look;
  if (role === 'pilot' || role === 'copilot') {
    look = { ...base, uniform: role, stripes: role === 'copilot' ? 3 : 4, tie: 0xf5c542, hatColor: 0x14285e, hat: o.hat === 'captain' || o.hat == null ? 'pilot' : hat };
  } else if (role === 'cabin') {
    look = { ...base, uniform: 'cabin', accent: col, scarf: 0xffc93c, hat: o.hat === 'captain' ? 'pillbox' : hat, hatColor: col };
  } else if (role === 'cargo') {
    look = { ...base, uniform: 'cargo', hat: o.hat === 'captain' || o.hat == null ? 'hardhat' : hat, hatColor: 0xffd23f };
  } else if (o.outfit === 'captain') {
    look = { ...base, uniform: 'pilot', stripes: 4, tie: 0xf5c542, hatColor: 0x14285e };
  } else if (o.outfit === 'attendant') {
    look = { ...base, uniform: 'cabin', accent: col, scarf: 0xffc93c, hat: hat === 'pilot' ? 'pillbox' : hat, hatColor: col };
  } else if (o.outfit === 'mechanic') {
    look = { ...base, shirt: col, pants: col, pattern: 'overalls', shoes: 0x4e342e, gloves: 0x37474f, sleeves: 'short', hat: hat === 'pilot' ? 'cap' : hat, hatColor: col };
  } else if (o.outfit === 'hoodie') {
    look = { ...base, shirt: col, pants: 0x3d5a80, pattern: 'hoodie', shoes: 0xffffff, sleeves: 'long' };
  } else if (o.outfit === 'explorer') {
    look = { ...base, shirt: 0xc8a165, pants: 0x6b5b3a, pattern: 'explorer', shoes: 0x5d4037, backpack: 0x8d6e3f, hat: hat === 'pilot' ? 'bucket' : hat, hatColor: 0xc8a165 };
  } else if (o.outfit === 'dino') {
    look = { ...base, shirt: col, pants: col, pattern: 'dino', shoes: shade(col, 0.7), hair: 'none', hat: null };
  } else if (o.outfit === 'astronaut') {
    look = { ...base, shirt: 0xf2f2f2, pants: 0xf2f2f2, pattern: 'astronaut', shoes: 0x9aa3ad, hair: 'none', hat: null, accent: col };
  } else look = { ...base, shirt: col, pants: 0x2b2d42 };
  const g = makeCharacter(look);
  g.userData.look = { crew: { outfit: o.outfit, hat: o.hat, color: o.color, skin: o.skin, role: role || null } };
  g.userData.crew = true;
  g.userData.wob.k = 1.85;
  return g;
}
