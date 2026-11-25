/** Loading-page files. The studio itself is served on this same host by the worker. */
const DOOR = '/__door';

const PING_EVERY_MS = 2500;
const PING_TIMEOUT_MS = 8000;
const REVEAL_MS = 550;
const GIVE_UP_MS = 90000;
const SLIDE_MS = 4800;

const SLIDES = [
  { src: `${DOOR}/img/cabin.webp`, caption: 'Serve your passengers' },
  { src: `${DOOR}/img/cockpit.webp`, caption: 'Take the yoke' },
  { src: `${DOOR}/img/airport.webp`, caption: 'Harbor Field is boarding' },
  { src: `${DOOR}/img/storm.webp`, caption: 'Fly through the storm' },
  { src: `${DOOR}/img/birds.webp`, caption: 'Birds off the nose' },
  { src: `${DOOR}/img/landing.webp`, caption: 'Stick the landing' },
  { src: `${DOOR}/img/ramp.webp`, caption: 'Load the hold' },
  { src: `${DOOR}/img/cover.webp`, caption: 'Bring the crew' },
];

const LINES = [
  'Warming up the engines...',
  'Calling Harbor Field...',
  'Opening the cabin doors...',
  'Checking the runway lights...',
  'Boarding the crew...',
];

const started = performance.now();
let stopped = false;
let slide = 0;
let slideTimer = 0;
let lineTimer = 0;
let giveUpTimer = 0;

const firstPing = ping();

const slidesRoot = document.getElementById('slides');
const cap = document.getElementById('cap');
const count = document.getElementById('count');
const statusEl = document.getElementById('status');
const live = document.getElementById('live');
const bar = document.getElementById('bar');
const retry = document.getElementById('retry');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

SLIDES.forEach((item, i) => {
  const fig = document.createElement('div');
  fig.className = 'slide' + (i === 0 ? ' on' : '');
  const img = document.createElement('img');
  img.src = item.src;
  img.alt = '';
  img.width = 1280;
  img.height = 800;
  fig.append(img);
  slidesRoot.append(fig);
});

function setStatus(text) {
  statusEl.textContent = text;
}

function ready() {
  if (stopped) return;
  stopped = true;
  clearTimeout(giveUpTimer);
  clearInterval(slideTimer);
  clearInterval(lineTimer);
  setStatus('Ready');
  live.textContent = 'Ready. Opening Batlas.';
  bar.style.transform = 'scaleX(1)';
  // Stay on this host. The worker serves the real page once /healthz is ok.
  location.replace(location.pathname + location.search + location.hash);
}

function showSlide(next) {
  const nodes = slidesRoot.querySelectorAll('.slide');
  nodes.forEach((el, n) => {
    el.classList.toggle('under', n === slide && n !== next);
    el.classList.toggle('on', n === next);
  });
  slide = next;
  cap.textContent = SLIDES[next].caption;
  count.textContent = `${next + 1} / ${SLIDES.length}`;
}

function startShow() {
  if (slideTimer) return;
  slideTimer = setInterval(() => {
    if (document.hidden) return;
    showSlide((slide + 1) % SLIDES.length);
  }, reduceMotion ? 7000 : SLIDE_MS);
  let line = 0;
  lineTimer = setInterval(() => {
    if (stopped || document.hidden) return;
    line = (line + 1) % LINES.length;
    setStatus(LINES[line]);
  }, 3400);
}

function startProgress() {
  const tick = () => {
    if (stopped) return;
    const t = Math.min(1, (performance.now() - started) / GIVE_UP_MS);
    const eased = 1 - (1 - t) ** 1.35;
    bar.style.transform = `scaleX(${Math.min(0.92, eased)})`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function showRetry() {
  if (stopped) return;
  retry.hidden = false;
  setStatus('The studio is taking a minute.');
  live.textContent = 'This is taking a while. Keep waiting, or try again.';
}

async function ping() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
  try {
    const res = await fetch('/healthz', {
      method: 'GET',
      mode: 'same-origin',
      cache: 'no-store',
      credentials: 'omit',
      signal: ctrl.signal,
    });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function cycle() {
  if (stopped) return;
  const ok = await ping();
  if (stopped) return;
  if (ok) ready();
  else setTimeout(cycle, PING_EVERY_MS);
}

giveUpTimer = setTimeout(showRetry, GIVE_UP_MS);

setTimeout(() => {
  if (stopped) return;
  document.body.classList.remove('hold');
  startShow();
  startProgress();
}, REVEAL_MS);

firstPing.then((ok) => {
  if (ok) ready();
  else setTimeout(cycle, PING_EVERY_MS);
});

retry.addEventListener('click', () => {
  if (stopped) return;
  setStatus('Trying the runway again...');
  live.textContent = 'Trying again.';
  clearTimeout(giveUpTimer);
  giveUpTimer = setTimeout(showRetry, GIVE_UP_MS);
  ping().then((ok) => { if (ok) ready(); });
});
