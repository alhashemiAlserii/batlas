import type { Knex } from 'knex';

/** The very first Highcrag listing (v0.1). A row that still matches it was never edited, so it may be refreshed. */
const HIGHCRAG_V01_DESCRIPTION =
  'Highcrag is a survival climbing game that runs in your browser. Grab rock walls and haul yourself up ledge by ledge, but every handhold costs stamina.\n\n' +
  'Hunger, cold and injuries shrink your stamina bar, so forage berries and glowcaps, patch yourself up with bandages and light campfires to warm up and save your progress. ' +
  'Climb through four zones: Saltwind Shore, the thorny Mossgrove, the blizzard-swept Frostline and the gusty Ember Crown. Light the beacon at the summit to finish.\n\n' +
  'Every mountain is generated from a seed, so each climb is different. Works with keyboard and mouse or touch (iPad and phone).';

/**
 * Built-in browser games that ship with the site. On boot each one is added to the `games` table
 * ONLY if no game with that slug exists yet, so the Developer dashboard stays in charge afterwards
 * (edits, status changes and existing games such as Sky Crew are never touched). The one exception:
 * a listing still exactly as this file first shipped it (never edited) gets the newer text and art.
 */
export const BUILT_IN_GAMES = [
  {
    slug: 'highcrag',
    title: 'Highcrag',
    tagline: 'Your plane went down on a lonely island. Climb the mountain with up to three friends.',
    description:
      'Highcrag is a co-op survival climbing game that runs in your browser. Your plane goes down on a lonely island, and the only way out is up: ' +
      'climb from the beach to the smouldering summit and light the rescue beacon.\n\n' +
      'Every handhold costs stamina, and hunger, cold, injuries, poison and the weight of your pack all eat into it. Forage and cook food, patch yourself up, ' +
      'light campfires to warm the team and save your progress, and use ropes, pitons, chalk and magic beans on the hardest walls. ' +
      'Watch out for jungle rain, blizzards and falling rocks.\n\n' +
      'Start at the airport, change your look with your passport, then climb alone or with up to three friends. Every mountain is generated from a seed, ' +
      'and there is a new daily mountain every day. Works with keyboard and mouse, or touch on iPhone and iPad.',
    status: 'upcoming',
    version: '0.5',
    platforms: 'Web,iPhone,iPad,Desktop',
    cover_image: '/img/highcrag/cover.jpg',
    screenshots: JSON.stringify(['/img/highcrag/shot-1.jpg', '/img/highcrag/shot-2.jpg', '/img/highcrag/shot-3.jpg', '/img/highcrag/shot-4.jpg', '/img/highcrag/shot-5.jpg']),
    play_url: '/play/highcrag',
  },
] as const;

/** Listings this file shipped before, by slug: a row still exactly like its old listing gets the new text and art. */
const PREVIOUS_LISTINGS: Record<string, { version: string; description: string }> = {
  highcrag: { version: '0.1', description: HIGHCRAG_V01_DESCRIPTION },
};

/** True when a stored screenshots value lists any images (an unreadable value counts as edited). */
const hasShots = (v: unknown) => {
  try { const a = JSON.parse(String(v || '[]')); return !Array.isArray(a) || a.length > 0; } catch { return true; }
};

export async function ensureBuiltInGames(db: Knex, log: (m: string) => void = console.log): Promise<string[]> {
  const added: string[] = [];
  for (const g of BUILT_IN_GAMES) {
    const row = await db('games').where({ slug: g.slug }).first();
    if (row) {
      // Only refresh a listing nobody has touched since it was added (same version and text, no art yet).
      const prev = PREVIOUS_LISTINGS[g.slug];
      if (prev && row.version === prev.version && row.description === prev.description && !row.cover_image && !hasShots(row.screenshots)) {
        const { tagline, description, version, platforms, cover_image, screenshots } = g;
        await db('games').where({ id: row.id }).update({ tagline, description, version, platforms, cover_image, screenshots, updated_at: new Date().toISOString() });
        log(`Refreshed the built-in listing for "${g.title}" (v${version}).`);
      }
      continue;
    }
    const now = new Date().toISOString();
    await db('games').insert({ ...g, created_at: now, updated_at: now });
    added.push(g.slug);
    log(`Listed built-in game "${g.title}" (${g.play_url}).`);
  }
  return added;
}
