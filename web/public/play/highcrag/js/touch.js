// Highcrag — touch controls for phones and tablets.
// Left thumb: a floating joystick that appears where you touch (push to the edge to run).
// Right thumb: drag anywhere to look; big Jump and Grab (toggle) buttons plus smaller action buttons.
export class TouchControls {
  constructor({ onLook, onAct, onUse, onDrop, onEmote, onJump, onGrabToggle, onPing }) {
    this.move = { x: 0, y: 0 };
    this.grab = false;
    this.cb = { onLook, onAct, onUse, onDrop, onEmote, onJump, onGrabToggle, onPing };
    this.el = document.getElementById('touch');
    this.base = document.getElementById('joyBase');
    this.knob = document.getElementById('joyKnob');
    this.stick = null;
    this.look = null;
    const tablet = Math.min(screen.width, screen.height) >= 600;
    document.body.classList.add(tablet ? 'tablet' : 'phone');
    this.el.classList.remove('hidden');

    const left = document.getElementById('tLeft');
    const right = document.getElementById('tRight');
    left.addEventListener('pointerdown', (e) => this.stickStart(e));
    right.addEventListener('pointerdown', (e) => {
      if (this.look) return;
      this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
      right.setPointerCapture?.(e.pointerId);
    });
    const moveH = (e) => {
      if (this.stick && e.pointerId === this.stick.id) this.stickMove(e);
      else if (this.look && e.pointerId === this.look.id) {
        this.cb.onLook?.(e.clientX - this.look.x, e.clientY - this.look.y);
        this.look.x = e.clientX;
        this.look.y = e.clientY;
      }
    };
    const endH = (e) => {
      if (this.stick && e.pointerId === this.stick.id) this.stickEnd();
      if (this.look && e.pointerId === this.look.id) this.look = null;
    };
    for (const el of [left, right]) {
      el.addEventListener('pointermove', moveH);
      el.addEventListener('pointerup', endH);
      el.addEventListener('pointercancel', endH);
      el.addEventListener('lostpointercapture', endH);
    }

    const tap = (id, fn) => {
      const b = document.getElementById(id);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.classList.add('down');
        fn(b);
      });
      const up = () => b.classList.remove('down');
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    };
    tap('bJump', () => this.cb.onJump?.());
    tap('bGrab', () => this.setGrab(!this.grab, true));
    tap('bAct', () => this.cb.onAct?.());
    tap('bUse', () => this.cb.onUse?.());
    tap('bDrop', () => this.cb.onDrop?.());
    tap('bPing', () => this.cb.onPing?.());
    tap('bRun', (b) => { this.sprint = !this.sprint; b.classList.toggle('on', this.sprint); });
    tap('bEmote', () => this.cb.onEmote?.());
    // iOS: stop page scroll / zoom gestures on the game surface.
    // Stop one-finger page scrolling outside the menus (pinch and double-tap zoom are blocked in main.js).
    document.addEventListener('touchmove', (e) => { if (!e.target.closest?.('.overlay, #passport')) e.preventDefault(); }, { passive: false });
  }

  stickStart(e) {
    if (this.stick) return;
    this.stick = { id: e.pointerId, cx: e.clientX, cy: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    this.base.classList.add('active');
    this.base.style.left = `${e.clientX}px`;
    this.base.style.top = `${e.clientY}px`;
    this.knob.style.transform = 'translate(-50%, -50%)';
  }
  stickMove(e) {
    const R = this.base.offsetWidth * 0.42;
    let dx = (e.clientX - this.stick.cx) / R, dy = (e.clientY - this.stick.cy) / R;
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    this.move.x = dx;
    this.move.y = dy;
    this.knob.style.transform = `translate(calc(-50% + ${dx * R}px), calc(-50% + ${dy * R}px))`;
    this.base.classList.toggle('run', Math.hypot(dx, dy) > 0.9);
  }
  stickEnd() {
    this.stick = null;
    this.move.x = this.move.y = 0;
    this.base.classList.remove('active', 'run');
    this.base.style.left = '';
    this.base.style.top = '';
    this.knob.style.transform = 'translate(-50%, -50%)';
  }
  get running() { return this.sprint || Math.hypot(this.move.x, this.move.y) > 0.9; }

  setGrab(on, fromUser = false) {
    this.grab = on;
    document.getElementById('bGrab').classList.toggle('on', on);
    if (fromUser) this.cb.onGrabToggle?.(on);
  }
  setDrop(label) {
    const b = document.getElementById('bDrop');
    const txt = label || 'Drop';
    if (b.dataset.label !== txt) { b.dataset.label = txt; b.querySelector('small').textContent = txt; }
    b.classList.toggle('lit', !!label);
  }
  setAct(label) {
    const b = document.getElementById('bAct');
    const txt = label || 'E';
    if (b.dataset.label !== txt) { b.dataset.label = txt; b.querySelector('small').textContent = label || 'Interact'; }
    b.classList.toggle('lit', !!label);
  }
}
