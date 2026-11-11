import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setup, PW } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
let dev: any, admin: any, trusted: any, player: any, player2: any;
beforeAll(async () => {
  env = await setup();
  dev = await env.user('DEVELOPER');
  admin = await env.user('ADMIN');
  trusted = await env.user('TRUSTED');
  player = await env.user('PLAYER');
  player2 = await env.user('PLAYER');
});
afterAll(async () => { await env.close(); });

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d2c3a20000000049454e44ae426082', 'hex');
/** Fake but correctly-sniffed MP4: ISO BMFF "ftyp" box header followed by patterned bytes. */
function mp4(size: number) {
  const b = Buffer.alloc(size);
  Buffer.from('000000206674797069736f6d0000020069736f6d69736f32617663316d703431', 'hex').copy(b, 0);
  for (let i = 32; i < size; i++) b[i] = i % 251;
  return b;
}
const binary = (r: request.Test) => r.buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
const send = (u: any, m: 'post' | 'patch' | 'put' | 'delete', url: string, body?: unknown) => u.agent[m](url).set('x-csrf-token', u.csrf).send(body as object);
const actions = async () => (await env.db('audit_logs').pluck('action')) as string[];

describe('database-backed media', () => {
  let videoUrl = '';
  const VID = mp4(5 * 1024 * 1024 + 123);

  it('only the Developer can upload; images and MP4 trailers are content-sniffed', async () => {
    for (const u of [player, trusted, admin]) {
      expect((await u.agent.post('/api/dev/media').set('x-csrf-token', u.csrf).attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })).status).toBe(403);
    }
    const img = await dev.agent.post('/api/dev/media').set('x-csrf-token', dev.csrf).attach('file', PNG, { filename: 'shot.png', contentType: 'image/png' });
    expect(img.status).toBe(201);
    expect(img.body.media).toMatchObject({ kind: 'image', contentType: 'image/png' });
    expect(img.body.media.url).toMatch(/^\/media\/\d+\.png$/);
    const bad = await dev.agent.post('/api/dev/media').set('x-csrf-token', dev.csrf).attach('file', Buffer.from('<html><script>alert(1)</script>'), { filename: 'x.mp4', contentType: 'video/mp4' });
    expect(bad.status).toBe(400);
    const v = await dev.agent.post('/api/dev/media').set('x-csrf-token', dev.csrf).attach('file', VID, { filename: 'trailer.mp4', contentType: 'video/mp4' });
    expect(v.status).toBe(201);
    expect(v.body.media.kind).toBe('video');
    videoUrl = v.body.media.url;
    expect(await actions()).toEqual(expect.arrayContaining(['media.upload.image', 'media.upload.video']));
  });

  it('enforces size caps: images 5 MB, trailers 40 MB', async () => {
    const bigImg = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    expect((await dev.agent.post('/api/dev/media').set('x-csrf-token', dev.csrf).attach('file', bigImg, { filename: 'big.png', contentType: 'image/png' })).status).toBe(413);
    const bigVid = mp4(40 * 1024 * 1024 + 1);
    expect((await dev.agent.post('/api/dev/media').set('x-csrf-token', dev.csrf).attach('file', bigVid, { filename: 'big.mp4', contentType: 'video/mp4' })).status).toBe(413);
  });

  it('serves with Content-Type, caching headers, ETag/304, HEAD and HTTP Range (iOS Safari)', async () => {
    const full = await binary(request(env.app).get(videoUrl));
    expect(full.status).toBe(200);
    expect(full.headers['content-type']).toBe('video/mp4');
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.headers['cache-control']).toContain('max-age=31536000');
    expect(Number(full.headers['content-length'])).toBe(VID.length);
    expect(Buffer.compare(full.body, VID)).toBe(0);

    // Safari's first probe
    const probe = await binary(request(env.app).get(videoUrl).set('Range', 'bytes=0-1'));
    expect(probe.status).toBe(206);
    expect(probe.headers['content-range']).toBe(`bytes 0-1/${VID.length}`);
    expect(Buffer.compare(probe.body, VID.subarray(0, 2))).toBe(0);

    const mid = await binary(request(env.app).get(videoUrl).set('Range', 'bytes=1048570-1048600'));
    expect(mid.status).toBe(206);
    expect(Buffer.compare(mid.body, VID.subarray(1048570, 1048601))).toBe(0);

    const open = await binary(request(env.app).get(videoUrl).set('Range', `bytes=${VID.length - 100}-`));
    expect(open.status).toBe(206);
    expect(open.body.length).toBe(100);

    const suffix = await binary(request(env.app).get(videoUrl).set('Range', 'bytes=-10'));
    expect(Buffer.compare(suffix.body, VID.subarray(VID.length - 10))).toBe(0);

    // large ranges are capped at 4 MB per response (allowed by RFC 9110; players request the rest)
    const big = await binary(request(env.app).get(videoUrl).set('Range', 'bytes=0-'));
    expect(big.status).toBe(206);
    expect(big.headers['content-range']).toBe(`bytes 0-${4 * 1024 * 1024 - 1}/${VID.length}`);

    expect((await request(env.app).get(videoUrl).set('Range', `bytes=${VID.length + 5}-`)).status).toBe(416);
    const head = await request(env.app).head(videoUrl);
    expect(head.status).toBe(200);
    expect(Number(head.headers['content-length'])).toBe(VID.length);
    expect((await request(env.app).get(videoUrl).set('If-None-Match', full.headers.etag)).status).toBe(304);
    expect((await request(env.app).get('/media/999999.mp4')).status).toBe(404);
  });

  it('lists and deletes media (Developer only, audit-logged)', async () => {
    const list = await dev.agent.get('/api/dev/media');
    expect(list.status).toBe(200);
    expect(list.body.media.length).toBeGreaterThanOrEqual(2);
    expect((await admin.agent.get('/api/dev/media')).status).toBe(403);
    const id = list.body.media[0].id;
    expect((await send(admin, 'delete', `/api/dev/media/${id}`)).status).toBe(403);
    expect((await send(dev, 'delete', `/api/dev/media/${id}`)).status).toBe(200);
    expect((await request(env.app).get(list.body.media[0].url)).status).toBe(404);
    expect(await actions()).toContain('media.delete');
  });
});

describe('game pages: trailers, release dates, settings, downloads', () => {
  let gameId = 0;
  it('stores trailer video/poster, YouTube link, release date and per-game settings', async () => {
    const c = await send(dev, 'post', '/api/dev/games', { slug: 'cloud-hop', title: 'Cloud Hop', status: 'upcoming', releaseDate: '2027-03-01', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', trailerVideo: '/media/1.mp4', trailerPoster: '/media/1.png', settings: { featured: true, playEnabled: false, maintenanceMessage: 'Back soon' } });
    expect(c.status).toBe(201);
    gameId = c.body.game.id;
    const g = (await request(env.app).get('/api/games/cloud-hop')).body.game;
    expect(g).toMatchObject({ status: 'upcoming', releaseDate: '2027-03-01', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', trailerVideo: '/media/1.mp4' });
    expect(g.settings).toMatchObject({ featured: true, playEnabled: false, maintenanceMessage: 'Back soon', showLeaderboard: true });
    // partial settings update merges
    const p = await send(dev, 'patch', `/api/dev/games/${gameId}`, { settings: { playEnabled: true } });
    expect(p.status).toBe(200);
    expect(p.body.game.settings).toMatchObject({ featured: true, playEnabled: true });
    expect((await send(dev, 'patch', `/api/dev/games/${gameId}`, { youtubeUrl: 'https://evil.example/x' })).status).toBe(400);
    expect((await send(dev, 'patch', `/api/dev/games/${gameId}`, { settings: { hacked: true } })).status).toBe(400);
    expect((await send(admin, 'patch', `/api/dev/games/${gameId}`, { settings: { featured: false } })).status).toBe(403);
    const list = (await request(env.app).get('/api/games')).body.games;
    expect(list[0].slug).toBe('cloud-hop'); // featured first
  });

  it('only offers Download when the file exists and downloads are enabled', async () => {
    await send(dev, 'post', `/api/dev/games/${gameId}/publish`, { status: 'published' });
    const get = async () => (await request(env.app).get('/api/games/cloud-hop')).body.game.download;
    expect(await get()).toBe('');
    await send(dev, 'patch', `/api/dev/games/${gameId}`, { downloadUrl: '/downloads/missing.zip' });
    expect(await get()).toBe('');
    await send(dev, 'patch', `/api/dev/games/${gameId}`, { downloadUrl: '/img/batlas-mark.png' }); // a real file under web/public
    expect(await get()).toBe('/img/batlas-mark.png');
    await send(dev, 'patch', `/api/dev/games/${gameId}`, { downloadUrl: '/media/424242.zip' });
    expect(await get()).toBe('');
    await send(dev, 'patch', `/api/dev/games/${gameId}`, { downloadUrl: 'https://cdn.example.com/cloud-hop.zip' });
    expect(await get()).toBe('https://cdn.example.com/cloud-hop.zip');
    await send(dev, 'patch', `/api/dev/games/${gameId}`, { settings: { downloadEnabled: false } });
    expect(await get()).toBe('');
  });

  it('publishes an update: version + changelog, optionally linked news on the game page', async () => {
    const v = await send(dev, 'post', `/api/dev/games/${gameId}/versions`, { version: '0.2.0', releasedAt: '2026-11-01', changelog: '- New clouds' });
    expect(v.status).toBe(201);
    const n = await send(dev, 'post', '/api/dev/news', { slug: 'cloud-hop-0-2', title: 'Cloud Hop 0.2', status: 'published', gameId });
    expect(n.status).toBe(201);
    expect((await send(dev, 'post', '/api/dev/news', { slug: 'bad-game', title: 'x', gameId: 99999 })).status).toBe(400);
    const g = (await request(env.app).get('/api/games/cloud-hop')).body.game;
    expect(g.latestVersion.version).toBe('0.2.0');
    expect(g.news.map((x: any) => x.slug)).toContain('cloud-hop-0-2');
  });
});

describe('site events (banner)', () => {
  it('Developer schedules/edits/cancels events; public sees only announced, unexpired ones', async () => {
    const now = Date.now();
    const body = { title: 'Double payout weekend', message: 'All flights pay x2', startsAt: new Date(now + 3600e3).toISOString(), endsAt: new Date(now + 7200e3).toISOString() };
    expect((await send(admin, 'post', '/api/dev/events', body)).status).toBe(403);
    expect((await send(player, 'post', '/api/dev/events', body)).status).toBe(403);
    expect((await send(dev, 'post', '/api/dev/events', { ...body, endsAt: body.startsAt })).status).toBe(400);
    const c = await send(dev, 'post', '/api/dev/events', body);
    expect(c.status).toBe(201);
    const future = await send(dev, 'post', '/api/dev/events', { ...body, title: 'Later', announceAt: new Date(now + 1800e3).toISOString() });
    expect(future.status).toBe(201);
    let pub = (await request(env.app).get('/api/events/active')).body.events.map((e: any) => e.title);
    expect(pub).toEqual(['Double payout weekend']);
    expect((await send(dev, 'patch', `/api/dev/events/${c.body.event.id}`, { cancelled: true })).status).toBe(200);
    pub = (await request(env.app).get('/api/events/active')).body.events;
    expect(pub).toHaveLength(0);
    expect((await send(dev, 'delete', `/api/dev/events/${future.body.event.id}`)).status).toBe(200);
    expect(await actions()).toEqual(expect.arrayContaining(['event.create', 'event.cancel', 'event.delete']));
  });
});

describe('online players & account management', () => {
  it('shows users seen in the last few minutes (Admin+), no rooms without a game server', async () => {
    await player.agent.get('/api/me');
    expect((await player.agent.get('/api/admin/online')).status).toBe(403);
    expect((await trusted.agent.get('/api/admin/online')).status).toBe(403);
    const r = await admin.agent.get('/api/admin/online');
    expect(r.status).toBe(200);
    expect(r.body.users.map((u: any) => u.username)).toEqual(expect.arrayContaining([player.username, admin.username]));
    expect(r.body.rooms).toBeNull();
    await env.db('users').where({ id: player2.id }).update({ last_seen_at: new Date(Date.now() - 30 * 60e3).toISOString() });
    const r2 = await dev.agent.get('/api/admin/online?minutes=5');
    expect(r2.body.users.map((u: any) => u.username)).not.toContain(player2.username);
    expect(r2.body.gameServer).toBe('not-attached');
  });

  it('includes live rooms for the Developer when the game server provider is attached', async () => {
    const { createApp } = await import('../src/app.js');
    const { app } = createApp(env.db, { cookieSecure: false }, { liveRooms: () => [{ code: 'ABCD', host: 'pilot', players: 2, max: 8, locked: false, route: 'CRP', phase: 'flight' }] });
    const agent = request.agent(app);
    const csrf = (await agent.get('/api/csrf')).body.csrfToken;
    await agent.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: dev.username, password: PW });
    const r = await agent.get('/api/admin/online');
    expect(r.body.rooms).toEqual([expect.objectContaining({ code: 'ABCD', players: 2 })]);
    expect(r.body.gameServer).toBe('online');
  });

  it('staff can reset a display name/bio, server-verified and audit-logged; Developer is protected', async () => {
    const ok = await send(admin, 'patch', `/api/admin/users/${player.id}/profile`, { displayName: 'Renamed', bio: '' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.displayName).toBe('Renamed');
    expect((await send(trusted, 'patch', `/api/admin/users/${player.id}/profile`, { displayName: 'x' })).status).toBe(403);
    expect((await send(admin, 'patch', `/api/admin/users/${dev.id}/profile`, { displayName: 'x' })).status).toBe(403);
    expect((await send(dev, 'patch', `/api/admin/users/${dev.id}/profile`, { displayName: 'x' })).status).toBe(403);
    expect((await send(admin, 'patch', `/api/admin/users/${player.id}/profile`, { role: 'DEVELOPER' })).status).toBe(400);
    expect(await actions()).toEqual(expect.arrayContaining(['player.profile_edit', 'player.profile_edit.denied']));
  });

  it('role rules: only the Developer grants Admin/Trusted/Developer; the Developer can never be demoted or banned', async () => {
    expect((await send(admin, 'put', `/api/admin/users/${player.id}/role`, { role: 'TRUSTED' })).status).toBe(403);
    expect((await send(dev, 'put', `/api/admin/users/${player.id}/role`, { role: 'TRUSTED' })).status).toBe(200);
    expect((await send(dev, 'put', `/api/admin/users/${player.id}/role`, { role: 'ADMIN' })).status).toBe(200);
    expect((await send(dev, 'put', `/api/admin/users/${player.id}/role`, { role: 'DEVELOPER' })).status).toBe(403); // needs password
    expect((await send(admin, 'put', `/api/admin/users/${dev.id}/role`, { role: 'PLAYER' })).status).toBe(403);
    expect((await send(admin, 'post', `/api/admin/users/${dev.id}/ban`, {})).status).toBe(403);
    expect((await send(dev, 'put', `/api/admin/users/${dev.id}/role`, { role: 'PLAYER' })).status).toBe(403);
    expect((await env.db('users').where({ id: dev.id }).first()).role).toBe('DEVELOPER');
    await send(dev, 'put', `/api/admin/users/${player.id}/role`, { role: 'PLAYER' });
  });

  it('records last_seen_at at most once a minute', async () => {
    await env.db('users').where({ id: player2.id }).update({ last_seen_at: null });
    await player2.agent.get('/api/me');
    const a = (await env.db('users').where({ id: player2.id }).first()).last_seen_at;
    expect(a).toBeTruthy();
    await player2.agent.get('/api/me');
    expect((await env.db('users').where({ id: player2.id }).first()).last_seen_at).toBe(a);
  });
});
