// Highcrag — all sound is synthesised with WebAudio (no audio files).
export class Sfx {
  constructor() {
    this.ctx = null;
    this.vol = 0.7;
  }
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.vol;
    this.master.connect(ctx.destination);
    // Looping noise buffer for wind and fire.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.wind = this.loop(400, 0.7);
    this.fire = this.loop(1800, 0.5, 'highpass');
    this.surf = this.loop(600, 0.4, 'lowpass');
    this.rumble = this.loop(70, 0.8, 'lowpass');
    this.engine = this.loop(140, 2.5);
    this.hum = this.loop(220, 0.6, 'lowpass');
    this.birdT = 0;
  }
  loop(freq, q, type = 'bandpass') {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return { f, g };
  }
  setVolume(v) {
    this.vol = v;
    if (this.master) this.master.gain.value = v;
  }
  // Zone beds: surf (beach), birds (jungle), wind (high), rumble (volcano), engine (flight), hum (terminal).
  zone({ surf = 0, birds = 0, rumble = 0, engine = 0, hum = 0 } = {}, dt = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const swell = 0.6 + 0.4 * Math.sin(t * 0.7);
    this.surf.g.gain.setTargetAtTime(surf * 0.22 * swell, t, 0.5);
    this.rumble.g.gain.setTargetAtTime(rumble * 0.45, t, 0.8);
    this.engine.g.gain.setTargetAtTime(engine * 0.5, t, 0.3);
    this.engine.f.frequency.setTargetAtTime(110 + engine * 90, t, 0.4);
    this.hum.g.gain.setTargetAtTime(hum * 0.05, t, 0.6);
    this.birdT -= dt;
    if (birds > 0.05 && this.birdT <= 0) {
      this.birdT = 0.8 + Math.random() * 2.5;
      const f = 1800 + Math.random() * 1800;
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) setTimeout(() => this.tone(f + Math.random() * 300, 0.09, 'sine', 0.05 * birds, 500), i * 110);
    }
  }
  ambience(wind, fire) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.wind.g.gain.setTargetAtTime(Math.min(0.5, wind), t, 0.4);
    this.wind.f.frequency.setTargetAtTime(300 + wind * 700, t, 0.5);
    this.fire.g.gain.setTargetAtTime(Math.min(0.25, fire), t, 0.3);
  }
  tone(freq, dur, type = 'sine', vol = 0.2, slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  burst(dur, freq, vol = 0.3) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }
  step() { this.burst(0.07, 900, 0.08); }
  grab() { this.burst(0.09, 2200, 0.12); }
  land(hard) { this.burst(hard ? 0.35 : 0.15, hard ? 300 : 600, hard ? 0.5 : 0.2); }
  pickup() { this.tone(660, 0.12, 'triangle', 0.15); this.tone(990, 0.15, 'triangle', 0.1); }
  eat() { this.burst(0.12, 1500, 0.15); setTimeout(() => this.burst(0.12, 1300, 0.15), 140); }
  piton() { this.tone(1800, 0.25, 'square', 0.06, -600); }
  ignite() { this.burst(0.8, 700, 0.35); this.tone(220, 0.8, 'sawtooth', 0.05, 200); }
  hurt() { this.tone(180, 0.3, 'sawtooth', 0.12, -90); }
  gust() { this.burst(1.6, 500, 0.35); }
  click() { this.tone(880, 0.05, 'square', 0.04); }
  win() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.5, 'triangle', 0.16), i * 160));
  }
  crash() { this.burst(2.5, 400, 0.9); this.burst(1.2, 2500, 0.4); this.tone(90, 2, 'sawtooth', 0.25, -60); }
  rope() { this.burst(0.25, 1200, 0.15); this.tone(320, 0.2, 'triangle', 0.06, -120); }
  flare() { this.burst(1.2, 3500, 0.25); this.tone(900, 0.6, 'sawtooth', 0.04, 600); }
  ding() { this.tone(988, 0.35, 'sine', 0.12); setTimeout(() => this.tone(784, 0.5, 'sine', 0.12), 260); }
  whoosh() { this.burst(0.5, 900, 0.25); }
  blackout() { this.tone(300, 1.2, 'sine', 0.2, -240); }
}
