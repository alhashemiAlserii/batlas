import type { Knex } from 'knex';

/**
 * Handle + display name, and a PIN instead of a password.
 *
 * - `handle` is the unique sign-in name (original casing). `username` is kept identical so older
 *   backups, restores and clients keep working.
 * - `display_name` is what other people see. Blank names are filled from the old username.
 *   The Developer account whose handle was `abood` becomes handle `Abood` and display name `szpab`.
 *   The user id and the existing password hash are not changed.
 * - `pin_set` is false for every existing account: the password hash is still the old password,
 *   and that person must choose a PIN (or staff sets one). No PIN is invented here.
 * - `auth_lockouts` counts failed PIN attempts per account and per IP.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.string('handle', 32);
    t.string('handle_lower', 32);
    t.boolean('pin_set').notNullable().defaultTo(false);
  });

  await knex.raw('UPDATE users SET handle = username, handle_lower = lower(username) WHERE handle IS NULL');
  await knex.raw("UPDATE users SET display_name = username WHERE display_name IS NULL OR trim(display_name) = ''");
  // The owner's account: same row, same id, stored handle Abood, display name szpab. Password hash untouched.
  await knex('users').where({ username_lower: 'abood', role: 'DEVELOPER' }).update({
    username: 'Abood',
    username_lower: 'abood',
    handle: 'Abood',
    handle_lower: 'abood',
    display_name: 'szpab',
  });

  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS users_handle_lower_unique ON users (handle_lower)');

  await knex.schema.createTable('auth_lockouts', (t) => {
    t.string('scope', 16).notNullable(); // account | ip
    t.string('subject', 64).notNullable(); // user id, or IP
    t.integer('failures').notNullable().defaultTo(0);
    t.timestamp('window_start').notNullable();
    t.timestamp('locked_until');
    t.primary(['scope', 'subject']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('auth_lockouts');
  await knex.raw('DROP INDEX IF EXISTS users_handle_lower_unique');
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('handle');
    t.dropColumn('handle_lower');
    t.dropColumn('pin_set');
  });
}
