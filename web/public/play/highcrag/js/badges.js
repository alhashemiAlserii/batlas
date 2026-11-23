// Highcrag — badges: little challenges you earn while climbing. Some unlock hats in the passport.
// Saved on this device (localStorage through the game's store).

export const BADGES = [
  { id: 'firstfire', icon: '🔥', name: 'Kindling', desc: 'Light your first campfire.' },
  { id: 'frostline', icon: '❄️', name: 'Halfway Up', desc: 'Reach the Frostline or the Red Canyon.' },
  { id: 'summit', icon: '🏔️', name: 'Top of the Crag', desc: 'Light the summit beacon.', hat: 16 },
  { id: 'solo', icon: '🧗', name: 'Lone Climber', desc: 'Light the beacon on a solo climb.' },
  { id: 'speedy', icon: '⏱️', name: 'In a Hurry', desc: 'Light the beacon within 25 minutes.', hat: 18 },
  { id: 'daily', icon: '📅', name: 'Daily Climber', desc: 'Light the beacon on a daily mountain.', hat: 20 },
  { id: 'hardrock', icon: '💎', name: 'Hard as Rock', desc: 'Light the beacon on Summit III.', hat: 19 },
  { id: 'nohands', icon: '🦎', name: 'Never Touch the Ground', desc: 'Gain 50 m of height without standing on the ground.', hat: 17 },
  { id: 'gourmet', icon: '🍢', name: 'Camp Chef', desc: 'Eat three roasted foods in one climb.' },
  { id: 'burnt', icon: '⚫', name: 'Well Done', desc: 'Eat something burnt to a crisp.' },
  { id: 'sweet', icon: '🍯', name: 'Sweet Tooth', desc: 'Eat wild honeycomb.' },
  { id: 'ropes', icon: '🪢', name: 'Rope Rigger', desc: 'Hang five ropes in one climb.' },
  { id: 'zip', icon: '🏹', name: 'Zip Zap', desc: 'Ride a zipline at least 30 m long to the end.' },
  { id: 'fungus', icon: '🍄', name: 'Fungus Friend', desc: 'Stand on a shelf fungus.' },
  { id: 'feather', icon: '☂️', name: 'Featherfall', desc: 'Float down 20 m with an umbrella or balloons.' },
  { id: 'helper', icon: '🤝', name: 'Helping Hand', desc: 'Help a fallen friend up.' },
  { id: 'liftoff', icon: '🦵', name: 'Leg Up', desc: 'Jump off a crouching friend.' },
  { id: 'second', icon: '👻', name: 'Second Wind', desc: 'Come back to life after being a ghost.' },
];

/** Hat index -> the badge that unlocks it. */
export const HAT_LOCKS = Object.fromEntries(BADGES.filter((b) => b.hat !== undefined).map((b) => [b.hat, b.id]));

export class Badges {
  constructor(store, onEarn) {
    this.store = store;
    this.onEarn = onEarn;
    const saved = store.get('badges', []);
    this.earned = new Set(Array.isArray(saved) ? saved.filter((id) => BADGES.some((b) => b.id === id)) : []);
  }
  has(id) { return this.earned.has(id); }
  get count() { return this.earned.size; }
  /** Earn a badge once; tells the game so it can celebrate. */
  earn(id) {
    if (this.earned.has(id)) return false;
    const b = BADGES.find((x) => x.id === id);
    if (!b) return false;
    this.earned.add(id);
    this.store.set('badges', [...this.earned]);
    this.onEarn?.(b);
    return true;
  }
  /** Is this hat unlocked? Hats without a badge always are. */
  hatUnlocked(h) { const id = HAT_LOCKS[h]; return !id || this.earned.has(id); }
  lockFor(h) { const id = HAT_LOCKS[h]; return id && !this.earned.has(id) ? BADGES.find((b) => b.id === id) : null; }
}
