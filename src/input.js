import { clamp } from './util.js';
import { TouchControls } from './touch.js';

const BUTTONS = ['jump', 'sprint', 'interact', 'handbrake', 'horn', 'pause', 'camera', 'fire', 'aim', 'weaponNext', 'weaponPrev'];

/** Unified input: keyboard+mouse, Gamepad API, touch. Produces one action state per frame. */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDown = false; this.mouseRight = false; this.wheel = 0;
    this.mouseDX = 0; this.mouseDY = 0;
    this.sensitivity = 1;
    this.invertY = false;
    this.gamepadIndex = -1;
    this.gamepadName = '';
    this.mode = 'foot';
    this.touch = new TouchControls();
    this.touchEnabled = false;
    this.s = this._blank();
    this.prev = this._blank();
    this.onPause = null;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Escape' && this.onPause) this.onPause();
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) { this.mouseDown = true; if (!this.touchEnabled && document.pointerLockElement !== canvas) canvas.requestPointerLock?.(); } if (e.button === 2) this.mouseRight = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; if (e.button === 2) this.mouseRight = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas || this.mouseDown) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    });
    window.addEventListener('gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; this.gamepadName = e.gamepad.id; this.onGamepad?.(true, e.gamepad.id); });
    window.addEventListener('gamepaddisconnected', (e) => { if (e.gamepad.index === this.gamepadIndex) { this.gamepadIndex = -1; this.onGamepad?.(false); } });
  }
  _blank() {
    const o = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, accel: 0, brake: 0 };
    for (const b of BUTTONS) o[b] = false;
    return o;
  }
  setMode(mode) { this.mode = mode; this.touch.setMode(mode); }
  setTouchEnabled(on) { this.touchEnabled = on; this.touch.setEnabled(on); if (on && document.pointerLockElement) document.exitPointerLock?.(); }
  pressed(name) { return this.s[name] && !this.prev[name]; }
  released(name) { return !this.s[name] && this.prev[name]; }

  update(dt) {
    const p = this.prev; const s = this.s;
    Object.assign(p, s);
    for (const k in s) s[k] = typeof s[k] === 'boolean' ? false : 0;
    const K = (c) => this.keys.has(c);

    // --- keyboard / mouse
    let mx = 0, my = 0;
    if (K('KeyA') || K('ArrowLeft')) mx -= 1;
    if (K('KeyD') || K('ArrowRight')) mx += 1;
    if (K('KeyW') || K('ArrowUp')) my += 1;
    if (K('KeyS') || K('ArrowDown')) my -= 1;
    s.moveX += mx; s.moveY += my;
    if (my > 0) s.accel = 1; if (my < 0) s.brake = 1;
    s.lookX += this.mouseDX * 0.0022 * this.sensitivity;
    s.lookY += this.mouseDY * 0.0022 * this.sensitivity;
    this.mouseDX = 0; this.mouseDY = 0;
    if (K('Space')) { s.jump = true; s.handbrake = true; }
    if (K('ShiftLeft') || K('ShiftRight')) s.sprint = true;
    if (K('KeyE') || K('KeyF') || K('Enter')) s.interact = true;
    if (K('KeyH')) s.horn = true;
    if (K('KeyC')) s.camera = true;
    if (this.mouseDown && document.pointerLockElement === this.canvas) s.fire = true;
    if (K('ControlLeft')) s.fire = true;
    if (this.mouseRight) s.aim = true;
    if (K('Tab') || K('KeyQ') || this.wheel > 0) s.weaponNext = true;
    if (this.wheel < 0) s.weaponPrev = true;
    this.wheel = 0;

    // --- gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const g of pads) { if (g && g.connected) { gp = g; if (g.index === this.gamepadIndex) break; } }
    if (gp) {
      if (this.gamepadIndex === -1) { this.gamepadIndex = gp.index; this.gamepadName = gp.id; this.onGamepad?.(true, gp.id); }
      const dz = (v) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      const ax = gp.axes;
      const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      const bv = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
      s.moveX += dz(ax[0] || 0); s.moveY -= dz(ax[1] || 0);
      // d-pad fallback
      if (b(12)) s.moveY += 1; if (b(13)) s.moveY -= 1; if (b(14)) s.moveX -= 1; if (b(15)) s.moveX += 1;
      const lx = dz(ax[2] || 0), ly = dz(ax[3] || 0);
      s.lookX += lx * 2.6 * dt * this.sensitivity; s.lookY += ly * 2.0 * dt * this.sensitivity;
      s.accel = Math.max(s.accel, bv(7)); s.brake = Math.max(s.brake, bv(6));
      if (b(0)) { s.sprint = true; s.handbrake = true; }
      if (b(2)) s.jump = true;
      if (b(3)) s.interact = true;
      if (b(1)) s.horn = true;
      if (b(5)) { s.handbrake = true; s.weaponNext = true; }
      if (b(4)) s.weaponPrev = true;
      if (this.mode === 'foot') { if (bv(7) > 0.5) s.fire = true; if (bv(6) > 0.5) s.aim = true; }
      if (b(9)) s.pause = true;
      if (b(8) || b(11)) s.camera = true;
    }

    // --- touch
    if (this.touchEnabled) {
      const t = this.touch;
      s.moveX += t.joy.x; s.moveY += t.joy.y;
      s.lookX += t.lookDX * 0.0045 * this.sensitivity; s.lookY += t.lookDY * 0.0045 * this.sensitivity;
      t.lookDX = 0; t.lookDY = 0;
      if (t.btn.jump) s.jump = true;
      if (t.btn.sprint) s.sprint = true;
      if (t.btn.interact) s.interact = true;
      if (t.btn.handbrake) s.handbrake = true;
      if (t.btn.horn) s.horn = true;
      if (t.btn.accel) s.accel = 1;
      if (t.btn.brake) s.brake = 1;
      if (t.btn.fire) s.fire = true;
      if (t.btn.aim) s.aim = true;
      if (t.btn.weapon) { s.weaponNext = true; t.btn.weapon = false; }
      if (t.btn.pause) { s.pause = true; t.btn.pause = false; }
      if (t.btn.camera) { s.camera = true; t.btn.camera = false; }
    }

    // normalize
    const l = Math.hypot(s.moveX, s.moveY);
    if (l > 1) { s.moveX /= l; s.moveY /= l; }
    s.moveX = clamp(s.moveX, -1, 1); s.moveY = clamp(s.moveY, -1, 1);
    if (this.invertY) s.lookY = -s.lookY;
    if (s.pause && !p.pause && this.onPause) this.onPause();
  }
}
