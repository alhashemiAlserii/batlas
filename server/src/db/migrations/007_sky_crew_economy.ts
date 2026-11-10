import type { Knex } from 'knex';

// Sky Crew economy: per-account wallet, an append-only ledger (salary / purchases / Developer grants),
// and owned items (cosmetics + classes). The unique ledger key makes every credit/debit idempotent.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('wallets', (t) => {
    t.integer('user_id').primary().references('id').inTable('users').onDelete('CASCADE');
    t.integer('balance').notNullable().defaultTo(0);
    t.string('updated_at').notNullable();
  });
  await knex.schema.createTable('wallet_ledger', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.integer('delta').notNullable();
    t.integer('balance_after').notNullable();
    t.string('kind', 16).notNullable(); // salary | purchase | grant | revoke
    t.string('ref', 128).notNullable(); // flight key / purchase id / grant id
    t.text('details');
    t.string('created_at').notNullable();
    t.unique(['user_id', 'kind', 'ref']);
    t.index(['user_id', 'id']);
  });
  await knex.schema.createTable('owned_items', (t) => {
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('item_key', 48).notNullable(); // e.g. outfit:dino, class:ace_pilot
    t.string('source', 16).notNullable(); // purchase | grant
    t.string('created_at').notNullable();
    t.primary(['user_id', 'item_key']);
  });
}
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('owned_items');
  await knex.schema.dropTableIfExists('wallet_ledger');
  await knex.schema.dropTableIfExists('wallets');
}
