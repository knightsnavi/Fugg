import * as THREE from 'three';
import { CFG } from './config.js';
import { City } from './city.js';
import { Player } from './player.js';
import { Vehicle, CAR_COLORS, collideVehicles } from './vehicle.js';
import { ThirdPersonCamera } from './camera.js';
import { DayNight } from './daynight.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { mulberry32, pick, rand } from './util.js';

const SAVE_KEY = 'fugg-city-save-v1';
const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !isTouchDevice, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1500);
    this.settings = Object.assign({ touch: isTouchDevice, shadows: !isTouchDevice, invertY: false, sound: true, sens: 1 }, this.loadSettings());
    this.applyQuality();

    this.rng = mulberry32(CFG.seed + 7);
    this.city = new City(this.scene, CFG.seed);
    this.daynight = new DayNight(this.scene, this.city, { shadows: this.settings.shadows });
    this.player = new Player(this);
    this.vehicles = [];
    this.input = new Input(this.canvas);
    this.cam = new ThirdPersonCamera(this.camera, this.city);
    this.hud = new HUD(this);
    this.audio = new GameAudio();
    this.missions = null; this.traffic = null; this.peds = null; this.police = null;
    this.paused = false; this.started = false; this.time = 0; this.nearVehicle = null;
    this.load();
    this.spawnWorld();
    this.bindUI();
    this.resize(); window.addEventListener('resize', () => this.resize());
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }
  // ---------- setup
  applyQuality() {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.settings.shadows ? 2 : 1.5));
    this.renderer.shadowMap.enabled = !!this.settings.shadows;
    if (this.daynight) this.daynight.sun.castShadow = !!this.settings.shadows;
  }
  resize() { const w = window.innerWidth, h = window.innerHeight; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  spawnWorld() {
    const c = this.city; const center = c.block(Math.floor(c.N / 2), Math.floor(c.N / 2));
    // spawn player at the SW corner sidewalk of the central plaza
    this.spawnPoint = { x: center.minX + 1.5, z: center.minZ - c.R / 2 - 1.5 + c.R / 2 + 0 };
    this.spawnPoint = { x: center.minX + 2, z: center.minZ + 1.5 };
    this.player.pos.set(this.spawnPoint.x, 0.15, this.spawnPoint.z);
    this.player.heading = Math.PI / 2;
    this.cam.yaw = this.player.heading;
    // parked cars in lots
    for (const s of c.parkingSpots) this.addVehicle(pick(this.rng, ['sedan', 'sedan', 'sports', 'van', 'taxi']), pick(this.rng, CAR_COLORS), s.x, s.z, s.heading);
    // a starter car right by the player on the road
    this.addVehicle('sports', 0xc0392b, center.minX - c.R / 2 + CFG.laneOffset, center.minZ + 8, 0);
    this.addVehicle('sedan', 0x2980b9, center.minX - c.R / 2 + CFG.laneOffset, center.minZ + 16, 0);
  }
  addVehicle(type, color, x, z, heading) { const v = new Vehicle(type, color); v.setPose(x, z, heading); this.scene.add(v.mesh); this.vehicles.push(v); return v; }
  removeVehicle(v) { this.scene.remove(v.mesh); const i = this.vehicles.indexOf(v); if (i >= 0) this.vehicles.splice(i, 1); }

  bindUI() {
    const $ = (id) => document.getElementById(id);
    $('btn-start').addEventListener('click', () => this.start());
    $('btn-resume').addEventListener('click', () => this.setPaused(false));
    $('btn-reset').addEventListener('click', () => { if (confirm('Reset all progress?')) { localStorage.removeItem(SAVE_KEY); location.reload(); } });
    const optTouch = $('opt-touch'), optSh = $('opt-shadows'), optInv = $('opt-invert'), optSnd = $('opt-sound'), optSens = $('opt-sens');
    optTouch.checked = this.settings.touch; optSh.checked = this.settings.shadows; optInv.checked = this.settings.invertY; optSnd.checked = this.settings.sound; optSens.value = this.settings.sens;
    optTouch.addEventListener('change', () => { this.settings.touch = optTouch.checked; this.input.setTouchEnabled(this.settings.touch); this.saveSettings(); });
    optSh.addEventListener('change', () => { this.settings.shadows = optSh.checked; this.applyQuality(); this.saveSettings(); });
    optInv.addEventListener('change', () => { this.settings.invertY = optInv.checked; this.input.invertY = optInv.checked; this.saveSettings(); });
    optSnd.addEventListener('change', () => { this.settings.sound = optSnd.checked; this.audio.setEnabled(optSnd.checked); this.saveSettings(); });
    optSens.addEventListener('input', () => { this.settings.sens = parseFloat(optSens.value); this.input.sensitivity = this.settings.sens; this.saveSettings(); });
    this.input.onPause = () => { if (this.started) this.setPaused(!this.paused); };
    this.input.onGamepad = (on, id) => { if (this.started) this.hud.toast(on ? `Controller connected: ${(id || '').split('(')[0].trim()}` : 'Controller disconnected'); };
    this.input.invertY = this.settings.invertY; this.input.sensitivity = this.settings.sens;
    $('start-note').textContent = isTouchDevice ? 'Touch controls enabled. Add to home screen for fullscreen.' : 'Tip: plug in a controller any time.';
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.started) this.setPaused(true); });
  }
  start() {
    this.started = true;
    document.getElementById('start').classList.add('hidden');
    this.hud.show();
    this.audio.init(); this.audio.setEnabled(this.settings.sound);
    this.input.setTouchEnabled(this.settings.touch); this.input.setMode('foot');
    if (!this.settings.touch) this.canvas.requestPointerLock?.();
    if (isTouchDevice && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    this.hud.toast('Welcome to Fugg City. Find a car and explore.', 5);
  }
  setPaused(p) {
    this.paused = p; document.getElementById('pause').classList.toggle('hidden', !p);
    if (p) { document.exitPointerLock?.(); this.audio.horn(false); document.getElementById('pause-stats').innerHTML = `Money: $${this.player.money} &middot; Wanted: ${this.player.wanted}&#9733;`; this.save(); }
    else { this.last = performance.now(); if (!this.settings.touch) this.canvas.requestPointerLock?.(); }
  }
  // ---------- persistence
  loadSettings() { try { return JSON.parse(localStorage.getItem(SAVE_KEY + '-settings')) || {}; } catch { return {}; } }
  saveSettings() { try { localStorage.setItem(SAVE_KEY + '-settings', JSON.stringify(this.settings)); } catch { /* ignore */ } }
  load() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s) { this.player.money = s.money || 0; this.saveData = s; } } catch { /* ignore */ } }
  save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ money: this.player.money, ...(this.missions?.saveState() || {}) })); } catch { /* ignore */ } }

  // ---------- events
  onImpact(v, strength) { if (v === this.player.vehicle) { this.cam.shake = Math.min(1, strength * 0.05); } if (this.dist2ToPlayer(v.pos) < 80 * 80) this.audio.impact(strength); }
  onWrecked(v) { if (v === this.player.vehicle) { this.hud.toast('Your car is wrecked. Find another.', 3); } }
  onPlayerHit(v, speed) { this.cam.shake = 0.6; }
  onWasted() {
    const p = this.player; p.state = 'dead'; this.hud.big('WASTED', 3.5); this.audio.fail();
    this.missions?.fail('You died');
    setTimeout(() => { if (p.vehicle) p.exitVehicle(); p.health = 100; p.money = Math.max(0, p.money - Math.min(500, Math.floor(p.money * 0.1))); p.wanted = 0; this.police?.clear(); const sp = this.missions?.hospital || this.spawnPoint; p.pos.set(sp.x, 0.15, sp.z); p.vel.set(0, 0, 0); p.state = 'foot'; p.mesh.rotation.x = 0; p.invuln = 3; }, 3500);
  }
  onBusted() {
    const p = this.player; if (p.state === 'dead') return; p.state = 'dead'; this.hud.big('BUSTED', 3.5); this.audio.fail();
    this.missions?.fail('You got busted');
    setTimeout(() => { if (p.vehicle) p.exitVehicle(); p.money = Math.max(0, p.money - Math.min(1000, Math.floor(p.money * 0.15))); p.wanted = 0; this.police?.clear(); const sp = this.missions?.station || this.spawnPoint; p.pos.set(sp.x, 0.15, sp.z); p.vel.set(0, 0, 0); p.state = 'foot'; p.health = Math.max(p.health, 50); p.invuln = 3; }, 3500);
  }
  dist2ToPlayer(pos) { const dx = pos.x - this.player.x, dz = pos.z - this.player.z; return dx * dx + dz * dz; }
  addMoney(n) { this.player.money += n; if (n > 0) this.audio.cash(); this.save(); }
  addWanted(n) { const p = this.player; p.wanted = Math.min(5, p.wanted + n); this.police?.onWantedChanged?.(); }

  // ---------- loop
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    let dt = (now - this.last) / 1000; this.last = now;
    if (dt > 0.05) dt = 0.05;
    if (!this.started) { this.cam.yaw += dt * 0.1; this.cam.update(0, this.player, { lookX: 0, lookY: 0 }); this.daynight.update(0, this.player.pos); this.renderer.render(this.scene, this.camera); return; }
    if (this.paused) return;
    this.time += dt;
    this.input.update(dt);
    this.step(dt);
    this.renderer.render(this.scene, this.camera);
  }
  step(dt) {
    const p = this.player, inp = this.input.s;
    // interact: enter / exit vehicles
    this.nearVehicle = null;
    if (p.state === 'foot') {
      let best = null, bd = 3.6 * 3.6;
      for (const v of this.vehicles) { if (v.wrecked) continue; const d = this.dist2ToPlayer(v.pos); if (d < bd) { bd = d; best = v; } }
      this.nearVehicle = best;
      if (best && this.input.pressed('interact')) {
        if (best.ai) { this.traffic?.carjack(best); }
        p.enterVehicle(best);
      }
    } else if (p.state === 'car' && this.input.pressed('interact') && p.vehicle.speed < 6) { p.exitVehicle(); }
    if (this.input.pressed('camera')) this.cam.toggleMode();
    if (this.input.pressed('jump') && p.state === 'foot' && p.onGround) this.audio.jump();
    // prompts
    if (p.state === 'foot') this.hud.prompt(this.nearVehicle ? (this.settings.touch ? 'Tap ENTER to get in' : 'Press E to enter vehicle') : null);
    else if (p.state === 'car' && p.vehicle.wrecked) this.hud.prompt(this.settings.touch ? 'Tap EXIT to leave' : 'Press E to exit');
    else this.hud.prompt(null);
    this.input.touch.setPrompt('foot', this.nearVehicle ? 'ENTER' : '—');

    p.update(dt, inp, this.cam.yaw);
    this.traffic?.update(dt);
    this.police?.update(dt);
    for (const v of this.vehicles) { if (v.driver !== 'player' && !v.ai) { v.throttle = 0; v.steer *= 0.9; v.brake = Math.max(v.brake, 0.2); } v.update(dt, this); }
    // vehicle-vehicle collisions
    const vs = this.vehicles;
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      const imp = collideVehicles(vs[i], vs[j]);
      if (imp > 3) {
        const a = vs[i], b = vs[j];
        a.damage((imp - 2) * 2, this); b.damage((imp - 2) * 2, this); this.onImpact(a === p.vehicle ? a : b, imp);
        this.traffic?.onCrash?.(a, b, imp);
      }
    }
    for (const v of vs) v.syncMesh();
    this.peds?.update(dt);
    this.missions?.update(dt);
    this.cam.update(dt, p, inp);
    this.daynight.update(dt, p.worldPos);
    this.audio.updateEngine(dt, p.vehicle, p.state === 'car');
    this.audio.horn(p.state === 'car' && inp.horn);
    this.hud.update(dt);
    if (this.time - (this._lastSave || 0) > 15) { this._lastSave = this.time; this.save(); }
  }
}

window.game = new Game();
