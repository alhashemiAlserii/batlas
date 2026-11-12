import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { setup } from './helpers.js';
import { WEB_ROOT } from '../src/config.js';

const PUB = path.join(WEB_ROOT, 'public');
/** Names and product patterns that belong to the reference, not Batlas. */
const BORROWED = [/Atlas Archive/i, /Atlas Command/i, /AtlasSync/i, /How to Fish/i, /Backrooms/i, /Claude Council/i, /Early Access/i];

describe('editorial Batlas shell', () => {
  it('keeps the dark editorial grammar, Batlas copy, and the account and play controls', () => {
    const css = fs.readFileSync(path.join(PUB, 'css/site.css'), 'utf8');
    const fonts = fs.readFileSync(path.join(PUB, 'css/fonts.css'), 'utf8');
    const game = fs.readFileSync(path.join(PUB, 'play/sky-crew/game.css'), 'utf8');
    const home = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
    const login = fs.readFileSync(path.join(PUB, 'login.html'), 'utf8');
    const sky = fs.readFileSync(path.join(PUB, 'play/sky-crew/index.html'), 'utf8');
    expect(css).toContain('#111316');
    expect(css).toContain('#eef0f2');
    expect(css).toContain('#1a1f25');
    expect(css).toContain('#f3f4f5');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).not.toMatch(/#020a24|#19d3e6/);
    expect(fonts).toContain('Barlow Condensed');
    expect(fonts).toContain('/fonts/barlow-condensed/latin-600-normal.woff2');
    expect(game).toContain('#111316');
    expect(game).toContain('#fhud');
    expect(game).toContain('#joy');
    expect(game).toContain('prefers-reduced-motion');
    expect(home).toContain('Bring the crew.');
    expect(home).toContain('id="hero-play"');
    expect(home).toContain('name="theme-color" content="#111316"');
    expect(login).toContain('name="login"');
    expect(login).toContain('name="pin"');
    expect(login).toContain('maxlength="6"');
    for (const id of ['bSolo', 'bCreate', 'bJoin', 'joinCode', 'menu', 'pause', 'lobby', 'settings', 'loading', 'hud', 'fhud']) {
      expect(sky, id).toContain(`id="${id}"`);
    }
    const owned = [css, fonts, game, home, login, sky,
      fs.readFileSync(path.join(PUB, 'js/common.js'), 'utf8'),
      fs.readFileSync(path.join(PUB, 'js/home.js'), 'utf8'),
      fs.readFileSync(path.join(PUB, 'js/game.js'), 'utf8'),
      fs.readFileSync(path.join(PUB, 'js/ui.js'), 'utf8')].join('\n');
    for (const re of BORROWED) expect(owned, re.source).not.toMatch(re);
    for (const weight of ['400', '500', '600', '700']) {
      const file = path.join(PUB, 'fonts/barlow-condensed', `latin-${weight}-normal.woff2`);
      expect(fs.readFileSync(file).subarray(0, 4).toString()).toBe('wOF2');
    }
  });
});

describe('editorial assets are served', () => {
  let env: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { env = await setup(); });
  afterAll(async () => { await env.close(); });

  it('serves the stylesheet and the self-hosted face', async () => {
    const css = await request(env.app).get('/css/site.css');
    expect(css.status).toBe(200);
    expect(css.text).toContain('#111316');
    expect((await request(env.app).get('/css/fonts.css')).status).toBe(200);
    const font = await request(env.app).get('/fonts/barlow-condensed/latin-600-normal.woff2');
    expect(font.status).toBe(200);
    expect(String(font.headers['content-type'])).toMatch(/font\/woff2|application\/octet-stream/);
    expect((await request(env.app).get('/play/sky-crew')).text).toContain('Preparing the aircraft');
  });
});
