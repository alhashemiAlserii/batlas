// Handle + display name + PIN, exercised in WebKit the way Safari on an iPhone does.
// Test-only PINs live in this file. They are not a real account secret.
//   node e2e/identity-pin.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { webkit, devices } from 'playwright';

const TEST_PIN = '123456';
const PORT = 3391;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = '/tmp/batlas-identity-pin.sqlite';
const OUT = '/opt/cursor/artifacts';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
fs.mkdirSync(OUT, { recursive: true });
for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true });

const server = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: path.join(root, 'server'),
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_FILE: DB, COOKIE_SECURE: 'false', NODE_ENV: 'development' },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let log = '';
server.stdout.on('data', (b) => { log += b; });
server.stderr.on('data', (b) => { log += b; });
const problems = [];
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) problems.push(m); };

async function waitUp() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start\n' + log.slice(-2000));
}

try {
  await waitUp();
  const browser = await webkit.launch();
  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await phone.newPage();
  const errors = [];
  page.on('pageerror', (e) => { if (!/due to access control checks/i.test(e.message)) errors.push(e.message); });

  await page.goto(`${BASE}/login`);
  ok(await page.locator('#pin').count() === 1, 'login has a PIN field');
  ok(await page.locator('input[name=password]').count() === 0, 'login has no password field');
  ok((await page.locator('body').innerText()).includes('Ask a Batlas admin'), 'forgotten PIN points at staff');
  ok((await page.locator('a[href="/set-pin"]').count()) === 1, 'login links to the one-time Set a PIN page');
  const loginSize = await page.$eval('#pin', (e) => getComputedStyle(e).fontSize);
  ok(loginSize === '16px', `PIN field is ${loginSize} so iOS Safari does not zoom`);

  await page.goto(`${BASE}/register`);
  ok(await page.locator('#email').count() === 1, 'email is present but optional');
  ok(await page.locator('input[name=password]').count() === 0, 'register has no password field');
  const handle = `Pilot_Web${Date.now() % 100000}`;
  await page.fill('#handle', handle);
  await page.fill('#displayName', 'Sky Kid');
  await page.fill('#pin', TEST_PIN);
  await page.fill('#pin2', TEST_PIN);
  await Promise.all([page.waitForURL('**/profile'), page.click('#f button')]);
  await page.waitForSelector('h1');
  ok((await page.locator('h1').innerText()) === 'Sky Kid', 'own profile shows the display name');
  ok((await page.locator('body').innerText()).includes(`@${handle}`), 'profile shows the handle');
  await page.screenshot({ path: `${OUT}/identity-profile-iphone.png`, fullPage: true });

  const other = await browser.newContext({ ...devices['iPad (gen 7)'] });
  const guest = await other.newPage();
  await guest.goto(`${BASE}/u/${handle.toLowerCase()}`);
  await guest.waitForSelector('h1');
  ok((await guest.locator('h1').innerText()) === 'Sky Kid', 'another device sees the display name, not the handle');
  ok(!(await guest.locator('body').innerText()).includes('@mail'), 'public profile has no email');
  await guest.screenshot({ path: `${OUT}/identity-profile-ipad.png`, fullPage: true });

  await page.goto(`${BASE}/settings`);
  await page.waitForSelector('#dn');
  await page.fill('#dn', 'Captain Web');
  await page.getByRole('button', { name: 'Save name' }).click();
  await page.waitForSelector('#settings .alert.ok', { timeout: 10000 });
  await page.waitForFunction(() => document.body.innerText.includes('Captain Web'));
  ok((await page.locator('body').innerText()).includes('Captain Web'), 'settings saved the new display name');
  await page.screenshot({ path: `${OUT}/identity-settings-iphone.png`, fullPage: true });
  await guest.reload();
  await guest.waitForSelector('h1');
  ok((await guest.locator('h1').innerText()) === 'Captain Web', 'the other device sees the updated display name');

  await page.goto(`${BASE}/`);
  await page.locator('.menu-btn').click();
  const reloaded = page.waitForEvent('load');
  await page.click('button:has-text("Log out")');
  await reloaded;
  await page.goto(`${BASE}/login`);
  await page.fill('#login', handle.toLowerCase());
  await page.fill('#pin', TEST_PIN);
  await Promise.all([page.waitForURL('**/profile'), page.click('#f button')]);
  ok((await page.locator('h1').innerText()) === 'Captain Web', 'case-insensitive handle login still shows the display name');

  ok(errors.length === 0, errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
  await browser.close();
} catch (e) {
  ok(false, e.message.split('\n')[0]);
} finally {
  server.kill('SIGTERM');
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ }
  await new Promise((r) => server.on('exit', r));
}

if (problems.length) {
  console.error(`\n${problems.length} failed`);
  process.exit(1);
}
console.log('\nidentity PIN flow passed on WebKit');
