import type { Knex } from 'knex';

// Website upgrade: uploaded media lives in the database (Render's free plan wipes the disk on every
// deploy), richer game pages, per-game settings, site-wide event banners, and "last seen" for the
// online-players view.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('media', (t) => {
    t.increments('id').primary();
    t.string('kind', 16).notNullable(); // image | video | avatar
    t.string('content_type', 64).notNullable();
    t.integer('size').notNullable();
    t.string('sha256', 64).notNullable();
    t.binary('data').notNullable(); // bytea on Postgres, blob on SQLite
    t.string('filename', 200);
    t.integer('game_id').references('id').inTable('games').onDelete('SET NULL');
    t.integer('uploaded_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['game_id']);
    t.index(['kind']);
  });

  await knex.schema.alterTable('games', (t) => {
    t.string('release_date', 10); // YYYY-MM-DD (upcoming games)
    t.string('trailer_video', 300); // uploaded MP4 (/media/:id) or site path
    t.string('trailer_poster', 300);
    t.string('youtube_url', 300);
    t.text('settings'); // JSON, public per-game settings (see games.ts settingsSchema)
  });

  await knex.schema.alterTable('news_posts', (t) => {
    t.integer('game_id').references('id').inTable('games').onDelete('SET NULL');
  });

  await knex.schema.alterTable('users', (t) => {
    t.timestamp('last_seen_at');
    t.index(['last_seen_at']);
  });

  // Small key/value store for site-wide switches (e.g. maintenance mode).
  await knex.schema.createTable('site_settings', (t) => {
    t.string('key', 64).primary();
    t.text('value'); // JSON
    t.integer('updated_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('site_events', (t) => {
    t.increments('id').primary();
    t.string('title', 120).notNullable();
    t.string('message', 500);
    t.string('style', 16).notNullable().defaultTo('event'); // info | event | warning
    t.string('link_url', 300);
    t.integer('game_id').references('id').inTable('games').onDelete('SET NULL');
    t.string('announce_at', 32).notNullable(); // banner visible from (ISO)
    t.string('starts_at', 32).notNullable();
    t.string('ends_at', 32).notNullable();
    t.boolean('cancelled').notNullable().defaultTo(false);
    t.integer('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['ends_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('site_events');
  await knex.schema.dropTableIfExists('site_settings');
  await knex.schema.dropTableIfExists('media');
  await knex.schema.alterTable('users', (t) => { t.dropIndex(['last_seen_at']); t.dropColumn('last_seen_at'); });
  await knex.schema.alterTable('news_posts', (t) => { t.dropColumn('game_id'); });
  await knex.schema.alterTable('games', (t) => {
    for (const c of ['release_date', 'trailer_video', 'trailer_poster', 'youtube_url', 'settings']) t.dropColumn(c);
  });
}
