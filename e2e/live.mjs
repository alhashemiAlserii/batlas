// Live smoke test against the deployed site: node live.mjs [baseUrl]
// Creates throwaway users named live_<browser>_<n>; never prints passwords.
import { chromium, webkit, devices } from 'playwright';
import fs from 'node:fs';
const B = process.argv[2] || 'https://batlas-2je9.onrender.com';
const OUT = '/workspace/studio/docs/screenshots/live';
const PW = 'Live-check-' + Math.random().toString(36).slice(2, 12);
const results = []; const users = [];
const ok = (m) => { results.push(['ok', m]); console.log('✔ ' + m); };
const bad = (m) => { results.push(['bad', m]); console.log('✘ ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = Date.now() % 100000;

async function register(p, username) {
  await p.goto(`${B}/register`, { waitUntil: 'networkidle' });
  await p.fill('#username', username); await p.fill('#password', PW);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/register'), { timeout: 60000 }), p.click('#f button')]);
  users.push(username);
  await p.waitForLoadState('networkidle');
}
async function login(p, username, password) {
  await p.goto(`${B}/login`, { waitUntil: 'networkidle' });
  await p.fill('#login', username); await p.fill('#password', password);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 }), p.click('#f button')]);
  await p.waitForLoadState('networkidle');
}
async function bootGame(p) {
  await p.goto(`${B}/play/sky-crew`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.skyCrew?.ready, null, { timeout: 60000 });
}

async function run(name, type, ctxOpts) {
  const browser = await type.launch();
  const errs = [];
  const mk = async () => { const ctx = await browser.newContext(ctxOpts); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/Refused to apply/.test(m.text())) errs.push(m.text()); }); return { ctx, p }; };
  try {
    const A = await mk();
    const h = await A.p.goto(`${B}/healthz`); const hj = await h.json().catch(() => null);
    h.status() === 200 && hj?.ok ? ok(`${name}: /healthz 200 {"ok":true}`) : bad(`${name}: healthz ${h.status()}`);
    await A.p.goto(B, { waitUntil: 'networkidle' });
    (await A.p.title()).includes('Batlas') ? ok(`${name}: home page loads ("${await A.p.title()}")`) : bad(`${name}: home title ${await A.p.title()}`);
    await A.p.screenshot({ path: `${OUT}/${name}-home.png`, fullPage: false });
    const u1 = `live_${name.replace(/\W/g, '').slice(0, 6)}_${tag}a`.slice(0, 20);
    await register(A.p, u1);
    const me1 = await A.p.evaluate(async () => (await (await fetch('/api/me')).json()).user?.username);
    me1 === u1 ? ok(`${name}: registered ${u1} with username + password only`) : bad(`${name}: register -> ${me1}`);
    await A.ctx.close();
    const A2 = await mk();
    await login(A2.p, u1, PW);
    const me2 = await A2.p.evaluate(async () => (await (await fetch('/api/me')).json()).user?.username);
    me2 === u1 ? ok(`${name}: logged in as ${u1}`) : bad(`${name}: login -> ${me2}`);
    const cookies = await A2.ctx.cookies();
    const sid = cookies.find((c) => /sid/.test(c.name));
    sid?.secure && sid.httpOnly ? ok(`${name}: session cookie ${sid.name} is Secure + HttpOnly`) : bad(`${name}: cookie ${JSON.stringify(sid && { name: sid.name, secure: sid.secure, httpOnly: sid.httpOnly })}`);
    const wsUrls = []; A2.p.on('websocket', (w) => wsUrls.push(w.url()));
    await bootGame(A2.p);
    await A2.p.click('#bCreate');
    await A2.p.waitForFunction(() => window.skyCrew.state().room?.code, null, { timeout: 30000 });
    const code = await A2.p.evaluate(() => window.skyCrew.state().room.code);
    wsUrls.some((u) => u.startsWith('wss://') && u.includes('/ws/sky-crew')) ? ok(`${name}: Sky Crew connected over ${wsUrls[0].replace(/\?.*/, '')}; room ${code} created`) : bad(`${name}: ws urls ${wsUrls}`);
    await A2.p.screenshot({ path: `${OUT}/${name}-coop-lobby-host.png` });
    const Bx = await mk();
    const u2 = `live_${name.replace(/\W/g, '').slice(0, 6)}_${tag}b`.slice(0, 20);
    await register(Bx.p, u2);
    await bootGame(Bx.p);
    await Bx.p.fill('#joinCode', code); await Bx.p.click('#bJoin');
    await Bx.p.waitForFunction(() => window.skyCrew.state().room?.players.length === 2, null, { timeout: 30000 });
    await A2.p.waitForFunction(() => window.skyCrew.state().room?.players.length === 2, null, { timeout: 30000 });
    const names = await A2.p.evaluate(() => window.skyCrew.state().room.players.map((x) => x.username));
    names.includes(u1) && names.includes(u2) ? ok(`${name}: second browser (${u2}) joined room ${code}; host sees ${names.join(' + ')}`) : bad(`${name}: players ${names}`);
    await A2.p.click('#bBoard').catch(() => {}); await Bx.p.click('#bBoard').catch(() => {});
    await A2.p.waitForFunction(() => window.skyCrew.state().playing, null, { timeout: 20000 }).catch(() => {});
    await Bx.p.waitForFunction(() => window.skyCrew.state().remotes.length >= 1, null, { timeout: 20000 }).catch(() => {});
    await sleep(1500);
    await Bx.p.screenshot({ path: `${OUT}/${name}-coop-guest.png` });
    (await Bx.p.evaluate(() => window.skyCrew.state().remotes.length)) >= 1 ? ok(`${name}: guest sees the host in the plane`) : bad(`${name}: guest sees no remote player`);
    errs.length ? bad(`${name}: console errors: ${[...new Set(errs)].slice(0, 5).join(' | ')}`) : ok(`${name}: no console errors`);
  } catch (e) { bad(`${name}: crashed ${e.message.split('\n')[0]}`); }
  await browser.close();
}

async function abood() {
  const cred = fs.readFileSync('/workspace/studio/server/data/abood-developer-credentials.txt', 'utf8');
  const user = cred.match(/username=(.*)/)[1].trim(), pass = cred.match(/password=(.*)/)[1].trim();
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage();
  try {
    await login(p, user, pass);
    await p.waitForURL(/\/settings/, { timeout: 15000 });
    const me = await p.evaluate(async () => (await (await fetch('/api/me')).json()).user);
    const blocked = await p.evaluate(async () => { const csrf = (await (await fetch('/api/csrf')).json()).csrfToken; return (await fetch('/api/game/token', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: '{}' })).status; });
    await sleep(800);
    await p.screenshot({ path: `${OUT}/abood-forced-password-change.png` });
    me?.role === 'DEVELOPER' && me.mustChangePassword && new URL(p.url()).searchParams.get('force') === '1' && blocked === 403
      ? ok(`abood: bootstrap password accepted, role DEVELOPER, sent to ${new URL(p.url()).pathname}?force=1, other API calls blocked (403) until changed; stopped there (password NOT changed)`)
      : bad(`abood: url ${p.url()} role ${me?.role} must ${me?.mustChangePassword} blocked ${blocked}`);
  } catch (e) { bad(`abood: ${e.message.split('\n')[0]}`); }
  await browser.close();
}

await run('chromium-desktop', chromium, { viewport: { width: 1280, height: 800 } });
await run('webkit-desktop', webkit, { viewport: { width: 1280, height: 800 } });
await run('webkit-ipad', webkit, { ...devices['iPad (gen 7)'] });
if (!process.env.SKIP_ABOOD) await abood();
fs.writeFileSync('/tmp/live-users.json', JSON.stringify(users));
const n = results.filter((r) => r[0] === 'bad').length;
console.log(`\n${results.length - n} passed, ${n} failed; throwaway users: ${users.join(', ')}`);
