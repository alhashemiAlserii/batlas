// Website upgrade end-to-end check (Playwright): Chromium + WebKit at iPhone, iPad and desktop sizes.
// Run against a local server with a throw-away database, e.g. port 3300:
//   BASE=http://localhost:3300 DEV_CREDS=../server/data/dev-creds.txt node website.mjs
// Phase 1 drives every Developer-dashboard control through the UI (and seeds demo content);
// phase 2 checks the public site on 6 browser/device combinations and saves screenshots.
import { chromium, webkit, devices } from 'playwright';
import fs from 'node:fs';

const B = process.env.BASE || 'http://localhost:3300';
const OUT = new URL('../docs/screenshots/website/', import.meta.url).pathname;
const FX = new URL('./fixtures/', import.meta.url).pathname;
const devUser = fs.readFileSync(process.env.DEV_CREDS || new URL('../server/data/dev-creds.txt', import.meta.url).pathname, 'utf8');
const DEV = { user: devUser.match(/username=(.*)/)[1].trim(), pw: devUser.match(/password=(.*)/)[1].trim() };
fs.mkdirSync(OUT, { recursive: true });
const problems = [];
const results = [];
const notes = [];
const ok = (m) => { results.push(m); console.log('  ✓', m); };
const bad = (m) => { problems.push(m); console.log('  ✗', m); };
const expect = (cond, m) => (cond ? ok(m) : bad(m));
// "due to access control checks" = WebKit's message for a fetch aborted by the test navigating away mid-request.
const IGNORE = /Refused to apply a stylesheet|due to access control checks|youtube|googlevideo|doubleclick|ytimg|Failed to load resource: net::ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION)|status of 503/i;
function watch(page, label) {
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text()) && !IGNORE.test(m.location()?.url || '')) bad(`[${label}] console: ${m.text()} @ ${page.url()}`); });
  page.on('pageerror', (e) => /due to access control checks/.test(e.message) || bad(`[${label}] pageerror: ${e.message} @ ${page.url()}`));
}
/** Answers window.prompt/confirm/alert from a queue (in order); default accept. */
function dialogs(page) {
  const q = [];
  page.on('dialog', async (d) => {
    const next = q.shift();
    if (next === false) return d.dismiss();
    if (d.type() === 'prompt') return d.accept(typeof next === 'string' ? next : d.defaultValue());
    return d.accept();
  });
  return (...answers) => q.push(...answers);
}
async function overflow(page, label) {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (o > 1) bad(`[${label}] horizontal overflow ${o}px on ${new URL(page.url()).pathname}`);
}
async function login(page, user, pw) {
  await page.goto(`${B}/login`);
  await page.fill('#login', user); await page.fill('#password', pw);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login')), page.click('#f button')]);
  await page.waitForLoadState('networkidle');
}
const tab = async (page, k) => { await page.click(`.tabs button[data-k="${k}"]`); await page.waitForTimeout(250); };
async function upload(page, inputId, file, btnText) {
  await page.setInputFiles(`#${inputId}`, FX + file);
  const wrap = page.locator(`.uploader:has(#${inputId})`);
  await wrap.locator(`button:has-text("${btnText}")`).click();
  await wrap.locator('.small.muted:has-text("Uploaded")').waitFor({ timeout: 20000 });
}
const okAlert = (scope) => scope.locator('.alert.ok').last().waitFor({ timeout: 10000 });

// =============== Phase 1: Developer dashboard (Chromium desktop) ===============
console.log('Phase 1: dashboard actions');
{
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage(); watch(page, 'dash'); const answer = dialogs(page);
  await login(page, DEV.user, DEV.pw); ok('developer login');
  await page.goto(`${B}/studio-console#games`);
  await page.waitForSelector('#new-game');

  // --- Sky Crew (published, featured) ---
  const existing = page.locator('[data-game="sky-crew"] button:has-text("Edit")');
  if (await existing.count()) await existing.click(); else await page.click('#new-game');
  await page.fill('#g-title', 'Sky Crew');
  await page.fill('#g-slug', 'sky-crew');
  await page.fill('#g-tagline', 'Co-op airline chaos at 30,000 ft. Fly, serve, and try not to lose a passenger.');
  await page.fill('#g-description', 'Sky Crew is a co-op browser game for up to 8 friends. One of you flies, the others load bags, serve snacks, calm panicking passengers and fix whatever breaks next.\n\nPlay right in Safari on iPad, iPhone or Mac. No install, no email: just a Batlas account.');
  await page.selectOption('#g-status', 'published');
  await page.fill('#g-platforms', 'Web, iPad, iPhone, Mac');
  await page.fill('#g-playUrl', '/play/sky-crew');
  await page.fill('#g-downloadUrl', '');
  await upload(page, 'up-cover', 'cover.jpg', 'Upload cover');
  while (await page.locator('#shot-list .shot').count()) await page.locator('#shot-list .shot').first().locator('button[aria-label="Remove screenshot"]').click();
  for (const s of ['exterior.jpg', 'cabin.jpg', 'cockpit.jpg', 'landing-guide.jpg', 'passenger-parachute.jpg', 'payout.jpg']) await upload(page, 'up-shot', s, 'Add screenshot');
  expect((await page.locator('#shot-list .shot').count()) >= 6, 'screenshots uploaded into the gallery list');
  await page.locator('#shot-list .shot').last().locator('button[aria-label="Remove screenshot"]').click();
  await page.locator('#shot-list .shot').nth(1).locator('button[aria-label="Move left"]').click();
  ok('screenshot remove + reorder buttons');
  await upload(page, 'up-trailer', 'trailer.mp4', 'Upload trailer');
  await upload(page, 'up-poster', 'exterior.jpg', 'Upload poster');
  await page.check('#gs-featured');
  await page.click('#save-game'); await okAlert(page.locator('#game-form')); ok('save Sky Crew (cover, 5 screenshots, MP4 trailer, poster, featured)');
  await page.screenshot({ path: `${OUT}/dashboard-game-editor.png`, fullPage: true });

  // publish an update (+ news post)
  const ver = `0.4.${Date.now() % 1000}`;
  await page.fill('#v-version', ver);
  await page.fill('#v-cl', '- New: maintenance-safe uploads\n- New: trailer + gallery on the game page\n- Fixed: wobbly service cart');
  await page.check('#v-news');
  await page.click('#add-version'); await page.locator('section:has(#add-version) .alert.ok, form:has(#add-version) .alert.ok').first().waitFor();
  ok(`publish update v${ver} with news post`);

  // --- upcoming game ---
  await page.goto(`${B}/studio-console#games`); await page.waitForSelector('#new-game');
  const ex2 = page.locator('[data-game="harbor-havoc"] button:has-text("Edit")');
  if (await ex2.count()) await ex2.click(); else await page.click('#new-game');
  await page.fill('#g-title', 'Harbor Havoc');
  await page.fill('#g-slug', 'harbor-havoc');
  await page.fill('#g-tagline', 'Run a chaotic seaside port with your friends. (Demo entry for testing)');
  await page.fill('#g-description', 'Our next co-op game. Load ships, dodge seagulls, keep the harbor moving.');
  await page.selectOption('#g-status', 'upcoming');
  await page.fill('#g-releaseDate', '2027-02-14');
  await page.fill('#g-platforms', 'Web');
  await upload(page, 'up-cover', 'upcoming-cover.jpg', 'Upload cover');
  await page.fill('#g-youtubeUrl', 'https://youtu.be/aqz-KE-bpKQ');
  await page.click('#save-game'); await okAlert(page.locator('#game-form')); ok('create upcoming game with release date + YouTube trailer');
  // status buttons on the list
  await page.goto(`${B}/studio-console#games`);
  await page.locator('[data-game="harbor-havoc"] button:has-text("Set draft")').click(); await page.waitForTimeout(400);
  await page.locator('[data-game="harbor-havoc"] button:has-text("Set upcoming")').click(); await page.waitForTimeout(400);
  expect(await page.locator('[data-game="harbor-havoc"] .pill.upcoming').count() === 1, 'status buttons (draft → upcoming)');
  await page.screenshot({ path: `${OUT}/dashboard-games.png` });

  // --- events ---
  await tab(page, 'events'); await page.click('#new-event');
  await page.fill('#e-title', 'Double payout weekend');
  await page.fill('#e-message', 'Every Sky Crew flight pays x2 credits.');
  await page.fill('#e-linkUrl', '/play/sky-crew');
  await page.click('#save-event'); await okAlert(page.locator('#event-form')); ok('schedule event');
  await page.screenshot({ path: `${OUT}/dashboard-events.png`, fullPage: true });
  // second event: create, cancel, restore, delete
  await page.click('#new-event'); await page.fill('#e-title', 'Temp event'); await page.click('#save-event'); await okAlert(page.locator('#event-form'));
  const temp = page.locator('#events-list .card:has(h3:text-is("Temp event"))');
  await temp.locator('button:has-text("Cancel event")').click(); await page.waitForTimeout(300);
  await temp.locator('button:has-text("Restore")').click(); await page.waitForTimeout(300);
  answer(true); await temp.locator('button:has-text("Delete")').click(); await page.waitForTimeout(400);
  expect(await temp.count() === 0, 'event cancel / restore / delete');

  // --- news linked to game ---
  await tab(page, 'news'); await page.click('button:has-text("+ New post")');
  await page.fill('#n-title', `Welcome to the new Batlas site ${Date.now() % 10000}`);
  await page.fill('#n-summary', 'Trailers, screenshot galleries, events and more.');
  await page.fill('#n-body', 'The Batlas website just got a big upgrade.');
  await page.selectOption('#n-status', 'published');
  await page.waitForFunction(() => document.querySelectorAll('#n-game option').length > 1);
  await page.selectOption('#n-game', { label: 'Sky Crew' });
  await page.click('form button.primary'); await okAlert(page.locator('form')); ok('news post linked to a game');

  // --- players: register two players in another context ---
  const pctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const pp = await pctx.newPage(); watch(pp, 'player');
  const uname = 'pl_' + Date.now().toString(36).slice(-6), uname2 = uname + 'b';
  for (const u of [uname2, uname]) {
    await pp.goto(`${B}/register`); await pp.fill('#username', u); await pp.fill('#password', 'player-pass-123456');
    await Promise.all([pp.waitForURL('**/profile'), pp.click('#f button')]);
    if (u === uname2) { await pp.click('text=Log out'); await pp.waitForTimeout(300); }
  }
  ok('register two players (username + password only)');
  await tab(page, 'users');
  await page.fill('input[type=search]', uname); await page.waitForTimeout(600);
  const row = () => page.locator(`tr:has(a[href="/u/${uname}"])`).first();
  for (const r of ['TRUSTED', 'ADMIN', 'PLAYER']) {
    await row().locator('select').selectOption(r); await page.locator('.alert.ok').waitFor(); await page.waitForTimeout(400);
    expect(await row().locator(`.rank-${r.toLowerCase()}`).count() > 0, `assign ${r}`);
  }
  answer('Friendly Pilot', true); await row().locator('[data-action="edit-profile"]').click(); await page.waitForTimeout(600);
  expect(await row().textContent().then((t) => t.includes('Friendly Pilot')), 'edit player profile (display name)');
  answer('testing kick'); await row().locator('button:has-text("Kick")').click(); await page.locator('.alert.ok:has-text("kicked")').waitFor(); ok('kick');
  answer(true); await row().locator('button:has-text("Reset password")').click(); await page.locator('.temp-pw').waitFor(); ok('temporary password');
  answer('spam'); await row().locator('button:has-text("Ban")').click(); await page.locator('.alert.ok:has-text("banned")').waitFor(); ok('ban');
  await row().locator('button:has-text("Unban")').click(); await page.locator('.alert.ok:has-text("unbanned")').waitFor(); ok('unban');
  await page.fill('input[type=search]', DEV.user); await page.waitForTimeout(600);
  expect((await page.locator(`tr:has(a[href="/u/${DEV.user}"])`).first().textContent()).includes('Protected'), 'Developer row is protected (no demote/ban controls)');
  await page.fill('input[type=search]', ''); await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/dashboard-players.png` });

  // --- online ---
  await pp.goto(`${B}/profile`); // fresh activity
  await tab(page, 'online'); await page.waitForSelector('#online-panel .dot');
  await page.click('#online-refresh'); await page.waitForTimeout(400);
  await page.selectOption('#online-window', '15'); await page.waitForTimeout(400);
  expect(await page.locator('#online-panel').textContent().then((t) => t.includes(DEV.user)), 'online view lists signed-in users');
  expect(await page.locator('#online-panel h3:has-text("Sky Crew rooms")').count() === 1, 'online view shows live Sky Crew rooms table (game server attached)');
  await page.screenshot({ path: `${OUT}/dashboard-online.png` });

  // --- media ---
  await tab(page, 'media'); await page.waitForSelector('#media-grid .media-tile');
  const before = await page.locator('#media-grid .media-tile').count();
  await upload(page, 'up-media', 'payout.jpg', 'Upload');
  await page.waitForFunction((n) => document.querySelectorAll('#media-grid .media-tile').length > n, before);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B });
  await page.locator('#media-grid .media-tile').first().locator('button:has-text("Copy URL")').click();
  await page.locator('#media-grid .media-tile').first().locator('button:has-text("Copied")').waitFor({ timeout: 5000 });
  answer(true); await page.locator('#media-grid .media-tile').first().locator('button:has-text("Delete")').click();
  await page.waitForFunction((n) => document.querySelectorAll('#media-grid .media-tile').length === n, before);
  ok('media library upload / copy URL / delete');
  await page.screenshot({ path: `${OUT}/dashboard-media.png` });

  // --- other existing tabs still render ---
  for (const k of ['stats', 'inbox', 'audit', 'rooms', 'tools']) { await tab(page, k); await page.waitForTimeout(300); }
  await tab(page, 'audit'); await page.waitForSelector('td code');
  const audit = await page.locator('#app').textContent();
  for (const a of ['media.upload.video', 'game.create', 'game.status', 'event.create', 'role.change', 'player.profile_edit', 'player.ban']) expect(audit.includes(a), `audit log has ${a}`);

  // --- maintenance mode ---
  await tab(page, 'site'); await page.waitForSelector('#m-enabled');
  await page.check('#m-enabled');
  await page.fill('#m-text', 'We are installing new planes and a shinier website. Back very soon!');
  await page.fill('#m-eta-input', '2026-11-11T09:00');
  answer(true); await page.click('#m-save'); await page.waitForSelector('#m-state:text-is("ON")'); ok('maintenance ON via dashboard');
  await page.screenshot({ path: `${OUT}/dashboard-maintenance.png` });
  const anon = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ap = await anon.newPage(); watch(ap, 'maint-anon');
  const resp = await ap.goto(`${B}/`); await ap.waitForSelector('#m-eta:not([hidden])');
  expect(resp.status() === 503 && (await ap.textContent('h1')).includes('under maintenance'), 'visitors get the 503 maintenance page with message + ETA');
  await ap.screenshot({ path: `${OUT}/maintenance-desktop.png` });
  expect((await pp.goto(`${B}/games`)).status() === 503, 'existing player session gets the maintenance page');
  expect(await pp.evaluate(async () => (await fetch('/api/me')).status) === 503, 'player API calls get 503');
  await pp.goto(`${B}/login`); await pp.fill('#login', uname2); await pp.fill('#password', 'player-pass-123456'); await pp.click('#f button');
  await pp.locator('.alert.error:has-text("maintenance")').waitFor(); ok('non-Developer login refused during maintenance');
  await page.goto(`${B}/`); await page.waitForSelector('.site-banner.maint-on');
  ok('Developer still sees the site, with a "Maintenance mode is ON" banner');
  await page.screenshot({ path: `${OUT}/maintenance-developer-view.png` });
  await page.goto(`${B}/studio-console#site`); await page.waitForSelector('#m-enabled');
  await page.uncheck('#m-enabled'); await page.click('#m-save'); await page.waitForSelector('#m-state:text-is("OFF")');
  expect((await ap.goto(`${B}/`)).status() === 200, 'maintenance OFF: site back for everyone');
  await anon.close(); await pctx.close(); await browser.close();
}

// =============== Phase 2: public site, 2 engines × 3 sizes ===============
const SIZES = {
  iphone: devices['iPhone 15'],
  ipad: devices['iPad (gen 7)'],
  desktop: { viewport: { width: 1440, height: 900 } },
};
for (const [engName, eng] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await eng.launch();
  for (const [size, dev] of Object.entries(SIZES)) {
    const L = `${engName}-${size}`;
    console.log(`Phase 2: ${L}`);
    const ctx = await browser.newContext({ ...dev });
    // Playwright's WebKit on this Linux box has no GStreamer codecs installed (apt is blocked here),
    // and any <video src> crashes its renderer. For WebKit runs we strip the uploaded trailer from the
    // API responses, so the rest of the page is still tested. Video is verified in Chromium + vitest.
    const noVideo = engName === 'webkit' && process.env.WEBKIT_VIDEO !== '1';
    if (noVideo) await ctx.route(/\/api\/games(\/[^/?]+)?(\?.*)?$/, async (route) => {
      const r = await route.fetch(); const j = await r.json();
      for (const g of [j.game, ...(j.games || [])].filter(Boolean)) g.trailerVideo = '';
      await route.fulfill({ response: r, json: j });
    });
    const page = await ctx.newPage(); watch(page, L);
    const touch = !!dev.hasTouch;

    await page.goto(`${B}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.featured');
    expect((await page.locator('.featured h3').textContent()) === 'Sky Crew', `[${L}] homepage featured game`);
    expect(await page.locator('#upcoming .game-card').count() >= 1 && (await page.locator('#upcoming .release').first().textContent()).includes('2027'), `[${L}] upcoming games with release date`);
    expect(await page.locator('#news-list .news-card').count() >= 1, `[${L}] latest news`);
    expect(await page.locator('.site-banner.event').count() >= 1, `[${L}] event banner site-wide`);
    const fv = page.locator('.featured video');
    if (await fv.count()) expect(await fv.evaluate((v) => v.muted && v.hasAttribute('playsinline') && v.autoplay), `[${L}] featured autoplay preview is muted + playsinline`);
    if (await page.isVisible('.menu-btn')) {
      await page.click('.menu-btn'); expect(await page.isVisible('.nav-links a[href="/games"]'), `[${L}] mobile menu opens`);
      await page.click('.menu-btn');
    }
    await overflow(page, L);
    await page.screenshot({ path: `${OUT}/${L}-home.png`, fullPage: true });
    await page.click('#featured-details'); await page.waitForURL('**/games/sky-crew');

    // game page
    await page.waitForSelector('.game-top');
    expect(await page.getAttribute('#play-btn', 'href') === '/play/sky-crew', `[${L}] Play in browser button`);
    expect(await page.locator('#download-btn').count() === 0, `[${L}] no Download button when no download file exists`);
    const v = page.locator('#game-media video');
    if (noVideo) notes.push(`[${L}] uploaded-trailer <video> skipped in WebKit (no GStreamer codecs on this box)`);
    else expect(await v.count() === 1 && (await v.evaluate((el) => el.hasAttribute('playsinline') && !!el.getAttribute('poster') && el.controls)), `[${L}] uploaded MP4 trailer with poster, controls, playsinline`);
    const meta = noVideo ? 'skipped (WebKit without codecs)' : await v.evaluate((el) => new Promise((res) => { if (el.readyState >= 1) return res(el.duration); el.addEventListener('loadedmetadata', () => res(el.duration), { once: true }); el.addEventListener('error', () => res(`error ${el.error?.code}`), { once: true }); el.load(); setTimeout(() => res('timeout'), 8000); }));
    if (typeof meta === 'number') ok(`[${L}] trailer metadata loads over Range requests (duration ${meta.toFixed(1)}s)`);
    else if (!noVideo) bad(`[${L}] trailer did not load metadata (${meta})`);
    if (await page.locator('.media-switch button[data-media="cover"]').count()) {
      await page.click('.media-switch button[data-media="cover"]'); expect(await page.locator('#game-media img').count() === 1, `[${L}] media switch (→ cover)`);
      await page.click('.media-switch button >> nth=0');
    }
    await overflow(page, L);
    await page.screenshot({ path: `${OUT}/${L}-game.png`, fullPage: true });
    // gallery + lightbox
    await page.locator('#screenshots .gallery button').first().scrollIntoViewIfNeeded();
    await page.locator('#screenshots .gallery button').first().click();
    await page.waitForSelector('.lightbox');
    const c1 = await page.textContent('.lb-count');
    await page.click('.lb-next'); const c2 = await page.textContent('.lb-count');
    await page.click('.lb-prev'); const c3 = await page.textContent('.lb-count');
    expect(c1 === '1 / 5' && c2 === '2 / 5' && c3 === '1 / 5', `[${L}] lightbox next/prev (${c1} → ${c2} → ${c3})`);
    // swipe left with pointer events (mouse drag works the same as a finger in our handler)
    const box = await page.locator('.lightbox img').boundingBox();
    if (touch) {
      await page.locator('.lightbox img').dispatchEvent('pointerdown', { clientX: box.x + box.width * 0.8, clientY: box.y + box.height / 2, pointerId: 1, pointerType: 'touch', isPrimary: true });
      await page.locator('.lightbox img').dispatchEvent('pointermove', { clientX: box.x + box.width * 0.5, clientY: box.y + box.height / 2, pointerId: 1, pointerType: 'touch', isPrimary: true });
      await page.locator('.lightbox img').dispatchEvent('pointerup', { clientX: box.x + box.width * 0.1, clientY: box.y + box.height / 2, pointerId: 1, pointerType: 'touch', isPrimary: true });
    } else {
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2); await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 5 }); await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2, { steps: 5 }); await page.mouse.up();
    }
    await page.waitForTimeout(150);
    expect(await page.textContent('.lb-count') === '2 / 5', `[${L}] lightbox swipe to next`);
    await page.screenshot({ path: `${OUT}/${L}-lightbox.png` });
    if (!touch) { await page.keyboard.press('Escape'); } else { await page.click('.lb-close'); }
    expect(await page.locator('.lightbox').count() === 0, `[${L}] lightbox closes`);
    await page.click('#gallery-btn'); await page.waitForSelector('.lightbox'); await page.click('.lb-close');
    ok(`[${L}] "Screenshots" button opens the lightbox`);

    // upcoming game page
    await page.goto(`${B}/games/harbor-havoc`, { waitUntil: 'networkidle' });
    expect((await page.textContent('#release-date')).includes('2027'), `[${L}] upcoming game shows release date`);
    expect(await page.locator('#game-media iframe[src*="youtube-nocookie.com/embed/aqz-KE-bpKQ"]').count() === 1 || await page.locator('.media-switch button[data-media="youtube"]').count() === 1, `[${L}] YouTube trailer embed available`);
    await overflow(page, L);
    if (size !== 'ipad') await page.screenshot({ path: `${OUT}/${L}-upcoming.png`, fullPage: true });

    for (const p of ['/games', '/news', '/contact', '/login', '/register']) { await page.goto(B + p, { waitUntil: 'networkidle' }); await overflow(page, L); }
    await page.goto(`${B}/games`); await page.waitForSelector('.game-card'); await page.screenshot({ path: `${OUT}/${L}-games.png`, fullPage: true });
    ok(`[${L}] games / news / contact / login / register load without overflow`);

    // dashboard on this device
    await login(page, DEV.user, DEV.pw);
    await page.goto(`${B}/studio-console#games`); await page.waitForSelector('[data-game="sky-crew"]');
    await page.locator('[data-game="sky-crew"] button:has-text("Edit")').click(); await page.waitForSelector('#game-form');
    await overflow(page, `${L} dashboard`);
    await page.screenshot({ path: `${OUT}/${L}-dashboard.png`, fullPage: size !== 'desktop' ? false : true });
    await page.goto(`${B}/studio-console#site`); await page.waitForSelector('#m-enabled');
    if (size === 'iphone') await page.screenshot({ path: `${OUT}/${L}-dashboard-maintenance.png` });
    ok(`[${L}] dashboard usable`);
    await ctx.close();
  }
  // maintenance page on mobile Safari sizes
  if (engName === 'webkit') {
    const ctx = await browser.newContext({ ...devices['iPhone 15'] });
    const dp = await ctx.newPage();
    await login(dp, DEV.user, DEV.pw);
    await dp.evaluate(async () => { const t = document.cookie.match(/csrf=([^;]+)/)[1]; await fetch('/api/dev/maintenance', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': decodeURIComponent(t) }, body: JSON.stringify({ enabled: true, message: 'New planes are landing. Back soon!', eta: new Date(Date.now() + 2 * 3600e3).toISOString() }) }); });
    const an = await browser.newContext({ ...devices['iPhone 15'] }); const ap = await an.newPage();
    await ap.goto(`${B}/`); await ap.waitForSelector('#m-eta:not([hidden])'); await ap.screenshot({ path: `${OUT}/maintenance-iphone-webkit.png` });
    const ipad = await browser.newContext({ ...devices['iPad (gen 7)'] }); const ip = await ipad.newPage();
    await ip.goto(`${B}/`); await ip.waitForSelector('#m-eta:not([hidden])'); await ip.screenshot({ path: `${OUT}/maintenance-ipad-webkit.png` });
    await dp.evaluate(async () => { const t = document.cookie.match(/csrf=([^;]+)/)[1]; await fetch('/api/dev/maintenance', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': decodeURIComponent(t) }, body: JSON.stringify({ enabled: false }) }); });
    ok('[webkit] maintenance page on iPhone + iPad');
    await an.close(); await ipad.close(); await ctx.close();
  }
  await browser.close();
}

console.log(`\n${results.length} checks passed, ${problems.length} problems, ${notes.length} notes`);
for (const n of notes) console.log('NOTE', n);
for (const p of problems) console.log('PROBLEM', p);
fs.writeFileSync(`${OUT}/RESULTS.txt`, `Website e2e (${new Date().toISOString()})\n${results.length} passed, ${problems.length} problems, ${notes.length} notes\n\n${results.map((r) => '✓ ' + r).join('\n')}\n${problems.map((p) => '✗ ' + p).join('\n')}\n${notes.map((n) => 'NOTE ' + n).join('\n')}\n`);
process.exit(problems.length ? 1 : 0);
