import type { Knex } from 'knex';

// Sky Crew: per-account game profile (the outfit picked in the game menu), stored as validated JSON.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('game_profiles', (t) => {
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('game_slug', 64).notNullable();
    t.text('outfit').notNullable();
    t.string('updated_at').notNullable();
    t.primary(['user_id', 'game_slug']);
  });
}
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('game_profiles');
}
