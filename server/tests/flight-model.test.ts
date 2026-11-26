// Torque, dynamic pressure and the fixed-step airliner model.
import { describe, it, expect } from 'vitest';
// @ts-expect-error plain browser ES module without types
import {
  newFlight, stepFlight, dynamicPressure, thrustMoments, aeroMoments, engineFractions,
  INERTIA, MASS, PHYS_DT, WING,
} from '../../web/public/play/sky-crew/js/flight.js';
// @ts-expect-error plain browser ES module without types
import { aftRampAngles, GEAR_H } from '../../web/public/play/sky-crew/js/world.js';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('airliner moments', () => {
  it('uses a narrow-body inertia tensor: roll lightest, pitch and yaw heavy', () => {
    expect(INERTIA.roll).toBeGreaterThan(1.2e6);
    expect(INERTIA.roll).toBeLessThan(4e6);
    expect(INERTIA.pitch).toBeGreaterThan(INERTIA.roll * 2);
    expect(INERTIA.yaw).toBeGreaterThan(INERTIA.pitch);
    expect(MASS).toBeGreaterThan(40000);
    expect(WING.span).toBeGreaterThan(30);
  });

  it('scales control moments with dynamic pressure and leaves them weak at low speed', () => {
    const slow = aeroMoments({ speed: 12, pitch: 0, rollRate: 0, pitchRate: 0, yawRate: 0 }, { pitch: 1, roll: 1, yaw: 1 });
    const fast = aeroMoments({ speed: 100, pitch: 0, rollRate: 0, pitchRate: 0, yawRate: 0 }, { pitch: 1, roll: 1, yaw: 1 });
    expect(dynamicPressure(100) / dynamicPressure(50)).toBeCloseTo(4, 5);
    expect(fast.pitch / slow.pitch).toBeCloseTo(dynamicPressure(100) / dynamicPressure(12), 4);
    expect(Math.abs(slow.roll)).toBeLessThan(Math.abs(fast.roll) * 0.05);
    expect(fast.roll).toBeGreaterThan(0);
    expect(fast.pitch).toBeGreaterThan(0);
    expect(fast.yaw).toBeGreaterThan(0);
  });

  it('damps each axis against its own rate and does not bleed pitch into roll', () => {
    const still = aeroMoments({ speed: 90, pitch: 0.05, rollRate: 0, pitchRate: 0, yawRate: 0 }, { pitch: 0, roll: 0, yaw: 0 });
    const rated = aeroMoments({ speed: 90, pitch: 0.05, rollRate: 0.3, pitchRate: 0.1, yawRate: 0.2 }, {});
    expect(rated.roll).toBeLessThan(0);
    expect(rated.pitch).toBeLessThan(still.pitch);
    expect(rated.yaw).toBeLessThan(0);
    const pitchOnly = aeroMoments({ speed: 90, pitch: 0, rollRate: 0, pitchRate: 0, yawRate: 0 }, { pitch: 1, roll: 0, yaw: 0 });
    expect(pitchOnly.roll).toBe(0);
    expect(pitchOnly.yaw).toBe(0);
  });

  it('aileron input yaws the nose the other way (adverse yaw) and yaw rate rolls the wing', () => {
    const ail = aeroMoments({ speed: 80, pitch: 0, rollRate: 0, pitchRate: 0, yawRate: 0 }, { roll: 1 });
    expect(ail.roll).toBeGreaterThan(0);
    expect(ail.yaw).toBeLessThan(0);
    const yawing = aeroMoments({ speed: 80, pitch: 0, rollRate: 0, pitchRate: 0, yawRate: 0.25 }, {});
    expect(yawing.roll).not.toBe(0);
  });

  it('matched thrust has no yaw or roll, only a small nose-up moment', () => {
    const f = newFlight();
    f.throttle = 1;
    const m = thrustMoments(f);
    expect(m.roll).toBe(0);
    expect(m.yaw).toBe(0);
    expect(m.pitch).toBeGreaterThan(0);
    const accel = m.pitch / INERTIA.pitch;
    expect(accel).toBeLessThan(0.08);
    f.throttle = 0.2;
    const low = thrustMoments(f);
    expect(low.yaw).toBe(0);
    expect(low.roll).toBe(0);
    expect(low.pitch).toBeCloseTo(m.pitch * 0.2, 4);
  });

  it('a symmetric engine failure halves both engines and does not yaw', () => {
    const f = newFlight();
    f.throttle = 1;
    f.engineFail = true;
    expect(engineFractions(f)).toEqual({ left: 0.5, right: 0.5 });
    const m = thrustMoments(f);
    expect(m.yaw).toBe(0);
    expect(m.roll).toBe(0);
    expect(m.pitch).toBeCloseTo(thrustMoments({ throttle: 1 }).pitch * 0.5, 3);
  });

  it('yaws only when one engine actually differs, toward the dead engine', () => {
    const deadLeft = thrustMoments({ throttle: 1, engineL: 0, engineR: 1 });
    const deadRight = thrustMoments({ throttle: 1, engineL: 1, engineR: 0 });
    expect(deadLeft.roll).toBe(0);
    expect(deadRight.roll).toBe(0);
    expect(deadLeft.yaw).toBeLessThan(0);
    expect(deadRight.yaw).toBeGreaterThan(0);
    expect(near(deadLeft.yaw, -deadRight.yaw)).toBe(true);
  });
});

describe('fixed-step handling', () => {
  const run = (dt: number, n: number, inp: Record<string, number>, patch: (f: ReturnType<typeof newFlight>) => void = () => {}) => {
    const f = newFlight();
    patch(f);
    for (let i = 0; i < n; i++) stepFlight(f, inp, dt, 0);
    return f;
  };

  it('is the same at 60 Hz and in 50 ms chunks', () => {
    const a = run(PHYS_DT, 180, { pitch: 0.4, roll: -0.3, yaw: 0.2, throttleDelta: 0.5 }, (f) => { f.onGround = false; f.y = 400; f.speed = 70; f.throttle = 0.6; });
    const b = run(0.05, 60, { pitch: 0.4, roll: -0.3, yaw: 0.2, throttleDelta: 0.5 }, (f) => { f.onGround = false; f.y = 400; f.speed = 70; f.throttle = 0.6; });
    expect(a.x).toBeCloseTo(b.x, 4);
    expect(a.z).toBeCloseTo(b.z, 4);
    expect(a.pitch).toBeCloseTo(b.pitch, 5);
    expect(a.bank).toBeCloseTo(b.bank, 5);
    expect(a.yaw).toBeCloseTo(b.yaw, 5);
    expect(a.speed).toBeCloseTo(b.speed, 4);
  });

  it('rolls straight down the runway with no input and no throttle yaw', () => {
    const f = run(0.05, 80, { throttleDelta: 1 });
    expect(f.speed).toBeGreaterThan(20);
    expect(Math.abs(f.yaw)).toBeLessThan(0.01);
    expect(Math.abs(f.bank)).toBeLessThan(0.02);
    expect(Math.abs(f.yawRate)).toBeLessThan(0.02);
  });

  it('rotates when pulled at speed and stays wings-level', () => {
    const f = newFlight();
    f.throttle = 1;
    f.speed = 75;
    for (let i = 0; i < 90; i++) stepFlight(f, { pitch: 1, roll: 0, yaw: 0 }, 0.05, 0);
    expect(f.pitch).toBeGreaterThan(0.09);
    expect(f.onGround).toBe(false);
    expect(Math.abs(f.bank)).toBeLessThan(0.05);
    expect(Math.abs(f.yaw)).toBeLessThan(0.05);
  });

  it('nosewheel steers at taxi speed and the rudder still works once the tiller fades', () => {
    const slow = newFlight();
    slow.speed = 6;
    for (let i = 0; i < 40; i++) stepFlight(slow, { yaw: 1 }, 0.05, 0);
    expect(slow.yaw).toBeLessThan(-0.05);
    const fast = newFlight();
    fast.speed = 60;
    fast.throttle = 0.8;
    const before = fast.yaw;
    for (let i = 0; i < 40; i++) stepFlight(fast, { yaw: 1 }, 0.05, 0);
    expect(fast.yaw).toBeLessThan(before - 0.01);
    expect(Math.abs(fast.bank)).toBeLessThan(0.08);
  });

  it('banks into a turn and the nose follows, without a spin', () => {
    const f = newFlight();
    f.onGround = false;
    f.y = 500;
    f.speed = 90;
    f.throttle = 0.7;
    for (let i = 0; i < 40; i++) stepFlight(f, { roll: 1 }, 0.05, 0);
    const banked = f.bank;
    expect(banked).toBeGreaterThan(0.15);
    const yawBefore = f.yaw;
    for (let i = 0; i < 60; i++) stepFlight(f, { roll: 0.2 }, 0.05, 0);
    expect(f.yaw).toBeLessThan(yawBefore - 0.05);
    expect(Math.abs(f.rollRate)).toBeLessThan(0.5);
    expect(Number.isFinite(f.pitch + f.bank + f.yaw)).toBe(true);
  });

  it('settles pitch instead of oscillating or running away', () => {
    const f = newFlight();
    f.onGround = false;
    f.y = 800;
    f.speed = 100;
    f.throttle = 0.7;
    f.pitch = 0.2;
    let peak = 0;
    for (let i = 0; i < 200; i++) {
      stepFlight(f, {}, 0.05, 0);
      peak = Math.max(peak, Math.abs(f.pitchRate));
    }
    expect(Math.abs(f.pitch)).toBeLessThan(0.2);
    expect(Math.abs(f.pitchRate)).toBeLessThan(0.05);
    expect(peak).toBeLessThan(0.25);
    expect(Math.abs(f.bank)).toBeLessThan(0.02);
    expect(Math.abs(f.yaw)).toBeLessThan(0.05);
  });

  it('lowers the rear ramp onto the ground and stows it up the tail', () => {
    const a = aftRampAngles();
    expect(a.down.y).toBeCloseTo(-GEAR_H, 2);
    expect(a.down.z).toBeGreaterThan(17);
    expect(a.stowed.z).toBeGreaterThan(a.down.z - 1);
    expect(a.stowed.y).toBeGreaterThan(-0.5);
    expect(a.stowed.y).toBeLessThan(2.2);
    expect(a.open).toBeGreaterThan(a.closed);
    expect(a.beta).toBeGreaterThan(0.2);
    expect(a.beta).toBeLessThan(0.5);
  });

  it('one dead engine yaws; matched throttle does not', () => {
    const sym = newFlight();
    sym.onGround = false;
    sym.y = 400;
    sym.speed = 80;
    sym.throttle = 0.8;
    const asym = newFlight();
    Object.assign(asym, { onGround: false, y: 400, speed: 80, throttle: 0.8, engineL: 0, engineR: 1 });
    for (let i = 0; i < 50; i++) { stepFlight(sym, {}, 0.05, 0); stepFlight(asym, {}, 0.05, 0); }
    expect(Math.abs(sym.yaw)).toBeLessThan(0.02);
    expect(Math.abs(sym.bank)).toBeLessThan(0.05);
    expect(asym.yaw).toBeGreaterThan(0.08);
  });
});
