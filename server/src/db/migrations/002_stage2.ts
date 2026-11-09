import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.timestamp('email_verified_at');
    t.string('avatar_url', 300);
    t.timestamp('password_changed_at');
  });

  // Single-use, expiring tokens for email verification and password reset. Only hashes stored.
  await knex.schema.createTable('auth_tokens', (t) => {
    t.string('token_hash', 64).primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('purpose', 32).notNullable(); // verify_email | reset_password
    t.string('email', 254); // address the token was issued for
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at').notNullable();
    t.timestamp('used_at');
    t.index(['user_id', 'purpose']);
  });

  await knex.schema.createTable('news_posts', (t) => {
    t.increments('id').primary();
    t.string('slug', 80).notNullable().unique();
    t.string('title', 160).notNullable();
    t.string('summary', 300);
    t.text('body');
    t.string('status', 16).notNullable().defaultTo('draft'); // draft | published
    t.boolean('pinned').notNullable().defaultTo(false);
    t.string('cover_image', 300);
    t.integer('author_id').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('published_at');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['status', 'published_at']);
  });

  await knex.schema.createTable('contact_messages', (t) => {
    t.increments('id').primary();
    t.string('name', 80).notNullable();
    t.string('email', 254).notNullable();
    t.string('subject', 160).notNullable();
    t.text('message').notNullable();
    t.string('status', 16).notNullable().defaultTo('new'); // new | read | archived
    t.integer('user_id'); // if the sender was logged in
    t.string('ip', 64);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['status']);
  });

  await knex.schema.createTable('game_versions', (t) => {
    t.increments('id').primary();
    t.integer('game_id').notNullable().references('id').inTable('games').onDelete('CASCADE');
    t.string('version', 32).notNullable();
    t.date('released_at').notNullable();
    t.text('changelog');
    t.string('download_url', 500);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['game_id', 'version']);
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const tbl of ['game_versions', 'contact_messages', 'news_posts', 'auth_tokens']) await knex.schema.dropTableIfExists(tbl);
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('email_verified_at');
    t.dropColumn('avatar_url');
    t.dropColumn('password_changed_at');
  });
}
