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

function makeYoke(parent, x) {
  const root = new THREE.Group();
  root.position.set(x, 1.28, -15.22);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.78, 12), metal());
  column.position.set(0, -0.42, 0.06);
  column.rotation.x = 0.35;
  column.castShadow = true;
  root.add(column);
  const boot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), plastic(0x242a38, 0.7));
  boot.scale.set(1, 0.55, 1.2);
  boot.position.set(0, -0.78, 0.16);
  root.add(boot);
  const wheel = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.028, 10, 28), grip());
  ring.castShadow = true;
  wheel.add(ring);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.028), metal());
    sp.position.set(Math.cos(a) * 0.08, Math.sin(a) * 0.08, 0);
    sp.rotation.z = a;
    wheel.add(sp);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 14), plastic(0x121820, 0.4));
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  const hornL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.04), grip());
  hornL.position.set(-0.16, 0.12, 0.02);
  const hornR = hornL.clone();
  hornR.position.x = 0.16;
  wheel.add(hornL, hornR);
  const hit = new THREE.Mesh(new THREE.CircleGeometry(0.34, 16), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.name = 'yokeHit';
  wheel.add(hit);
  root.add(wheel);
  root.userData.wheel = wheel;
  root.userData.hit = hit;
  parent.add(root);
  return root;
}

/** Two thrust levers, a flap lever and a trim wheel on the centre pedestal. */
function makeQuadrant(parent) {
  const base = new THREE.Group();
  base.position.set(0, 0.78, -14.55);
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

/**
 * Visual flight deck parented to the aircraft. Colliders and seat interact points stay in world.js.
 * Returns the yoke and throttle handles the flight model already drives.
 */
export function buildDeck(plane) {
  const shell = plastic(0x141a28, 0.72);
  const glare = new THREE.Mesh(rbox(3.5, 0.1, 0.85, 0.04), plastic(0x1a120c, 0.4));
  glare.position.set(0, 1.16, -15.55);
  glare.rotation.x = -0.42;
  glare.castShadow = true;
  plane.add(glare);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.035, 0.08), plastic(0x0e1218, 0.5));
  lip.position.set(0, 1.28, -15.95);
  plane.add(lip);
  const main = new THREE.Mesh(rbox(3.55, 0.72, 0.12, 0.03), shell);
  main.position.set(0, 0.95, -15.72);
  main.castShadow = true;
  plane.add(main);
  const pedestal = new THREE.Mesh(rbox(0.55, 0.7, 1.15, 0.04), plastic(0x222838, 0.5));
  pedestal.position.set(0, 0.38, -14.35);
  pedestal.castShadow = true;
  plane.add(pedestal);

  const attCanvas = document.createElement('canvas');
  attCanvas.width = 512;
  attCanvas.height = 320;
  const navCanvas = document.createElement('canvas');
  navCanvas.width = 512;
  navCanvas.height = 320;
  const attCtx = attCanvas.getContext('2d');
  const navCtx = navCanvas.getContext('2d');
  paintAtt(attCtx, 512, 320, null);
  paintNav(navCtx, 512, 320, null);
  const attTex = new THREE.CanvasTexture(attCanvas);
  const navTex = new THREE.CanvasTexture(navCanvas);
  attTex.colorSpace = navTex.colorSpace = THREE.SRGBColorSpace;
  attTex.userData.dynamic = navTex.userData.dynamic = true;
  attTex.generateMipmaps = navTex.generateMipmaps = false;
  attTex.minFilter = navTex.minFilter = THREE.LinearFilter;
  const attMat = new THREE.MeshBasicMaterial({ map: attTex });
  const navMat = new THREE.MeshBasicMaterial({ map: navTex });
  attMat.toneMapped = navMat.toneMapped = false;
  for (const sx of [-0.72, 0.72]) {
    const att = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.26), attMat);
    att.position.set(sx - 0.02, 1.02, -15.64);
    att.rotation.x = -0.18;
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.02), plastic(0x0c1016, 0.35));
    bezel.position.copy(att.position);
    bezel.position.z -= 0.012;
    bezel.rotation.x = -0.18;
    plane.add(bezel, att);
    const nav = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.22), navMat);
    nav.position.set(sx + 0.02, 0.74, -15.66);
    nav.rotation.x = -0.12;
    const bezel2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.26, 0.02), plastic(0x0c1016, 0.35));
    bezel2.position.copy(nav.position);
    bezel2.position.z -= 0.012;
    bezel2.rotation.x = -0.12;
    plane.add(bezel2, nav);
  }
  const standby = screenTex(128, 128, (g, w, h) => {
    g.fillStyle = '#061018';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#9fd8ff';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(64, 64, 40, 0.4, Math.PI * 2 - 0.2);
    g.stroke();
    g.strokeStyle = '#ff5a6a';
    g.beginPath();
    g.moveTo(64, 64);
    g.lineTo(86, 40);
    g.stroke();
    g.fillStyle = '#9fd8ff';
    g.font = 'bold 16px sans-serif';
    g.textAlign = 'center';
    g.fillText('STBY', 64, 112);
  });
  const st = new THREE.Mesh(new THREE.CircleGeometry(0.055, 20), new THREE.MeshBasicMaterial({ map: standby }));
  st.material.toneMapped = false;
  st.position.set(0, 1.05, -15.6);
  const stBezel = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 18), metal());
  stBezel.position.copy(st.position);
  plane.add(st, stBezel);

  const yokes = [makeYoke(plane, -0.62), makeYoke(plane, 0.62)];
  const quad = makeQuadrant(plane);
  overhead(plane);

  for (const sx of [-0.62, 0.62]) {
    const seat = new THREE.Group();
    seat.position.set(sx, 0, -14.6);
    const cushion = new THREE.Mesh(rbox(0.52, 0.12, 0.5, 0.05), plastic(0x2c3344, 0.7));
    cushion.position.set(0, 0.86, 0);
    cushion.castShadow = true;
    const back = new THREE.Mesh(rbox(0.5, 0.72, 0.12, 0.05), plastic(0x2c3344, 0.7));
    back.position.set(0, 1.22, 0.22);
    back.rotation.x = -0.12;
    back.castShadow = true;
    const head = new THREE.Mesh(rbox(0.32, 0.16, 0.1, 0.04), plastic(0x1e2433, 0.65));
    head.position.set(0, 1.62, 0.28);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.78, 10), metal());
    post.position.y = 0.42;
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(rbox(0.06, 0.05, 0.36, 0.02), plastic(0x1a2030, 0.6));
      arm.position.set(s * 0.28, 1.02, 0.02);
      seat.add(arm);
    }
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.012, 0.04), plastic(0xf5c542, 0.45));
    belt.position.set(0, 0.94, 0.12);
    seat.add(cushion, back, head, post, belt);
    plane.add(seat);
  }

  const flood = new THREE.PointLight(0xfff4e2, 1.4, 3.2, 1.6);
  flood.position.set(0, 2.05, -14.9);
  plane.add(flood);
  const chart = new THREE.PointLight(0x9fd8ff, 0.35, 1.6, 2);
  chart.position.set(0, 1.35, -15.3);
  plane.add(chart);

  let acc = 0;
  function paint(flight) {
    paintAtt(attCtx, 512, 320, flight);
    paintNav(navCtx, 512, 320, flight);
    attTex.needsUpdate = true;
    navTex.needsUpdate = true;
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
