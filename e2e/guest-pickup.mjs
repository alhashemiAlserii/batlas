// Sky Crew guest pickup reliability: host + guest on the real server. The guest walks up the aisle to a seated
// passenger, the aim is verified through the test hook (target kind grabPax), then a real E key press. Both clients
// must agree the guest carries that passenger; the guest then puts them down (E) and both agree again. N attempts
// (default 10); any failure WITH a verified aim is a game bug, and the run prints full diagnostics for it.
// Note: from 0.9 m in front of a window-seat row the eye->chest distance is ~2.06 m, just past the 2.0 m grab reach,
// so the aim there is legitimately borderline on host and guest alike; the test walks to ~0.6 m like a player would.
import { chromium } from 'playwright';
const B = process.env.BASE || 'http://localhost:3200';
const N = Number(process.env.N || 10);
const fail = [];
const check = (c, m) => { if (!c) fail.push(m); console.log(`${c ? '✔' : '✘'} ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(); const errs = [];
const mk = async (label) => {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 560 } });
  await ctx.addInitScript(() => { localStorage.setItem('skycrew.quality', 'low'); localStorage.setItem('skycrew.skipAirport', '1'); });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(`[${label}] ${e.message}`)); p.on('console', (m) => { if (m.type() === 'error' && !/Refused to apply/.test(m.text())) errs.push(`[${label}] ${m.text()}`); });
  await p.goto(`${B}/login`);
  const st = await p.evaluate(async (u) => { const c = (await (await fetch('/api/csrf')).json()).csrfToken; return (await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': c }, body: JSON.stringify({ username: u, pin: '123456' }) })).status; }, `e2e_gp${label}${Date.now() % 100000}`);
  if (st >= 300) throw new Error(`register ${st}`);
  await p.goto(`${B}/play/sky-crew?fps=2`); await p.waitForFunction(() => window.skyCrew?.ready, null, { timeout: 30000 }); await p.waitForSelector('#bJoin:not([disabled])');
  return p;
};
const H = await mk('h'), G = await mk('g');
await H.click('#bCreate'); await H.waitForFunction(() => window.skyCrew.state().room?.code);
const code = await H.evaluate(() => window.skyCrew.state().room.code);
await G.fill('#joinCode', code); await G.click('#bJoin'); await G.waitForFunction(() => window.skyCrew.state().room);
await H.click('#bBoard'); await G.click('#bBoard');
await G.waitForFunction(() => window.skyCrew.state().playing && window.skyCrew.state().remotes.length === 1, null, { timeout: 30000 });
await H.evaluate(() => { window.skyCrew.debug.sitAll(); window.skyCrew.teleport(0, 0, 8); });
const seated = () => window.skyCrew.pax().filter((x) => x.state === 'seated' && Math.abs(x.y) < 0.2 && x.z < 12 && x.z > -12).length;
await H.waitForFunction(seated, null, { timeout: 15000 });
const nH = await H.evaluate(seated);
await G.waitForFunction((n) => window.skyCrew.pax().filter((x) => x.state === 'seated' && Math.abs(x.y) < 0.2 && x.z < 12 && x.z > -12).length >= n, nH, { timeout: 20000 });
await G.evaluate(() => { window.__toasts = []; new MutationObserver(() => { const t = document.body.innerText; if (/wriggled free/.test(t) && !window.__toasts.length) window.__toasts.push('wriggle'); }).observe(document.body, { subtree: true, childList: true, characterData: true }); });

const targets = (await H.evaluate(() => window.skyCrew.pax())).filter((x) => x.state === 'seated' && x.z > -12 && x.z < 10).sort((a, b) => b.z - a.z);
let aimed = 0, ok = 0, bugs = [];
for (let i = 0; i < N; i++) {
  const id = targets[i % targets.length].id;
  // aim where the GUEST sees the passenger (its copies glide to the host's positions): wait until it is seated there
  await G.waitForFunction((id) => { const x = window.skyCrew.pax().find((p) => p.id === id); return x && x.state === 'seated' && Math.abs(x.y) < 0.2; }, id, { timeout: 15000 }).catch(() => {});
  await sleep(1500);
  const q = await G.evaluate((id) => window.skyCrew.pax().find((p) => p.id === id), id);
  // walk up the aisle towards the passenger's row (start 2.5 m behind it), then aim at them
  await G.evaluate((q) => { window.skyCrew.teleport(0, 0, q.z + 2.5); window.skyCrew.look(0, 0); }, q);
  await G.keyboard.down('KeyW');
  await G.waitForFunction((z) => window.skyCrew.state().me.z < z, q.z + 0.75, { timeout: 15000 }).catch(() => {}); // within reach of a window seat (grab reach 2.0 m eye -> chest)
  await G.keyboard.up('KeyW');
  await G.evaluate((q) => window.skyCrew.lookAt(q.x, 0.7, q.z), q);
  let t = null; for (let k = 0; k < 40 && !(t && t.kind === 'grabPax'); k++) { await sleep(150); t = await G.evaluate(() => window.skyCrew.target()); }
  if (!t || t.kind !== 'grabPax') {
    // same pose on the HOST (the authority, no prediction): if it cannot target them either, it is reach/geometry, not sync
    const me = await G.evaluate(() => window.skyCrew.state().me);
    const hostT = await H.evaluate(({ me, q }) => { window.skyCrew.teleport(me.x, me.y, me.z); window.skyCrew.lookAt(q.x, 0.7, q.z); return new Promise((r) => setTimeout(() => r(window.skyCrew.target()), 1500)); }, { me, q });
    await H.evaluate(() => window.skyCrew.teleport(0, 0, 8));
    // step closer (a player would): 0.6 m from their row
    await G.evaluate((q) => { window.skyCrew.teleport(0, 0, q.z + 0.6); window.skyCrew.lookAt(q.x, 0.7, q.z); }, q);
    for (let k = 0; k < 30 && !(t && t.kind === 'grabPax'); k++) { await sleep(150); t = await G.evaluate(() => window.skyCrew.target()); }
    console.log(`  · attempt ${i + 1}: no target ${(me.z - q.z).toFixed(2)} m from the row (host at the same pose: ${JSON.stringify(hostT)}); one step closer: ${t?.kind ?? 'none'}`);
  }
  if (!t || t.kind !== 'grabPax') { console.log(`  · attempt ${i + 1}: aim never settled on a passenger (target ${JSON.stringify(t)}, me ${JSON.stringify(await G.evaluate(() => window.skyCrew.state().me))}, pax guest ${JSON.stringify(await G.evaluate((id) => window.skyCrew.pax().find((p) => p.id === id), id))} host ${JSON.stringify(await H.evaluate((id) => window.skyCrew.pax().find((p) => p.id === id), id))})`); continue; }
  aimed++;
  await G.keyboard.press('KeyE');
  const gid = await G.waitForFunction(() => window.skyCrew.heldPax(), null, { timeout: 4000 }).then((h) => h.jsonValue()).catch(() => null);
  const hostOk = gid ? await H.waitForFunction((id) => window.skyCrew.pax().find((x) => x.id === id)?.state === 'carried', gid, { timeout: 8000 }).then(() => true).catch(() => false) : false;
  await sleep(2500); // past the guest's prediction window: the guest must still hold them (host agreed)
  const after = { g: await G.evaluate(() => window.skyCrew.heldPax()), h: gid ? await H.evaluate((id) => window.skyCrew.pax().find((x) => x.id === id), gid) : null };
  const good = !!gid && hostOk && after.g === gid && after.h?.state === 'carried';
  if (good) ok++;
  else bugs.push({ attempt: i + 1, target: t, gid, hostOk, after, toasts: await G.evaluate(() => window.__toasts), guestView: gid ? await G.evaluate((id) => window.skyCrew.pax().find((x) => x.id === id), gid) : null });
  console.log(`  · attempt ${i + 1}: aim ok, guest held ${gid}, host carried ${hostOk}, still held after 2.5 s ${after.g === gid && after.h?.state === 'carried'}`);
  // put them down again (E) and wait until both agree nobody is carried
  if (await G.evaluate(() => window.skyCrew.heldPax())) { await G.keyboard.press('KeyE'); await sleep(300); }
  await H.waitForFunction(() => !window.skyCrew.pax().some((x) => x.state === 'carried'), null, { timeout: 10000 }).catch(() => {});
  await G.waitForFunction(() => !window.skyCrew.heldPax(), null, { timeout: 10000 }).catch(() => {});
  await H.evaluate(() => window.skyCrew.debug.sitAll()); await sleep(1500);
}
check(aimed === N, `the guest's aim settled on a passenger in ${aimed}/${N} attempts`);
check(ok === aimed && aimed > 0 && !bugs.length, `every aimed pickup worked on both clients (${ok}/${aimed})${bugs.length ? ` FAILURES: ${JSON.stringify(bugs)}` : ''}`);
check(!errs.length, `no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
await browser.close();
console.log(fail.length ? `${fail.length} failed` : 'all passed'); process.exit(fail.length ? 1 : 0);
