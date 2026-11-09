import { webkit, devices } from 'playwright';
import fs from 'node:fs';
const B = 'http://localhost:3000';
const OUT = '/workspace/studio/docs/screenshots';
const OUTBOX = '/workspace/studio/server/data/outbox';
const devPw = fs.readFileSync('/workspace/studio/server/data/test-developer-credentials.txt', 'utf8').match(/password=(.*)/)[1];
const browser = await webkit.launch();
const problems = [];
const results = [];
function watch(page, label) {
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${label}] console: ${m.text()} @ ${page.url()}`); });
  page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message} @ ${page.url()}`));
}
async function check(page, label, path, shot, full = false) {
  await page.goto(B + path, { waitUntil: 'networkidle' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) problems.push(`[${label}] horizontal overflow ${overflow}px on ${path}`);
  if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: full });
  results.push(`${label} ${path} ok`);
}
const latestMail = (to) => {
  const files = fs.readdirSync(OUTBOX).sort().reverse();
  for (const f of files) { const t = fs.readFileSync(`${OUTBOX}/${f}`, 'utf8'); if (t.includes(`To: ${to}`)) return t; }
};

// ---------- Desktop Safari ----------
const dctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const d = await dctx.newPage(); watch(d, 'safari-desktop');
await check(d, 'desktop', '/', 'home', true);
await check(d, 'desktop', '/games');
await check(d, 'desktop', '/games/sky-crew', 'game-page', true);
await check(d, 'desktop', '/news', 'news');
await check(d, 'desktop', '/news/welcome-to-batlas', 'news-post');
await check(d, 'desktop', '/contact', 'contact');
// contact form through the UI (honeypot hidden)
const hpVisible = await d.isVisible('#website');
if (hpVisible) problems.push('honeypot visible');
await d.fill('#name', 'Safari Tester'); await d.fill('#email', 'safari@example.com'); await d.fill('#subject', 'Test from Safari (WebKit)'); await d.fill('#message', 'Checking the contact form in WebKit.');
await d.click('#f button'); await d.waitForSelector('.alert.ok'); results.push('contact form submit ok');
// register -> verify via outbox -> avatar -> change password
const uname = 'webkit_' + Date.now().toString(36).slice(-5);
await check(d, 'desktop', '/register');
await d.fill('#username', uname); await d.fill('#email', `${uname}@example.com`); await d.fill('#password', 'webkit-pass-123456');
await Promise.all([d.waitForURL('**/profile'), d.click('#f button')]); results.push('register ok');
await d.waitForTimeout(300);
const vmail = latestMail(`${uname}@example.com`);
if (!vmail) problems.push('no verification email in outbox');
const vlink = vmail.match(/http:\/\/localhost:3000\/verify-email\?token=[\w-]+/)[0];
await d.goto(vlink, { waitUntil: 'networkidle' }); await d.waitForSelector('.alert.ok'); results.push('email verify via outbox link ok');
await check(d, 'desktop', '/settings');
await d.setInputFiles('input[type=file]', new URL('./avatar.jpg', import.meta.url).pathname); await d.click('button:has-text("Upload")'); await d.waitForSelector('.alert.ok'); results.push('avatar upload ok');
await d.fill('#cp', 'webkit-pass-123456'); await d.fill('#np', 'webkit-pass-654321'); await d.fill('#np2', 'webkit-pass-654321');
await d.click('button:has-text("Change password")'); await d.waitForSelector('form .alert.ok'); results.push('change password ok');
await d.screenshot({ path: `${OUT}/settings.png`, fullPage: true });
await check(d, 'desktop', `/u/${uname}`, 'profile');
// forgot password page writes to outbox
await d.click('text=Log out'); await d.waitForTimeout(300);
await check(d, 'desktop', '/forgot-password');
await d.fill('#email', `${uname}@example.com`); await d.click('#f button'); await d.waitForSelector('.alert.ok');
await d.waitForTimeout(300);
const rlink = latestMail(`${uname}@example.com`).match(/http:\/\/localhost:3000\/reset-password\?token=[\w-]+/)[0];
await d.goto(rlink, { waitUntil: 'networkidle' });
await d.fill('#password', 'webkit-pass-reset-1'); await d.fill('#password2', 'webkit-pass-reset-1'); await d.click('#f button'); await d.waitForSelector('.alert.ok'); results.push('password reset via outbox link ok');
await d.goto(rlink, { waitUntil: 'networkidle' });
await d.fill('#password', 'webkit-pass-reset-2'); await d.fill('#password2', 'webkit-pass-reset-2'); await d.click('#f button'); await d.waitForSelector('.alert.error'); results.push('reused reset link rejected ok');
// developer dashboard
await check(d, 'desktop', '/login');
await d.fill('#login', 'test_dev'); await d.fill('#password', devPw);
await Promise.all([d.waitForURL('**/profile'), d.click('#f button')]);
await check(d, 'desktop', '/studio-console#stats'); await d.waitForSelector('.stat'); await d.screenshot({ path: `${OUT}/dashboard-stats.png`, fullPage: true });
await check(d, 'desktop', '/studio-console#inbox'); await d.waitForSelector('.msg-item'); await d.screenshot({ path: `${OUT}/dashboard-inbox.png`, fullPage: true });
await check(d, 'desktop', '/studio-console#news'); await d.waitForSelector('.news-list .card'); await d.screenshot({ path: `${OUT}/dashboard-news.png` });
await check(d, 'desktop', '/studio-console#games'); await d.click('button:has-text("Edit")'); await d.waitForSelector('.version'); await d.screenshot({ path: `${OUT}/dashboard-games-versions.png`, fullPage: true });
await check(d, 'desktop', '/admin');
// ---------- iPhone Safari ----------
const mctx = await browser.newContext({ ...devices['iPhone 15'] });
const m = await mctx.newPage(); watch(m, 'safari-iphone');
for (const [p, s] of [['/', 'mobile-home'], ['/news', 'mobile-news'], ['/contact', 'mobile-contact'], ['/games/sky-crew', 'mobile-game'], ['/login', null], ['/register', null], ['/forgot-password', null]]) await check(m, 'iphone', p, s, s === 'mobile-home');
await m.click('.menu-btn'); await m.waitForSelector('.nav.open .nav-links a'); await m.screenshot({ path: `${OUT}/mobile-menu.png` }); results.push('iphone menu opens ok');
await m.goto(B + '/login'); await m.fill('#login', 'test_dev'); await m.fill('#password', devPw);
await Promise.all([m.waitForURL('**/profile'), m.click('#f button')]);
await check(m, 'iphone', '/studio-console#stats', 'mobile-dashboard-stats', true);
await check(m, 'iphone', '/studio-console#inbox');
await check(m, 'iphone', '/admin');
console.log('WebKit version:', browser.version());
console.log(results.join('\n'));
console.log('PROBLEMS:', JSON.stringify(problems, null, 1));
console.log('test user:', uname);
await browser.close();
