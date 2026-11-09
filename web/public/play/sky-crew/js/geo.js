// Geometry helpers: vertex-coloured batching (one draw call per batch), lofted tubes, swept planforms, canvas textures.
import * as THREE from '../../vendor/three.module.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _c = new THREE.Color();

/** Collects many small geometries with per-part colours and merges them into one mesh. */
export class Batch {
  constructor() { this.parts = []; }
  /** add(geometry, color, [x,y,z], [rx,ry,rz], [sx,sy,sz]) */
  add(geo, color, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]) {
    _e.set(rot[0], rot[1], rot[2], rot[3] || 'XYZ'); _q.setFromEuler(_e);
    _m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scl[0], scl[1], scl[2]));
    this.parts.push({ geo, color, matrix: _m.clone() });
    return this;
  }
  box(w, h, d, color, x, y, z, rot, ) { return this.add(new THREE.BoxGeometry(w, h, d), color, [x, y, z], rot); }
  addMatrix(geo, color, matrix) { this.parts.push({ geo, color, matrix: matrix.clone() }); return this; }
  geometry() {
    let n = 0;
    const prepared = this.parts.map((p) => { const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone(); g.applyMatrix4(p.matrix); if (!g.attributes.normal) g.computeVertexNormals(); n += g.attributes.position.count; return { g, color: p.color }; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0;
    for (const { g, color } of prepared) {
      const P = g.attributes.position.array, N = g.attributes.normal.array, cnt = g.attributes.position.count;
      pos.set(P, o * 3); nor.set(N, o * 3);
      const vc = g.attributes.color;
      _c.set(color);
      for (let i = 0; i < cnt; i++) {
        if (vc) { col[(o + i) * 3] = vc.getX(i); col[(o + i) * 3 + 1] = vc.getY(i); col[(o + i) * 3 + 2] = vc.getZ(i); }
        else { col[(o + i) * 3] = _c.r; col[(o + i) * 3 + 1] = _c.g; col[(o + i) * 3 + 2] = _c.b; }
      }
      o += cnt; g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    return geo;
  }
  mesh(opts = {}) {
    const { basic = false, side = THREE.FrontSide, shadows = true, ...rest } = opts;
    const mat = basic ? new THREE.MeshBasicMaterial({ vertexColors: true, side, ...rest }) : new THREE.MeshLambertMaterial({ vertexColors: true, side, ...rest });
    const m = new THREE.Mesh(this.geometry(), mat);
    m.castShadow = shadows; m.receiveShadow = shadows;
    return m;
  }
}

/**
 * Loft a tube along z through elliptical rings. ring: { z, cy, rx, ry } (cx = 0).
 * theta: 0 = bottom, PI/2 = +x side, PI = top. Partial tubes via thetaStart/thetaLen.
 * Faces point outward (visible from outside, culled from inside).
 */
export function loft(rings, seg = 28, thetaStart = 0, thetaLen = Math.PI * 2, cap = false) {
  const pos = [], idx = [];
  const cols = seg + 1;
  for (const r of rings) {
    for (let i = 0; i <= seg; i++) {
      const t = thetaStart + (thetaLen * i) / seg;
      pos.push((r.cx || 0) + r.rx * Math.sin(t), r.cy - r.ry * Math.cos(t), r.z);
    }
  }
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // orientation check: make sure triangles face away from the axis
  const P = g.attributes.position;
  const v0 = new THREE.Vector3().fromBufferAttribute(P, idx[0]), v1 = new THREE.Vector3().fromBufferAttribute(P, idx[1]), v2 = new THREE.Vector3().fromBufferAttribute(P, idx[2]);
  const nrm = v1.clone().sub(v0).cross(v2.clone().sub(v0));
  const ring0 = rings[0];
  const out = new THREE.Vector3(v0.x - (ring0.cx || 0), v0.y - ring0.cy, 0);
  if (nrm.dot(out) < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; } g.setIndex(idx); }
  g.computeVertexNormals();
  void cap;
  return g;
}

/** Flat planform (points in x/z) extruded to a thin slab of given thickness centred on y=0. */
export function slab(points, thickness, bevel = 0.04) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
  // shape is in XY, extruded along +Z. Map shape-y -> world z, extrusion -> world y.
  g.rotateX(Math.PI / 2);
  g.translate(0, thickness / 2, 0);
  g.computeVertexNormals();
  return g;
}
/** Vertical fin: points in z/y, extruded along x. */
export function fin(points, thickness, bevel = 0.04) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1 });
  g.rotateY(-Math.PI / 2); // shape x -> world z, extrusion -> world -x
  g.translate(thickness / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

export function canvasTexture(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

/** Deterministic PRNG so every client builds identical scenery/passengers. */
export function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
