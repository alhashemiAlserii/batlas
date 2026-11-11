// Game simulation: luggage physics, passengers, events, phases and scoring.
// The HOST (or a solo player) runs the full simulation; other clients render snapshots.
import * as THREE from '../../vendor/three.module.js';
import * as CANNON from '../../vendor/cannon-es.js';
import { makeCharacter, animateCharacter, randomPassengerLook, bubble } from './characters.js';
import { HALF_W, Z_TAIL, Z_NOSE, CEIL, GEAR_H, DEST, ORIGIN, ROUTES, MATERIALS, setRoute, REAR_DOOR, CARGO_DOOR, Z_HOLD0, Z_HOLD1 } from './world.js';
import { newFlight, distTo } from './flight.js';
import { paxTerminalPath, paxTerminalStart } from './terminal.js';
import { landingGrade, fixDeadline, securityCatches, crewHas, PERK, CLASS_INFO } from './perks.js';

export const ITEM_DEFS = {
  suitcase: { size: [0.55, 0.38, 0.26], mass: 14, colors: [0xe74c3c, 0x2980b9, 0x27ae60, 0x8e44ad, 0xf39c12, 0x34495e], label: 'suitcase', bag: true },
  duffel: { size: [0.65, 0.32, 0.32], mass: 9, colors: [0x16a085, 0xd35400, 0x2c3e50, 0xc0392b], label: 'duffel bag', bag: true },
  water: { size: [0.12, 0.28, 0.12], mass: 1, colors: [0x4cc3ff], label: 'water', service: true },
  snack: { size: [0.3, 0.12, 0.22], mass: 1, colors: [0xf5a623], label: 'snack box', service: true },
  blanket: { size: [0.4, 0.15, 0.3], mass: 1.5, colors: [0x7c5cff], label: 'blanket', service: true },
  beach_ball: { size: [0.6, 0.6, 0.6], mass: 0.6, colors: [0xff7675], label: 'beach ball', ball: true },
  giant_duck: { size: [0.8, 0.8, 0.9], mass: 4, colors: [0xffd32a], label: 'giant rubber duck' },
  traffic_cone: { size: [0.4, 0.7, 0.4], mass: 3, colors: [0xff6b00], label: 'traffic cone' },
  // Developer gadget cases: spawned only by the server's developer tier (ids dv*); picking one up equips it
  plasma_blaster: { size: [0.5, 0.22, 0.34], mass: 3, colors: [0x2ad4ff], label: 'Plasma Blaster case', gadget: true },
  ion_beam: { size: [0.5, 0.22, 0.34], mass: 3, colors: [0x8a7dff], label: 'Ion Beam case', gadget: true },
  wave_cannon: { size: [0.5, 0.22, 0.34], mass: 3, colors: [0x3aa0ff], label: 'Wave Cannon case', gadget: true },
  gravity_gun: { size: [0.5, 0.22, 0.34], mass: 3, colors: [0xff9f1a], label: 'Gravity Gun case', gadget: true },
  freeze_ray: { size: [0.5, 0.22, 0.34], mass: 3, colors: [0x9fe8ff], label: 'Freeze Ray case', gadget: true },
  size_ray: { size: [0.5, 0.22, 0.34], mass: 3, colors: [0x5dff8a], label: 'Shrink/Grow Ray case', gadget: true },
  teleport_gun: { size: [0.5, 0.22, 0.34], mass: 3, colors: [0xd06bff], label: 'Teleport Gun case', gadget: true },
  confetti_cannon: { size: [0.5, 0.22, 0.34], mass: 3, colors: [0xff5fa2], label: 'Confetti Cannon case', gadget: true },
};
const PERSONALITIES = {
  worrier: { wants: ['water'], decay: 1.2, panicMult: 2, label: 'Worrier' },
  snacker: { wants: ['snack'], decay: 1, panicMult: 1, label: 'Snacker' },
  napper: { wants: ['blanket'], decay: 0.8, panicMult: 1, label: 'Napper', sleeps: true },
  critic: { wants: ['water', 'snack', 'blanket'], decay: 2, panicMult: 1.2, label: 'Critic' },
  tourist: { wants: ['snack', 'water'], decay: 0.9, panicMult: 1, label: 'Tourist' },
};
export const PAX_COUNT = 16; const BAG_COUNT = 8;

export function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class Sim {
  constructor({ ship, eventsConfig, onToast }) {
    this.ship = ship; // result of buildPlane()
    this.cfg = eventsConfig;
    this.toast = onToast || (() => {});
    this.host = true;
    this.airport = true; // passengers (and crew) walk through the pre-flight terminal
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.world.defaultContactMaterial.friction = 0.45;
    this.world.defaultContactMaterial.restitution = 0.15;
    this.statics = [];
    for (const c of ship.colliders) {
      const he = new CANNON.Vec3((c.max[0] - c.min[0]) / 2, (c.max[1] - c.min[1]) / 2, (c.max[2] - c.min[2]) / 2);
      const b = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, shape: new CANNON.Box(he) });
      b.position.set((c.max[0] + c.min[0]) / 2, (c.max[1] + c.min[1]) / 2, (c.max[2] + c.min[2]) / 2);
      b.userData = { tag: c.tag, collider: c };
      this.world.addBody(b);
      this.statics.push(b);
    }
    this.items = new Map();
    this.pax = [];
    this.reset(Math.floor(Math.random() * 1e9));
  }

  // ---------------- lifecycle ----------------
  reset(seed) {
    for (const it of this.items.values()) this.removeItem(it.id);
    for (const p of this.pax) this.ship.plane.remove(p.mesh);
    this.items.clear(); this.pax = [];
    this.seed = seed; this.rng = mulberry32(seed);
    this.phase = 'boarding'; this.t = 0; this.flightT = 0; this.nextId = 1;
    this.flight = newFlight();
    this.events = []; this.pendingEv = []; this.cool = {}; this.eventClock = 0;
    this.weather = this.weather || 'clear'; this.hour = this.hour ?? 13; this.turb = 0; this.emergencyLanding = null;
    this.cabin = { lights: true, seatbelt: false, gearDown: true, announced: 0, lastAnnounce: -99 };
    this.applyCabin();
    this.score = { paxLost: 0, paxGrabbed: 0, bagsDamaged: 0, checklist: false, belly: false, wrongAirport: false, bagsLoaded: 0, bagsLeft: 0, paxBoarded: 0, paxLeft: 0, served: 0, failed: 0, calmed: 0, fixed: 0, fixFailed: 0, looseBags: 0, landing: null, landedAt: null, crashed: false, doorsOpen: 0 };
    this.results = null;
    this.setDoor('rear', true, true); this.setDoor('cargo', true, true);
    this.setGround(true);
    this.ship.masks.visible = false;
    // manifest luggage on the baggage cart by the cargo stairs
    for (let i = 0; i < BAG_COUNT; i++) {
      const type = i % 3 === 2 ? 'duffel' : 'suitcase';
      this.spawnItem(type, [6.9 + (i % 2) * 0.7, -GEAR_H + 0.3 + Math.floor(i / 4) * 0.45, -11.8 + (Math.floor(i / 2) % 2) * 0.9 + (i >= 4 ? 0.4 : 0)], { manifest: true });
    }
    // passengers (deterministic from seed so every client builds the same people)
    // Fisher-Yates with the seeded RNG (Array.sort with a random comparator differs between browsers)
    const seats = [...this.ship.seats];
    for (let i = seats.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [seats[i], seats[j]] = [seats[j], seats[i]]; }
    seats.length = PAX_COUNT;
    const kinds = Object.keys(PERSONALITIES);
    for (let i = 0; i < PAX_COUNT; i++) {
      const rnd = mulberry32(seed + i * 7919);
      const look = randomPassengerLook(mulberry32(seed + i * 104729)); // same seed => same people on every client
      const mesh = makeCharacter(look);
      const seat = seats[i];
      this.ship.plane.add(mesh);
      const p = { id: i + 1, kind: kinds[Math.floor(rnd() * kinds.length)], look, mesh, seat, path: null, wp: 0, state: 'queue', delay: 2 + i * (this.airport ? 2.2 : 2.6), request: null, reqT: 0, nextReq: 18 + rnd() * 30, mood: 70, panicT: 0, sleep: false, bubbleKind: null, bubble: null, dance: 0 };
      this.routePax(p, i);
      this.pax.push(p);
    }
  }
  /** Boarding route: through the airport terminal (check-in, scanner, gate) or straight from the apron queue. */
  routePax(p, i) {
    const start = this.airport ? paxTerminalStart(i) : new THREE.Vector3((i % 2 ? 1 : -1) * (1.2 + (i % 3) * 0.5), -GEAR_H, Z_TAIL + 8 + i * 1.3);
    p.mesh.position.copy(start);
    // up the rear air-stairs, through the REAR DOOR, forward along the aisle, then into the row
    const tail = [new THREE.Vector3(0, -GEAR_H, Z_TAIL + 3.5), new THREE.Vector3(0, 0, Z_TAIL + 0.15), new THREE.Vector3(0, 0, Z_TAIL - 1.2), new THREE.Vector3(0, 0, p.seat.z), new THREE.Vector3(p.seat.x, 0, p.seat.z)];
    p.path = this.airport ? [...paxTerminalPath(i), ...tail] : tail;
    p.doorWp = p.path.indexOf(tail[1]); p.wp = 0; p.pauseT = 0;
  }
  /** Host toggled the airport: passengers who haven't set off yet take the other route. */
  setAirport(on) {
    on = !!on; if (this.airport === on) return; this.airport = on;
    this.pax.forEach((p, i) => { if (p.state === 'queue' || (p.state === 'walk' && p.wp < (p.doorWp ?? 1) && !p.extra)) { p.state = 'queue'; p.delay = 1 + i * (on ? 2.2 : 2.6); this.routePax(p, i); } });
  }

  // ---------------- items ----------------
  spawnItem(type, pos, { manifest = false, id = null } = {}) {
    const def = ITEM_DEFS[type]; if (!def) return null;
    id = id || `i${this.nextId++}`;
    const [w, h, d] = def.size;
    const color = def.colors[Math.floor(Math.random() * def.colors.length)];
    let mesh;
    if (def.ball) mesh = new THREE.Mesh(new THREE.SphereGeometry(w / 2, 14, 10), new THREE.MeshLambertMaterial({ color }));
    else if (type === 'traffic_cone') mesh = new THREE.Mesh(new THREE.ConeGeometry(w / 2, h, 10), new THREE.MeshLambertMaterial({ color }));
    else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
      if (def.gadget) { // dark case with a glowing coloured band + handle
        mesh.material = new THREE.MeshStandardMaterial({ color: 0x1d2333, roughness: 0.4, metalness: 0.5 });
        const band = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, h * 0.28, d * 1.02), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4 }));
        mesh.add(band);
        const handle = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, 0.05, 0.05), MATERIALS.dark); handle.position.y = h / 2 + 0.03; mesh.add(handle);
      }
      if (def.bag) { const handle = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, 0.05, 0.05), MATERIALS.dark); handle.position.y = h / 2 + 0.03; mesh.add(handle); }
      if (type === 'giant_duck') { const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), mesh.material); head.position.set(0, 0.5, -0.25); mesh.add(head); const beak = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.2), new THREE.MeshLambertMaterial({ color: 0xff8c00 })); beak.position.set(0, 0.48, -0.5); mesh.add(beak); }
    }
    mesh.position.set(...pos);
    this.ship.plane.add(mesh);
    const shape = def.ball ? new CANNON.Sphere(w / 2) : new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2));
    const body = new CANNON.Body({ mass: def.mass, shape, linearDamping: 0.15, angularDamping: 0.3 });
    if (def.ball) body.material = new CANNON.Material({ restitution: 0.7 });
    body.position.set(...pos);
    body.allowSleep = true; body.sleepSpeedLimit = 0.15; body.sleepTimeLimit = 0.6;
    if (this.host) this.world.addBody(body);
    const it = { id, type, mesh, body, heldBy: null, manifest, inWorld: this.host, target: null };
    this.items.set(id, it);
    return it;
  }
  removeItem(id) {
    const it = this.items.get(id); if (!it) return;
    if (it.inWorld) this.world.removeBody(it.body);
    this.ship.plane.remove(it.mesh);
    this.items.delete(id);
  }
  grab(id, cid) {
    const it = this.items.get(id);
    if (!it || it.heldBy) return false;
    it.heldBy = cid;
    if (it.inWorld) { this.world.removeBody(it.body); it.inWorld = false; }
    return true;
  }
  drop(id, cid, pos, vel) {
    const it = this.items.get(id);
    if (!it || it.heldBy !== cid) return false;
    it.heldBy = null;
    if (vel && Math.hypot(...vel) > 3 && ITEM_DEFS[it.type].bag) it.damaged = true; // thrown luggage = broken souvenirs
    const p = this.safeDropPoint(pos);
    it.body.position.set(p[0], p[1], p[2]);
    it.body.velocity.set(...(vel || [0, 0, 0]).map((v) => Math.max(-8, Math.min(8, v))));
    it.body.angularVelocity.set(0, 0, 0);
    it.body.quaternion.set(0, 0, 0, 1);
    it.body.wakeUp();
    if (this.host && !it.inWorld) { this.world.addBody(it.body); it.inWorld = true; }
    return true;
  }
  /** Keep dropped items out of walls: nudge the point out of any solid collider. */
  safeDropPoint(p) {
    const q = [...p];
    for (const b of this.statics) {
      if (!b.collisionResponse) continue;
      const c = b.userData.collider;
      if (q[0] > c.min[0] - 0.2 && q[0] < c.max[0] + 0.2 && q[1] > c.min[1] - 0.2 && q[1] < c.max[1] + 0.2 && q[2] > c.min[2] - 0.2 && q[2] < c.max[2] + 0.2) {
        // push up and out along the smallest axis
        const pen = [[c.max[0] + 0.25 - q[0], 0, 1], [c.min[0] - 0.25 - q[0], 0, -1], [c.max[1] + 0.25 - q[1], 1, 1], [c.max[2] + 0.25 - q[2], 2, 1], [c.min[2] - 0.25 - q[2], 2, -1]];
        pen.sort((a, b) => Math.abs(a[0]) - Math.abs(b[0]));
        q[pen[0][1]] += pen[0][0];
      }
    }
    return q;
  }

  /** Doors animate (eased) in both directions; the opening becomes walkable halfway through the swing. */
  setDoor(name, open, instant = false) {
    const d = this.ship.doors[name]; if (!d) return;
    const statics = this.statics.filter((b) => b.userData.collider === d.collider);
    d.onPassable = (p) => { for (const b of statics) b.collisionResponse = !p; };
    d.apply(open, instant);
    if (instant) d.onPassable(d.passable);
  }
  setGround(on) {
    this.groundOn = on;
    for (const b of this.statics) if (b.userData.tag === 'ground') b.collisionResponse = on;
    this.ship.stairFront.visible = on; this.ship.stairCargo.visible = on;
  }
  inCargo(p) { return p.z > Z_HOLD0 + 0.05 && p.z < Z_HOLD1 - 0.05 && Math.abs(p.x) < HALF_W && p.y > -0.2 && p.y < CEIL; }
  inCabin(p) { return p.z > Z_NOSE && p.z < Z_TAIL && Math.abs(p.x) < HALF_W + 0.05 && p.y > -0.4 && p.y < CEIL + 0.2; }

  // ---------------- interaction (host-side resolution) ----------------
  // ---------------- carrying / throwing passengers (host authoritative) ----------------
  carrierOf(cid) { return this.pax.find((p) => p.carriedBy === cid) || null; }
  grabPax(id, cid) {
    const p = this.pax.find((x) => x.id === id);
    if (!p || ['lost', 'carried'].includes(p.state) || this.carrierOf(cid)) return false;
    p.prev = p.state; p.state = 'carried'; p.carriedBy = cid; p.request = null; p.sleep = false; p.vel = null;
    p.mood = Math.max(0, p.mood - 15); p.panicT = 3; this.score.paxGrabbed++;
    this.flash(p, 'complaint', 3);
    for (const q of this.pax) if (q !== p && q.state !== 'lost' && q.mesh.position.distanceTo(p.mesh.position) < 4.5) { q.panicT = Math.max(q.panicT, 2.5); q.mood = Math.max(0, q.mood - 5); }
    this.toast(['"PUT ME DOWN!"', '"This is NOT in the brochure!"', '"I paid for a window seat!"', '"Is this the upgrade?!"'][id % 4], 'info');
    return true;
  }
  dropPax(id, cid, pos, vel) {
    const p = this.pax.find((x) => x.id === id);
    if (!p || p.carriedBy !== cid) return false;
    p.carriedBy = null; p.state = 'thrown';
    p.mesh.position.set(...pos);
    p.vel = new THREE.Vector3(...(vel || [0, 0, 0]).map((v) => Math.max(-9, Math.min(9, v))));
    p.spin = Math.hypot(...(vel || [0, 0, 0])) > 2 ? 9 : 0;
    return true;
  }
  /** Where a body at plane-local `pos` would leave through an open door (or null). */
  openDoorAt(pos) {
    const dd = this.ship.doors;
    if (dd.rear.passable && pos.z > Z_TAIL - 0.6 && pos.x > REAR_DOOR.x0 + 0.05 && pos.x < REAR_DOOR.x1 - 0.05 && pos.y < REAR_DOOR.h - 0.25) return 'rear';
    if (dd.cargo.passable && pos.x > 0 && pos.z > CARGO_DOOR.z0 - 0.1 && pos.z < CARGO_DOOR.z1 + 0.1 && pos.y < 2.0) return 'cargo';
    return null;
  }
  /** Crew classes (from the server's room list, via main.js). */
  crew() { return this.crewInfo ? this.crewInfo() : []; }
  classes() { return this.crew().map((c) => c.cls).filter(Boolean); }
  updateThrown(p, dt) {
    const pos = p.mesh.position, v = p.vel || (p.vel = new THREE.Vector3());
    v.y -= 9.8 * dt;
    pos.addScaledVector(v, dt);
    if (p.spin) { p.mesh.rotation.x += p.spin * dt; p.spin *= 0.97; }
    const inside = Math.abs(pos.x) < HALF_W + 0.2 && pos.z > Z_NOSE && pos.z < Z_TAIL + 0.05 && pos.y > -0.3;
    if (inside) {
      const lim = HALF_W - 0.3, door = this.openDoorAt(pos);
      if (Math.abs(pos.x) > lim && door !== 'cargo') { pos.x = Math.sign(pos.x) * lim; v.x *= -0.3; }
      pos.z = Math.max(Z_NOSE + 0.6, door === 'rear' ? pos.z : Math.min(Z_TAIL - 0.5, pos.z));
      if (pos.y > CEIL - 1.0) { pos.y = CEIL - 1.0; v.y = Math.min(0, v.y); }
      if (pos.y <= 0) { pos.y = 0; this.landPax(p, true); }
      return;
    }
    // outside the fuselage
    if (!this.flight.onGround && this.flight.y > GEAR_H + 3) {
      // Security Chief perk: grabs a passenger tumbling out of a door if they're close enough
      if (securityCatches({ x: pos.x, y: pos.y, z: pos.z }, this.crew())) {
        pos.set(Math.max(-HALF_W + 0.5, Math.min(HALF_W - 0.5, pos.x)), 0, Math.min(Z_TAIL - 0.8, Math.max(Z_NOSE + 0.6, pos.z)));
        p.vel = null; p.spin = 0; p.mesh.rotation.set(0, 0, 0); p.state = 'return'; p.panicT = 0; p.mood = Math.min(100, p.mood + PERK.secCalmMood);
        this.score.caught = (this.score.caught || 0) + 1;
        this.toast('🛡️ The Security Chief caught the passenger just in time!', 'info');
        return;
      }
      return this.ejectPax(p);
    }
    if (pos.y <= -GEAR_H) { pos.y = -GEAR_H; this.landPax(p, false); }
  }
  landPax(p, inside) {
    p.vel = null; p.spin = 0; p.mesh.rotation.set(0, p.mesh.rotation.y, 0);
    p.flash && this.flash(p, 'complaint', 2.5);
    if (inside) { p.state = 'return'; return; }
    // landed on the apron: dust off and queue up to board again
    p.state = 'walk'; p.wp = 0; p.waiting = false;
  }
  ejectPax(p) {
    p.state = 'lost'; p.vel = null; p.request = null;
    this.score.paxLost++;
    this.toast('🪂 A passenger left the flight early! Their parachute popped open. (refund + fine)', 'warn', 'warn');
    this.startEjectFx(p);
    for (const q of this.pax) if (q !== p && q.state !== 'lost') { q.panicT = Math.max(q.panicT, 4); q.mood = Math.max(0, q.mood - 12); }
  }
  /** Cartoon parachute: the passenger floats away in world space (visual only; same on every client). */
  startEjectFx(p) {
    if (p.fx) return;
    const scene = this.ship.plane.parent; if (!scene) return;
    this.ship.plane.updateMatrixWorld();
    const wp = p.mesh.getWorldPosition(new THREE.Vector3());
    this.ship.plane.remove(p.mesh); scene.add(p.mesh); p.mesh.position.copy(wp);
    const f = this.flight, sp = f.speed * Math.cos(f.pitch);
    const vel = new THREE.Vector3(-Math.sin(f.yaw) * sp, 2, -Math.cos(f.yaw) * sp);
    const chute = makeParachute(); chute.visible = false; chute.scale.setScalar(0.2); p.mesh.add(chute);
    p.fx = { vel, t: 0, chute };
  }
  stopEjectFx(p) {
    if (!p.fx) return;
    p.mesh.remove(p.fx.chute); p.mesh.parent?.remove(p.mesh); this.ship.plane.add(p.mesh);
    p.mesh.rotation.set(0, 0, 0); p.fx = null;
  }
  updateEjectFx(dt) {
    for (const p of this.pax) {
      if (!p.fx) continue;
      const fx = p.fx; fx.t += dt;
      fx.vel.multiplyScalar(Math.exp(-dt * (fx.t > 0.7 ? 2.5 : 0.35))); // air drag (parachute: lots of it)
      fx.vel.y = fx.t > 0.7 ? -3.2 : fx.vel.y - 9.8 * dt;
      p.mesh.position.addScaledVector(fx.vel, dt);
      if (fx.t > 0.7) { fx.chute.visible = true; fx.chute.scale.setScalar(Math.min(1, fx.chute.scale.x + dt * 3)); p.mesh.rotation.x *= 0.9; p.mesh.rotation.z = Math.sin(fx.t * 2) * 0.15; }
      else { p.mesh.rotation.x += dt * 6; }
      if (p.mesh.position.y < 0.5) p.mesh.visible = false; // splashdown, safe and sound (and very annoyed)
    }
  }
  respawnLost() {
    let n = 0;
    for (const p of this.pax) if (p.state === 'lost') { this.stopEjectFx(p); p.mesh.visible = true; p.mesh.position.set(p.seat.x, 0, p.seat.z); p.state = 'seated'; p.mood = 40; n++; }
    this.score.paxLost = Math.max(0, this.score.paxLost - n);
    if (n) this.toast(`${n} passenger${n > 1 ? 's' : ''} returned to their seat${n > 1 ? 's' : ''}, slightly damp.`);
    return n;
  }

  serve(paxId, item, cls = null) {
    const p = this.pax.find((x) => x.id === paxId);
    if (!p || p.state !== 'seated' || !p.request) return false;
    if (p.request === 'complaint') { if (item) return false; p.request = null; p.mood = Math.min(100, p.mood + 15); this.score.calmed++; this.flash(p, 'happy'); this.toast('You calmed the passenger down.'); return true; }
    if (p.request !== item) return false;
    p.request = null; p.mood = Math.min(100, p.mood + 22 + (cls === 'cabin_pro' ? PERK.proServeMood : 0)); this.score.served++;
    if (item === 'snack') p.fed = true; if (item === 'water') p.drank = true;
    if (item === 'blanket' && PERSONALITIES[p.kind].sleeps) p.sleep = true;
    this.flash(p, p.sleep ? 'sleep' : 'happy');
    p.nextReq = 25 + this.rng() * 35;
    return true;
  }
  fixPanel() {
    const fixable = this.events.filter((e) => e.fix && !e.done);
    if (!fixable.length) { this.toast('All systems normal.'); return false; }
    for (const e of fixable) { e.done = true; this.score.fixed++; if (e.id === 'engine_warning') this.flight.engineFail = false; if (e.id === 'cabin_pressure') this.ship.masks.visible = false; }
    this.toast('Systems reset. Nice work!');
    return true;
  }
  applyCabin() {
    this.ship.cabin.setLights(this.cabin.lights);
    this.ship.cabin.setSeatbelt(this.cabin.seatbelt);
    this.flight.gearDown = this.cabin.gearDown;
  }
  /** Cockpit / cabin systems (co-pilot, pilot, cabin crew). Returns a short message for the HUD. */
  system(what, by = '') {
    const c = this.cabin, f = this.flight;
    if (what === 'lights') { c.lights = !c.lights; this.applyCabin(); this.toast(`Cabin lights ${c.lights ? 'on' : 'dimmed'}${by}.`, 'info', 'click'); }
    if (what === 'seatbelt') { c.seatbelt = !c.seatbelt; this.applyCabin(); this.toast(`Seatbelt sign ${c.seatbelt ? 'ON' : 'off'}${by}.`, 'info', 'ding'); }
    if (what === 'gear') {
      if (f.onGround && c.gearDown) { this.toast('The gear stays down on the ground!', 'warn'); return; }
      c.gearDown = !c.gearDown; this.applyCabin(); this.toast(`Landing gear ${c.gearDown ? 'DOWN' : 'UP'}${by}.`, 'info', 'gear');
    }
    if (what === 'announce') {
      if (this.t - c.lastAnnounce < 15) { this.toast('Give the passengers a moment between announcements.'); return; }
      c.lastAnnounce = this.t; c.announced++;
      const msg = this.phase === 'boarding' ? `Welcome aboard Batlas Air to ${DEST.name}!` : this.phase === 'approach' ? `We are starting our descent into ${DEST.name}. Please return to your seats.` : this.events.some((e) => !e.done && (e.id === 'turbulence' || e.id === 'air_pocket')) ? 'Please remain seated, we are passing through some bumps.' : 'This is your crew speaking: enjoy the flight!';
      for (const p of this.pax) { p.mood = Math.min(100, p.mood + 8); if (p.panicT > 0) p.panicT = 0; }
      this.toast(`📢 ${msg}${by}`, 'info', 'ding');
    }
  }
  /** Pre-flight checklist (shown before departure; complete = bonus). */
  checklist() {
    const c = this.counts || { loaded: 0, bags: 1, boarded: 0, pax: 1 };
    return [
      { id: 'bags', text: `Bags in the hold (${c.loaded}/${c.bags})`, done: c.bags > 0 && c.loaded >= c.bags },
      { id: 'pax', text: `Passengers seated (${c.boarded}/${c.pax})`, done: c.pax > 0 && c.boarded >= c.pax },
      { id: 'doors', text: 'Rear door + cargo door closed', done: !this.ship.doors.rear.open && !this.ship.doors.cargo.open },
      { id: 'seatbelt', text: 'Seatbelt sign ON', done: this.cabin.seatbelt },
      { id: 'announce', text: 'Welcome announcement', done: this.cabin.announced > 0 },
      { id: 'gear', text: 'Gear down, lights on', done: this.cabin.gearDown && this.cabin.lights },
    ];
  }
  flash(p, kind, t = 2.5) { p.bubbleKind = kind; p.flashT = t; }

  // ---------------- events ----------------
  /** Mechanic / Navigator perk: random faults and turbulence are announced a few seconds early. */
  warnOrTrigger(id) {
    const cls = this.classes();
    const fault = id === 'engine_warning' || id === 'cabin_pressure', bumpy = id === 'turbulence' || id === 'air_pocket';
    const warn = fault && crewHas(cls, 'mechanic') ? PERK.mechWarn : bumpy && crewHas(cls, 'navigator') ? PERK.navWarn : 0;
    if (!warn) return this.trigger(id);
    (this.pendingEv ||= []).push({ id, at: this.t + warn });
    this.toast(fault ? `${CLASS_INFO.mechanic.icon} Mechanic: ${id === 'engine_warning' ? 'engine' : 'cabin pressure'} fault coming in ${warn} s. Get to the panel!` : `${CLASS_INFO.navigator.icon} Navigator: ${id === 'air_pocket' ? 'air pocket' : 'turbulence'} ahead in ${warn} s. Seatbelts on!`, 'warn', 'warn');
    return null;
  }
  trigger(id, opts = {}) {
    const def = this.cfg.events.find((e) => e.id === id) || { id, message: id };
    const r = (a, d) => (a ? a[0] + this.rng() * (a[1] - a[0]) : d);
    const e = { id, t: 0, dur: opts.dur ?? r(def.duration, 0), intensity: opts.intensity ?? r(def.intensity, 1), fix: def.fix, deadline: fixDeadline(def.timeout, this.classes()), done: false };
    if (id === 'engine_warning') this.flight.engineFail = true;
    if (id === 'cabin_pressure') this.ship.masks.visible = true;
    if (id === 'complaint') {
      const seated = this.pax.filter((p) => p.state === 'seated' && !p.request);
      const p = seated.find((x) => x.kind === 'critic') || seated[Math.floor(this.rng() * seated.length)];
      if (p) { p.request = 'complaint'; p.reqT = 0; p.mood -= 10; }
      e.done = true;
    }
    if (id === 'air_pocket') for (const it of this.items.values()) if (it.inWorld) { it.body.wakeUp(); it.body.velocity.y += 3 + this.rng() * 2; }
    this.events.push(e);
    this.cool[id] = def.cooldown || 0;
    this.toast(opts.message || def.message, e.fix ? 'warn' : 'info');
    return e;
  }
  stopEvent(id) {
    for (const e of this.events) if (e.id === id && !e.done) { e.done = true; if (id === 'engine_warning') this.flight.engineFail = false; if (id === 'cabin_pressure') this.ship.masks.visible = false; }
  }
  emergency(scenario, action) {
    const map = { engine_failure: 'engine_warning', turbulence: 'turbulence', cabin_pressure: 'cabin_pressure' };
    if (scenario === 'emergency_landing') {
      if (action === 'stop') { this.emergencyLanding = null; return; }
      this.emergencyLanding = { t: 0, limit: 240 };
      this.toast('EMERGENCY LANDING (scenario): land at the nearest runway within 4:00!', 'warn');
      return;
    }
    if (action === 'stop') return this.stopEvent(map[scenario]);
    this.trigger(map[scenario], scenario === 'turbulence' ? { dur: 10, intensity: 1.4, message: 'Severe turbulence (emergency drill)!' } : {});
  }

  // ---------------- main update (host) ----------------
  update(dt, ctx) {
    this.t += dt;
    const f = this.flight;
    // phase machine
    if (this.phase === 'boarding' && f.speed > 1.5) this.depart(ctx);
    if (this.phase === 'taxi' && !f.onGround) this.phase = 'climb';
    if (this.phase === 'climb' && f.y > 300) this.phase = 'cruise';
    if (this.phase === 'cruise' && distTo(f, DEST) < 4500) this.phase = 'approach';
    if (['climb', 'cruise', 'approach'].includes(this.phase)) this.flightT += dt;
    if (f.touchdown && !this.score.landing && f.airborneOnce) {
      const td = f.touchdown;
      this.score.landing = landingGrade(td.vs, td.crash, this.pilotClass ? this.pilotClass() : null); // Ace Pilot: softer grading
      this.score.landedAt = td.rwy; this.score.crashed = td.crash; this.score.vs = td.vs; this.score.belly = !!td.belly; this.score.wrongAirport = !!td.rwy && td.rwy !== DEST.code && td.rwy !== ORIGIN.code;
      this.phase = 'landed';
      if (td.crash) { this.toast(td.terrain ? 'CRASH! That hill came out of nowhere.' : td.belly ? 'BELLY LANDING! Somebody forgot the gear...' : 'CRASH! The plane is... not fine.', 'warn', 'crash'); this.finish(); }
      else this.toast(td.rwy === DEST.code ? `Touchdown at ${DEST.name}! (${td.vs.toFixed(1)} m/s)` : td.rwy === ORIGIN.code ? 'Back at Harbor Field. Passengers are confused.' : td.rwy ? `Landed at ${ROUTES[td.rwy]?.name}. Wrong airport, but safe!` : 'Landed... somewhere.', 'info');
    }
    if (this.phase === 'landed' && !this.results && f.speed < 3) this.finish();
    if (this.emergencyLanding && this.phase !== 'landed' && this.phase !== 'results') this.emergencyLanding.t += dt;

    // events roll
    const flying = ['climb', 'cruise', 'approach'].includes(this.phase);
    for (const k in this.cool) this.cool[k] = Math.max(0, this.cool[k] - dt);
    this.eventClock += dt * ({ easy: 0.6, normal: 1, hard: 1.5 }[this.config?.difficulty] || 1); // Developer config: difficulty
    if (flying && this.eventClock > this.cfg.checkEverySeconds) {
      this.eventClock = 0;
      if (this.rng() < this.cfg.chancePerCheck) {
        const ok = this.cfg.events.filter((e) => e.phases.includes(this.phase) && !this.cool[e.id] && !this.events.some((x) => x.id === e.id && !x.done));
        const total = ok.reduce((a, e) => a + e.weight, 0);
        let pick = this.rng() * total;
        for (const e of ok) { pick -= e.weight; if (pick <= 0) { this.warnOrTrigger(e.id); break; } }
      }
    }
    // early-warned events arrive on time
    if (this.pendingEv?.length) for (const pe of [...this.pendingEv]) if (this.t >= pe.at) { this.pendingEv.splice(this.pendingEv.indexOf(pe), 1); this.trigger(pe.id); }
    // Cabin Pro aura: nearby seated passengers slowly cheer up and stop panicking
    const pros = this.crew().filter((c) => c.cls === 'cabin_pro');
    if (pros.length) for (const p of this.pax) if (p.state === 'seated' && pros.some((c) => Math.hypot(c.x - p.mesh.position.x, c.z - p.mesh.position.z) < PERK.proCalmRadius)) { p.mood = Math.min(100, p.mood + PERK.proCalmRate * dt); p.panicT = Math.max(0, p.panicT - dt); }
    // active events
    let turb = this.weather === 'storm' && flying ? 0.35 : this.weather === 'rain' && flying ? 0.12 : 0;
    for (const e of this.events) {
      if (e.done) continue;
      e.t += dt;
      if (e.id === 'turbulence' || e.id === 'air_pocket') { turb = Math.max(turb, e.intensity); if (e.t > e.dur) e.done = true; }
      if (e.fix && e.deadline && e.t > e.deadline && !e.failed) {
        e.failed = true; this.score.fixFailed++;
        this.toast(e.id === 'cabin_pressure' ? 'Pressure warning ignored: passengers are terrified.' : 'Engine warning ignored: half power until fixed.', 'warn');
        if (e.id === 'cabin_pressure') for (const p of this.pax) p.mood -= 25;
      }
    }
    this.events = this.events.filter((e) => !e.done || e.t < 1);
    this.turb = turb;
    // shake loose items
    if (turb > 0) {
      this._jolt = (this._jolt || 0) - dt;
      if (this._jolt <= 0) {
        this._jolt = 0.25;
        for (const it of this.items.values()) if (it.inWorld) { it.body.wakeUp(); it.body.velocity.x += (this.rng() - 0.5) * turb * 2.4; it.body.velocity.y += this.rng() * turb * 2.2; it.body.velocity.z += (this.rng() - 0.5) * turb * 2.4; }
      }
    }
    // physics
    this.world.step(1 / 60, dt, 3);
    for (const it of this.items.values()) {
      if (it.inWorld) {
        // fell through the floor? put it back in the aisle
        if (it.body.position.y < -GEAR_H - 3) { it.body.position.set(0, 0.6, -2); it.body.velocity.set(0, 0, 0); }
        it.mesh.position.copy(it.body.position); it.mesh.quaternion.copy(it.body.quaternion);
      }
    }
    // an open door in the air is terrifying
    if (!this.flight.onGround && (this.ship.doors.rear.open || this.ship.doors.cargo.open)) for (const p of this.pax) if (p.state === 'seated') { p.panicT = Math.max(p.panicT, 0.5); p.mood -= dt * 2; }
    // passengers
    for (const p of this.pax) this.updatePax(p, dt, flying, turb);
    // objective counters
    this.updateCounts();
  }

  updatePax(p, dt, flying, turb) {
    const k = PERSONALITIES[p.kind];
    if (p.state === 'lost') return;
    if (p.frozenT > 0 && p.state !== 'thrown') return; // Freeze Ray: frozen solid until it thaws
    if (p.state === 'carried') { p.panicT = 1; p.mood = Math.max(0, p.mood - 6 * dt); for (const q of this.pax) if (q !== p && q.state === 'seated' && q.mesh.position.distanceTo(p.mesh.position) < 3) q.panicT = Math.max(q.panicT, 0.6); return; }
    if (this.grav?.pax === p) return; // floating in the Developer's gravity beam
    if (p.state === 'thrown') { this.updateThrown(p, dt); return; }
    if (p.state === 'return') {
      const pos = p.mesh.position, farZ = Math.abs(pos.z - p.seat.z) > 0.25;
      // walk back via the aisle: step out to the aisle, along it, then into the row
      const tgt = farZ ? (Math.abs(pos.x) > 0.2 ? new THREE.Vector3(0, 0, pos.z) : new THREE.Vector3(0, 0, p.seat.z)) : new THREE.Vector3(p.seat.x, 0, p.seat.z), d = tgt.sub(pos), dist = d.length();
      if (farZ && dist < 0.08) { pos.add(d); return; }
      if (dist < 0.08) { pos.set(p.seat.x, 0, p.seat.z); p.state = 'seated'; p.mesh.rotation.y = 0; if (!p.boardedOnce) { p.boardedOnce = true; this.score.paxBoarded++; } }
      else { pos.addScaledVector(d.normalize(), Math.min(dist, 1.3 * dt)); p.mesh.rotation.y = Math.atan2(-d.x, -d.z); }
      return;
    }
    if (p.state === 'queue') { p.delay -= dt; if (p.delay <= 0) p.state = 'walk'; }
    if (p.state === 'walk') {
      const tgt = p.path[p.wp];
      if (p.wp === (p.doorWp ?? 1) && !this.ship.doors.rear.passable) { p.waiting = true; return; }
      if (p.pauseT > 0) { p.pauseT -= dt; p.waiting = true; return; } // at a desk / in the scanner
      p.waiting = false;
      const pos = p.mesh.position, d = tgt.clone().sub(pos), dist = d.length();
      const step = (pos.z > Z_TAIL + 0.5 ? 2.0 : 1.5) * dt; // brisk through the terminal, careful in the aisle
      if (dist <= step) { pos.copy(tgt); if (tgt.pause) p.pauseT = tgt.pause; p.wp++; if (p.wp >= p.path.length) { p.state = 'seated'; p.mesh.rotation.y = 0; if (!p.boardedOnce) { p.boardedOnce = true; this.score.paxBoarded++; } } }
      else { pos.addScaledVector(d.normalize(), step); p.mesh.rotation.y = Math.atan2(-d.x, -d.z); }
    }
    if (p.state === 'seated' && flying) {
      if (!p.request && !p.sleep) { p.nextReq -= dt; if (p.nextReq <= 0) { p.request = k.wants[Math.floor(this.rng() * k.wants.length)]; p.reqT = 0; } }
      if (p.request) {
        p.reqT += dt;
        if (p.reqT > 12) p.mood -= k.decay * dt * 1.5 * ({ easy: 0.6, normal: 1, hard: 1.5 }[this.config?.difficulty] || 1);
        if (p.reqT > 45) { p.request = null; p.mood -= 20; this.score.failed++; this.flash(p, 'complaint', 3); p.nextReq = 20 + this.rng() * 30; this.toast('A passenger gave up waiting. That\'s a bad review.', 'info'); }
      }
      if (turb > 0.5) { p.panicT = 1; p.mood -= turb * k.panicMult * dt * (this.cabin.seatbelt ? 0.6 : 1.6); if (p.sleep && turb > 1) p.sleep = false; }
    }
    if (p.panicT > 0) p.panicT -= dt;
    if (p.flashT > 0) p.flashT -= dt;
    p.mood = Math.max(0, Math.min(100, p.mood));
  }

  updateCounts() {
    let loaded = 0, loose = 0;
    for (const it of this.items.values()) {
      if (!ITEM_DEFS[it.type].bag) continue;
      const pos = it.heldBy ? null : it.mesh.position;
      if (pos && this.inCargo(pos)) loaded++;
      else if (pos && this.inCabin(pos) && pos.y < 1.6 && !(pos.y > 1.7)) loose++;
    }
    this.counts = { loaded, loose, boarded: this.pax.filter((p) => p.state === 'seated').length, pax: this.pax.filter((p) => p.state !== 'lost').length, lost: this.pax.filter((p) => p.state === 'lost').length, bags: [...this.items.values()].filter((i) => i.manifest).length };
  }

  depart(ctx) {
    this.updateCounts();
    this.score.checklist = this.checklist().every((c) => c.done);
    this.phase = 'taxi';
    for (const name of ['rear', 'cargo']) if (this.ship.doors[name].open) { this.setDoor(name, false); this.score.doorsOpen++; }
    if (this.score.doorsOpen) this.toast('Departed with a door open, it slammed shut. (-50 each)', 'warn');
    this.setGround(false);
    let left = 0;
    for (const it of [...this.items.values()]) {
      if (it.heldBy) continue;
      if (!this.inCabin(it.mesh.position)) { if (it.manifest) left++; this.removeItem(it.id); }
    }
    this.score.bagsLeft = left;
    this.updateCounts();
    this.score.bagsLoaded = this.counts.loaded;
    const aboard = (p) => p.state === 'seated' || (['carried', 'thrown', 'return'].includes(p.state) && this.inCabin(p.mesh.position));
    for (const p of this.pax) if (p.state === 'carried' || p.state === 'thrown') { p.carriedBy = null; p.state = 'return'; if (!this.inCabin(p.mesh.position)) p.mesh.position.set(0, 0, -6); }
    const notBoarded = this.pax.filter((p) => !aboard(p));
    this.score.paxLeft = notBoarded.length;
    for (const p of notBoarded) { this.ship.plane.remove(p.mesh); p.state = 'left'; }
    this.pax = this.pax.filter((p) => p.state !== 'left');
    this.toast(`Departure! ${this.score.bagsLoaded} bags in the hold, ${this.pax.length} passengers aboard.`);
    ctx?.onDepart?.();
  }

  /** End of flight: the airline gets paid. Fares + service tips + cargo fees, minus refunds and fines (credits, ₵). */
  finish() {
    if (this.results) return;
    this.updateCounts();
    const s = this.score, c = this.counts;
    const premium = this.contract === 'premium';
    const fareEach = Math.round((60 + DEST.km * 4) * (premium ? 1.6 : 1)), fine = premium ? 2 : 1;
    const lines = [];
    const add = (label, amt) => { if (amt) lines.push([label, Math.round(amt)]); };
    const arrived = !s.crashed && s.landedAt === DEST.code, elsewhere = !s.crashed && s.landedAt && !arrived && s.landedAt !== ORIGIN.code;
    const aboard = this.pax.filter((p) => p.state !== 'lost');
    // cargo damage: thrown bags, bags loose in the cabin, rough arrivals
    for (const it of this.items.values()) if (ITEM_DEFS[it.type].bag && !this.inCargo(it.mesh.position) && this.inCabin(it.mesh.position)) it.damaged = true;
    const bags = [...this.items.values()].filter((i) => i.manifest && this.inCargo(i.mesh.position));
    let roughDamage = s.crashed ? bags.length : s.landing === 'hard' ? Math.min(2, bags.length) : 0;
    for (const b of bags) if (!b.damaged && roughDamage > 0) { b.damaged = true; roughDamage--; }
    s.bagsDamaged = [...this.items.values()].filter((i) => i.manifest && i.damaged).length;
    if (premium) add('Premium contract (fragile cargo, demanding VIPs)', 0);
    if (arrived) add(`Fares: ${aboard.length} passengers delivered to ${DEST.name} × ₵${fareEach}`, aboard.length * fareEach);
    else if (elsewhere) add(`Fares (wrong airport, half price): ${aboard.length} passengers`, aboard.length * fareEach * 0.5);
    else if (!s.crashed) add('No fares: the passengers never reached their destination', 0);
    const goodBags = bags.filter((b) => !b.damaged).length;
    if (arrived || elsewhere) add(`Cargo fees: ${goodBags} bag${goodBags === 1 ? '' : 's'} delivered intact × ₵25`, goodBags * 25 * (premium ? 1.6 : 1));
    // service: food, drink and a smooth ride; 2 of 3 = good service, 3 of 3 = excellent
    let good = 0, great = 0;
    for (const p of aboard) { const n = (p.fed ? 1 : 0) + (p.drank ? 1 : 0) + (p.mood >= 60 ? 1 : 0); if (n === 3) great++; else if (n === 2) good++; }
    if (!s.crashed) { add(`Excellent service tips (${great} × ₵50)`, great * 50); add(`Good service tips (${good} × ₵30)`, good * 30); }
    if (s.calmed) add(`Complaints handled (${s.calmed} × ₵10)`, s.calmed * 10);
    if (s.failed) add(`Ignored requests: vouchers (${s.failed} × ₵15)`, -15 * s.failed * fine);
    if (s.fixed) add(`Repairs done in flight (${s.fixed} × ₵50)`, s.fixed * 50);
    if (s.checklist) add('Pre-flight checklist: insurance discount', 100);
    const landAmt = { butter: 150, good: 75, hard: -100, crash: 0 }[s.landing] ?? 0;
    if (s.landing && s.landing !== 'crash') add(`Landing: ${s.landing}${s.vs != null ? ` (${s.vs.toFixed(1)} m/s)` : ''}`, landAmt);
    if (arrived) add(`On-time bonus (${Math.round(this.flightT)} s)`, Math.max(0, 200 - Math.max(0, this.flightT - DEST.km * 9) * 0.8));
    if (this.emergencyLanding && !s.crashed && s.landedAt) add(this.emergencyLanding.t <= this.emergencyLanding.limit ? 'Emergency landing in time: safety award' : 'Emergency landing too slow', this.emergencyLanding.t <= this.emergencyLanding.limit ? 300 : -100);
    // refunds and fines
    if (s.paxLeft) add(`Refunds: passengers left at the gate (${s.paxLeft})`, -fareEach * s.paxLeft);
    if (s.paxLost) add(`Passengers who parachuted out (${s.paxLost}): refund + safety fine`, -(fareEach + 500 * fine) * s.paxLost);
    if (s.paxGrabbed) add(`Passengers manhandled by crew (${s.paxGrabbed}): compensation`, -40 * s.paxGrabbed * fine);
    if (s.bagsDamaged) add(`Damaged luggage claims (${s.bagsDamaged} × ₵60)`, -60 * s.bagsDamaged * fine);
    if (s.bagsLeft) add(`Bags left at the gate (${s.bagsLeft} × ₵40)`, -40 * s.bagsLeft * fine);
    if (c.loose) add(`Loose bags in the cabin (${c.loose})`, -20 * c.loose);
    if (s.fixFailed) add(`Ignored warnings: maintenance fines (${s.fixFailed})`, -100 * s.fixFailed * fine);
    if (s.doorsOpen) add('Departed with a door open: airport fine', -75 * s.doorsOpen);
    if (s.belly) add('Belly landing: runway repair bill', -1200);
    else if (s.crashed) add('Crash: insurance excess and a very long report', -1500);
    if (!lines.length) add('Nothing earned', 0);
    for (const v of aboard.filter((p) => p.vip)) add(v.mood >= 60 ? 'VIP passenger delighted: big tip' : 'VIP passenger unhappy: complaint to the airline', v.mood >= 60 ? 250 : -150);
    const mult = this.config?.payout ?? 1;
    if (mult !== 1) { const sub = lines.reduce((a, l) => a + l[1], 0); add(`Developer payout multiplier ×${mult}`, sub > 0 ? sub * (mult - 1) : 0); }
    const total = lines.reduce((a, l) => a + l[1], 0);
    const potential = this.pax.length * (fareEach + 50) + this.items.size * 25 + 450;
    const ratio = total / Math.max(1, potential);
    let stars = s.crashed ? 0 : ratio > 0.8 ? 5 : ratio > 0.62 ? 4 : ratio > 0.45 ? 3 : ratio > 0.25 ? 2 : 1;
    if (s.paxLost) stars = Math.min(stars, 2);
    this.results = { total, payout: total, currency: '₵', stars, lines, crashed: s.crashed, landedAt: s.landedAt, landing: s.landing, route: DEST.code, routeName: DEST.name, time: Math.round(this.flightT), bags: s.bagsLoaded, served: s.served, lost: s.paxLost, contract: this.contract || 'standard', at: Date.now() };
    this.phase = 'results';
  }

  // ---------------- networking ----------------
  snapshot(includePlane) {
    const r = (n) => Math.round(n * 1000) / 1000;
    const it = [...this.items.values()].map((i) => [i.id, i.type, r(i.mesh.position.x), r(i.mesh.position.y), r(i.mesh.position.z), r(i.mesh.quaternion.x), r(i.mesh.quaternion.y), r(i.mesh.quaternion.z), r(i.mesh.quaternion.w), i.heldBy || '', i.manifest ? 1 : 0]);
    const px = this.pax.map((p) => [p.id, r(p.mesh.position.x), r(p.mesh.position.y), r(p.mesh.position.z), r(p.mesh.rotation.y), p.state, p.request || '', Math.round(p.mood), (p.panicT > 0 ? 1 : 0) | (p.sleep ? 2 : 0) | (p.dance > 0 ? 4 : 0) | (p.frozenT > 0 ? 8 : 0) | (p.cheerT > 0 ? 16 : 0) | (p.birthdayT > 0 ? 32 : 0), p.flashT > 0 ? p.bubbleKind : '', p.carriedBy || '', p.sizeK || 1]);
    return {
      seed: this.seed, ph: this.phase, doors: { rear: this.ship.doors.rear.open, cargo: this.ship.doors.cargo.open }, ground: this.groundOn,
      it, px, ev: this.events.filter((e) => !e.done).map((e) => [e.id, Math.round(e.t), e.deadline || 0]), turb: r(this.turb), weather: this.weather, hour: this.hour, cfg: this.config || null,
      masks: this.ship.masks.visible, ef: this.flight.engineFail, el: this.emergencyLanding, counts: this.counts, res: this.results,
      plane: includePlane ? this.planeState() : null,
      route: DEST.code, cabin: this.cabin, contract: this.contract || 'standard',
      // extra state so another player can take over as host mid-flight without resetting anything
      full: {
        sc: this.score, ft: this.flightT, t: this.t, ec: this.eventClock, cool: this.cool,
        evf: this.events.map((e) => ({ id: e.id, t: e.t, dur: e.dur, intensity: e.intensity, fix: e.fix, deadline: e.deadline, done: e.done, failed: e.failed })),
        pxx: this.pax.map((p) => [p.id, p.wp, Math.round(p.nextReq * 10) / 10, Math.round(p.reqT * 10) / 10, Math.round(p.delay * 10) / 10]),
      },
    };
  }
  planeState() { const f = this.flight; return { x: f.x, y: f.y, z: f.z, yaw: f.yaw, pitch: f.pitch, bank: f.bank, speed: f.speed, throttle: f.throttle, onGround: f.onGround, vs: f.vs, td: f.touchdown, ao: f.airborneOnce, cr: f.crashed }; }
  applyPlane(s) { if (!s) return; const f = this.flight; Object.assign(f, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, bank: s.bank, speed: s.speed, throttle: s.throttle, onGround: s.onGround, vs: s.vs, airborneOnce: s.ao, crashed: s.cr }); if (s.td && (!f.touchdown || f.touchdown.at !== s.td.at)) f.touchdown = s.td; }

  /** Non-host: mirror the host's world. */
  applySnapshot(w) {
    if (w.seed !== this.seed) { this.host = false; this.reset(w.seed); for (const it of [...this.items.values()]) this.removeItem(it.id); }
    if (w.route && w.route !== DEST.code) { setRoute(w.route); this.onRoute?.(w.route); }
    if (w.cabin) { this.cabin = { ...w.cabin }; this.applyCabin(); }
    if (w.contract) this.contract = w.contract;
    if (w.full) {
      this.score = w.full.sc; this.flightT = w.full.ft; this.t = Math.max(this.t, w.full.t); this.eventClock = w.full.ec; this.cool = w.full.cool || {};
      this.events = (w.full.evf || []).map((e) => ({ ...e }));
      for (const [id, wp, nextReq, reqT, delay] of w.full.pxx || []) { const p = this.pax.find((q) => q.id === id); if (p) Object.assign(p, { wp, nextReq, reqT, delay }); }
    }
    this.phase = w.ph; this.weather = w.weather; if (w.hour != null) this.hour = w.hour; if (w.cfg) this.config = w.cfg; this.turb = w.turb; this.counts = w.counts; this.results = w.res; this.emergencyLanding = w.el;
    this.flight.engineFail = w.ef;
    this.ship.masks.visible = w.masks;
    for (const n of ['rear', 'cargo']) if (w.doors[n] != null && this.ship.doors[n].open !== w.doors[n]) this.setDoor(n, w.doors[n]);
    if (this.groundOn !== w.ground) this.setGround(w.ground);
    this.activeEvents = w.ev;
    const seen = new Set();
    for (const a of w.it) {
      const [id, type, x, y, z, qx, qy, qz, qw, held, manifest] = a;
      seen.add(id);
      let it = this.items.get(id);
      if (!it) { it = this.spawnItem(type, [x, y, z], { id, manifest: !!manifest }); }
      it.heldBy = held || null;
      it.target = { p: new THREE.Vector3(x, y, z), q: new THREE.Quaternion(qx, qy, qz, qw) };
    }
    for (const id of [...this.items.keys()]) if (!seen.has(id)) this.removeItem(id);
    const pseen = new Set();
    for (const a of w.px) {
      const [id, x, y, z, ry, state, req, mood, flags, flash, carrier, sizeK] = a;
      let p = this.pax.find((q) => q.id === id);
      if (!p && id > 16) { // spawned from the Developer panel / VIP event: build the same person locally
        const seat = this.ship.seats.reduce((best, s2) => (Math.hypot(s2.x - x, s2.z - z) < Math.hypot(best.x - x, best.z - z) ? s2 : best), this.ship.seats[0]);
        p = this.addPax(seat, { id, vip: id >= 900, walkIn: false }); p.mesh.position.set(x, y, z);
      }
      if (!p) continue;
      pseen.add(id);
      if (state === 'lost') p.predictT = 0; // the host has resolved our throw: stop predicting, or a later respawn would be ignored for a while
      if (state === 'lost' && p.state !== 'lost') { p.state = 'lost'; if (p.mesh.parent === this.ship.plane && p.target) p.mesh.position.copy(p.target); this.startEjectFx(p); }
      if (state !== 'lost' && p.fx) { this.stopEjectFx(p); p.mesh.visible = true; }
      // guests predict their own carry: ignore the host until it agrees
      if (p.predictT > 0 && state !== 'lost') { p.predictT -= 0.1; p.mood = mood; continue; }
      p.carriedBy = carrier || null;
      if (state === 'lost') { p.state = state; continue; }
      p.target = new THREE.Vector3(x, y, z); if (state !== 'thrown') { p.mesh.rotation.y = ry; p.mesh.rotation.x = 0; } p.state = state; p.request = req || null; p.mood = mood;
      p.panicT = flags & 1 ? 1 : 0; p.sleep = !!(flags & 2); p.dance = flags & 4 ? 1 : 0; p.frozenT = flags & 8 ? Math.max(p.frozenT || 0, 0.4) : 0; p.cheerT = flags & 16 ? 0.4 : 0; p.birthdayT = flags & 32 ? 1 : 0; p.sizeK = sizeK || 1; p.flashT = flash ? 1 : 0; p.bubbleKind = flash || null;
    }
    for (const p of [...this.pax]) if (!pseen.has(p.id)) { this.ship.plane.remove(p.mesh); this.pax = this.pax.filter((q) => q !== p); }
  }
  /** Non-host per-frame smoothing. */
  follow(dt) {
    const a = Math.min(1, dt * 12);
    for (const it of this.items.values()) if (it.target && !it.heldBy) { it.mesh.position.lerp(it.target.p, a); it.mesh.quaternion.slerp(it.target.q, a); }
    for (const p of this.pax) if (p.target && !p.carriedBy && p.state !== 'lost') { const moving = p.mesh.position.distanceTo(p.target) > 0.01; p.mesh.position.lerp(p.target, a); p._moving = moving; }
  }

  /** Visuals shared by host & clients: animation + request bubbles. */
  animate(dt) {
    this.updateEjectFx(dt);
    for (const p of this.pax) {
      const seated = p.state === 'seated';
      const chute = p.state === 'lost' && p.fx?.t > 0.7;
      const airborne = p.state === 'carried' || p.state === 'thrown' || (p.state === 'lost' && !chute);
      const frozen = p.frozenT > 0;
      animateCharacter(p.mesh, frozen ? 0 : dt, { moving: (p.state === 'walk' && !p.waiting) || p.state === 'return' || p._moving, running: p.state === 'return', sitting: seated, panic: p.panicT > 0 || airborne, flail: airborne, parachute: chute, dance: p.dance > 0, cheer: p.cheerT > 0, sleep: p.sleep && seated, angry: seated && p.mood < 30, happy: p.mood > 75, grumpy: !!p.request && p.reqT > 12 });
      if (p.cheerT > 0 && this.host) p.cheerT -= dt;
      if (p.birthdayT > 0 && this.host) p.birthdayT -= dt;
      if (p.birthdayT > 0 && !p.partyHat) { p.partyHat = makePartyHat(); (p.mesh.userData.bones?.find((b) => b.name === 'head') || p.mesh).add(p.partyHat); } else if (!(p.birthdayT > 0) && p.partyHat) { p.partyHat.parent?.remove(p.partyHat); p.partyHat = null; }
      if (p.frozenT > 0) { p.frozenT -= dt; if (!p.ice) { p.ice = makeIce(); p.mesh.add(p.ice); } } else if (p.ice) { p.mesh.remove(p.ice); p.ice = null; }
      const sc = p.sizeK || 1; if (Math.abs(p.mesh.scale.x - sc) > 0.001) p.mesh.scale.setScalar(p.mesh.scale.x + (sc - p.mesh.scale.x) * Math.min(1, dt * 6));
      if (p.dance > 0 && this.host) p.dance -= dt;
      const kind = p.flashT > 0 ? p.bubbleKind : p.request ? p.request : p.sleep && seated ? 'sleep' : p.panicT > 0 ? 'panic' : null;
      if (kind !== p.shownBubble) {
        if (p.bubble) p.mesh.remove(p.bubble);
        p.bubble = kind ? bubble(kind) : null;
        if (p.bubble) { p.bubble.position.y = seated ? 1.6 : 2.0; p.mesh.add(p.bubble); }
        p.shownBubble = kind;
      }
    }
  }
  // ---------------- Developer panel: NPC control + events ----------------
  /** Look for a passenger id; VIPs (id >= 900) get a gold suit, shades and a top hat. Deterministic, so every client builds the same person. */
  static paxLook(seed, id) {
    const look = randomPassengerLook(mulberry32(seed + id * 104729));
    if (id >= 900) Object.assign(look, { shirt: 0xf5c542, shirt2: 0x1d1d1d, pattern: 'jacket', pants: 0x1d1d1d, hat: 'tophat', hatColor: 0x1d1d1d, glasses: 2, tie: 0xd62828, skirt: false, dress: false, shorts: false, sleeves: 'long' });
    return look;
  }
  freeSeats() { const taken = new Set(this.pax.map((p) => p.seat)); return this.ship.seats.filter((s) => !taken.has(s)); }
  /** Adds a passenger (Developer panel / VIP event). walkIn: they appear at the rear door and walk to the seat. */
  addPax(seat, { id = null, vip = false, walkIn = true } = {}) {
    if (!seat) return null;
    id = id ?? (vip ? 900 : 100) + (this.extraN = (this.extraN || 0) + 1);
    const look = Sim.paxLook(this.seed, id);
    const mesh = makeCharacter(look);
    const start = walkIn ? new THREE.Vector3(0, 0, Z_TAIL - 0.6) : new THREE.Vector3(seat.x, 0, seat.z);
    mesh.position.copy(start); this.ship.plane.add(mesh);
    const path = [start.clone(), start.clone(), new THREE.Vector3(0, 0, Z_TAIL - 1.2), new THREE.Vector3(0, 0, seat.z), new THREE.Vector3(seat.x, 0, seat.z)];
    const kinds = Object.keys(PERSONALITIES);
    const p = { id, kind: vip ? 'critic' : kinds[id % kinds.length], look, mesh, seat, path, wp: walkIn ? 2 : path.length, state: walkIn ? 'walk' : 'seated', delay: 0, request: null, reqT: 0, nextReq: vip ? 8 : 20, mood: vip ? 55 : 70, panicT: 0, sleep: false, bubbleKind: null, bubble: null, dance: 0, vip, boardedOnce: !walkIn, extra: true };
    if (!walkIn) { p.boardedOnce = true; this.score.paxBoarded++; }
    this.pax.push(p);
    return p;
  }
  removePax(p) { if (!p) return; if (p.fx) this.stopEjectFx(p); this.ship.plane.remove(p.mesh); this.pax = this.pax.filter((q) => q !== p); }
  npcAction(action, count = 1) {
    if (action === 'respawn') return this.respawnLost();
    if (action === 'spawn') { let n = 0; for (let i = 0; i < count; i++) { const free = this.freeSeats(); if (!free.length) break; this.addPax(free[Math.floor(this.rng() * free.length)], { walkIn: true }); n++; } this.toast(n ? `${n} new passenger${n > 1 ? 's' : ''} boarding through the rear door.` : 'Every seat is taken.'); return n; }
    if (action === 'remove') { let n = 0; for (let i = 0; i < count; i++) { const p = [...this.pax].reverse().find((q) => q.state !== 'carried' && q.state !== 'lost'); if (!p) break; this.removePax(p); n++; } return n; }
    if (action === 'freeze' || action === 'unfreeze') { for (const p of this.pax) if (p.state !== 'lost' && p.state !== 'carried') p.frozenT = action === 'freeze' ? 12 : 0; return; }
    for (const p of this.pax) {
      if (p.state === 'lost' || p.state === 'carried') continue;
      if (action === 'dance') p.dance = 6;
      if (action === 'panic') p.panicT = 4;
      if (action === 'calm') { p.panicT = 0; p.mood = Math.min(100, p.mood + 20); p.request = null; }
      if (action === 'sit' && p.state !== 'seated') { p.mesh.position.set(p.seat.x, 0, p.seat.z); p.wp = p.path.length; p.state = 'seated'; p.mesh.rotation.y = 0; this.score.paxBoarded++; }
    }
  }
  /** Developer events: turbulence, a birthday party or a demanding VIP. */
  roomEvent(ev) {
    if (ev === 'turbulence') { this.trigger('turbulence', { dur: 9, intensity: 1.2, message: 'Turbulence ahead! Seatbelts, everyone.' }); return; }
    if (ev === 'birthday') {
      const seated = this.pax.filter((p) => p.state === 'seated');
      const star = seated[Math.floor(this.rng() * seated.length)];
      if (!star) return;
      for (const p of this.pax) if (p.state === 'seated' || p.state === 'walk') { p.cheerT = 6; p.mood = Math.min(100, p.mood + 15); }
      star.birthdayT = 30; star.dance = 6;
      this.party = { t: 0, z: star.seat.z, x: star.seat.x };
      this.toast(`🎂 It's a passenger's birthday in row ${star.seat.row}! The whole cabin sings.`);
      return;
    }
    if (ev === 'vip') {
      const front = this.freeSeats().sort((a, b) => a.z - b.z)[0];
      if (!front) { this.toast('No free seat for the VIP.'); return; }
      const p = this.addPax(front, { vip: true, walkIn: true });
      this.toast(`⭐ A VIP passenger is boarding (row ${front.row}). Keep them happy: big tip, big complaints.`);
      return p;
    }
  }
  /** Cartoon push on luggage + passengers (Plasma Blaster / Ion Beam / Wave Cannon / Shield). Host only. */
  push(O, D, { range = 9, cone = 0.75, power = 1.6, lift = 2, pax = true, radial = false } = {}) {
    let n = 0;
    for (const it of this.items.values()) {
      if (!it.inWorld || it.heldBy) continue;
      const v = it.mesh.position.clone().sub(O); const dist = v.length();
      if (dist > range || (!radial && v.clone().normalize().dot(D) < cone)) continue;
      const dir = radial ? v.normalize() : D;
      it.body.wakeUp();
      const s = (range - dist) * power;
      it.body.velocity.x += dir.x * s; it.body.velocity.y += dir.y * s + lift; it.body.velocity.z += dir.z * s; n++;
    }
    if (pax) for (const p of this.pax) {
      if (p.state === 'lost' || p.state === 'carried') continue;
      const c = p.mesh.position.clone().add(new THREE.Vector3(0, 0.8, 0)); const v = c.clone().sub(O); const dist = v.length();
      if (dist > range * 0.6 || (!radial && v.clone().normalize().dot(D) < cone)) continue;
      const dir = radial ? v.normalize() : D.clone();
      const s = Math.max(2, (range * 0.6 - dist) * power * 0.8);
      this.knock(p, [dir.x * s, Math.max(2.2, dir.y * s + lift + 1), dir.z * s]); n++;
    }
    return n;
  }
  /** Sends a passenger flying (lands, complains, walks back; out of an open door = parachute). */
  knock(p, vel) {
    if (!p || p.state === 'lost' || p.state === 'carried') return;
    p.carriedBy = null; p.state = 'thrown'; p.vel = new THREE.Vector3(...vel); p.spin = (Math.random() - 0.5) * 8; p.flash = true; p.panicT = 2; p.mood = Math.max(0, p.mood - 8); p.request = null; p.sleep = false;
    if (p.mesh.position.y < 0.3 && this.inCabin(p.mesh.position)) p.mesh.position.y = 0.3;
  }
  /** Gadget effects that change the shared world (host). `hit` = what the shooter's client aimed at. */
  gadget(item, o, d, { target = null, mode = null, p: point = null } = {}) {
    const O = new THREE.Vector3(...o), D = new THREE.Vector3(...d).normalize();
    const paxT = target?.type === 'pax' ? this.pax.find((q) => q.id === target.id) : null;
    const itemT = target?.type === 'item' ? this.items.get(target.id) : null;
    switch (item) {
      case 'plasma_blaster': return this.push(point ? new THREE.Vector3(...point).addScaledVector(D, -0.6) : O, D, { range: 3.2, cone: 0.2, power: 3.2, lift: 2.5 });
      case 'ion_beam': return this.push(O, D, { range: 14, cone: 0.97, power: 1.3, lift: 1 });
      case 'wave_cannon': return this.push(O, D, { range: 9, cone: 0.75, power: 1.6, lift: 2 });
      case 'gravity_gun': {
        if (mode === 'launch') { const g = this.grav; this.grav = null; if (!g) return 0; if (g.pax) g.pax.held = false; if (g.pax) this.knock(g.pax, [D.x * 14, D.y * 14 + 3, D.z * 14]); if (g.item?.inWorld) { g.item.body.wakeUp(); g.item.body.velocity.set(D.x * 16, D.y * 16 + 2, D.z * 16); } return 1; }
        this.grav = paxT ? { pax: paxT, o: O, d: D, by: target.by } : itemT ? { item: itemT, o: O, d: D } : null;
        if (paxT) { paxT.state = 'thrown'; paxT.vel = new THREE.Vector3(); paxT.panicT = 3; paxT.held = true; }
        return this.grav ? 1 : 0;
      }
      case 'freeze_ray': if (paxT) { paxT.frozenT = 8; this.flash(paxT, 'frozen', 2); } return paxT ? 1 : 0;
      case 'size_ray': {
        const k = mode === 'grow' ? 1.6 : 0.5;
        if (paxT) paxT.sizeK = Math.abs((paxT.sizeK || 1) - k) < 0.01 ? 1 : k;
        if (itemT) { itemT.sizeK = Math.abs((itemT.sizeK || 1) - k) < 0.01 ? 1 : k; itemT.mesh.scale.setScalar(itemT.sizeK); }
        return paxT || itemT ? 1 : 0;
      }
      case 'confetti_cannon': {
        for (const q of this.pax) if (q.state !== 'lost' && q.mesh.position.distanceTo(point ? new THREE.Vector3(...point) : O) < 4.5) { q.cheerT = 3; q.mood = Math.min(100, q.mood + 6); q.panicT = 0; }
        return 1;
      }
    }
    return 0;
  }
  /** Gravity gun: keep the held thing floating in front of the Developer (host). */
  updateGravity(eye, dir) {
    const g = this.grav; if (!g) return;
    const at = eye.clone().addScaledVector(dir, 1.8);
    if (g.pax) { if (g.pax.state === 'lost') { this.grav = null; return; } g.pax.state = 'thrown'; g.pax.vel = new THREE.Vector3(); g.pax.mesh.position.lerp(at.clone().add(new THREE.Vector3(0, -0.8, 0)), 0.3); }
    if (g.item?.inWorld) { g.item.body.wakeUp(); g.item.body.velocity.set(0, 0, 0); const p = g.item.body.position; p.x += (at.x - p.x) * 0.3; p.y += (at.y - p.y) * 0.3; p.z += (at.z - p.z) * 0.3; }
  }
  waveImpulse(o, d) {
    const O = new THREE.Vector3(...o), D = new THREE.Vector3(...d).normalize();
    for (const it of this.items.values()) {
      if (!it.inWorld) continue;
      const v = it.mesh.position.clone().sub(O); const dist = v.length();
      if (dist > 9 || v.normalize().dot(D) < 0.75) continue;
      it.body.wakeUp();
      const s = (9 - dist) * 1.6;
      it.body.velocity.x += D.x * s; it.body.velocity.y += D.y * s + 2; it.body.velocity.z += D.z * s;
    }
    for (const p of this.pax) if (p.mesh.position.distanceTo(O) < 7) p.panicT = 2;
  }
}

/** Striped party hat for the birthday event (on the head bone). */
const HAT_MAT = new THREE.MeshLambertMaterial({ color: 0xff4fa3, emissive: 0x401028 });
function makePartyHat() { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 10), HAT_MAT); c.position.y = (0.29 * 1.85) + 0.12; g.add(c); const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshLambertMaterial({ color: 0xfff35c })); b.position.y = 0.6; g.add(b); return g; }

/** Translucent cartoon ice block around a frozen passenger (Freeze Ray). */
const ICE_MAT = new THREE.MeshLambertMaterial({ color: 0xbff3ff, transparent: true, opacity: 0.45, emissive: 0x3aa0c0, depthWrite: false });
function makeIce() { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 1), ICE_MAT); m.scale.set(0.85, 1.25, 0.85); m.position.y = 0.85; m.renderOrder = 2; return m; }

/** Striped cartoon parachute canopy with four lines, attached above a passenger's head. */
function makeParachute() {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(1.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.4);
  const cols = geo.attributes.position.count, colors = new Float32Array(cols * 3);
  const A = new THREE.Color(0xff5a3c), B = new THREE.Color(0xffffff), C2 = new THREE.Color(0x1e6bff);
  for (let i = 0; i < cols; i++) { const x = geo.attributes.position.getX(i), z = geo.attributes.position.getZ(i); const seg = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 6) % 3; const c = [A, B, C2][seg]; colors.set([c.r, c.g, c.b], i * 3); }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const canopy = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true }));
  canopy.position.y = 3.4; g.add(canopy);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const a = new THREE.Vector3(x * 1.0, 3.5, z * 1.0), b = new THREE.Vector3(0, 1.4, 0), mid = a.clone().add(b).multiplyScalar(0.5);
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, a.distanceTo(b), 4), lineMat);
    l.position.copy(mid); l.lookAt(a); l.rotateX(Math.PI / 2); g.add(l);
  }
  return g;
}
