import type { Knex } from 'knex';

// Email becomes optional (school iPads often block email). Adds the forced-password-change flag
// used by staff password resets. SQLite can't drop NOT NULL in place, so the users table is
// rebuilt with foreign keys temporarily off (outside a transaction, so nothing cascades).
export const config = { transaction: false };

export async function up(knex: Knex): Promise<void> {
  const client = String(knex.client.config.client);
  if (!client.includes('sqlite')) {
    await knex.schema.alterTable('users', (t) => {
      t.string('email', 254).nullable().alter();
      t.string('email_lower', 254).nullable().alter();
      t.boolean('must_change_password').notNullable().defaultTo(false);
    });
    return;
  }
  await knex.raw('PRAGMA foreign_keys = OFF');
  try {
    await knex.transaction(async (trx) => {
      await trx.schema.createTable('users_new', (t) => {
        t.increments('id').primary();
        t.string('username', 32).notNullable();
        t.string('username_lower', 32).notNullable().unique();
        t.string('email', 254);
        t.string('email_lower', 254).unique(); // multiple NULLs allowed
        t.string('password_hash').notNullable();
        t.string('role', 16).notNullable().defaultTo('PLAYER');
        t.string('display_name', 64);
        t.text('bio');
        t.boolean('banned').notNullable().defaultTo(false);
        t.text('ban_reason');
        t.timestamp('banned_at');
        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        t.timestamp('last_login_at');
        t.timestamp('email_verified_at');
        t.string('avatar_url', 300);
        t.timestamp('password_changed_at');
        t.boolean('must_change_password').notNullable().defaultTo(false);
      });
      const cols = ['id', 'username', 'username_lower', 'email', 'email_lower', 'password_hash', 'role', 'display_name', 'bio', 'banned', 'ban_reason', 'banned_at', 'created_at', 'last_login_at', 'email_verified_at', 'avatar_url', 'password_changed_at'].join(', ');
      await trx.raw(`INSERT INTO users_new (${cols}) SELECT ${cols} FROM users`);
      await trx.schema.dropTable('users');
      await trx.schema.renameTable('users_new', 'users');
    });
  } finally {
    await knex.raw('PRAGMA foreign_keys = ON');
  }
}

export async function down(): Promise<void> {
  throw new Error('003_optional_email is not reversible (emails may now be missing).');
}
