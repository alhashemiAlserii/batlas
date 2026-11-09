// Sky Crew v0 — bootstrap, input, player controller, camera, networking glue.
import * as THREE from '../../vendor/three.module.js';
import { buildPlane, buildWorld, GEAR_H, HALF_W, CEIL, ORIGIN, DEST } from './world.js';
import { Sim, ITEM_DEFS } from './sim.js';
import { stepFlight, KT, FT, distTo, relBearing } from './flight.js';
import { makeCharacter, animateCharacter, nameTag, RANK_COLORS } from './characters.js';
import { Net } from './net.js';
import * as UI from './ui.js';

const $ = (s) => document.querySelector(s);
const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && /iPad|iPhone|Android|Mobile/i.test(navigator.userAgent);
if (isTouch) document.body.classList.add('touch');

// ---------------- renderer / scene ----------------
const renderer = new THREE.WebGLRenderer({ antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('#view').append(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 40000);
const env = buildWorld(scene);
const ship = buildPlane();
scene.add(ship.plane);
ship.plane.add(camera);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const eventsConfig = await (await fetch('/play/sky-crew/events.json')).json();
const net = new Net();
const sim = new Sim({ ship, eventsConfig, onToast: (m, k) => { UI.toast(m, k); if (net.inRoom && net.isHost) net.send({ t: 'event', e: { toast: m, kind: k } }); } });

// ---------------- player ----------------
const R = 0.3, H = 1.7, EYE = 1.58, STEP = 0.45;
const SPAWN = new THREE.Vector3(4.6, -GEAR_H, 2.5);
const me = { pos: SPAWN.clone(), vel: new THREE.Vector3(), yaw: -Math.PI / 2, pitch: -0.15, onGround: false, mode: 'walk', third: false, cannon: false, moving: false };
const myAvatar = makeCharacter({ shirt: 0x1e6bff, hat: 0x07153a });
ship.plane.add(myAvatar);
let myCid = 'solo', myRole = null, playing = false, paused = false, seenSeed = sim.seed, resultsShown = false;
const myId = () => (net.inRoom ? net.cid : 'solo');

// ---------------- input ----------------
const keys = new Set();
const touch = { mx: 0, my: 0, thr: 0 };
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'F2') { e.preventDefault(); toggleAdmin(); return; }
  if (!playing) return;
  if (e.code === 'Escape') { togglePause(); return; }
  if (paused) return;
  keys.add(e.code);
  if (e.code === 'KeyE') interact();
  if (e.code === 'KeyQ') throwHeld();
  if (e.code === 'KeyV') me.third = !me.third;
  if (e.code === 'KeyX' && me.mode === 'pilot') leaveSeat();
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const canvas = renderer.domElement;
let dragLook = null;
canvas.addEventListener('mousedown', (e) => {
  if (!playing || paused || isTouch) return;
  if (document.pointerLockElement !== canvas) { try { const p = canvas.requestPointerLock(); if (p?.catch) p.catch(() => {}); } catch { /* unsupported */ } dragLook = { x: e.clientX, y: e.clientY }; return; }
  if (e.button === 0) fireCannon();
});
addEventListener('mouseup', () => { dragLook = null; });
addEventListener('mousemove', (e) => {
  if (!playing || paused) return;
  if (document.pointerLockElement === canvas) look(e.movementX, e.movementY, 0.0022);
  else if (dragLook) { look(e.clientX - dragLook.x, e.clientY - dragLook.y, 0.004); dragLook = { x: e.clientX, y: e.clientY }; }
});
document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== canvas && playing && !paused && !overlayOpen()) setPaused(true); });
function look(dx, dy, s) { me.yaw -= dx * s; me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch - dy * s)); }
const overlayOpen = () => !$('#results').classList.contains('hidden') || !$('#admin').classList.contains('hidden');

// touch: joystick + look + buttons
function setupTouch() {
  UI.show('#touch', true);
  const joy = $('#joy'), knob = $('#joyKnob');
  let jid = null, c = null;
  joy.addEventListener('pointerdown', (e) => { jid = e.pointerId; joy.setPointerCapture(jid); const r = joy.getBoundingClientRect(); c = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; mv(e); });
  const mv = (e) => { if (e.pointerId !== jid) return; let dx = e.clientX - c.x, dy = e.clientY - c.y; const L = Math.hypot(dx, dy), M = 50; if (L > M) { dx *= M / L; dy *= M / L; } touch.mx = dx / M; touch.my = dy / M; knob.style.transform = `translate(${dx}px, ${dy}px)`; };
  joy.addEventListener('pointermove', mv);
  const end = (e) => { if (e.pointerId !== jid) return; jid = null; touch.mx = touch.my = 0; knob.style.transform = ''; };
  joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
  const looks = new Map();
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') looks.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
  canvas.addEventListener('pointermove', (e) => { const l = looks.get(e.pointerId); if (!l || paused) return; look(e.clientX - l.x, e.clientY - l.y, 0.006); l.x = e.clientX; l.y = e.clientY; });
  const lend = (e) => looks.delete(e.pointerId);
  canvas.addEventListener('pointerup', lend); canvas.addEventListener('pointercancel', lend);
  const tap = (id, fn) => $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); if (playing && !paused) fn(); });
  tap('#tE', interact);
  tap('#tJ', () => { keys.add('Space'); setTimeout(() => keys.delete('Space'), 120); });
  tap('#tV', () => { me.third = !me.third; });
  tap('#tLeave', leaveSeat);
  const hold = (id, v) => { const b = $(id); b.addEventListener('pointerdown', () => { touch.thr = v; }); b.addEventListener('pointerup', () => { touch.thr = 0; }); b.addEventListener('pointercancel', () => { touch.thr = 0; }); };
  hold('#tThrUp', 1); hold('#tThrDn', -1);
  const fire = UI.el('button', { id: 'tF', type: 'button', class: 'hidden' }, '💦');
  $('#tbtns').prepend(fire);
  fire.addEventListener('pointerdown', (e) => { e.preventDefault(); fireCannon(); });
}
if (isTouch) setupTouch();

// ---------------- collision (plane-local AABBs) ----------------
function solids() {
  return ship.colliders.filter((c) => !(c.tag === 'ground' && !sim.groundOn) && !(c.tag && c.tag.endsWith(':open')));
}
function overlaps(p, c, hgt = H) {
  return p.x + R > c.min[0] && p.x - R < c.max[0] && p.y + hgt > c.min[1] && p.y < c.max[1] && p.z + R > c.min[2] && p.z - R < c.max[2];
}
function moveAxis(axis, d, cols) {
  if (!d) return;
  me.pos[axis] += d;
  for (const c of cols) {
    if (!overlaps(me.pos, c)) continue;
    const rise = c.max[1] - me.pos.y;
    if (me.onGround && rise > 0 && rise <= STEP) {
      const up = me.pos.clone(); up.y = c.max[1] + 0.001;
      if (!cols.some((o) => overlaps(up, o))) { me.pos.y = up.y; continue; }
    }
    const i = axis === 'x' ? 0 : 2;
    me.pos[axis] = d > 0 ? c.min[i] - R - 0.001 : c.max[i] + R + 0.001;
  }
}
function updatePlayer(dt) {
  if (me.mode === 'pilot') { me.pos.set(-0.6, 0.48, -14.6); me.vel.set(0, 0, 0); me.onGround = true; return; }
  let fx = 0, fz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) fz -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) fz += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) fx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) fx += 1;
  fx += touch.mx; fz += touch.my;
  const L = Math.hypot(fx, fz); if (L > 1) { fx /= L; fz /= L; }
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') || Math.hypot(touch.mx, touch.my) > 0.95 ? 5.6 : 3.4;
  const s = Math.sin(me.yaw), c = Math.cos(me.yaw);
  const wx = (fx * c + fz * s) * speed, wz = (-fx * s + fz * c) * speed;
  const a = Math.min(1, dt * (me.onGround ? 14 : 3));
  me.vel.x += (wx - me.vel.x) * a; me.vel.z += (wz - me.vel.z) * a;
  if (keys.has('Space') && me.onGround) { me.vel.y = 4.3; me.onGround = false; }
  me.vel.y -= 9.8 * dt;
  if (sim.turb > 0.3 && me.onGround && Math.random() < sim.turb * dt * 2) { me.vel.x += (Math.random() - 0.5) * sim.turb * 2.5; me.vel.z += (Math.random() - 0.5) * sim.turb * 2.5; }
  me.moving = L > 0.1;
  const cols = solids();
  const steps = Math.ceil(dt / 0.012);
  for (let i = 0; i < steps; i++) {
    const h = dt / steps;
    moveAxis('x', me.vel.x * h, cols);
    moveAxis('z', me.vel.z * h, cols);
    me.pos.y += me.vel.y * h;
    let ground = false;
    for (const col of cols) {
      if (!overlaps(me.pos, col)) continue;
      if (me.vel.y <= 0) { me.pos.y = col.max[1]; me.vel.y = 0; ground = true; }
      else { me.pos.y = col.min[1] - H - 0.001; me.vel.y = 0; }
    }
    if (ground) me.onGround = true;
    else if (me.vel.y < -0.5) me.onGround = false;
  }
  // safety nets: fell out of the world, or left outside at departure
  if (me.pos.y < -GEAR_H - 6 || (!sim.groundOn && !sim.inCabin(me.pos))) { teleport('cabin'); UI.toast('You hopped aboard just in time.'); }
}
const SPOTS = { cockpit: [0, 0, -12.2], cabin: [0, 0, -3], cargo: [0, 0, 8], apron: [SPAWN.x, SPAWN.y, SPAWN.z] };
function teleport(spot) {
  if (me.mode === 'pilot') leaveSeat();
  const p = spot === 'apron' && !sim.groundOn ? SPOTS.cabin : SPOTS[spot] || SPOTS.cabin;
  me.pos.set(...p); me.vel.set(0, 0, 0);
}

// ---------------- interaction ----------------
const tmp = new THREE.Vector3();
function eyePos() { return new THREE.Vector3(me.pos.x, me.pos.y + EYE, me.pos.z); }
function lookDir() { return new THREE.Vector3(-Math.sin(me.yaw) * Math.cos(me.pitch), Math.sin(me.pitch), -Math.cos(me.yaw) * Math.cos(me.pitch)); }
function heldItem() { for (const it of sim.items.values()) if (it.heldBy === myId()) return it; return null; }
function findTarget() {
  if (me.mode === 'pilot') return { kind: 'leave', label: 'Leave the pilot seat (X)' };
  const eye = eyePos(), dir = lookDir(), held = heldItem();
  let best = null, bestScore = Infinity;
  const consider = (pos, maxD, t) => {
    tmp.copy(pos).sub(eye); const d = tmp.length(); if (d > maxD) return;
    const dot = tmp.normalize().dot(dir); if (dot < 0.8) return;
    const score = d * (2 - dot) * (t.prio || 1);
    if (score < bestScore) { bestScore = score; best = t; }
  };
  for (const p of sim.pax) {
    if (p.state !== 'seated' || !p.request) continue;
    const head = p.mesh.position.clone(); head.y += 1.1;
    const ok = p.request === 'complaint' ? !held : held && held.type === p.request;
    consider(head, 2.6, { kind: 'serve', pax: p, ok, prio: 0.7, label: p.request === 'complaint' ? (held ? 'Hands full: put it down to talk' : 'Calm the passenger down') : ok ? `Give the ${ITEM_DEFS[p.request].label}` : `Wants: ${ITEM_DEFS[p.request].label}` });
  }
  if (!held) for (const it of sim.items.values()) { if (!it.heldBy) consider(it.mesh.position, 2.4, { kind: 'grab', item: it, label: `Pick up ${ITEM_DEFS[it.type].label}` }); }
  for (const ip of ship.interact) {
    const t = { ...ip };
    if (ip.kind === 'door') t.label = `${ship.doors[ip.door].open ? 'Close' : 'Open'} the ${ip.label}`;
    if (ip.kind === 'dispense' && held) continue;
    if (ip.kind === 'pilot') { const pc = net.room?.pilotCid; if (pc && pc !== myId()) t.label = 'Someone is flying'; }
    consider(ip.pos, ip.kind === 'pilot' ? 2.2 : 1.9, t);
  }
  if (!best && held) return { kind: 'drop', label: `Put down the ${ITEM_DEFS[held.type].label}` };
  return best;
}
function interact() {
  const t = findTarget(), held = heldItem();
  if (!t) return;
  if (t.kind === 'leave') return leaveSeat();
  if (t.kind === 'grab') { act({ k: 'grab', id: t.item.id }); return; }
  if (t.kind === 'drop') return dropHeld(0.9, 0);
  if (t.kind === 'serve') { if (t.ok) act({ k: 'serve', pax: t.pax.id, item: held?.id || null }); else UI.toast(t.label); return; }
  if (t.kind === 'door') {
    if (sim.phase !== 'boarding' && sim.phase !== 'landed' && sim.phase !== 'results') return UI.toast('Not mid-flight! Doors stay closed in the air.', 'warn');
    return act({ k: 'door', d: t.door });
  }
  if (t.kind === 'dispense') return act({ k: 'disp', item: t.item });
  if (t.kind === 'panel') return act({ k: 'fix' });
  if (t.kind === 'pilot') return takeSeat();
}
function dropHeld(dist, throwSpeed) {
  const held = heldItem(); if (!held) return;
  const eye = eyePos(), dir = lookDir();
  const p = eye.clone().addScaledVector(dir, dist); p.y = Math.max(p.y - 0.2, me.pos.y + 0.25);
  if (sim.inCabin(me.pos)) { // never drop through the fuselage wall
    p.x = Math.max(-HALF_W + 0.35, Math.min(HALF_W - 0.35, p.x));
    p.z = Math.max(-15.6, Math.min(12.6, p.z));
    p.y = Math.min(p.y, CEIL - 0.35);
  }
  const v = dir.clone().multiplyScalar(throwSpeed); v.y += throwSpeed ? 1.5 : 0;
  act({ k: 'drop', id: held.id, p: [p.x, p.y, p.z], v: [v.x, v.y, v.z] });
}
function throwHeld() { if (heldItem()) dropHeld(0.7, 6.5); }

/** Apply a gameplay action. Host resolves locally; guests ask the host (and predict grabs/drops). */
function act(a) {
  if (net.inRoom && !net.isHost) {
    net.send({ t: 'act', a });
    if (a.k === 'grab') { const it = sim.items.get(a.id); if (it && !it.heldBy) it.heldBy = myId(); }
    if (a.k === 'drop') { const it = sim.items.get(a.id); if (it) { it.heldBy = null; it.mesh.position.set(...a.p); it.target = { p: it.mesh.position.clone(), q: it.mesh.quaternion.clone() }; } }
    return;
  }
  applyAct(myId(), a);
}
const holderOf = (cid) => [...sim.items.values()].find((i) => i.heldBy === cid);
function applyAct(cid, a) {
  if (!a || typeof a !== 'object') return;
  switch (a.k) {
    case 'grab': if (!holderOf(cid)) sim.grab(String(a.id), cid); break;
    case 'drop': if (Array.isArray(a.p) && a.p.length === 3) sim.drop(String(a.id), cid, a.p.map(Number), Array.isArray(a.v) ? a.v.map(Number) : [0, 0, 0]); break;
    case 'serve': {
      const it = a.item ? sim.items.get(String(a.item)) : null;
      if (it && it.heldBy !== cid) break;
      if (sim.serve(Number(a.pax), it ? it.type : null) && it) sim.removeItem(it.id);
      break;
    }
    case 'door': if (['front', 'cargo'].includes(a.d) && ['boarding', 'landed', 'results'].includes(sim.phase)) sim.setDoor(a.d, !ship.doors[a.d].open); break;
    case 'fix': sim.fixPanel(); break;
    case 'disp': {
      if (!['water', 'snack', 'blanket'].includes(a.item) || holderOf(cid)) break;
      const ip = ship.interact.find((i) => i.item === a.item);
      const it = sim.spawnItem(a.item, [ip.pos.x - 0.4, ip.pos.y, ip.pos.z]);
      sim.grab(it.id, cid);
      break;
    }
    case 'reset': if (sim.phase === 'results') restartFlight(); break;
  }
}

// ---------------- pilot seat ----------------
async function takeSeat() {
  if (heldItem()) return UI.toast('Put down what you are carrying first.');
  if (net.inRoom) {
    if (net.room.pilotCid && net.room.pilotCid !== myId()) return UI.toast('Someone else is flying.');
    net.send({ t: 'pilot', on: true });
  }
  me.mode = 'pilot'; me.yaw = 0; me.pitch = -0.12;
  UI.toast(sim.phase === 'boarding' ? 'Captain\'s seat. Press R to add throttle when everyone is aboard. Departing closes the doors.' : 'You have the controls.');
}
function leaveSeat() {
  if (me.mode !== 'pilot') return;
  me.mode = 'walk'; me.pos.set(-0.2, 0, -13.6); me.yaw = Math.PI;
  if (net.inRoom) net.send({ t: 'pilot', on: false });
  if (!sim.flight.onGround) UI.toast('Autopilot holds the plane level while nobody is flying.');
}
const amPilot = () => me.mode === 'pilot' && (!net.inRoom || net.room?.pilotCid === myId());
const someonePilots = () => (net.inRoom ? !!net.room?.pilotCid : me.mode === 'pilot');

// ---------------- Wave Cannon (fictional Developer gear) ----------------
function fireCannon() {
  if (!me.cannon || heldItem() || me.mode === 'pilot' || !net.inRoom) return;
  const o = eyePos(), d = lookDir();
  net.send({ t: 'admin', cmd: 'fire', args: { o: [o.x, o.y, o.z], d: [d.x, d.y, d.z] } });
}
const splashes = [];
function splash(o, d) {
  const g = new THREE.Group(); ship.plane.add(g);
  const mat = new THREE.MeshBasicMaterial({ color: 0x5ad1ff, transparent: true, opacity: 0.85 });
  const geo = new THREE.SphereGeometry(0.09, 6, 4);
  const drops = [];
  for (let i = 0; i < 70; i++) {
    const m = new THREE.Mesh(geo, mat); m.position.set(...o); g.add(m);
    const v = new THREE.Vector3(...d).multiplyScalar(9 + Math.random() * 6).add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.2) * 3, (Math.random() - 0.5) * 3));
    drops.push({ m, v });
  }
  splashes.push({ g, drops, t: 0, mat });
}
function updateSplashes(dt) {
  for (const s of splashes) {
    s.t += dt; s.mat.opacity = Math.max(0, 0.85 - s.t * 0.7);
    for (const p of s.drops) { p.v.y -= 9.8 * dt; p.m.position.addScaledVector(p.v, dt); if (p.m.position.y < 0.05 && Math.abs(p.m.position.x) < HALF_W) { p.m.position.y = 0.05; p.v.multiplyScalar(0.3); } }
  }
  while (splashes.length && splashes[0].t > 1.3) { const s = splashes.shift(); ship.plane.remove(s.g); }
}

// ---------------- remote players ----------------
const remotes = new Map();
function syncRemotes(room) {
  const ids = new Set(room ? room.players.map((p) => p.cid) : []);
  for (const [cid, r] of remotes) if (!ids.has(cid) || cid === myId()) { ship.plane.remove(r.mesh); remotes.delete(cid); }
  if (!room) return;
  for (const p of room.players) {
    if (p.cid === myId() || remotes.has(p.cid)) continue;
    const mesh = makeCharacter({ shirt: new THREE.Color(RANK_COLORS[p.role] || '#ffffff').getHex(), pants: 0x1b2333 });
    mesh.add(nameTag(p.displayName || p.username, p.role));
    ship.plane.add(mesh);
    const r = { mesh, target: new THREE.Vector3(...(p.state?.p || SPOTS.apron)), ry: 0, mode: 'walk', moving: false, info: p };
    mesh.position.copy(r.target);
    remotes.set(p.cid, r);
  }
}
function updateRemotes(dt) {
  for (const r of remotes.values()) {
    r.mesh.position.lerp(r.target, Math.min(1, dt * 12));
    let d = r.ry - r.mesh.rotation.y; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    r.mesh.rotation.y += d * Math.min(1, dt * 12);
    animateCharacter(r.mesh, dt, { moving: r.moving, sitting: r.mode === 'pilot', carrying: !!r.held });
  }
}

// ---------------- networking ----------------
net.addEventListener('room', (e) => {
  const room = net.room;
  syncRemotes(room);
  UI.roomInfo(room, myId(), UI.rankBadge);
  const wasHost = sim.host;
  sim.host = net.isHost;
  if (!wasHost && sim.host) { // host migration: take over the simulation
    for (const it of sim.items.values()) if (!it.heldBy && !it.inWorld) { it.body.position.copy(it.mesh.position); it.body.quaternion.copy(it.mesh.quaternion); it.body.velocity.set(0, 0, 0); sim.world.addBody(it.body); it.inWorld = true; }
    for (const p of sim.pax) if (p.target) p.mesh.position.copy(p.target);
    if (room.players.length > 1) UI.toast('You are now the room host.');
  }
  if (wasHost && !sim.host) { sim.seed = -1; }
  if (me.mode === 'pilot' && room.pilotCid !== myId()) me.mode = 'walk';
  if (!$('#admin').classList.contains('hidden')) renderAdmin();
});
net.addEventListener('st', (e) => { const r = remotes.get(e.detail.cid); if (!r) return; const s = e.detail.s; r.target.set(...s.p); r.ry = s.ry; r.mode = s.mode; r.moving = s.moving; r.held = s.held; });
net.addEventListener('world', (e) => { if (sim.host) return; sim.applySnapshot(e.detail.w); });
net.addEventListener('plane', (e) => { if (amPilot()) return; sim.applyPlane(e.detail.s); });
net.addEventListener('act', (e) => { if (sim.host) applyAct(e.detail.cid, e.detail.a); });
net.addEventListener('event', (e) => { const ev = e.detail.e; if (ev?.toast) UI.toast(String(ev.toast).slice(0, 200), ev.kind === 'warn' ? 'warn' : 'info'); });
net.addEventListener('left', (e) => { if (sim.host) for (const it of sim.items.values()) if (it.heldBy === e.detail.cid) sim.drop(it.id, it.heldBy, [it.mesh.position.x, it.mesh.position.y, it.mesh.position.z]); });
net.addEventListener('fx', (e) => {
  const { cmd, args, by } = e.detail;
  const who = `${by.username}`;
  if (cmd === 'spawn' && sim.host) {
    const src = by.cid === myId() ? me.pos : remotes.get(by.cid)?.target || me.pos;
    for (let i = 0; i < args.count; i++) { const dir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5); sim.spawnItem(args.item, [src.x + dir.x, src.y + 1.6 + i * 0.4, src.z + dir.z]); }
  }
  if (cmd === 'spawn') UI.toast(`${who} spawned ${ITEM_DEFS[args.item]?.label || args.item}.`);
  if (cmd === 'weather') { if (sim.host) sim.weather = args.weather; UI.toast(`${who} set the weather to ${args.weather}.`, args.weather === 'storm' ? 'warn' : 'info'); }
  if (cmd === 'emergency' && sim.host) sim.emergency(args.scenario, args.action);
  if (cmd === 'emergency' && args.action === 'stop') UI.toast(`${who} ended the ${args.scenario.replace('_', ' ')} scenario.`);
  if (cmd === 'teleport' && args.cid === myId()) { teleport(args.to); UI.toast(`Teleported to ${args.to}.`); }
  if (cmd === 'npc') { if (sim.host) sim.npcAction(args.action); UI.toast(`${who}: passengers ${args.action}!`); }
  if (cmd === 'gear' && args.cid === myId()) { me.cannon = true; $('#tF')?.classList.remove('hidden'); UI.toast('🌊 Wave Cannon equipped: click with empty hands to splash.', 'info'); }
  if (cmd === 'fire') { splash(args.o, args.d); if (sim.host) sim.waveImpulse(args.o, args.d); }
});
net.addEventListener('admin_denied', (e) => { $('#admMsg').textContent = `Denied: ${e.detail.reason}`; });
net.addEventListener('admin_ok', (e) => { if (e.detail.cmd !== 'fire') $('#admMsg').textContent = `Done: ${e.detail.cmd}`; });
net.addEventListener('kicked', (e) => { quitToMenu(`You were removed from the room by ${e.detail.by}.`); });
net.addEventListener('error', (e) => { if (e.detail.code === 'seat_taken') { me.mode = 'walk'; UI.toast('Someone else is flying.'); } });
net.addEventListener('close', () => { if (playing && net.wasInRoom) { UI.toast('Disconnected from the co-op room. Continuing solo.', 'warn'); sim.host = true; syncRemotes(null); UI.roomInfo(null); } });

let sendT = 0, worldT = 0;
function netTick(dt) {
  if (!net.inRoom) return;
  net.wasInRoom = true;
  sendT += dt; worldT += dt;
  if (sendT > 1 / 15) {
    sendT = 0;
    const held = heldItem();
    net.send({ t: 'st', s: { p: [me.pos.x, me.pos.y, me.pos.z], ry: me.yaw, pt: me.pitch, held: held ? held.id : null, mode: me.mode, moving: me.moving } });
    if (amPilot()) net.send({ t: 'plane', s: sim.planeState() });
  }
  if (net.isHost && worldT > 0.1) { worldT = 0; net.send({ t: 'world', w: sim.snapshot(!net.room.pilotCid) }); }
}

// ---------------- flight ----------------
let turbPhase = 0;
function updateFlight(dt) {
  const f = sim.flight;
  turbPhase += dt;
  const turbV = sim.turb ? sim.turb * (Math.sin(turbPhase * 6.3) * 2.2 + Math.sin(turbPhase * 2.1) * 1.5) - (sim.activeEvents || sim.events.filter((e) => !e.done).map((e) => [e.id])).some((e) => e[0] === 'air_pocket' || e.id === 'air_pocket') * 6 : 0;
  if (amPilot()) {
    const inp = {
      pitch: (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - touch.my,
      roll: (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + touch.mx,
      throttleDelta: (keys.has('KeyR') || keys.has('PageUp') ? 1 : 0) - (keys.has('KeyF') || keys.has('PageDown') ? 1 : 0) + touch.thr,
    };
    if (sim.phase !== 'results') stepFlight(f, inp, dt, turbV);
  } else if (sim.host && !someonePilots()) {
    // autopilot: wings level, hold pitch (or slow down on the ground)
    const inp = { pitch: f.onGround ? 0 : Math.max(-1, Math.min(1, (0.03 - f.pitch) * 3 - f.vs * 0.05)), roll: f.onGround ? 0 : Math.max(-1, Math.min(1, -f.bank * 2)), throttleDelta: f.onGround && f.speed > 0 ? -1 : 0 };
    if (sim.phase !== 'results' && (f.speed > 0 || !f.onGround)) stepFlight(f, inp, dt, turbV);
  } else if (!f.onGround) {
    const horiz = f.speed * Math.cos(f.pitch); // extrapolate between network updates
    f.x += -Math.sin(f.yaw) * horiz * dt; f.z += -Math.cos(f.yaw) * horiz * dt; f.y += f.vs * dt;
  }
  // place the aircraft
  ship.plane.position.set(f.x, f.y, f.z);
  const shake = sim.turb ? sim.turb * 0.012 : 0;
  ship.plane.rotation.set(f.pitch + (Math.random() - 0.5) * shake, f.yaw, -f.bank + (Math.random() - 0.5) * shake, 'YXZ');
  // local gravity: items slide aft when climbing
  const g = new THREE.Vector3(0, -9.82, 0).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(f.pitch, 0, 0, 'YXZ')).invert());
  sim.world.gravity.set(g.x, g.y, g.z);
  ship.gear.visible = f.onGround || f.y < 80;
  ship.throttleLever.rotation.x = -f.throttle * 0.9;
}

// ---------------- camera ----------------
function updateCamera() {
  ship.plane.updateMatrixWorld();
  const f = sim.flight;
  if (me.mode === 'pilot' && me.third) {
    camera.position.set(0, 7, 34); camera.lookAt(ship.plane.localToWorld(new THREE.Vector3(0, 1, -10)));
    return;
  }
  const eye = me.mode === 'pilot' ? new THREE.Vector3(-0.6, 1.25, -14.55) : eyePos();
  if (me.third && me.mode !== 'pilot') {
    const back = lookDir().multiplyScalar(-1);
    const cols = solids();
    let dist = 2.8, p = eye.clone();
    for (; dist > 0.3; dist -= 0.15) {
      p = eye.clone().addScaledVector(back, dist); p.y += 0.25;
      if (!cols.some((c) => p.x > c.min[0] - 0.12 && p.x < c.max[0] + 0.12 && p.y > c.min[1] - 0.12 && p.y < c.max[1] + 0.12 && p.z > c.min[2] - 0.12 && p.z < c.max[2] + 0.12)) break;
    }
    camera.position.copy(p);
    camera.lookAt(ship.plane.localToWorld(eye.clone().addScaledVector(lookDir(), 2)));
  } else {
    camera.position.copy(eye);
    camera.rotation.set(me.pitch, me.yaw, 0, 'YXZ');
  }
  if (sim.turb) { camera.position.x += (Math.random() - 0.5) * sim.turb * 0.03; camera.position.y += (Math.random() - 0.5) * sim.turb * 0.03; }
  void f;
}

// ---------------- weather / lights ----------------
let rain = null, flashT = 0;
function updateWeather(dt) {
  const storm = sim.weather === 'storm';
  env.sky.material.uniforms.dim.value += ((storm ? 0.38 : 1) - env.sky.material.uniforms.dim.value) * Math.min(1, dt * 2);
  scene.fog.far = storm ? 3500 : 14000; scene.fog.near = storm ? 150 : 800;
  scene.fog.color.setHex(storm ? 0x4a5468 : 0xbfe6ff);
  env.sun.intensity = storm ? 0.5 : 1.6;
  flashT -= dt;
  if (storm && Math.random() < dt * 0.15) flashT = 0.12;
  env.hemi.intensity = flashT > 0 ? 4 : storm ? 0.8 : 1.4;
  if (storm && !rain) {
    const geo = new THREE.BufferGeometry(); const n = 1500, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = (Math.random() - 0.5) * 60; a[i * 3 + 1] = Math.random() * 30 - 8; a[i * 3 + 2] = (Math.random() - 0.5) * 70; }
    geo.setAttribute('position', new THREE.BufferAttribute(a, 3));
    rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xaabbdd, size: 0.08 }));
    ship.plane.add(rain);
  }
  if (rain) {
    rain.visible = storm;
    const a = rain.geometry.attributes.position.array;
    for (let i = 1; i < a.length; i += 3) { a[i] -= dt * 22; if (a[i] < -8) a[i] += 30; }
    for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i]) < HALF_W + 0.3 && a[i + 1] > -0.5 && a[i + 1] < CEIL + 0.5 && a[i + 2] > -17 && a[i + 2] < 14) a[i + 1] = CEIL + 1;
    rain.geometry.attributes.position.needsUpdate = true;
  }
  const warn = (sim.host ? sim.events.filter((e) => !e.done && e.fix).length : (sim.activeEvents || []).filter((e) => e[0] === 'engine_warning' || e[0] === 'cabin_pressure').length) > 0;
  ship.warnLight.intensity = warn ? (Math.sin(performance.now() / 180) > 0 ? 14 : 0) : 0;
  ship.panelLight.material = warn ? warnMat : okMat;
}
const warnMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a }), okMat = new THREE.MeshBasicMaterial({ color: 0x3ddc84 });

// ---------------- held items placement ----------------
function placeHeld() {
  for (const it of sim.items.values()) {
    if (!it.heldBy) continue;
    let pos, yaw;
    if (it.heldBy === myId()) {
      if (me.third) { pos = new THREE.Vector3(me.pos.x, me.pos.y + 1.15, me.pos.z).addScaledVector(new THREE.Vector3(-Math.sin(me.yaw), 0, -Math.cos(me.yaw)), 0.5); }
      else pos = eyePos().addScaledVector(lookDir(), 0.8).add(new THREE.Vector3(Math.cos(me.yaw) * 0.32, -0.45, -Math.sin(me.yaw) * 0.32));
      yaw = me.yaw;
    } else {
      const r = remotes.get(it.heldBy);
      if (!r) continue;
      pos = r.mesh.position.clone().add(new THREE.Vector3(-Math.sin(r.mesh.rotation.y) * 0.5, 1.15, -Math.cos(r.mesh.rotation.y) * 0.5));
      yaw = r.mesh.rotation.y;
    }
    it.mesh.position.copy(pos); it.mesh.rotation.set(0, yaw, 0);
  }
}

// ---------------- objectives / HUD ----------------
function updateHud() {
  const c = sim.counts || { loaded: 0, boarded: 0, pax: 0, bags: 0, loose: 0 };
  const f = sim.flight;
  const evs = sim.host ? sim.events.filter((e) => !e.done).map((e) => [e.id]) : sim.activeEvents || [];
  const rows = [];
  let title = 'BOARDING';
  if (sim.phase === 'boarding') {
    rows.push({ text: `Load bags into the cargo hold: ${c.loaded}/${c.bags}`, state: c.loaded >= c.bags && c.bags ? 'done' : '' });
    rows.push({ text: `Passengers seated: ${c.boarded}/${c.pax}`, state: c.boarded >= c.pax ? 'done' : '' });
    rows.push({ text: `Close the doors (${ship.doors.front.open ? 'front open' : 'front ✓'}, ${ship.doors.cargo.open ? 'cargo open' : 'cargo ✓'})`, state: !ship.doors.front.open && !ship.doors.cargo.open ? 'done' : '' });
    rows.push({ text: 'Pilot: take the captain\'s seat and throttle up (R)' });
  } else if (sim.phase === 'results') { title = 'FLIGHT COMPLETE'; }
  else {
    title = { taxi: 'TAKEOFF ROLL', climb: 'CLIMB', cruise: 'CRUISE', approach: 'APPROACH', landed: 'LANDED' }[sim.phase] || sim.phase.toUpperCase();
    rows.push({ text: `Fly to Coral Point (CRP): ${(distTo(f, DEST) / 1000).toFixed(1)} km` });
    const reqs = sim.pax.filter((p) => p.request).length;
    rows.push({ text: reqs ? `${reqs} passenger request${reqs > 1 ? 's' : ''} waiting (galley up front)` : 'Passengers are content', state: reqs ? '' : 'done' });
    if (c.loose) rows.push({ text: `${c.loose} loose bag${c.loose > 1 ? 's' : ''} in the cabin`, state: 'warn' });
    for (const [id] of evs) {
      if (id === 'engine_warning') rows.push({ text: 'ENGINE WARNING: fix at the panel (cargo hold)', state: 'warn' });
      if (id === 'cabin_pressure') rows.push({ text: 'PRESSURE WARNING: fix at the panel (cargo hold)', state: 'warn' });
      if (id === 'turbulence' || id === 'air_pocket') rows.push({ text: 'Turbulence: hold on!', state: 'warn' });
    }
    if (sim.emergencyLanding) rows.push({ text: `EMERGENCY LANDING: ${Math.max(0, Math.round(sim.emergencyLanding.limit - sim.emergencyLanding.t))} s left`, state: 'warn' });
    if (sim.weather === 'storm') rows.push({ text: 'Storm conditions', state: 'warn' });
  }
  UI.objectives(title, rows);
  const t = playing && !paused ? findTarget() : null;
  UI.prompt(t && t.kind !== 'leave' ? t.label : null);
  const h = heldItem();
  UI.held(h ? `Holding: ${ITEM_DEFS[h.type].label}  ·  E place · Q throw` : me.cannon ? '🌊 Wave Cannon ready (click)' : null);
  const pilot = me.mode === 'pilot';
  UI.show('#fhud', pilot);
  UI.show('#cross', !pilot);
  UI.show('#tFlight', pilot && isTouch);
  if (pilot) {
    const warnings = [];
    if (f.stall && !f.onGround) warnings.push('STALL');
    if (f.engineFail) warnings.push('ENGINE');
    if (!f.onGround && f.y < 60 && f.vs < -6) warnings.push('SINK RATE');
    if (sim.phase === 'approach' && f.y > 500) warnings.push('TOO HIGH');
    UI.flightHud(f, { kt: KT, ft: FT, distKm: distTo(f, DEST) / 1000, bearing: relBearing(f, DEST), warnings });
  }
  if (sim.results && !resultsShown) { resultsShown = true; if (me.mode === 'pilot') leaveSeat(); UI.results(sim.results); document.exitPointerLock?.(); }
}

// ---------------- menus ----------------
function setPaused(v) { paused = v; UI.show('#pause', v); if (v) { keys.clear(); document.exitPointerLock?.(); $('#pauseRoom').textContent = net.inRoom ? `Co-op room ${net.room.code}: share this code with friends.` : 'Solo flight (the world keeps going in co-op).'; } }
function togglePause() { if (!$('#admin').classList.contains('hidden')) return toggleAdmin(false); if (!$('#results').classList.contains('hidden')) return; setPaused(!paused); }
function renderAdmin() { UI.buildAdmin({ you: net.you || { role: myRole, permissions: [] }, room: net.room, myCid: myId(), send: (cmd, args) => { $('#admMsg').textContent = '…'; net.admin(cmd, args).catch(() => {}); } }); }
function toggleAdmin(force) {
  if (!playing) return;
  const open = force ?? $('#admin').classList.contains('hidden');
  if (open && !(net.you?.permissions || []).includes('admin.panel')) return UI.toast('Staff tools are for Trusted, Admin and Developer ranks.');
  UI.show('#admin', open);
  if (open) { renderAdmin(); document.exitPointerLock?.(); keys.clear(); }
}
$('#admClose').addEventListener('click', () => toggleAdmin(false));
$('#btnAdmin').addEventListener('click', () => toggleAdmin());
$('#btnPause').addEventListener('click', () => setPaused(true));
$('#bResume').addEventListener('click', () => setPaused(false));
$('#bCam').addEventListener('click', () => { me.third = !me.third; setPaused(false); });
$('#bRestart').addEventListener('click', () => { setPaused(false); if (!net.inRoom || net.isHost) restartFlight(); else UI.toast('Only the room host can restart.'); });
$('#bQuit').addEventListener('click', () => quitToMenu());
$('#bAgain').addEventListener('click', () => { UI.show('#results', false); if (!net.inRoom || net.isHost) restartFlight(); else act({ k: 'reset' }); });
$('#bResMenu').addEventListener('click', () => quitToMenu());

function restartFlight() { sim.host = !net.inRoom || net.isHost; sim.reset(Math.floor(Math.random() * 1e9)); }
function respawn() { if (me.mode === 'pilot') leaveSeat(); me.pos.copy(SPAWN); me.vel.set(0, 0, 0); me.yaw = -Math.PI / 2; me.pitch = -0.15; resultsShown = false; UI.show('#results', false); }
function quitToMenu(msg) {
  if (net.inRoom) net.leave();
  syncRemotes(null); UI.roomInfo(null);
  playing = false; setPaused(false); UI.show('#admin', false); UI.show('#results', false); UI.show('#hud', false); UI.show('#menu', true);
  sim.host = true; restartFlight(); respawn();
  if (msg) { $('#menuErr').textContent = msg; UI.show('#menuErr', true); }
}
function start() {
  UI.show('#menu', false); UI.show('#hud', true); UI.show('#menuErr', false);
  playing = true; respawn();
  UI.show('#btnAdmin', !!net.inRoom && (net.you?.permissions || []).includes('admin.panel'));
  UI.toast(net.inRoom ? `Co-op room ${net.room.code} — share the code!` : 'Solo flight. Load the bags, board everyone, then take the captain\'s seat.');
}
$('#bSolo').addEventListener('click', () => { if (net.inRoom) net.leave(); sim.host = true; restartFlight(); start(); });
async function goOnline(code) {
  const err = $('#menuErr'); UI.show('#menuErr', false);
  try {
    if (!net.connected) await net.connect();
    if (code) { sim.host = false; sim.seed = -1; await net.join(code); } else { sim.host = true; restartFlight(); await net.create(); }
    start();
  } catch (e) { err.textContent = e.message || String(e); UI.show('#menuErr', true); }
}
$('#bCreate').addEventListener('click', () => goOnline());
$('#bJoin').addEventListener('click', () => { const c = $('#joinCode').value.trim().toUpperCase(); if (c.length === 5) goOnline(c); else { $('#menuErr').textContent = 'Room codes have 5 letters.'; UI.show('#menuErr', true); } });
$('#joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#bJoin').click(); });

const user = await Net.me();
if (user) {
  myRole = user.role;
  $('#meLine').replaceChildren('Signed in as ', UI.rankBadge(user.role), UI.el('span', { class: `name-${user.role.toLowerCase()}` }, user.displayName || user.username), '. Co-op rooms use your Batlas rank.');
  $('#bCreate').disabled = false; $('#bJoin').disabled = false;
} else {
  $('#meLine').replaceChildren('Playing as a guest (solo). ', UI.el('a', { href: '/login?next=/play/sky-crew', class: 'back' }, 'Sign in'), ' to play co-op with friends.');
}
const qs = new URLSearchParams(location.search);
if (qs.get('room') && user) $('#joinCode').value = qs.get('room').toUpperCase().slice(0, 5);

// ---------------- main loop ----------------
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  if (sim.seed !== seenSeed) { seenSeed = sim.seed; if (playing) respawn(); }
  if (playing && !paused) updatePlayer(dt);
  updateFlight(dt);
  if (sim.host) sim.update(dt, { onDepart() {} });
  else sim.follow(dt);
  sim.animate(dt);
  placeHeld();
  updateRemotes(dt);
  updateSplashes(dt);
  updateWeather(dt);
  // my own body (visible in third person)
  myAvatar.visible = me.third && me.mode !== 'pilot';
  myAvatar.position.copy(me.pos); myAvatar.rotation.y = me.yaw;
  animateCharacter(myAvatar, dt, { moving: me.moving && me.onGround, carrying: !!heldItem() });
  updateCamera();
  if (playing) { updateHud(); netTick(dt); }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
UI.show('#loading', false);
requestAnimationFrame(frame);

// ---------------- test / debug hooks (used by the automated browser tests) ----------------
window.skyCrew = {
  ready: true,
  state: () => ({ playing, paused, phase: sim.phase, host: sim.host, me: { x: me.pos.x, y: me.pos.y, z: me.pos.z, mode: me.mode, onGround: me.onGround }, held: heldItem()?.type || null, counts: sim.counts, flight: { ...sim.planeState() }, room: net.room && { code: net.room.code, players: net.room.players.map((p) => ({ username: p.username, role: p.role })) }, remotes: [...remotes.values()].map((r) => ({ username: r.info.username, x: r.mesh.position.x, z: r.mesh.position.z })), results: sim.results }),
  teleport: (x, y, z) => { me.pos.set(x, y, z); me.vel.set(0, 0, 0); },
  look: (yaw, pitch) => { me.yaw = yaw; me.pitch = pitch; },
  lookAt: (x, y, z) => { const e = eyePos(); const d = new THREE.Vector3(x, y, z).sub(e); me.yaw = Math.atan2(-d.x, -d.z); me.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); },
  items: () => [...sim.items.values()].map((i) => ({ id: i.id, type: i.type, x: i.mesh.position.x, y: i.mesh.position.y, z: i.mesh.position.z, heldBy: i.heldBy })),
  target: () => { const t = findTarget(); return t && { kind: t.kind, label: t.label }; },
  interact, takeSeat, leaveSeat,
  key: (code, down) => (down ? keys.add(code) : keys.delete(code)),
  third: (v) => { me.third = v; },
  setFlight: (o) => Object.assign(sim.flight, o),
  dest: () => ({ ...DEST }),
  debug: {
    sitAll: () => sim.npcAction('sit'),
    trigger: (id) => sim.trigger(id),
    request: (i, item) => { const p = sim.pax[i]; p.request = item; p.reqT = 0; return { x: p.mesh.position.x, z: p.mesh.position.z }; },
    score: () => ({ ...sim.score }),
    events: () => sim.events.filter((e) => !e.done).map((e) => e.id),
    interactPoint: (id) => { const p = ship.interact.find((i) => i.id === id).pos; return { x: p.x, y: p.y, z: p.z }; },
  },
};
