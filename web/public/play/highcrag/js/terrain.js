// Highcrag — procedural island mountain.
// The mountain is a heightfield: a noisy cone cut into terraces, so each biome band is a stack of
// flat ledges separated by steep rock walls. Collision samples the exact triangles that are drawn.
import * as THREE from '../../vendor/three.module.js';

export const SIZE = 736;
export const N = 421;
export const STEP = SIZE / (N - 1);
export const HALF = SIZE / 2;
export const R = 205; // mountain radius
export const COAST = 318; // average coastline radius: lowlands lie between the mountain and the beach
export const HMAX = 300;
export const SEA = 0;

export const BANDS = [
  { id: 'shore', name: 'Saltwind Shore', y0: -40, y1: 36, T: 0, ground: 0xe6d3a3, rock: 0x9c8a70, fog: 0xc6dbe6, sky: 0x3a76c4 },
  { id: 'moss', name: 'Tanglewood Jungle', y0: 36, y1: 126, T: 15, ground: 0x4a7f2e, rock: 0x6e6658, fog: 0xbfd6d0, sky: 0x3a74bd },
  { id: 'frost', name: 'Frostline Cliffs', y0: 126, y1: 216, T: 18, ground: 0xeef3f8, rock: 0x7a8494, fog: 0xd9e2ea, sky: 0x5b7fb2 },
  { id: 'crown', name: 'Ember Crown', y0: 216, y1: 400, T: 14, ground: 0x3b3230, rock: 0x2e2826, fog: 0xc9ab97, sky: 0x5c5a86 },
];
// Each mountain picks one of two versions of the middle zones (it changes with the seed, so every
// daily mountain can differ): jungle or a fungal hollow, then snowy cliffs or a red desert canyon.
export const VARIANTS = {
  moss: { id: 'moss', name: 'Tanglewood Jungle', ground: 0x4a7f2e, rock: 0x6e6658, fog: 0xbfd6d0, sky: 0x3a74bd },
  fungal: { id: 'fungal', name: 'Fungal Hollow', ground: 0x4b4a6e, rock: 0x5b5068, fog: 0x9d94bd, sky: 0x3f4583 },
  frost: { id: 'frost', name: 'Frostline Cliffs', ground: 0xeef3f8, rock: 0x7a8494, fog: 0xd9e2ea, sky: 0x5b7fb2 },
  canyon: { id: 'canyon', name: 'Red Canyon', ground: 0xd49a5e, rock: 0xa9533a, fog: 0xf1cfa6, sky: 0x4f8ad0 },
};
/** Set the zone versions for this seed. `force` (e.g. from ?zones=fungal,canyon) overrides. */
export function setVariant(seed, force = null) {
  const r = makeRng((seed ^ 0x2545f491) >>> 0);
  let mid = r() < 0.5 ? 'moss' : 'fungal';
  let high = r() < 0.5 ? 'frost' : 'canyon';
  if (force?.mid && VARIANTS[force.mid]) mid = force.mid;
  if (force?.high && VARIANTS[force.high]) high = force.high;
  Object.assign(BANDS[1], VARIANTS[mid]);
  Object.assign(BANDS[2], VARIANTS[high]);
  return { mid, high };
}
/** Display name for where you are (the lowlands share the shore band's rules). */
export const zoneName = (y) => (y < 3.5 ? 'Saltwind Shore' : y < 36 ? 'Palm Lowlands' : bandAt(y).name);
export const bandAt = (y) => (y < BANDS[1].y0 ? BANDS[0] : y < BANDS[2].y0 ? BANDS[1] : y < BANDS[3].y0 ? BANDS[2] : BANDS[3]);

export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iz, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
export function fbm(x, z, seed, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, z * f, seed + i * 17);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Terrain {
  constructor(seed) {
    this.seed = seed;
    this.h = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) this.h[j * N + i] = this.raw(-HALF + i * STEP, -HALF + j * STEP);
    }
    // Shave the top few metres into a summit plateau so the beacon stands on walkable ground,
    // not on a one-cell pinnacle. The beacon goes at the centre of that plateau.
    const cap = Float32Array.from(this.h).sort()[this.h.length - 90];
    let sx = 0, sz = 0, cnt = 0;
    for (let k = 0; k < this.h.length; k++) {
      if (this.h[k] > cap) {
        this.h[k] = cap + (this.h[k] - cap) * 0.04;
        sx += -HALF + (k % N) * STEP;
        sz += -HALF + Math.floor(k / N) * STEP;
        cnt++;
      }
    }
    sx /= cnt; sz /= cnt;
    this.summit = new THREE.Vector3(sx, this.height(sx, sz), sz);
  }

  raw(x, z) {
    const s = this.seed;
    const d = Math.hypot(x, z);
    const warp = fbm(x * 0.008, z * 0.008, s) * 30 + fbm(x * 0.03, z * 0.03, s + 5) * 7;
    const dd = Math.max(0, d + warp);
    // The mountain itself (unchanged shape).
    const mt = dd < R ? HMAX * Math.pow(1 - dd / R, 1.25) - 4 : -4 - (dd - R) * 0.3;
    // Lowlands: rolling hills between the mountain foot and a wavy coastline, then a beach.
    const coast = COAST + fbm(x * 0.006, z * 0.006, s + 11) * 38;
    const hills = 7 + fbm(x * 0.012, z * 0.012, s + 21) * 10 + fbm(x * 0.05, z * 0.05, s + 23) * 2.2;
    let low;
    if (d < coast - 34) low = hills;
    else if (d < coast) low = hills + (1.4 - hills) * smooth(coast - 34, coast, d);
    else low = 1.4 - (d - coast) * 0.22;
    // Smooth max so the foothills blend into the lowlands.
    const k = 10;
    let h0 = Math.max(mt, low) + Math.pow(Math.max(k - Math.abs(mt - low), 0), 2) / (4 * k);
    // A winding river from the foothills to the sea, and a few ponds.
    if (d > R * 0.7 && h0 < 30) {
      const a = Math.atan2(z, x);
      const course = 2.45 + fbm(d * 0.012, 0.5, s + 41) * 0.5;
      let da = a - course;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      const perp = Math.abs(da) * d;
      const w = 7 + d * 0.02;
      const cut = smooth(w * 1.6, w * 0.5, perp) * smooth(R * 0.7, R * 0.95, d);
      h0 = h0 + (-1.8 - h0) * cut;
      const pond = smooth(0.42, 0.55, fbm(x * 0.018, z * 0.018, s + 57));
      if (d < coast - 40) h0 = h0 + (-1.4 - h0) * pond * smooth(30, 18, h0);
    }
    let h = h0;
    for (let b = 1; b < BANDS.length; b++) {
      const band = BANDS[b];
      if (h0 >= band.y0 && h0 < band.y1) {
        const local = (h0 - band.y0) / band.T;
        const k = Math.floor(local), f = local - k;
        const c = 0.3 + 0.12 * fbm(x * 0.02, z * 0.02, s + 31);
        h = band.y0 + band.T * (k + 0.12 * f + 0.88 * smooth(1 - c, 1, f));
        break;
      }
    }
    // Small bumps everywhere; a little more on rock walls.
    h += fbm(x * 0.15, z * 0.15, s + 77, 3) * 0.6;
    return h;
  }

  // Exact height of the rendered triangle under (x, z).
  height(x, z) {
    let fx = (x + HALF) / STEP, fz = (z + HALF) / STEP;
    fx = Math.min(N - 1.0001, Math.max(0, fx));
    fz = Math.min(N - 1.0001, Math.max(0, fz));
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const H = this.h;
    const a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i], d = H[(j + 1) * N + i + 1];
    if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
    return d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }

  normal(x, z, out = new THREE.Vector3()) {
    let fx = (x + HALF) / STEP, fz = (z + HALF) / STEP;
    fx = Math.min(N - 1.0001, Math.max(0, fx));
    fz = Math.min(N - 1.0001, Math.max(0, fz));
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const H = this.h;
    const a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i], d = H[(j + 1) * N + i + 1];
    let dhdx, dhdz;
    if (u + v <= 1) { dhdx = (b - a) / STEP; dhdz = (c - a) / STEP; }
    else { dhdx = (d - c) / STEP; dhdz = (d - b) / STEP; }
    return out.set(-dhdx, 1, -dhdz).normalize();
  }

  buildMesh() {
    const pos = new Float32Array(N * N * 3);
    const col = new Float32Array(N * N * 3);
    const glow = new Float32Array(N * N);
    const tmpN = new THREE.Vector3();
    const cg = new THREE.Color(), cr = new THREE.Color(), cc = new THREE.Color();
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const x = -HALF + i * STEP, z = -HALF + j * STEP, y = this.h[k];
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        // Vertex normal from neighbours for colouring (slope -> rock).
        const hl = this.h[j * N + Math.max(0, i - 1)], hr = this.h[j * N + Math.min(N - 1, i + 1)];
        const hd = this.h[Math.max(0, j - 1) * N + i], hu = this.h[Math.min(N - 1, j + 1) * N + i];
        tmpN.set(hl - hr, 2 * STEP, hd - hu).normalize();
        const band = bandAt(y);
        const n = fbm(x * 0.09, z * 0.09, this.seed + 3, 2);
        cg.setHex(band.ground);
        cr.setHex(band.rock);
        // Rock strata: light/dark layers on cliff faces.
        cr.offsetHSL(0, 0, Math.sin(y * 1.7 + n * 3) * 0.035);
        if (band.id === 'moss') cg.offsetHSL(n * 0.03, 0, n * 0.06); // patchy jungle floor
        if (band.id === 'frost') cg.offsetHSL(0, 0, -Math.max(0, -n) * 0.06);
        if (band.id === 'fungal') { cg.offsetHSL(n * 0.06, 0.04, n * 0.07); cr.offsetHSL(n * 0.04, 0, 0); } // mossy violet floor
        if (band.id === 'canyon') { cg.offsetHSL(n * 0.015, 0, n * 0.05); cr.offsetHSL(0, 0.05, Math.sin(y * 0.9 + n * 2) * 0.05); } // banded sandstone
        if (band.id === 'shore' && y >= 2.6) {
          // Lowland meadows: lush green with dry golden patches and darker forest floor.
          const dry = smooth(0.15, 0.5, fbm(x * 0.02, z * 0.02, this.seed + 61, 3));
          cg.setHex(0x4e8436).lerp(new THREE.Color(0x98935e), dry * 0.55).offsetHSL(0, -0.04, n * 0.05);
          cr.setHex(0x8a7a5e);
        }
        if (y < 2.6) cg.setHex(0xe8d7ac).lerp(new THREE.Color(0x4e8436), smooth(1.8, 2.6, y));
        if (y < 0.35) cg.setHex(0xfffbf0); // surf foam along the waterline
        if (y < -0.6) cg.setHex(0x9fd8d0);
        if (y < -3) cg.setHex(0x4fa3b6);
        const rockiness = smooth(0.82, 0.62, tmpN.y);
        cc.copy(cg).lerp(cr, rockiness);
        cc.offsetHSL(0, 0, n * 0.05);
        // Lava cracks on the Ember Crown: thin glowing lines along noise zero-crossings.
        if (band.id === 'crown' && tmpN.y > 0.75) {
          const f = Math.abs(fbm(x * 0.045, z * 0.045, this.seed + 91, 3));
          glow[k] = Math.max(0, 1 - f / 0.045);
          if (glow[k] > 0) cc.lerp(new THREE.Color(0xff5a1a), glow[k] * 0.7);
        }
        // Cheap ambient occlusion: darken hollows and the foot of walls, lighten ridges.
        let avg = 0, cnt = 0;
        for (const [di, dj] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, -2], [2, -2], [-2, 2]]) {
          const ii = Math.min(N - 1, Math.max(0, i + di)), jj = Math.min(N - 1, Math.max(0, j + dj));
          avg += this.h[jj * N + ii]; cnt++;
        }
        const cav = avg / cnt - y;
        const ao = cav > 0 ? Math.max(0.58, 1 - cav * 0.045) : Math.min(1.12, 1 - cav * 0.02);
        cc.multiplyScalar(ao);
        col[k * 3] = cc.r; col[k * 3 + 1] = cc.g; col[k * 3 + 2] = cc.b;
      }
    }
    const idx = new Uint32Array((N - 1) * (N - 1) * 6);
    let p = 0;
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
        idx[p++] = a; idx[p++] = c; idx[p++] = b;
        idx[p++] = b; idx[p++] = c; idx[p++] = d;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('glow', new THREE.BufferAttribute(glow, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    return g;
  }

  // Random flat spot whose height lies in [y0, y1]. Returns null if none found.
  flatSpot(rng, y0, y1, minNy = 0.9, tries = 400) {
    const n = new THREE.Vector3();
    for (let t = 0; t < tries; t++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * (COAST + 30);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const y = this.height(x, z);
      if (y < y0 || y > y1 || y < 0.6) continue;
      if (this.normal(x, z, n).y < minNy) continue;
      return new THREE.Vector3(x, y, z);
    }
    return null;
  }

  // Wide flat ledge near a height, preferring a given angle around the mountain.
  campSpot(yTarget, angle) {
    const n = new THREE.Vector3();
    let best = null, bestScore = -1e9;
    for (let a = -1.2; a <= 1.2; a += 0.04) {
      for (let d = 2; d < R + 20; d += 1) {
        const x = Math.cos(angle + a) * d, z = Math.sin(angle + a) * d;
        const y = this.height(x, z);
        if (Math.abs(y - yTarget) > 9) continue;
        let flat = 1;
        for (const [ox, oz] of [[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5], [1.8, 1.8], [-1.8, -1.8]]) {
          flat = Math.min(flat, this.normal(x + ox, z + oz, n).y);
          if (Math.abs(this.height(x + ox, z + oz) - y) > 0.9) flat = 0;
        }
        const score = flat * 4 - Math.abs(a) * 0.6 - Math.abs(y - yTarget) * 0.05;
        if (flat > 0.9 && score > bestScore) { bestScore = score; best = new THREE.Vector3(x, y, z); }
      }
    }
    return best;
  }
}
