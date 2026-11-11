// Sky Crew keyboard focus e2e (Mac / keyboard iPad): a guest types the room code, presses Enter, boards, and the
// game keys then work even though focus was left in the (now hidden) code field; a visible text field (chat) still
// gets the keys instead of the game. Chromium + WebKit.
import { chromium, webkit } from 'playwright';
const B = process.env.BASE || 'http://localhost:3200';
const fail = [];
const check = (c, m) => { if (!c) fail.push(m); console.log(`${c ? '✔' : '✘'} ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [name, type] of [['chromium', chromium], ['webkit', webkit]].slice(0, process.env.ONE ? 1 : 2)) {
  const browser = await type.launch(); const errs = [];
  const mk = async (label) => {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
    await ctx.addInitScript(() => { localStorage.setItem('skycrew.quality', 'low'); localStorage.setItem('skycrew.skipAirport', '1'); });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(`[${label}] ${e.message}`));
    await p.goto(`${B}/login`);
    const st = await p.evaluate(async (u) => { const c = (await (await fetch('/api/csrf')).json()).csrfToken; return (await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': c }, body: JSON.stringify({ username: u, password: 'Sky-crew-test-pass-1' }) })).status; }, `e2e_kf${label}${name[0]}${Date.now() % 100000}`);
    if (st >= 300) throw new Error(`register ${st}`);
    await p.goto(`${B}/play/sky-crew?fps=2`); await p.waitForFunction(() => window.skyCrew?.ready, null, { timeout: 30000 }); await p.waitForSelector('#bJoin:not([disabled])');
    return p;
  };
  const H = await mk('h'), G = await mk('g');
  await H.click('#bCreate'); await H.waitForFunction(() => window.skyCrew.state().room?.code);
  const code = await H.evaluate(() => window.skyCrew.state().room.code);
  // guest: real typing + Enter in the code field
  await G.click('#joinCode'); await G.keyboard.type(code); await G.keyboard.press('Enter');
  await G.waitForFunction(() => window.skyCrew.state().room, null, { timeout: 15000 });
  // board without moving focus (tap / programmatic start keeps focus where it was)
  await G.evaluate(() => document.querySelector('#bBoard').click()); await H.evaluate(() => document.querySelector('#bBoard').click());
  await G.waitForFunction(() => window.skyCrew.state().playing, null, { timeout: 30000 });
  const focus = await G.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  check(focus !== 'joinCode', `${name}: focus left the hidden room-code field when the game started (${focus})`);
  // even if something re-focuses it while hidden, game keys must still work
  await G.evaluate(() => { const j = document.querySelector('#joinCode'); j.focus(); });
  await G.evaluate(() => { window.skyCrew.teleport(0, 0, 4); window.skyCrew.look(0, 0); }); await sleep(600);
  const z0 = await G.evaluate(() => window.skyCrew.state().me.z);
  await G.keyboard.down('KeyW'); await G.waitForFunction((z) => window.skyCrew.state().me.z < z - 0.5, z0, { timeout: 10000 }).catch(() => {}); await G.keyboard.up('KeyW');
  const z1 = await G.evaluate(() => window.skyCrew.state().me.z);
  const st = await G.evaluate(() => ({ paused: window.skyCrew.state().paused, lock: !!document.pointerLockElement }));
  check(z1 < z0 - 0.5, `${name}: W walks with focus in the hidden code field (${(z0 - z1).toFixed(2)} m; paused ${st.paused}, pointer lock ${st.lock})`);
  const v0 = await G.evaluate(() => window.skyCrew.state().third ?? null);
  // E reaches the game: aim at a seated passenger and pick them up with the real key
  await H.evaluate(() => window.skyCrew.debug.sitAll());
  await G.waitForFunction(() => window.skyCrew.pax().filter((x) => x.state === 'seated' && Math.abs(x.y) < 0.2 && x.z < 12).length >= 12, null, { timeout: 20000 });
  await sleep(300);
  const q = (await H.evaluate(() => window.skyCrew.pax())).filter((x) => x.state === 'seated' && Math.abs(x.x) < 1.2 && Math.abs(x.y) < 0.05 && x.z < 12).sort((a, b) => a.z - b.z)[2];
  // the guest's copy glides to the host's position: wait until it has settled there before aiming
  await G.waitForFunction((q) => { const g = window.skyCrew.pax().find((x) => x.id === q.id); return g && Math.hypot(g.x - q.x, g.y - q.y, g.z - q.z) < 0.05; }, q, { timeout: 20000 }).catch(() => {});
  let t = null; for (let i = 0; i < 40 && t?.kind !== 'grabPax'; i++) { if (i % 5 === 0) await G.evaluate((q) => { window.skyCrew.teleport(0, 0, q.z + 1); window.skyCrew.lookAt(q.x, 0.7, q.z); }, q); await sleep(150); t = await G.evaluate(() => window.skyCrew.target()); }
  await G.keyboard.press('KeyE');
  const got = await G.waitForFunction(() => !!window.skyCrew.heldPax(), null, { timeout: 8000 }).then(() => true, () => false);
  check(got, `${name}: E picks up a passenger (target ${t?.kind}; paused ${(await G.evaluate(() => window.skyCrew.state().paused))})`);
  // a visible text field keeps its keys: typing "wasd" in chat does not move the player
  await G.keyboard.press('Enter'); await G.waitForSelector('#chatInput', { state: 'visible', timeout: 5000 }).catch(() => {});
  const zc = await G.evaluate(() => window.skyCrew.state().me.z);
  await G.keyboard.type('wwwwwwww'); await sleep(800);
  check(Math.abs((await G.evaluate(() => window.skyCrew.state().me.z)) - zc) < 0.05 && /w{4}/.test(await G.inputValue('#chatInput').catch(() => '')), `${name}: typing in the visible chat box types text and does not walk`);
  check(errs.length === 0, `${name}: no page errors${errs.length ? ` ${errs[0]}` : ''}`);
  await browser.close();
}
console.log(fail.length ? `FAILED ${fail.length}` : 'ALL PASSED'); process.exit(fail.length ? 1 : 0);
