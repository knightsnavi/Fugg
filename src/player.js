import * as THREE from 'three';
import { CFG } from './config.js';
import { clamp, damp, dampAngle, headingOf } from './util.js';
import { resolveCircle } from './physics.js';
import { Human, mat } from './characters.js';

const _res = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };
const _c = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3(0, 0, 0); this.vel = new THREE.Vector3();
    this.heading = 0; this.onGround = true; this.radius = 0.4;
    this.health = 100; this.money = 0; this.wanted = 0; this.vehicle = null;
    this.state = 'foot'; // foot | car | ragdoll | dead
    this.ragdollT = 0; this.invuln = 0; this.armedT = 0; this.jumpReady = true;
    this.human = new Human({ skin: 0xe0ac69, shirt: 0x2f2f33, pants: 0x1c1f26, hair: 0x1b1b1b });
    this.mesh = this.human.group; this.mesh.position.copy(this.pos);
    this.gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.34), mat(0x222222, { metalness: 0.6, roughness: 0.4 })); this.gun.position.set(0, -0.6, 0.15); this.gun.visible = false; this.human.armR.add(this.gun);
    game.scene.add(this.mesh);
  }
  get x() { return this.vehicle ? this.vehicle.pos.x : this.pos.x; }
  get z() { return this.vehicle ? this.vehicle.pos.z : this.pos.z; }
  get worldPos() { return this.vehicle ? this.vehicle.pos : this.pos; }
  get facing() { return this.vehicle ? this.vehicle.heading : this.heading; }

  update(dt, input, camYaw) {
    if (this.invuln > 0) this.invuln -= dt;
    if (this.state === 'car') { this.updateCar(dt, input); return; }
    if (this.state === 'dead') return;
    const city = this.game.city;
    if (this.state === 'ragdoll') {
      this.ragdollT -= dt;
      this.vel.y -= CFG.gravity * dt; this.vel.x *= Math.exp(-2 * dt); this.vel.z *= Math.exp(-2 * dt);
      this.pos.addScaledVector(this.vel, dt);
      const gy = city.groundHeight(this.pos.x, this.pos.z);
      if (this.pos.y < gy) { this.pos.y = gy; this.vel.y = 0; }
      resolveCircle(city.colliders, this.pos.x, this.pos.z, this.radius, _res); if (_res.hit) { this.pos.x = _res.x; this.pos.z = _res.z; }
      this.mesh.rotation.x = damp(this.mesh.rotation.x, -Math.PI / 2, 6, dt);
      this.mesh.position.set(this.pos.x, this.pos.y + 0.4, this.pos.z);
      if (this.ragdollT <= 0) { this.state = 'foot'; this.mesh.rotation.x = 0; }
      this.clampBounds();
      return;
    }
    // --- on foot
    const weapons = this.game.weapons; const armed = !weapons.weapon.melee;
    const aiming = weapons.aiming || (armed && weapons.recoil > 0) || (weapons.target && input.fire);
    const mx = input.moveX, my = input.moveY; const mag = Math.hypot(mx, my);
    const run = input.sprint && mag > 0.3 && !aiming;
    const speedCap = aiming ? 2.6 : run ? 8 : 4.2;
    let tx = 0, tz = 0;
    if (mag > 0.05) {
      const fx = Math.sin(camYaw), fz = Math.cos(camYaw), rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
      const dx = fx * my + rx * mx, dz = fz * my + rz * mx; const l = Math.hypot(dx, dz) || 1;
      const s = Math.min(1, mag) * speedCap;
      tx = (dx / l) * s; tz = (dz / l) * s;
      if (!aiming) this.heading = dampAngle(this.heading, headingOf(dx, dz), 14, dt);
    }
    if (aiming) {
      const t = weapons.target;
      const want = t ? headingOf(t.pos.x - this.pos.x, t.pos.z - this.pos.z) : camYaw;
      this.heading = dampAngle(this.heading, want, 18, dt);
    }
    const accel = this.onGround ? 14 : 4;
    this.vel.x = damp(this.vel.x, tx, accel, dt); this.vel.z = damp(this.vel.z, tz, accel, dt);
    if (input.jump && this.onGround && this.jumpReady) { this.vel.y = 8.5; this.onGround = false; this.jumpReady = false; this.game.audio.jump(); }
    if (!input.jump) this.jumpReady = true;
    this.vel.y -= CFG.gravity * dt;
    this.pos.addScaledVector(this.vel, dt);
    const gy = city.groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= gy) { this.pos.y = gy; this.vel.y = 0; this.onGround = true; } else this.onGround = false;
    resolveCircle(city.colliders, this.pos.x, this.pos.z, this.radius, _res);
    if (_res.hit) { this.pos.x = _res.x; this.pos.z = _res.z; }
    // vehicles
    for (const v of this.game.vehicles) {
      const dx = this.pos.x - v.pos.x, dz = this.pos.z - v.pos.z; if (dx * dx + dz * dz > (v.type.l / 2 + 3) ** 2) continue;
      v.circles(_c);
      for (let k = 0; k < v.circleCount; k++) {
        const c = _c[k];
        let nx = this.pos.x - c.x, nz = this.pos.z - c.z; const d2 = nx * nx + nz * nz; const rr = v.radius + this.radius;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 0.001; nx /= d; nz /= d;
        this.pos.x = c.x + nx * rr; this.pos.z = c.z + nz * rr;
        const vs = v.speed;
        if (vs > 4 && this.invuln <= 0) this.hitByVehicle(v, nx, nz, vs);
      }
    }
    // peds (soft push)
    for (const p of this.game.peds.list) {
      if (p.state === 'dead' || p.state === 'down') continue;
      let nx = this.pos.x - p.pos.x, nz = this.pos.z - p.pos.z; const d2 = nx * nx + nz * nz; const rr = 0.75;
      if (d2 >= rr * rr || d2 < 1e-6) continue; const d = Math.sqrt(d2); nx /= d; nz /= d;
      this.pos.x += nx * (rr - d) * 0.5; this.pos.z += nz * (rr - d) * 0.5; p.pos.x -= nx * (rr - d) * 0.5; p.pos.z -= nz * (rr - d) * 0.5;
    }
    this.clampBounds();
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.human.baseY = this.pos.y;
    this.mesh.rotation.y = this.heading;
    this.human.animate(Math.hypot(this.vel.x, this.vel.z), dt);
    // weapon pose
    this.gun.visible = armed;
    if (armed && (aiming || weapons.recoil > 0)) { this.human.armR.rotation.x = -Math.PI / 2 + weapons.recoil * 0.3 - this.game.cam.pitch * 0.5; this.human.armR.rotation.y = 0; }
    else if (weapons.weapon.melee && weapons.recoil > 0) { this.human.armR.rotation.x = -1.6 * weapons.recoil; }
  }
  clampBounds() { this.game.city.clampToBounds(this.pos, 1); }
  hitByVehicle(v, nx, nz, vs) {
    this.state = 'ragdoll'; this.ragdollT = 1.6; this.invuln = 2.5;
    this.vel.set(v.vel.x * 0.9 + nx * 3, 5 + vs * 0.25, v.vel.z * 0.9 + nz * 3);
    this.damage(vs * 2.2);
    this.game.onPlayerHit?.(v, vs);
  }
  damage(a) {
    if (this.state === 'dead' || this.invuln > 0 && a < 50) { if (this.state !== 'dead' && this.invuln > 0) return; }
    this.health = Math.max(0, this.health - a);
    this.game.audio?.hurt(); this.game.hud?.flashDamage?.();
    if (this.health <= 0) this.game.onWasted();
  }
  updateCar(dt, input) {
    const v = this.vehicle;
    v.steer = clamp(input.moveX, -1, 1);
    v.throttle = clamp(Math.max(input.accel, input.moveY), 0, 1);
    v.brake = clamp(Math.max(input.brake, -input.moveY), 0, 1);
    v.handbrake = !!input.handbrake;
    this.pos.set(v.pos.x, v.y, v.pos.z);
    if (v.type.bike) { this.human.animate(0, dt); this.human.legL.rotation.x = -1.1; this.human.legR.rotation.x = -1.1; this.human.armL.rotation.x = -0.9; this.human.armR.rotation.x = -0.9; this.human.torso.rotation.x = 0.25; }
  }
  enterVehicle(v) {
    this.vehicle = v; v.driver = 'player'; v.playerOwned = true; this.state = 'car';
    this.vel.set(0, 0, 0); this.gun.visible = false;
    if (v.type.bike) { v.mesh.add(this.mesh); this.mesh.position.set(0, 0.55, -0.25); this.mesh.rotation.set(0, 0, 0); this.human.baseY = 0.55; }
    else this.human.setVisible(false);
    this.game.input.setMode('car');
  }
  exitVehicle() {
    const v = this.vehicle; if (!v) return;
    v.driver = null; v.throttle = 0; v.brake = 0.3; v.steer = 0; v.handbrake = false;
    if (v.type.bike) { this.game.scene.add(this.mesh); for (const part of [this.human.legL, this.human.legR, this.human.armL, this.human.armR, this.human.torso]) part.rotation.x = 0; }
    const lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
    this.pos.set(v.pos.x + lx * (v.type.w / 2 + 0.9), 0, v.pos.z + lz * (v.type.w / 2 + 0.9));
    this.heading = v.heading; this.vehicle = null; this.state = 'foot';
    this.human.setVisible(true); this.mesh.rotation.set(0, this.heading, 0); this.mesh.position.copy(this.pos);
    this.game.input.setMode('foot');
  }
}
