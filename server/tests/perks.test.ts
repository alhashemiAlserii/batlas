// Sky Crew class perks (the pure game-logic functions shared by the client simulation)
import { describe, it, expect } from 'vitest';
// @ts-expect-error plain browser ES module without types
import * as P from '../../web/public/play/sky-crew/js/perks.js';
// @ts-expect-error plain browser ES module without types
import { newFlight, stepFlight } from '../../web/public/play/sky-crew/js/flight.js';
import { CLASS_IDS } from '../src/game-server/shop.js';

describe('class perks', () => {
  it('every server class has a client perk definition', () => {
    for (const id of CLASS_IDS) expect(P.CLASS_INFO[id]?.perk).toBeTruthy();
  });
  it('Ace Pilot: less turbulence, softer landing grade, wider glide window', () => {
    expect(P.turbulenceFactor('ace_pilot')).toBeLessThan(P.turbulenceFactor(null));
    expect(P.landingGrade(-3, false, null)).toBe('good');
    expect(P.landingGrade(-3, false, 'ace_pilot')).toBe('butter');
    expect(P.landingGrade(-5.5, false, null)).toBe('hard');
    expect(P.landingGrade(-5.5, false, 'ace_pilot')).toBe('good');
    expect(P.landingGrade(-1, true, 'ace_pilot')).toBe('crash');
    expect(P.glideWindow('ace_pilot').high).toBeGreaterThan(P.glideWindow(null).high);
  });
  it('Cabin Pro reaches further; Mechanic doubles fault deadlines and reaches the panel further', () => {
    expect(P.serveReach('cabin_pro')).toBeGreaterThan(P.serveReach(null));
    expect(P.fixDeadline(30, ['mechanic'])).toBe(60);
    expect(P.fixDeadline(30, ['navigator'])).toBe(30);
    expect(P.fixDeadline(30, new Map([['a', 'mechanic']]))).toBe(60);
    expect(P.fixReach('mechanic')).toBeGreaterThan(P.fixReach(null));
  });
  it('Navigator tailwind shortens the flight (ground speed ×1.12)', () => {
    expect(P.tailwind(['navigator'])).toBeCloseTo(1.12);
    const a = newFlight(), b = newFlight();
    for (const f of [a, b]) { f.onGround = false; f.y = 800; f.speed = 100; f.throttle = 0.7; }
    b.tailwind = P.tailwind(['navigator']);
    for (let i = 0; i < 100; i++) { stepFlight(a, {}, 0.05, 0); stepFlight(b, {}, 0.05, 0); }
    const da = Math.hypot(a.x, a.z - newFlight().z), db = Math.hypot(b.x, b.z - newFlight().z);
    expect(db / da).toBeGreaterThan(1.1);
  });
  it('Security Chief catches only within range; Baggage Master carries two', () => {
    expect(P.securityCatches({ x: 0, y: 1, z: 10 }, [{ cls: 'security', x: 0, y: 1, z: 12 }])).toBe(true);
    expect(P.securityCatches({ x: 0, y: 1, z: 10 }, [{ cls: 'security', x: 0, y: 1, z: 20 }])).toBe(false);
    expect(P.securityCatches({ x: 0, y: 1, z: 10 }, [{ cls: 'cabin_pro', x: 0, y: 1, z: 10 }])).toBe(false);
    expect(P.carryLimit('baggage')).toBe(2);
    expect(P.carryLimit('mechanic')).toBe(1);
  });
});
