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
import { Particles, Tracers, Decals, Rain, Fires } from './effects.js';
import { WeaponSystem } from './weapons.js';
import { Pedestrians } from './pedestrians.js';
import { Traffic } from './traffic.js';
import { Police } from './police.js';
import { Missions } from './missions.js';
import { mulberry32, pick } from './util.js';

const SAVE_KEY = 'fugg-city-save-v1';
const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !isTouchDevice, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1500);
    this.settings = Object.assign({ touch: isTouchDevice, shadows: !isTouchDevice, invertY: false, sound: true, sens: 1 }, this.loadSettings());
    this.applyQuality();

    this.rng = mulberry32(CFG.seed + 7);
    this.time = 0; this.paused = false; this.started = false; this.nearVehicle = null; this.heat = 0;
    this.city = new City(this.scene, CFG.seed);
    this.daynight = new DayNight(this.scene, this.city, { shadows: this.settings.shadows });
    this.fx = { particles: new Particles(this.scene), tracers: new Tracers(this.scene), decals: new Decals(this.scene), rain: new Rain(this.scene) };
    this.fx.fires = new Fires(this.fx.particles);
    this.player = new Player(this);
    this.vehicles = [];
    this.input = new Input(this.canvas);
    this.cam = new ThirdPersonCamera(this.camera, this.city);
    this.hud = new HUD(this);
    this.audio = new GameAudio();
    this.weapons = new WeaponSystem(this);
    this.spawnWorld();
    this.peds = new Pedestrians(this);
    this.traffic = new Traffic(this);
    this.police = new Police(this);
    this.missions = new Missions(this);
    this.headlight = new THREE.SpotLight(0xfff2d0, 0, 45, 0.5, 0.5, 1); this.headlight.target = new THREE.Object3D(); this.scene.add(this.headlight, this.headlight.target);
    this.load();
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
    this.spawnPoint = { x: center.minX + 2, z: center.minZ + 1.5 };
    this.player.pos.set(this.spawnPoint.x, 0.15, this.spawnPoint.z);
    this.player.heading = Math.PI / 2; this.cam.yaw = this.player.heading;
    for (const s of c.parkingSpots) this.addVehicle(pick(this.rng, ['sedan', 'sedan', 'sports', 'muscle', 'van', 'taxi', 'bike', 'truck']), pick(this.rng, CAR_COLORS), s.x, s.z, s.heading);
    this.addVehicle('sports', 0x8a1c1c, center.minX - c.R / 2 + CFG.laneOffset, center.minZ + 8, 0);
    this.addVehicle('bike', 0x2a2a2a, center.minX - c.R / 2 + CFG.laneOffset, center.minZ + 16, 0);
  }
  addVehicle(type, color, x, z, heading) { const v = new Vehicle(type, color); v.setPose(x, z, heading); this.scene.add(v.mesh); this.vehicles.push(v); return v; }
  removeVehicle(v) { if (v === this.player.vehicle) return; this.scene.remove(v.mesh); const i = this.vehicles.indexOf(v); if (i >= 0) this.vehicles.splice(i, 1); }

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
    $('start-note').textContent = isTouchDevice ? 'Touch controls enabled. Add to your home screen to play fullscreen.' : 'Tip: plug in a controller any time. Click the game to capture the mouse.';
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
    this.hud.toast('Welcome to Fugg City. Grab the pistol, steal a ride, find the markers.', 6);
  }
  setPaused(p) {
    this.paused = p; document.getElementById('pause').classList.toggle('hidden', !p);
    if (p) { document.exitPointerLock?.(); this.audio.horn(false); document.getElementById('pause-stats').innerHTML = `Money: $${this.player.money} &middot; Wanted: ${this.player.wanted}&#9733; &middot; Jobs done: ${this.missions.completed} &middot; Packages: ${this.missions.packages.filter((q) => q.collected).length}/${this.missions.packages.length}`; this.save(); }
    else { this.last = performance.now(); if (!this.settings.touch) this.canvas.requestPointerLock?.(); }
  }
  // ---------- persistence
  loadSettings() { try { return JSON.parse(localStorage.getItem(SAVE_KEY + '-settings')) || {}; } catch { return {}; } }
  saveSettings() { try { localStorage.setItem(SAVE_KEY + '-settings', JSON.stringify(this.settings)); } catch { /* ignore */ } }
  load() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s) { this.player.money = s.money || 0; this.weapons.loadState(s.weapons); this.missions.loadState(s.missions); } } catch { /* ignore */ } }
  save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ money: this.player.money, weapons: this.weapons.saveState(), missions: this.missions.saveState() })); } catch { /* ignore */ } }

  // ---------- events
  onImpact(v, strength) {
    if (v === this.player.vehicle) this.cam.shake = Math.min(1, strength * 0.05);
    if (this.dist2ToPlayer(v.pos) < 80 * 80) { this.audio.impact(strength); this.fx.particles.emit(v.pos.x, 0.8, v.pos.z, { count: Math.min(12, strength), color: [1, 0.85, 0.4], speed: 4, spread: 1, size: 0.35, life: 0.4, grav: -8 }); }
  }
  onWrecked(v) {
    v.explodeAt = this.time + 2.2; this.fx.fires.add(v.pos.x, 0.9, v.pos.z, 2.5, 0.8);
    if (v === this.player.vehicle) this.hud.toast('Your ride is on fire. GET OUT!', 2.5);
  }
  explodeVehicle(v) {
    v.exploded = true; const x = v.pos.x, z = v.pos.z;
    this.fx.particles.emit(x, 1, z, { count: 60, color: [1, 0.6, 0.1], color2: [1, 0.1, 0.02], speed: 9, spread: 1, size: 3, life: 0.9, grav: -2, shrink: 1 });
    this.fx.particles.emit(x, 1.5, z, { count: 30, color: [0.1, 0.1, 0.1], speed: 3, spread: 1, size: 5, life: 3, grav: 1.5, shrink: 0.3, up: 3 });
    this.fx.fires.add(x, 0.6, z, 14, 1.2); this.fx.decals.add(x, 0, z, new THREE.Color(0x111111), 4);
    this.audio.explosion(); this.cam.shake = Math.max(this.cam.shake, 1);
    // blast damage
    const R = 7;
    if (this.dist2ToPlayer(v.pos) < R * R || v === this.player.vehicle) { this.player.invuln = 0; this.player.damage(v === this.player.vehicle ? 200 : 70); if (this.player.state === 'foot') { const dx = this.player.x - x, dz = this.player.z - z; const d = Math.hypot(dx, dz) || 1; this.player.hitByVehicle({ vel: { x: dx / d * 6, z: dz / d * 6 }, speed: 10 }, dx / d, dz / d, 8); } }
    for (const p of this.peds.list) { const d2 = (p.pos.x - x) ** 2 + (p.pos.z - z) ** 2; if (d2 < R * R) { p.knock({ speed: 9, vel: { x: (p.pos.x - x), z: (p.pos.z - z) }, driver: v.playerOwned ? 'player' : null }); p.hit(120, v.playerOwned ? 'player' : null, true); } }
    for (const o of this.vehicles) { if (o === v) continue; const d2 = (o.pos.x - x) ** 2 + (o.pos.z - z) ** 2; if (d2 < (R + 2) ** 2) { o.damage(55, this); o.vel.x += (o.pos.x - x) * 0.8; o.vel.z += (o.pos.z - z) * 0.8; } }
    v.mesh.position.y = 0; v.vel.set(0, 0, 0);
  }
  onPlayerHit(v, speed) { this.cam.shake = 0.6; }
  onPedHit(ped, v) { this.heat += 1; if (!ped.alive) this.addWanted(1); else if (this.heat % 3 === 0) this.addWanted(1); }
  onKill(ped) { if (ped.cop) this.addWanted(2); else { this.heat += 2; this.addWanted(this.player.wanted < 3 ? 1 : 0); if (this.heat > 6 && this.player.wanted < 4) this.addWanted(1); } }
  onWasted() {
    const p = this.player; if (p.state === 'dead') return; p.state = 'dead'; this.hud.big('WASTED', 3.5); this.audio.fail();
    this.missions?.fail('You died'); p.mesh.rotation.x = -Math.PI / 2;
    setTimeout(() => { if (p.vehicle) p.exitVehicle(); p.health = 100; p.money = Math.max(0, p.money - Math.min(500, Math.floor(p.money * 0.1))); p.wanted = 0; this.heat = 0; this.police?.clear(); const sp = this.missions?.hospital || this.spawnPoint; p.pos.set(sp.x, 0.15, sp.z); p.vel.set(0, 0, 0); p.state = 'foot'; p.mesh.rotation.set(0, p.heading, 0); p.invuln = 3; this.save(); }, 3500);
  }
  onBusted() {
    const p = this.player; if (p.state === 'dead') return; p.state = 'dead'; this.hud.big('BUSTED', 3.5); this.audio.fail();
    this.missions?.fail('You got busted');
    setTimeout(() => { if (p.vehicle) p.exitVehicle(); p.money = Math.max(0, p.money - Math.min(1000, Math.floor(p.money * 0.15))); p.wanted = 0; this.heat = 0; this.police?.clear(); for (const w of ['pistol', 'smg', 'shotgun']) this.weapons.ammo[w] = Math.floor(this.weapons.ammo[w] / 2); const sp = this.missions?.station || this.spawnPoint; p.pos.set(sp.x, 0.15, sp.z); p.vel.set(0, 0, 0); p.state = 'foot'; p.health = Math.max(p.health, 50); p.invuln = 3; this.save(); }, 3500);
  }
  dist2ToPlayer(pos) { const dx = pos.x - this.player.x, dz = pos.z - this.player.z; return dx * dx + dz * dz; }
  addMoney(n) { this.player.money += n; if (n > 0) this.audio.cash(); }
  addWanted(n) { if (n <= 0) return; const p = this.player; const before = p.wanted; p.wanted = Math.min(5, p.wanted + n); if (p.wanted !== before) { this.police?.onWantedChanged?.(); this.hud.flashWanted?.(); } }

  // ---------- loop
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    let dt = (now - this.last) / 1000; this.last = now;
    if (dt > 0.05) dt = 0.05;
    if (!this.started) { this.cam.yaw += dt * 0.1; this.cam.update(0, this.player, { lookX: 0, lookY: 0 }); this.daynight.update(0, this.player.pos, this.fx.rain); this.renderer.render(this.scene, this.camera); return; }
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
      let best = null, bd = 3.8 * 3.8;
      for (const v of this.vehicles) { if (v.wrecked) continue; const d = this.dist2ToPlayer(v.pos); if (d < bd) { bd = d; best = v; } }
      this.nearVehicle = best;
      if (best && this.input.pressed('interact') && !this.missions.inMarker) {
        if (best.ai) { if (best.typeName === 'police') { this.police.cars.splice(this.police.cars.indexOf(best), 1); best.ai = null; best.driver = null; this.addWanted(2); } else this.traffic.carjack(best); }
        p.enterVehicle(best);
      }
    } else if (p.state === 'car' && this.input.pressed('interact') && (p.vehicle.speed < 7 || p.vehicle.wrecked)) { p.exitVehicle(); }
    if (this.input.pressed('camera')) this.cam.toggleMode();
    // prompts
    if (p.state === 'foot') this.hud.prompt(this.nearVehicle && !this.missions.inMarker ? (this.settings.touch ? `Tap ENTER: ${this.nearVehicle.type.name}` : `Press E: ${this.nearVehicle.type.name}`) : null);
    else if (p.state === 'car' && p.vehicle.wrecked) this.hud.prompt(this.settings.touch ? 'Tap EXIT to leave' : 'Press E to exit');
    else this.hud.prompt(null);
    this.input.touch.setPrompt('foot', this.nearVehicle ? 'ENTER' : 'USE');

    this.weapons.update(dt, inp);
    p.update(dt, inp, this.cam.yaw);
    this.traffic.update(dt);
    this.police.update(dt);
    for (const v of this.vehicles) {
      if (v.driver !== 'player' && !v.ai) { v.throttle = 0; v.steer *= 0.9; v.brake = Math.max(v.brake, 0.2); v.mesh.visible = this.dist2ToPlayer(v.pos) < 260 * 260; if (!v.mesh.visible && v.speed < 0.1) continue; }
      v.update(dt, this);
      if (v.explodeAt && !v.exploded && this.time >= v.explodeAt) this.explodeVehicle(v);
    }
    const vs = this.vehicles;
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      const imp = collideVehicles(vs[i], vs[j]);
      if (imp > 3) {
        const a = vs[i], b = vs[j];
        const dmg = Math.min(30, (imp - 3) * 1.4); a.damage(dmg * (a.type.armor || 1), this); b.damage(dmg * (b.type.armor || 1), this); this.onImpact(a === p.vehicle ? a : b, imp);
        this.traffic.onCrash(a, b, imp);
      }
    }
    for (const v of vs) v.syncMesh();
    this.peds.update(dt);
    this.missions.update(dt);
    this.cam.update(dt, p, inp, this.weapons.aiming);
    this.daynight.update(dt, p.worldPos, this.fx.rain);
    this.city.updateTrafficLights(this.time);
    this.fx.particles.update(dt); this.fx.tracers.update(dt); this.fx.fires.update(dt); this.fx.rain.update(dt, this.cam.pos);
    // headlights
    const hv = p.vehicle; const night = this.daynight.night > 0.4;
    if (hv && night && !hv.wrecked) { const fx = Math.sin(hv.heading), fz = Math.cos(hv.heading); this.headlight.position.set(hv.pos.x + fx * hv.type.l * 0.5, 0.9, hv.pos.z + fz * hv.type.l * 0.5); this.headlight.target.position.set(hv.pos.x + fx * 30, 0, hv.pos.z + fz * 30); this.headlight.intensity = 120; } else this.headlight.intensity = 0;
    this.audio.updateEngine(dt, p.vehicle, p.state === 'car');
    this.audio.horn(p.state === 'car' && inp.horn);
    this.hud.update(dt);
    if (this.time - (this._lastSave || 0) > 20) { this._lastSave = this.time; this.save(); }
  }
}

window.game = new Game();
if ('serviceWorker' in navigator && location.protocol !== 'file:') { window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {})); }
