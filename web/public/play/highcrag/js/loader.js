/*
 * Highcrag loading screen: progress bar, stage text and rotating tips while the game downloads and builds.
 * A classic (non-module) script so it runs before the game modules arrive. main.js reports real stages
 * through window.HCLoad.stage(text, fraction) and calls window.HCLoad.done() when the first frame is ready.
 */
(() => {
  const el = (id) => document.getElementById(id);
  const root = el('loading');
  if (!root) return;
  const fill = el('ldFill'), pct = el('ldPct'), stageEl = el('ldStage'), tipEl = el('ldTip');

  const TIPS = [
    'Hold <b>jump</b> to leap higher. A quick tap is a small hop.',
    'Climbing costs <b>stamina</b>. Catch your breath on ledges before it runs out.',
    'Light <b>campfires</b> on the way up. They warm the team and save your progress.',
    'Eat next to a lit campfire to <b>cook</b> your food. Cooked food is worth more.',
    'Everything you carry trims your stamina bar. Pack light.',
    'Rain in the Mossgrove makes the rock <b>slippery</b>. Climbing costs more.',
    'High on the mountain, listen for <b>falling rocks</b>.',
    'Big falls hurt. Use <b>ropes</b> and <b>pitons</b> on long walls.',
    'Use your <b>passport</b> at the airport to change your look.',
    'On iPhone and iPad, tap <b>🏃 Sprint</b> to run.',
    'A friend is down? Stand next to them and press <b>E</b> to help them up.',
    'Grab the <b>compass</b> from the wreck. It points to the next campfire.',
    'Light the <b>beacon</b> on the summit to be rescued.',
    'Roast food at a lit campfire with <b>E</b>. Once is great. Three times is burnt.',
    'Honeycomb gives <b>bonus stamina</b>: the gold part of the bar is spent first.',
    'In the <b>Red Canyon</b>, an umbrella in hand gives shade and coconuts cool you down.',
    'Puffball spores in the <b>Fungal Hollow</b> make you drowsy. Walk around them.',
    'Crouch (<b>X</b>) and a friend can jump off you to reach higher ledges.',
    'Earn <b>badges</b> as you climb. Some unlock new hats in your passport.',
  ];
  let tipI = Math.floor(Math.random() * TIPS.length);
  const showTip = () => { if (tipEl) tipEl.innerHTML = TIPS[tipI % TIPS.length]; };
  showTip();
  const tipTimer = setInterval(() => {
    if (!tipEl) return;
    tipEl.classList.add('fade');
    setTimeout(() => { tipI++; showTip(); tipEl.classList.remove('fade'); }, 350);
  }, 4200);

  // Shown progress eases toward the target; while the scripts download the target creeps toward 60%.
  let shown = 0, target = 0.04, creepTo = 0.6, finished = false, failed = false;
  const setStage = (t) => { if (stageEl && !failed) stageEl.textContent = t; };
  setStage('Packing your bag…');
  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!finished) target += (creepTo - target) * (1 - Math.exp(-0.35 * dt));
    shown += (target - shown) * (1 - Math.exp(-(finished ? 9 : 4) * dt));
    if (fill) fill.style.width = `${(shown * 100).toFixed(1)}%`;
    if (pct) pct.textContent = `${Math.round(shown * 100)}%`;
    if (finished && shown > 0.995) return end();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function end() {
    if (fill) fill.style.width = '100%';
    if (pct) pct.textContent = '100%';
    clearInterval(tipTimer);
    root.classList.add('out');
    setTimeout(() => root.classList.add('hidden'), 650);
  }

  // If the game fails to start, say so instead of leaving the bar stuck.
  function fail() {
    if (finished || failed) return;
    failed = true;
    root.classList.add('failed');
    if (stageEl) stageEl.textContent = 'The game could not start.';
    if (tipEl) {
      tipEl.textContent = '';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn primary';
      b.textContent = 'Reload';
      b.addEventListener('click', () => location.reload());
      tipEl.append('Check your connection and try again. ', b);
    }
    clearInterval(tipTimer);
  }
  // A game script that fails to download, or throws while starting up (other pages' or extensions' errors are ignored).
  addEventListener('error', (e) => {
    if (finished) return;
    const t = e.target;
    if (t && t.tagName === 'SCRIPT') return fail();
    if (typeof e.filename === 'string' && e.filename.indexOf('/play/highcrag/') >= 0) fail();
  }, true);
  const slow = setTimeout(() => setStage('Still loading… a slow connection can take a minute.'), 25000);

  window.HCLoad = {
    stage(text, frac) {
      setStage(text);
      if (typeof frac === 'number') { target = Math.max(target, frac); creepTo = Math.max(creepTo, Math.min(0.98, frac + 0.06)); }
    },
    done() {
      if (finished) return;
      finished = true;
      target = 1;
      clearTimeout(slow);
      setStage('Ready');
    },
    fail,
  };
})();
