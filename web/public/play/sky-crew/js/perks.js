// Sky Crew classes: the gameplay perks. Pure functions + numbers so the game logic and the unit tests share them.
// Which class a player has comes ONLY from the server's room info (the server checks ownership before a pick).
export const CLASS_INFO = {
  ace_pilot: { icon: '🛩️', name: 'Ace Pilot', perk: 'Turbulence shakes the plane 65% less, softer landing grades and a wider glide-path window.' },
  cabin_pro: { icon: '☕', name: 'Cabin Pro', perk: 'Serve passengers from further away, served passengers get extra happy, and seated passengers near you calm down.' },
  mechanic: { icon: '🔧', name: 'Mechanic', perk: 'Faults are announced 8 s early, the crew gets twice as long to fix them, and you reach the panel from further away.' },
  navigator: { icon: '🧭', name: 'Navigator', perk: 'Turbulence and air pockets announced 6 s early, plus a 12% tailwind that shortens every flight.' },
  security: { icon: '🛡️', name: 'Security Chief', perk: 'Catches passengers about to fall out of an open door (within 4 m) and calms them right down.' },
  baggage: { icon: '🧳', name: 'Baggage Master', perk: 'Carries two bags at once and throws them 40% further.' },
};
export const PERK = {
  aceTurb: 0.35, // Ace Pilot flying: turbulence jolts on the aircraft ×0.35
  aceGlide: 1.6, // Ace Pilot: landing-guide "on slope" window ×1.6
  aceLanding: { butter: -3.4, good: -6.2 }, // touchdown vertical speed limits (normal: -2.5 / -5)
  proReach: 3.6, // Cabin Pro serving reach (normal 2.6 m)
  proServeMood: 12, // extra mood per served request
  proCalmRadius: 3.5, proCalmRate: 2.5, // mood per second for seated passengers near a Cabin Pro
  mechDeadline: 2, // fault fix deadline ×2 with a Mechanic aboard
  mechReach: 4.5, // fix the panel from further away
  mechWarn: 8, // seconds of early warning before a fault hits
  navWarn: 6, // seconds of turbulence warning
  navTailwind: 1.12, // ground speed ×1.12 with a Navigator aboard (shorter flight)
  secCatchRadius: 4, // Security Chief catches passengers about to fall out within 4 m
  secCalmMood: 35,
  bagCarry: 2, // Baggage Master carries two bags
  bagThrow: 1.4, // and throws them further into the hold
};
const has = (classes, id) => { for (const k of classes.values ? classes.values() : classes) if (k === id) return true; return false; };
/** classes: Map(cid -> classId) or array of class ids for the crew in the room */
export const crewHas = has;
export function turbulenceFactor(pilotClass) { return pilotClass === 'ace_pilot' ? PERK.aceTurb : 1; }
export function landingGrade(vs, crash, pilotClass) {
  if (crash) return 'crash';
  const lim = pilotClass === 'ace_pilot' ? PERK.aceLanding : { butter: -2.5, good: -5 };
  return vs > lim.butter ? 'butter' : vs > lim.good ? 'good' : 'hard';
}
export function glideWindow(pilotClass) { const k = pilotClass === 'ace_pilot' ? PERK.aceGlide : 1; return { high: 40 * k, low: -30 * k }; }
export function serveReach(cls) { return cls === 'cabin_pro' ? PERK.proReach : 2.6; }
export function fixReach(cls) { return cls === 'mechanic' ? PERK.mechReach : 2.6; }
export function fixDeadline(base, classes) { return base && has(classes, 'mechanic') ? base * PERK.mechDeadline : base; }
export function tailwind(classes) { return has(classes, 'navigator') ? PERK.navTailwind : 1; }
export function carryLimit(cls) { return cls === 'baggage' ? PERK.bagCarry : 1; }
/** Security Chief catch: any Security Chief within range of the falling passenger? positions: [{cls, x, y, z}] */
export function securityCatches(pax, crew) { return crew.some((c) => c.cls === 'security' && Math.hypot(c.x - pax.x, c.y - pax.y, c.z - pax.z) < PERK.secCatchRadius); }
