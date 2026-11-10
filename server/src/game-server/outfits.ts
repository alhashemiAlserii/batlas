// Sky Crew outfits: the whitelist the server validates against (players pick in the game menu).
// All designs are original to Sky Crew. The client keeps a matching list in web/public/play/sky-crew/js/outfits.js.
export const OUTFITS = ['captain', 'attendant', 'mechanic', 'hoodie', 'explorer', 'dino', 'astronaut'] as const;
export const HATS = ['none', 'captain', 'pillbox', 'beanie', 'cap', 'bucket', 'hardhat', 'party', 'tophat', 'headphones'] as const;
export const OUTFIT_COLORS = 10; // palette indexes 0..9
export const SKIN_TONES = 7;     // 0..6
export interface Outfit { outfit: (typeof OUTFITS)[number]; hat: (typeof HATS)[number]; color: number; skin: number }
export const DEFAULT_OUTFIT: Outfit = { outfit: 'captain', hat: 'captain', color: 0, skin: 1 };

/** Normalise an outfit from an untrusted source; null when anything is not on the whitelist. */
export function validOutfit(v: unknown): Outfit | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const int = (x: unknown, n: number) => (Number.isInteger(x) && (x as number) >= 0 && (x as number) < n ? (x as number) : null);
  if (!(OUTFITS as readonly string[]).includes(String(o.outfit))) return null;
  if (!(HATS as readonly string[]).includes(String(o.hat))) return null;
  const color = int(o.color, OUTFIT_COLORS), skin = int(o.skin, SKIN_TONES);
  if (color === null || skin === null) return null;
  return { outfit: o.outfit as Outfit['outfit'], hat: o.hat as Outfit['hat'], color, skin };
}
export function parseStoredOutfit(json: string | null | undefined): Outfit {
  if (!json) return { ...DEFAULT_OUTFIT };
  try { return validOutfit(JSON.parse(json)) ?? { ...DEFAULT_OUTFIT }; } catch { return { ...DEFAULT_OUTFIT }; }
}
