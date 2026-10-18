import * as THREE from 'three';
import { clamp, damp, dampAngle, angleDiff } from './util.js';

const _tmp = [];
export class ThirdPersonCamera {
  constructor(camera, city) {
    this.camera = camera; this.city = city;
    this.yaw = 0; this.pitch = 0.32; this.dist = 6; this.idle = 0; this.mode = 0; // 0 near, 1 far, 2 hood/close
    this.pos = new THREE.Vector3(); this.look = new THREE.Vector3();
    this.shake = 0;
  }
  toggleMode() { this.mode = (this.mode + 1) % 3; }
  update(dt, player, input, aiming = false) {
    const inCar = player.state === 'car';
    const look = Math.abs(input.lookX) + Math.abs(input.lookY) > 1e-4;
    this.yaw -= input.lookX; this.pitch = clamp(this.pitch + input.lookY, -0.35, 1.2);
    if (look) this.idle = 0; else this.idle += dt;
    // auto-align behind the vehicle after a short idle
    if (inCar && this.idle > 1.0) {
      const v = player.vehicle; const fs = v.forwardSpeed();
      const target = fs < -1.5 ? v.heading + Math.PI : v.heading;
      const rate = clamp(Math.abs(fs) * 0.25, 0.8, 4);
      this.yaw = dampAngle(this.yaw, target, rate, dt);
      this.pitch = damp(this.pitch, 0.22, 1.5, dt);
    } else if (!inCar && this.idle > 2.5 && Math.hypot(player.vel.x, player.vel.z) > 1) {
      if (Math.abs(angleDiff(this.yaw, player.heading)) < 2.4) this.yaw = dampAngle(this.yaw, player.heading, 0.8, dt);
    }
    const base = aiming ? 2.6 : inCar ? [7.5, 11, 4.5][this.mode] : [5.5, 8.5, 3][this.mode];
    const speedZoom = inCar ? Math.min(3, player.vehicle.speed * 0.06) : 0;
    this.dist = damp(this.dist, base + speedZoom, aiming ? 10 : 4, dt);
    const h = inCar ? 1.3 : aiming ? 1.6 : 1.5;
    const tp = player.worldPos;
    this.look.set(tp.x, (inCar ? player.vehicle.y : player.pos.y) + h, tp.z);
    if (aiming) { this.look.x += -Math.cos(this.yaw) * 0.7; this.look.z += Math.sin(this.yaw) * 0.7; } // over the right shoulder
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dx = -Math.sin(this.yaw) * cp, dz = -Math.cos(this.yaw) * cp, dy = sp;
    // collide camera ray against buildings
    let d = this.dist;
    const hash = this.city.colliders;
    for (let s = 1.0; s < this.dist; s += 0.5) {
      const x = this.look.x + dx * s, z = this.look.z + dz * s, y = this.look.y + dy * s;
      const boxes = hash.query(x - 0.3, x + 0.3, z - 0.3, z + 0.3, _tmp);
      let blocked = false;
      for (const b of boxes) { if (b.kind !== 'building') continue; if (x > b.minX - 0.3 && x < b.maxX + 0.3 && z > b.minZ - 0.3 && z < b.maxZ + 0.3 && y < b.height) { blocked = true; break; } }
      if (blocked) { d = Math.max(1.0, s - 0.9); break; }
    }
    this.pos.set(this.look.x + dx * d, Math.max(0.6, this.look.y + dy * d), this.look.z + dz * d);
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 3); this.pos.x += (Math.random() - 0.5) * this.shake * 0.5; this.pos.y += (Math.random() - 0.5) * this.shake * 0.5; }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
