// Sky Crew service shift. Pure rules: no DOM, no physics.
// The browser and the game server import this same file. The server is the
// authority in a co-op room; a solo flight runs the same rules locally.
//
// Original to Batlas. Route names, call names and incident names are ours.

export const ROUTE_LADDER = [
  { code: 'DNB', name: 'Dune Bay', tier: 1, need: null },
  { code: 'CRP', name: 'Coral Point', tier: 2, need: { route: 'DNB', stars: 2 } },
  { code: 'PNR', name: 'Pine Ridge', tier: 3, need: { route: 'CRP', stars: 3 } },
];

/** Which destinations a crew may pick, from flights already stored on the account. */
export function unlocksFromHistory(flights) {
  const best = { DNB: 0, CRP: 0, PNR: 0 };
  const flew = { DNB: false, CRP: false, PNR: false };
  let clearFlights = 0;
  for (const f of flights || []) {
    const code = f && f.route;
    if (!Object.prototype.hasOwnProperty.call(best, code)) continue;
    const stars = Math.max(0, Math.min(5, Math.round(Number(f.stars) || 0)));
    if (!f.crashed) {
      flew[code] = true;
      clearFlights++;
      if (stars > best[code]) best[code] = stars;
    }
  }
  const open = ['DNB'];
  // A saved clear flight on a route keeps it open, so older profiles are not locked out.
  if (best.DNB >= 2 || flew.CRP || best.CRP >= 2) open.push('CRP');
  if (best.CRP >= 3 || flew.PNR || best.PNR >= 2) open.push('PNR');
  return { open, best, clearFlights };
}

export const CALLS = {
  drink: { item: 'water', talk: false, points: 40, roles: ['cabin', 'copilot'], label: 'Drink', verb: 'Give the water' },
  meal: { item: 'snack', talk: false, points: 40, roles: ['cabin'], label: 'Meal', verb: 'Give the snack box' },
  blanket: { item: 'blanket', talk: false, points: 45, roles: ['cabin'], label: 'Blanket', verb: 'Tuck in the blanket' },
  lav: { item: null, talk: true, points: 50, roles: ['cabin'], label: 'Lavatory', verb: 'Walk them to the lav' },
  sick: { item: 'water', talk: false, points: 55, roles: ['cabin', 'copilot'], label: 'Airsick', verb: 'Bring water' },
  cry: { item: null, talk: true, points: 50, roles: ['cabin'], label: 'Crying child', verb: 'Comfort the child' },
  unruly: { item: null, talk: true, points: 60, roles: ['cabin', 'copilot'], label: 'Unruly passenger', verb: 'Calm them down' },
  lost: { item: 'charm', talk: false, points: 55, roles: ['cabin', 'cargo'], label: 'Lost keepsake', verb: 'Return the keepsake' },
};

export const INCIDENTS = {
  turbulence: { points: 35, fail: 0, roles: ['pilot', 'copilot'], timeout: 7, label: 'Chop' },
  galley_fire: { points: 90, fail: 70, roles: ['cabin', 'cargo'], timeout: 28, label: 'Galley flare' },
  cargo_spill: { points: 80, fail: 50, roles: ['cargo'], timeout: 36, label: 'Cargo spill' },
  medical: { points: 100, fail: 80, roles: ['cabin', 'copilot'], timeout: 32, label: 'Medical' },
};

export const COACH = {
  bags: 'Training hop. Pick up a bag on the cart and carry it into the forward hold.',
  board: 'Let the passengers sit, close both doors, then take the captain\'s seat and throttle up.',
  serve: 'Airborne. Someone wants a drink. The galley is at the back of the cabin.',
  fly: 'Call answered. Follow the marker to Dune Bay and lower the gear before you land.',
  brace: 'Chop! Hit the seatbelt sign so the cabin braces, and hold on.',
  land: 'The bumps passed. Line up with the runway and land gently.',
  done: 'Training hop complete. Two stars at Dune Bay unlocks Coral Point.',
};

const CALL_BY_TIER = {
  1: ['drink', 'meal', 'blanket', 'lav'],
  2: ['drink', 'meal', 'blanket', 'lav', 'sick', 'cry', 'lost'],
  3: ['drink', 'meal', 'blanket', 'lav', 'sick', 'cry', 'unruly', 'lost'],
};
const INCIDENT_BY_TIER = {
  1: ['turbulence', 'cargo_spill'],
  2: ['turbulence', 'cargo_spill', 'galley_fire', 'medical'],
  3: ['turbulence', 'galley_fire', 'cargo_spill', 'medical'],
};

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampDt(dt) {
  const n = Number(dt);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(0.25, n);
}

/**
 * One flight's service shift.
 * opts: { seed, route, tutorial, solo, paxIds, roles }
 * roles: { [cid]: 'pilot'|'copilot'|'cabin'|'cargo' }
 */
export function createShift(opts = {}) {
  const seed = (Number(opts.seed) >>> 0) || 1;
  const rng = mulberry32(seed);
  const route = ROUTE_LADDER.some((r) => r.code === opts.route) ? opts.route : 'DNB';
  const tier = ROUTE_LADDER.find((r) => r.code === route).tier;
  const tutorial = !!opts.tutorial;
  let solo = !!opts.solo;
  let paxIds = sanitizeIds(opts.paxIds);
  const roles = { ...(opts.roles || {}) };
  let phase = 'boarding';
  let flightT = 0;
  let nextCall = tutorial ? 99 : 4 + tier;
  let nextIncident = tutorial ? 99 : 16 - tier * 2;
  let seq = 1;
  const calls = [];
  const incidents = [];
  const lines = [];
  let points = 0;
  let resolved = 0;
  let missed = 0;
  let incidentsHandled = 0;
  let incidentsFailed = 0;
  let departed = false;
  let landing = null;
  let crashed = false;
  let arrived = false;
  let finished = false;
  let coach = tutorial ? 'bags' : null;
  let belt = false;
  let beltDuringChop = false;
  let tutQuiet = 0;
  let sawDrink = false;
  const seats = {};

  function addPoints(label, amt) {
    const n = Math.round(amt);
    if (!n) return;
    points += n;
    lines.push([label, n]);
    if (lines.length > 40) lines.shift();
  }

  function bonus(cid, rolesOk) {
    if (solo) return 1.35;
    const role = cid ? roles[cid] : null;
    if (!role) return 1.1;
    return rolesOk.includes(role) ? 1.45 : 1;
  }

  function openCalls() { return calls.filter((c) => !c.done); }

  function cap() { return tutorial ? 1 : Math.min(4, tier + 1); }

  function pickPax() {
    if (!paxIds.length) return null;
    const busy = new Set(openCalls().map((c) => c.pax));
    const free = paxIds.filter((id) => !busy.has(id));
    const pool = free.length ? free : paxIds;
    return pool[Math.floor(rng() * pool.length)];
  }

  function spawnCall(kind, pax) {
    const def = CALLS[kind];
    if (!def || !pax) return null;
    const call = { id: seq++, pax, kind, item: def.item, talk: def.talk, age: 0, done: false, missed: false };
    calls.push(call);
    return call;
  }

  function spawnIncident(kind) {
    const def = INCIDENTS[kind];
    if (!def || incidents.some((i) => i.kind === kind && !i.done)) return null;
    const inc = { id: seq++, kind, age: 0, done: false, failed: false };
    incidents.push(inc);
    if (kind === 'turbulence') beltDuringChop = !!belt;
    if (kind === 'medical') {
      const c = spawnCall('sick', pickPax());
      inc.linked = c ? c.id : null;
    }
    return inc;
  }

  function pubCall(c) {
    return { id: c.id, pax: c.pax, kind: c.kind, item: c.item, talk: !!c.talk, age: Math.round(c.age) };
  }
  function pubInc(i) {
    return { id: i.id, kind: i.kind, age: Math.round(i.age), timeout: INCIDENTS[i.kind].timeout };
  }

  function tick(dt, ctx = {}) {
    dt = clampDt(dt);
    if (ctx.phase) phase = String(ctx.phase);
    if (ctx.roles) Object.assign(roles, ctx.roles);
    if (typeof ctx.solo === 'boolean') solo = ctx.solo;
    if (Array.isArray(ctx.paxIds)) paxIds = sanitizeIds(ctx.paxIds);
    if (ctx.belt != null) belt = !!ctx.belt;
    if (Array.isArray(ctx.seats)) noteSeats(ctx.seats);
    const flying = phase === 'climb' || phase === 'cruise' || phase === 'approach';
    if (flying) flightT += dt;
    const spawned = [];
    const ended = [];
    if (finished || !dt) return { spawned, ended, coach, points };

    if (belt && incidents.some((i) => i.kind === 'turbulence' && !i.done)) beltDuringChop = true;

    if (tutorial && flying) {
      if (!sawDrink && flightT > 0.8) {
        sawDrink = true;
        const c = spawnCall('drink', paxIds[0] || 1);
        if (c) spawned.push({ t: 'call', call: pubCall(c) });
        coach = 'serve';
      }
      if (resolved >= 1 && !incidents.some((i) => i.kind === 'turbulence')) {
        tutQuiet += dt;
        if (tutQuiet > 2.5) {
          const inc = spawnIncident('turbulence');
          if (inc) spawned.push({ t: 'incident', incident: pubInc(inc) });
          coach = 'brace';
        }
      }
    } else if (flying) {
      const rate = 0.75 + tier * 0.28;
      nextCall -= dt * rate;
      if (nextCall <= 0 && openCalls().length < cap()) {
        nextCall = (tier >= 3 ? 6 : tier === 2 ? 9 : 12) + rng() * 5;
        const bag = CALL_BY_TIER[tier];
        const c = spawnCall(bag[Math.floor(rng() * bag.length)], pickPax());
        if (c) spawned.push({ t: 'call', call: pubCall(c) });
      }
      nextIncident -= dt * (tier === 1 ? 0.7 : 1);
      if (nextIncident <= 0 && !incidents.some((i) => !i.done)) {
        nextIncident = (tier >= 3 ? 14 : 22) + rng() * 8;
        const bag = INCIDENT_BY_TIER[tier];
        const inc = spawnIncident(bag[Math.floor(rng() * bag.length)]);
        if (inc) spawned.push({ t: 'incident', incident: pubInc(inc) });
      }
    }

    const limit = tutorial ? 40 : 34 - tier * 4;
    for (const c of calls) {
      if (c.done) continue;
      c.age += dt;
      if (c.age > limit) {
        c.done = true;
        c.missed = true;
        missed++;
        addPoints(`Missed: ${CALLS[c.kind].label}`, -18);
        ended.push({ t: 'miss', id: c.id, pax: c.pax, kind: c.kind });
      }
    }
    for (const inc of incidents) {
      if (inc.done) continue;
      inc.age += dt;
      const def = INCIDENTS[inc.kind];
      if (inc.kind === 'turbulence' && inc.age >= def.timeout) {
        inc.done = true;
        incidentsHandled++;
        const pts = beltDuringChop ? def.points : Math.round(def.points * 0.35);
        addPoints(beltDuringChop ? 'Chop: cabin braced' : 'Chop: no brace call', pts);
        ended.push({ t: 'incident-end', id: inc.id, kind: inc.kind, ok: true });
        if (tutorial && coach === 'brace') coach = 'land';
      } else if (inc.kind !== 'turbulence' && inc.age >= def.timeout) {
        inc.done = true;
        inc.failed = true;
        incidentsFailed++;
        addPoints(`${def.label} got away`, -def.fail);
        ended.push({ t: 'incident-end', id: inc.id, kind: inc.kind, ok: false });
      }
    }
    return { spawned, ended, coach, points };
  }

  function near(pos, seat, reach) {
    if (!pos || !seat) return true;
    const dx = Number(pos[0]) - Number(seat.x);
    const dz = Number(pos[2]) - Number(seat.z);
    const r = Number(reach) || 3.8;
    return dx * dx + dz * dz <= r * r;
  }

  function act(cid, action, ctx = {}) {
    if (!action || typeof action !== 'object') return { ok: false, reason: 'Bad action.' };
    if (ctx.role && cid) roles[cid] = ctx.role;
    if (finished && action.k !== 'land') return { ok: false, reason: 'The flight is already scored.' };
    if (action.k === 'resolve') {
      const call = calls.find((c) => c.id === Number(action.id) && !c.done);
      if (!call) return { ok: false, reason: 'That call is already done.' };
      const def = CALLS[call.kind];
      const item = action.item == null || action.item === '' ? null : String(action.item);
      if (def.talk) {
        if (item) return { ok: false, reason: 'Put that down and talk to them.' };
      } else if (item !== def.item) {
        return { ok: false, reason: needText(def.item) };
      }
      const seat = seats[call.pax];
      if (ctx.pos && seat && !near(ctx.pos, seat, ctx.reach)) return { ok: false, reason: 'Step closer.' };
      call.done = true;
      resolved++;
      const pts = Math.round(def.points * bonus(cid, def.roles));
      addPoints(def.label, pts);
      if (call.kind === 'sick') {
        const med = incidents.find((i) => i.kind === 'medical' && !i.done);
        if (med) {
          med.done = true;
          incidentsHandled++;
          const mp = Math.round(INCIDENTS.medical.points * bonus(cid, INCIDENTS.medical.roles));
          addPoints('Medical handled', mp);
        }
      }
      if (tutorial && coach === 'serve') coach = 'fly';
      return { ok: true, points: pts, callId: call.id, pax: call.pax, kind: call.kind, item: def.item };
    }
    if (action.k === 'extinguish') {
      const inc = incidents.find((i) => i.kind === 'galley_fire' && !i.done);
      if (!inc) return { ok: false, reason: 'The galley is calm.' };
      const pos = ctx.pos;
      if (pos && !(Number(pos[2]) > 7.2 && Number(pos[0]) > 0.15)) return { ok: false, reason: 'The extinguisher is in the galley.' };
      inc.done = true;
      incidentsHandled++;
      const pts = Math.round(INCIDENTS.galley_fire.points * bonus(cid, INCIDENTS.galley_fire.roles));
      addPoints('Galley flare put out', pts);
      return { ok: true, points: pts, incident: 'galley_fire' };
    }
    if (action.k === 'secure') {
      const inc = incidents.find((i) => i.kind === 'cargo_spill' && !i.done);
      if (!inc) return { ok: false, reason: 'Nothing is loose in the hold.' };
      const pos = ctx.pos;
      if (pos && !(Number(pos[2]) < -7.2 && Number(pos[2]) > -13.6)) return { ok: false, reason: 'Secure the load from the cargo hold.' };
      inc.done = true;
      incidentsHandled++;
      const pts = Math.round(INCIDENTS.cargo_spill.points * bonus(cid, INCIDENTS.cargo_spill.roles));
      addPoints('Cargo secured', pts);
      return { ok: true, points: pts, incident: 'cargo_spill' };
    }
    if (action.k === 'depart') {
      if (departed) return { ok: false, reason: 'Already rolling.' };
      departed = true;
      const bags = Math.max(0, Math.min(12, Math.round(Number(action.bags) || 0)));
      const seated = Math.max(0, Math.min(24, Math.round(Number(action.seated) || 0)));
      addPoints(`Bags stowed (${bags})`, bags * 12);
      addPoints(`Passengers seated (${seated})`, seated * 6);
      if (action.checklist) addPoints('Pre-flight checklist', 80);
      if (tutorial && coach === 'bags' && bags > 0) coach = 'board';
      return { ok: true, points };
    }
    if (action.k === 'land') {
      if (landing) return { ok: false, reason: 'Already graded.' };
      const g = ['butter', 'good', 'hard', 'crash', 'none'].includes(action.grade) ? action.grade : 'none';
      landing = g;
      crashed = !!action.crashed || g === 'crash';
      arrived = !!action.arrived && !crashed;
      const table = { butter: 160, good: 90, hard: -30, crash: -400, none: 0 };
      const mult = g === 'crash' ? 1 : bonus(cid, ['pilot']);
      addPoints(`Landing: ${g}`, Math.round(table[g] * mult));
      if (arrived) addPoints('On the right runway', 70);
      else if (!crashed && landing !== 'none') addPoints('Landed short of the destination', -40);
      if (tutorial) coach = 'done';
      return { ok: true, grade: g, points };
    }
    return { ok: false, reason: 'Unknown duty.' };
  }

  function starsFor() {
    if (crashed) return 0;
    const potential = tutorial ? 420 : 780 + tier * 220;
    const ratio = points / potential;
    let stars = ratio > 0.82 ? 5 : ratio > 0.6 ? 4 : ratio > 0.4 ? 3 : ratio > 0.2 ? 2 : points > 0 ? 1 : 0;
    if (missed >= 5) stars = Math.min(stars, 3);
    if (!arrived && landing && landing !== 'crash' && landing !== 'none') stars = Math.min(stars, 3);
    return stars;
  }

  function card() {
    return {
      points,
      stars: starsFor(),
      lines: lines.slice(),
      resolved,
      missed,
      incidentsHandled,
      incidentsFailed,
      route,
      tutorial,
      coach,
      landing,
      crashed,
      arrived,
      flightT: Math.round(flightT),
    };
  }

  function finish() {
    finished = true;
    if (tutorial && !coach) coach = 'done';
    return card();
  }

  function noteSeats(list) {
    for (const s of list || []) {
      const id = Number(s.id);
      if (!id || !Number.isFinite(Number(s.x)) || !Number.isFinite(Number(s.z))) continue;
      seats[id] = { x: Number(s.x), z: Number(s.z) };
    }
  }

  function snapshot() {
    return {
      route,
      tier,
      tutorial,
      coach,
      phase,
      points,
      flightT: Math.round(flightT),
      calls: openCalls().map(pubCall),
      incidents: incidents.filter((i) => !i.done).map(pubInc),
      card: finished ? card() : null,
      resolved,
      missed,
      belt: beltDuringChop,
    };
  }

  return {
    tick,
    act,
    finish,
    snapshot,
    card,
    noteSeats,
    setPhase(p) { phase = String(p || ''); },
    /** Test and tutorial hooks. Not wired to the network. */
    force(kind) {
      if (CALLS[kind]) return spawnCall(kind, paxIds[0] || 1);
      if (INCIDENTS[kind]) return spawnIncident(kind);
      return null;
    },
    seed,
    get route() { return route; },
    get tutorial() { return tutorial; },
    get finished() { return finished; },
  };
}

function sanitizeIds(list) {
  const out = [];
  for (const n of list || []) {
    const id = Math.round(Number(n));
    if (id > 0 && id < 1000 && !out.includes(id)) out.push(id);
    if (out.length >= 24) break;
  }
  return out;
}

function needText(item) {
  if (item === 'water') return 'They need a bottle of water from the galley.';
  if (item === 'snack') return 'They need a snack box from the galley.';
  if (item === 'blanket') return 'They need a blanket from the galley.';
  if (item === 'charm') return 'Find their keepsake and bring it back.';
  return 'That is not what they asked for.';
}

export const CALL_BUBBLE = {
  drink: 'drink', meal: 'meal', blanket: 'blanket', lav: 'lav', sick: 'sick', cry: 'cry', unruly: 'unruly', lost: 'charm',
};
