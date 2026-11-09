import type { Knex } from 'knex';

// Stage 4: Sky Crew flight results for profile stats and the game leaderboard.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('game_flights', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('game_slug', 64).notNullable();
    t.integer('score').notNullable();
    t.integer('stars').notNullable().defaultTo(0);
    t.string('landing', 16); // butter | good | hard | crash | none
    t.string('route', 8);
    t.boolean('crashed').notNullable().defaultTo(false);
    t.integer('duration').notNullable().defaultTo(0);
    t.boolean('coop').notNullable().defaultTo(false);
    t.string('created_at').notNullable();
    t.index(['game_slug', 'score']);
    t.index(['user_id', 'game_slug']);
  });
}
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('game_flights');
}
