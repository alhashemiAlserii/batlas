// Arcade flight model. Units: metres, seconds. World frame: y up, heading 0 = -z.
import { GEAR_H, ORIGIN, DEST } from './world.js';

export const KT = 1.94384; // m/s -> knots
export const FT = 3.28084;
const VR = 68; // rotate speed (~132 kt)
const STALL = 52;

export function newFlight() {
  return { x: ORIGIN.x, y: GEAR_H, z: ORIGIN.z, yaw: 0, pitch: 0, bank: 0, speed: 0, throttle: 0, onGround: true, vs: 0, engineFail: false, crashed: false, touchdown: null, airborneOnce: false, stall: false };
}

export function onRunway(ap, x, z) {
  return Math.abs(x - ap.x) < ap.w / 2 + 6 && z < ap.z + 70 && z > ap.z - ap.len + 40;
}

/**
 * Advance the flight. inp: { pitch -1..1, roll -1..1, throttleDelta -1..1 }.
 * turb: vertical/attitude jolts from weather & events.
 */
export function stepFlight(f, inp, dt, turb = 0) {
  if (f.crashed) { f.speed = Math.max(0, f.speed - 20 * dt); return; }
  f.throttle = Math.min(1, Math.max(0, f.throttle + (inp.throttleDelta || 0) * 0.45 * dt));
  const thrust = f.throttle * (f.engineFail ? 4.5 : 9.0);
  const drag = 0.000625 * f.speed * f.speed + (f.onGround ? 0.25 : 0);
  const brake = f.onGround && f.throttle < 0.2 && f.speed > 0 ? (f.airborneOnce ? 5 : 3.2) : 0;
  f.speed = Math.max(0, f.speed + (thrust - drag - brake - (f.onGround ? 0 : Math.sin(f.pitch) * 9.8 * 0.6)) * dt);

  if (f.onGround) {
    const steer = (inp.roll || 0) * 0.35 * Math.min(1, f.speed / 8) * (f.speed > 40 ? 0.35 : 1);
    f.yaw -= steer * dt;
    const want = f.speed > VR * 0.9 && (inp.pitch || 0) > 0 ? Math.min(0.22, f.pitch + 0.35 * dt) : Math.max(0, f.pitch - 0.5 * dt);
    f.pitch = want;
    f.bank *= Math.max(0, 1 - 4 * dt);
    if (f.speed > VR && f.pitch > 0.07) { f.onGround = false; f.airborneOnce = true; }
    f.y = f.onGround ? GEAR_H : GEAR_H + 0.05;
    f.vs = 0;
  } else {
    f.pitch += (inp.pitch || 0) * 0.45 * dt;
    if (!inp.pitch) f.pitch *= Math.max(0, 1 - 0.15 * dt);
    f.pitch = Math.max(-0.45, Math.min(0.42, f.pitch));
    f.bank += (inp.roll || 0) * 0.9 * dt;
    if (!inp.roll) f.bank *= Math.max(0, 1 - 0.9 * dt);
    f.bank = Math.max(-0.75, Math.min(0.75, f.bank));
    f.yaw -= Math.sin(f.bank) * 0.42 * Math.min(1.2, f.speed / 80) * dt;
    f.stall = f.speed < STALL;
    let climb = f.speed * Math.sin(f.pitch) * Math.cos(f.bank);
    if (f.speed < 62) climb -= (62 - f.speed) * 0.3; // not enough lift
    if (f.stall) f.pitch = Math.max(-0.45, f.pitch - 0.25 * dt);
    climb += turb;
    f.vs = climb;
    f.y += climb * dt;
  }
  const horiz = f.speed * Math.cos(f.pitch);
  f.x += -Math.sin(f.yaw) * horiz * dt;
  f.z += -Math.cos(f.yaw) * horiz * dt;

  if (!f.onGround && f.y <= GEAR_H) {
    // touchdown
    const rwy = onRunway(DEST, f.x, f.z) ? 'CRP' : onRunway(ORIGIN, f.x, f.z) ? 'HBF' : null;
    const vs = f.vs;
    f.y = GEAR_H; f.onGround = true;
    const hard = vs < -6 || Math.abs(f.bank) > 0.3;
    const crash = vs < -12 || !rwy && f.speed > 30 || Math.abs(f.bank) > 0.55;
    f.touchdown = { vs, rwy, hard, crash, at: Date.now() };
    if (crash) f.crashed = true;
    f.pitch = 0; f.bank = 0;
  }
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
