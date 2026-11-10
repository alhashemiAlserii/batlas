// Sky Crew economy: salary formula + shop catalogue (all names and designs original to Sky Crew).
// Shared by the website routes (wallet, purchases) and the game server (salary checks, class picks).
import { OUTFITS, HATS, OUTFIT_COLORS, type Outfit } from './outfits.js';

export type ItemKind = 'outfit' | 'hat' | 'color' | 'class';
export interface ShopItem { key: string; kind: ItemKind; id: string; name: string; price: number; icon: string; description: string }

export const CLASSES = [
  { id: 'ace_pilot', name: 'Ace Pilot', icon: '🛩️', price: 1500, description: 'Steadier controls in turbulence and a wider landing-guide window.' },
  { id: 'cabin_pro', name: 'Cabin Pro', icon: '☕', price: 1000, description: 'Serves food and drinks faster; passengers near you calm down quicker.' },
  { id: 'mechanic', name: 'Mechanic', icon: '🔧', price: 1200, description: 'Repairs twice as fast and sees faults coming before they hit.' },
  { id: 'navigator', name: 'Navigator', icon: '🧭', price: 1200, description: 'Turbulence warnings ahead of time and a tailwind shortcut on every route.' },
  { id: 'security', name: 'Security Chief', icon: '🛡️', price: 1400, description: 'Calms unruly passengers instantly and catches anyone about to fall out of the door.' },
  { id: 'baggage', name: 'Baggage Master', icon: '🧳', price: 1000, description: 'Carries two bags at once and loads the hold faster.' },
] as const;
export const CLASS_IDS = CLASSES.map((c) => c.id) as string[];

const OUTFIT_INFO: Record<(typeof OUTFITS)[number], [string, number, string]> = {
  captain: ['Captain uniform', 0, '🧑‍✈️'], hoodie: ['Comfy hoodie', 0, '🧥'], attendant: ['Flight attendant', 300, '💁'],
  mechanic: ['Mechanic overalls', 300, '🧰'], explorer: ['Explorer jacket', 450, '🧭'], astronaut: ['Space suit', 900, '🧑‍🚀'], dino: ['Dino costume', 1200, '🦖'],
};
const HAT_INFO: Record<(typeof HATS)[number], [string, number, string]> = {
  none: ['No hat', 0, '🙂'], captain: ['Captain hat', 0, '🧢'], cap: ['Baseball cap', 0, '🧢'], beanie: ['Beanie', 120, '🧶'], pillbox: ['Pillbox hat', 150, '🎩'],
  bucket: ['Bucket hat', 150, '👒'], hardhat: ['Hard hat', 150, '⛑️'], headphones: ['Headphones', 200, '🎧'], party: ['Party hat', 250, '🥳'], tophat: ['Top hat', 400, '🎩'],
};
export const FREE_COLORS = 4; // colours 0..3 are starters, the rest are bought
export const COLOR_PRICE = 80;

export const CATALOG: ShopItem[] = [
  ...OUTFITS.map((id) => ({ key: `outfit:${id}`, kind: 'outfit' as const, id, name: OUTFIT_INFO[id][0], price: OUTFIT_INFO[id][1], icon: OUTFIT_INFO[id][2], description: 'Outfit' })),
  ...HATS.map((id) => ({ key: `hat:${id}`, kind: 'hat' as const, id, name: HAT_INFO[id][0], price: HAT_INFO[id][1], icon: HAT_INFO[id][2], description: 'Hat' })),
  ...Array.from({ length: OUTFIT_COLORS }, (_, i) => ({ key: `color:${i}`, kind: 'color' as const, id: String(i), name: `Colour ${i + 1}`, price: i < FREE_COLORS ? 0 : COLOR_PRICE, icon: '🎨', description: 'Outfit colour' })),
  ...CLASSES.map((c) => ({ key: `class:${c.id}`, kind: 'class' as const, id: c.id, name: c.name, price: c.price, icon: c.icon, description: c.description })),
];
export const ITEM_BY_KEY = new Map(CATALOG.map((i) => [i.key, i]));
export const STARTER_KEYS = new Set(CATALOG.filter((i) => i.price === 0).map((i) => i.key));

/** Can this owned-set wear this outfit? (Starters are free; Developers own everything.) */
export function outfitAllowed(o: Outfit, owns: (key: string) => boolean) {
  return owns(`outfit:${o.outfit}`) && owns(`hat:${o.hat}`) && owns(`color:${o.color}`);
}

// ---------------------------------------------------------------- salary (computed by the server)
export const ROUTE_KM: Record<string, number> = { CRP: 16.8, DNB: 10.4, PNR: 25.6 };
export const MAX_SPEED_MS = 140; // fastest the aircraft can go (m/s); used for the minimum believable flight time
export const SALARY_CAP = 1500; // hard cap per flight per crew member
export const MAX_PAID_FLIGHTS_PER_HOUR = 8;
export const LANDING_BONUS: Record<string, number> = { butter: 150, good: 80, hard: 0, crash: 0, none: 0 };
export interface FlightFacts { route: string; airborneSec: number; paxBoarded: number; paxLost: number; landing: string; crashed: boolean; arrived: boolean; payoutMul?: number }
export interface Salary { amount: number; lines: [string, number][]; rejected?: string }

/** Minimum believable airborne time for a route (seconds), from the distance and the top speed. */
export const minAirborneSec = (route: string) => Math.floor(((ROUTE_KM[route] ?? 10) * 1000) / MAX_SPEED_MS * 0.85);

/** The salary each crew member is paid. Every input comes from the server's own room tracking. */
export function computeSalary(f: FlightFacts): Salary {
  if (!ROUTE_KM[f.route]) return { amount: 0, lines: [], rejected: 'unknown route' };
  if (f.airborneSec < minAirborneSec(f.route)) return { amount: 0, lines: [], rejected: `flight too short (${Math.round(f.airborneSec)} s < ${minAirborneSec(f.route)} s)` };
  if (f.crashed) return { amount: 0, lines: [['Crash: no salary', 0]] };
  const lines: [string, number][] = [];
  const km = ROUTE_KM[f.route];
  lines.push([`Route pay (${km} km)`, Math.round(120 + km * 10)]);
  const delivered = Math.max(0, Math.min(40, f.paxBoarded) - Math.max(0, f.paxLost));
  lines.push([`Passengers delivered (${delivered})`, delivered * 8]);
  if (f.paxLost > 0) lines.push([`Passengers lost (${f.paxLost})`, -40 * Math.min(40, f.paxLost)]);
  lines.push([`Landing: ${f.landing}`, LANDING_BONUS[f.landing] ?? 0]);
  if (!f.arrived) lines.push(['Did not reach the destination', -150]);
  let amount = lines.reduce((a, [, v]) => a + v, 0);
  const mul = Math.max(0.5, Math.min(3, f.payoutMul ?? 1));
  if (mul !== 1) { const extra = Math.round(Math.max(0, amount) * (mul - 1)); lines.push([`Developer payout multiplier ×${mul}`, extra]); amount += extra; }
  amount = Math.max(0, Math.min(SALARY_CAP, Math.round(amount)));
  return { amount, lines };
}
