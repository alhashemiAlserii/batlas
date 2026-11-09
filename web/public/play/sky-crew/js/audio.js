// Procedural sound: everything is synthesised with WebAudio (no audio files).
// iOS/Safari: the AudioContext is created/resumed on the first tap or key press (unlock()).
const LS = 'skycrew.audio';
export class Audio {
  constructor() {
    const saved = JSON.parse(localStorage.getItem(LS) || '{}');
    this.vol = { master: saved.master ?? 0.8, music: saved.music ?? 0.5, sfx: saved.sfx ?? 0.8 };
    this.ctx = null; this.loops = {}; this.musicOn = false; this.state = {};
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'touchend', 'keydown', 'mousedown']) addEventListener(ev, unlock, { capture: true, passive: true });
  }
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch { return; }
      const c = this.ctx;
      this.master = c.createGain(); this.master.connect(c.destination);
      this.musicBus = c.createGain(); this.musicBus.connect(this.master);
      this.sfxBus = c.createGain(); this.sfxBus.connect(this.master);
      this.applyVolume();
      // a silent buffer played inside the gesture unlocks iOS output
      const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);
      this.noise = this.makeNoise();
      this.buildLoops();
      if (this.wantMusic) this.startMusic();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }
  get ready() { return !!this.ctx && this.ctx.state === 'running'; }
  setVolume(k, v) { this.vol[k] = v; localStorage.setItem(LS, JSON.stringify(this.vol)); this.applyVolume(); }
  applyVolume() { if (!this.ctx) return; const t = this.ctx.currentTime; this.master.gain.setTargetAtTime(this.vol.master, t, 0.05); this.musicBus.gain.setTargetAtTime(this.vol.music * 0.5, t, 0.05); this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05); }
  makeNoise() {
    const c = this.ctx, len = c.sampleRate * 2, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.5 + last * 3; }
    return b;
  }
  noiseSrc() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; return s; }
  /** Continuous layers whose gains are driven every frame by update(). */
  buildLoops() {
    const c = this.ctx;
    const mk = (type, freq, filterType, cutoff, q = 0.7) => {
      const g = c.createGain(); g.gain.value = 0; g.connect(this.sfxBus);
      const f = c.createBiquadFilter(); f.type = filterType; f.frequency.value = cutoff; f.Q.value = q; f.connect(g);
      let src;
      if (type === 'noise') { src = this.noiseSrc(); src.connect(f); src.start(); }
      else { src = c.createOscillator(); src.type = type; src.frequency.value = freq; src.connect(f); src.start(); }
      return { g, f, src };
    };
    this.loops.hum1 = mk('sawtooth', 55, 'lowpass', 300);
    this.loops.hum2 = mk('sawtooth', 82.5, 'lowpass', 400);
    this.loops.whine = mk('triangle', 900, 'bandpass', 1200, 4);
    this.loops.roar = mk('noise', 0, 'lowpass', 600);
    this.loops.air = mk('noise', 0, 'lowpass', 420);
    this.loops.rain = mk('noise', 0, 'highpass', 2500);
    this.loops.wind = mk('noise', 0, 'bandpass', 700, 0.6);
  }
  /** Per-frame: engines follow throttle/speed, ambience follows where you are and the weather. */
  update(s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, L = this.loops, k = 0.12;
    const run = s.engines ? 1 : 0;
    const thr = s.throttle * run, spd = Math.min(1, s.speed / 90);
    const inside = s.inside ? 0.55 : 1;
    L.hum1.g.gain.setTargetAtTime((0.03 + thr * 0.09) * run * inside, t, k);
    L.hum1.src.frequency.setTargetAtTime(48 + thr * 40, t, k);
    L.hum2.g.gain.setTargetAtTime((0.02 + thr * 0.05) * run * inside, t, k);
    L.hum2.src.frequency.setTargetAtTime(72 + thr * 60, t, k);
    L.whine.g.gain.setTargetAtTime((0.006 + thr * 0.02) * run * inside, t, k);
    L.whine.src.frequency.setTargetAtTime(700 + thr * 1500, t, k);
    const roar = run * thr * (s.onGround ? 0.35 + spd * 0.4 : 0.22);
    L.roar.g.gain.setTargetAtTime(roar * inside, t, 0.25);
    L.roar.f.frequency.setTargetAtTime(400 + thr * 1400, t, k);
    L.air.g.gain.setTargetAtTime(s.inside ? 0.035 + spd * 0.02 : 0, t, 0.3);
    L.rain.g.gain.setTargetAtTime(s.storm ? (s.inside ? 0.03 : 0.08) : 0, t, 0.4);
    L.wind.g.gain.setTargetAtTime((s.inside ? 0 : spd * 0.05) + (s.turb || 0) * 0.04, t, 0.3);
    if (s.storm && Math.random() < 0.002) this.thunder();
  }
  env(g, t0, a, peak, dec) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec); }
  tone(freq, dur, { type = 'sine', vol = 0.2, at = 0, to = null, bus = this.sfxBus, attack = 0.005 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t0 = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0); if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    o.connect(g); g.connect(bus); this.env(g, t0, attack, vol, dur); o.start(t0); o.stop(t0 + dur + attack + 0.05);
  }
  burst(dur, { vol = 0.2, type = 'lowpass', freq = 800, at = 0, q = 0.7 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t0 = c.currentTime + at, s = this.noiseSrc(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = type; f.frequency.value = freq; f.Q.value = q; s.connect(f); f.connect(g); g.connect(this.sfxBus);
    this.env(g, t0, 0.004, vol, dur); s.start(t0); s.stop(t0 + dur + 0.1);
  }
  play(name, opt = {}) {
    if (!this.ctx) return;
    switch (name) {
      case 'ding': this.tone(659, 1.4, { vol: 0.18, type: 'sine' }); this.tone(1318, 0.8, { vol: 0.04 }); this.tone(523, 1.8, { vol: 0.18, at: 0.45 }); this.tone(1046, 1.0, { vol: 0.04, at: 0.45 }); break;
      case 'click': this.tone(1800, 0.04, { type: 'square', vol: 0.04 }); break;
      case 'pickup': this.tone(420, 0.12, { type: 'triangle', vol: 0.12, to: 720 }); this.burst(0.08, { vol: 0.06, freq: 2500, type: 'bandpass' }); break;
      case 'drop': this.tone(140, 0.18, { vol: 0.25, to: 55 }); this.burst(0.12, { vol: 0.12, freq: 500 }); break;
      case 'thump': { const v = Math.min(1, 0.4 + (opt.hard || 0)); this.tone(90, 0.5, { vol: 0.5 * v, to: 35 }); this.burst(0.35, { vol: 0.35 * v, freq: 300 }); this.burst(0.6, { vol: 0.08, freq: 3200, type: 'bandpass', q: 3, at: 0.05 }); break; }
      case 'crash': this.burst(1.6, { vol: 0.6, freq: 500 }); this.tone(70, 1.4, { vol: 0.5, to: 25 }); break;
      case 'warn': for (let i = 0; i < 3; i++) this.tone(880, 0.18, { type: 'square', vol: 0.06, at: i * 0.32 }); break;
      case 'gear': this.burst(1.2, { vol: 0.1, freq: 250 }); this.tone(60, 1.2, { vol: 0.12, type: 'sawtooth' }); this.tone(110, 0.15, { vol: 0.2, at: 1.15 }); break;
      case 'door': this.burst(0.5, { vol: 0.12, freq: 900, type: 'bandpass' }); this.tone(180, 0.2, { vol: 0.15, at: 0.45, to: 90 }); break;
      case 'splash': this.burst(0.9, { vol: 0.3, freq: 1800, type: 'bandpass', q: 0.5 }); break;
      case 'serve': this.tone(784, 0.2, { vol: 0.1 }); this.tone(988, 0.3, { vol: 0.1, at: 0.12 }); break;
      case 'fix': this.tone(523, 0.15, { vol: 0.1, type: 'triangle' }); this.tone(659, 0.15, { vol: 0.1, type: 'triangle', at: 0.12 }); this.tone(784, 0.3, { vol: 0.1, type: 'triangle', at: 0.24 }); break;
    }
  }
  thunder() { this.burst(2.5, { vol: 0.35, freq: 160, at: 0.2 + Math.random() }); }
  // ---------- menu music: soft pads + arpeggio, scheduled in a 16-beat loop ----------
  startMusic() {
    this.wantMusic = true;
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    const c = this.ctx, bpm = 84, beat = 60 / bpm;
    const chords = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 66]]; // Am7 Fmaj7 Cmaj7 G(add)
    const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
    let bar = 0, next = c.currentTime + 0.1;
    const schedule = () => {
      if (!this.musicOn) return;
      while (next < c.currentTime + 1.5) {
        const ch = chords[bar % 4];
        for (const n of ch) this.tone(midi(n), beat * 4, { vol: 0.035, type: 'triangle', at: next - c.currentTime, bus: this.musicBus, attack: 0.6 });
        this.tone(midi(ch[0] - 12), beat * 4, { vol: 0.06, type: 'sine', at: next - c.currentTime, bus: this.musicBus, attack: 0.05 });
        for (let i = 0; i < 8; i++) { const n = ch[[0, 1, 2, 3, 2, 1, 2, 3][i]] + 12; this.tone(midi(n), beat * 0.45, { vol: 0.03, type: 'sine', at: next - c.currentTime + i * beat * 0.5, bus: this.musicBus }); }
        next += beat * 4; bar++;
      }
      this.musicTimer = setTimeout(schedule, 500);
    };
    schedule();
  }
  stopMusic() { this.wantMusic = false; this.musicOn = false; clearTimeout(this.musicTimer); }
}
