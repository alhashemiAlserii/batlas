// Highcrag — procedural island mountain.
// The mountain is a heightfield: a noisy cone cut into terraces, so each biome band is a stack of
// flat ledges separated by steep rock walls. Collision samples the exact triangles that are drawn.
import * as THREE from '../../vendor/three.module.js';

export const SIZE = 480;
export const N = 321;
export const STEP = SIZE / (N - 1);
export const HALF = SIZE / 2;
export const R = 205;
export const HMAX = 300;
export const SEA = 0;

export const BANDS = [
  { id: 'shore', name: 'Saltwind Shore', y0: -40, y1: 36, T: 0, ground: 0xe3cf98, rock: 0x9c8a6a, fog: 0xbfe3f2 },
  { id: 'moss', name: 'Mossgrove', y0: 36, y1: 126, T: 15, ground: 0x5f9a3c, rock: 0x6c6a5a, fog: 0xa9d6c4 },
  { id: 'frost', name: 'Frostline', y0: 126, y1: 216, T: 18, ground: 0xeef4fb, rock: 0x7b8797, fog: 0xd7e3ef },
  { id: 'crown', name: 'Ember Crown', y0: 216, y1: 400, T: 14, ground: 0x4b3b3a, rock: 0x3a3030, fog: 0xd9a58a },
];
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
    let h0;
    if (dd < R) h0 = HMAX * Math.pow(1 - dd / R, 1.25) - 4;
    else h0 = -4 - (dd - R) * 0.3;
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
        if (y < 1.2) cg.setHex(0xd8c48d);
        if (y < -1.5) cg.setHex(0x6aa7b0);
        const rockiness = smooth(0.82, 0.62, tmpN.y);
        cc.copy(cg).lerp(cr, rockiness);
        // Band transitions blend over a few metres.
        cc.offsetHSL(0, 0, n * 0.05);
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
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    m.matrixAutoUpdate = false;
    return m;
  }

  // Random flat spot whose height lies in [y0, y1]. Returns null if none found.
  flatSpot(rng, y0, y1, minNy = 0.9, tries = 400) {
    const n = new THREE.Vector3();
    for (let t = 0; t < tries; t++) {
      const a = rng() * Math.PI * 2, d = rng() * (R + 25);
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
