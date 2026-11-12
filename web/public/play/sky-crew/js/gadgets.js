// Developer secret inventory: visuals + local abilities for the fictional cartoon gadgets.
// The SERVER decides who may equip/use them (verified Developer only) and broadcasts every equip/use;
// this module only draws what the server announced and applies the effects:
//  - world effects (luggage, passengers) run on the room host's simulation (sim.gadget / sim.push),
//  - effects on a player run on that player's own client (knockback, freeze, shrink),
//  - movement abilities (jetpack, super speed/jump, noclip) run on the Developer's own client.
import * as THREE from '../../vendor/three.module.js';

const add = (mat) => { mat.transparent = true; mat.depthWrite = false; mat.blending = THREE.AdditiveBlending; return mat; };
const M = {
  plasma: add(new THREE.MeshBasicMaterial({ color: 0x7dff6b })),
  ion: add(new THREE.MeshBasicMaterial({ color: 0x59e7ff, opacity: 0.85 })),
  grav: add(new THREE.MeshBasicMaterial({ color: 0xb46bff, opacity: 0.7 })),
  freeze: add(new THREE.MeshBasicMaterial({ color: 0xbff3ff, opacity: 0.9 })),
  size: add(new THREE.MeshBasicMaterial({ color: 0xff6bd5, opacity: 0.85 })),
  tele: add(new THREE.MeshBasicMaterial({ color: 0x9d7bff, opacity: 0.9 })),
  gold: add(new THREE.MeshBasicMaterial({ color: 0xffd34d, opacity: 0.9 })),
  flame: add(new THREE.MeshBasicMaterial({ color: 0xff9a2e, opacity: 0.9 })),
  speed: add(new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.35 })),
};
const SHIELD = new THREE.MeshLambertMaterial({ color: 0x6fd6ff, emissive: 0x1a6a9a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
const ICE = new THREE.MeshLambertMaterial({ color: 0xbff3ff, transparent: true, opacity: 0.45, emissive: 0x3aa0c0, depthWrite: false });
const CONF = [0xff4757, 0xffd32a, 0x2ed573, 0x1e90ff, 0xff6bd5, 0xffffff].map((c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
const BEAM_COLOR = { ion_beam: M.ion, gravity_gun: M.grav, freeze_ray: M.freeze, size_ray: M.size, teleport_gun: M.tele };
const sphere = new THREE.SphereGeometry(1, 12, 8), quad = new THREE.PlaneGeometry(0.07, 0.04), cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);

/** Small chunky toy-like model of each hand tool (shown in the Developer's hand for everyone). */
function toolModel(id) {
  const g = new THREE.Group();
  const col = { plasma_blaster: 0x2ed573, ion_beam: 0x1e90ff, wave_cannon: 0x48dbfb, gravity_gun: 0x8e44ad, freeze_ray: 0x74b9ff, size_ray: 0xff6bd5, teleport_gun: 0x6c5ce7, confetti_cannon: 0xffa502 }[id] || 0xffffff;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.3), new THREE.MeshLambertMaterial({ color: 0xf1f2f6 }));
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.22, 10), new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.35 }));
  barrel.rotation.x = Math.PI / 2; barrel.position.z = -0.24;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(id === 'confetti_cannon' ? 0.07 : 0.045, 10, 8), add(new THREE.MeshBasicMaterial({ color: col })));
  tip.position.z = -0.36;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.07), new THREE.MeshLambertMaterial({ color: 0x2f3542 }));
  grip.position.set(0, -0.1, 0.06); grip.rotation.x = 0.3;
  g.add(body, barrel, tip, grip);
  if (id === 'gravity_gun' || id === 'size_ray') for (const z of [-0.08, 0.02]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 14), M[id === 'gravity_gun' ? 'grav' : 'size']); r.position.z = z; g.add(r); }
  g.userData.tip = tip;
  return g;
}
function jetpackModel() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xd63031 }), metal = new THREE.MeshLambertMaterial({ color: 0xdfe6e9 });
  for (const x of [-0.09, 0.09]) {
    const t = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.24, 4, 10), mat); t.position.set(x, 0, 0); g.add(t);
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.07, 10), metal); n.position.set(x, -0.2, 0); g.add(n);
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.35, 10), M.flame); f.rotation.x = Math.PI; f.position.set(x, -0.42, 0); f.name = 'flame'; g.add(f);
  }
  return g;
}

export class Gadgets {
  constructor(o) {
    Object.assign(this, o); // { parent, sim, me, myId, eye, dir, aim, avatarOf, send, toast, audio, isHost }
    this.gear = new Map(); // cid -> Set(items)   (from the server's room info / equip fx)
    this.fx = [];
    this.attach = new Map(); // cid -> { tool, jet, shield, aura, ghost }
    this.mode = 'shrink';
    this.frozenT = 0; this.sizeK = 1; this.lastFire = 0; this.playerFx = new Map(); this.serverFrozen = new Set();
  }
  mine() { return this.gear.get(this.myId()) || new Set(); }
  has(id) { return this.mine().has(id); }
  tool() { for (const g of this.mine()) if (TOOLS.has(g)) return g; return null; }
  speedMul() { return (this.has('super_speed') ? 2.5 : 1) * (this.sizeK < 1 ? 0.75 : 1); }
  jumpMul() { return this.has('super_jump') ? 2.6 : 1; }

  /** Room info from the server: who has what equipped. */
  syncRoom(room) {
    const seen = new Set();
    for (const p of room?.players || []) { seen.add(p.cid); this.setGear(p.cid, p.gear || []); }
    for (const cid of [...this.gear.keys()]) if (!seen.has(cid)) this.setGear(cid, []);
  }
  setGear(cid, list) {
    const prev = this.gear.get(cid) || new Set(), next = new Set(list);
    this.gear.set(cid, next);
    if ([...prev].join() !== [...next].join()) this.rebuild(cid);
  }
  rebuild(cid) {
    const a = this.attach.get(cid); if (a) for (const k of Object.keys(a)) a[k]?.parent?.remove(a[k]);
    const av = this.avatarOf(cid); const set = this.gear.get(cid);
    if (!av || !set?.size) { this.attach.delete(cid); if (av) this.ghost(av, false); return; }
    const bones = av.userData.bones || [];
    const bone = (n) => bones.find((b) => b.name === n) || av;
    const out = {};
    const t = [...set].find((g) => TOOLS.has(g));
    if (t) { out.tool = toolModel(t); out.tool.position.set(0, -0.2, -0.08); out.tool.rotation.x = -Math.PI / 2; bone('hand.R').add(out.tool); }
    if (set.has('jetpack')) { out.jet = jetpackModel(); out.jet.position.set(0, 0.05, 0.22); bone('chest').add(out.jet); }
    if (set.has('shield_bubble')) { out.shield = new THREE.Mesh(sphere, SHIELD); out.shield.scale.setScalar(1.05); out.shield.position.y = 0.85; av.add(out.shield); }
    if (set.has('golden_aura')) {
      out.aura = new THREE.Group(); out.aura.position.y = 0.9;
      for (let i = 0; i < 14; i++) { const s = new THREE.Mesh(sphere, M.gold); s.scale.setScalar(0.03 + Math.random() * 0.03); s.userData.a = (i / 14) * Math.PI * 2; s.userData.h = (Math.random() - 0.5) * 1.4; out.aura.add(s); }
      const light = new THREE.PointLight(0xffd34d, 2.2, 3.5); out.aura.add(light); av.add(out.aura);
    }
    if (set.has('super_jump')) { out.springs = new THREE.Group(); for (const n of ['foot.L', 'foot.R']) { const s = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.015, 6, 12), new THREE.MeshLambertMaterial({ color: 0x2ed573 })); s.rotation.x = Math.PI / 2; s.position.y = -0.05; bone(n).add(s); out[`spring${n}`] = s; } }
    this.ghost(av, set.has('noclip'));
    this.attach.set(cid, out);
  }
  /** Noclip: the character turns into a see-through ghost (per-character material copy). */
  ghost(av, on) {
    const m = av.userData.mesh; if (!m) return;
    if (on && !m.userData.ghostMat) { m.userData.baseMat = m.material; m.userData.ghostMat = m.material.clone(); Object.assign(m.userData.ghostMat, { transparent: true, opacity: 0.4, depthWrite: false }); m.material = m.userData.ghostMat; }
    if (!on && m.userData.ghostMat) { m.material = m.userData.baseMat; m.userData.ghostMat.dispose(); m.userData.ghostMat = null; }
  }

  /** Local trigger: aim, pick a target, ask the SERVER to use the tool (it re-checks rank + equip + cooldown). */
  fire(alt = false) {
    const t = this.tool(); if (!t) return false;
    const now = performance.now(); if (now - this.lastFire < 120) return true; this.lastFire = now;
    if (t === 'size_ray' && alt) { this.mode = this.mode === 'shrink' ? 'grow' : 'shrink'; this.toast(`Shrink / Grow Ray: ${this.mode.toUpperCase()} mode`); return true; }
    const o = this.eye(), d = this.dir(), hit = this.aim(o, d);
    const args = { item: t, o: [o.x, o.y, o.z], d: [d.x, d.y, d.z], p: [hit.p.x, hit.p.y, hit.p.z] };
    if (hit.target) args.target = hit.target;
    if (t === 'size_ray') args.mode = this.mode;
    if (t === 'gravity_gun') { if (this.holding) { args.mode = 'launch'; this.holding = false; } else if (hit.target && hit.target.type !== 'player') this.holding = true; }
    if (t === 'teleport_gun') args.p = [hit.floor.x, hit.floor.y, hit.floor.z];
    this.send('use', args);
    return true;
  }

  /** Server broadcast of a use (everyone draws it; host/target apply effects). */
  onUse(a, by) {
    const o = new THREE.Vector3(...a.o), d = new THREE.Vector3(...a.d), p = a.p ? new THREE.Vector3(...a.p) : o.clone().addScaledVector(d, 12);
    const mine = a.cid === this.myId();
    switch (a.item) {
      case 'plasma_blaster': this.projectile(o, d, p, () => { this.burst(p, M.plasma, 0.6); if (this.isHost()) this.sim.gadget(a.item, a.o, a.d, a); this.hitPlayer(a, p, d, 5.5); }); this.audio.play('drop'); break;
      case 'ion_beam': this.beam(o, p, M.ion, 0.55, 0.05); if (this.isHost()) this.sim.gadget(a.item, a.o, a.d, a); this.hitPlayer(a, p, d, 4); break;
      case 'wave_cannon': this.splash?.(a.o, a.d); if (this.isHost()) this.sim.gadget(a.item, a.o, a.d, a); break;
      case 'gravity_gun': this.beam(o, p, M.grav, a.mode === 'launch' ? 0.35 : 0.5, 0.04); if (a.mode === 'launch') this.burst(p, M.grav, 0.5); if (this.isHost()) { if (a.target) a.target.by = a.cid; this.sim.gadget(a.item, a.o, a.d, a); this.gravBy = a.mode === 'launch' ? null : a.cid; } this.hitPlayer(a, p, d, a.mode === 'launch' ? 9 : 0); break;
      case 'freeze_ray': this.beam(o, p, M.freeze, 0.5, 0.035); this.snow(p); if (this.isHost()) this.sim.gadget(a.item, a.o, a.d, a); if (a.target?.type === 'player' && a.target.id === this.myId()) { this.frozenT = 5; this.toast(`🧊 ${by.displayName || by.username} froze you!`); } break;
      case 'size_ray': this.beam(o, p, M.size, 0.45, 0.035); this.burst(p, M.size, 0.35); if (this.isHost()) this.sim.gadget(a.item, a.o, a.d, a); if (a.target?.type === 'player' && a.target.id === this.myId()) { const k = a.mode === 'grow' ? 1.6 : 0.5; this.sizeK = Math.abs(this.sizeK - k) < 0.01 ? 1 : k; this.toast(this.sizeK < 1 ? '🔍 You were shrunk!' : this.sizeK > 1 ? '🔍 You were grown to giant size!' : 'Back to normal size.'); } break;
      case 'teleport_gun': this.ring(o.clone().setY(o.y - 1.2), M.tele); this.ring(p, M.tele); if (mine) this.onTeleport?.(p); break;
      case 'confetti_cannon': this.confetti(o.clone().addScaledVector(d, 0.6), d, p); if (this.isHost()) this.sim.gadget(a.item, a.o, a.d, a); break;
    }
    if (a.target?.type === 'player') this.playerFx.set(a.target.id, { item: a.item, mode: a.mode, t: a.item === 'freeze_ray' ? 5 : 0 });
  }
  /** Knockback for the player that was hit (runs on their own client). */
  hitPlayer(a, p, d, power) {
    if (!power) return;
    const meNear = this.me.pos.clone().add(new THREE.Vector3(0, 0.9, 0)).distanceTo(p) < 1.4 || (a.target?.type === 'player' && a.target.id === this.myId());
    if (!meNear || a.cid === this.myId()) return;
    this.me.vel.x += d.x * power; this.me.vel.z += d.z * power; this.me.vel.y = Math.max(this.me.vel.y, 3); this.me.onGround = false;
  }

  // ---------- effect primitives ----------
  projectile(o, d, p, done) {
    const m = new THREE.Mesh(sphere, M.plasma); m.scale.setScalar(0.12); m.position.copy(o); this.parent.add(m);
    const glow = new THREE.Mesh(sphere, M.plasma); glow.scale.setScalar(2.2); m.add(glow);
    const len = Math.max(0.3, o.distanceTo(p));
    this.fx.push({ t: 0, life: len / 22, update: (f) => { m.position.copy(o).addScaledVector(d, Math.min(len, f.t * 22)); glow.material.opacity = 0.35; }, end: () => { this.parent.remove(m); done(); } });
  }
  beam(a, b, mat, life, r) {
    const m = new THREE.Mesh(cyl, mat); const mid = a.clone().add(b).multiplyScalar(0.5), len = a.distanceTo(b);
    m.position.copy(mid); m.scale.set(r, len, r); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this.parent.add(m);
    this.fx.push({ t: 0, life, update: (f) => { const k = 1 - f.t / life; m.scale.x = m.scale.z = r * (0.6 + 0.4 * Math.sin(f.t * 60)) * (0.4 + k); }, end: () => this.parent.remove(m) });
  }
  burst(p, mat, size) {
    const m = new THREE.Mesh(sphere, mat); m.position.copy(p); this.parent.add(m);
    this.fx.push({ t: 0, life: 0.35, update: (f) => m.scale.setScalar(size * (0.3 + f.t / 0.35)), end: () => this.parent.remove(m) });
  }
  ring(p, mat) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 6, 24), mat); m.rotation.x = Math.PI / 2; m.position.copy(p); this.parent.add(m);
    this.fx.push({ t: 0, life: 0.7, update: (f) => { m.scale.setScalar(0.3 + f.t * 2); m.position.y = p.y + f.t * 1.5; }, end: () => { this.parent.remove(m); m.geometry.dispose(); } });
  }
  particles(n, make, step, life) {
    const g = new THREE.Group(); this.parent.add(g);
    const ps = Array.from({ length: n }, (_, i) => { const m = make(i); g.add(m); return m; });
    this.fx.push({ t: 0, life, update: (f, dt) => ps.forEach((m) => step(m, dt)), end: () => this.parent.remove(g) });
  }
  confetti(o, d, p) {
    this.particles(70, (i) => { const m = new THREE.Mesh(quad, CONF[i % CONF.length]); m.position.copy(o); m.userData.v = d.clone().multiplyScalar(6 + Math.random() * 5).add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4)); m.userData.s = (Math.random() - 0.5) * 20; return m; },
      (m, dt) => { const v = m.userData.v; v.multiplyScalar(Math.exp(-dt * 2.2)); v.y -= 3 * dt; m.position.addScaledVector(v, dt); if (m.position.y < 0.02) { m.position.y = 0.02; v.set(0, 0, 0); } m.rotation.x += m.userData.s * dt; m.rotation.y += m.userData.s * 0.7 * dt; }, 2.6);
    void p;
  }
  snow(p) {
    this.particles(24, () => { const m = new THREE.Mesh(sphere, M.freeze); m.scale.setScalar(0.03); m.position.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, Math.random() * 0.8, (Math.random() - 0.5) * 0.8)); return m; }, (m, dt) => { m.position.y -= dt * 0.5; }, 1.2);
  }

  /** Per frame: effects, attachments, my own status, host-side shield/aura/gravity. */
  update(dt, { remotes }) {
    for (const f of this.fx) { f.t += dt; f.update(f, dt); }
    for (let i = this.fx.length - 1; i >= 0; i--) if (this.fx[i].t >= this.fx[i].life) { this.fx[i].end(); this.fx.splice(i, 1); }
    const t = performance.now() / 1000;
    for (const [cid, a] of this.attach) {
      if (a.aura) for (const s of a.aura.children) if (s.isMesh) { const k = s.userData.a + t * 1.6; s.position.set(Math.cos(k) * 0.55, s.userData.h + Math.sin(t * 2 + k) * 0.1, Math.sin(k) * 0.55); }
      if (a.shield) a.shield.scale.setScalar(1.05 + Math.sin(t * 3) * 0.03);
      if (a.jet) { const flying = cid === this.myId() ? this.me.flying : !!remotes.get(cid)?.fly; for (const f of a.jet.children) if (f.name === 'flame') { f.visible = flying; f.scale.set(1, 0.7 + Math.random() * 0.6, 1); } }
    }
    if (this.frozenT > 0) this.frozenT -= dt;
    // my size (shrink/grow ray) + ice block when frozen
    const av = this.avatarOf(this.myId());
    if (av) av.scale.setScalar(av.scale.x + (this.sizeK - av.scale.x) * Math.min(1, dt * 6));
    this.iceOn(this.myId(), this.frozenT > 0 || this.serverFrozen?.has(this.myId()));
    for (const [cid, f] of this.playerFx) {
      const r = this.avatarOf(cid); if (!r || cid === this.myId()) continue;
      if (f.item === 'size_ray' && !f.done) { const k = f.mode === 'grow' ? 1.6 : 0.5; f.k = Math.abs((r.userData.sizeK || 1) - k) < 0.01 ? 1 : k; r.userData.sizeK = f.k; f.done = true; }
      if (f.item === 'freeze_ray') { f.t -= dt; if (f.t <= 0) this.playerFx.delete(cid); }
    }
    for (const [cid, r] of remotes) {
      const k = r.mesh.userData.sizeK || 1; r.mesh.scale.setScalar(r.mesh.scale.x + (k - r.mesh.scale.x) * Math.min(1, dt * 6));
      this.iceOn(cid, (this.playerFx.get(cid)?.item === 'freeze_ray') || this.serverFrozen?.has(cid));
    }
    // host-side passive effects: shields bounce things away, auras cheer people up, gravity beam holds its target
    if (this.isHost()) {
      this.passiveT = (this.passiveT || 0) + dt;
      if (this.passiveT > 0.25) {
        this.passiveT = 0;
        for (const [cid, set] of this.gear) {
          const pos = cid === this.myId() ? this.me.pos : remotes.get(cid)?.mesh.position; if (!pos) continue;
          const c = pos.clone().add(new THREE.Vector3(0, 0.9, 0));
          if (set.has('shield_bubble')) this.sim.push(c, new THREE.Vector3(0, 0, -1), { range: 1.9, radial: true, power: 2.2, lift: 1 });
          if (set.has('golden_aura')) for (const p of this.sim.pax) if (p.state === 'seated' && p.mesh.position.distanceTo(pos) < 3.5) { p.mood = Math.min(100, p.mood + 1.2); p.panicT = 0; }
        }
      }
      if (this.sim.grav && this.gravBy) {
        const holder = this.gravBy === this.myId() ? { eye: this.eye(), dir: this.dir() } : remotes.get(this.gravBy) && { eye: remotes.get(this.gravBy).mesh.position.clone().add(new THREE.Vector3(0, 1.55, 0)), dir: new THREE.Vector3(-Math.sin(remotes.get(this.gravBy).ry), Math.sin(remotes.get(this.gravBy).pt || 0), -Math.cos(remotes.get(this.gravBy).ry)) };
        if (holder) this.sim.updateGravity(holder.eye, holder.dir); else this.sim.grav = null;
      }
    }
  }
  iceOn(cid, on) {
    const av = this.avatarOf(cid); if (!av) return;
    if (on && !av.userData.ice) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 1), ICE); m.scale.set(0.85, 1.25, 0.85); m.position.y = 0.85; av.add(m); av.userData.ice = m; }
    if (!on && av.userData.ice) { av.remove(av.userData.ice); av.userData.ice.geometry.dispose(); av.userData.ice = null; }
  }
}
const TOOLS = new Set(['plasma_blaster', 'ion_beam', 'wave_cannon', 'gravity_gun', 'freeze_ray', 'size_ray', 'teleport_gun', 'confetti_cannon']);
export const GADGET_TOOLS = TOOLS;
