// Airliner flight model. Units: metres, seconds, newtons. World frame: y up, heading 0 = -z.
// Attitudes integrate from moments and a fixed inertia tensor, on a fixed 60 Hz step,
// so a 30 Hz iPad and a 120 Hz Mac take the same path.
import { GEAR_H, ORIGIN, DEST, ROUTES, OBSTACLES } from './world.js';

export const KT = 1.94384; // m/s -> knots
export const FT = 3.28084;
const VR = 68; // rotate speed (~132 kt)
const STALL = 52;
export const PHYS_DT = 1 / 60;
const MAX_SUB = 5;

// Lengthened narrow-body (about 42 m long, 37 m span, 62 t). Roll inertia is the
// smallest because the mass sits near the centreline; pitch and yaw follow the long fuselage.
export const MASS = 62000;
export const INERTIA = { roll: 2.45e6, pitch: 6.9e6, yaw: 7.6e6 };
export const RHO = 1.225;
export const WING = { area: 122, span: 37.2, chord: 4.05 };
// Nacelles sit on the wing, just below the mass centre. Matched thrust pitches the
// nose up a little and has no yaw or roll. Yaw appears only when the two engines differ.
export const ENGINE_X = 7.8;
export const THRUST_BELOW = 0.36;
const EACH = MASS * 4.5; // newtons at full throttle; two engines give 9 m/s²

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function dynamicPressure(speed) {
  const v = Math.max(0, speed || 0);
  return 0.5 * RHO * v * v;
}

/** Fraction of full thrust each engine is making right now. */
export function engineFractions(f) {
  const throttle = clamp(f.throttle || 0, 0, 1);
  let left = f.engineL == null ? throttle : clamp(f.engineL, 0, 1);
  let right = f.engineR == null ? throttle : clamp(f.engineR, 0, 1);
  // A symmetric engine failure halves both. It does not yaw the aircraft.
  if (f.engineFail && f.engineL == null && f.engineR == null) { left *= 0.5; right *= 0.5; }
  return { left, right };
}

/**
 * Moments from the engines, N·m. Positive roll lowers the right wing,
 * positive pitch raises the nose, positive yaw swings the nose right.
 * Roll is always zero: both nacelles are at the same height.
 */
export function thrustMoments(f) {
  const { left, right } = engineFractions(f);
  const Fl = left * EACH, Fr = right * EACH;
  return {
    roll: 0,
    pitch: (Fl + Fr) * THRUST_BELOW,
    yaw: (Fl - Fr) * ENGINE_X,
  };
}

/**
 * Aerodynamic moments, N·m. Each axis answers its own control, scaled by dynamic
 * pressure, and is damped by its own rate. The only cross-axis terms are adverse
 * yaw from the ailerons and a mild roll from yaw rate.
 */
export function aeroMoments(state, input = {}) {
  const speed = Math.max(0, state.speed || 0);
  const q = dynamicPressure(speed);
  const v = Math.max(speed, 14);
  const flaps = state.flaps === 1 || state.flaps === 2 ? state.flaps : 0;
  const flap = 1 + flaps * 0.1;
  const { area: S, span: b, chord: c } = WING;
  const p = state.rollRate || 0, qq = state.pitchRate || 0, r = state.yawRate || 0;
  const pHat = p * b / (2 * v);
  const qHat = qq * c / (2 * v);
  const rHat = r * b / (2 * v);
  const alpha = (state.pitch || 0) - (state.trim || 0);
  const rollIn = clamp(input.roll || 0, -1, 1);
  const pitchIn = clamp(input.pitch || 0, -1, 1);
  const yawIn = clamp(input.yaw || 0, -1, 1);
  const roll = q * S * b * (0.034 * rollIn * flap - 0.52 * pHat + 0.06 * rHat);
  const pitch = q * S * c * (0.55 * pitchIn * flap - 150 * qHat - 1.35 * alpha);
  const yaw = q * S * b * (0.013 * yawIn - 0.22 * rHat - 0.0048 * rollIn);
  return { roll, pitch, yaw, q };
}

function add(a, b) {
  return { roll: a.roll + b.roll, pitch: a.pitch + b.pitch, yaw: a.yaw + b.yaw };
}

function capMoment(m) {
  const lim = (v, i, a) => clamp(v, -i * a, i * a);
  return {
    roll: lim(m.roll, INERTIA.roll, 1.15),
    pitch: lim(m.pitch, INERTIA.pitch, 0.7),
    yaw: lim(m.yaw, INERTIA.yaw, 0.85),
  };
}

export function newFlight() {
  return {
    x: ORIGIN.x, y: GEAR_H, z: ORIGIN.z,
    yaw: 0, pitch: 0, bank: 0,
    rollRate: 0, pitchRate: 0, yawRate: 0, trim: 0,
    speed: 0, throttle: 0, onGround: true, vs: 0,
    gearDown: true, engineFail: false, crashed: false,
    touchdown: null, airborneOnce: false, stall: false,
    _acc: 0,
  };
}

export function onRunway(ap, x, z) {
  return Math.abs(x - ap.x) < ap.w / 2 + 6 && z < ap.z + 70 && z > ap.z - ap.len + 40;
}

function stepOnce(f, inp, dt, turb) {
  f.throttle = clamp(f.throttle + (inp.throttleDelta || 0) * 0.45 * dt, 0, 1);
  const fr = engineFractions(f);
  const thrust = 4.5 * (fr.left + fr.right);
  const flaps = f.flaps === 1 || f.flaps === 2 ? f.flaps : 0;
  const dragK = 0.000625 + (f.gearDown ? 0.00012 : 0) + (flaps ? flaps * 0.00008 : 0);
  const drag = dragK * f.speed * f.speed + (f.onGround ? 0.25 : 0);
  const brake = f.onGround && f.throttle < 0.2 && f.speed > 0 ? (f.airborneOnce ? 5 : 3.2) : 0;
  const along = f.onGround ? 0 : Math.sin(f.pitch) * 9.8 * 0.6;
  f.speed = Math.max(0, f.speed + (thrust - drag - brake - along) * dt);

  let moments = add(aeroMoments(f, inp), thrustMoments(f));
  if (!f.onGround && f.speed < STALL) {
    const depth = (STALL - f.speed) / STALL;
    moments.pitch -= INERTIA.pitch * 0.32 * depth;
  }
  if (f.onGround) {
    const tiller = 1 - smooth(8, 45, f.speed);
    const yawIn = clamp(inp.yaw || 0, -1, 1);
    const pull = Math.max(0, inp.pitch || 0);
    const rotating = f.speed > VR * 0.88 && pull > 0.12;
    // Nosewheel at low speed. The rudder (already inside aeroMoments) grows with q and takes over.
    moments.yaw += yawIn * tiller * INERTIA.yaw * 0.62;
    moments.yaw += -f.yawRate * INERTIA.yaw * (1.8 + tiller * 1.2);
    // Gear holds the wings level and the nose on the runway. Capped later so it cannot flip the aircraft.
    moments.roll += INERTIA.roll * (-8 * f.bank - 4.6 * f.rollRate);
    if (!rotating) moments.pitch += INERTIA.pitch * (-7 * f.pitch - 4 * f.pitchRate);
    else if (f.pitch < 0) moments.pitch += INERTIA.pitch * (-7 * f.pitch - 3 * f.pitchRate);
    else if (f.pitch > 0.2) moments.pitch += INERTIA.pitch * (-12 * (f.pitch - 0.2) - 3 * f.pitchRate);
  }
  moments = capMoment(moments);
  f.rollRate = clamp(f.rollRate + moments.roll / INERTIA.roll * dt, -0.45, 0.45);
  f.pitchRate = clamp(f.pitchRate + moments.pitch / INERTIA.pitch * dt, -0.22, 0.22);
  f.yawRate = clamp(f.yawRate + moments.yaw / INERTIA.yaw * dt, -0.35, 0.35);
  f.bank += f.rollRate * dt;
  f.pitch += f.pitchRate * dt;
  f.yaw -= f.yawRate * dt;
  if (!f.onGround) {
    // Bank tilts the lift, so the nose follows the turn. This is the flight path, not a control bleed.
    const turn = Math.sin(f.bank) * 0.40 * Math.min(1.15, f.speed / 78);
    f.yaw -= turn * dt;
  }
  f.pitch = clamp(f.pitch, -0.45, 0.42);
  f.bank = clamp(f.bank, -0.75, 0.75);
  if ((f.pitch >= 0.42 && f.pitchRate > 0) || (f.pitch <= -0.45 && f.pitchRate < 0)) f.pitchRate = 0;
  if ((f.bank >= 0.75 && f.rollRate > 0) || (f.bank <= -0.75 && f.rollRate < 0)) f.rollRate = 0;

  if (f.onGround) {
    const pull = Math.max(0, inp.pitch || 0);
    if (f.speed > VR && f.pitch > 0.09 && pull > 0.08) { f.onGround = false; f.airborneOnce = true; }
    if (f.onGround) { f.y = GEAR_H; f.vs = 0; f.stall = false; }
  }
  if (!f.onGround) {
    f.stall = f.speed < STALL;
    let climb = f.speed * Math.sin(f.pitch) * Math.cos(f.bank);
    if (flaps) climb += (flaps === 2 ? 5.2 : 3.1) * Math.min(1, f.speed / 58) * Math.max(0, Math.cos(f.pitch));
    if (f.speed < 62) climb -= (62 - f.speed) * 0.3;
    climb += turb || 0;
    f.vs = climb;
    f.y += climb * dt;
  }
  if (!f.onGround) for (const o of OBSTACLES) {
    const d = Math.hypot(f.x - o.x, f.z - o.z);
    if (d < o.r && f.y < o.h * (1 - d / o.r) + 3) {
      f.crashed = true; f.onGround = true;
      f.touchdown = { vs: f.vs, rwy: null, hard: true, crash: true, terrain: true, at: Date.now() };
      f.speed *= 0.2; f.rollRate = f.pitchRate = f.yawRate = 0;
      return;
    }
  }
  const horiz = f.speed * Math.cos(f.pitch) * (f.onGround ? 1 : f.tailwind || 1);
  f.x += -Math.sin(f.yaw) * horiz * dt;
  f.z += -Math.cos(f.yaw) * horiz * dt;

  if (!f.onGround && f.y <= GEAR_H) {
    const ap = [DEST, ORIGIN, ...Object.values(ROUTES)].find((a) => onRunway(a, f.x, f.z));
    const rwy = ap ? ap.code : null;
    const vs = f.vs;
    f.y = GEAR_H; f.onGround = true;
    const hard = vs < -6 || Math.abs(f.bank) > 0.3;
    const belly = !f.gearDown;
    const crash = belly || vs < -12 || !rwy && f.speed > 30 || Math.abs(f.bank) > 0.55;
    f.touchdown = { vs, rwy, hard, crash, belly, at: Date.now() };
    if (crash) f.crashed = true;
    f.pitch = 0; f.bank = 0; f.pitchRate = 0; f.rollRate = 0;
  }
}

/**
 * Advance the flight. inp: { pitch, roll, yaw, throttleDelta }, each -1..1.
 * turb: vertical gust from weather. Simulation steps are fixed at 1/60 s.
 */
export function stepFlight(f, inp, dt, turb = 0) {
  if (f.crashed) {
    f.speed = Math.max(0, f.speed - 20 * dt);
    f.rollRate = f.pitchRate = f.yawRate = 0;
    return;
  }
  if (!(dt > 0)) return;
  f._acc = (f._acc || 0) + Math.min(0.1, dt);
  let steps = 0;
  while (f._acc >= PHYS_DT - 1e-9 && steps < MAX_SUB) {
    f._acc -= PHYS_DT;
    stepOnce(f, inp, PHYS_DT, turb);
    steps++;
    if (f.crashed) { f._acc = 0; return; }
  }
  if (steps === MAX_SUB) f._acc = Math.min(f._acc, PHYS_DT);
}

export function distTo(f, ap) { return Math.hypot(ap.x - f.x, ap.z - f.z); }
/** Bearing to target relative to heading, radians (-pi..pi, positive = target on the right). */
export function relBearing(f, ap) {
  const want = Math.atan2(-(ap.x - f.x), -(ap.z - f.z));
  let d = f.yaw - want;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Glide-path guidance for the active destination: 3° slope to the runway threshold. */
export function glidePath(f, ap = DEST) {
  const thrZ = ap.z + 60;
  const along = f.z - thrZ;
  const lateral = f.x - ap.x;
  const h = f.y - GEAR_H;
  const angle = along > 1 ? (Math.atan2(h, along) * 180) / Math.PI : 0;
  const ideal = along * Math.tan((3 * Math.PI) / 180);
  const papi = angle > 3.7 ? 4 : angle > 3.2 ? 3 : angle > 2.8 ? 2 : angle > 2.3 ? 1 : 0;
  return { along, lateral, h, angle, ideal, dev: h - ideal, papi, active: along > -200 && along < 12000 && Math.abs(lateral) < 4000 };
}
