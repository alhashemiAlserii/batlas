// Highcrag — the passport: an in-hand item at the airport. Using it opens a booklet with a live ID photo
// on the left page and the look options (tabs with 3D thumbnails and colour swatches) on the right page.
import * as THREE from '../../vendor/three.module.js';
import { WARDROBE, makeClimber, poseClimber, disposeClimber } from './characters.js';

const SEC = Object.fromEntries(WARDROBE.map((s) => [s.key, s]));
// Each tab: which look keys it edits, and how the 3D thumbnails are framed.
const TABS = [
  { id: 'skin', icon: '🎨', label: 'Skin', parts: ['s'], frame: 'head' },
  { id: 'face', icon: '🙂', label: 'Face', parts: ['f'], frame: 'face' },
  { id: 'hat', icon: '🎩', label: 'Hat', parts: ['h'], frame: 'hat' },
  { id: 'top', icon: '👕', label: 'Top', parts: ['t', 'c'], frame: 'top' },
  { id: 'bottoms', icon: '👖', label: 'Bottoms', parts: ['b', 'bc'], frame: 'legs' },
  { id: 'shoes', icon: '🥾', label: 'Shoes', parts: ['sh'], frame: 'feet' },
  { id: 'extra', icon: '👓', label: 'Extras', parts: ['a'], frame: 'neck' },
];
const hex = (v) => `#${v.toString(16).padStart(6, '0')}`;
const GL_SIZE = 320;

export class Passport {
  constructor({ getLook, setLook, randomLook, sfx, store }) {
    this.getLook = getLook;
    this.setLook = setLook;
    this.randomLook = randomLook;
    this.sfx = sfx;
    this.store = store;
    this.el = document.getElementById('passport');
    this.tab = TABS[2];
    this.open_ = false;
    this.queue = [];
    this.cache = new Map();
    this.photoModel = null;
    this.photoT = 0;
    this.gl = null;
    this.no = store.get('passportNo', null);
    if (!this.no) { this.no = `HC${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`; store.set('passportNo', this.no); }
    const d = new Date();
    this.issued = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
    this.yymmdd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    this.photo = document.getElementById('ppCanvas');
    this.buildTabs();
    document.getElementById('ppRandom').addEventListener('click', () => { this.setLook(this.randomLook()); this.sfx.click(); });
    document.getElementById('ppDone').addEventListener('click', () => this.onDone?.());
  }

  get isOpen() { return this.open_; }

  open(name) {
    this.name = (name || 'Climber').slice(0, 24);
    document.getElementById('ppName').textContent = this.name;
    document.getElementById('ppSign').textContent = this.name;
    document.getElementById('ppNo').textContent = this.no;
    document.getElementById('ppDate').textContent = this.issued;
    const clean = this.name.toUpperCase().normalize('NFD').replace(/[^A-Z0-9]+/g, '<').replace(/^<+|<+$/g, '') || 'CLIMBER';
    const l1 = `P<HCG${clean}<<EXPEDITION`.padEnd(44, '<').slice(0, 44);
    const l2 = `${this.no}<4HCG${this.yymmdd}7<ISLAND<BOUND`.padEnd(44, '<').slice(0, 44);
    document.getElementById('ppMrz').textContent = `${l1}\n${l2}`;
    this.el.classList.remove('hidden', 'closing');
    this.el.querySelector('.pp-stamp').classList.remove('hit');
    this.open_ = true;
    this.ensureGl();
    this.refresh();
  }

  close() {
    this.open_ = false;
    this.queue.length = 0;
    this.el.classList.add('hidden');
  }

  /** Stamp the page, then close (the Done button). */
  stampAndClose(done) {
    const st = this.el.querySelector('.pp-stamp');
    st.classList.remove('hit');
    void st.offsetWidth;
    st.classList.add('hit');
    this.sfx.piton?.();
    this.el.classList.add('closing');
    setTimeout(() => { this.close(); done?.(); }, 520);
  }

  buildTabs() {
    const wrap = document.getElementById('ppTabs');
    wrap.replaceChildren();
    for (const t of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pp-tab';
      b.dataset.tab = t.id;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-label', t.label);
      b.title = t.label;
      b.innerHTML = `<span>${t.icon}</span><small>${t.label}</small>`;
      b.addEventListener('click', () => { this.tab = t; this.sfx.click(); this.renderTab(); });
      wrap.appendChild(b);
    }
  }

  /** The look changed (or the passport just opened): redraw the options and the photo. */
  refresh() {
    if (!this.open_) return;
    this.renderTab();
    this.rebuildPhoto();
  }

  renderTab() {
    const look = this.getLook();
    document.querySelectorAll('#ppTabs .pp-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab.id));
    const grid = document.getElementById('ppGrid');
    grid.replaceChildren();
    this.queue.length = 0;
    for (const key of this.tab.parts) {
      const sec = SEC[key];
      const label = document.createElement('div');
      label.className = 'pp-label';
      label.textContent = sec.label;
      const row = document.createElement('div');
      row.className = sec.type === 'color' ? 'pp-swatches' : 'pp-tiles';
      sec.items.forEach((v, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        const on = look[key] === i;
        if (sec.type === 'color') {
          b.className = 'pp-sw' + (on ? ' on' : '');
          b.style.background = hex(v);
          const name = sec.names ? sec.names[i] : `${sec.label} ${i + 1}`;
          b.title = name;
          b.setAttribute('aria-label', name);
        } else {
          b.className = 'pp-tile' + (on ? ' on' : '');
          b.title = v;
          const c = document.createElement('canvas');
          c.width = c.height = 152;
          const s = document.createElement('span');
          s.textContent = v;
          b.append(c, s);
          this.queue.push({ canvas: c, look: { ...look, [key]: i }, frame: this.tab.frame });
        }
        b.setAttribute('aria-pressed', String(on));
        b.addEventListener('click', () => {
          if (this.getLook()[key] === i) return;
          this.setLook({ ...this.getLook(), [key]: i });
          this.sfx.click();
        });
        row.appendChild(b);
      });
      grid.append(label, row);
    }
    // Draw cached thumbnails straight away; the rest render a couple per frame.
    this.queue = this.queue.filter((j) => !this.drawCached(j));
  }

  ensureGl() {
    if (this.gl !== null) return;
    try {
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      r.setPixelRatio(1);
      r.setSize(GL_SIZE, GL_SIZE, false);
      r.setClearColor(0x000000, 0);
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.15;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xfff8ee, 0x9a8466, 2.2));
      const key = new THREE.DirectionalLight(0xfff0dc, 2.8);
      key.position.set(1.6, 2.6, 3);
      const fill = new THREE.DirectionalLight(0xcfe0ff, 0.9);
      fill.position.set(-2.4, 1.2, 1.5);
      const rim = new THREE.DirectionalLight(0xffffff, 1.2);
      rim.position.set(0, 2, -3);
      scene.add(key, fill, rim);
      const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
      this.gl = { r, scene, cam };
    } catch {
      this.gl = false;
    }
  }

  /** Point the camera at part of a posed climber. */
  frameOn(model, frame) {
    const U = model.userData;
    model.updateMatrixWorld(true);
    const head = U.head.getWorldPosition(new THREE.Vector3());
    const hips = U.hips.getWorldPosition(new THREE.Vector3());
    const foot = U.legL.foot.getWorldPosition(new THREE.Vector3()).add(U.legR.foot.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
    let target, dist, az = 0.55, el = 0.12, fov = 30;
    // The head group sits at the base of the head: the face is ~0.2 m above it, tall hats reach ~0.75 m.
    if (frame === 'photo') { target = head.clone().add(new THREE.Vector3(0, 0.16, 0)); dist = 2.15; az = 0.22; el = 0.06; fov = 26; }
    else if (frame === 'head' || frame === 'face') { target = head.clone().add(new THREE.Vector3(0, 0.2, 0)); dist = 1.15; az = frame === 'face' ? 0.3 : 0.5; }
    else if (frame === 'hat') { target = head.clone().add(new THREE.Vector3(0, 0.3, 0)); dist = 1.75; el = 0.18; }
    else if (frame === 'neck') { target = head.clone().add(new THREE.Vector3(0, 0.12, 0)); dist = 1.45; az = 0.45; }
    else if (frame === 'top') { target = hips.clone().lerp(head, 0.45); dist = 1.75; }
    else if (frame === 'legs') { target = hips.clone().lerp(foot, 0.45); dist = 1.75; el = 0.05; }
    else { target = foot.clone().add(new THREE.Vector3(0, 0.08, 0.04)); dist = 1.0; el = 0.3; az = 0.7; }
    const { cam } = this.gl;
    cam.fov = fov;
    cam.updateProjectionMatrix();
    cam.position.set(target.x + Math.sin(az) * dist * Math.cos(el), target.y + Math.sin(el) * dist, target.z + Math.cos(az) * dist * Math.cos(el));
    cam.lookAt(target);
  }

  renderModel(model, frame) {
    const { r, scene, cam } = this.gl;
    scene.add(model);
    this.frameOn(model, frame);
    r.render(scene, cam);
    scene.remove(model);
    return r.domElement;
  }

  drawCached(job) {
    const k = job.frame + JSON.stringify(job.look);
    const img = this.cache.get(k);
    if (!img) return false;
    tileBackdrop(job.canvas).drawImage(img, 0, 0, job.canvas.width, job.canvas.height);
    return true;
  }

  renderJob(job) {
    if (!job.canvas.isConnected || this.drawCached(job)) return;
    const model = makeClimber(job.look, { shadows: false, outline: true });
    poseClimber(model, 'ground', 0, 0, 0.016, 0);
    const src = this.renderModel(model, job.frame);
    const copy = document.createElement('canvas');
    copy.width = copy.height = 152;
    copy.getContext('2d').drawImage(src, 0, 0, 152, 152);
    disposeClimber(model);
    const k = job.frame + JSON.stringify(job.look);
    this.cache.set(k, copy);
    if (this.cache.size > 240) this.cache.delete(this.cache.keys().next().value);
    tileBackdrop(job.canvas).drawImage(copy, 0, 0, job.canvas.width, job.canvas.height);
  }

  rebuildPhoto() {
    if (this.photoModel) { disposeClimber(this.photoModel); this.photoModel = null; }
    if (!this.gl) { this.drawNoPhoto(); return; }
    this.photoModel = makeClimber(this.getLook(), { shadows: false, outline: true });
    this.photoT = 1;
  }

  drawNoPhoto() {
    const x = this.photo.getContext('2d');
    photoBackdrop(x, this.photo.width, this.photo.height);
    x.font = '90px system-ui';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('🧗', this.photo.width / 2, this.photo.height / 2);
  }

  /** Called every frame while open: animate the photo and render a few thumbnails. */
  update(dt) {
    if (!this.open_ || !this.gl) return;
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < 10) this.renderJob(this.queue.shift());
    this.photoT += dt;
    if (this.photoModel && this.photoT > 1 / 24) {
      poseClimber(this.photoModel, 'ground', 0, 0, this.photoT, 0);
      this.photoT = 0;
      const src = this.renderModel(this.photoModel, 'photo');
      const w = this.photo.width, h = this.photo.height;
      const x = this.photo.getContext('2d');
      photoBackdrop(x, w, h);
      const sw = GL_SIZE * (w / h);
      x.drawImage(src, (GL_SIZE - sw) / 2, 0, sw, GL_SIZE, 0, 0, w, h);
    }
  }
}

function tileBackdrop(c) {
  const x = c.getContext('2d');
  const g = x.createRadialGradient(c.width / 2, c.height * 0.42, 6, c.width / 2, c.height / 2, c.width * 0.7);
  g.addColorStop(0, '#fffaf0');
  g.addColorStop(1, '#ecdcbc');
  x.fillStyle = g;
  x.fillRect(0, 0, c.width, c.height);
  return x;
}
function photoBackdrop(x, w, h) {
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#dfe9f2');
  g.addColorStop(1, '#b9c9d8');
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
}
