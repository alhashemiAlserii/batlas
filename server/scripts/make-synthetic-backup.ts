/**
 * Builds a synthetic backup that exercises the post-005 tables (media with real binary
 * PNG/MP4 bytes, site_settings, site_events) on top of a real backup's rows, for restore drills.
 *
 *   npx tsx scripts/make-synthetic-backup.ts --from backups/live-XXXX.json --out /tmp/synthetic.json
 *
 * The output contains the source's rows (password hashes!): it is written chmod 600; keep it off git.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { createDb, migrate, insertId } from '../src/db/index.js';
import { dumpDatabase } from '../src/lib/backup.js';
import { parseDump, restoreDump } from '../src/lib/restore.js';
import { storeMedia } from '../src/lib/media.js';

const { values } = parseArgs({ options: { from: { type: 'string' }, out: { type: 'string' } } });
if (!values.from || !values.out) { console.error('--from and --out are required'); process.exit(2); }
const db = createDb(':memory:');
await migrate(db);
await restoreDump(db, parseDump(JSON.parse(fs.readFileSync(values.from, 'utf8'))));
const dev = await db('users').where({ role: 'DEVELOPER' }).first('id');
const now = new Date().toISOString();
const g = await insertId(db('games').insert({ slug: 'drill-game', title: 'Drill Game', status: 'upcoming', screenshots: '[]', created_at: now, updated_at: now }));
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(200_000)]);
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), crypto.randomBytes(5 * 1024 * 1024)]);
for (let i = 0; i < 3; i++) await storeMedia(db, { kind: 'image', contentType: 'image/png', data: png, gameId: g, userId: dev?.id ?? null, filename: `shot${i}.png` });
await storeMedia(db, { kind: 'video', contentType: 'video/mp4', data: mp4, gameId: g, userId: dev?.id ?? null, filename: 'trailer.mp4' });
await db('site_settings').insert({ key: 'maintenance', value: JSON.stringify({ on: false, message: '', eta: '' }), updated_by: dev?.id ?? null, updated_at: now });
await db('site_events').insert({ title: 'Drill event', announce_at: now, starts_at: now, ends_at: now, created_by: dev?.id ?? null, created_at: now, updated_at: now });
const { dump, rows } = await dumpDatabase(db);
fs.writeFileSync(values.out, JSON.stringify(dump), { mode: 0o600 });
console.log(`Synthetic backup: ${Object.keys(dump.tables).length} tables, ${rows} rows (incl. ${dump.tables.media.length} media), ${fs.statSync(values.out).size} bytes`);
await db.destroy();
