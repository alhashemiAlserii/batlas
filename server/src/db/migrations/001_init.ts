import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('username', 32).notNullable();
    t.string('username_lower', 32).notNullable().unique();
    t.string('email', 254).notNullable();
    t.string('email_lower', 254).notNullable().unique();
    t.string('password_hash').notNullable();
    t.string('role', 16).notNullable().defaultTo('PLAYER');
    t.string('display_name', 64);
    t.text('bio');
    t.boolean('banned').notNullable().defaultTo(false);
    t.text('ban_reason');
    t.timestamp('banned_at');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_login_at');
  });

  await knex.schema.createTable('sessions', (t) => {
    t.string('id_hash', 64).primary(); // sha256 of the cookie token; raw token never stored
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at').notNullable();
    t.string('ip', 64);
    t.string('user_agent', 256);
    t.index(['user_id']);
  });

  await knex.schema.createTable('game_tokens', (t) => {
    t.string('token_hash', 64).primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('game_slug', 64);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at').notNullable();
  });

  await knex.schema.createTable('audit_logs', (t) => {
    t.increments('id').primary();
    t.integer('actor_id');
    t.string('actor_username', 32);
    t.string('actor_role', 16);
    t.string('action', 64).notNullable();
    t.string('category', 32).notNullable().defaultTo('admin'); // moderation | roles | game | games | auth | admin
    t.string('target_type', 32);
    t.string('target_id', 64);
    t.string('target_label', 128);
    t.text('details'); // JSON
    t.string('ip', 64);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['category']);
    t.index(['created_at']);
  });

  await knex.schema.createTable('games', (t) => {
    t.increments('id').primary();
    t.string('slug', 64).notNullable().unique();
    t.string('title', 120).notNullable();
    t.string('tagline', 200);
    t.text('description');
    t.string('status', 16).notNullable().defaultTo('draft'); // draft | upcoming | published
    t.string('version', 32);
    t.string('platforms', 200); // comma list
    t.string('cover_image', 300);
    t.text('screenshots'); // JSON array of URLs
    t.string('trailer_url', 500);
    t.string('play_url', 500);
    t.string('download_url', 500);
    t.text('config'); // JSON game config (future)
    t.timestamp('published_at');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const tbl of ['games', 'audit_logs', 'game_tokens', 'sessions', 'users']) {
    await knex.schema.dropTableIfExists(tbl);
  }
}
