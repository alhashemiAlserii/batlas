// Highcrag co-op client: website session -> short-lived game token -> /ws/highcrag room.
// Names shown to other climbers come from the server's check of that token, never from this client.
import { api } from '/js/common.js';

export class HNet extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.you = null;
    this.room = null;
    this.connecting = null;
  }
  get connected() { return !!this.ws && this.ws.readyState === 1 && !!this.you; }
  get inRoom() { return !!this.room; }

  static async me() {
    try { const m = await api('GET', '/api/me'); return m?.user || null; } catch { return null; }
  }

  connect() {
    if (this.connected) return Promise.resolve(this.you);
    if (this.connecting) return this.connecting;
    this.connecting = this._handshake().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async _handshake() {
    const { token } = await api('POST', '/api/game/token', { game: 'highcrag' });
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/highcrag`);
    this.ws = ws;
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('The co-op server did not answer.')), 8000);
        const fail = (e) => { clearTimeout(t); reject(e); };
        ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token }));
        ws.onerror = () => fail(new Error('Could not reach the co-op server.'));
        ws.onclose = (ev) => fail(new Error(ev.reason || 'The co-op server closed the connection.'));
        ws.onmessage = (ev) => {
          let m;
          try { m = JSON.parse(ev.data); } catch { return; }
          if (m.t === 'welcome') { clearTimeout(t); this.you = m.you; resolve(); }
          else if (m.t === 'maintenance') fail(new Error(m.message || 'Batlas is under maintenance.'));
          else if (m.t === 'error') fail(new Error(m.message || m.code));
        };
      });
    } catch (e) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try { ws.close(); } catch { /* ignore */ }
      if (this.ws === ws) { this.ws = null; this.you = null; }
      throw e;
    }
    ws.onerror = null;
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'room') this.room = { code: m.code, seed: m.seed };
      if (m.t === 'room_left') this.room = null;
      this.dispatchEvent(new CustomEvent('msg', { detail: m }));
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      const had = !!this.room;
      this.ws = null;
      this.you = null;
      this.room = null;
      this.dispatchEvent(new CustomEvent('close', { detail: { inRoom: had, reason: ev.reason } }));
    };
    return this.you;
  }

  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }

  // Resolves with the 'room' message, rejects on 'error' or timeout.
  request(msg) {
    return new Promise((resolve, reject) => {
      const on = (e) => {
        const m = e.detail;
        if (m.t === 'room') { done(); resolve(m); }
        else if (m.t === 'error') { done(); reject(new Error(m.message || m.code)); }
      };
      const closed = () => { done(); reject(new Error('Lost the connection to the co-op server.')); };
      const to = setTimeout(() => { done(); reject(new Error('Timed out.')); }, 8000);
      const done = () => { clearTimeout(to); this.removeEventListener('msg', on); this.removeEventListener('close', closed); };
      this.addEventListener('msg', on);
      this.addEventListener('close', closed);
      this.send(msg);
    });
  }
  create(seed) { return this.request({ t: 'create', seed }); }
  join(code) { return this.request({ t: 'join', code }); }
  leave() {
    this.send({ t: 'leave' });
    this.room = null;
  }
}
