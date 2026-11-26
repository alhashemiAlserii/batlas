// Original Batlas Air flight deck. Procedural meshes and canvas instruments.
// Layout words (ATT, NAV, thrust, flaps) are generic aviation terms, not taken from another game.
import * as THREE from '../../vendor/three.module.js';
import { RoundedBoxGeometry } from '../../vendor/addons/RoundedBoxGeometry.js';
import { canvasTexture } from './geo.js';
import { stylize } from './look.js';

const rbox = (w, h, d, r = 0.03) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
const metal = () => stylize(new THREE.MeshStandardMaterial({ color: 0xc5ceda, roughness: 0.28, metalness: 0.82, envMapIntensity: 0.7 }));
const grip = () => stylize(new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 0.62, metalness: 0.12 }));
const plastic = (color, rough = 0.55) => stylize(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.08, envMapIntensity: 0.35 }));

function screenTex(w, h, draw) {
  const tex = canvasTexture(w, h, draw);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Attitude display: sky over ochre, teal aircraft symbol, speed and height tapes. Original drawing. */
function paintAtt(ctx, w, h, f) {
  const pitch = f ? f.pitch || 0 : 0.04;
  const bank = f ? -(f.bank || 0) : 0;
  ctx.fillStyle = '#061018';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w * 0.5, h * 0.52);
  ctx.rotate(bank);
  const off = pitch * h * 1.15;
  ctx.fillStyle = '#2f7edb';
  ctx.fillRect(-w, -h * 2 + off, w * 2, h * 2);
  ctx.fillStyle = '#c4a36a';
  ctx.fillRect(-w, off, w * 2, h * 2);
  ctx.strokeStyle = '#f4f7fb';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-w, off);
  ctx.lineTo(w, off);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(244,247,251,0.7)';
  ctx.lineWidth = 2;
  for (const deg of [-20, -10, 10, 20]) {
    const y = off - (deg * Math.PI / 180) * h * 1.15;
    const half = Math.abs(deg) >= 20 ? 54 : 36;
    ctx.beginPath();
    ctx.moveTo(-half, y);
    ctx.lineTo(half, y);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(4,10,18,0.55)';
  ctx.fillRect(0, 0, 78, h);
  ctx.fillRect(w - 86, 0, 86, h);
  ctx.strokeStyle = '#19d3c5';
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  const spd = f ? Math.round((f.speed || 0) * 1.94384) : 0;
  const alt = f ? Math.max(0, Math.round(((f.y || 2.4) - 2.4) * 3.28084)) : 0;
  ctx.fillStyle = '#d7fff6';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(spd), 40, h * 0.46);
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#8ee0d4';
  ctx.fillText('KT', 40, h * 0.46 + 22);
  ctx.fillStyle = '#d7fff6';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(String(alt), w - 44, h * 0.46);
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#8ee0d4';
  ctx.fillText('FT', w - 44, h * 0.46 + 22);
  ctx.strokeStyle = '#ffd27a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(w * 0.34, h * 0.56);
  ctx.lineTo(w * 0.46, h * 0.56);
  ctx.lineTo(w * 0.5, h * 0.62);
  ctx.lineTo(w * 0.54, h * 0.56);
  ctx.lineTo(w * 0.66, h * 0.56);
  ctx.stroke();
  ctx.fillStyle = '#19d3c5';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('ATT', 16, 28);
  const hdg = f ? Math.round((((f.yaw || 0) * 180 / Math.PI) % 360 + 360) % 360) : 0;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f4f7fb';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(String(hdg).padStart(3, '0'), w * 0.5, 28);
}

/** Navigation arc: range rings and a teal course line. Original, not a copy of a nav display. */
function paintNav(ctx, w, h, f) {
  ctx.fillStyle = '#07140f';
  ctx.fillRect(0, 0, w, h);
  const cx = w * 0.5, cy = h * 0.62;
  ctx.strokeStyle = '#19d3c5';
  ctx.lineWidth = 2;
  for (const r of [36, 68, 100]) { ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(25,211,197,0.35)';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, 18);
  ctx.stroke();
  const brg = f ? Math.atan2(-(3200 - (f.x || 0)), -(-16500 - (f.z || 0))) - (f.yaw || 0) : -0.2;
  ctx.strokeStyle = '#f5c542';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.sin(brg) * 90, cy - Math.cos(brg) * 90);
  ctx.stroke();
  ctx.fillStyle = '#19d3c5';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 10);
  ctx.lineTo(cx - 7, cy + 8);
  ctx.lineTo(cx + 7, cy + 8);
  ctx.fill();
  ctx.strokeStyle = '#19d3c5';
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('NAV', 16, 28);
  ctx.fillStyle = '#d7fff6';
  ctx.font = '15px sans-serif';
  ctx.fillText('BATLAS', 16, h - 16);
}

const YOKE_METAL = metal();
const YOKE_GRIP = grip();
const YOKE_HUB = plastic(0x9aa3b0, 0.38);
const YOKE_BOOT = plastic(0x161b24, 0.92);
const YOKE_DARK = plastic(0x2a303c, 0.7);
const YOKE_RED = plastic(0xc23b3b, 0.45);

function clockFace() {
  const tex = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#e7edf4';
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1c2430'; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#1c2430';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.fillRect(w / 2 + Math.sin(a) * 46 - 1.5, h / 2 - Math.cos(a) * 46 - 4, 3, i % 3 === 0 ? 10 : 6);
    }
    g.strokeStyle = '#1c2430'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 + 8, h / 2 - 28); g.stroke();
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 + 22, h / 2 + 6); g.stroke();
    g.fillStyle = '#19d3c5'; g.beginPath(); g.arc(w / 2, h / 2, 3.5, 0, Math.PI * 2); g.fill();
  });
  return new THREE.MeshBasicMaterial({ map: tex });
}
let CLOCK_MAT = null;
function clockMat() { if (!CLOCK_MAT) CLOCK_MAT = clockFace(); return CLOCK_MAT; }

/** One ram's horn, from the hub out to a rubber grip. sign +1 is the right horn. */
function addHorn(wheel, sign) {
  const pts = [
    [0.03, -0.01, 0.012],
    [0.09, -0.045, 0.02],
    [0.16, -0.05, 0.028],
    [0.21, -0.01, 0.03],
    [0.2, 0.055, 0.026],
    [0.175, 0.1, 0.018],
  ].map(([x, y, z]) => new THREE.Vector3(sign * x, y, z));
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 18, 0.016, 7, false), YOKE_METAL);
  tube.castShadow = true;
  wheel.add(tube);
  const gripMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.024, 0.11, 10), YOKE_GRIP);
  gripMesh.position.set(sign * 0.188, 0.078, 0.024);
  gripMesh.rotation.z = sign * 0.22;
  gripMesh.castShadow = true;
  wheel.add(gripMesh);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), YOKE_GRIP);
  cap.position.set(sign * 0.176, 0.128, 0.016);
  wheel.add(cap);
  return gripMesh;
}

/**
 * Boeing-style ram's-horn yoke, original geometry. The column is rooted on the
 * cockpit floor; the wheel stays below the captain's sight line to the runway.
 */
function makeYoke(parent, x) {
  const root = new THREE.Group();
  root.position.set(x, 0, -15.22);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.025, 14), YOKE_DARK);
  plate.position.y = 0.012;
  root.add(plate);
  // Rubber boot where the column comes out of the floor, so it reads as attached.
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.055 + i * 0.006, 0.014, 6, 12), YOKE_BOOT);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.04 + i * 0.028, 0.01 + i * 0.008);
    root.add(ring);
  }
  const pitchPivot = new THREE.Group();
  pitchPivot.position.set(0, 0.06, 0.02);
  pitchPivot.rotation.x = 0.14;
  root.add(pitchPivot);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.062, 1.22, 12), YOKE_DARK);
  column.position.y = 0.62;
  column.castShadow = true;
  pitchPivot.add(column);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.04, 12), YOKE_METAL);
  collar.position.y = 1.2;
  pitchPivot.add(collar);

  const wheel = new THREE.Group();
  wheel.position.set(0, 1.36, 0);
  pitchPivot.add(wheel);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.045, 14), YOKE_HUB);
  hub.rotation.x = Math.PI / 2;
  hub.castShadow = true;
  wheel.add(hub);
  const face = new THREE.Mesh(rbox(0.09, 0.11, 0.012, 0.012), YOKE_HUB);
  face.position.z = 0.028;
  wheel.add(face);
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.028, 16), clockMat());
  clock.position.set(0, 0.012, 0.036);
  wheel.add(clock);
  const card = new THREE.Mesh(rbox(0.05, 0.028, 0.004, 0.004), plastic(0xf4f1e8, 0.8));
  card.position.set(0, -0.032, 0.036);
  wheel.add(card);
  const clip = new THREE.Mesh(rbox(0.032, 0.008, 0.008, 0.002), YOKE_METAL);
  clip.position.set(0, -0.02, 0.04);
  wheel.add(clip);

  const leftGrip = addHorn(wheel, -1);
  const rightGrip = addHorn(wheel, 1);
  // Trim rocker on the left grip, push-to-talk and a red autopilot disconnect on the right.
  const trim = new THREE.Mesh(rbox(0.012, 0.028, 0.01, 0.003), YOKE_DARK);
  trim.position.set(-0.02, 0.01, 0.03);
  leftGrip.add(trim);
  const ptt = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.008, 8), YOKE_DARK);
  ptt.rotation.x = Math.PI / 2;
  ptt.position.set(0.01, -0.01, 0.03);
  rightGrip.add(ptt);
  const ap = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.008, 8), YOKE_RED);
  ap.rotation.x = Math.PI / 2;
  ap.position.set(-0.012, 0.03, 0.02);
  rightGrip.add(ap);

  const hit = new THREE.Mesh(new THREE.CircleGeometry(0.28, 14), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.name = 'yokeHit';
  wheel.add(hit);
  root.userData.wheel = wheel;
  root.userData.pitchPivot = pitchPivot;
  root.userData.hit = hit;
  parent.add(root);
  return root;
}

const FRAME_MAT = plastic(0x2c3442, 0.48);
const GLASS_MAT = new THREE.MeshStandardMaterial({
  color: 0xc5d8ea, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.62,
  envMapIntensity: 0.85, depthWrite: false, side: THREE.DoubleSide,
});
let REFL_MAT = null;
function reflMat() {
  if (REFL_MAT) return REFL_MAT;
  const tex = canvasTexture(64, 128, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, 'rgba(255,255,255,0.55)');
    grd.addColorStop(0.45, 'rgba(190,220,235,0.08)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  REFL_MAT = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  return REFL_MAT;
}

/** One window: thin rounded frame, tinted glass, a faint reflection. ry swings the pane to follow the nose. */
function windowPane(parent, { x, y, z, w, h, ry = 0 }) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  const t = 0.026;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - t, h - t), GLASS_MAT);
  const ref = new THREE.Mesh(new THREE.PlaneGeometry((w - t) * 0.92, (h - t) * 0.92), reflMat());
  ref.position.z = 0.006;
  const bar = (bw, bh, px, py) => {
    const m = new THREE.Mesh(rbox(bw, bh, 0.032, 0.01), FRAME_MAT);
    m.position.set(px, py, 0);
    return m;
  };
  g.add(
    glass, ref,
    bar(w + t, t, 0, h / 2),
    bar(w + t, t, 0, -h / 2),
    bar(t, h + t, -w / 2, 0),
    bar(t, h + t, w / 2, 0),
  );
  parent.add(g);
  return g;
}

/**
 * Classic six-pane flight-deck glazing set into the nose: two front panes, two
 * angled quarter panes and two sliding side windows. The surround is solid, so
 * the sky shows only through the glass. Posts are vertical and mirrored.
 */
function buildWindshield(plane) {
  const shell = plastic(0xd5dce6, 0.78);
  const zF = -16.22;
  // Front bulkhead. Bars leave two equal openings around a centre post.
  const post = (x) => {
    const m = new THREE.Mesh(rbox(0.04, 0.98, 0.05, 0.012), FRAME_MAT);
    m.position.set(x, 1.7, zF);
    plane.add(m);
  };
  post(-1.02); post(0); post(1.02);
  const rail = (y, w, x, z, ry = 0) => {
    const m = new THREE.Mesh(rbox(w, 0.04, 0.05, 0.012), FRAME_MAT);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    plane.add(m);
  };
  rail(2.17, 2.08, 0, zF);
  rail(1.23, 2.08, 0, zF);
  const glass = (x) => {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.88), GLASS_MAT);
    const ref = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.8), reflMat());
    g.position.set(x, 1.7, zF + 0.01);
    ref.position.set(x, 1.7, zF + 0.02);
    plane.add(g, ref);
  };
  glass(-0.51); glass(0.51);
  const brow = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.28, 0.06), shell);
  brow.position.set(0, 2.38, -16.16);
  plane.add(brow);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.1, 0.08), shell);
  sill.position.set(0, 1.16, -16.16);
  plane.add(sill);
  // Angled quarter panes, folded back along the nose, mirrored.
  windowPane(plane, { x: -1.42, y: 1.68, z: -15.98, w: 0.56, h: 0.86, ry: 0.48 });
  windowPane(plane, { x: 1.42, y: 1.68, z: -15.98, w: 0.56, h: 0.86, ry: -0.48 });
  // Sliding side windows in the cockpit wall.
  for (const s of [-1, 1]) {
    windowPane(plane, { x: s * 2.16, y: 1.59, z: -15.48, w: 0.52, h: 0.62, ry: s * Math.PI / 2 });
    const track = new THREE.Mesh(rbox(0.5, 0.014, 0.016, 0.004), FRAME_MAT);
    track.position.set(s * 2.14, 1.93, -15.48);
    track.rotation.y = s * Math.PI / 2;
    plane.add(track);
  }
}

/** Two thrust levers, a flap lever and a trim wheel on the centre pedestal. Forward of the seats. */
function makeQuadrant(parent) {
  const base = new THREE.Group();
  base.position.set(0, 0.72, -15.05);
  const shell = new THREE.Mesh(rbox(0.42, 0.22, 0.72, 0.04), plastic(0x1c2433, 0.48));
  shell.position.y = 0.08;
  shell.castShadow = true;
  base.add(shell);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.36), plastic(0x0c1018, 0.9));
  slot.position.set(0, 0.2, -0.08);
  base.add(slot);
  const pivot = new THREE.Group();
  pivot.position.set(0, 0.2, -0.22);
  const levers = [];
  for (const dx of [-0.035, 0.035]) {
    const g = new THREE.Group();
    g.position.x = dx;
    const stick = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.22, 0.03), metal());
    stick.position.y = 0.12;
    stick.castShadow = true;
    g.add(stick);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.05, 10), plastic(dx < 0 ? 0xe4c36a : 0xd7dde6, 0.35));
    knob.rotation.z = Math.PI / 2;
    knob.position.y = 0.24;
    g.add(knob);
    pivot.add(g);
    levers.push(g);
  }
  pivot.rotation.x = -0.5;
  pivot.userData.target = -0.5;
  base.add(pivot);
  const flap = new THREE.Group();
  flap.position.set(0.16, 0.2, 0.16);
  const fstick = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.14, 0.02), plastic(0x3ddc84, 0.4));
  fstick.position.y = 0.08;
  flap.add(fstick);
  flap.rotation.x = -0.2;
  base.add(flap);
  const trim = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 16), metal());
  trim.rotation.z = Math.PI / 2;
  trim.position.set(-0.16, 0.16, 0.18);
  base.add(trim);
  for (let i = 0; i < 8; i++) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.012, 0.02), plastic(0x9aa4b5, 0.4));
    const a = (i / 8) * Math.PI;
    tick.position.set(-0.16, 0.16 + Math.sin(a) * 0.05, 0.18 + Math.cos(a) * 0.05);
    base.add(tick);
  }
  parent.add(base);
  return { pivot, levers, flap, trim };
}

function overhead(parent) {
  const g = new THREE.Group();
  g.position.set(0, 2.28, -14.7);
  const panel = new THREE.Mesh(rbox(1.7, 0.08, 0.72, 0.03), plastic(0x242b3a, 0.6));
  panel.castShadow = true;
  g.add(panel);
  const face = screenTex(512, 220, (ctx, w, h) => {
    ctx.fillStyle = '#1a2230';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d5dde8';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'left';
    const labels = ['CABIN', 'BEACON', 'PACK', 'FUEL', 'APU', 'ICE'];
    labels.forEach((lab, i) => {
      const x = 24 + (i % 3) * 168, y = 36 + Math.floor(i / 3) * 100;
      ctx.fillStyle = '#9aa6bb';
      ctx.fillText(lab, x, y);
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = k === 1 ? '#3ddc84' : '#dfe5ee';
        ctx.fillRect(x + k * 28, y + 16, 18, 28);
        ctx.strokeStyle = '#0e141e';
        ctx.strokeRect(x + k * 28, y + 16, 18, 28);
      }
    });
  });
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 0.62), new THREE.MeshBasicMaterial({ map: face }));
  decal.rotation.x = Math.PI / 2;
  decal.position.y = -0.042;
  g.add(decal);
  const lamps = [0x3ddc84, 0xf5c542, 0xff5a6a, 0x9fd8ff, 0xffffff, 0x3ddc84];
  lamps.forEach((c, i) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.018, 10), new THREE.MeshBasicMaterial({ color: c }));
    m.material.toneMapped = false;
    m.rotation.x = Math.PI / 2;
    m.position.set(-0.62 + (i % 6) * 0.24, -0.045, 0.28);
    g.add(m);
  });
  parent.add(g);
}

/** Centre engine screen. Two columns, original layout, not a copy of a type-certificate display. */
function paintEng(ctx, w, h, f) {
  const thr = f ? Math.round((f.throttle || 0) * 100) : 0;
  ctx.fillStyle = '#0c1218';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#7d8ea3';
  ctx.lineWidth = 3;
  ctx.strokeRect(8, 8, w - 16, h - 16);
  ctx.fillStyle = '#c5d0dc';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('POWER', 18, 36);
  for (const [name, cx] of [['L', 0.3], ['R', 0.7]]) {
    const x = w * cx;
    ctx.fillStyle = '#9aa8b8';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name, x, 64);
    ctx.fillStyle = '#1a2430';
    ctx.fillRect(x - 26, 78, 52, 120);
    ctx.fillStyle = thr > 88 ? '#ffb15a' : '#3ddc97';
    const bh = Math.max(4, (thr / 100) * 112);
    ctx.fillRect(x - 20, 192 - bh, 40, bh);
    ctx.fillStyle = '#e7eef6';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(String(thr), x, 230);
  }
  ctx.font = '14px sans-serif';
  ctx.fillStyle = '#8ea0b4';
  ctx.textAlign = 'left';
  ctx.fillText('FAN', 18, h - 16);
}

function paintGuide(ctx, w, h, f) {
  const spd = f ? Math.round((f.speed || 0) * 1.94384) : 0;
  const alt = f ? Math.max(0, Math.round(((f.y || 2.4) - 2.4) * 3.28084)) : 0;
  const hdg = f ? Math.round((((f.yaw || 0) * 180 / Math.PI) % 360 + 360) % 360) : 0;
  ctx.fillStyle = '#2c3440';
  ctx.fillRect(0, 0, w, h);
  const cells = [['SPD', String(spd)], ['HDG', String(hdg).padStart(3, '0')], ['ALT', String(alt)], ['VS', '0']];
  cells.forEach(([k, v], i) => {
    const x = 12 + i * (w / 4);
    ctx.fillStyle = '#10161c';
    ctx.fillRect(x, 10, w / 4 - 24, h - 20);
    ctx.fillStyle = '#8ea0b4';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(k, x + 8, 32);
    ctx.fillStyle = '#d7ffe9';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(v, x + 8, 62);
  });
}

function wornGrey() {
  const map = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#4a5362';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 480; i++) {
      const a = Math.random() * 0.07;
      g.fillStyle = Math.random() > 0.55 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a + 0.02})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 1);
    }
  }, { repeat: [2, 2] });
  return stylize(new THREE.MeshStandardMaterial({ map, color: 0x9aa3b0, roughness: 0.88, metalness: 0.02, envMapIntensity: 0.12 }));
}

/**
 * Visual flight deck parented to the aircraft. Colliders and seat interact points stay in world.js.
 * Returns the yoke and throttle handles the flight model already drives.
 */
export function buildDeck(plane) {
  const shell = wornGrey();
  // Low, thin glareshield. A deep tilted slab here used to fill the middle of the windshield.
  const glare = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.028, 0.22), shell);
  glare.position.set(0, 1.34, -15.62);
  glare.rotation.x = -0.12;
  plane.add(glare);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(2.95, 0.012, 0.03), plastic(0x1a2028, 0.92));
  lip.position.set(0, 1.37, -15.74);
  plane.add(lip);
  const mainPanel = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.72, 0.04), shell);
  mainPanel.position.set(0, 1.05, -15.42);
  mainPanel.rotation.x = -0.35;
  plane.add(mainPanel);
  const pedestal = new THREE.Mesh(rbox(0.46, 0.16, 0.55, 0.03), shell);
  pedestal.position.set(0, 0.78, -15.02);
  plane.add(pedestal);

  function liveCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData.dynamic = true;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    mat.toneMapped = false;
    return { canvas: c, ctx: c.getContext('2d'), tex, mat };
  }
  const att = liveCanvas(512, 320);
  const nav = liveCanvas(512, 320);
  const eng = liveCanvas(512, 300);
  const guide = liveCanvas(640, 96);
  paintAtt(att.ctx, 512, 320, null);
  paintNav(nav.ctx, 512, 320, null);
  paintEng(eng.ctx, 512, 300, null);
  paintGuide(guide.ctx, 640, 96, null);
  const bezelMat = plastic(0x1a2028, 0.75);
  function display(mat, w, h, x, y, z, tilt) {
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    screen.position.set(x, y, z);
    screen.rotation.x = tilt;
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, h + 0.03, 0.012), bezelMat);
    bezel.position.set(x, y, z - 0.01);
    bezel.rotation.x = tilt;
    plane.add(bezel, screen);
  }
  // Each seat: attitude above, map below. Centre: engine screen. All sit under the glareshield.
  for (const sx of [-0.82, 0.82]) {
    display(att.mat, 0.4, 0.22, sx, 1.2, -15.26, -0.48);
    display(nav.mat, 0.4, 0.18, sx, 0.98, -15.2, -0.46);
  }
  display(eng.mat, 0.48, 0.32, 0, 1.08, -15.26, -0.4);
  const guideMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.055), guide.mat);
  guideMesh.position.set(0, 1.36, -15.5);
  guideMesh.rotation.x = -0.85;
  plane.add(guideMesh);

  buildWindshield(plane);
  const yokes = [makeYoke(plane, -0.58), makeYoke(plane, 0.58)];
  const quad = makeQuadrant(plane);
  overhead(plane);

  // Seats sit behind the eye point. The old backrest reached into the camera and filled the frame.
  for (const sx of [-0.62, 0.62]) {
    const seat = new THREE.Group();
    seat.position.set(sx, 0, -14.35);
    const cushion = new THREE.Mesh(rbox(0.48, 0.1, 0.46, 0.04), plastic(0x2c3344, 0.82));
    cushion.position.set(0, 0.78, 0.05);
    const back = new THREE.Mesh(rbox(0.46, 0.55, 0.08, 0.04), plastic(0x2c3344, 0.82));
    back.position.set(0, 1.08, 0.28);
    back.rotation.x = -0.08;
    const head = new THREE.Mesh(rbox(0.28, 0.12, 0.07, 0.03), plastic(0x232a36, 0.8));
    head.position.set(0, 1.4, 0.32);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(rbox(0.05, 0.04, 0.32, 0.015), plastic(0x1a2030, 0.75));
      arm.position.set(s * 0.26, 0.92, 0.08);
      seat.add(arm);
    }
    seat.add(cushion, back, head);
    plane.add(seat);
  }
  // Stowed sun visors, up against the brow, one each side. They do not cross the centre pane.
  for (const sx of [-1.15, 1.15]) {
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.008, 0.16), plastic(0x2a3038, 0.75));
    visor.position.set(sx, 2.22, -15.7);
    visor.rotation.x = -1.35;
    plane.add(visor);
  }

  const flood = new THREE.PointLight(0xfff1dc, 0.55, 4.2, 1.8);
  flood.position.set(0, 2.15, -14.6);
  plane.add(flood);
  const chart = new THREE.PointLight(0xc5d4e4, 0.22, 2.2, 2);
  chart.position.set(0, 1.45, -15.1);
  plane.add(chart);

  let acc = 0;
  function paint(flight) {
    paintAtt(att.ctx, 512, 320, flight);
    paintNav(nav.ctx, 512, 320, flight);
    paintEng(eng.ctx, 512, 300, flight);
    paintGuide(guide.ctx, 640, 96, flight);
    att.tex.needsUpdate = nav.tex.needsUpdate = eng.tex.needsUpdate = guide.tex.needsUpdate = true;
  }
  return {
    yokes,
    throttleLever: quad.pivot,
    update(dt, flight) {
      const flaps = flight?.flaps === 1 || flight?.flaps === 2 ? flight.flaps : 0;
      const want = -0.15 - flaps * 0.28;
      quad.flap.rotation.x += (want - quad.flap.rotation.x) * Math.min(1, dt * 4);
      quad.trim.rotation.y += dt * ((flight?.pitch || 0) * 2);
      acc += dt;
      if (acc > 0.12 && flight) { acc = 0; paint(flight); }
    },
  };
}
