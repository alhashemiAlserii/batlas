// Sky Crew pre-flight airport terminal: each player's check-in -> security -> gate -> boarded progress.
// The GAME SERVER is the authority: steps only advance in order, near the right desk (from the player's relayed
// position), and not faster than a person could do them. The host's simulation refuses to depart until every
// visible crew member is 'boarded', and anyone who skipped it is left off the payslip.
// Coordinates are aircraft-local metres (the terminal is built behind the parked plane; floor y = -2.4).
export const TERM_STEPS = ['none', 'checkin', 'security', 'gate', 'boarded'] as const;
export type TermStep = (typeof TERM_STEPS)[number];
export const FLOOR_Y = -2.4;
/** Must match web/public/play/sky-crew/js/terminal.js (STATIONS). */
export const STATIONS = {
  spawn: { x: 0, z: 59.5 },
  checkin: { x: -4.2, z: 53.6 }, // in front of the check-in counter
  belt: { x: -3.2, z: 47.3 }, // the X-ray belt entry
  arch: { x: 1.6, z: 44 }, // walk-through scanner (the security line is z = 44)
  gatedesk: { x: 2.6, z: 30.6 }, // in front of the boarding desk
  gate: { x: 0, z: 26 }, // gate door to the walkway
} as const;
export const STEP_REACH = 4.5; // metres from the desk the server accepts (relayed positions lag a little)
export const MIN_STEP_MS: Record<Exclude<TermStep, 'none'>, number> = { checkin: 1500, security: 2500, gate: 1500, boarded: 1500 };
/** Aircraft cabin bounds (rear door at z = 13, nose at z = -16, cabin floor y = 0). */
const inCabin = (p: number[]) => p[2] > -16 && p[2] < 13.2 && Math.abs(p[0]) < 2.4 && p[1] > -0.6 && p[1] < 3;
const near = (p: number[], s: { x: number; z: number }) => Math.hypot(p[0] - s.x, p[2] - s.z) <= STEP_REACH && Math.abs(p[1] - FLOOR_Y) < 1.2;

export interface TermState { step: TermStep; at: number }
export const newTerm = (now: number): TermState => ({ step: 'none', at: now });
export const stepIndex = (s: TermStep) => TERM_STEPS.indexOf(s);

/** Validate one requested step. Returns null if OK (and the caller advances), else an error code + message. */
export function checkStep(t: TermState, want: unknown, pos: number[] | null, now: number): { code: string; message: string } | null {
  if (typeof want !== 'string' || !(TERM_STEPS as readonly string[]).includes(want) || want === 'none') return { code: 'term_bad', message: 'Unknown airport step.' };
  const w = want as Exclude<TermStep, 'none'>;
  if (stepIndex(w) !== stepIndex(t.step) + 1) return { code: 'term_order', message: t.step === 'none' ? 'Check in at the desk first.' : t.step === 'checkin' ? 'Go through security first.' : t.step === 'security' ? 'Show your boarding pass at the gate first.' : 'You are already aboard.' };
  if (now - t.at < MIN_STEP_MS[w]) return { code: 'term_fast', message: 'Slow down: one step at a time.' };
  if (!pos) return { code: 'term_far', message: 'Walk up to the desk first.' };
  const ok = w === 'checkin' ? near(pos, STATIONS.checkin)
    : w === 'security' ? pos[2] < STATIONS.arch.z && pos[2] > STATIONS.gate.z && near(pos, { x: STATIONS.arch.x, z: STATIONS.arch.z - 1.5 })
      : w === 'gate' ? near(pos, STATIONS.gatedesk)
        : inCabin(pos);
  if (!ok) return { code: 'term_far', message: w === 'boarded' ? 'Get on the plane first.' : 'Walk up to the desk first.' };
  return null;
}
