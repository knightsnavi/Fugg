import * as THREE from 'three';
import { CFG } from './config.js';
import { clamp, damp, dampAngle, headingOf, pick, rand, mulberry32 } from './util.js';
import { resolveCircle } from './physics.js';
import { Human, SKIN, SHIRTS, PANTS } from './characters.js';

const _res = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };
const _c = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];

export class Ped {
  constructor(game, { cop = false, rng = Math.random } = {}) {
    this.game = game; this.cop = cop;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.heading = 0;
    this.health = cop ? 120 : 100; this.alive = true; this.state = cop ? 'cop' : 'walk';
    this.speed = cop ? 4.8 : rand(rng, 1.1, 1.9); this.radius = 0.4;
    this.node = null; this.prev = null; this.target = null; this.fleeT = 0; this.downT = 0; this.deadT = 0; this.idleT = 0; this.shootT = rand(rng, 0.5, 1.5);
    this.human = cop
      ? new Human({ skin: pick(rng, SKIN), shirt: 0x1f3a93, pants: 0x101c4a, hair: 0x1a1a1a, cop: true, rng })
      : new Human({ skin: pick(rng, SKIN), shirt: pick(rng, SHIRTS), pants: pick(rng, PANTS), hair: pick(rng, [0x1a1a1a, 0x3b2a1a, 0x7a5230, 0xd9c27a, 0x555555]), rng });
    this.mesh = this.human.group; this.mesh.userData.ped = this;
    this.lastHitBy = null;
  }
  setNode(n) { this.node = n; this.pos.set(n.x, 0.15, n.z); this.pickNext(); this.mesh.position.copy(this.pos); }
  pickNext() {
    const adj = this.node.adj; let cands = adj.filter((id) => id !== this.prev?.id);
    if (!cands.length) cands = adj;
    const next = this.game.city.sidewalkNodes[pick(Math.random, cands)];
    this.prev = this.node; this.target = next;
  }
  flee(fromX, fromZ, t = 4) {
    if (!this.alive || this.state === 'down' || this.cop) return;
    this.state = 'flee'; this.fleeT = t;
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ; const l = Math.hypot(dx, dz) || 1;
    this.fleeDir = { x: dx / l + (Math.random() - 0.5) * 0.6, z: dz / l + (Math.random() - 0.5) * 0.6 };
  }
  knock(v) {
    if (!this.alive) return;
    const s = v.speed; this.state = 'down'; this.downT = 3 + s * 0.15;
    this.vel.set(v.vel.x * 0.8, 3 + s * 0.3, v.vel.z * 0.8);
    this.hit(s * 4, v.driver === 'player' ? 'player' : null, true);
    if (v.driver === 'player' && this.alive && this.cop) this.game.addWanted(1);
    this.game.audio.impact(Math.min(8, s * 0.5));
  }
  hit(dmg, by, noBlood = false) {
    if (!this.alive) return;
    this.health -= dmg; this.lastHitBy = by;
    if (!noBlood) { this.game.fx.particles.emit(this.pos.x, this.pos.y + 1.2, this.pos.z, { count: 6, color: [0.6, 0.02, 0.02], speed: 2.5, spread: 1, size: 0.5, life: 0.5, grav: -9 }); }
    if (this.health <= 0) this.die(by);
    else if (this.state === 'walk') this.flee(this.game.player.x, this.game.player.z, 6);
  }
  die(by) {
    this.alive = false; this.state = 'dead'; this.deadT = 0;
    this.game.fx.decals.add(this.pos.x, this.game.city.groundHeight(this.pos.x, this.pos.z), this.pos.z, new THREE.Color(0x4a0404), 1.2 + Math.random());
    if (by === 'player') this.game.onKill?.(this);
  }
  update(dt) {
    const g = this.game, city = g.city; const p = this.pos;
    if (this.state === 'dead' || this.state === 'down') {
      this.vel.y -= CFG.gravity * dt; this.vel.x *= Math.exp(-3 * dt); this.vel.z *= Math.exp(-3 * dt);
      p.addScaledVector(this.vel, dt);
      const gy = city.groundHeight(p.x, p.z); if (p.y < gy) { p.y = gy; this.vel.y = 0; }
      this.mesh.rotation.x = damp(this.mesh.rotation.x, -Math.PI / 2, 8, dt);
      this.mesh.position.set(p.x, p.y + 0.35, p.z);
      if (this.state === 'dead') { this.deadT += dt; return; }
      this.downT -= dt;
      if (this.downT <= 0) { this.state = this.cop ? 'cop' : 'flee'; this.fleeT = 4; this.fleeDir = { x: Math.random() - 0.5, z: Math.random() - 0.5 }; this.mesh.rotation.x = 0; }
      return;
    }
    let tx = 0, tz = 0, spd = 0;
    if (this.state === 'cop') { this.updateCop(dt); return; }
    if (this.state === 'flee') {
      this.fleeT -= dt; spd = 5.2; tx = this.fleeDir.x; tz = this.fleeDir.z;
      if (this.fleeT <= 0) { this.state = 'walk'; this.node = this.nearestNode(); this.prev = null; this.pickNext(); }
    } else { // walk
      if (this.idleT > 0) { this.idleT -= dt; }
      else {
        const dx = this.target.x - p.x, dz = this.target.z - p.z; const d = Math.hypot(dx, dz);
        if (d < 0.6) { this.node = this.target; this.pickNext(); if (Math.random() < 0.08) this.idleT = rand(Math.random, 1, 4); }
        else { tx = dx / d; tz = dz / d; spd = this.speed; }
      }
      // scared of fast cars nearby
      const pv = g.player.vehicle;
      if (pv && pv.speed > 9) { const dx = p.x - pv.pos.x, dz = p.z - pv.pos.z; if (dx * dx + dz * dz < 64) this.flee(pv.pos.x, pv.pos.z, 3); }
    }
    const l = Math.hypot(tx, tz) || 1;
    this.vel.x = damp(this.vel.x, (tx / l) * spd, 8, dt); this.vel.z = damp(this.vel.z, (tz / l) * spd, 8, dt);
    if (spd > 0) this.heading = dampAngle(this.heading, headingOf(tx, tz), 10, dt);
    p.x += this.vel.x * dt; p.z += this.vel.z * dt; p.y = city.groundHeight(p.x, p.z);
    if (this.state === 'flee') { resolveCircle(city.colliders, p.x, p.z, this.radius, _res); if (_res.hit) { p.x = _res.x; p.z = _res.z; this.fleeDir = { x: _res.nx + (Math.random() - 0.5), z: _res.nz + (Math.random() - 0.5) }; } }
    city.clampToBounds(p, 1);
    this.mesh.position.set(p.x, p.y, p.z); this.human.baseY = p.y; this.mesh.rotation.y = this.heading;
    this.human.animate(Math.hypot(this.vel.x, this.vel.z), dt);
  }
  updateCop(dt) {
    const g = this.game, pl = g.player, p = this.pos, city = g.city;
    const dx = pl.x - p.x, dz = pl.z - p.z; const d = Math.hypot(dx, dz) || 1;
    const los = d < 30 && g.weapons.lineOfSight(p.x, p.y + 1.3, p.z, pl.x, pl.worldPos.y + 1.2, pl.z);
    let spd = 0, tx = dx / d, tz = dz / d;
    const playerOnFoot = pl.state === 'foot' || pl.state === 'ragdoll';
    if (pl.state === 'dead') { spd = 0; }
    else if (los && d < 16 && playerOnFoot) {
      // stop and shoot
      this.shootT -= dt;
      if (this.shootT <= 0) { this.shootT = 0.9 + Math.random() * 0.5; g.weapons.copShoot(this, d); }
      if (d < 1.6 && pl.state === 'foot') { this.bustT = (this.bustT || 0) + dt; if (this.bustT > 0.8) g.onBusted(); } else this.bustT = 0;
    } else { spd = d > 2 ? this.speed : 0; }
    if (!los && d > 60) { this.state = 'walk'; this.cop = false; this.node = this.nearestNode(); this.prev = null; this.pickNext(); return; }
    this.vel.x = damp(this.vel.x, tx * spd, 8, dt); this.vel.z = damp(this.vel.z, tz * spd, 8, dt);
    this.heading = dampAngle(this.heading, headingOf(dx, dz), 10, dt);
    p.x += this.vel.x * dt; p.z += this.vel.z * dt; p.y = city.groundHeight(p.x, p.z);
    resolveCircle(city.colliders, p.x, p.z, this.radius, _res); if (_res.hit) { p.x = _res.x; p.z = _res.z; }
    this.mesh.position.set(p.x, p.y, p.z); this.human.baseY = p.y; this.mesh.rotation.y = this.heading;
    this.human.animate(Math.hypot(this.vel.x, this.vel.z), dt);
    if (spd === 0 && los) { this.human.armR.rotation.x = -Math.PI / 2; this.human.armR.rotation.z = 0; this.human.armR.elbow.rotation.x = 0; }
  }
  nearestNode() {
    const nodes = this.game.city.sidewalkNodes; let best = nodes[0], bd = Infinity;
    for (const n of nodes) { const d = (n.x - this.pos.x) ** 2 + (n.z - this.pos.z) ** 2; if (d < bd) { bd = d; best = n; } }
    return best;
  }
}

export class Pedestrians {
  constructor(game) {
    this.game = game; this.list = []; this.rng = mulberry32(CFG.seed + 99);
    for (let i = 0; i < CFG.pedestrians; i++) this.spawnRandom();
  }
  spawnRandom() {
    const city = this.game.city; const p = this.game.player;
    let n, tries = 0;
    do { n = pick(this.rng, city.sidewalkNodes); tries++; } while (tries < 20 && (n.x - p.x) ** 2 + (n.z - p.z) ** 2 < 40 * 40);
    const ped = new Ped(this.game, { rng: this.rng }); ped.setNode(n); this.add(ped); return ped;
  }
  add(ped) { this.list.push(ped); this.game.scene.add(ped.mesh); return ped; }
  remove(ped) { const i = this.list.indexOf(ped); if (i >= 0) this.list.splice(i, 1); this.game.scene.remove(ped.mesh); }
  spawnAt(x, z, opts = {}) { const ped = new Ped(this.game, { rng: this.rng, ...opts }); ped.pos.set(x, this.game.city.groundHeight(x, z), z); ped.node = ped.nearestNode(); ped.prev = null; ped.pickNext(); ped.mesh.position.copy(ped.pos); this.add(ped); if (opts.flee) ped.flee(x, z, 5); return ped; }
  alertGunshot(x, z, radius = 28) { const r2 = radius * radius; for (const p of this.list) { const d = (p.pos.x - x) ** 2 + (p.pos.z - z) ** 2; if (d < r2 && p.state === 'walk') p.flee(x, z, 5 + Math.random() * 3); } }
  update(dt) {
    const g = this.game; const px = g.player.x, pz = g.player.z; const vehicles = g.vehicles;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const d2 = (p.pos.x - px) ** 2 + (p.pos.z - pz) ** 2;
      // respawn dead/far peds (civilians only)
      if (!p.cop && ((p.state === 'dead' && (p.deadT > 25 || d2 > 120 * 120)) || d2 > 320 * 320)) { this.remove(p); if (this.list.length < CFG.pedestrians) this.spawnRandom(); continue; }
      p.mesh.visible = d2 < 170 * 170;
      if (d2 > 260 * 260) continue; // far: freeze
      p.update(dt);
      if (p.state === 'dead') continue;
      // vehicles
      for (const v of vehicles) {
        const dx = p.pos.x - v.pos.x, dz = p.pos.z - v.pos.z; if (dx * dx + dz * dz > 36) continue;
        v.circles(_c);
        for (let k = 0; k < v.circleCount; k++) {
          const c = _c[k]; let nx = p.pos.x - c.x, nz = p.pos.z - c.z; const dd = nx * nx + nz * nz; const rr = v.radius + p.radius;
          if (dd >= rr * rr) continue; const dl = Math.sqrt(dd) || 0.001; nx /= dl; nz /= dl;
          p.pos.x = c.x + nx * rr; p.pos.z = c.z + nz * rr;
          if (v.speed > 2.5 && p.state !== 'down') { p.knock(v); if (v.driver === 'player' && !p.cop) g.onPedHit?.(p, v); }
        }
      }
    }
  }
}
