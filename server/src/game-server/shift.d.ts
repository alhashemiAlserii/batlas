export const ROUTE_LADDER: { code: string; name: string; tier: number; need: { route: string; stars: number } | null }[];
export function unlocksFromHistory(flights: { route?: string; stars?: number; crashed?: boolean }[]): {
  open: string[];
  best: Record<string, number>;
  clearFlights: number;
};
export const CALLS: Record<string, { item: string | null; talk: boolean; points: number; roles: string[]; label: string; verb: string }>;
export const INCIDENTS: Record<string, { points: number; fail: number; roles: string[]; timeout: number; label: string }>;
export const COACH: Record<string, string>;
export function createShift(opts?: {
  seed?: number;
  route?: string;
  tutorial?: boolean;
  solo?: boolean;
  paxIds?: number[];
  roles?: Record<string, string | null>;
}): Shift;
export interface Shift {
  tick(dt: number, ctx?: Record<string, unknown>): { spawned: unknown[]; ended: unknown[]; coach: string | null; points: number };
  act(cid: string, action: Record<string, unknown>, ctx?: Record<string, unknown>): { ok: boolean; reason?: string; points?: number; item?: string | null; pax?: number; kind?: string; callId?: number; incident?: string };
  finish(): ShiftCard;
  snapshot(): Record<string, unknown>;
  card(): ShiftCard;
  noteSeats(list: { id: number; x: number; z: number }[]): void;
  force(kind: string): { id: number; kind: string; item?: string | null } | null;
  setPhase(p: string): void;
  seed: number;
  readonly route: string;
  readonly tutorial: boolean;
  readonly finished: boolean;
}
export interface ShiftCard {
  points: number;
  stars: number;
  lines: [string, number][];
  resolved: number;
  missed: number;
  incidentsHandled: number;
  incidentsFailed: number;
  route: string;
  tutorial: boolean;
  coach: string | null;
  landing: string | null;
  crashed: boolean;
  arrived: boolean;
  flightT: number;
}
