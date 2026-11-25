import type { Knex } from 'knex';

// Preview passes (staff-granted, optional expiry) and the public feedback button.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('passes', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('kind', 24).notNullable(); // early_access | crew
    t.integer('game_id').references('id').inTable('games').onDelete('SET NULL');
    t.string('expires_at', 40);
    t.string('revoked_at', 40);
    t.integer('granted_by').references('id').inTable('users').onDelete('SET NULL');
    t.string('note', 200);
    t.string('created_at', 40).notNullable();
    t.index(['user_id', 'kind']);
  });

  await knex.schema.createTable('feedback', (t) => {
    t.increments('id').primary();
    t.integer('user_id').references('id').inTable('users').onDelete('SET NULL');
    t.string('handle', 64);
    t.string('page', 200);
    t.text('message').notNullable();
    t.string('created_at', 40).notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('feedback');
  await knex.schema.dropTableIfExists('passes');
}
