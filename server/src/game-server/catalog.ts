/**
 * Sky Crew item + command catalogue shared by the game server and its tests.
 *
 * DEV_ITEMS is the Developer's secret inventory. It is sent ONLY to sockets whose rank the
 * website verified as DEVELOPER; equipping and using any of these is re-checked on the server
 * for every message. All items are cartoon/fictional gadgets.
 */
export const DEV_CATEGORIES = ['Energy Weapons', 'Experimental', 'Abilities', 'Movement', 'Equipment', 'Effects'] as const;
export type DevCategory = (typeof DEV_CATEGORIES)[number];

export interface DevItem {
  id: string;
  name: string;
  category: DevCategory;
  /** 'tool' = held in the hand and fired with use; 'toggle' = an always-on ability while equipped. */
  kind: 'tool' | 'toggle';
  /** minimum seconds between two uses (server-enforced) */
  cooldown: number;
  description: string;
  icon: string;
}

export const DEV_ITEMS: readonly DevItem[] = [
  { id: 'plasma_blaster', name: 'Plasma Blaster', category: 'Energy Weapons', kind: 'tool', cooldown: 0.25, icon: '🔫', description: 'Fires bouncy plasma blobs that knock people and luggage back.' },
  { id: 'ion_beam', name: 'Ion Beam', category: 'Energy Weapons', kind: 'tool', cooldown: 0.6, icon: '⚡', description: 'A crackling beam that shoves everything along its line.' },
  { id: 'wave_cannon', name: 'Wave Cannon', category: 'Energy Weapons', kind: 'tool', cooldown: 0.5, icon: '🌊', description: 'A ring of air that pushes a whole area outwards.' },
  { id: 'gravity_gun', name: 'Gravity Gun', category: 'Experimental', kind: 'tool', cooldown: 0.3, icon: '🧲', description: 'Use once to lift what you aim at, again to launch it.' },
  { id: 'freeze_ray', name: 'Freeze Ray', category: 'Experimental', kind: 'tool', cooldown: 0.4, icon: '❄️', description: 'Turns a passenger (or player) into a harmless ice cube for a few seconds.' },
  { id: 'size_ray', name: 'Shrink / Grow Ray', category: 'Experimental', kind: 'tool', cooldown: 0.4, icon: '🔍', description: 'Shrinks or grows the target. Right-click / second button switches mode.' },
  { id: 'teleport_gun', name: 'Teleport Gun', category: 'Experimental', kind: 'tool', cooldown: 0.5, icon: '🌀', description: 'Zaps you to the spot you aim at.' },
  { id: 'super_speed', name: 'Super Speed', category: 'Abilities', kind: 'toggle', cooldown: 0, icon: '💨', description: '2.5x running speed with speed streaks.' },
  { id: 'super_jump', name: 'Super Jump', category: 'Abilities', kind: 'toggle', cooldown: 0, icon: '🦘', description: 'Jump three times higher, land softly.' },
  { id: 'jetpack', name: 'Jetpack', category: 'Movement', kind: 'toggle', cooldown: 0, icon: '🚀', description: 'Hold jump to fly. Flames included.' },
  { id: 'noclip', name: 'Noclip', category: 'Movement', kind: 'toggle', cooldown: 0, icon: '👻', description: 'Float through walls, seats and the fuselage as a ghost.' },
  { id: 'shield_bubble', name: 'Shield Bubble', category: 'Equipment', kind: 'toggle', cooldown: 0, icon: '🛡️', description: 'A bubble that bounces people and things away from you.' },
  { id: 'golden_aura', name: 'Golden Aura', category: 'Effects', kind: 'toggle', cooldown: 0, icon: '✨', description: 'Sparkly golden glow that cheers up nearby passengers.' },
  { id: 'confetti_cannon', name: 'Confetti Cannon', category: 'Effects', kind: 'tool', cooldown: 0.35, icon: '🎉', description: 'Party blast! Passengers it hits cheer.' },
] as const;
export const DEV_ITEM_IDS = new Set(DEV_ITEMS.map((i) => i.id));
export const devItem = (id: unknown) => (typeof id === 'string' ? DEV_ITEMS.find((i) => i.id === id) : undefined);
/** how many items a Developer may have equipped at once (1 hand tool + toggles) */
export const MAX_EQUIPPED = 8;

export const WEATHERS = ['clear', 'cloudy', 'rain', 'storm', 'fog'] as const;
export const SCENARIOS = ['engine_failure', 'turbulence', 'cabin_pressure', 'emergency_landing'] as const;
export const TELEPORT_SPOTS = ['cockpit', 'cargo', 'cabin', 'galley', 'apron'] as const;
export const NPC_ACTIONS = ['sit', 'dance', 'panic', 'calm', 'respawn', 'spawn', 'remove', 'freeze', 'unfreeze'] as const;
export const ROOM_EVENTS = ['turbulence', 'birthday', 'vip'] as const;
export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export const MUTE_MINUTES_MAX = 120;
export const BAN_MINUTES_MAX = 60 * 24 * 30;
