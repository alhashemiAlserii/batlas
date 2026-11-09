// Game simulation: luggage physics, passengers, events, phases and scoring.
// The HOST (or a solo player) runs the full simulation; other clients render snapshots.
import * as THREE from '../../vendor/three.module.js';
import * as CANNON from '../../vendor/cannon-es.js';
import { makeCharacter, animateCharacter, randomPassengerLook, bubble } from './characters.js';
import { HALF_W, Z_CARGO, Z_TAIL, Z_NOSE, CEIL, GEAR_H, DEST, ORIGIN, MATERIALS } from './world.js';
import { newFlight, distTo } from './flight.js';

export const ITEM_DEFS = {
  suitcase: { size: [0.55, 0.38, 0.26], mass: 14, colors: [0xe74c3c, 0x2980b9, 0x27ae60, 0x8e44ad, 0xf39c12, 0x34495e], label: 'suitcase', bag: true },
  duffel: { size: [0.65, 0.32, 0.32], mass: 9, colors: [0x16a085, 0xd35400, 0x2c3e50, 0xc0392b], label: 'duffel bag', bag: true },
  water: { size: [0.12, 0.28, 0.12], mass: 1, colors: [0x4cc3ff], label: 'water', service: true },
  snack: { size: [0.3, 0.12, 0.22], mass: 1, colors: [0xf5a623], label: 'snack box', service: true },
  blanket: { size: [0.4, 0.15, 0.3], mass: 1.5, colors: [0x7c5cff], label: 'blanket', service: true },
  beach_ball: { size: [0.6, 0.6, 0.6], mass: 0.6, colors: [0xff7675], label: 'beach ball', ball: true },
  giant_duck: { size: [0.8, 0.8, 0.9], mass: 4, colors: [0xffd32a], label: 'giant rubber duck' },
  traffic_cone: { size: [0.4, 0.7, 0.4], mass: 3, colors: [0xff6b00], label: 'traffic cone' },
};
const PERSONALITIES = {
  worrier: { wants: ['water'], decay: 1.2, panicMult: 2, label: 'Worrier' },
  snacker: { wants: ['snack'], decay: 1, panicMult: 1, label: 'Snacker' },
  napper: { wants: ['blanket'], decay: 0.8, panicMult: 1, label: 'Napper', sleeps: true },
  critic: { wants: ['water', 'snack', 'blanket'], decay: 2, panicMult: 1.2, label: 'Critic' },
  tourist: { wants: ['snack', 'water'], decay: 0.9, panicMult: 1, label: 'Tourist' },
};
const PAX_COUNT = 10, BAG_COUNT = 8;

export function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class Sim {
  constructor({ ship, eventsConfig, onToast }) {
    this.ship = ship; // result of buildPlane()
    this.cfg = eventsConfig;
    this.toast = onToast || (() => {});
    this.host = true;
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
    this.events = []; this.cool = {}; this.eventClock = 0;
    this.weather = 'clear'; this.turb = 0; this.emergencyLanding = null;
    this.score = { bagsLoaded: 0, bagsLeft: 0, paxBoarded: 0, paxLeft: 0, served: 0, failed: 0, calmed: 0, fixed: 0, fixFailed: 0, looseBags: 0, landing: null, landedAt: null, crashed: false, doorsOpen: 0 };
    this.results = null;
    this.setDoor('front', true); this.setDoor('cargo', true);
    this.setGround(true);
    this.ship.masks.visible = false;
    // manifest luggage on the baggage cart by the cargo stairs
    for (let i = 0; i < BAG_COUNT; i++) {
      const type = i % 3 === 2 ? 'duffel' : 'suitcase';
      this.spawnItem(type, [6.8 + (i % 2) * 0.7, -GEAR_H + 0.3 + Math.floor(i / 4) * 0.45, 6.8 + (Math.floor(i / 2) % 2) * 0.9 + (i >= 4 ? 0.4 : 0)], { manifest: true });
    }
    // passengers (deterministic from seed so every client builds the same people)
    const seats = [...this.ship.seats].sort(() => this.rng() - 0.5).slice(0, PAX_COUNT);
    const kinds = Object.keys(PERSONALITIES);
    for (let i = 0; i < PAX_COUNT; i++) {
      const rnd = mulberry32(seed + i * 7919);
      const look = randomPassengerLook.call(null);
      // replace look randomness with seeded choices for consistency
      const shirts = [0xe74c3c, 0x27ae60, 0xf39c12, 0x8e44ad, 0x16a085, 0xd35400, 0x2c3e50, 0xc0392b, 0x7f8c8d, 0xe84393];
      look.shirt = shirts[Math.floor(rnd() * shirts.length)]; look.scale = 0.9 + rnd() * 0.18;
      const mesh = makeCharacter(look);
      const seat = seats[i];
      const start = new THREE.Vector3(-16 - (i % 2) * 1.2, -GEAR_H, -24 - i * 1.6);
      mesh.position.copy(start);
      this.ship.plane.add(mesh);
      const path = [new THREE.Vector3(-7.2, -GEAR_H, -12), new THREE.Vector3(-2.3, 0, -12), new THREE.Vector3(-0.2, 0, -11.6), new THREE.Vector3(0, 0, seat.z), new THREE.Vector3(seat.x, 0, seat.z)];
      this.pax.push({ id: i + 1, kind: kinds[Math.floor(rnd() * kinds.length)], mesh, seat, path, wp: 0, state: 'queue', delay: 2 + i * 2.6, request: null, reqT: 0, nextReq: 18 + rnd() * 30, mood: 70, panicT: 0, sleep: false, bubbleKind: null, bubble: null, dance: 0 });
    }
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

  setDoor(name, open) {
    const d = this.ship.doors[name]; if (!d) return;
    d.open = open;
    for (const b of this.statics) if (b.userData.tag === `door:${name}`) b.collisionResponse = !open;
    d.collider.tag = open ? `door:${name}:open` : `door:${name}`;
    d.group.position.z = d.closedZ + (open ? (name === 'front' ? 1.3 : -2.1) : 0);
    d.group.position.x = d.side * (HALF_W + (open ? 0.35 : 0.075));
  }
  setGround(on) {
    this.groundOn = on;
    for (const b of this.statics) if (b.userData.tag === 'ground') b.collisionResponse = on;
    this.ship.stairFront.visible = on; this.ship.stairCargo.visible = on;
  }
  inCargo(p) { return p.z > Z_CARGO + 0.1 && p.z < Z_TAIL && Math.abs(p.x) < HALF_W && p.y > -0.2 && p.y < CEIL; }
  inCabin(p) { return p.z > Z_NOSE && p.z < Z_TAIL && Math.abs(p.x) < HALF_W + 0.05 && p.y > -0.4 && p.y < CEIL + 0.2; }

  // ---------------- interaction (host-side resolution) ----------------
  serve(paxId, item) {
    const p = this.pax.find((x) => x.id === paxId);
    if (!p || p.state !== 'seated' || !p.request) return false;
    if (p.request === 'complaint') { if (item) return false; p.request = null; p.mood = Math.min(100, p.mood + 15); this.score.calmed++; this.flash(p, 'happy'); this.toast('You calmed the passenger down.'); return true; }
    if (p.request !== item) return false;
    p.request = null; p.mood = Math.min(100, p.mood + 22); this.score.served++;
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
  flash(p, kind, t = 2.5) { p.bubbleKind = kind; p.flashT = t; }

  // ---------------- events ----------------
  trigger(id, opts = {}) {
    const def = this.cfg.events.find((e) => e.id === id) || { id, message: id };
    const r = (a, d) => (a ? a[0] + this.rng() * (a[1] - a[0]) : d);
    const e = { id, t: 0, dur: opts.dur ?? r(def.duration, 0), intensity: opts.intensity ?? r(def.intensity, 1), fix: def.fix, deadline: def.timeout, done: false };
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
      this.score.landing = td.crash ? 'crash' : td.vs > -2.5 ? 'butter' : td.vs > -5 ? 'good' : 'hard';
      this.score.landedAt = td.rwy; this.score.crashed = td.crash; this.score.vs = td.vs;
      this.phase = 'landed';
      if (td.crash) { this.toast('CRASH! The plane is... not fine.', 'warn'); this.finish(); }
      else this.toast(td.rwy === 'CRP' ? `Touchdown at Coral Point! (${td.vs.toFixed(1)} m/s)` : td.rwy === 'HBF' ? 'Back at Harbor Field. Passengers are confused.' : 'Landed... somewhere.', 'info');
    }
    if (this.phase === 'landed' && !this.results && f.speed < 3) this.finish();
    if (this.emergencyLanding && this.phase !== 'landed' && this.phase !== 'results') this.emergencyLanding.t += dt;

    // events roll
    const flying = ['climb', 'cruise', 'approach'].includes(this.phase);
    for (const k in this.cool) this.cool[k] = Math.max(0, this.cool[k] - dt);
    this.eventClock += dt;
    if (flying && this.eventClock > this.cfg.checkEverySeconds) {
      this.eventClock = 0;
      if (this.rng() < this.cfg.chancePerCheck) {
        const ok = this.cfg.events.filter((e) => e.phases.includes(this.phase) && !this.cool[e.id] && !this.events.some((x) => x.id === e.id && !x.done));
        const total = ok.reduce((a, e) => a + e.weight, 0);
        let pick = this.rng() * total;
        for (const e of ok) { pick -= e.weight; if (pick <= 0) { this.trigger(e.id); break; } }
      }
    }
    // active events
    let turb = this.weather === 'storm' && flying ? 0.35 : 0;
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
    // passengers
    for (const p of this.pax) this.updatePax(p, dt, flying, turb);
    // objective counters
    this.updateCounts();
  }

  updatePax(p, dt, flying, turb) {
    const k = PERSONALITIES[p.kind];
    if (p.state === 'queue') { p.delay -= dt; if (p.delay <= 0) p.state = 'walk'; }
    if (p.state === 'walk') {
      const tgt = p.path[p.wp];
      if (p.wp === 1 && !this.ship.doors.front.open) { p.waiting = true; return; }
      p.waiting = false;
      const pos = p.mesh.position, d = tgt.clone().sub(pos), dist = d.length();
      const step = 1.5 * dt;
      if (dist <= step) { pos.copy(tgt); p.wp++; if (p.wp >= p.path.length) { p.state = 'seated'; p.mesh.rotation.y = 0; this.score.paxBoarded++; } }
      else { pos.addScaledVector(d.normalize(), step); p.mesh.rotation.y = Math.atan2(-d.x, -d.z); }
    }
    if (p.state === 'seated' && flying) {
      if (!p.request && !p.sleep) { p.nextReq -= dt; if (p.nextReq <= 0) { p.request = k.wants[Math.floor(this.rng() * k.wants.length)]; p.reqT = 0; } }
      if (p.request) {
        p.reqT += dt;
        if (p.reqT > 12) p.mood -= k.decay * dt * 1.5;
        if (p.reqT > 45) { p.request = null; p.mood -= 20; this.score.failed++; this.flash(p, 'complaint', 3); p.nextReq = 20 + this.rng() * 30; this.toast('A passenger gave up waiting. That\'s a bad review.', 'info'); }
      }
      if (turb > 0.5) { p.panicT = 1; p.mood -= turb * k.panicMult * dt * 1.6; if (p.sleep && turb > 1) p.sleep = false; }
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
    this.counts = { loaded, loose, boarded: this.pax.filter((p) => p.state === 'seated').length, pax: this.pax.length, bags: [...this.items.values()].filter((i) => i.manifest).length };
  }

  depart(ctx) {
    this.phase = 'taxi';
    for (const name of ['front', 'cargo']) if (this.ship.doors[name].open) { this.setDoor(name, false); this.score.doorsOpen++; }
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
    const notBoarded = this.pax.filter((p) => p.state !== 'seated');
    this.score.paxLeft = notBoarded.length;
    for (const p of notBoarded) { this.ship.plane.remove(p.mesh); p.state = 'left'; }
    this.pax = this.pax.filter((p) => p.state !== 'left');
    this.toast(`Departure! ${this.score.bagsLoaded} bags in the hold, ${this.pax.length} passengers aboard.`);
    ctx?.onDepart?.();
  }

  finish() {
    if (this.results) return;
    this.updateCounts();
    const s = this.score;
    const moods = this.pax.map((p) => p.mood);
    const avgMood = moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : 0;
    const lines = [];
    const add = (label, pts) => lines.push([label, Math.round(pts)]);
    add(`Bags loaded in the hold (${s.bagsLoaded})`, s.bagsLoaded * 100);
    if (s.bagsLeft) add(`Bags left at the gate (${s.bagsLeft})`, -50 * s.bagsLeft);
    add(`Passengers flown (${s.paxBoarded - s.paxLeft > 0 ? this.pax.length : this.pax.length})`, this.pax.length * 50);
    if (s.paxLeft) add(`Passengers left behind (${s.paxLeft})`, -100 * s.paxLeft);
    if (s.served) add(`Requests served (${s.served})`, s.served * 75);
    if (s.calmed) add(`Complaints calmed (${s.calmed})`, s.calmed * 60);
    if (s.failed) add(`Requests ignored (${s.failed})`, -40 * s.failed);
    if (s.fixed) add(`Malfunctions fixed (${s.fixed})`, s.fixed * 150);
    if (s.fixFailed) add(`Warnings ignored (${s.fixFailed})`, -100 * s.fixFailed);
    if (s.doorsOpen) add('Departed with doors open', -50 * s.doorsOpen);
    if (this.counts.loose) add(`Loose bags in the cabin (${this.counts.loose})`, -25 * this.counts.loose);
    const landPts = { butter: 500, good: 300, hard: 50, crash: -800 }[s.landing] ?? 0;
    add(`Landing: ${s.landing ?? 'none'}${s.vs != null ? ` (${s.vs.toFixed(1)} m/s)` : ''}`, landPts);
    if (s.landedAt === 'CRP' && !s.crashed) add('Arrived at Coral Point', 300);
    if (this.emergencyLanding && !s.crashed && s.landedAt) add(this.emergencyLanding.t <= this.emergencyLanding.limit ? 'Emergency landing in time' : 'Emergency landing too slow', this.emergencyLanding.t <= this.emergencyLanding.limit ? 400 : -100);
    add(`Passenger happiness (${Math.round(avgMood)}%)`, avgMood * 3);
    if (s.landedAt === 'CRP' && !s.crashed) add(`Time bonus (${Math.round(this.flightT)} s)`, Math.max(0, 400 - this.flightT * 1.5));
    const total = lines.reduce((a, l) => a + l[1], 0);
    const stars = s.crashed ? 0 : total > 2200 ? 5 : total > 1700 ? 4 : total > 1200 ? 3 : total > 600 ? 2 : 1;
    this.results = { total, stars, lines, crashed: s.crashed, landedAt: s.landedAt, time: Math.round(this.flightT) };
    this.phase = 'results';
  }

  // ---------------- networking ----------------
  snapshot(includePlane) {
    const r = (n) => Math.round(n * 1000) / 1000;
    const it = [...this.items.values()].map((i) => [i.id, i.type, r(i.mesh.position.x), r(i.mesh.position.y), r(i.mesh.position.z), r(i.mesh.quaternion.x), r(i.mesh.quaternion.y), r(i.mesh.quaternion.z), r(i.mesh.quaternion.w), i.heldBy || '', i.manifest ? 1 : 0]);
    const px = this.pax.map((p) => [p.id, r(p.mesh.position.x), r(p.mesh.position.y), r(p.mesh.position.z), r(p.mesh.rotation.y), p.state, p.request || '', Math.round(p.mood), (p.panicT > 0 ? 1 : 0) | (p.sleep ? 2 : 0) | (p.dance > 0 ? 4 : 0), p.flashT > 0 ? p.bubbleKind : '']);
    return {
      seed: this.seed, ph: this.phase, doors: { front: this.ship.doors.front.open, cargo: this.ship.doors.cargo.open }, ground: this.groundOn,
      it, px, ev: this.events.filter((e) => !e.done).map((e) => [e.id, Math.round(e.t), e.deadline || 0]), turb: r(this.turb), weather: this.weather,
      masks: this.ship.masks.visible, ef: this.flight.engineFail, el: this.emergencyLanding, counts: this.counts, res: this.results,
      plane: includePlane ? this.planeState() : null,
    };
  }
  planeState() { const f = this.flight; return { x: f.x, y: f.y, z: f.z, yaw: f.yaw, pitch: f.pitch, bank: f.bank, speed: f.speed, throttle: f.throttle, onGround: f.onGround, vs: f.vs, td: f.touchdown, ao: f.airborneOnce, cr: f.crashed }; }
  applyPlane(s) { if (!s) return; const f = this.flight; Object.assign(f, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, bank: s.bank, speed: s.speed, throttle: s.throttle, onGround: s.onGround, vs: s.vs, airborneOnce: s.ao, crashed: s.cr }); if (s.td && (!f.touchdown || f.touchdown.at !== s.td.at)) f.touchdown = s.td; }

  /** Non-host: mirror the host's world. */
  applySnapshot(w) {
    if (w.seed !== this.seed) { this.host = false; this.reset(w.seed); for (const it of [...this.items.values()]) this.removeItem(it.id); }
    this.phase = w.ph; this.weather = w.weather; this.turb = w.turb; this.counts = w.counts; this.results = w.res; this.emergencyLanding = w.el;
    this.flight.engineFail = w.ef;
    this.ship.masks.visible = w.masks;
    for (const n of ['front', 'cargo']) if (this.ship.doors[n].open !== w.doors[n]) this.setDoor(n, w.doors[n]);
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
      const [id, x, y, z, ry, state, req, mood, flags, flash] = a;
      const p = this.pax.find((q) => q.id === id); if (!p) continue;
      pseen.add(id);
      p.target = new THREE.Vector3(x, y, z); p.mesh.rotation.y = ry; p.state = state; p.request = req || null; p.mood = mood;
      p.panicT = flags & 1 ? 1 : 0; p.sleep = !!(flags & 2); p.dance = flags & 4 ? 1 : 0; p.flashT = flash ? 1 : 0; p.bubbleKind = flash || null;
    }
    for (const p of [...this.pax]) if (!pseen.has(p.id)) { this.ship.plane.remove(p.mesh); this.pax = this.pax.filter((q) => q !== p); }
  }
  /** Non-host per-frame smoothing. */
  follow(dt) {
    const a = Math.min(1, dt * 12);
    for (const it of this.items.values()) if (it.target && !it.heldBy) { it.mesh.position.lerp(it.target.p, a); it.mesh.quaternion.slerp(it.target.q, a); }
    for (const p of this.pax) if (p.target) { const moving = p.mesh.position.distanceTo(p.target) > 0.01; p.mesh.position.lerp(p.target, a); p._moving = moving; }
  }

  /** Visuals shared by host & clients: animation + request bubbles. */
  animate(dt) {
    for (const p of this.pax) {
      const seated = p.state === 'seated';
      animateCharacter(p.mesh, dt, { moving: p.state === 'walk' && !p.waiting || p._moving, sitting: seated && !(p.dance > 0), panic: p.panicT > 0, dance: p.dance > 0 });
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
  npcAction(action) {
    for (const p of this.pax) {
      if (action === 'dance') p.dance = 6;
      if (action === 'panic') p.panicT = 4;
      if (action === 'calm') { p.panicT = 0; p.mood = Math.min(100, p.mood + 20); p.request = null; }
      if (action === 'sit' && p.state !== 'seated') { p.mesh.position.set(p.seat.x, 0, p.seat.z); p.wp = p.path.length; p.state = 'seated'; p.mesh.rotation.y = 0; this.score.paxBoarded++; }
    }
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
