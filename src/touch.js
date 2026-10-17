/** Virtual joystick + look drag + context buttons (multi-touch via pointer events). */
export class TouchControls {
  constructor() {
    this.root = document.getElementById('touch');
    this.joyZone = document.getElementById('joy-zone');
    this.lookZone = document.getElementById('look-zone');
    this.base = document.getElementById('joy-base');
    this.knob = document.getElementById('joy-knob');
    this.joy = { x: 0, y: 0 };
    this.lookDX = 0; this.lookDY = 0;
    this.btn = { jump: false, sprint: false, interact: false, handbrake: false, horn: false, accel: false, brake: false, pause: false, camera: false };
    this.joyId = null; this.joyOrigin = { x: 0, y: 0 };
    this.lookId = null; this.lookLast = { x: 0, y: 0 };
    this.radius = 50;
    this.enabled = false;

    const jz = this.joyZone;
    jz.addEventListener('pointerdown', (e) => {
      if (this.joyId !== null) return;
      this.joyId = e.pointerId; this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.base.classList.remove('hidden');
      this.base.style.left = e.clientX + 'px'; this.base.style.top = e.clientY + 'px';
      this.knob.style.transform = 'translate(0,0)';
      jz.setPointerCapture(e.pointerId); e.preventDefault();
    });
    const joyMove = (e) => {
      if (e.pointerId !== this.joyId) return;
      let dx = e.clientX - this.joyOrigin.x, dy = e.clientY - this.joyOrigin.y;
      const l = Math.hypot(dx, dy);
      if (l > this.radius) { dx *= this.radius / l; dy *= this.radius / l; }
      this.knob.style.transform = `translate(${dx}px,${dy}px)`;
      this.joy.x = dx / this.radius; this.joy.y = -dy / this.radius;
    };
    const joyEnd = (e) => {
      if (e.pointerId !== this.joyId) return;
      this.joyId = null; this.joy.x = 0; this.joy.y = 0; this.base.classList.add('hidden');
    };
    jz.addEventListener('pointermove', joyMove);
    jz.addEventListener('pointerup', joyEnd);
    jz.addEventListener('pointercancel', joyEnd);

    const lz = this.lookZone;
    lz.addEventListener('pointerdown', (e) => {
      if (this.lookId !== null) return;
      this.lookId = e.pointerId; this.lookLast = { x: e.clientX, y: e.clientY };
      lz.setPointerCapture(e.pointerId); e.preventDefault();
    });
    lz.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      this.lookDX += e.clientX - this.lookLast.x; this.lookDY += e.clientY - this.lookLast.y;
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    const lookEnd = (e) => { if (e.pointerId === this.lookId) this.lookId = null; };
    lz.addEventListener('pointerup', lookEnd);
    lz.addEventListener('pointercancel', lookEnd);

    for (const b of this.root.querySelectorAll('.tbtn')) {
      const act = b.dataset.act; const toggle = b.dataset.toggle === '1';
      const down = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (toggle) { this.btn[act] = !this.btn[act]; b.classList.toggle('on', this.btn[act]); }
        else { this.btn[act] = true; b.classList.add('pressed'); }
        try { b.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      };
      const up = (e) => { e.preventDefault(); if (!toggle) { this.btn[act] = false; b.classList.remove('pressed'); } };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    document.getElementById('btn-pause').addEventListener('click', () => { this.btn.pause = true; });
    document.getElementById('btn-cam').addEventListener('click', () => { this.btn.camera = true; });
  }
  setEnabled(on) { this.enabled = on; this.root.classList.toggle('hidden', !on); }
  setMode(mode) {
    for (const set of this.root.querySelectorAll('.btn-set')) set.classList.toggle('hidden', set.dataset.mode !== mode);
    // release everything when switching context
    for (const k in this.btn) if (k !== 'sprint') this.btn[k] = false;
    for (const b of this.root.querySelectorAll('.tbtn.pressed')) b.classList.remove('pressed');
  }
  setPrompt(mode, text) {
    const b = this.root.querySelector(`.btn-set[data-mode="${mode}"] .tbtn[data-act="interact"]`);
    if (b) b.textContent = text;
  }
}
