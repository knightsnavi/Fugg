/** Procedural WebAudio sound: engine, horn, impacts, pickups, siren. */
export class GameAudio {
  constructor() { this.ctx = null; this.enabled = true; this.engine = null; this.sirenOsc = null; }
  init() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    this.ctx = new C();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
    // engine: sawtooth through lowpass
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 60;
    const o2 = this.ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 30;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
    const g = this.ctx.createGain(); g.gain.value = 0;
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.master); o.start(); o2.start();
    this.engine = { o, o2, f, g };
    // siren
    const s = this.ctx.createOscillator(); s.type = 'triangle'; s.frequency.value = 700;
    const sg = this.ctx.createGain(); sg.gain.value = 0; s.connect(sg); sg.connect(this.master); s.start();
    this.siren = { o: s, g: sg, t: 0 };
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setEnabled(on) { this.enabled = on; if (this.master) this.master.gain.value = on ? 0.5 : 0; }
  updateEngine(dt, vehicle, inCar) {
    if (!this.engine) return;
    const e = this.engine; const t = this.ctx.currentTime;
    if (!inCar || !vehicle) { e.g.gain.setTargetAtTime(0, t, 0.1); return; }
    const sp = Math.abs(vehicle.forwardSpeed()) / vehicle.type.maxSpeed;
    const gear = (sp * 4) % 1; const rpm = 0.25 + gear * 0.75 + vehicle.throttle * 0.15;
    e.o.frequency.setTargetAtTime(55 + rpm * 140, t, 0.05);
    e.o2.frequency.setTargetAtTime(28 + rpm * 70, t, 0.05);
    e.f.frequency.setTargetAtTime(300 + rpm * 900 + vehicle.throttle * 500, t, 0.05);
    e.g.gain.setTargetAtTime(0.06 + vehicle.throttle * 0.08 + sp * 0.04, t, 0.08);
  }
  updateSiren(dt, intensity) {
    if (!this.siren) return; const s = this.siren; const t = this.ctx.currentTime;
    s.t += dt * 2.2; const f = 600 + Math.sin(s.t * Math.PI) * 250;
    s.o.frequency.setTargetAtTime(f, t, 0.03); s.g.gain.setTargetAtTime(intensity * 0.12, t, 0.1);
  }
  _blip(freq, dur, type = 'sine', vol = 0.3, slide = 0) {
    if (!this.ctx || !this.enabled) return; const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, vol = 0.4) {
    if (!this.ctx || !this.enabled) return; const t = this.ctx.currentTime;
    const n = this.ctx.sampleRate * dur; const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf; const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const g = this.ctx.createGain(); g.gain.value = vol; src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
  }
  impact(strength) { this.noise(Math.min(0.5, 0.12 + strength * 0.02), Math.min(0.8, 0.2 + strength * 0.05)); }
  horn(on) {
    if (!this.ctx) return;
    if (on && !this.hornNode) { const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = 420; const o2 = this.ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 520; const g = this.ctx.createGain(); g.gain.value = this.enabled ? 0.08 : 0; o.connect(g); o2.connect(g); g.connect(this.master); o.start(); o2.start(); this.hornNode = { o, o2, g }; }
    else if (!on && this.hornNode) { const h = this.hornNode; h.o.stop(); h.o2.stop(); this.hornNode = null; }
  }
  gunshot(type = 'pistol', vol = 1) {
    if (!this.ctx || !this.enabled) return;
    if (type === 'shotgun') { this.noise(0.35, 0.7 * vol); this._blip(90, 0.3, 'sawtooth', 0.3 * vol, -60); }
    else if (type === 'smg') { this.noise(0.08, 0.35 * vol); this._blip(260, 0.06, 'square', 0.12 * vol, -150); }
    else { this.noise(0.14, 0.5 * vol); this._blip(180, 0.12, 'sawtooth', 0.2 * vol, -120); }
  }
  hornBlip() { if (!this.ctx || !this.enabled) return; this._blip(430, 0.35, 'square', 0.06); this._blip(540, 0.35, 'square', 0.06); }
  explosion() { if (!this.ctx || !this.enabled) return; this.noise(1.2, 0.9); this._blip(60, 1.0, 'sine', 0.6, -40); }
  pickup() { this._blip(880, 0.15, 'sine', 0.25, 440); this._blip(1320, 0.25, 'sine', 0.2); }
  cash() { this._blip(660, 0.1, 'square', 0.15); setTimeout(() => this._blip(990, 0.15, 'square', 0.15), 90); }
  hurt() { this._blip(180, 0.25, 'sawtooth', 0.25, -120); }
  fail() { this._blip(300, 0.5, 'sawtooth', 0.2, -200); }
  jump() { this._blip(300, 0.12, 'triangle', 0.1, 200); }
}
