// Sky Crew v0 — bootstrap, input, player controller, camera, networking glue.
import { api } from '/js/common.js';
import * as THREE from '../../vendor/three.module.js';
import { buildPlane, buildWorld, GEAR_H, HALF_W, CEIL, ORIGIN, DEST, ROUTES, setRoute, Z_TAIL, Z_NOSE } from './world.js';
import { Sim, ITEM_DEFS } from './sim.js';
import { stepFlight, KT, FT, distTo, relBearing, glidePath } from './flight.js';
import { Audio } from './audio.js';
import { makeCrew, animateCharacter, nameTag, RANK_COLORS } from './characters.js';
import { buildTerminal, TERM_SPAWN, STATIONS, stepIdx } from './terminal.js';
import { wallet, loadWallet, renderShop, fmtC, owns } from './shop.js';
import { CLASS_INFO, turbulenceFactor, glideWindow, serveReach, fixReach, carryLimit, tailwind, PERK } from './perks.js';
import { Net } from './net.js';
import * as UI from './ui.js';
import { Gadgets } from './gadgets.js';
import { buildPanel } from './devpanel.js';
import { initControls, openEditor, resetLayout, ctl, controlsDebug, applyLayout } from './controls.js';
import { installRotateHint, shouldShowRotateHint } from './orient.js';

const $ = (s) => document.querySelector(s);
const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && /iPad|iPhone|Android|Mobile/i.test(navigator.userAgent);
if (isTouch) document.body.classList.add('touch');

// ---------------- quality / renderer / scene ----------------
// auto: iPads and phones get "medium" (small soft shadow map, no MSAA), desktops "high".
const QKEY = 'skycrew.quality';
const qualityPref = ['auto', 'low', 'medium', 'high'].includes(localStorage.getItem(QKEY)) ? localStorage.getItem(QKEY) : 'auto';
const lowEnd = isTouch && (navigator.hardwareConcurrency || 4) <= 2;
const quality = qualityPref !== 'auto' ? qualityPref : lowEnd ? 'low' : isTouch ? 'medium' : 'high';
const Q = { low: { aa: false, pr: 1, shadow: 0 }, medium: { aa: !isTouch, pr: isTouch ? 1.5 : 1.5, shadow: 1024 }, high: { aa: true, pr: 2, shadow: 2048 } }[quality];
const renderer = new THREE.WebGLRenderer({ antialias: Q.aa, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pr));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
if (Q.shadow) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap; }
$('#view').append(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 40000);
const env = buildWorld(scene, { quality });
if (Q.shadow) { env.sun.castShadow = true; env.sun.shadow.mapSize.set(Q.shadow, Q.shadow); }
const SUN_OFF = new THREE.Vector3(350, 550, 250).normalize().multiplyScalar(600);
const ship = buildPlane();
const terminal = buildTerminal(ship); // pre-flight airport behind the parked plane (before the physics world is built)
// cabin key light: soft shadows from seats/bins/people (1024 map on iPad 'medium', 2048 on desktop 'high')
if (Q.shadow) { const k = ship.cabin.key; k.castShadow = true; k.shadow.mapSize.set(Q.shadow, Q.shadow / 2); if (quality !== 'high') k.shadow.autoUpdate = false; }
let keyShadowT = 0; // medium (iPad): the cabin shadow map is refreshed at ~12 Hz instead of every frame
const audio = new Audio();
scene.add(ship.plane);
ship.plane.add(camera);
function resizeView() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / Math.max(1, innerHeight);
  camera.updateProjectionMatrix();
}
// Phone portrait overlay. Installed before the first await so it is correct while the world loads,
// and so a Safari rotation (visualViewport / orientationchange) resizes the view even when the
// layout viewport's resize event is late or missing.
const rotateHint = installRotateHint(window, () => { resizeView(); applyLayout(); });

const eventsConfig = await (await fetch('/play/sky-crew/events.json')).json();
const net = new Net();
const sim = new Sim({ ship, eventsConfig, onToast: (m, k, sfx) => { UI.toast(m, k); playSfx(sfx || (k === 'warn' ? 'warn' : null)); if (net.inRoom && net.isHost) net.send({ t: 'event', e: { toast: m, kind: k, sfx } }); } });
const SFX = new Set(['ding', 'click', 'warn', 'gear', 'crash', 'serve', 'fix', 'beep', 'boop', 'stamp']);
function playSfx(name) { if (name && SFX.has(name) && playing) audio.play(name); }
sim.onRoute = () => refreshRouteUi();

// ---------------- player ----------------
const R = 0.3, H = 1.7, EYE = 1.58, STEP = 0.45;
const SPAWN = new THREE.Vector3(7.5, -GEAR_H, 17.5); // on the apron, behind and right of the aircraft, facing the rear door
const me = { pos: SPAWN.clone(), vel: new THREE.Vector3(), yaw: 0.45, pitch: -0.05, onGround: false, mode: 'walk', third: false, moving: false, frozen: false, flying: false };
const DEFAULT_OUTFIT = { outfit: 'captain', hat: 'captain', color: 0, skin: 1 };
let myOutfit = (() => { try { return { ...DEFAULT_OUTFIT, ...JSON.parse(localStorage.getItem('skycrew.outfit') || 'null') }; } catch { return { ...DEFAULT_OUTFIT }; } })();
let myClass = null; // class for the next flight (server-checked in rooms)
let myAvatar = makeCrew(myOutfit);
ship.plane.add(myAvatar);
let myCrew = null; // lobby pick: pilot | copilot | cabin | cargo (solo: null = do everything)
function dressMe() { ship.plane.remove(myAvatar); myAvatar = makeCrew(myOutfit); ship.plane.add(myAvatar); if (gadgets) gadgets.rebuild(myId()); }
let gadgets = null; // Developer gadgets (created once the remote-player table exists)
let myCid = 'solo', myRole = null, playing = false, paused = false, seenSeed = sim.seed, resultsShown = false;
const myId = () => (net.inRoom ? net.cid : 'solo');

// ---------------- input ----------------
const keys = new Set();
const touch = { mx: 0, my: 0, thr: 0, run: false };
/** A text field the player can actually see and type in. A hidden one (the room-code box after the menu closed)
 *  must not swallow game keys: on a Mac or a keyboard iPad it kept focus and E/WASD did nothing. */
const typingIn = (el) => !!el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && !el.disabled && el.offsetParent !== null && !el.closest('.hidden');
/** Leave menu fields when the game/lobby takes over, so keys go to the game. */
function releaseMenuFocus() { const el = document.activeElement; if (el && el !== document.body && !typingIn(el)) el.blur(); if (el && el.closest?.('#menu, #lobby') && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) el.blur(); }
addEventListener('keydown', (e) => {
  if (typingIn(e.target)) return;
  if (e.code === 'F2') { e.preventDefault(); toggleAdmin(); return; }
  if (!playing) return;
  if (e.code === 'Escape') { togglePause(); return; }
  if (paused) return;
  keys.add(e.code);
  if (e.code === 'KeyE') interact();
  if (e.code === 'KeyQ') throwHeld();
  if (e.code === 'KeyV') me.third = !me.third;
  if (e.code === 'Enter' && net.inRoom) { e.preventDefault(); openChat(); return; }
  if (me.mode === 'walk' && gadgets.tool() && (e.code === 'KeyF' || e.code === 'KeyT')) gadgets.fire(e.code === 'KeyT');
  if (e.code === 'KeyX' && (me.mode === 'pilot' || me.mode === 'copilot')) leaveSeat();
  if (me.mode === 'pilot' || me.mode === 'copilot') {
    const sys = { KeyL: 'lights', KeyB: 'seatbelt', KeyN: 'announce', KeyG: 'gear' }[e.code];
    if (sys) systemAct(sys);
  }
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const canvas = renderer.domElement;
let dragLook = null;
canvas.addEventListener('mousedown', (e) => {
  if (!playing || paused || isTouch) return;
  if (document.pointerLockElement !== canvas) { try { const p = canvas.requestPointerLock(); if (p?.catch) p.catch(() => {}); } catch { /* unsupported */ } dragLook = { x: e.clientX, y: e.clientY }; return; }
  if (e.button === 0 || e.button === 2) fireGadget(e.button === 2);
});
addEventListener('mouseup', () => { dragLook = null; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  if (!playing || paused) return;
  if (document.pointerLockElement === canvas) look(e.movementX, e.movementY, 0.0022);
  else if (dragLook) { look(e.clientX - dragLook.x, e.clientY - dragLook.y, 0.004); dragLook = { x: e.clientX, y: e.clientY }; }
});
document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== canvas && playing && !paused && !overlayOpen()) setPaused(true); });
function look(dx, dy, s) { me.yaw -= dx * s; me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch - dy * s)); }
const overlayOpen = () => !$('#shop').classList.contains('hidden') || !$('#results').classList.contains('hidden') || !$('#admin').classList.contains('hidden') || !$('#chatBox').classList.contains('hidden');

// touch: joystick + look + buttons
function setupTouch() {
  UI.show('#touch', true);
  const joy = $('#joy'), knob = $('#joyKnob');
  let jid = null, c = null;
  joy.addEventListener('pointerdown', (e) => { if (ctl.editing) return; jid = e.pointerId; joy.setPointerCapture(jid); const r = joy.getBoundingClientRect(); c = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; mv(e); });
  const mv = (e) => { if (e.pointerId !== jid) return; let dx = e.clientX - c.x, dy = e.clientY - c.y; const L = Math.hypot(dx, dy), M = 50; if (L > M) { dx *= M / L; dy *= M / L; } touch.mx = dx / M; touch.my = dy / M; knob.style.transform = `translate(${dx}px, ${dy}px)`; };
  joy.addEventListener('pointermove', mv);
  const end = (e) => { if (e.pointerId !== jid) return; jid = null; touch.mx = touch.my = 0; knob.style.transform = ''; };
  joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
  const looks = new Map();
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') looks.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
  canvas.addEventListener('pointermove', (e) => { const l = looks.get(e.pointerId); if (!l || paused) return; look(e.clientX - l.x, e.clientY - l.y, 0.006); l.x = e.clientX; l.y = e.clientY; });
  const lend = (e) => looks.delete(e.pointerId);
  canvas.addEventListener('pointerup', lend); canvas.addEventListener('pointercancel', lend);
  const tap = (id, fn) => $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); if (playing && !paused && !ctl.editing) fn(); });
  tap('#tE', interact);
  // jump: hold (jetpack / noclip fly while held)
  $('#tJ').addEventListener('pointerdown', (e) => { e.preventDefault(); if (playing && !paused) keys.add('Space'); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) $('#tJ').addEventListener(ev, () => keys.delete('Space'));
  tap('#tV', () => { me.third = !me.third; });
  tap('#tRun', () => { touch.run = !touch.run; $('#tRun').classList.toggle('on', touch.run); });
  tap('#tLeave', leaveSeat);
  tap('#tGear', () => systemAct('gear'));
  const hold = (id, v) => { const b = $(id); b.addEventListener('pointerdown', () => { touch.thr = v; }); b.addEventListener('pointerup', () => { touch.thr = 0; }); b.addEventListener('pointercancel', () => { touch.thr = 0; }); };
  hold('#tThrUp', 1); hold('#tThrDn', -1);
  // Developer gadget trigger (+ mode switch for the Shrink/Grow Ray); shown only while a tool is equipped
  const fire = UI.el('button', { id: 'tF', type: 'button', class: 'hidden', 'aria-label': 'Use gadget' }, '🔫');
  const alt = UI.el('button', { id: 'tAlt', type: 'button', class: 'hidden', 'aria-label': 'Switch gadget mode' }, '🔁');
  $('#tbtns').prepend(fire, alt);
  fire.addEventListener('pointerdown', (e) => { e.preventDefault(); fireGadget(false); });
  alt.addEventListener('pointerdown', (e) => { e.preventDefault(); fireGadget(true); });
  tap('#tChat', openChat);
}
if (isTouch) setupTouch();

// ---------------- collision (plane-local AABBs) ----------------
function solids() {
  const ta = terminalActive(), si = stepIdx(myStep());
  return ship.colliders.filter((c) => !(c.tag === 'ground' && !sim.groundOn) && !(c.tag && c.tag.endsWith(':open'))
    && !(c.tag === 'term:arch' && (!ta || si >= 2 || termLocal.bag)) && !(c.tag === 'term:gate' && (!ta || si >= 3)));
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
const freeAt = (p, cols) => !cols.some((c) => overlaps(p, c));
/** Teleported / spawned / ghosted into something solid (a seat, a wall, a bin): stand on it if it is a low step,
 *  otherwise move to the nearest free spot on the same side of the fuselage, never on top of the bins. */
function unstick(cols) {
  const hit = cols.filter((c) => overlaps(me.pos, c)); if (!hit.length) return false;
  // a low step (cushion, kerb), or a floor slab we were put just under (cabin floor, jet bridge): stand on it.
  // Narrow things (seat backs, walls, overhead bins) never count, so nobody ends up standing on the bins.
  const floorish = (c) => c.max[1] - me.pos.y <= STEP || (c.max[0] - c.min[0] > 1.2 && c.max[2] - c.min[2] > 1.2 && c.max[1] - me.pos.y <= 3.0);
  { // climb through stacked slabs (apron -> fuselage belly -> cabin floor) until free; give up at anything narrow
    const up = me.pos.clone(); let h = hit;
    for (let i = 0; i < 4 && h.length; i++) {
      const slabs = h.filter(floorish); if (!slabs.length) break;
      up.y = Math.max(...slabs.map((c) => c.max[1])) + 0.001; h = cols.filter((c) => overlaps(up, c));
    }
    if (!h.length && up.y - me.pos.y <= 3.0) { me.pos.copy(up); me.vel.y = 0; return true; }
  }
  const inside = sim.inCabin(me.pos), q = me.pos.clone();
  for (let r = 0.15; r <= 3.01; r += 0.15) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2; q.set(me.pos.x + Math.cos(a) * r, me.pos.y, me.pos.z + Math.sin(a) * r);
      if (freeAt(q, cols) && sim.inCabin(q) === inside) { me.pos.copy(q); me.vel.x = me.vel.z = 0; return true; }
    }
  }
  return false;
}
function updatePlayer(dt) {
  if (me.mode === 'pilot') { me.pos.set(-0.6, 0.48, -14.6); me.vel.set(0, 0, 0); me.onGround = true; return; }
  if (me.mode === 'copilot') { me.pos.set(0.6, 0.48, -14.6); me.vel.set(0, 0, 0); me.onGround = true; return; }
  let fx = 0, fz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) fz -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) fz += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) fx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) fx += 1;
  fx += touch.mx; fz += touch.my;
  const L = Math.hypot(fx, fz); if (L > 1) { fx /= L; fz /= L; }
  if (me.frozen || gadgets.frozenT > 0) { me.vel.set(0, Math.min(0, me.vel.y), 0); fx = 0; fz = 0; }
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.run || Math.hypot(touch.mx, touch.my) > 0.95 ? 5.6 : 3.4) * gadgets.speedMul();
  me.sprint = speed > 5 && L > 0.1;
  const s = Math.sin(me.yaw), c = Math.cos(me.yaw);
  const wx = (fx * c + fz * s) * speed, wz = (-fx * s + fz * c) * speed;
  const a = Math.min(1, dt * (me.onGround ? 14 : 3));
  me.vel.x += (wx - me.vel.x) * a; me.vel.z += (wz - me.vel.z) * a;
  // Developer abilities (equip state comes from the server): noclip ghost-flight, jetpack, super jump
  if (gadgets.has('noclip') && !me.frozen) {
    const up = (keys.has('Space') ? 1 : 0) - (keys.has('KeyC') || keys.has('ControlLeft') ? 1 : 0);
    me.pos.x += me.vel.x * dt; me.pos.z += me.vel.z * dt; me.pos.y += up * speed * dt; me.vel.y = 0;
    me.pos.y = Math.max(-GEAR_H - 0.2, me.pos.y); me.onGround = false; me.flying = up !== 0; me.moving = L > 0.1;
    return;
  }
  me.flying = false;
  if (gadgets.has('jetpack') && keys.has('Space') && !me.frozen) { me.vel.y = Math.min(5.5, me.vel.y + 16 * dt); me.onGround = false; me.flying = true; }
  else if (keys.has('Space') && me.onGround) { me.vel.y = 4.3 * gadgets.jumpMul(); me.onGround = false; }
  me.vel.y -= (gadgets.has('super_jump') && me.vel.y < 0 ? 7 : 9.8) * dt; // super jump: floaty fall
  if (sim.turb > 0.3 && me.onGround && Math.random() < sim.turb * dt * 2) { me.vel.x += (Math.random() - 0.5) * sim.turb * 2.5; me.vel.z += (Math.random() - 0.5) * sim.turb * 2.5; }
  me.moving = L > 0.1;
  const cols = solids();
  unstick(cols);
  const steps = Math.ceil(dt / 0.012);
  for (let i = 0; i < steps; i++) {
    const h = dt / steps;
    moveAxis('x', me.vel.x * h, cols);
    moveAxis('z', me.vel.z * h, cols);
    const prevY = me.pos.y;
    me.pos.y += me.vel.y * h;
    let ground = false;
    for (const col of cols) {
      if (!overlaps(me.pos, col)) continue;
      // only land on a top we came down onto / bump a ceiling we rose into; being inside something is unstick()'s
      // job (snapping to its top stacked seat -> seat back -> overhead bins and left people standing on the bins)
      if (me.vel.y <= 0 && prevY >= col.max[1] - 0.06) { me.pos.y = col.max[1]; me.vel.y = 0; ground = true; }
      else if (me.vel.y > 0 && prevY + H <= col.min[1] + 0.06) { me.pos.y = col.min[1] - H - 0.001; me.vel.y = 0; }
    }
    if (ground) me.onGround = true;
    else if (me.vel.y < -0.5) me.onGround = false;
  }
  // safety nets: fell out of the world, or left outside at departure
  if (me.pos.y < -GEAR_H - 6 || (!sim.groundOn && !sim.inCabin(me.pos))) { teleport('cabin'); UI.toast('You hopped aboard just in time.'); }
}
const SPOTS = { cockpit: [0, 0, -12.2], cargo: [0, 0, -10.5], cabin: [0, 0, 0], galley: [0, 0, 10.4], apron: [SPAWN.x, SPAWN.y, SPAWN.z] };
function teleport(spot) {
  if (me.mode === 'pilot' || me.mode === 'copilot') leaveSeat();
  const p = spot === 'apron' && !sim.groundOn ? SPOTS.cabin : SPOTS[spot] || SPOTS.cabin;
  me.pos.set(...p); me.vel.set(0, 0, 0);
}

// ---------------- interaction ----------------
const tmp = new THREE.Vector3();
function eyePos() { return new THREE.Vector3(me.pos.x, me.pos.y + EYE, me.pos.z); }
function lookDir() { return new THREE.Vector3(-Math.sin(me.yaw) * Math.cos(me.pitch), Math.sin(me.pitch), -Math.cos(me.yaw) * Math.cos(me.pitch)); }
function heldItem() { for (const it of sim.items.values()) if (it.heldBy === myId()) return it; return null; }
function heldPax() { return sim.pax.find((p) => p.carriedBy === myId()) || null; }
function findTarget() {
  if (me.mode === 'pilot' || me.mode === 'copilot') return { kind: 'leave', label: 'Leave the seat (X)' };
  const eye = eyePos(), dir = lookDir(), held = heldItem();
  const hp = heldPax();
  if (hp) return { kind: 'dropPax', label: 'Put the passenger down (E) · throw (Q)' };
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
    consider(head, serveReach(classOf(myId())), { kind: 'serve', pax: p, ok, prio: 0.7, label: p.request === 'complaint' ? (held ? 'Hands full: put it down to talk' : 'Calm the passenger down') : ok ? `Give the ${ITEM_DEFS[p.request].label}` : `Wants: ${ITEM_DEFS[p.request].label}` });
  }
  if (!held) for (const p of sim.pax) {
    if (p.state === 'lost' || p.state === 'carried' || p.state === 'thrown') continue;
    const chest = p.mesh.position.clone(); chest.y += p.state === 'seated' ? 0.7 : 1.0;
    consider(chest, 2.0, { kind: 'grabPax', pax: p, prio: 2.2, label: 'Pick up the passenger (they will hate it)' });
  }
  const stack = held && canStack(myId(), heldBy(myId()));
  if (!held || stack) for (const it of sim.items.values()) { if (stack && !ITEM_DEFS[it.type].bag) continue; if (!it.heldBy && (!ITEM_DEFS[it.type].gadget || net.you?.role === 'DEVELOPER')) consider(it.mesh.position, 2.4, { kind: 'grab', item: it, label: ITEM_DEFS[it.type].gadget ? `Equip ${ITEM_DEFS[it.type].label.replace(' case', '')}` : `Pick up ${ITEM_DEFS[it.type].label}` }); }
  for (const ip of ship.interact) {
    if (ip.term) { const tt = termTarget(ip, held); if (tt) consider(ip.pos, 2.4, tt); continue; }
    const t = { ...ip };
    if (ip.kind === 'door') t.label = `${ship.doors[ip.door].open ? 'Close' : 'Open'} the ${ip.label}`;
    if (ip.kind === 'dispense' && held) continue;
    if (ip.kind === 'pilot') { const pc = net.room?.pilotCid; if (pc && pc !== myId()) t.label = 'Someone is flying'; }
    if (ip.kind === 'copilot' && copilotTaken()) t.label = 'The co-pilot seat is taken';
    consider(ip.pos, ip.kind === 'pilot' || ip.kind === 'copilot' ? 2.2 : ip.kind === 'panel' && classOf(myId()) === 'mechanic' ? PERK.mechReach : 1.9, ip.kind === 'pilot' || ip.kind === 'copilot' ? { ...t, prio: 0.6 } : t);
  }
  if (!best && held) return { kind: 'drop', label: `Put down the ${ITEM_DEFS[held.type].label}` };
  return best;
}
function interact() {
  const t = findTarget(), held = heldItem();
  if (!t) return;
  if (t.kind === 'leave') return leaveSeat();
  if (t.kind.startsWith('term_')) return termInteract(t);
  if (t.kind === 'grab' && ITEM_DEFS[t.item.type].gadget) { audio.play('pickup'); net.admin('equip', { item: t.item.type }).then(() => act({ k: 'grab', id: t.item.id })).catch((e) => UI.toast(e.message, 'warn')); return; }
  if (t.kind === 'grab') { audio.play('pickup'); act({ k: 'grab', id: t.item.id }); return; }
  if (t.kind === 'drop') return dropHeld(0.9, 0);
  if (t.kind === 'serve') { if (t.ok) { audio.play('serve'); act({ k: 'serve', pax: t.pax.id, item: held?.id || null }); } else UI.toast(t.label); return; }
  if (t.kind === 'copilot') return takeCopilot();
  if (t.kind === 'grabPax') { audio.play('pickup'); return act({ k: 'grabPax', id: t.pax.id }); }
  if (t.kind === 'dropPax') return dropPax(0.9, 0);
  if (t.kind === 'announce') return systemAct('announce');
  if (t.kind === 'door') {
    if (!sim.flight.onGround && !ship.doors[t.door].open) UI.toast('You opened a door mid-flight. Everyone is screaming. Hold on to something!', 'warn');
    return act({ k: 'door', d: t.door });
  }
  if (t.kind === 'dispense') { audio.play('pickup'); return act({ k: 'disp', item: t.item }); }
  if (t.kind === 'panel') return act({ k: 'fix' });
  if (t.kind === 'pilot') return takeSeat();
}
function dropHeld(dist, throwSpeed) {
  const held = heldItem(); if (!held) return;
  const eye = eyePos(), dir = lookDir();
  const p = eye.clone().addScaledVector(dir, dist); p.y = Math.max(p.y - 0.2, me.pos.y + 0.25);
  if (sim.inCabin(me.pos)) { // never drop through the fuselage wall
    p.x = Math.max(-HALF_W + 0.35, Math.min(HALF_W - 0.35, p.x));
    p.z = Math.max(Z_NOSE + 0.4, Math.min(Z_TAIL - 0.4, p.z));
    p.y = Math.min(p.y, CEIL - 0.35);
  }
  const v = dir.clone().multiplyScalar(throwSpeed * (classOf(myId()) === 'baggage' && ITEM_DEFS[held.type].bag ? PERK.bagThrow : 1)); v.y += throwSpeed ? 1.5 : 0;
  audio.play('drop');
  act({ k: 'drop', id: held.id, p: [p.x, p.y, p.z], v: [v.x, v.y, v.z] });
}
function throwHeld() { if (heldPax()) return dropPax(0.8, 7); if (heldItem()) dropHeld(0.7, 6.5); }
/** Put down / throw the passenger you are carrying. */
function dropPax(dist, speed) {
  const p = heldPax(); if (!p) return;
  const dir = lookDir();
  const at = me.pos.clone().add(new THREE.Vector3(dir.x, 0, dir.z).normalize().multiplyScalar(dist)); at.y = me.pos.y + 0.9;
  if (sim.inCabin(me.pos)) { // only an OPEN door lets a passenger out: the rear door (aft wall) or the cargo door (hold, right side)
    const door = sim.openDoorAt(at);
    at.z = Math.max(Z_NOSE + 0.6, door === 'rear' ? at.z : Math.min(Z_TAIL - 0.45, at.z));
    if (door !== 'cargo') at.x = Math.max(-HALF_W + 0.35, Math.min(HALF_W - 0.35, at.x));
  }
  const v = dir.clone().multiplyScalar(speed); v.y += speed ? 2.2 : 0;
  audio.play(speed ? 'drop' : 'click');
  act({ k: 'dropPax', id: p.id, p: [at.x, at.y, at.z], v: [v.x, v.y, v.z] });
}

/** Apply a gameplay action. Host resolves locally; guests ask the host (and predict grabs/drops). */
/** How long a guest trusts its own prediction (pick up / throw a passenger) before the host's word wins. */
const PREDICT_MS = 1500;
function act(a) {
  if (net.inRoom && !net.isHost) {
    net.send({ t: 'act', a });
    if (a.k === 'grab') { const it = sim.items.get(a.id); if (it && !it.heldBy && !ITEM_DEFS[it.type].gadget) it.heldBy = myId(); }
    if (a.k === 'grabPax') { const p = sim.pax.find((q) => q.id === a.id); if (p && !p.carriedBy && !heldPax() && !heldItem()) { p.carriedBy = myId(); p.state = 'carried'; p.predictT = 0.6; p.predictMine = true; p.predictUntil = performance.now() + PREDICT_MS; } }
    if (a.k === 'dropPax') { const p = sim.pax.find((q) => q.id === a.id); if (p) { p.carriedBy = null; p.state = 'thrown'; p.mesh.position.set(...a.p); p.target = p.mesh.position.clone(); p.predictT = 0.3; p.predictMine = true; p.predictUntil = performance.now() + PREDICT_MS / 2; } }
    if (a.k === 'drop') { const it = sim.items.get(a.id); if (it) { it.heldBy = null; it.mesh.position.set(...a.p); it.target = { p: it.mesh.position.clone(), q: it.mesh.quaternion.clone() }; } }
    return;
  }
  applyAct(myId(), a);
}
const holderOf = (cid) => [...sim.items.values()].find((i) => i.heldBy === cid);
const heldBy = (cid) => [...sim.items.values()].filter((i) => i.heldBy === cid);
/** A player's class: ONLY what the game server put in the room list (it checked ownership); solo = my local pick. */
function classOf(cid) {
  if (net.inRoom) return net.room?.players.find((p) => p.cid === cid)?.klass || null;
  return cid === myId() ? myClass : null;
}
function crewInfo() {
  const out = [{ cid: myId(), cls: classOf(myId()), x: me.pos.x, y: me.pos.y, z: me.pos.z, seated: me.mode !== 'walk' }];
  for (const [cid, r] of remotes) out.push({ cid, cls: classOf(cid), x: r.mesh.position.x, y: r.mesh.position.y, z: r.mesh.position.z, seated: r.mode === 'pilot' || r.mode === 'copilot' });
  return out;
}
const pilotCid = () => (net.inRoom ? net.room?.pilotCid : me.mode === 'pilot' ? myId() : null);
sim.crewInfo = crewInfo;
sim.pilotClass = () => { const c = pilotCid(); return c ? classOf(c) : null; };
/** Baggage Master: a second bag on top of the first (bags only). */
const canStack = (cid, held) => held.length > 0 && held.length < carryLimit(classOf(cid)) && held.every((i) => ITEM_DEFS[i.type].bag);
function applyAct(cid, a) {
  if (!a || typeof a !== 'object') return;
  switch (a.k) {
    case 'grab': {
      const it = sim.items.get(String(a.id));
      // gadget cases: only a server-verified Developer (rank comes from the server's room list) can take one; it turns into equipped gear
      if (it && ITEM_DEFS[it.type].gadget) { if (roleOf(cid) === 'DEVELOPER') sim.removeItem(it.id); break; }
      const hb = heldBy(cid);
      if ((!hb.length || (canStack(cid, hb) && it && ITEM_DEFS[it.type].bag)) && !sim.carrierOf(cid)) sim.grab(String(a.id), cid); break;
    }
    case 'grabPax': if (!holderOf(cid)) sim.grabPax(Number(a.id), cid); break;
    case 'dropPax': if (Array.isArray(a.p) && a.p.length === 3 && a.p.every(Number.isFinite)) sim.dropPax(Number(a.id), cid, a.p.map(Number), Array.isArray(a.v) ? a.v.map(Number) : [0, 0, 0]); break;
    case 'drop': if (Array.isArray(a.p) && a.p.length === 3) sim.drop(String(a.id), cid, a.p.map(Number), Array.isArray(a.v) ? a.v.map(Number) : [0, 0, 0]); break;
    case 'serve': {
      const it = a.item ? sim.items.get(String(a.item)) : null;
      if (it && it.heldBy !== cid) break;
      if (sim.serve(Number(a.pax), it ? it.type : null, classOf(cid)) && it) sim.removeItem(it.id);
      break;
    }
    case 'door': if (['rear', 'cargo'].includes(a.d) && sim.phase !== 'taxi') sim.setDoor(a.d, !ship.doors[a.d].open); break;
    case 'fix': sim.fixPanel(); break;
    case 'disp': {
      if (!['water', 'snack', 'blanket'].includes(a.item) || holderOf(cid)) break;
      const ip = ship.interact.find((i) => i.item === a.item);
      const it = sim.spawnItem(a.item, [ip.pos.x - 0.4, ip.pos.y, ip.pos.z]);
      sim.grab(it.id, cid);
      break;
    }
    case 'reset': if (sim.phase === 'results') restartFlight(); break;
    case 'sys': {
      // cockpit systems: from the pilot/co-pilot seats; announcements also from the galley PA handset
      if (!['lights', 'seatbelt', 'gear', 'announce'].includes(a.w)) break;
      // seat comes from the player's own state (gameplay only, not a security boundary)
      const seat = cid === myId() ? me.mode : remotes.get(cid)?.mode === 'walk' && a.seat ? a.seat : remotes.get(cid)?.mode || a.seat;
      if (a.w !== 'announce' && seat !== 'pilot' && seat !== 'copilot') break;
      const who = cid === myId() ? '' : remotes.get(cid)?.info?.displayName || remotes.get(cid)?.info?.username;
      sim.system(a.w, who ? ` (${who})` : '');
      break;
    }
    case 'contract': if (sim.phase === 'boarding' && ['standard', 'premium'].includes(a.c)) { sim.contract = a.c; refreshRouteUi(); } break;
    case 'route': if (sim.phase === 'boarding' && ROUTES[a.r]) { setRoute(a.r); refreshRouteUi(); UI.toast(`Destination: ${DEST.name}.`); } break;
  }
}

// ---------------- pilot seat ----------------
async function takeSeat() {
  if (heldPax()) return UI.toast('Put the passenger down first.');
  if (heldItem()) return UI.toast('Put down what you are carrying first.');
  if (net.inRoom) {
    if (net.room.pilotCid && net.room.pilotCid !== myId()) return UI.toast('Someone else is flying.');
    net.send({ t: 'pilot', on: true });
  }
  me.mode = 'pilot'; me.yaw = 0; me.pitch = -0.12;
  UI.toast(sim.phase === 'boarding' ? 'Captain\'s seat. Press R to add throttle when everyone is aboard. Departing closes the doors.' : 'You have the controls.');
}
function systemAct(w) { act({ k: 'sys', w, seat: me.mode }); }
const copilotTaken = () => [...remotes.values()].some((r) => r.mode === 'copilot');
function takeCopilot() {
  if (heldItem() || heldPax()) return UI.toast('Put down what you are carrying first.');
  if (copilotTaken()) return UI.toast('Someone is already in the co-pilot seat.');
  me.mode = 'copilot'; me.yaw = 0; me.pitch = -0.15;
  UI.toast('First officer seat: L lights · B seatbelt sign · N announcement · G landing gear.');
}
function leaveSeat() {
  if (me.mode === 'copilot') { me.mode = 'walk'; me.pos.set(0.3, 0, -13.6); me.yaw = Math.PI; return; }
  if (me.mode !== 'pilot') return;
  me.mode = 'walk'; me.pos.set(-0.2, 0, -13.6); me.yaw = Math.PI;
  if (net.inRoom) net.send({ t: 'pilot', on: false });
  if (!sim.flight.onGround) UI.toast('Autopilot holds the plane level while nobody is flying.');
}
const amPilot = () => me.mode === 'pilot' && (!net.inRoom || net.room?.pilotCid === myId());
const someonePilots = () => (net.inRoom ? !!net.room?.pilotCid : me.mode === 'pilot');

// ---------------- Wave Cannon (fictional Developer gear) ----------------
const roleOf = (cid) => (cid === myId() ? net.you?.role : net.room?.players?.find((p) => p.cid === cid)?.role) || 'PLAYER';
function fireGadget(alt) {
  if (heldItem() || heldPax() || me.mode !== 'walk' || !net.inRoom) return false;
  return gadgets.fire(alt);
}
/** What the gadget is pointed at: nearest passenger / item / player along the aim ray, plus the first solid point and a floor spot (teleport). */
function aim(o, d) {
  let best = null, bd = 40;
  const test = (c, r, target) => { const t = c.clone().sub(o).dot(d); if (t < 0.2 || t > bd) return; const off = o.clone().addScaledVector(d, t).distanceTo(c); if (off < r) { bd = t; best = target; } };
  for (const p of sim.pax) if (p.state !== 'lost' && p.carriedBy !== myId()) test(p.mesh.position.clone().add(new THREE.Vector3(0, 0.85, 0)), 0.55, { type: 'pax', id: p.id });
  for (const it of sim.items.values()) if (!it.heldBy) test(it.mesh.position, 0.45, { type: 'item', id: it.id });
  for (const [cid, r] of remotes) if (r.info.role !== 'DEVELOPER') test(r.mesh.position.clone().add(new THREE.Vector3(0, 0.9, 0)), 0.6, { type: 'player', id: cid });
  // march to the first solid (walls, seats, floor)
  const cols = solids(); let p = o.clone(), last = o.clone(); const step = 0.1;
  for (let t = 0; t < Math.min(bd, 40); t += step) {
    p = o.clone().addScaledVector(d, t);
    const inCab = sim.inCabin(p), floor = inCab ? 0 : -GEAR_H;
    if (p.y < floor || cols.some((c) => p.x > c.min[0] && p.x < c.max[0] && p.y > c.min[1] && p.y < c.max[1] && p.z > c.min[2] && p.z < c.max[2])) break;
    last = p;
  }
  const hitP = best ? o.clone().addScaledVector(d, bd) : last;
  const floor = last.clone(); floor.y = sim.inCabin(last) ? 0 : -GEAR_H; if (sim.inCabin(last) && last.y > 1.5) floor.y = 0;
  return { target: best, p: hitP, floor };
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
gadgets = new Gadgets({
  parent: ship.plane, sim, me, myId: () => myId(), eye: () => eyePos(), dir: () => lookDir(), aim,
  avatarOf: (cid) => (cid === myId() ? myAvatar : remotes.get(cid)?.mesh), isHost: () => sim.host,
  send: (cmd, args) => net.admin(cmd, args).catch((e) => { if (!/cool/i.test(e.message)) UI.toast(`Gadget: ${e.message}`, 'warn'); }),
  toast: (m) => UI.toast(m), audio,
});
gadgets.splash = splash;
gadgets.onTeleport = (p) => { if (me.mode !== 'walk') leaveSeat(); me.pos.copy(p); me.vel.set(0, 0, 0); };

// ---------------- room chat (server relays; muted players are refused there) ----------------
function openChat() {
  if (!net.inRoom) return;
  UI.show('#chatBox', true); keys.clear(); document.exitPointerLock?.();
  const i = $('#chatInput'); i.value = ''; i.focus();
}
$('#chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const t = e.target.value.trim(); if (t) net.send({ t: 'chat', text: t.slice(0, 200) }); UI.show('#chatBox', false); e.preventDefault(); }
  if (e.key === 'Escape') { UI.show('#chatBox', false); e.preventDefault(); }
  e.stopPropagation();
});
$('#chatInput').addEventListener('blur', () => UI.show('#chatBox', false));
function chatLine(name, role, text) {
  const log = $('#chatLog');
  const line = UI.el('div', { class: 'chatline' }, UI.rankBadge(role), UI.el('b', {}, ` ${name}: `), text);
  log.append(line); while (log.children.length > 6) log.firstChild.remove();
  setTimeout(() => line.classList.add('fade'), 12000);
}
/** Maintenance screen (server refused us or removed us while maintenance mode is on). */
function showMaintenance(message) {
  if (playing) quitToMenu();
  $('#maintMsg').textContent = message || 'Sky Crew is under maintenance. Please check back soon.';
  UI.show('#maint', true);
}
$('#maintClose').addEventListener('click', () => UI.show('#maint', false));
function syncRemotes(room) {
  const ids = new Set(room ? room.players.map((p) => p.cid) : []);
  const lookKey = (p) => `${JSON.stringify(p?.outfit || DEFAULT_OUTFIT)}|${p?.klass || ''}`;
  for (const [cid, r] of remotes) if (!ids.has(cid) || cid === myId() || r.key !== lookKey(room?.players.find((p) => p.cid === cid))) { ship.plane.remove(r.mesh); remotes.delete(cid); }
  if (!room) return;
  for (const p of room.players) {
    if (p.cid === myId()) { if ((p.crew || null) !== myCrew) { myCrew = p.crew || null; dressMe(); } continue; }
    if (remotes.has(p.cid)) { remotes.get(p.cid).info = p; continue; }
    // the outfit each player picked (server-validated) + their class badge
    const mesh = makeCrew(p.outfit || DEFAULT_OUTFIT);
    mesh.add(nameTag(p.displayName || p.username, p.role, CLASS_INFO[p.klass]?.icon || ''));
    ship.plane.add(mesh);
    const r = { mesh, target: new THREE.Vector3(...(p.state?.p || SPOTS.apron)), ry: 0, mode: p.state?.mode || 'walk', moving: false, info: p, crew: p.crew || null, key: lookKey(p) };
    mesh.position.copy(r.target);
    remotes.set(p.cid, r);
    gadgets?.rebuild(p.cid);
  }
}
function updateRemotes(dt) {
  for (const r of remotes.values()) {
    r.mesh.position.lerp(r.target, Math.min(1, dt * 12));
    let d = r.ry - r.mesh.rotation.y; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    r.mesh.rotation.y += d * Math.min(1, dt * 12);
    const seated = r.mode === 'pilot' || r.mode === 'copilot';
    animateCharacter(r.mesh, dt, { moving: r.moving, running: r.moving && r.run, sitting: seated, pilot: seated, carrying: !!r.held, jumping: r.target.y - r.mesh.position.y > 0.25 });
  }
}

// ---------------- networking ----------------
net.addEventListener('room', (e) => {
  const room = net.room;
  syncRemotes(room);
  gadgets.syncRoom(room);
  gadgets.serverFrozen = new Set((room?.players || []).filter((p) => p.frozen).map((p) => p.cid));
  me.frozen = gadgets.serverFrozen.has(myId());
  if (room?.config && sim.host) sim.config = room.config;
  if (room?.hour != null && sim.host) sim.hour = room.hour;
  if (room?.weather && sim.host && !e.detail.you) void 0;
  UI.roomInfo(room, myId(), UI.rankBadge);
  renderLobby();
  const wasHost = sim.host;
  sim.host = net.isHost;
  if (!wasHost && sim.host) { // host migration: take over the simulation
    for (const it of sim.items.values()) if (!it.heldBy && !it.inWorld) { it.body.position.copy(it.mesh.position); it.body.quaternion.copy(it.mesh.quaternion); it.body.velocity.set(0, 0, 0); sim.world.addBody(it.body); it.inWorld = true; }
    for (const p of sim.pax) if (p.target) p.mesh.position.copy(p.target);
    sim.activeEvents = null; // the full event list (with timers) came with the last snapshot
    if (room.players.length > 1) UI.toast('The host left. You are now running the flight; nothing was reset.');
  }
  if (wasHost && !sim.host) { sim.seed = -1; }
  if (me.mode === 'pilot' && room.pilotCid !== myId()) me.mode = 'walk';
  applyAirport();
  if (!$('#admin').classList.contains('hidden')) renderAdmin();
});
net.addEventListener('st', (e) => { const r = remotes.get(e.detail.cid); if (!r) return; const s = e.detail.s; r.target.set(...s.p); r.ry = s.ry; r.pt = s.pt; r.mode = s.mode; r.moving = s.moving; r.run = !!s.run; r.fly = !!s.fly; r.held = s.held; });
let freshJoin = true; // a flight that had already ended when we joined is not ours to report
net.addEventListener('world', (e) => {
  if (sim.host) return;
  const w = e.detail.w || {};
  if (w.hs != null && w.hs === lastWorld.hs && Number(w.sq) <= lastWorld.sq) return; // stale / out-of-order snapshot
  if (w.hs != null) { lastWorld.hs = w.hs; lastWorld.sq = Number(w.sq) || 0; }
  if (freshJoin) { freshJoin = false; if (e.detail.w.res) markReported(e.detail.w.res.at); }
  sim.applySnapshot(e.detail.w);
});
net.addEventListener('plane', (e) => { if (amPilot()) return; sim.applyPlane(e.detail.s); });
net.addEventListener('act', (e) => { if (sim.host) applyAct(e.detail.cid, e.detail.a); });
net.addEventListener('event', (e) => { const ev = e.detail.e; if (ev?.toast) { UI.toast(String(ev.toast).slice(0, 200), ev.kind === 'warn' ? 'warn' : 'info'); playSfx(ev.sfx || (ev.kind === 'warn' ? 'warn' : null)); } });
net.addEventListener('left', (e) => {
  if (!sim.host) return;
  for (const it of sim.items.values()) if (it.heldBy === e.detail.cid) sim.drop(it.id, it.heldBy, [it.mesh.position.x, it.mesh.position.y, it.mesh.position.z]);
  const p = sim.carrierOf(e.detail.cid); if (p) sim.dropPax(p.id, e.detail.cid, [p.mesh.position.x, p.mesh.position.y, p.mesh.position.z], [0, 0, 0]);
});
net.addEventListener('fx', (e) => {
  const { cmd, args, by } = e.detail;
  const who = by.displayName || by.username;
  if (cmd === 'spawn' && sim.host) {
    const src = by.cid === myId() ? me.pos : remotes.get(by.cid)?.target || me.pos;
    for (let i = 0; i < args.count; i++) { const dir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5); sim.spawnItem(args.item, [src.x + dir.x, src.y + 1.6 + i * 0.4, src.z + dir.z], { id: args.ids?.[i] || null }); }
  }
  if (cmd === 'spawn') UI.toast(`${who} spawned ${ITEM_DEFS[args.item]?.label || args.item}.`);
  if (cmd === 'weather') { if (sim.host) sim.weather = args.weather; UI.toast(`${who} set the weather to ${args.weather}.`, args.weather === 'storm' ? 'warn' : 'info'); }
  if (cmd === 'emergency' && sim.host) sim.emergency(args.scenario, args.action);
  if (cmd === 'emergency' && args.action === 'stop') UI.toast(`${who} ended the ${args.scenario.replace('_', ' ')} scenario.`);
  if (cmd === 'teleport' && args.cid === myId()) { if (args.p) { if (me.mode !== 'walk') leaveSeat(); me.pos.set(...args.p); me.vel.set(0, 0, 0); UI.toast(by.cid === myId() ? 'Teleported.' : `${who} brought you to them.`); } else { teleport(args.to); UI.toast(`Teleported to ${args.to}.`); } }
  if (cmd === 'npc') { if (sim.host) sim.npcAction(args.action, args.count || 1); UI.toast(`${who}: passengers ${args.action}!`); }
  if (cmd === 'event' && sim.host) sim.roomEvent(args.event);
  if (cmd === 'event' && args.event === 'birthday') gadgets.confetti(new THREE.Vector3(0, 2.2, 0), new THREE.Vector3(0, -0.2, -1), null);
  if (cmd === 'time') { sim.hour = args.hour; UI.toast(`${who} set the time to ${String(Math.floor(args.hour)).padStart(2, '0')}:${String(Math.round((args.hour % 1) * 60)).padStart(2, '0')}.`); }
  if (cmd === 'config') { sim.config = args.config; UI.toast(`${who} changed the game config: ${args.config.difficulty}, payout ×${args.config.payout}, max ${args.config.maxPlayers} players.`); }
  if (cmd === 'freeze') { if (args.on) gadgets.serverFrozen.add(args.cid); else gadgets.serverFrozen.delete(args.cid); if (args.cid === myId()) { me.frozen = !!args.on; UI.toast(args.on ? `🧊 ${who} froze you.` : 'You can move again.', args.on ? 'warn' : 'info'); } }
  if (cmd === 'equip') {
    gadgets.setGear(args.cid, args.gear || []);
    if (args.cid === myId()) { const it = devInv?.items.find((i) => i.id === args.item); UI.toast(`${it?.icon || '🔮'} ${it?.name || args.item} ${args.on ? 'equipped' : 'unequipped'}.${args.on && it?.kind === 'tool' ? ' Click / F to use' + (args.item === 'size_ray' ? ' (right-click / T: shrink ↔ grow)' : '') + '.' : ''}`); if (!$('#admin').classList.contains('hidden')) renderAdmin(); }
  }
  if (cmd === 'use') gadgets.onUse(args, by);
});
net.addEventListener('admin_denied', (e) => { $('#admMsg').textContent = `Denied: ${e.detail.reason}`; });
net.addEventListener('admin_ok', (e) => { if (e.detail.cmd !== 'use') $('#admMsg').textContent = `Done: ${e.detail.cmd}`; });
net.addEventListener('inventory', (e) => { devInv = e.detail; if (!$('#admin').classList.contains('hidden')) renderAdmin(); });
net.addEventListener('chat', (e) => chatLine(e.detail.displayName || e.detail.username, e.detail.role, e.detail.text));
net.addEventListener('announce', (e) => { UI.toast(`📣 ${e.detail.by}: ${e.detail.text}`, 'warn', 9000); chatLine(`📣 ${e.detail.by}`, 'DEVELOPER', e.detail.text); });
net.addEventListener('muted', (e) => UI.toast(e.detail.minutes ? `🔇 ${e.detail.by} muted you for ${e.detail.minutes} min.` : 'You can chat again.', 'warn'));
net.addEventListener('maintenance', (e) => showMaintenance(e.detail.message));
net.addEventListener('kicked', (e) => { const d = e.detail; quitToMenu(d.banned ? `You were banned from Sky Crew by ${d.by}${d.minutes ? ` for ${d.minutes} min` : ''}.${d.reason ? ` Reason: ${d.reason}` : ''}` : `You were removed from the room by ${d.by}.${d.reason ? ` ${d.reason}` : ''}`); });
net.addEventListener('error', (e) => { if (e.detail.code === 'muted') UI.toast(e.detail.message, 'warn'); if (e.detail.code === 'seat_taken') { me.mode = 'walk'; UI.toast('Someone else is flying.'); } if (e.detail.code === 'crew_taken') { $('#lobRouteNote').textContent = e.detail.message; UI.toast(e.detail.message); } });
net.addEventListener('close', () => {
  // dropped while waiting in the lobby: the room is gone, go back to the menu instead of showing a dead lobby
  if (!playing && !$('#lobby').classList.contains('hidden')) { quitToMenu('Lost the connection to the co-op room. Try again.'); return; }
  if (!playing || !net.wasInRoom) return;
  continueSolo('Disconnected from the co-op room. Continuing solo.');
});
// the room was closed under us (e.g. the Developer closed it while we were in it): same as a drop
net.addEventListener('room_left', (e) => {
  if (!e.detail.reason) return; // our own Leave
  if (!playing) { if (!$('#lobby').classList.contains('hidden')) quitToMenu('The co-op room was closed.'); return; }
  continueSolo('The co-op room was closed. Continuing solo.');
});
function continueSolo(msg) {
  // the socket dropped mid-game: keep playing solo from exactly where we were (airport progress, flight, items)
  const mine = net.lastRoom?.players?.find((p) => p.cid === net.cid)?.term;
  if (mine) termLocal.step = mine;
  termLocal.pending = null;
  UI.toast(msg, 'warn');
  sim.host = true; syncRemotes(null); UI.roomInfo(null); applyAirport();
  UI.show('#btnAdmin', myRole === 'DEVELOPER');
  if (!$('#admin').classList.contains('hidden')) UI.show('#admin', false);
}

let sendT = 0, worldT = 0, worldSeq = 0;
// guests: the newest host snapshot applied so far (per host); an older one arriving late must never roll toggles back
const lastWorld = { hs: null, sq: 0 };
function netTick(dt) {
  if (!net.inRoom) return;
  net.wasInRoom = true;
  sendT += dt; worldT += dt;
  if (sendT > 1 / 15) {
    sendT = 0;
    sendState();
    if (amPilot()) net.send({ t: 'plane', s: sim.planeState() });
  }
  if (net.isHost && worldT > 0.1) { worldT = 0; const w = sim.snapshot(!net.room.pilotCid); w.hs = net.cid; w.sq = ++worldSeq; net.send({ t: 'world', w }); }
}

// ---------------- flight ----------------
let turbPhase = 0;
function updateFlight(dt) {
  const f = sim.flight;
  turbPhase += dt;
  const turbV = sim.turb ? sim.turb * (Math.sin(turbPhase * 6.3) * 2.2 + Math.sin(turbPhase * 2.1) * 1.5) - (sim.activeEvents || sim.events.filter((e) => !e.done).map((e) => [e.id])).some((e) => e[0] === 'air_pocket' || e.id === 'air_pocket') * 6 : 0;
  holdAtGate(f);
  if (amPilot()) {
    const inp = {
      pitch: (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - touch.my,
      roll: (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + touch.mx,
      throttleDelta: (keys.has('KeyR') || keys.has('PageUp') ? 1 : 0) - (keys.has('KeyF') || keys.has('PageDown') ? 1 : 0) + touch.thr,
    };
    f.tailwind = tailwind(crewInfo().map((c) => c.cls));
    if (sim.phase !== 'results') stepFlight(f, inp, dt, turbV * turbulenceFactor(sim.pilotClass()));
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
  ship.gear.visible = sim.cabin.gearDown;
  ship.throttleLever.rotation.x = -f.throttle * 0.9;
}

// ---------------- camera ----------------
let camOverride = null; // test/screenshot camera: { pos, at } in plane-local coords, or { eject: true }
function updateCamera() {
  ship.plane.updateMatrixWorld();
  const f = sim.flight;
  if (camOverride?.eject) {
    const p = sim.pax.find((q) => q.fx);
    if (p) {
      const w = p.mesh.getWorldPosition(new THREE.Vector3());
      const eye = w.clone().add(new THREE.Vector3(7, 3.5, 9));
      camera.position.copy(ship.plane.worldToLocal(eye.clone()));
      camera.lookAt(w.x, w.y + 2, w.z);
      return;
    }
  }
  if (shopOpen() && me.mode === 'walk') { // locker preview: look at my crew member from the front, character on the left
    const fwd = new THREE.Vector3(-Math.sin(me.yaw), 0, -Math.cos(me.yaw));
    const c = me.pos.clone(); c.y += 0.95;
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x); // camera's right when it looks back at the avatar
    camera.position.copy(c).addScaledVector(fwd, 3.1); camera.position.y += 0.2;
    camera.lookAt(ship.plane.localToWorld(c.clone().addScaledVector(right, innerWidth > innerHeight ? 0.95 : 0)));
    return;
  }
  if (camOverride?.pos) { camera.position.set(...camOverride.pos); camera.lookAt(ship.plane.localToWorld(new THREE.Vector3(...camOverride.at))); return; }
  const seated = me.mode === 'pilot' || me.mode === 'copilot';
  if (seated && me.third) {
    camera.position.set(9, 6, 34); camera.lookAt(ship.plane.localToWorld(new THREE.Vector3(0, 1, -8)));
    return;
  }
  const eye = me.mode === 'pilot' ? new THREE.Vector3(-0.6, 1.25, -14.55) : me.mode === 'copilot' ? new THREE.Vector3(0.6, 1.25, -14.55) : eyePos();
  if (me.third && !seated) {
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
// each destination has its own air: warm haze over the desert, crisp blue in the mountains
const PALETTE = {
  harbor: { fog: 0xcfe8ff, mid: 0x6fb2ff, bottom: 0xd8efff, sea: 0x1769b0 },
  tropical: { fog: 0xc6f0ff, mid: 0x5fc0ff, bottom: 0xd2f6ff, sea: 0x1784b8 },
  desert: { fog: 0xf0dcc0, mid: 0x8fb8e8, bottom: 0xf6e3c6, sea: 0x2a7fa8 },
  mountain: { fog: 0xd3e0ef, mid: 0x5a95e0, bottom: 0xe1ebf6, sea: 0x1b5c96 },
};
const cA = new THREE.Color(), cB = new THREE.Color();
function mix(a, b, t) { return cA.setHex(a).lerp(cB.setHex(b), t); }
// weather presets (Admin/Developer can switch them): sky dimming, fog, sun and ambient light
const WX = {
  clear: { dim: 1, near: 900, far: 16000, sun: 2.0, hemi: 1.25, fog: null },
  cloudy: { dim: 0.72, near: 600, far: 9000, sun: 1.0, hemi: 1.15, fog: 0xb7c3d3 },
  rain: { dim: 0.55, near: 250, far: 5000, sun: 0.65, hemi: 0.95, fog: 0x7d8899 },
  storm: { dim: 0.38, near: 150, far: 3500, sun: 0.5, hemi: 0.8, fog: 0x4a5468 },
  fog: { dim: 0.85, near: 20, far: 700, sun: 0.8, hemi: 1.1, fog: 0xdfe5ec },
};
const sunDir = new THREE.Vector3();
/** time of day (Developer control): 0..24 h. Returns daylight 0..1 and a warm tint near sunrise/sunset. */
function daylight(h) { const k = Math.sin(((h - 6) / 12) * Math.PI); return { k: Math.max(0, Math.min(1, k * 1.6 + 0.12)), warm: Math.max(0, 1 - Math.abs(k) * 3.2) * (k > -0.3 ? 1 : 0) }; }
function updateWeather(dt) {
  const w = WX[sim.weather] || WX.clear, storm = sim.weather === 'storm', wet = storm || sim.weather === 'rain';
  const day = daylight(sim.hour ?? 13);
  const u = env.sky.material.uniforms;
  u.dim.value += ((w.dim * (0.12 + 0.88 * day.k)) - u.dim.value) * Math.min(1, dt * 2);
  const f = sim.flight;
  const near = Math.max(0, Math.min(1, 1 - (distTo(f, DEST) - 3000) / 9000)); // blend in over the last ~12 km
  const P0 = PALETTE.harbor, P1 = PALETTE[DEST.style] || P0;
  scene.fog.far = w.far; scene.fog.near = w.near;
  scene.fog.color.copy(w.fog ? cA.setHex(w.fog) : mix(P0.fog, P1.fog, near));
  if (day.warm > 0.01) scene.fog.color.lerp(cB.setHex(0xffa36b), day.warm * 0.5);
  scene.fog.color.multiplyScalar(0.25 + 0.75 * day.k);
  u.mid.value.copy(mix(P0.mid, P1.mid, near)); u.bottom.value.copy(mix(P0.bottom, P1.bottom, near));
  if (day.warm > 0.01) u.bottom.value.lerp(cB.setHex(0xff9a5a), day.warm * 0.7);
  env.sea.material.color.copy(mix(P0.sea, P1.sea, near)).multiplyScalar(0.35 + 0.65 * day.k);
  env.sun.intensity = w.sun * day.k;
  env.sun.color.setHex(0xffffff).lerp(cB.setHex(0xffb37a), day.warm);
  flashT -= dt;
  if (storm && Math.random() < dt * 0.15) { flashT = 0.12; if (playing) audio.thunder(); }
  env.hemi.intensity = flashT > 0 ? 4 : w.hemi * (0.3 + 0.7 * day.k);
  // the sun (and its small shadow box) follows the aircraft; its height follows the clock
  const el = Math.max(0.12, Math.sin(((sim.hour ?? 13) - 6) / 12 * Math.PI)), az = (((sim.hour ?? 13) - 12) / 12) * Math.PI;
  sunDir.set(Math.sin(az) * 0.8 + 0.35, el, Math.cos(az) * 0.4 + 0.25).normalize();
  u.sunDir.value.copy(sunDir);
  env.sun.position.copy(ship.plane.position).addScaledVector(sunDir, 600); env.sun.target.position.copy(ship.plane.position); env.sun.target.updateMatrixWorld();
  // cabin lights matter more at night
  ship.cabin.key.intensity = ship.cabin.key.userData.base * (1.25 - 0.25 * day.k);
  if (wet && !rain) {
    const geo = new THREE.BufferGeometry(); const n = 1500, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = (Math.random() - 0.5) * 60; a[i * 3 + 1] = Math.random() * 30 - 8; a[i * 3 + 2] = (Math.random() - 0.5) * 70; }
    geo.setAttribute('position', new THREE.BufferAttribute(a, 3));
    rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xaabbdd, size: 0.08 }));
    ship.plane.add(rain);
  }
  if (rain) {
    rain.visible = wet;
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
function placeCarriedPax() {
  for (const p of sim.pax) {
    if (!p.carriedBy || p.state === 'lost') continue;
    let base, yaw;
    if (p.carriedBy === myId()) { base = me.pos; yaw = me.yaw; }
    else { const r = remotes.get(p.carriedBy); if (!r) continue; base = r.mesh.position; yaw = r.mesh.rotation.y; }
    // held across the arms, lying sideways, in front of the carrier
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const seenFirstPerson = p.carriedBy === myId() && !me.third;
    p.mesh.position.copy(base).addScaledVector(fwd, seenFirstPerson ? 0.9 : 0.55).addScaledVector(right, -0.8); p.mesh.position.y = base.y + (seenFirstPerson ? 0.75 : 1.05);
    p.mesh.rotation.set(0, yaw + Math.PI / 2, Math.PI / 2 - 0.15, 'YXZ');
    p.mesh.rotation.order = 'YXZ';
  }
}
function placeHeld() {
  placeCarriedPax();
  const stackN = new Map();
  for (const it of sim.items.values()) {
    if (!it.heldBy) continue;
    const k = stackN.get(it.heldBy) || 0; stackN.set(it.heldBy, k + 1);
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
    it.mesh.position.copy(pos); it.mesh.position.y += k * 0.4; it.mesh.rotation.set(0, yaw, 0);
  }
}

// ---------------- objectives / HUD ----------------
function updateHud() {
  const c = sim.counts || { loaded: 0, boarded: 0, pax: 0, bags: 0, loose: 0 };
  const f = sim.flight;
  const evs = sim.host ? sim.events.filter((e) => !e.done).map((e) => [e.id]) : sim.activeEvents || [];
  const rows = [];
  let title = 'BOARDING';
  for (const t of roleTasks()) rows.push(t);
  if (sim.phase === 'boarding') {
    title = `PRE-FLIGHT · ${DEST.name.toUpperCase()}`;
    for (const r of terminalRows()) rows.push(r);
    const list = sim.checklist(), done = list.filter((x) => x.done).length;
    for (const x of list) rows.push({ text: x.text, state: x.done ? 'done' : '' });
    rows.push({ text: done === list.length ? 'Checklist complete (+200)! Pilot: throttle up (R)' : `Checklist ${done}/${list.length} (all done = +200 bonus)`, state: done === list.length ? 'done' : '' });
  } else if (sim.phase === 'results') { title = 'FLIGHT COMPLETE'; }
  else {
    title = { taxi: 'TAKEOFF ROLL', climb: 'CLIMB', cruise: 'CRUISE', approach: 'APPROACH', landed: 'LANDED' }[sim.phase] || sim.phase.toUpperCase();
    rows.push({ text: `Fly to ${DEST.name} (${DEST.code}): ${(distTo(f, DEST) / 1000).toFixed(1)} km` });
    if (!sim.cabin.gearDown) rows.push({ text: 'Landing gear is UP (G to lower before landing)', state: sim.phase === 'approach' ? 'warn' : '' });
    const reqs = sim.pax.filter((p) => p.request).length;
    rows.push({ text: reqs ? `${reqs} passenger request${reqs > 1 ? 's' : ''} waiting (galley at the back)` : 'Passengers are content', state: reqs ? '' : 'done' });
    if (c.lost) rows.push({ text: `🪂 ${c.lost} passenger${c.lost > 1 ? 's' : ''} parachuted out (refund + fine)`, state: 'warn' });
    if (!f.onGround && (ship.doors.rear.open || ship.doors.cargo.open)) rows.push({ text: 'A DOOR IS OPEN IN FLIGHT', state: 'warn' });
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
  UI.held(heldPax() ? 'Carrying a passenger (furious)  ·  E put down · Q throw' : h ? `Holding: ${ITEM_DEFS[h.type].label}  ·  E place · Q throw` : gadgets.tool() && me.mode === 'walk' ? `${devInv?.items.find((i) => i.id === gadgets.tool())?.icon || '🔮'} ${devInv?.items.find((i) => i.id === gadgets.tool())?.name || gadgets.tool()}  ·  click / F use${gadgets.tool() === 'size_ray' ? ` · right-click / T mode (${gadgets.mode})` : gadgets.tool() === 'gravity_gun' ? (gadgets.holding ? ' again to LAUNCH' : ' to lift') : ''}` : null);
  if (isTouch) { UI.show('#tF', !!gadgets.tool() && me.mode === 'walk'); UI.show('#tAlt', gadgets.tool() === 'size_ray' && me.mode === 'walk'); UI.show('#tChat', net.inRoom); }
  const pilot = me.mode === 'pilot', cop = me.mode === 'copilot';
  UI.show('#fhud', pilot || cop);
  UI.show('#cross', !pilot && !cop);
  UI.show('#tFlight', pilot && isTouch);
  UI.show('#cpPanel', cop);
  if (cop) { $('#cpLights').classList.toggle('on', sim.cabin.lights); $('#cpBelt').classList.toggle('on', sim.cabin.seatbelt); $('#cpGear').classList.toggle('on', sim.cabin.gearDown); }
  const gp = glidePath(f);
  UI.glide(gp, { name: DEST.name, gearDown: sim.cabin.gearDown, win: glideWindow(sim.pilotClass()), show: (pilot || cop) && !f.onGround && gp.active && gp.along < 10000 && sim.phase !== 'results' });
  if (pilot || cop) {
    const warnings = [];
    if (f.stall && !f.onGround) warnings.push('STALL');
    if (f.engineFail) warnings.push('ENGINE');
    if (!f.onGround && f.y < 60 && f.vs < -6) warnings.push('SINK RATE');
    if (sim.phase === 'approach' && f.y > 500) warnings.push('TOO HIGH');
    if (!sim.cabin.gearDown && !f.onGround && f.y < 150 && gp.active) warnings.push('GEAR');
    UI.flightHud(f, { kt: KT, ft: FT, distKm: distTo(f, DEST) / 1000, bearing: relBearing(f, DEST), warnings, dest: DEST.code, gearDown: sim.cabin.gearDown });
  }
  if (sim.results && !resultsShown) { resultsShown = true; if (me.mode === 'pilot' || me.mode === 'copilot') leaveSeat(); UI.results(sim.results); showSalary(); document.exitPointerLock?.(); reportFlight(sim.results); }
}

/** Job-specific to-do rows (co-op crew role, or everything in solo). */
function roleTasks() {
  const job = myCrew, ph = sim.phase, out = [];
  if (!job || ph === 'results') return out;
  const label = UI.CREW_LABEL[job];
  const c = sim.counts || { loaded: 0, bags: 0, boarded: 0, pax: 0 };
  const T = {
    pilot: ph === 'boarding' ? 'Take the captain\'s seat; throttle up when the checklist is done' : ph === 'approach' ? `Follow the landing guide to ${DEST.code}, gear down` : `Fly to ${DEST.name}`,
    copilot: ph === 'boarding' ? (sim.cabin.announced ? 'Seatbelt sign ON, then sit in the right seat' : 'Make the welcome announcement (galley PA or right seat)') : ph === 'approach' ? (sim.cabin.gearDown ? 'Gear is down. Call out the landing guide!' : 'Lower the landing gear (G)') : 'Watch systems: lights, seatbelt sign, gear',
    cabin: ph === 'boarding' ? `Get everyone seated (${c.boarded}/${c.pax}) and close the rear door` : 'Serve requests and calm passengers',
    cargo: ph === 'boarding' ? `Load the bags (${c.loaded}/${c.bags}) and close the cargo door` : 'Catch loose bags, fix warnings at the cargo panel',
  };
  out.push({ text: `Your job (${label}): ${T[job]}` });
  return out;
}

// ---------------- menus ----------------
function setPaused(v) { paused = v; UI.show('#pause', v); if (v) { keys.clear(); document.exitPointerLock?.(); $('#pauseRoom').textContent = net.inRoom ? `Co-op room ${net.room.code}: share this code with friends.` : 'Solo flight (the world keeps going in co-op).'; } }
function togglePause() { if (!$('#admin').classList.contains('hidden')) return toggleAdmin(false); if (!$('#results').classList.contains('hidden')) return; setPaused(!paused); }
const live = { rooms: null, hidden: false,
  async refresh() { try { live.rooms = (await net.rooms()).rooms; $('#admMsg').textContent = `${live.rooms.length} live room(s).`; } catch (e) { $('#admMsg').textContent = `Denied: ${e.message}`; } renderAdmin(); },
  async join(code, hidden) { toggleAdmin(false); await devJoin(code, hidden); },
};
let devInv = null; // the secret inventory catalogue: sent by the server ONLY to a verified Developer
function renderAdmin() { buildPanel({ you: net.you || { role: myRole, permissions: [] }, room: net.room, myCid: myId(), live: net.you?.role === 'DEVELOPER' ? live : null, inv: devInv, gear: gadgets.mine(), flight: { pax: sim.pax.filter((p) => p.state !== 'lost').length }, catalog: wallet.catalog, send: (cmd, args) => { $('#admMsg').textContent = '…'; return net.admin(cmd, args).catch(() => {}); } }); }
/** Developer: jump into any room by code (full / locked / hidden are decided by the server). */
async function devJoin(code, hidden) {
  try {
    if (!net.connected) await net.connect();
    if (net.inRoom) net.leave();
    sim.host = false; sim.seed = -1;
    await net.join(code, { hidden: !!hidden });
    start();
    UI.toast(hidden ? `Spectating room ${code} (hidden: nobody can see you).` : `Joined room ${code} as Developer.`);
  } catch (e) { UI.toast(`Join failed: ${e.message}`, 'warn'); if (!playing) { $('#menuErr').textContent = e.message; UI.show('#menuErr', true); } }
}
async function toggleAdmin(force) {
  if (!playing) return;
  const open = force ?? $('#admin').classList.contains('hidden');
  // the Developer can open the panel solo too (live rooms); connecting verifies the rank with the server
  if (open && !net.connected && myRole === 'DEVELOPER') { try { await net.connect(); } catch { /* offline */ } }
  if (open && !(net.you?.permissions || []).includes('admin.panel')) return UI.toast('Staff tools are for Trusted, Admin and Developer ranks.');
  if (open && net.you?.role === 'DEVELOPER' && !live.rooms) setTimeout(() => live.refresh(), 0);
  if (open && net.you?.role === 'DEVELOPER' && !devInv) net.send({ t: 'inventory' });
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

function restartFlight() { const c = sim.contract; for (const p of sim.pax) sim.stopEjectFx(p); sim.host = !net.inRoom || net.isHost; sim.reset(Math.floor(Math.random() * 1e9)); sim.contract = c || 'standard'; }
function respawn() { if (me.mode === 'pilot' || me.mode === 'copilot') leaveSeat(); resetTermLocal(); const inTerm = airportOn() && sim.phase === 'boarding' && myStep() !== 'boarded'; me.pos.copy(inTerm ? TERM_SPAWN : SPAWN); me.vel.set(0, 0, 0); me.yaw = inTerm ? 0 : 0.45; me.pitch = -0.05; resultsShown = false; UI.show('#results', false); }
function quitToMenu(msg) {
  if (net.inRoom) net.leave();
  syncRemotes(null); UI.roomInfo(null); UI.show('#lobby', false); myCrew = null; dressMe();
  audio.startMusic();
  playing = false; setPaused(false); UI.show('#admin', false); UI.show('#results', false); UI.show('#hud', false); UI.show('#hudWallet', false); UI.show('#menu', true);
  sim.host = true; restartFlight(); respawn();
  if (msg) { $('#menuErr').textContent = msg; UI.show('#menuErr', true); }
}
function start() {
  UI.show('#menu', false); UI.show('#lobby', false); releaseMenuFocus(); UI.show('#hud', true); UI.show('#menuErr', false);
  audio.stopMusic();
  playing = true; respawn(); updateWalletHud();
  UI.show('#btnAdmin', (!!net.inRoom && (net.you?.permissions || []).includes('admin.panel')) || myRole === 'DEVELOPER');
  UI.toast(net.inRoom ? `Co-op room ${net.room.code} — share the code!` : 'Solo flight. Load the bags, board everyone, then take the captain\'s seat.');
}
$('#bSolo').addEventListener('click', () => { if (net.inRoom) net.leave(); myCrew = null; dressMe(); setRoute($('#routeSel').value); sim.host = true; restartFlight(); sim.contract = $('#contractSel').value; start(); });
let goingOnline = false;
async function goOnline(code) {
  if (goingOnline) return; // a double tap must not create two rooms
  goingOnline = true; for (const b of ['#bCreate', '#bJoin']) $(b).disabled = true;
  const err = $('#menuErr'); UI.show('#menuErr', false);
  try {
    if (!net.connected) await net.connect();
    if (code) { sim.host = false; sim.seed = -1; await net.join(code); } else { setRoute($('#routeSel').value); sim.host = true; restartFlight(); sim.contract = $('#contractSel').value; await net.create(); if (localStorage.getItem(SKIP_KEY) === '1') net.send({ t: 'airport', skip: true }); }
    openLobby();
    if (myClass) pickClass(myClass); // carry my class pick into the room (the server re-checks ownership)
  } catch (e) { if (e.maintenance) return showMaintenance(e.message); err.textContent = e.message || String(e); UI.show('#menuErr', true); }
  finally { goingOnline = false; for (const b of ['#bCreate', '#bJoin']) $(b).disabled = false; }
}
$('#bCreate').addEventListener('click', () => goOnline());
$('#bJoin').addEventListener('click', () => { const c = $('#joinCode').value.trim().toUpperCase(); if (c.length === 5) goOnline(c); else { $('#menuErr').textContent = 'Room codes have 5 letters.'; UI.show('#menuErr', true); } });
$('#joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#bJoin').click(); });

// ---------------- route select, lobby, settings ----------------
function fillRoutes(sel) {
  sel.replaceChildren(...Object.values(ROUTES).map((r) => UI.el('option', { value: r.code }, `${r.name} (${r.code}) · ${r.km} km`)));
  sel.value = DEST.code;
}
function refreshRouteUi() {
  for (const id of ['#routeSel', '#lobRoute']) $(id).value = DEST.code;
  for (const id of ['#contractSel', '#lobContract']) $(id).value = sim.contract || 'standard';
  $('#lobContract').disabled = !!net.inRoom && !net.isHost;
  $('#routeBlurb').textContent = `${ROUTES[DEST.code].blurb}. About ${Math.round(ROUTES[DEST.code].km / 13)} min of flying.`;
  $('#lobRouteNote').textContent = net.inRoom && !net.isHost ? `The host picks the destination: ${DEST.name}.` : ROUTES[DEST.code].blurb;
}
fillRoutes($('#routeSel')); fillRoutes($('#lobRoute'));
sim.contract = 'standard';
$('#contractSel').addEventListener('change', (e) => { sim.contract = e.target.value; });
$('#lobContract').addEventListener('change', (e) => { if (net.inRoom && net.isHost) applyAct(myId(), { k: 'contract', c: e.target.value }); else refreshRouteUi(); });
$('#routeSel').addEventListener('change', (e) => { setRoute(e.target.value); refreshRouteUi(); });
$('#lobRoute').addEventListener('change', (e) => { if (net.inRoom && !net.isHost) { refreshRouteUi(); return; } setRoute(e.target.value); refreshRouteUi(); });
refreshRouteUi();
function openLobby() { releaseMenuFocus(); UI.show('#menu', false); UI.show('#lobby', true); audio.startMusic(); renderLobby(); refreshRouteUi(); }
function renderLobby() {
  const room = net.room;
  if (!room || $('#lobby').classList.contains('hidden')) return;
  $('#lobCode').textContent = room.code;
  $('#lobRoute').disabled = !net.isHost;
  $('#bLock').textContent = room.locked ? '🔒 Room locked (click to open)' : '🔓 Room open (click to lock)';
  $('#bLock').disabled = !net.isHost; $('#lobSkipAirport').disabled = !net.isHost && myRole !== 'DEVELOPER';
  for (const b of document.querySelectorAll('.crewpick button')) {
    const who = room.players.filter((p) => p.crew === b.dataset.crew);
    b.classList.toggle('mine', myCrew === b.dataset.crew);
    b.classList.toggle('taken', ['pilot', 'copilot'].includes(b.dataset.crew) && who.some((p) => p.cid !== myId()));
  }
  $('#lobPlayers').replaceChildren(...room.players.map((p) => UI.el('div', { class: 'pl' }, UI.rankBadge(p.role), UI.el('span', { class: `name-${p.role.toLowerCase()}` }, p.displayName || p.username), p.cid === room.hostCid ? ' (host)' : '', p.cid === myId() ? ' (you)' : '', p.klass ? UI.el('span', { class: 'klass', title: CLASS_INFO[p.klass]?.name }, `${CLASS_INFO[p.klass]?.icon} ${CLASS_INFO[p.klass]?.name}`) : '', UI.el('span', { class: 'crew' }, p.crew ? UI.CREW_LABEL[p.crew] : 'no job yet'))));
  refreshRouteUi();
}
for (const b of document.querySelectorAll('.crewpick button')) b.addEventListener('click', () => { const role = myCrew === b.dataset.crew ? null : b.dataset.crew; net.send({ t: 'crew', role }); });
$('#bBoard').addEventListener('click', () => start());
$('#bLobLeave').addEventListener('click', () => quitToMenu());
$('#bLock').addEventListener('click', () => { if (net.isHost) net.send({ t: 'lock', on: !net.room?.locked }); else UI.toast('Only the host can lock the room.'); });
// host: route changes go through the normal action path so they land in the world snapshot
$('#lobRoute').addEventListener('change', (e) => { if (net.inRoom && net.isHost) applyAct(myId(), { k: 'route', r: e.target.value }); });

let settingsFrom = null;
function openSettings(from) {
  settingsFrom = from;
  $('#setQuality').value = qualityPref;
  $('#setQualityNote').textContent = `Now using: ${quality}${qualityPref === 'auto' ? ' (auto)' : ''}.`;
  $('#volMaster').value = audio.vol.master; $('#volMusic').value = audio.vol.music; $('#volSfx').value = audio.vol.sfx;
  UI.show('#settings', true);
}
$('#bSettings').addEventListener('click', () => openSettings('menu'));
$('#bSettingsP').addEventListener('click', () => openSettings('pause'));
$('#bSetClose').addEventListener('click', () => UI.show('#settings', false));
// touch control layout editor (Settings -> Edit controls)
UI.show('#setCtlRow', isTouch); UI.show('#setCtlNote', isTouch);
initControls({ staff: () => !$('#btnAdmin').classList.contains('hidden'), done: () => openSettings(settingsFrom) });
$('#bEditCtl').addEventListener('click', () => { UI.show('#settings', false); openEditor(); });
$('#bResetCtl').addEventListener('click', () => { resetLayout(); UI.toast('Controls reset to the default layout for this orientation.'); });
$('#setQuality').addEventListener('change', (e) => {
  localStorage.setItem(QKEY, e.target.value);
  $('#setQualityNote').textContent = playing ? 'Saved. Applies next time you open the game (or reload now).' : 'Saved. Reloading…';
  if (!playing) setTimeout(() => location.reload(), 300);
});
for (const [id, k] of [['#volMaster', 'master'], ['#volMusic', 'music'], ['#volSfx', 'sfx']]) $(id).addEventListener('input', (e) => { audio.setVolume(k, Number(e.target.value)); if (k === 'sfx') audio.play('click'); });
for (const [id, w] of [['#cpLights', 'lights'], ['#cpBelt', 'seatbelt'], ['#cpPA', 'announce'], ['#cpGear', 'gear']]) $(id).addEventListener('click', () => { if (me.mode === 'copilot') systemAct(w); });
$('#cpLeave').addEventListener('click', () => leaveSeat());
document.addEventListener('click', (e) => { if (e.target.closest?.('button')) audio.play('click'); }, true);
audio.startMusic();

// ---------------- saved stats ----------------
async function reportFlight(res) {
  // keyed by the flight's timestamp: the host's result object is mirrored to guests, so no flags on it
  if (!user || !res || reportedFlights.has(res.at)) return;
  markReported(res.at);
  if (res.time < 10) return; // aborted on the ground
  try {
    const csrf = (await (await fetch('/api/csrf', { credentials: 'same-origin' })).json()).csrfToken;
    const body = { score: Math.max(-100000, Math.min(100000, Math.round(res.payout ?? res.total))), stars: res.stars, landing: res.landing || 'none', route: ROUTES[res.route] ? res.route : 'CRP', crashed: !!res.crashed, duration: Math.min(7200, res.time), coop: !!net.inRoom };
    const r = await fetch('/api/game/sky-crew/flights', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) });
    if (r.ok) { const j = await r.json(); UI.toast(`Payout saved to your profile · ${j.stats.flights} flights, best ₵${j.stats.bestScore}.`); lastReport = j; }
  } catch { /* offline: stats are a bonus */ }
}
let lastReport = null;
// remembered across reloads so rejoining a room still showing the results doesn't report twice
const reportedFlights = new Set((() => { try { return JSON.parse(localStorage.getItem('skycrew.reported') || '[]'); } catch { return []; } })());
function markReported(at) {
  reportedFlights.add(at);
  try { localStorage.setItem('skycrew.reported', JSON.stringify([...reportedFlights].slice(-30))); } catch { /* private mode */ }
}

function sendState() {
  const held = heldItem();
  net.send({ t: 'st', s: { p: [me.pos.x, me.pos.y, me.pos.z], ry: me.yaw, pt: me.pitch, held: held ? held.id : null, mode: me.mode, moving: me.moving, run: !!me.sprint, fly: !!me.flying } });
}
// ---------------- pre-flight airport terminal ----------------
// Solo: steps are local. Co-op: the GAME SERVER owns each player's step (in order, at the desk, at human speed);
// the host refuses to leave the gate until every visible crew member is aboard.
const termLocal = { step: 'none', bag: false, pending: null, pendingAt: 0, lastHold: 0 };
const SKIP_KEY = 'skycrew.skipAirport';
function airportOn() { return net.inRoom ? net.room?.airport !== false : localStorage.getItem(SKIP_KEY) !== '1'; }
function terminalActive() { return airportOn() && sim.groundOn && sim.phase === 'boarding'; }
function myStep() { if (!net.inRoom) return termLocal.step; return net.room?.players.find((p) => p.cid === net.cid)?.term || 'none'; }
function resetTermLocal() { termLocal.step = 'none'; termLocal.bag = false; termLocal.pending = null; terminal.resetBag(); }
function crewStatus() {
  const list = net.inRoom ? (net.room?.players || []).map((p) => ({ name: p.displayName || p.username, step: p.term || 'none', me: p.cid === net.cid })) : [{ name: 'You', step: termLocal.step, me: true }];
  return { list, ready: !airportOn() || list.every((p) => p.step === 'boarded') };
}
const DOC = { none: '🛂 Passport', checkin: '🎫 Boarding pass · Gate A1', security: '🎫 Boarding pass · Gate A1', gate: '🎫✔ Pass scanned · walk to the plane', boarded: '✅ Aboard' };
function terminalRows() {
  if (!airportOn()) return [];
  const si = stepIdx(myStep()), rows = [];
  const mk = (i, text) => rows.push({ text, state: si > i ? 'done' : si === i ? 'warn' : '' });
  mk(0, '① Check in at the orange desk (passport)');
  mk(1, termLocal.bag || si > 1 ? '② Walk through the scanner arch' : '② Bag on the X-ray belt, then the scanner');
  mk(2, '③ Show your boarding pass at Gate A1');
  mk(3, '④ Walk down to the plane and board');
  const cs = crewStatus();
  if (cs.list.length > 1) { const n = cs.list.filter((p) => p.step === 'boarded').length; rows.push({ text: `Crew aboard ${n}/${cs.list.length}${n < cs.list.length ? ` · waiting for ${cs.list.filter((p) => p.step !== 'boarded').map((p) => p.name).slice(0, 3).join(', ')}` : ' · ready to go!'}`, state: n === cs.list.length ? 'done' : '' }); }
  return rows;
}
function termTarget(ip, held) {
  if (!terminalActive()) return null;
  const si = stepIdx(myStep());
  if (ip.kind === 'term_checkin') return si === 0 ? { ...ip, label: 'Hand over your passport (check in)' } : { ...ip, kind: 'term_info', label: '✓ Checked in: head to security' };
  if (ip.kind === 'term_belt') return si === 0 ? { ...ip, kind: 'term_info', label: 'Check in at the orange desk first' } : si === 1 && !termLocal.bag ? { ...ip, label: held ? 'Hands full: put it down first' : 'Put your bag on the X-ray belt' } : si === 1 ? { ...ip, kind: 'term_info', label: 'Your bag is in the scanner: walk through the arch' } : null;
  if (ip.kind === 'term_gate') return si < 2 ? { ...ip, kind: 'term_info', label: 'Go through security first' } : si === 2 ? { ...ip, label: 'Show your boarding pass' } : { ...ip, kind: 'term_info', label: '✓ Pass scanned: walk to the plane' };
  return null;
}
function termInteract(t) {
  if (t.kind === 'term_info') { UI.toast(t.label); return; }
  if (t.kind === 'term_checkin') return termStep('checkin');
  if (t.kind === 'term_belt') { if (heldItem() || heldPax()) return UI.toast('Put down what you are carrying first.'); termLocal.bag = true; terminal.startBag(); audio.play('click'); UI.toast('🧳 Bag on the belt. Now walk through the scanner arch!'); return; }
  if (t.kind === 'term_gate') return termStep('gate');
}
const STEP_DONE = {
  checkin: () => { terminal.cheer('checkin'); audio.play('stamp'); UI.toast('🎫 Checked in! Here is your boarding pass for Gate A1. Next: security.'); },
  security: () => { terminal.cheer('security', 1.2); UI.toast('✅ Security cleared. Gate A1 is straight ahead.'); },
  gate: () => { terminal.cheer('gate'); audio.play('stamp'); UI.toast('🛫 Pass scanned. Have a lovely flight! Walk down to the plane.'); },
  boarded: () => { UI.toast(crewStatus().ready ? '✅ You are aboard. Everyone is here: ready for departure!' : '✅ You are aboard. Waiting for the rest of the crew…'); },
};
function termStep(step) {
  if (termLocal.pending && performance.now() - termLocal.pendingAt < 4000) return;
  if (!net.inRoom) { termLocal.step = step; STEP_DONE[step]?.(); return; }
  termLocal.pending = step; termLocal.pendingAt = performance.now();
  sendState(); // the server checks where I am: give it my position right now
  net.send({ t: 'term', step });
}
net.addEventListener('term', (e) => { if (e.detail.cid !== net.cid) return; const p = net.room?.players.find((q) => q.cid === net.cid); if (p) p.term = e.detail.step; termLocal.pending = null; termLocal.retries = 0; STEP_DONE[e.detail.step]?.(); });
net.addEventListener('error', (e) => { if (!/^term_/.test(e.detail.code || '')) return; const step = termLocal.pending; termLocal.pending = null; termLocal.lastErr = e.detail.code;
  // "too fast" is just the human-speed rule: try once more a moment later (I'm still at the desk)
  if (e.detail.code === 'term_fast' && step && (termLocal.retries = (termLocal.retries || 0) + 1) <= 3) { setTimeout(() => { if (stepIdx(myStep()) === stepIdx(step) - 1) termStep(step); }, 1200); return; }
  termLocal.retries = 0; UI.toast(e.detail.message, 'warn'); });
let secCheckAt = 0;
function updateTerminal(dt) {
  terminal.update(dt, { dest: DEST, visible: sim.groundOn });
  if (!playing || !terminalActive()) { if ($('#docs').textContent) $('#docs').textContent = ''; return; }
  const si = stepIdx(myStep()), now = performance.now();
  // walked through the arch with the bag in the scanner
  if (si === 1 && termLocal.bag && terminal.bagDone() && me.pos.z < STATIONS.arch.z - 0.6 && me.pos.z > STATIONS.gate.z && Math.abs(me.pos.x - STATIONS.arch.x) < 3 && !termLocal.pending && now > secCheckAt) {
    secCheckAt = now + 4500;
    if (Math.random() < 0.15) { // purely cosmetic "random check"
      terminal.flashArch(0xffb627, 1.4); terminal.cheer('security', 1.4); audio.play('boop');
      UI.toast('🔎 Random check! The officer waves a beeping wand… beep… boop… all clear, enjoy your flight!');
      setTimeout(() => termStep('security'), 1400);
    } else { terminal.flashArch(0x3ddc84, 1.0); audio.play('beep'); termStep('security'); }
  }
  if (si === 3 && sim.inCabin(me.pos) && !termLocal.pending && now > secCheckAt) { secCheckAt = now + 2500; termStep('boarded'); }
  const d = $('#docs'); const txt = DOC[myStep()] || DOC.none;
  if (d.textContent !== txt) d.textContent = txt;
}
/** The plane can't leave the gate until the whole crew has boarded through the terminal. */
function holdAtGate(f) {
  if (sim.phase !== 'boarding' || !f.onGround || crewStatus().ready) return;
  if (f.throttle > 0 || f.speed > 0.2) {
    f.throttle = 0; f.speed = 0;
    if (amPilot() && performance.now() - termLocal.lastHold > 6000) { termLocal.lastHold = performance.now(); const cs = crewStatus(); UI.toast(`🛑 Wait for the whole crew to board (${cs.list.filter((p) => p.step === 'boarded').length}/${cs.list.length} aboard).`, 'warn'); }
  }
}
function setAirport(on) {
  if (net.inRoom) { if (!net.isHost && myRole !== 'DEVELOPER') return UI.toast('Only the host can change that.'); net.send({ t: 'airport', skip: !on }); return; }
  localStorage.setItem(SKIP_KEY, on ? '0' : '1'); applyAirport();
}
let airportSeen = null;
function applyAirport() {
  const on = airportOn();
  sim.setAirport(on);
  $('#setSkipAirport').checked = !on; $('#lobSkipAirport').checked = !on;
  if (airportSeen === on) return; const first = airportSeen === null; airportSeen = on;
  if (first || !playing || sim.phase !== 'boarding' || me.mode !== 'walk') return;
  const inside = me.pos.z > STATIONS.gate.z - 0.3 && me.pos.y < -1;
  if (on && myStep() !== 'boarded' && !inside) { resetTermLocal(); me.pos.copy(TERM_SPAWN); me.yaw = 0; UI.toast('🛂 The airport is open: check in at the terminal.'); }
  if (!on && inside) { me.pos.copy(SPAWN); me.yaw = 0.45; UI.toast('⏩ Airport skipped for this round.'); }
}
$('#setSkipAirport').addEventListener('change', (e) => setAirport(!e.target.checked));
$('#lobSkipAirport').addEventListener('change', (e) => setAirport(!e.target.checked));
applyAirport();

// ---------------- outfits, shop, classes, salary (server-checked) ----------------
const shopOpen = () => !$('#shop').classList.contains('hidden');
function shopCtx() {
  return { outfit: myOutfit, klass: myClass, inRoom: net.inRoom, phase: sim.phase, toast: (m) => UI.toast(m, 'warn'), setOutfit, pickClass, onBalance: updateWalletHud };
}
function openShop(tab) {
  if (tab) import('./shop.js').then((m) => { m.shopState.tab = tab; });
  $('#shopMsg').textContent = '';
  UI.show('#shop', true); document.exitPointerLock?.();
  renderShop(shopCtx());
  loadWallet().then(() => { if (shopOpen()) renderShop(shopCtx()); updateWalletHud(); });
}
function closeShop() { UI.show('#shop', false); }
$('#shopClose').addEventListener('click', closeShop);
$('#bShop').addEventListener('click', () => openShop());
$('#bShopP').addEventListener('click', () => { paused = false; UI.show('#pause', false); openShop('outfit'); });
$('#bResShop').addEventListener('click', () => openShop('class'));
$('#bLobShop').addEventListener('click', () => openShop('class'));
function updateWalletHud() {
  const h = $('#hudWallet');
  h.textContent = `₵ ${Math.round(wallet.balance).toLocaleString('en-US')}${myClass ? ` · ${CLASS_INFO[myClass]?.icon || ''} ${CLASS_INFO[myClass]?.name || ''}` : ''}`;
  UI.show('#hudWallet', !!(user && playing));
}
async function setOutfit(o) {
  const keys = [`outfit:${o.outfit}`, `hat:${o.hat}`, `color:${o.color}`];
  const missing = keys.find((k) => !owns(k));
  if (missing) { $('#shopMsg').textContent = 'Buy it first.'; return; }
  myOutfit = { ...o }; dressMe();
  try { localStorage.setItem('skycrew.outfit', JSON.stringify(myOutfit)); } catch { /* private mode */ }
  if (shopOpen()) renderShop(shopCtx());
  if (!user) return;
  try { await api('PUT', '/api/game/sky-crew/outfit', { outfit: myOutfit }); } catch (e) { $('#shopMsg').textContent = e.message || 'Could not save the outfit.'; }
  if (net.connected) net.send({ t: 'outfit', outfit: myOutfit });
}
let classWait = null;
async function pickClass(id) {
  if (id && !owns(`class:${id}`)) { $('#shopMsg').textContent = 'Buy this class first.'; return; }
  if (net.inRoom) {
    net.send({ t: 'class', id: id || null });
    const r = await new Promise((res) => { classWait = res; setTimeout(() => { if (classWait === res) { classWait = null; res({ error: 'The server did not answer.' }); } }, 5000); });
    if (r.error) { $('#shopMsg').textContent = r.error; return; }
    myClass = r.id || null;
  } else myClass = id || null;
  $('#shopMsg').textContent = myClass ? `${CLASS_INFO[myClass].icon} ${CLASS_INFO[myClass].name} picked: ${CLASS_INFO[myClass].perk}` : 'Flying without a class.';
  updateWalletHud(); renderLobby();
  if (shopOpen()) renderShop(shopCtx());
}
net.addEventListener('class', (e) => { if (classWait) { const w = classWait; classWait = null; w({ id: e.detail.id }); } });
net.addEventListener('outfit', (e) => { const p = net.room?.players.find((q) => q.cid === e.detail.cid); if (p) { p.outfit = e.detail.outfit; syncRemotes(net.room); } });
net.addEventListener('wallet', (e) => {
  const d = e.detail; wallet.balance = d.balance;
  UI.toast(d.item ? `🎁 ${d.by} ${d.removed ? 'removed' : 'gave you'} ${wallet.catalog.find((i) => i.key === d.item)?.name || d.item}.` : `🎁 ${d.by} ${d.credits >= 0 ? 'gave you' : 'took'} ${fmtC(Math.abs(d.credits))}.`);
  loadWallet().then(() => { if (myClass && !owns(`class:${myClass}`)) myClass = null; updateWalletHud(); if (shopOpen()) renderShop(shopCtx()); });
});
let lastSalary = null;
function showSalary() {
  const box = $('#resSalary'); box.classList.add('muted');
  if (lastSalary && Date.now() - lastSalary.at < 30000) return renderSalary(lastSalary.d);
  box.textContent = !user ? '💼 Guests are not paid. Sign in and fly online to earn a salary.' : !net.inRoom ? '💼 Solo flights don\'t pay a salary. Create an online room (even just for you) to get paid.' : '💼 Waiting for the payslip from the airline…';
}
net.addEventListener('salary', (e) => { lastSalary = { d: e.detail, at: Date.now() }; renderSalary(e.detail); if (e.detail.amount > 0 && !e.detail.duplicate) UI.toast(`💼 Salary paid: +${fmtC(e.detail.amount)} (wallet ${fmtC(e.detail.balance)})`); });
function renderSalary(d) {
  const box = $('#resSalary');
  if (d.amount > 0 || d.duplicate) {
    wallet.balance = d.balance;
    box.replaceChildren(UI.el('b', { class: 'pos' }, `💼 Salary ${d.duplicate ? 'already paid' : `+${fmtC(d.amount)}`}`), ` · wallet ${fmtC(d.balance)}`);
  } else box.textContent = `💼 No salary this time: ${d.reason || 'the flight did not qualify.'}`;
  box.classList.remove('muted');
  updateWalletHud();
}
const errMsg = { not_owned: 'You do not own that yet.', class_locked: 'Classes are picked before takeoff.', bad_class: 'Unknown class.', bad_outfit: 'That outfit is not available.' };
net.addEventListener('error', (e) => { const m = errMsg[e.detail.code]; if (!m) return; if (classWait) { const w = classWait; classWait = null; w({ error: e.detail.message || m }); } else UI.toast(e.detail.message || m, 'warn'); });

const user = await Net.me();
if (user) {
  myRole = user.role;
  const handle = user.handle || user.username;
  const shown = user.displayName || handle;
  $('#meLine').replaceChildren('Signed in as ', UI.rankBadge(user.role), UI.el('span', { class: `name-${user.role.toLowerCase()}` }, shown), shown !== handle ? ` (@${handle})` : '', '. Co-op rooms use your Batlas rank.');
  $('#bCreate').disabled = false; $('#bJoin').disabled = false;
  await loadWallet();
  try { const o = await api('GET', '/api/game/sky-crew/outfit'); if (o?.outfit) { myOutfit = o.outfit; dressMe(); } } catch { /* keep the local look */ }
} else {
  $('#meLine').replaceChildren('Playing as a guest (solo). ', UI.el('a', { href: '/login?next=/play/sky-crew', class: 'back' }, 'Sign in'), ' to play co-op with friends.');
}
const qs = new URLSearchParams(location.search);
if (qs.get('room') && user) $('#joinCode').value = qs.get('room').toUpperCase().slice(0, 5);
// from the Developer dashboard's live room list (the game server re-checks the rank)
if (qs.get('devjoin') && user) setTimeout(() => devJoin(qs.get('devjoin').toUpperCase().slice(0, 5), qs.get('hidden') === '1'), 50);

// ---------------- sound per frame ----------------
const lastDoors = { rear: ship.doors.rear.open, cargo: ship.doors.cargo.open };
let lastTd = null;
function updateAudio() {
  const f = sim.flight;
  const inside = me.mode !== 'walk' || sim.inCabin(me.pos);
  audio.update({ engines: sim.phase !== 'boarding' || f.throttle > 0, throttle: Math.max(f.throttle, sim.phase === 'boarding' ? 0 : 0.15), speed: f.speed, onGround: f.onGround, inside, storm: sim.weather === 'storm', turb: sim.turb });
  for (const n of ['rear', 'cargo']) if (ship.doors[n].open !== lastDoors[n]) { lastDoors[n] = ship.doors[n].open; audio.play('door'); }
  if (f.touchdown && f.touchdown.at !== lastTd) { lastTd = f.touchdown.at; audio.play(f.touchdown.crash ? 'crash' : 'thump', { hard: f.touchdown.hard ? 0.6 : 0 }); }
}

// ---------------- main loop ----------------
const clock = new THREE.Clock();
const perfStat = { frames: 0, t0: performance.now(), fps: 0 };
const RENDER_CAP = Math.max(0, Math.min(60, Number(qs.get('fps')) || 0));
let lastRender = 0, forceRender = false;
function frame() {
  perfStat.frames++; { const n = performance.now(); if (n - perfStat.t0 > 1000) { perfStat.fps = perfStat.frames * 1000 / (n - perfStat.t0); perfStat.frames = 0; perfStat.t0 = n; } }
  const dt = Math.min(0.05, clock.getDelta());
  if (sim.seed !== seenSeed) { seenSeed = sim.seed; if (playing) respawn(); }
  if (playing && !paused) updatePlayer(dt);
  updateFlight(dt);
  if (sim.host) sim.update(dt, { onDepart() {} });
  else sim.follow(dt);
  ship.update(dt); // eased door animation (both directions) + cabin details
  if (Q.shadow && quality !== 'high' && (keyShadowT += dt) > 0.083) { keyShadowT = 0; ship.cabin.key.shadow.needsUpdate = true; }
  sim.animate(dt);
  placeHeld();
  updateRemotes(dt);
  updateTerminal(dt);
  gadgets.update(dt, { remotes });
  updateSplashes(dt);
  updateWeather(dt);
  // my own body (visible in third person)
  myAvatar.visible = (me.third || shopOpen()) && me.mode === 'walk';
  myAvatar.position.copy(me.pos); myAvatar.rotation.y = me.yaw;
  animateCharacter(myAvatar, dt, { moving: me.moving && me.onGround, running: me.moving && me.sprint, carrying: !!heldItem() || !!heldPax(), jumping: !me.onGround && me.mode === 'walk' });
  updateCamera();
  if (playing) { updateHud(); netTick(dt); updateAudio(); }
  // ?fps=N caps how often the 3D view is DRAWN (the game itself keeps running every frame): used by multi-client
  // tests on software GL, and handy on very weak devices.
  const nowR = performance.now();
  if (!RENDER_CAP || forceRender || nowR - lastRender >= 1000 / RENDER_CAP) { renderer.render(scene, camera); lastRender = nowR; forceRender = false; }
  requestAnimationFrame(frame);
}
UI.show('#loading', false);
requestAnimationFrame(frame);

// ---------------- test / debug hooks (used by the automated browser tests) ----------------
window.skyCrew = {
  ready: true,
  shouldRotate: shouldShowRotateHint,
  rotate: () => rotateHint.debug(),
  state: () => ({ playing, paused, phase: sim.phase, host: sim.host, doors: { rear: ship.doors.rear.open, cargo: ship.doors.cargo.open, rearT: +ship.doors.rear.t.toFixed(3), cargoT: +ship.doors.cargo.t.toFixed(3), rearPassable: ship.doors.rear.passable }, seed: sim.seed, dest: DEST.code, lobby: !$('#lobby').classList.contains('hidden'), me: { x: me.pos.x, y: me.pos.y, z: me.pos.z, mode: me.mode, onGround: me.onGround }, held: heldItem()?.type || null, counts: sim.counts, flight: { ...sim.planeState() }, room: net.room && { code: net.room.code, pilotCid: net.room.pilotCid ?? null, hidden: !!net.room.hidden, locked: !!net.room.locked, airport: net.room.airport, players: net.room.players.map((p) => ({ username: p.username, role: p.role })) }, remotes: [...remotes.values()].map((r) => ({ username: r.info.username, x: r.mesh.position.x, z: r.mesh.position.z })), results: sim.results }),
  teleport: (x, y, z) => { me.pos.set(x, y, z); me.vel.set(0, 0, 0); },
  look: (yaw, pitch) => { me.yaw = yaw; me.pitch = pitch; },
  lookAt: (x, y, z) => { const e = eyePos(); const d = new THREE.Vector3(x, y, z).sub(e); me.yaw = Math.atan2(-d.x, -d.z); me.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); },
  items: () => [...sim.items.values()].map((i) => ({ id: i.id, type: i.type, x: i.mesh.position.x, y: i.mesh.position.y, z: i.mesh.position.z, heldBy: i.heldBy })),
  net,
  target: () => { const t = findTarget(); return t && { kind: t.kind, label: t.label }; },
  interact, takeSeat, leaveSeat,
  key: (code, down) => (down ? keys.add(code) : keys.delete(code)),
  third: (v) => { me.third = v; },
  setFlight: (o) => Object.assign(sim.flight, o),
  dest: () => ({ ...DEST }),
  route: (code) => { if (net.inRoom && net.isHost) applyAct(myId(), { k: 'route', r: code }); else { setRoute(code); refreshRouteUi(); } return DEST.code; },
  takeCopilot, system: systemAct,
  cabin: () => ({ ...sim.cabin }),
  checklist: () => sim.checklist(),
  glide: () => glidePath(sim.flight),
  quality: () => ({ pref: qualityPref, quality, shadows: renderer.shadowMap.enabled }),
  audio: () => ({ ready: audio.ready, music: audio.musicOn, vol: { ...audio.vol } }),
  crew: (role) => net.send({ t: 'crew', role }),
  myCrew: () => myCrew,
  lastReport: () => lastReport,
  paxLooks: () => sim.pax.map((p) => p.look || null),
  pax: () => sim.pax.map((p) => ({ id: p.id, state: p.state, carriedBy: p.carriedBy || null, x: p.mesh.position.x, y: p.mesh.position.y, z: p.mesh.position.z, mood: Math.round(p.mood), panic: p.panicT > 0, chute: !!p.fx?.chute?.visible, frozen: (p.frozenT || 0) > 0, sizeK: p.sizeK || 1, cheer: (p.cheerT || 0) > 0, vip: p.id >= 900 })),
  controls: () => controlsDebug(),
  editControls: () => { UI.show('#settings', false); openEditor(); },
  term: () => ({ step: myStep(), local: termLocal.step, lastErr: termLocal.lastErr || null, airport: airportOn(), active: terminalActive(), bag: termLocal.bag, bagDone: terminal.bagDone(), crew: crewStatus(), docs: $('#docs').textContent, solids: solids().filter((c) => c.tag?.startsWith('term:')).map((c) => c.tag), paxInTerminal: sim.pax.filter((p) => p.mesh.position.z > STATIONS.gate.z && p.mesh.position.y < -1).length }),
  useE: () => interact(),
  locker: () => ({ outfit: myOutfit, klass: myClass, balance: wallet.balance, owned: [...wallet.owned], ownsAll: wallet.ownsAll, signedIn: wallet.signedIn, remotes: [...remotes].map(([, r]) => ({ username: r.info.username, key: r.key, klass: r.info.klass || null })), crewClasses: sim.classes(), hud: $('#hudWallet').textContent, salary: $('#resSalary').textContent, avatarOutfit: myAvatar.userData.look?.crew || null }),
  openShop: (t) => openShop(t),
  perks: () => ({ pilotClass: sim.pilotClass(), tailwind: sim.flight.tailwind || 1, pending: (sim.pendingEv || []).map((e) => e.id), score: { caught: sim.score.caught || 0, landing: sim.score.landing } }),
  gadgets: () => ({ mine: [...gadgets.mine()], tool: gadgets.tool(), mode: gadgets.mode, fx: gadgets.fx.length, frozenT: gadgets.frozenT, sizeK: gadgets.sizeK, scale: myAvatar.scale.x, flying: !!me.flying, frozen: !!me.frozen, iced: !!myAvatar.userData.ice, attach: Object.keys(gadgets.attach.get(myId()) || {}), grav: !!sim.grav, inv: devInv ? devInv.items.map((i) => i.id) : null, remoteGear: Object.fromEntries([...gadgets.gear].filter(([c]) => c !== myId()).map(([c, g]) => [remotes.get(c)?.info.username || c, [...g]])), remoteAttach: Object.fromEntries([...remotes].map(([c, r]) => [r.info.username, Object.keys(gadgets.attach.get(c) || {})])) }),
  fire: (alt) => fireGadget(!!alt),
  draw: () => { forceRender = true; },
  hour: () => sim.hour, config: () => sim.config,
  panelTabs: () => [...document.querySelectorAll('#admTabs [data-tab]')].map((b) => b.dataset.tab),
  openPanel: (v = true) => toggleAdmin(v),
  chat: (t) => net.send({ t: 'chat', text: t }),
  heldPax: () => heldPax()?.id ?? null,
  devJoin, liveRooms: () => net.rooms(),
  admin: (cmd, args) => net.admin(cmd, args),
  lockRoom: (on) => net.send({ t: 'lock', on }),
  throwHeld, dropPax,
  contract: (c) => { if (c) { if (net.inRoom && net.isHost) applyAct(myId(), { k: 'contract', c }); else sim.contract = c; } return sim.contract; },
  debug: {
    sitAll: () => sim.npcAction('sit'),
    pax: () => sim.pax.map((q) => ({ state: q.state, x: +q.mesh.position.x.toFixed(2), y: +q.mesh.position.y.toFixed(2), z: +q.mesh.position.z.toFixed(2), visible: q.mesh.visible })),
    tris: () => { const out = []; scene.traverse((o) => { if (o.isMesh && o.geometry) { const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); let k = o, path = []; while (k && k !== scene) { path.push(k.name || k.type); k = k.parent; } out.push([path.reverse().join('/'), Math.round(n)]); } }); const agg = {}; for (const [p, n] of out) { const key = p.split('/').slice(0, 3).join('/'); agg[key] = (agg[key] || 0) + n; } return Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 25); },
    planeTris: () => ship.plane.children.filter((o) => o.isMesh).map((o) => [o.name || '?', o.material?.type, Math.round((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3)]).sort((a, b) => b[2] - a[2]).slice(0, 12),
    perf: () => ({ fps: Math.round(perfStat.fps * 10) / 10, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, quality, shadows: renderer.shadowMap.enabled }),
    door: (name, open) => { if (sim.host) sim.setDoor(name, open); return { open: ship.doors[name].open, t: ship.doors[name].t }; },
    setPos: (x, y, z, yaw) => { me.pos.set(x, y, z); me.vel.set(0, 0, 0); if (yaw != null) me.yaw = yaw; },
    trigger: (id) => sim.trigger(id),
    request: (i, item) => { const p = sim.pax[i]; p.request = item; p.reqT = 0; return { x: p.mesh.position.x, z: p.mesh.position.z }; },
    score: () => ({ ...sim.score }),
    events: () => sim.events.filter((e) => !e.done).map((e) => e.id),
    emerg: () => ({ engineFail: !!sim.flight.engineFail, masks: !!ship.masks.visible, landing: sim.emergencyLanding ? Math.round(sim.emergencyLanding.limit - sim.emergencyLanding.t) : null, hud: [...document.querySelectorAll('#hud *')].some((n) => /EMERGENCY LANDING/.test(n.textContent || '')) }),
    cam: (pos, at) => { camOverride = pos ? { pos, at } : null; },
    watchEject: (on = true) => { camOverride = on ? { eject: true } : null; },
    colsAt: (x, y, z) => solids().filter((c) => overlaps({ x, y, z }, c, H)).map((c) => ({ min: c.min, max: c.max, tag: c.tag })),
    interactPoint: (id) => { const p = ship.interact.find((i) => i.id === id).pos; return { x: p.x, y: p.y, z: p.z }; },
  },
};
