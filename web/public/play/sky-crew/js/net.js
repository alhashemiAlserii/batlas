// Co-op networking: website session -> short-lived game token -> WebSocket room.
// The server verifies the token with the website; rank/name shown to others come from the server only.
import { api } from '/js/common.js';

export class Net extends EventTarget {
  constructor() { super(); this.ws = null; this.you = null; this.room = null; this.cid = null; this.queue = []; }
  get connected() { return !!this.ws && this.ws.readyState === 1 && !!this.you; }
  get isHost() { return !this.room || this.room.hostCid === this.cid; }
  get inRoom() { return !!this.room; }

  static async me() {
    try { const m = await api('GET', '/api/me'); return m?.user || null; } catch { return null; }
  }

  async connect() {
    const { token } = await api('POST', '/api/game/token', { game: 'sky-crew' });
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/sky-crew`);
    this.ws = ws;
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Game server did not answer.')), 8000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token }));
      ws.onerror = () => { clearTimeout(t); reject(new Error('Could not reach the game server.')); };
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.t === 'welcome') { clearTimeout(t); this.you = m.you; this.cid = m.you.cid; resolve(); }
        else if (m.t === 'error') { clearTimeout(t); reject(new Error(m.message || m.code)); }
        else if (m.t === 'maintenance') { clearTimeout(t); const e = new Error(m.message); e.maintenance = true; this.dispatchEvent(new CustomEvent('maintenance', { detail: m })); reject(e); }
      };
    });
    ws.onmessage = (ev) => this.onMsg(JSON.parse(ev.data));
    ws.onclose = (ev) => { this.room = null; this.dispatchEvent(new CustomEvent('close', { detail: { code: ev.code, reason: ev.reason } })); };
    return this.you;
  }

  onMsg(m) {
    if (m.t === 'room') { this.room = { code: m.code, hostCid: m.hostCid, pilotCid: m.pilotCid, weather: m.weather, players: m.players, locked: !!m.locked, hour: m.hour, config: m.config, hidden: m.you ? !!m.hidden : this.room?.hidden || false }; }
    if (m.t === 'room_left') this.room = null;
    this.dispatchEvent(new CustomEvent(m.t, { detail: m }));
    this.dispatchEvent(new CustomEvent('any', { detail: m }));
  }

  send(msg) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg)); }
  create() { this.send({ t: 'create' }); return this.waitFor('room', ['error', 'maintenance']); }
  join(code, { hidden = false } = {}) { this.send({ t: 'join', code, hidden }); return this.waitFor('room', ['error', 'maintenance']); }
  rooms() { this.send({ t: 'rooms' }); return this.waitFor('rooms', 'error'); }
  leave() { this.send({ t: 'leave' }); this.room = null; }
  admin(cmd, args) { this.send({ t: 'admin', cmd, args }); return this.waitFor('admin_ok', 'admin_denied'); }
  waitFor(okType, errType) {
    return new Promise((resolve, reject) => {
      const ok = (e) => { cleanup(); resolve(e.detail); };
      const bad = (e) => { cleanup(); reject(new Error(e.detail.reason || e.detail.message || e.detail.code)); };
      const errs = [errType || []].flat();
      const cleanup = () => { this.removeEventListener(okType, ok); for (const t of errs) this.removeEventListener(t, bad); };
      this.addEventListener(okType, ok);
      for (const t of errs) this.addEventListener(t, bad);
      setTimeout(() => { cleanup(); reject(new Error('Timed out.')); }, 8000);
    });
  }
}
