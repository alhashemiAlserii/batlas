// Server-side flight tracking for salaries. The game server keeps its OWN record of each room's flight
// (server clock for takeoff/landing, who was aboard at takeoff, passengers lost, the landing reported at the
// end) and pays from that, never from a payout number sent by a browser. The room host still runs the physics,
// so the server also refuses anything implausible (too fast for the route, wrong order, replays).
import { computeSalary, ROUTE_KM, type Salary } from './shop.js';

const AIRBORNE = new Set(['climb', 'cruise', 'approach']);
const LANDINGS = new Set(['butter', 'good', 'hard', 'crash', 'none']);
export interface Flight {
  key: string; seed: number; route: string | null;
  airborneAt: number | null; landedAt: number | null; resultsAt: number | null;
  crew: Map<string, number>; // cid -> userId, aboard at takeoff
  paxBoarded: number; paxLost: number; paid: boolean; phases: string[];
}
export function newFlight(roomCode: string, seed: number, seq: number): Flight {
  return { key: `${roomCode}:${seed}:${seq}`, seed, route: null, airborneAt: null, landedAt: null, resultsAt: null, crew: new Map(), paxBoarded: 0, paxLost: 0, paid: false, phases: [] };
}
/**
 * Feed one host snapshot. Returns 'results' the first time a believable flight reaches its results screen.
 * crewNow: the visible, verified players in the room right now.
 */
export function trackSnapshot(f: Flight, w: any, now: number, crewNow: Map<string, number>): 'results' | null {
  const ph = typeof w?.ph === 'string' ? w.ph : '';
  if (typeof w?.route === 'string' && ROUTE_KM[w.route] && !f.airborneAt) f.route = w.route; // the route is fixed at takeoff
  const px: unknown[] = Array.isArray(w?.px) ? w.px.slice(0, 64) : [];
  const states = px.map((p) => (Array.isArray(p) ? String(p[5]) : ''));
  if (f.phases[f.phases.length - 1] !== ph) f.phases.push(ph);
  if (AIRBORNE.has(ph) && !f.airborneAt) {
    f.airborneAt = now;
    f.crew = new Map(crewNow);
    f.paxBoarded = states.filter((s) => s === 'seated').length;
  }
  if (f.airborneAt) f.paxLost = Math.max(f.paxLost, states.filter((s) => s === 'lost').length); // never goes down
  if (ph === 'landed' && f.airborneAt && !f.landedAt) f.landedAt = now;
  if (ph === 'results' && f.airborneAt && !f.resultsAt && !f.paid) { f.resultsAt = now; return 'results'; }
  return null;
}
/** Salary from the tracked facts (+ the landing grade from the final snapshot, whitelisted). */
export function salaryFor(f: Flight, w: any, payoutMul: number): Salary & { facts: Record<string, unknown> } {
  const res = w?.res && typeof w.res === 'object' ? w.res : {};
  const landing = LANDINGS.has(res.landing) ? res.landing : 'none';
  const crashed = !!res.crashed || landing === 'crash';
  const end = f.landedAt ?? f.resultsAt ?? 0;
  const facts = { route: f.route ?? '?', airborneSec: Math.max(0, (end - (f.airborneAt ?? end)) / 1000), paxBoarded: f.paxBoarded, paxLost: f.paxLost, landing, crashed, arrived: !!f.route && res.landedAt === f.route, payoutMul };
  return { ...computeSalary({ ...facts, route: f.route ?? '' }), facts };
}
