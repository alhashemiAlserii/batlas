import { webkit, devices } from 'playwright';
import fs from 'node:fs';
const B = 'http://localhost:3000';
const OUT = '/workspace/studio/docs/screenshots/stage3/webkit-site';
const OUTBOX = '/workspace/studio/server/data/outbox';
const devPw = fs.readFileSync('/workspace/studio/server/data/test-developer-credentials.txt', 'utf8').match(/password=(.*)/)[1];
const browser = await webkit.launch();
const problems = [];
const results = [];
// Playwright's screenshot helper injects a <style>, which our strict CSP blocks: test noise, filtered.
function watch(page, label) {
  page.on('console', (m) => { if (m.type() === 'error' && !/Refused to apply a stylesheet/.test(m.text())) problems.push(`[${label}] console: ${m.text()} @ ${page.url()}`); });
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
const d = await dctx.newPage(); watch(d, 'safari-desktop'); if (process.env.DBG) d.on('response', (r) => { if (r.url().includes('/api/')) console.log(r.status(), r.request().method(), r.url()); });
await check(d, 'desktop', '/', 'home', true);
await check(d, 'desktop', '/games');
await check(d, 'desktop', '/games/sky-crew', 'game-page', true);
await check(d, 'desktop', '/news', 'news');
await check(d, 'desktop', '/news/welcome-to-batlas', 'news-post');
await check(d, 'desktop', '/contact', 'contact');
// contact form through the UI (honeypot hidden)
const hpBox = await d.locator('#website').boundingBox();
if (hpBox && hpBox.x + hpBox.width > 0) problems.push('honeypot on screen'); else results.push('contact honeypot off-screen ok');
await d.fill('#name', 'Safari Tester'); await d.fill('#subject', 'Test from Safari (WebKit)'); await d.fill('#message', 'Checking the contact form in WebKit.');
await d.click('#f button'); await d.waitForSelector('.alert.ok'); results.push('contact form submit ok');
// register with username + password only (email optional) -> avatar -> optional email UI -> change password
const uname = 'webkit_' + Date.now().toString(36).slice(-5);
await check(d, 'desktop', '/register', 'register');
const emailHidden = !(await d.isVisible('#email'));
if (!emailHidden) problems.push('email field should be tucked behind "Add email (optional)"');
else results.push('register: email hidden behind "Add email (optional)" ok');
await d.fill('#username', uname); await d.fill('#password', 'webkit-pass-123456');
await Promise.all([d.waitForURL('**/profile'), d.click('#f button')]); await d.waitForLoadState('networkidle'); await d.waitForTimeout(400); results.push('register with username + password only ok');
await check(d, 'desktop', '/settings');
await d.setInputFiles('input[type=file]', new URL('./avatar.jpg', import.meta.url).pathname); await d.click('button:has-text("Upload")'); await d.waitForSelector('.alert.ok'); results.push('avatar upload ok');
if (!(await d.isVisible('#em'))) problems.push('optional email field missing in settings'); else results.push('settings: optional email field present ok');
await d.fill('#cp', 'webkit-pass-123456'); await d.fill('#np', 'webkit-pass-654321'); await d.fill('#np2', 'webkit-pass-654321');
await d.click('button:has-text("Change password")'); await d.waitForSelector('form .alert.ok'); results.push('change password ok');
await d.screenshot({ path: `${OUT}/settings.png`, fullPage: true });
await check(d, 'desktop', `/u/${uname}`, 'profile');
await d.click('text=Log out'); await d.waitForTimeout(300);
// login by username; the login page points to staff for forgotten passwords
await check(d, 'desktop', '/login', 'login');
if (!(await d.textContent('body')).includes('Ask a Batlas admin')) problems.push('login page missing "Ask a Batlas admin"'); else results.push('login: "Forgot your password? Ask a Batlas admin" shown ok');
await d.fill('#login', uname); await d.fill('#password', 'webkit-pass-654321');
await Promise.all([d.waitForURL('**/profile'), d.click('#f button')]); await d.waitForLoadState('networkidle'); await d.waitForTimeout(300); results.push('login by username ok');
await d.click('text=Log out'); await d.waitForTimeout(300);
// staff temporary password: Developer issues one, user must change it at next login
await d.goto(B + '/login'); await d.fill('#login', 'test_dev'); await d.fill('#password', devPw);
await Promise.all([d.waitForURL('**/profile'), d.click('#f button')]); await d.waitForLoadState('networkidle'); await d.waitForTimeout(300);
d.on('dialog', (dlg) => dlg.accept());
await check(d, 'desktop', '/admin');
await d.fill('input[type=search]', uname); await d.keyboard.press('Enter'); await d.waitForTimeout(600);
await d.click(`tr:has-text("${uname}") button:has-text("Reset password")`);
const temp = (await (await d.waitForSelector('code.temp-pw')).textContent()).trim();
await d.screenshot({ path: `${OUT}/admin-temp-password.png` });
results.push('staff temporary password issued ok');
await d.click('text=Log out'); await d.waitForTimeout(300);
await d.goto(B + '/login'); await d.fill('#login', uname); await d.fill('#password', temp);
await Promise.all([d.waitForURL('**/settings**'), d.click('#f button')]); results.push('temp password login forces /settings ok');
await d.fill('#cp', temp); await d.fill('#np', 'webkit-pass-after-reset'); await d.fill('#np2', 'webkit-pass-after-reset');
await d.click('button:has-text("Change password")'); await d.waitForURL('**/profile'); results.push('forced password change ok');
await d.click('text=Log out'); await d.waitForTimeout(300);
const fp = await d.goto(B + '/forgot-password');
results.push(`forgot-password page with email off: HTTP ${fp.status()} (staff reset is the path)`);
// developer dashboard
await d.goto(B + '/login');
await d.fill('#login', 'test_dev'); await d.fill('#password', devPw);
await Promise.all([d.waitForURL('**/profile'), d.click('#f button')]); await d.waitForLoadState('networkidle'); await d.waitForTimeout(300);
await check(d, 'desktop', '/studio-console#stats'); await d.waitForSelector('.stat'); await d.screenshot({ path: `${OUT}/dashboard-stats.png`, fullPage: true });
await check(d, 'desktop', '/studio-console#inbox'); await d.waitForSelector('.msg-item'); await d.screenshot({ path: `${OUT}/dashboard-inbox.png`, fullPage: true });
await check(d, 'desktop', '/studio-console#news'); await d.waitForSelector('.news-list .card'); await d.screenshot({ path: `${OUT}/dashboard-news.png` });
await check(d, 'desktop', '/studio-console#games'); await d.click('button:has-text("Edit")'); await d.waitForSelector('.version'); await d.screenshot({ path: `${OUT}/dashboard-games-versions.png`, fullPage: true });
await check(d, 'desktop', '/admin');
// ---------- iPhone Safari ----------
const mctx = await browser.newContext({ ...devices['iPhone 15'] });
const m = await mctx.newPage(); watch(m, 'safari-iphone');
for (const [p, s] of [['/', 'mobile-home'], ['/news', 'mobile-news'], ['/contact', 'mobile-contact'], ['/games/sky-crew', 'mobile-game'], ['/login', 'mobile-login'], ['/register', 'mobile-register']]) await check(m, 'iphone', p, s, s === 'mobile-home');
await m.click('.menu-btn'); await m.waitForSelector('.nav.open .nav-links a'); await m.screenshot({ path: `${OUT}/mobile-menu.png` }); results.push('iphone menu opens ok');
await m.goto(B + '/login'); await m.fill('#login', 'test_dev'); await m.fill('#password', devPw);
await Promise.all([m.waitForURL('**/profile'), m.click('#f button')]); await m.waitForLoadState('networkidle'); await m.waitForTimeout(300);
await check(m, 'iphone', '/studio-console#stats', 'mobile-dashboard-stats', true);
await check(m, 'iphone', '/studio-console#inbox');
await check(m, 'iphone', '/admin');
console.log('WebKit version:', browser.version());
console.log(results.join('\n'));
console.log('PROBLEMS:', JSON.stringify(problems, null, 1));
console.log('test user:', uname);
await browser.close();
