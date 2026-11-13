import type { Knex } from 'knex';

/**
 * Built-in browser games that ship with the site. On boot each one is added to the `games` table
 * ONLY if no game with that slug exists yet, so the Developer dashboard stays in charge afterwards
 * (edits, status changes and existing games such as Sky Crew are never touched).
 */
export const BUILT_IN_GAMES = [
  {
    slug: 'highcrag',
    title: 'Highcrag',
    tagline: 'Climb a lone island mountain from the beach to the smouldering summit.',
    description:
      'Highcrag is a survival climbing game that runs in your browser. Grab rock walls and haul yourself up ledge by ledge, but every handhold costs stamina.\n\n' +
      'Hunger, cold and injuries shrink your stamina bar, so forage berries and glowcaps, patch yourself up with bandages and light campfires to warm up and save your progress. ' +
      'Climb through four zones: Saltwind Shore, the thorny Mossgrove, the blizzard-swept Frostline and the gusty Ember Crown. Light the beacon at the summit to finish.\n\n' +
      'Every mountain is generated from a seed, so each climb is different. Works with keyboard and mouse or touch (iPad and phone).',
    status: 'upcoming',
    version: '0.1',
    platforms: 'Web,iPad,Desktop',
    play_url: '/play/highcrag',
  },
] as const;

export async function ensureBuiltInGames(db: Knex, log: (m: string) => void = console.log): Promise<string[]> {
  const added: string[] = [];
  for (const g of BUILT_IN_GAMES) {
    if (await db('games').where({ slug: g.slug }).first('id')) continue;
    const now = new Date().toISOString();
    await db('games').insert({ ...g, created_at: now, updated_at: now });
    added.push(g.slug);
    log(`Listed built-in game "${g.title}" (${g.play_url}).`);
  }
  return added;
}
