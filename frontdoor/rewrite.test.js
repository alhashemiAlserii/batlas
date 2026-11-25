import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import door from './_worker.js';

const {
  PRODUCTION_UPSTREAM,
  buildUpstreamRequest,
  isTopLevelHtmlNavigation,
  isWebSocketUpgrade,
  rewriteOriginHeader,
  rewriteProxyResponse,
  rewriteReferer,
  rewriteSetCookie,
  rewriteUpstreamUrls,
} = door;

const PUBLIC = 'https://batlas-szpab.pages.dev';
const UPSTREAM = PRODUCTION_UPSTREAM;

describe('rewriteUpstreamUrls', () => {
  it('rewrites absolute, websocket, and protocol-relative studio URLs', () => {
    const text = [
      'https://batlas-2je9.onrender.com/play/sky-crew?room=ABCDE#seat',
      'http://batlas-2je9.onrender.com/login',
      'wss://batlas-2je9.onrender.com/ws/sky-crew',
      'ws://batlas-2je9.onrender.com/ws/highcrag',
      '//batlas-2je9.onrender.com/img/cover.jpg',
    ].join('\n');
    const out = rewriteUpstreamUrls(text, UPSTREAM, PUBLIC);
    assert.equal(out, [
      'https://batlas-szpab.pages.dev/play/sky-crew?room=ABCDE#seat',
      'https://batlas-szpab.pages.dev/login',
      'wss://batlas-szpab.pages.dev/ws/sky-crew',
      'wss://batlas-szpab.pages.dev/ws/highcrag',
      '//batlas-szpab.pages.dev/img/cover.jpg',
    ].join('\n'));
  });

  it('does not rewrite a longer host or an unrelated origin', () => {
    const text = 'https://batlas-2je9.onrender.com.evil.test/x https://example.com/y';
    assert.equal(rewriteUpstreamUrls(text, UPSTREAM, PUBLIC), text);
  });

  it('rewrites a local upstream and a leaked production URL onto the browser origin', () => {
    const out = rewriteUpstreamUrls('http://127.0.0.1:3000/play and https://batlas-2je9.onrender.com/news', 'http://127.0.0.1:3000', 'http://127.0.0.1:8788');
    assert.equal(out, 'http://127.0.0.1:8788/play and http://127.0.0.1:8788/news');
  });
});

describe('rewriteSetCookie', () => {
  it('strips Domain and keeps Secure, HttpOnly, and SameSite', () => {
    const raw = '__Host-sid=abc; Domain=batlas-2je9.onrender.com; Path=/; Secure; HttpOnly; SameSite=Lax';
    assert.equal(rewriteSetCookie(raw), '__Host-sid=abc; Path=/; Secure; HttpOnly; SameSite=Lax');
  });

  it('strips a domain attribute with any spacing and leaves a cookie value that contains the word Domain', () => {
    assert.equal(rewriteSetCookie('sid=Domain=kept; domain = .onrender.com; SameSite=Strict'), 'sid=Domain=kept; SameSite=Strict');
  });

  it('leaves a host-only cookie unchanged apart from spacing', () => {
    assert.equal(rewriteSetCookie('__Host-csrf=tok; Path=/; Secure; SameSite=Strict'), '__Host-csrf=tok; Path=/; Secure; SameSite=Strict');
  });
});

describe('request headers', () => {
  it('rewrites Host, Origin, and Referer and records the public host', () => {
    const request = new Request('https://batlas-szpab.pages.dev/play/sky-crew?room=ABCDE', {
      method: 'POST',
      headers: {
        origin: PUBLIC,
        referer: `${PUBLIC}/login`,
        cookie: '__Host-sid=abc',
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.8',
      },
      body: '{"login":"ada"}',
    });
    const built = buildUpstreamRequest(request, UPSTREAM);
    assert.equal(built.url, `${UPSTREAM}/play/sky-crew?room=ABCDE`);
    assert.equal(built.headers.get('host'), 'batlas-2je9.onrender.com');
    assert.equal(built.headers.get('origin'), UPSTREAM);
    assert.equal(built.headers.get('referer'), `${UPSTREAM}/login`);
    assert.equal(built.headers.get('x-forwarded-host'), 'batlas-szpab.pages.dev');
    assert.equal(built.headers.get('x-forwarded-proto'), 'https');
    assert.equal(built.headers.get('x-forwarded-for'), '203.0.113.8');
    assert.equal(built.headers.get('cookie'), '__Host-sid=abc');
    assert.equal(rewriteOriginHeader('https://evil.example', PUBLIC, UPSTREAM), 'https://evil.example');
    assert.equal(rewriteReferer('https://evil.example/phish', PUBLIC, UPSTREAM), 'https://evil.example/phish');
  });
});

describe('response rewriting', () => {
  it('rewrites Location and a JSON body, and strips Domain from every Set-Cookie', async () => {
    const response = new Response(JSON.stringify({ next: `${UPSTREAM}/play/sky-crew`, ok: true }), {
      status: 302,
      headers: [
        ['content-type', 'application/json'],
        ['location', `${UPSTREAM}/login?next=%2Fplay%2Fsky-crew`],
        ['set-cookie', '__Host-sid=abc; Domain=batlas-2je9.onrender.com; Path=/; Secure; HttpOnly; SameSite=Lax'],
        ['set-cookie', '__Host-csrf=tok; Domain=.onrender.com; Path=/; Secure; SameSite=Strict'],
      ],
    });
    const out = await rewriteProxyResponse(response, UPSTREAM, PUBLIC);
    assert.equal(out.status, 302);
    assert.equal(out.headers.get('location'), `${PUBLIC}/login?next=%2Fplay%2Fsky-crew`);
    const cookies = out.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    assert.equal(cookies[0].toLowerCase().includes('domain='), false);
    assert.match(cookies[0], /Secure/);
    assert.match(cookies[0], /HttpOnly/);
    assert.match(cookies[0], /SameSite=Lax/);
    assert.match(cookies[1], /SameSite=Strict/);
    assert.equal(cookies[1].toLowerCase().includes('domain='), false);
    const body = await out.json();
    assert.equal(body.next, `${PUBLIC}/play/sky-crew`);
  });

  it('leaves a relative Location and a binary body alone', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const response = new Response(bytes, { status: 200, headers: { 'content-type': 'image/png', location: '/games' } });
    const out = await rewriteProxyResponse(response, UPSTREAM, PUBLIC);
    assert.equal(out.headers.get('location'), '/games');
    const buf = new Uint8Array(await out.arrayBuffer());
    assert.deepEqual([...buf], [1, 2, 3, 4]);
  });
});

describe('navigation detection', () => {
  it('treats document navigations as HTML and leaves fetch and websocket upgrades alone', () => {
    const page = new Request('https://batlas-szpab.pages.dev/play/sky-crew', { headers: { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' } });
    const api = new Request('https://batlas-szpab.pages.dev/healthz', { headers: { accept: 'application/json', 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors' } });
    const oldBrowser = new Request('https://batlas-szpab.pages.dev/', { headers: { accept: 'text/html' } });
    const ws = new Request('https://batlas-szpab.pages.dev/ws/sky-crew', { headers: { upgrade: 'websocket', connection: 'Upgrade' } });
    assert.equal(isTopLevelHtmlNavigation(page), true);
    assert.equal(isTopLevelHtmlNavigation(oldBrowser), true);
    assert.equal(isTopLevelHtmlNavigation(api), false);
    assert.equal(isTopLevelHtmlNavigation(ws), false);
    assert.equal(isWebSocketUpgrade(ws), true);
    assert.equal(isWebSocketUpgrade(page), false);
  });
});
