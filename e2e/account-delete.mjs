// Account self-delete UI check (Playwright): iPhone (WebKit), iPad (WebKit) and desktop Chromium.
//   BASE=http://127.0.0.1:3500 node account-delete.mjs
// Registers a throw-away player, opens /settings, checks the delete button stays disabled until the
// username is typed exactly + password + checkbox, cancels the confirm dialog once (nothing happens),
// then confirms, and checks the account can no longer sign in.
import { chromium, webkit, devices } from 'playwright';
import fs from 'node:fs';

const B = process.env.BASE || 'http://127.0.0.1:3500';
const OUT = new URL('../docs/screenshots/account-delete/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const problems = [], results = [];
const check = (c, m) => { (c ? results : problems).push(m); console.log(c ? '  ✓' : '  ✗', m); };
const PW = '123456'; // test-only PIN, not a real account secret

async function api(page, method, url, body) {
  return page.evaluate(async ({ method, url, body }) => {
    const c = await (await fetch('/api/csrf')).json();
    const r = await fetch(url, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': c.csrfToken }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { method, url, body });
}

async function run(name, type, device) {
  console.log(`\n${name}`);
  const browser = await type.launch();
  const ctx = await browser.newContext({ ...device });
  const page = await ctx.newPage();
  const user = `Del_${name.replace(/\W/g, '').slice(0, 8)}${Math.floor(Math.random() * 1e5)}`;
  try {
    await page.goto(`${B}/`);
    const reg = await api(page, 'POST', '/api/auth/register', { username: user, pin: PW });
    check(reg.status === 201, `${name}: registered ${user} (${reg.status})`);
    await page.goto(`${B}/settings`);
    await page.waitForSelector('#delete-account');
    const btn = page.locator('#delete-account button[type=submit]');
    check(await btn.isDisabled(), `${name}: delete button disabled at first`);
    await page.locator('#del-user').scrollIntoViewIfNeeded();
    // iPhone-style input: lowercase first letter must NOT count as a match
    await page.fill('#del-user', user.toLowerCase());
    await page.fill('#del-pw', PW);
    await page.check('#del-ok');
    check(await btn.isDisabled(), `${name}: still disabled when the username case differs`);
    check(await page.getAttribute('#del-user', 'autocapitalize') === 'none' && await page.getAttribute('#del-user', 'autocorrect') === 'off', `${name}: username field has autocapitalize=none autocorrect=off`);
    const fs16 = await page.$eval('#del-user', (e) => getComputedStyle(e).fontSize);
    check(fs16 === '16px', `${name}: input font-size ${fs16} (16px avoids iOS zoom)`);
    await page.fill('#del-user', user);
    check(await btn.isEnabled(), `${name}: enabled once username, password and checkbox are right`);
    await page.screenshot({ path: `${OUT}${name.replace(/\W+/g, '-').toLowerCase()}-form.png`, fullPage: false });
    // cancel first
    page.once('dialog', (d) => d.dismiss());
    await btn.click();
    await page.waitForTimeout(500);
    check((await api(page, 'GET', '/api/me')).body?.user?.username === user, `${name}: cancelling the confirm dialog keeps the account`);
    // wrong password shows an error, account kept
    await page.fill('#del-pw', '999999');
    page.once('dialog', (d) => d.accept());
    await btn.click();
    await page.waitForSelector('#delete-account .alert.error', { timeout: 5000 });
    check(true, `${name}: wrong password shows an error`);
    check((await page.inputValue('#del-pw')) === '' && await btn.isDisabled(), `${name}: password cleared and button disabled again after an error`);
    // real delete
    await page.fill('#del-pw', PW);
    page.once('dialog', (d) => d.accept());
    await btn.click();
    await page.waitForSelector('.alert.ok', { timeout: 8000 });
    check(/deleted/i.test(await page.textContent('.alert.ok')), `${name}: success message shown`);
    await page.screenshot({ path: `${OUT}${name.replace(/\W+/g, '-').toLowerCase()}-done.png` });
    check((await api(page, 'GET', '/api/me')).body?.user == null, `${name}: signed out`);
    const login = await api(page, 'POST', '/api/auth/login', { login: user, pin: PW });
    check(login.status === 401, `${name}: cannot sign in again (${login.status})`);
  } catch (e) {
    check(false, `${name}: ${e.message.split('\n')[0]}`);
  } finally { await browser.close(); }
}

await run('iPhone 13 (WebKit)', webkit, devices['iPhone 13']);
await run('iPad (WebKit)', webkit, devices['iPad (gen 7)']);
await run('Desktop Chromium', chromium, devices['Desktop Chrome']);
const summary = `${results.length} passed, ${problems.length} failed\n` + problems.map((p) => '✗ ' + p).join('\n');
fs.writeFileSync(`${OUT}RESULTS.txt`, [...results.map((r) => '✓ ' + r), ...problems.map((p) => '✗ ' + p), '', summary].join('\n') + '\n');
console.log('\n' + summary);
process.exit(problems.length ? 1 : 0);
