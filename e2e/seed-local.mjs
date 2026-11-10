// Seeds a fresh local test database with the Sky Crew game entry (status: upcoming) via the Developer API.
// Usage: BASE=http://localhost:3200 node seed-local.mjs   (Developer credentials file: DEV_CREDS or ../server/data/dev-creds.txt)
import { chromium } from 'playwright';
import fs from 'node:fs';
const B = process.env.BASE || 'http://localhost:3200';
const t = fs.readFileSync(process.env.DEV_CREDS || new URL('../server/data/dev-creds.txt', import.meta.url).pathname, 'utf8');
const username = t.match(/username=(.*)/)[1].trim(), password = t.match(/password=(.*)/)[1].trim();
const b = await chromium.launch(); const p = await b.newPage();
await p.goto(`${B}/login`);
const out = await p.evaluate(async ({ username, password }) => {
  const csrf = (await (await fetch('/api/csrf')).json()).csrfToken;
  const h = { 'content-type': 'application/json', 'x-csrf-token': csrf };
  const l = await fetch('/api/auth/login', { method: 'POST', headers: h, body: JSON.stringify({ login: username, password }) });
  if (!l.ok) return `login ${l.status}`;
  const c2 = (await (await fetch('/api/csrf')).json()).csrfToken; h['x-csrf-token'] = c2;
  const ex = await fetch('/api/games/sky-crew'); if (ex.ok) return 'already seeded';
  const g = await fetch('/api/dev/games', { method: 'POST', headers: h, body: JSON.stringify({ slug: 'sky-crew', title: 'Sky Crew', tagline: 'Co-op airliner chaos', description: 'Fly, serve and survive together.', status: 'upcoming', version: '0.5', platforms: ['Web'], playUrl: '/play/sky-crew' }) });
  return `create ${g.status} ${(await g.text()).slice(0, 200)}`;
}, { username, password });
console.log(out); await b.close();
