// Highcrag — the climbers: chunky cartoon explorers with big round heads (original design),
// jointed arms and legs, and a big wardrobe. Looks are small data objects shared over co-op:
// { s: head colour, f: face, hr: hair, hc: hair colour, h: hat, t: top, c: top colour, b: bottoms, bc: bottoms colour, sh: shoes, a: extra }
import * as THREE from '../../vendor/three.module.js';
import { RoundedBoxGeometry } from '../../vendor/addons/RoundedBoxGeometry.js';

export const COLORS = [0xe0453a, 0x2f5fb3, 0x4c9a45, 0xf08a2c, 0x23a3a3, 0xf2c33b, 0x8a55b8, 0x8c939a, 0xf2efe8, 0x2b2c33];
export const COLOR_NAMES = ['Red', 'Blue', 'Green', 'Orange', 'Teal', 'Yellow', 'Purple', 'Grey', 'White', 'Black'];
export const SKINS = [0xf6d6c0, 0xe8b997, 0xcf9a6e, 0xa8704a, 0x7d4f33, 0x55362a, 0xff9a62, 0x7fb7ff, 0x8fe0b0, 0xc4a8ff, 0xffe27a, 0xff9fb8];
export const FACES = ['Cheery', 'Focused', 'Sleepy', 'Wow'];
export const HAIRS = ['Bald', 'Short', 'Side swoop', 'Curly', 'Ponytail', 'Buns', 'Spiky', 'Long'];
export const HAIR_COLORS = [0x2b1d14, 0x5a3825, 0x8a5a32, 0xc98a4a, 0xe8c37a, 0xb8432e, 0xe8e4dc, 0x3a4fa8, 0xe07ab0, 0x3fa890];
export const HAIR_COLOR_NAMES = ['Black', 'Dark brown', 'Brown', 'Copper', 'Blond', 'Red', 'White', 'Blue', 'Pink', 'Teal'];
export const HATS = ['No hat', 'Beanie', 'Bobble hat', 'Bucket hat', 'Cap', 'Backwards cap', 'Cowboy hat', 'Top hat', 'Party hat', 'Crown', 'Climbing helmet', 'Chef hat', 'Propeller cap', 'Bandana', 'Viking helmet', 'Flower crown',
  // Unlocked by badges:
  'Laurel wreath', 'Gecko cap', 'Racing helmet', 'Golden helmet', 'Aviator cap'];
export const TOPS = ['T-shirt', 'Hoodie', 'Puffer jacket', 'Raincoat', 'Flannel shirt', 'Sweater', 'Vest', 'Tank top'];
export const BOTTOMS = ['Shorts', 'Trousers', 'Cargo pants', 'Overalls', 'Skirt'];
export const SHOES = ['Hiking boots', 'Sneakers', 'Wellies', 'Sandals'];
export const EXTRAS = ['Nothing', 'Glasses', 'Sunglasses', 'Ski goggles', 'Scarf', 'Moustache', 'Bow tie', 'Headphones', 'Ear flower'];
// Kept for older code: the top colour is the "outfit" colour shown in the room list.
export const OUTFITS = COLORS;
export const OUTFIT_NAMES = COLOR_NAMES;

/** Wardrobe sections, in display order. type 'color' renders swatches. */
export const WARDROBE = [
  { key: 's', label: 'Head colour', type: 'color', items: SKINS },
  { key: 'f', label: 'Face', items: FACES },
  { key: 'hr', label: 'Hair', items: HAIRS },
  { key: 'hc', label: 'Hair colour', type: 'color', items: HAIR_COLORS, names: HAIR_COLOR_NAMES },
  { key: 'h', label: 'Hat', items: HATS },
  { key: 't', label: 'Top', items: TOPS },
  { key: 'c', label: 'Top colour', type: 'color', items: COLORS, names: COLOR_NAMES },
  { key: 'b', label: 'Bottoms', items: BOTTOMS },
  { key: 'bc', label: 'Bottoms colour', type: 'color', items: COLORS, names: COLOR_NAMES },
  { key: 'sh', label: 'Shoes', items: SHOES },
  { key: 'a', label: 'Extras', items: EXTRAS },
];
export const DEFAULT_LOOK = { s: 1, f: 0, hr: 1, hc: 1, h: 1, t: 2, c: 0, b: 1, bc: 1, sh: 0, a: 0 };
export function validLook(l) {
  const out = {};
  for (const w of WARDROBE) {
    const v = l?.[w.key];
    out[w.key] = Number.isInteger(v) && v >= 0 && v < w.items.length ? v : DEFAULT_LOOK[w.key];
  }
  return out;
}
export function randomLook() {
  const out = {};
  for (const w of WARDROBE) out[w.key] = Math.floor(Math.random() * w.items.length);
  return out;
}

// ---------------- materials ----------------
let _knit = null, _plaid = {};
function knitTexture() {
  if (_knit) return _knit;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#e4e4e4'; x.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 64; i += 8) for (let j = 0; j < 64; j += 8) {
    x.fillStyle = '#c9c9c9';
    x.beginPath(); x.ellipse(i + 2, j + 4, 2.2, 3.8, 0.4, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.ellipse(i + 6, j + 4, 2.2, 3.8, -0.4, 0, Math.PI * 2); x.fill();
  }
  _knit = new THREE.CanvasTexture(c);
  _knit.wrapS = _knit.wrapT = THREE.RepeatWrapping;
  _knit.repeat.set(5, 3);
  _knit.colorSpace = THREE.SRGBColorSpace;
  return _knit;
}
function plaidTexture(hex) {
  if (_plaid[hex]) return _plaid[hex];
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const base = new THREE.Color(hex);
  x.fillStyle = `#${base.getHexString()}`; x.fillRect(0, 0, 64, 64);
  x.fillStyle = 'rgba(20,20,20,0.35)';
  x.fillRect(0, 10, 64, 10); x.fillRect(0, 42, 64, 6);
  x.fillRect(10, 0, 10, 64); x.fillRect(42, 0, 6, 64);
  x.fillStyle = 'rgba(255,255,255,0.25)';
  x.fillRect(0, 30, 64, 2); x.fillRect(30, 0, 2, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 2);
  t.colorSpace = THREE.SRGBColorSpace;
  return (_plaid[hex] = t);
}
/** Soft warm rim light so climbers stand out from the scenery (one shared shader variant). */
function rimLight(m) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
      {
        float rimF = 1.0 - max(dot(normalize(normal), normalize(vViewPosition)), 0.0);
        outgoingLight += vec3(1.0, 0.9, 0.78) * pow(rimF, 3.0) * 0.32 * (0.35 + 0.65 * diffuseColor.rgb);
      }
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'climber-rim';
  return m;
}
const mat = (color, rough = 0.75, extra = {}) => rimLight(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra }));

// ---------------- builders ----------------
const mesh = (geo, m, x = 0, y = 0, z = 0) => { const k = new THREE.Mesh(geo, m); k.position.set(x, y, z); return k; };
const capsule = (r, len, m) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), m);
const sphere = (r, m, ws = 18, hs = 14) => new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), m);
const HEAD_R = 0.27;

/** Smooth tapered limb: one continuous rounded surface whose radius narrows from rTop to rBot. */
function limbGeo(rTop, rBot, len, seg = 20) {
  const pts = [];
  for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.max(1e-4, rBot * Math.cos(a)), -len / 2 + rBot * Math.sin(a))); }
  for (let i = 1; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.max(1e-4, rTop * Math.cos(a)), len / 2 + rTop * Math.sin(a))); }
  return new THREE.LatheGeometry(pts, seg);
}
const limb = (rTop, rBot, len, m) => new THREE.Mesh(limbGeo(rTop, rBot, len), m);
/** The torso: one smooth bean shape from the hips up into the neck. */
const TORSO = [[0, -0.075], [0.1, -0.07], [0.17, -0.035], [0.205, 0.025], [0.218, 0.1], [0.218, 0.17], [0.207, 0.24], [0.182, 0.3], [0.142, 0.35], [0.098, 0.39], [0.074, 0.42], [0.067, 0.46], [0.04, 0.5], [0, 0.51]];
function torsoGeo(scale = 1, to = TORSO.length) {
  return new THREE.LatheGeometry(TORSO.slice(0, to).map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r * scale), y)), 30);
}
let _quilt = null;
function quiltTexture() {
  if (_quilt) return _quilt;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, '#bdbdbd'); g.addColorStop(0.15, '#ffffff'); g.addColorStop(0.85, '#f0f0f0'); g.addColorStop(1, '#9a9a9a');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  _quilt = new THREE.CanvasTexture(c);
  _quilt.wrapS = _quilt.wrapT = THREE.RepeatWrapping;
  _quilt.repeat.set(1, 6);
  _quilt.colorSpace = THREE.SRGBColorSpace;
  return _quilt;
}

function buildFace(head, f, skinHex, browHex) {
  const ink = mat(0x1d1b22, 0.3);
  const white = mat(0xffffff, 0.25);
  const sclera = mat(0xfbf8f2, 0.35);
  const iris = mat(0x3a2a20, 0.3);
  const cheek = mat(0xff7f8f, 0.8, { transparent: true, opacity: 0.5 });
  const brow = mat(browHex, 0.7);
  const lid = mat(new THREE.Color(skinHex).multiplyScalar(0.94), 0.6);
  const z = HEAD_R * 0.93;
  // Both eyes sit in one group centred on the eye line, so blinking squashes them in place.
  const eyes = new THREE.Group();
  eyes.position.y = 0.035;
  const big = f === 3 ? 1.15 : 1;
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(sx * 0.088, 0, z - 0.014);
    const w = sphere(0.05 * big, sclera, 16, 12);
    w.scale.set(0.8, 1, 0.34);
    const p = sphere(0.032 * big, iris, 14, 10);
    p.scale.set(0.9, 1, 0.36);
    p.position.set(-sx * 0.004, -0.006, 0.012);
    const pu = sphere(0.019 * big, ink, 12, 8);
    pu.scale.set(0.9, 1, 0.3);
    pu.position.set(-sx * 0.004, -0.008, 0.02);
    const gl = sphere(0.011 * big, white, 8, 6);
    gl.position.set(0.011, 0.012, 0.026);
    eye.add(w, p, pu, gl);
    if (f === 2) {
      // Sleepy: heavy upper lids.
      const l = sphere(0.053, lid, 14, 10);
      l.scale.set(0.84, 0.62, 0.38);
      l.position.set(0, 0.024, 0.004);
      eye.add(l);
    }
    eyes.add(eye);
    // Eyebrows, shaped by the face.
    const b = capsule(0.011, 0.05, brow);
    b.rotation.z = Math.PI / 2 + sx * ([-0.18, 0.38, 0.05, -0.3][f] ?? 0);
    b.scale.set(1, 1, 0.55);
    b.position.set(sx * 0.09, [0.112, 0.098, 0.092, 0.13][f] ?? 0.11, z - 0.004);
    head.add(b);
    const ck = sphere(0.045, cheek, 12, 8);
    ck.scale.set(1, 0.6, 0.3);
    ck.position.set(sx * 0.15, -0.045, z - 0.05);
    head.add(ck);
  }
  head.add(eyes);
  let mouth;
  if (f === 0) {
    // Open smile: a dark half-moon with a little tongue.
    mouth = new THREE.Group();
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.042, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat(0x4a1822, 0.5));
    m.scale.set(1, 0.7, 0.3);
    const tg = sphere(0.02, mat(0xe86a7a, 0.5), 10, 8);
    tg.scale.set(1.2, 0.6, 0.4);
    tg.position.set(0, -0.018, 0.004);
    mouth.add(m, tg);
    mouth.position.set(0, -0.058, z - 0.006);
  } else if (f === 1) { mouth = capsule(0.008, 0.045, ink); mouth.rotation.z = Math.PI / 2 + 0.08; mouth.scale.set(1, 1, 0.5); mouth.position.set(0, -0.07, z - 0.008); }
  else if (f === 2) { mouth = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.007, 6, 12, Math.PI), ink); mouth.rotation.z = Math.PI; mouth.position.set(0.01, -0.068, z - 0.006); }
  else { mouth = sphere(0.03, mat(0x4a1822, 0.5), 12, 8); mouth.scale.set(0.85, 1.1, 0.4); mouth.position.set(0, -0.078, z - 0.012); }
  head.add(mouth);
  // A little nose bump in the head colour.
  const nose = sphere(0.03, mat(new THREE.Color(skinHex).multiplyScalar(0.92), 0.6), 10, 8);
  nose.scale.set(1, 0.85, 1);
  nose.position.set(0, -0.012, z + 0.012);
  head.add(nose);
  return eyes;
}

/** Hats that cover the top of the head: only hair that would show below them is built. */
const COVERING_HATS = new Set([1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 14, 17, 18, 19, 20]);
/** Hair, built around the skull centre. */
function buildHair(hr, hex, hatId) {
  const g = new THREE.Group();
  if (!hr) return g;
  const m = mat(hex, 0.55);
  const R = HEAD_R;
  const covered = COVERING_HATS.has(hatId);
  if (!covered) {
    // Scalp: a cap tilted back so the forehead shows.
    const cap = new THREE.Mesh(new THREE.SphereGeometry(R * 1.035, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), m);
    cap.rotation.x = -0.6;
    cap.scale.set(1.01, 1.02, 0.99);
    g.add(cap);
  }
  // Fringe along the hairline (short, swoop, ponytail, buns, long).
  if ([1, 4, 5, 7].includes(hr)) {
    for (let i = -2; i <= 2; i++) {
      const a = i * 0.32;
      const lock = sphere(0.05, m, 10, 8);
      lock.scale.set(1, 0.7, 0.75);
      lock.position.set(Math.sin(a) * R * 0.9, R * 0.62 - Math.abs(i) * 0.02, Math.cos(a) * R * 0.66);
      if (!covered || Math.abs(i) >= 1) g.add(lock);
    }
  }
  if (hr === 2) {
    const sw = sphere(0.1, m, 14, 10);
    sw.scale.set(1.6, 0.55, 0.8);
    sw.position.set(-0.05, R * 0.66, R * 0.55);
    sw.rotation.set(0.5, 0, -0.35);
    g.add(sw);
  }
  if (hr === 3 && !covered) {
    // Curls: little balls spread over the top (golden-angle spiral).
    for (let i = 0; i < 26; i++) {
      const y = 1 - (i / 25) * 0.62, r = Math.sqrt(1 - y * y), a = i * 2.39996;
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.055, 1), m);
      c.position.set(Math.cos(a) * r * R * 1.03, y * R * 1.03, Math.sin(a) * r * R * 1.03 - 0.02);
      if (c.position.z > R * 0.62 && c.position.y < R * 0.65) continue; // keep the forehead clear
      g.add(c);
    }
  }
  if (hr === 4) {
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.016, 8, 16), mat(0xe0453a, 0.5));
    tie.position.set(0, R * 0.45, -R * 1.02);
    tie.rotation.x = 0.9;
    const tail = new THREE.Mesh(limbGeo(0.055, 0.035, 0.16), m);
    tail.position.set(0, R * 0.12, -R * 1.25);
    tail.rotation.x = 0.55;
    g.add(tie, tail);
  }
  if (hr === 5 && !covered) for (const sx of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.085, 14, 10), m, sx * R * 0.62, R * 0.86, -0.03));
  if (hr === 6 && !covered) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2, tilt = 0.55;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.15, 8), m);
      const dir = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt) - 0.25).normalize();
      sp.position.copy(dir).multiplyScalar(R * 1.05);
      sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      g.add(sp);
    }
    g.add(mesh(new THREE.ConeGeometry(0.06, 0.2, 8), m, 0, R * 1.1, 0.02));
  }
  if (hr === 7) {
    // Long hair down the back and over the ears.
    const backMat = mat(hex, 0.55, { side: THREE.DoubleSide });
    const back = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.03, R * 1.1, 0.34, 26, 1, true, Math.PI * 0.55, Math.PI * 0.9), backMat);
    back.position.set(0, -0.07, -0.02);
    g.add(back);
    // Soft rounded ends along the bottom edge.
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * 0.6 + (i / 6) * Math.PI * 0.8;
      const tip = sphere(0.045, m, 10, 8);
      tip.position.set(Math.sin(a) * R * 1.07, -0.24, Math.cos(a) * R * 1.07 - 0.02);
      g.add(tip);
    }
    for (const sx of [-1, 1]) {
      const lock = capsule(0.045, 0.16, m);
      lock.position.set(sx * R * 0.93, -0.06, 0.02);
      g.add(lock);
    }
  }
  return g;
}

function buildHat(h, col) {
  const g = new THREE.Group();
  const top = HEAD_R * 0.98;
  const fab = mat(col, 0.85);
  const knit = mat(col, 0.95, { map: knitTexture(), bumpMap: knitTexture(), bumpScale: 1 });
  const cream = mat(0xf4ecd8, 0.95, { map: knitTexture() });
  const dome = (r, m, cut = 0.5) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 22, 12, 0, Math.PI * 2, 0, Math.PI * cut), m); return s; };
  if (h === 1 || h === 2) {
    const cap = dome(HEAD_R * 1.04, knit, 0.42);
    cap.position.y = 0.04;
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(HEAD_R * 0.93, 0.035, 8, 26), knit);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = 0.1;
    g.add(cap, cuff);
    if (h === 2) g.add(mesh(new THREE.IcosahedronGeometry(0.07, 1), cream, 0, top + 0.08, 0));
  } else if (h === 3) {
    g.add(mesh(new THREE.CylinderGeometry(0.17, 0.23, 0.15, 22), fab, 0, top - 0.02, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.02, 26), fab, 0, top - 0.09, 0));
  } else if (h === 4 || h === 5) {
    const cap = dome(HEAD_R * 1.02, fab, 0.4);
    cap.position.y = 0.06;
    const bill = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 20, 1, false, -Math.PI / 2, Math.PI), mat(new THREE.Color(col).multiplyScalar(0.7)));
    bill.position.set(0, 0.12, h === 4 ? 0.17 : -0.17);
    if (h === 5) bill.rotation.y = Math.PI;
    g.add(cap, bill, mesh(new THREE.SphereGeometry(0.025, 8, 6), fab, 0, top + 0.02, 0));
  } else if (h === 6) {
    const leather = mat(0x8a5a32, 0.8);
    g.add(mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.2, 20), leather, 0, top + 0.02, 0));
    const brim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 6, 24), leather);
    brim.rotation.x = Math.PI / 2;
    brim.scale.set(1, 1.3, 0.5);
    brim.position.y = top - 0.07;
    g.add(brim, mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.04, 20), mat(0x3a2414), 0, top - 0.04, 0));
  } else if (h === 7) {
    const silk = mat(0x1d1d22, 0.45);
    g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.32, 22), silk, 0, top + 0.12, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.02, 24), silk, 0, top - 0.04, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.05, 22), mat(col, 0.6), 0, top + 0.0, 0));
  } else if (h === 8) {
    const cone = mesh(new THREE.ConeGeometry(0.13, 0.32, 20), mat(col, 0.6), 0, top + 0.12, 0);
    cone.rotation.z = 0.1;
    g.add(cone, mesh(new THREE.IcosahedronGeometry(0.04, 1), mat(0xf2c33b, 0.6), 0.015, top + 0.29, 0));
  } else if (h === 9) {
    const gold = mat(0xf2c33b, 0.25, { metalness: 0.8 });
    g.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 20, 1, true), gold, 0, top + 0.0, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.add(mesh(new THREE.ConeGeometry(0.035, 0.09, 6), gold, Math.cos(a) * 0.16, top + 0.09, Math.sin(a) * 0.16));
      g.add(mesh(new THREE.SphereGeometry(0.018, 8, 6), mat(i % 2 ? 0xe0453a : 0x2f5fb3, 0.2), Math.cos(a) * 0.17, top + 0.02, Math.sin(a) * 0.17));
    }
  } else if (h === 10) {
    const shell = mat(col, 0.35);
    const d = dome(HEAD_R * 1.08, shell, 0.5);
    d.position.y = 0.03;
    g.add(d, mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12), new THREE.MeshStandardMaterial({ color: 0xfff6c8, emissive: 0xffe9a0, emissiveIntensity: 1.2 }), 0, 0.17, HEAD_R * 1.02));
    g.children[g.children.length - 1].rotation.x = Math.PI / 2;
  } else if (h === 11) {
    const white = mat(0xffffff, 0.9);
    g.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 20), white, 0, top + 0.0, 0));
    for (let i = 0; i < 5; i++) g.add(mesh(new THREE.SphereGeometry(0.1, 12, 10), white, Math.cos(i * 1.26) * 0.09, top + 0.13, Math.sin(i * 1.26) * 0.09));
  } else if (h === 12) {
    const cap = dome(HEAD_R * 1.02, mat(col, 0.7), 0.4);
    cap.position.y = 0.06;
    g.add(cap, mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 6), mat(0x888888, 0.4), 0, top + 0.08, 0));
    const prop = new THREE.Group();
    prop.position.y = top + 0.12;
    for (const sx of [-1, 1]) { const blade = mesh(new THREE.BoxGeometry(0.16, 0.01, 0.04), mat(sx > 0 ? 0xe0453a : 0xf2c33b, 0.5), sx * 0.08, 0, 0); blade.rotation.x = sx * 0.25; prop.add(blade); }
    g.add(prop);
    g.userData.spin = prop;
  } else if (h === 13) {
    const band = dome(HEAD_R * 1.02, mat(col, 0.85), 0.36);
    band.position.y = 0.05;
    const knot = mesh(new THREE.SphereGeometry(0.04, 8, 6), mat(col, 0.85), 0, 0.12, -HEAD_R * 0.95);
    const tail = mesh(new RoundedBoxGeometry(0.05, 0.12, 0.02, 2, 0.008), mat(col, 0.85), 0.03, 0.05, -HEAD_R * 0.98);
    tail.rotation.z = 0.4;
    g.add(band, knot, tail);
  } else if (h === 14) {
    const metal = mat(0x9aa3ad, 0.35, { metalness: 0.7 });
    const d = dome(HEAD_R * 1.05, metal, 0.48);
    d.position.y = 0.03;
    g.add(d);
    for (const sx of [-1, 1]) {
      const horn = mesh(new THREE.ConeGeometry(0.045, 0.2, 10), mat(0xf4ecd8, 0.6), sx * 0.24, top - 0.02, 0);
      horn.rotation.z = -sx * 0.9;
      g.add(horn);
    }
  } else if (h === 15) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      g.add(mesh(new THREE.IcosahedronGeometry(0.045, 0), mat([0xff9fb8, 0xffe27a, 0xffffff][i % 3], 0.6), Math.cos(a) * HEAD_R * 0.85, top - 0.07, Math.sin(a) * HEAD_R * 0.85));
    }
  } else if (h === 16) {
    // Laurel wreath: two rows of leaves, tipped with gold.
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      if (Math.abs(Math.sin(a / 2)) < 0.12) continue; // gap at the front
      const leaf = mesh(new THREE.SphereGeometry(0.045, 8, 6), mat(i % 3 ? 0x5f9a3a : 0xd8b23a, 0.5), Math.sin(a) * HEAD_R * 0.9, top - 0.06 + (i % 2) * 0.03, Math.cos(a) * HEAD_R * 0.9);
      leaf.scale.set(0.55, 0.45, 1.3);
      leaf.rotation.y = a;
      leaf.rotation.x = 0.5;
      g.add(leaf);
    }
  } else if (h === 17) {
    // Gecko cap: a green cap with two big googly eyes on top.
    const cap = dome(HEAD_R * 1.03, mat(0x5fbf4a, 0.6), 0.42);
    cap.position.y = 0.05;
    g.add(cap);
    for (const sx of [-1, 1]) {
      const eye = mesh(new THREE.SphereGeometry(0.07, 14, 10), mat(0xffffff, 0.3), sx * 0.1, top + 0.07, 0.06);
      eye.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), mat(0x1d1b22, 0.3), 0, 0.005, 0.05));
      g.add(eye, mesh(new THREE.SphereGeometry(0.08, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x5fbf4a, 0.6), sx * 0.1, top + 0.06, 0.06));
    }
  } else if (h === 18) {
    // Racing helmet: glossy shell, dark visor, a stripe over the top.
    const shell = dome(HEAD_R * 1.12, mat(col, 0.2), 0.58);
    shell.position.y = -0.02;
    const visor = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R * 1.13, 22, 10, -0.9, 1.8, Math.PI * 0.36, Math.PI * 0.16), new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.05, metalness: 0.6 }));
    visor.position.y = -0.02;
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(HEAD_R * 1.12, 0.022, 6, 28, Math.PI), mat(0xffffff, 0.3));
    stripe.rotation.y = Math.PI / 2;
    stripe.position.y = -0.02;
    g.add(shell, visor, stripe);
  } else if (h === 19) {
    // Golden helmet with a crest along the top.
    const gold = mat(0xf2c33b, 0.22, { metalness: 0.85 });
    const d = dome(HEAD_R * 1.07, gold, 0.5);
    d.position.y = 0.02;
    const crest = mesh(new RoundedBoxGeometry(0.05, 0.12, 0.42, 2, 0.02), mat(0xe0453a, 0.6), 0, top + 0.08, -0.02);
    g.add(d, crest);
  } else if (h === 20) {
    // Aviator cap: leather cap, ear flaps, goggles pushed up on the forehead.
    const leather = mat(0x7a4a2a, 0.75);
    const d = dome(HEAD_R * 1.05, leather, 0.5);
    d.position.y = 0.0;
    g.add(d);
    for (const sx of [-1, 1]) {
      const flap = mesh(new RoundedBoxGeometry(0.06, 0.16, 0.13, 2, 0.03), leather, sx * HEAD_R * 1.0, top - 0.24, 0);
      g.add(flap);
      const lens = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.014, 6, 16), mat(0xb9c2cc, 0.3, { metalness: 0.7 }));
      lens.position.set(sx * 0.07, top - 0.02, HEAD_R * 0.86);
      lens.rotation.x = -0.6;
      g.add(lens);
    }
  }
  g.position.y = HEAD_R * 0.6 - 0.1;
  return g;
}

function buildExtra(a, head) {
  const z = HEAD_R * 0.95;
  const black = mat(0x1d1b22, 0.3);
  if (a === 1 || a === 2 || a === 3) {
    const frame = a === 3 ? mat(0x2b2c33, 0.5) : black;
    const lens = a === 1 ? new THREE.MeshStandardMaterial({ color: 0xcfe8ff, roughness: 0.05, transparent: true, opacity: 0.35 })
      : new THREE.MeshStandardMaterial({ color: a === 3 ? 0xff9a3c : 0x111111, roughness: 0.1, metalness: 0.4, transparent: a === 3, opacity: 0.85 });
    if (a === 3) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(HEAD_R * 0.98, 0.022, 6, 28), frame);
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.04;
      const goggle = mesh(new RoundedBoxGeometry(0.26, 0.09, 0.05, 2, 0.03), lens, 0, 0.04, z);
      head.add(band, goggle);
    } else {
      for (const sx of [-1, 1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 6, 18), frame);
        ring.position.set(sx * 0.085, 0.03, z + 0.02);
        const glass = new THREE.Mesh(new THREE.CircleGeometry(0.044, 18), lens);
        glass.position.set(sx * 0.085, 0.03, z + 0.022);
        head.add(ring, glass);
      }
      head.add(mesh(new THREE.BoxGeometry(0.05, 0.008, 0.008), frame, 0, 0.035, z + 0.025));
    }
  } else if (a === 5) {
    for (const sx of [-1, 1]) {
      const m = mesh(new THREE.CapsuleGeometry(0.018, 0.05, 4, 8), mat(0x3b2a1e, 0.8), sx * 0.035, -0.035, z + 0.01);
      m.rotation.z = sx * 1.25;
      head.add(m);
    }
  } else if (a === 7) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(HEAD_R * 1.02, 0.015, 6, 24, Math.PI), mat(0x2b2c33, 0.4));
    band.position.y = 0.0;
    head.add(band);
    for (const sx of [-1, 1]) {
      const cup = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 16), mat(0xe0453a, 0.4), sx * HEAD_R * 1.0, 0.0, 0);
      cup.rotation.z = Math.PI / 2;
      head.add(cup);
    }
  } else if (a === 8) {
    const fl = new THREE.Group();
    for (let i = 0; i < 5; i++) { const a2 = (i / 5) * Math.PI * 2; fl.add(mesh(new THREE.SphereGeometry(0.025, 8, 6), mat(0xff9fb8, 0.6), Math.cos(a2) * 0.03, Math.sin(a2) * 0.03, 0)); }
    fl.add(mesh(new THREE.SphereGeometry(0.018, 8, 6), mat(0xffe27a, 0.5)));
    fl.position.set(HEAD_R * 0.9, 0.08, 0.04);
    fl.rotation.y = Math.PI / 2;
    head.add(fl);
  }
}

/** Build a climber. The origin is at the feet; +z is forward. */
export function makeClimber(look = DEFAULT_LOOK, { shadows = false, outline = false } = {}) {
  const model = buildClimber(look, shadows);
  if (outline) addOutlines(model);
  return model;
}

/** Cartoon ink outline: a slightly bigger, back-face-only dark copy behind each body part. */
const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x1c140e, side: THREE.BackSide });
function addOutlines(model) {
  const meshes = [];
  model.traverse((o) => { if (o.isMesh && !o.material.transparent) meshes.push(o); });
  for (const m of meshes) {
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    const r = m.geometry.boundingSphere.radius * Math.max(m.scale.x, m.scale.y, m.scale.z);
    if (r < 0.035) continue;
    const o = new THREE.Mesh(m.geometry, OUTLINE_MAT);
    o.position.copy(m.geometry.boundingSphere.center).multiplyScalar(-0.02 / r);
    o.scale.setScalar(1 + 0.022 / r);
    o.castShadow = false;
    o.receiveShadow = false;
    o.userData.outline = true;
    m.add(o);
  }
}

function buildClimber(look, shadows) {
  const L = validLook(look);
  const skinHex = SKINS[L.s];
  const topCol = COLORS[L.c];
  const botCol = COLORS[L.bc];
  const root = new THREE.Group();
  const skin = mat(skinHex, 0.6);
  const top = L.t === 4 ? mat(0xffffff, 0.85, { map: plaidTexture(topCol) })
    : L.t === 5 ? mat(topCol, 0.95, { map: knitTexture(), bumpMap: knitTexture(), bumpScale: 0.8 })
      : L.t === 3 ? mat(topCol, 0.3)
        : L.t === 2 ? mat(topCol, 0.7, { map: quiltTexture(), bumpMap: quiltTexture(), bumpScale: 2 }) : mat(topCol, 0.8);
  const topDark = mat(new THREE.Color(topCol).multiplyScalar(0.7), 0.8);
  const bottom = mat(botCol, 0.85);
  const longSleeves = [1, 2, 3, 4, 5].includes(L.t);
  const sleeveMat = L.t === 7 ? skin : L.t === 6 ? mat(0xf2efe8, 0.8) : top;
  const longLegs = [1, 2, 3].includes(L.b);

  // Hips & legs.
  const hips = new THREE.Group();
  hips.position.y = 0.55;
  root.add(hips);
  if (L.b === 4) {
    const skirt = mesh(new THREE.CylinderGeometry(0.17, 0.27, 0.22, 22), bottom, 0, -0.06, 0);
    hips.add(skirt);
  }

  const spine = new THREE.Group();
  spine.position.y = 0.04;
  hips.add(spine);
  const torso = new THREE.Mesh(torsoGeo(1), top);
  torso.scale.set(1, 1, 0.86);
  spine.add(torso);
  // Trousers/shorts wrap the lower torso, with a belt at the waist.
  const pants = new THREE.Mesh(torsoGeo(1.035, 5), bottom);
  pants.scale.set(1, 1, 0.86);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.222, 0.016, 8, 30), mat(0x2b2724, 0.6));
  belt.rotation.x = Math.PI / 2;
  belt.scale.set(1, 0.86, 1);
  belt.position.y = 0.1;
  spine.add(pants, belt);
  if (L.t === 1) {
    const hood = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.06, 8, 18, Math.PI * 1.3), top);
    hood.position.set(0, 0.4, -0.08);
    hood.rotation.x = -0.4;
    const pocket = mesh(new RoundedBoxGeometry(0.2, 0.08, 0.03, 2, 0.015), topDark, 0, 0.16, 0.185);
    spine.add(hood, pocket);
  }
  if (L.t === 3) for (let i = 0; i < 3; i++) spine.add(mesh(new THREE.SphereGeometry(0.014, 8, 6), mat(0xf2efe8, 0.3), 0, 0.12 + i * 0.08, 0.19));
  if (L.t === 3) spine.add(mesh(new THREE.CylinderGeometry(0.23, 0.26, 0.1, 26), top, 0, 0.0, 0));
  if (L.t === 6) for (const sx of [-1, 1]) {
    const panel = mesh(new RoundedBoxGeometry(0.15, 0.3, 0.05, 2, 0.02), mat(topCol, 0.8), sx * 0.1, 0.2, 0.17);
    spine.add(panel);
  }
  if (L.t === 6) torso.material = mat(0xf2efe8, 0.8);
  if (L.t === 0 || L.t === 6 || L.t === 7 || L.t === 5) {
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 6, 18), L.t === 5 ? top : topDark);
    collar.rotation.x = Math.PI / 2;
    collar.scale.set(1, 0.86, 1);
    collar.position.y = 0.4;
    spine.add(collar);
  }
  if (L.b === 3) {
    spine.add(mesh(new RoundedBoxGeometry(0.22, 0.18, 0.05, 2, 0.02), bottom, 0, 0.14, 0.18));
    for (const sx of [-1, 1]) spine.add(mesh(new THREE.BoxGeometry(0.04, 0.22, 0.02), bottom, sx * 0.09, 0.28, 0.165));
  }
  if (L.a === 4) {
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.045, 10, 22), mat(0xe0453a, 0.9, { map: knitTexture() }));
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 0.38;
    const tail = mesh(new RoundedBoxGeometry(0.08, 0.2, 0.03, 2, 0.01), scarf.material, 0.07, 0.29, 0.15);
    tail.rotation.z = -0.2;
    spine.add(scarf, tail);
  }
  if (L.a === 6) {
    for (const sx of [-1, 1]) {
      const wing = mesh(new THREE.ConeGeometry(0.035, 0.07, 4), mat(0xe0453a, 0.6), sx * 0.04, 0.36, 0.13);
      wing.rotation.z = sx * Math.PI / 2;
      spine.add(wing);
    }
    spine.add(mesh(new THREE.SphereGeometry(0.018, 8, 6), mat(0xe0453a, 0.6), 0, 0.36, 0.14));
  }

  // Backpack.
  const pack = new THREE.Group();
  pack.position.set(0, 0.2, -0.22);
  spine.add(pack);
  pack.add(mesh(new RoundedBoxGeometry(0.3, 0.36, 0.16, 3, 0.06), mat(0x6b5a3a, 0.85)));
  pack.add(mesh(new RoundedBoxGeometry(0.31, 0.1, 0.17, 2, 0.04), mat(0x544529, 0.85), 0, 0.14, 0.003));
  const roll = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.34, 14), mat(0x3a7a5a, 0.85), 0, 0.22, 0);
  roll.rotation.z = Math.PI / 2;
  pack.add(roll);
  const webbing = mat(0x2b2724, 0.7);
  for (const sx of [-1, 1]) pack.add(mesh(new THREE.BoxGeometry(0.04, 0.012, 0.22), webbing, sx * 0.11, 0.17, 0.11));
  // Shoulder straps down the front, joined by a chest strap with a buckle.
  for (const sx of [-1, 1]) {
    const st = mesh(new RoundedBoxGeometry(0.045, 0.24, 0.014, 2, 0.006), webbing, sx * 0.1, 0.25, 0.184);
    st.rotation.x = -0.27;
    spine.add(st);
  }
  spine.add(mesh(new RoundedBoxGeometry(0.2, 0.026, 0.014, 2, 0.006), webbing, 0, 0.255, 0.186));
  spine.add(mesh(new RoundedBoxGeometry(0.04, 0.034, 0.02, 2, 0.006), mat(0xf2c33b, 0.4), 0, 0.255, 0.192));
  // Water bottle in the side pocket, a coiled rope and a carabiner.
  const bottle = mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.13, 14), mat(0x23a3a3, 0.35), 0.17, -0.06, 0.01);
  bottle.add(mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.035, 12), mat(0x2b2c33, 0.5), 0, 0.08, 0));
  pack.add(bottle);
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.022, 8, 22), mat(0xe8762c, 0.8));
  coil.position.set(0, -0.04, -0.09);
  coil.scale.set(1, 1, 1.4);
  pack.add(coil);
  const biner = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 6, 14), mat(0xb9c2cc, 0.25, { metalness: 0.8 }));
  biner.position.set(-0.16, 0.05, 0.02);
  biner.rotation.y = Math.PI / 2;
  biner.scale.set(1, 1.4, 1);
  pack.add(biner);

  // Head.
  const neck = new THREE.Group();
  neck.position.y = 0.4;
  spine.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.06;
  neck.add(head);
  const skull = sphere(HEAD_R, skin, 28, 22);
  skull.position.y = HEAD_R * 0.8;
  skull.scale.set(1, 1.02, 0.97);
  head.add(skull);
  const face = new THREE.Group();
  face.position.y = HEAD_R * 0.8;
  head.add(face);
  const hairHex = HAIR_COLORS[L.hc];
  const eyes = buildFace(face, L.f, skinHex, L.hr ? hairHex : 0x3a2a20);
  face.add(buildHair(L.hr, hairHex, L.h));
  for (const sx of [-1, 1]) {
    const ear = sphere(0.05, skin, 10, 8);
    ear.scale.set(0.45, 1, 0.8);
    ear.position.set(sx * HEAD_R * 0.98, 0, 0);
    face.add(ear);
  }
  buildExtra(L.a, face);
  const hat = buildHat(L.h, topCol);
  hat.position.y += HEAD_R * 0.8 - HEAD_R * 0.6 + 0.1;
  head.add(hat);

  // Arms: chunky with mitten hands.
  const arm = (sx) => {
    const sh = new THREE.Group();
    sh.position.set(sx * 0.198, 0.305, 0);
    spine.add(sh);
    const upMat = longSleeves || L.t === 0 || L.t === 6 ? sleeveMat : skin;
    const cap = sphere(0.08, upMat, 18, 14);
    const upper = limb(0.08, 0.066, 0.11, upMat);
    upper.position.y = -0.1;
    const el = new THREE.Group();
    el.position.y = -0.205;
    const foreMat = longSleeves ? sleeveMat : skin;
    const elbow = sphere(0.066, foreMat, 16, 12);
    const fore = limb(0.066, 0.057, 0.085, foreMat);
    fore.position.y = -0.075;
    const hand = limb(0.057, 0.072, 0.05, skin);
    hand.scale.set(1, 1, 0.74);
    hand.position.y = -0.19;
    const thumb = limb(0.027, 0.022, 0.035, skin);
    thumb.position.set(-sx * 0.055, -0.175, 0.025);
    thumb.rotation.z = sx * 0.75;
    el.add(elbow, fore, hand, thumb);
    if (longSleeves) { const cuff = mesh(new THREE.CylinderGeometry(0.064, 0.064, 0.03, 16), topDark, 0, -0.13, 0); el.add(cuff); }
    sh.add(cap, upper, el);
    return { sh, el };
  };
  // Legs: short and sturdy.
  const shoeMats = [mat(0x6b4426, 0.7), mat(0xf2efe8, 0.6), mat(0x3d8a4a, 0.25), mat(0x8a5a32, 0.8)];
  const leg = (sx) => {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.1, -0.03, 0);
    hips.add(hip);
    const thigh = limb(0.1, 0.082, 0.1, L.b === 4 ? skin : bottom);
    thigh.position.y = -0.11;
    const knee = new THREE.Group();
    knee.position.y = -0.25;
    const shinMat = longLegs ? bottom : skin;
    const kneeBall = sphere(0.082, shinMat, 16, 12);
    const shin = limb(0.082, 0.07, 0.08, shinMat);
    shin.position.y = -0.1;
    knee.add(kneeBall);
    const foot = new THREE.Group();
    foot.position.y = -0.22;
    if (!longLegs && L.sh !== 2) { const sock = mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.08, 14), mat(0xf2efe8, 0.9, { map: knitTexture() }), 0, 0.07, 0); foot.add(sock); }
    if (L.b === 2) { const pk = mesh(new RoundedBoxGeometry(0.03, 0.08, 0.07, 2, 0.01), mat(new THREE.Color(botCol).multiplyScalar(0.75), 0.85), sx * 0.085, -0.12, 0); hip.add(pk); }
    const sm = shoeMats[L.sh];
    if (L.sh === 3) {
      foot.add(mesh(new RoundedBoxGeometry(0.13, 0.03, 0.24, 2, 0.01), sm, 0, -0.02, 0.04));
      foot.add(mesh(new RoundedBoxGeometry(0.12, 0.07, 0.17, 2, 0.03), skin, 0, 0.02, 0.04));
      foot.add(mesh(new THREE.BoxGeometry(0.135, 0.02, 0.03), sm, 0, 0.05, 0.06));
    } else {
      foot.add(mesh(new RoundedBoxGeometry(0.15, 0.1, 0.25, 3, 0.04), sm, 0, 0.0, 0.04));
      foot.add(mesh(new RoundedBoxGeometry(0.155, 0.025, 0.26, 2, 0.01), mat(0x2b2724, 0.9), 0, -0.045, 0.04));
      if (L.sh === 2) foot.add(mesh(new THREE.CylinderGeometry(0.085, 0.08, 0.2, 14), sm, 0, 0.1, 0));
      if (L.sh === 1) foot.add(mesh(new THREE.BoxGeometry(0.152, 0.02, 0.12), mat(topCol, 0.6), 0, 0.0, 0.05));
      if (L.sh === 0) foot.add(mesh(new THREE.CylinderGeometry(0.08, 0.078, 0.07, 14), sm, 0, 0.06, 0));
      if (L.sh === 0 || L.sh === 1) {
        const lace = mat(L.sh === 0 ? 0xe0453a : 0xffffff, 0.7);
        for (let i = 0; i < 3; i++) foot.add(mesh(new THREE.BoxGeometry(0.07, 0.012, 0.016), lace, 0, 0.05 - i * 0.004, 0.06 + i * 0.035));
      }
    }
    knee.add(shin, foot);
    hip.add(thigh, knee);
    return { hip, knee, foot };
  };

  const U = {
    hips, spine, neck, head, eyes, pack, hat,
    armL: arm(-1), armR: arm(1), legL: leg(-1), legR: leg(1),
    look: L, blinkT: 2 + Math.random() * 3, emote: null, emoteT: 0, t: Math.random() * 10, squash: 0,
  };
  root.traverse((o) => { if (o.isMesh) { o.castShadow = shadows; o.receiveShadow = shadows; } });
  root.userData = U;
  return root;
}

export function disposeClimber(model) {
  // Shared canvas textures stay alive for the next climber.
  model.traverse((o) => { if (o.isMesh && !o.userData.outline) { o.geometry.dispose(); o.material.dispose(); } });
}

/** Animate a climber. mode: ground | air | climb | rope | down. phase advances with movement. */
export function poseClimber(model, mode, facing, phase, dt, moving = 0) {
  const U = model.userData;
  U.t += dt;
  const t = U.t;
  const s = Math.sin(phase);
  model.rotation.set(0, facing, 0);
  const { hips, spine, head, eyes, pack, armL, armR, legL, legR, hat } = U;
  const H0 = 0.55;
  hips.position.y = H0;
  hips.rotation.set(0, 0, 0);
  spine.rotation.set(Math.sin(t * 2.1) * 0.015, 0, 0);
  head.rotation.set(Math.sin(t * 0.7) * 0.04, Math.sin(t * 0.45) * 0.1, 0);
  pack.rotation.set(0, 0, 0);
  for (const [a, sx] of [[armL, -1], [armR, 1]]) { a.sh.rotation.set(0.05, 0, sx * 0.25); a.el.rotation.set(-0.2, 0, 0); }
  for (const l of [legL, legR]) { l.hip.rotation.set(0, 0, 0); l.knee.rotation.set(0.05, 0, 0); l.foot.rotation.set(0, 0, 0); }
  if (hat.userData.spin) hat.userData.spin.rotation.y += dt * (6 + moving * 14);
  if (mode !== 'air') U.airT = 0;

  U.blinkT -= dt;
  eyes.scale.y = U.blinkT < 0.1 ? 0.15 : 1;
  if (U.blinkT < 0) U.blinkT = 2.5 + Math.random() * 4;

  if (mode === 'climb') {
    spine.rotation.x = 0.2;
    head.rotation.x = -0.4;
    armL.sh.rotation.set(-2.6 + s * 0.4, 0, -0.2);
    armR.sh.rotation.set(-2.6 - s * 0.4, 0, 0.2);
    armL.el.rotation.x = -0.3 - Math.max(0, -s) * 0.6;
    armR.el.rotation.x = -0.3 - Math.max(0, s) * 0.6;
    legL.hip.rotation.x = -0.8 - Math.max(0, s) * 0.5;
    legR.hip.rotation.x = -0.8 - Math.max(0, -s) * 0.5;
    legL.knee.rotation.x = 1.2 + Math.max(0, s) * 0.4;
    legR.knee.rotation.x = 1.2 + Math.max(0, -s) * 0.4;
    hips.position.y = H0 - 0.04;
  } else if (mode === 'rope') {
    head.rotation.x = -0.35;
    armL.sh.rotation.set(-2.9 + s * 0.3, 0, -0.1);
    armR.sh.rotation.set(-2.9 - s * 0.3, 0, 0.1);
    armL.el.rotation.x = -0.25 - Math.max(0, -s) * 0.5;
    armR.el.rotation.x = -0.25 - Math.max(0, s) * 0.5;
    legL.hip.rotation.x = -0.5;
    legR.hip.rotation.x = -0.35;
    legL.knee.rotation.x = 0.9;
    legR.knee.rotation.x = 0.7;
  } else if (mode === 'air') {
    const f = t * 12;
    armL.sh.rotation.set(-1.3 + Math.sin(f) * 0.6, 0, -1.2);
    armR.sh.rotation.set(-1.3 - Math.sin(f) * 0.6, 0, 1.2);
    armL.el.rotation.x = armR.el.rotation.x = -0.5;
    // Mid-jump the knees tuck up; when a fall drags on, the legs start to kick.
    const tuck = Math.max(0, 1 - (U.airT || 0) * 1.5);
    U.airT = (U.airT || 0) + dt;
    legL.hip.rotation.x = -0.6 + Math.sin(f * 0.7) * 0.5 * (1 - tuck) - 0.7 * tuck;
    legR.hip.rotation.x = -0.6 - Math.sin(f * 0.7) * 0.5 * (1 - tuck) - 0.7 * tuck;
    legL.knee.rotation.x = legR.knee.rotation.x = 0.9 + 0.9 * tuck;
    armL.sh.rotation.x += 0.6 * tuck;
    armR.sh.rotation.x += 0.6 * tuck;
    head.rotation.x = 0.2;
  } else if (mode === 'down') {
    model.rotation.set(-Math.PI / 2, facing, 0, 'YXZ');
    model.position.y += 0.22;
    armL.sh.rotation.set(0, 0, -1.4);
    armR.sh.rotation.set(0, 0, 1.4);
    legL.hip.rotation.set(-0.2, 0, -0.15);
    legR.hip.rotation.set(-0.4, 0, 0.15);
    legL.knee.rotation.x = 0.3;
    legR.knee.rotation.x = 0.7;
    head.rotation.set(0, 0.4, 0);
    eyes.scale.y = 0.15;
  } else if (mode === 'crouch') {
    // Squatting low with hands cupped in front: a step for a friend.
    hips.position.y = H0 - 0.2;
    spine.rotation.x = 0.45;
    head.rotation.x = -0.35;
    for (const l of [legL, legR]) { l.hip.rotation.x = -1.25; l.knee.rotation.x = 1.9; l.foot.rotation.x = -0.6; }
    legL.hip.rotation.z = -0.18;
    legR.hip.rotation.z = 0.18;
    armL.sh.rotation.set(-1.0, 0, 0.35);
    armR.sh.rotation.set(-1.0, 0, -0.35);
    armL.el.rotation.x = armR.el.rotation.x = -0.6;
  } else {
    // Bouncy walk/run with a little waddle.
    const w = Math.min(1, moving);
    const run = Math.max(0, (moving - 0.75) * 4);
    hips.position.y = H0 - 0.015 * w + Math.abs(Math.cos(phase)) * 0.04 * w;
    hips.rotation.z = s * 0.06 * w;
    spine.rotation.x += 0.06 * w + 0.12 * run;
    spine.rotation.y = -s * 0.18 * w;
    head.rotation.y *= 1 - w;
    head.rotation.z = -s * 0.06 * w;
    const sw = 0.65 + 0.25 * run;
    legL.hip.rotation.x = -s * sw * w;
    legR.hip.rotation.x = s * sw * w;
    legL.knee.rotation.x = 0.05 + w * (0.2 + 0.9 * Math.max(0, Math.sin(phase + 1.3)));
    legR.knee.rotation.x = 0.05 + w * (0.2 + 0.9 * Math.max(0, Math.sin(phase + 1.3 + Math.PI)));
    armL.sh.rotation.x = s * 0.7 * w + 0.05;
    armR.sh.rotation.x = -s * 0.7 * w + 0.05;
    armL.el.rotation.x = -0.3 - (0.3 + 0.5 * run) * w;
    armR.el.rotation.x = -0.3 - (0.3 + 0.5 * run) * w;
    pack.rotation.z = -s * 0.05 * w;
    // The pack bounces with each step; standing still, the climber breathes.
    pack.rotation.x = Math.abs(Math.cos(phase)) * 0.07 * w + 0.05 * run;
    const idle = 1 - w, br = Math.sin(t * 1.7);
    spine.rotation.x += br * 0.022 * idle;
    armL.sh.rotation.z -= br * 0.03 * idle;
    armR.sh.rotation.z += br * 0.03 * idle;
  }

  // Landing: knees bend and spring back.
  if (U.squash > 0 && mode !== 'down') {
    const k = Math.sin(Math.min(1, U.squash) * Math.PI * 0.5);
    hips.position.y -= 0.11 * k;
    spine.rotation.x += 0.22 * k;
    for (const l of [legL, legR]) { l.hip.rotation.x -= 0.55 * k; l.knee.rotation.x += 1.0 * k; l.foot.rotation.x -= 0.45 * k; }
    armL.sh.rotation.z -= 0.35 * k;
    armR.sh.rotation.z += 0.35 * k;
    U.squash = Math.max(0, U.squash - dt * 3.2);
  }

  if (U.emote && mode !== 'down') {
    U.emoteT -= dt;
    const e = t * 9;
    if (U.emote === 'wave') {
      armR.sh.rotation.set(0, 0, 2.5);
      armR.el.rotation.set(0, 0, 0.35 + Math.sin(e) * 0.5);
      head.rotation.z = 0.12;
    } else if (U.emote === 'cheer') {
      armL.sh.rotation.set(-0.3, 0, -2.7 - Math.sin(e) * 0.15);
      armR.sh.rotation.set(-0.3, 0, 2.7 + Math.sin(e) * 0.15);
      armL.el.rotation.x = armR.el.rotation.x = -0.2;
      hips.position.y += Math.abs(Math.sin(e * 0.55)) * 0.12;
    } else if (U.emote === 'point') {
      armR.sh.rotation.set(-1.5, 0, 0.15);
      armR.el.rotation.x = 0;
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
  x.font = '800 26px ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
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
