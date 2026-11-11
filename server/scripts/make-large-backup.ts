/**
 * Writes a large SYNTHETIC backup file (no real data) for restore memory tests:
 *   npx tsx scripts/make-large-backup.ts --out /tmp/large.json --media 40 --mb 10
 * Streams to disk, so it never holds more than one media file in memory.
 * Media are random bytes (so nothing compresses or dedupes) with correct size + sha256.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function makeLargeBackup(out: string, o: { media: number; mb: number; users?: number; audit?: number }) {
  const ws = fs.createWriteStream(out, { mode: 0o600 });
  const w = (s: string) => new Promise<void>((res) => (ws.write(s) ? res() : ws.once('drain', res)));
  const iso = new Date(Date.UTC(2026, 10, 1)).toISOString();
  const users = o.users ?? 200;
  await w(`{"createdAt":"${iso}","source":"sqlite","tables":{`);
  await w('"audit_logs":[');
  for (let i = 1; i <= (o.audit ?? 2000); i++) await w((i > 1 ? ',' : '') + JSON.stringify({ id: i, actor_id: 1, actor_username: 'dev', actor_role: 'DEVELOPER', action: `synthetic.${i}`, category: 'admin', target_type: null, target_id: null, target_label: null, details: JSON.stringify({ i }), ip: null, created_at: iso }));
  await w('],"media":[');
  let bytes = 0;
  for (let i = 1; i <= o.media; i++) {
    const data = crypto.randomBytes(Math.round(o.mb * 1024 * 1024));
    bytes += data.length;
    const row = { id: i, kind: 'video', content_type: 'video/mp4', size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), filename: `synthetic-${i}.mp4`, game_id: null, uploaded_by: 1, created_at: iso };
    const json = JSON.stringify(row);
    await w((i > 1 ? ',' : '') + json.slice(0, -1) + ',"data":{"$base64":"');
    await w(data.toString('base64'));
    await w('"}}');
  }
  await w('],"users":[');
  for (let i = 1; i <= users; i++) {
    const name = i === 1 ? 'dev' : `player${i}`;
    await w((i > 1 ? ',' : '') + JSON.stringify({ id: i, username: name, username_lower: name, email: null, email_lower: null, password_hash: 'synthetic-not-a-hash', role: i === 1 ? 'DEVELOPER' : 'PLAYER', display_name: name, bio: null, banned: false, ban_reason: null, banned_at: null, created_at: iso, last_login_at: null, email_verified_at: null, avatar_url: null, password_changed_at: null, must_change_password: false, last_seen_at: null }));
  }
  await w(']}}');
  await new Promise<void>((res, rej) => ws.end((e?: Error | null) => (e ? rej(e) : res())));
  return { file: out, size: fs.statSync(out).size, mediaBytes: bytes, rows: (o.audit ?? 2000) + o.media + users };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string' }, media: { type: 'string', default: '40' }, mb: { type: 'string', default: '10' } } });
  if (!values.out) { console.error('--out required'); process.exit(2); }
  const r = await makeLargeBackup(values.out, { media: Number(values.media), mb: Number(values.mb) });
  console.log(`wrote ${r.file}: ${(r.size / 2 ** 20).toFixed(1)} MB file, ${(r.mediaBytes / 2 ** 20).toFixed(1)} MB of media, ${r.rows} rows`);
}
