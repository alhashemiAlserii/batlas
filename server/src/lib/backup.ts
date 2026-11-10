import type { Knex } from 'knex';

export interface DatabaseDump {
  createdAt: string;
  source: 'postgres' | 'sqlite';
  tables: Record<string, unknown[]>;
}

/** Every base table in the current schema/database, as plain rows. Shared by `npm run backup` and the backup endpoint. */
export async function dumpDatabase(db: Knex): Promise<{ dump: DatabaseDump; rows: number }> {
  const pg = db.client.config.client === 'pg';
  const tables: string[] = pg
    ? (await db.raw(`select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE' order by table_name`)).rows.map((r: any) => r.table_name)
    : (await db.raw(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`)).map((r: any) => r.name);
  const out: Record<string, unknown[]> = {};
  let rows = 0;
  for (const t of tables) {
    out[t] = await db(t).select('*');
    rows += out[t].length;
  }
  return { dump: { createdAt: new Date().toISOString(), source: pg ? 'postgres' : 'sqlite', tables: out }, rows };
}
