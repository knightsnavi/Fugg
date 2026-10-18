import * as THREE from 'three';
import { clamp, damp, fwdOf, rightOf } from './util.js';
import { resolveCircle } from './physics.js';
import { mat } from './characters.js';

export const CAR_TYPES = {
  sedan:  { name: 'Sedan',      w: 2.0, l: 4.5, h: 1.45, maxSpeed: 30, accel: 10, brake: 22, wheelbase: 2.7, cabin: [0.9, 0.55, 2.2, 0.1], cruise: [10, 14], mass: 1 },
  sports: { name: 'Sports',     w: 2.0, l: 4.3, h: 1.2,  maxSpeed: 42, accel: 15, brake: 26, wheelbase: 2.6, cabin: [0.9, 0.42, 1.8, -0.2], cruise: [12, 16], mass: 0.9 },
  muscle: { name: 'Muscle',     w: 2.1, l: 4.9, h: 1.35, maxSpeed: 38, accel: 13, brake: 22, wheelbase: 2.9, cabin: [0.85, 0.5, 1.9, -0.3], cruise: [11, 15], mass: 1.2 },
  van:    { name: 'Van',        w: 2.3, l: 5.4, h: 2.2,  maxSpeed: 24, accel: 7,  brake: 18, wheelbase: 3.3, cabin: [1.0, 0.0, 0, 0], cruise: [9, 12], mass: 1.6 },
  truck:  { name: 'Box Truck',  w: 2.5, l: 7.5, h: 3.0,  maxSpeed: 22, accel: 5,  brake: 16, wheelbase: 4.6, cabin: [1.0, 0.0, 0, 0], cruise: [8, 11], mass: 2.6 },
  bus:    { name: 'Bus',        w: 2.5, l: 10.5, h: 3.0, maxSpeed: 24, accel: 5,  brake: 16, wheelbase: 6.2, cabin: [1.0, 0.0, 0, 0], cruise: [8, 11], mass: 3.5 },
  taxi:   { name: 'Taxi',       w: 2.0, l: 4.5, h: 1.45, maxSpeed: 30, accel: 10, brake: 22, wheelbase: 2.7, cabin: [0.9, 0.55, 2.2, 0.1], cruise: [11, 14], mass: 1 },
  police: { name: 'Cruiser',    w: 2.0, l: 4.7, h: 1.45, maxSpeed: 38, accel: 14, brake: 26, wheelbase: 2.8, cabin: [0.9, 0.55, 2.2, 0.1], cruise: [11, 14], mass: 1.1, armor: 0.45 },
  bike:   { name: 'Motorcycle', w: 0.8, l: 2.2, h: 1.1,  maxSpeed: 46, accel: 16, brake: 24, wheelbase: 1.5, cabin: [0, 0, 0, 0], cruise: [12, 17], mass: 0.4, bike: true },
};
export const CAR_COLORS = [0xc0392b, 0x2980b9, 0xf1c40f, 0xecf0f1, 0x2c3e50, 0x27ae60, 0x8e44ad, 0xe67e22, 0x95a5a6, 0x1abc9c, 0x7f8c8d, 0xd35400, 0x34495e, 0xffffff, 0x111111];

const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 12); wheelGeo.rotateZ(Math.PI / 2);
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd3ff, roughness: 0.1, metalness: 0.4, transparent: true, opacity: 0.75 });
const headMat = new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffffcc, emissiveIntensity: 0.4 });
const tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2222, emissiveIntensity: 0.4 });

let _id = 0;
export class Vehicle {
  constructor(type = 'sedan', color = 0xc0392b) {
    this.id = _id++;
    this.typeName = type; this.type = CAR_TYPES[type];
    this.color = color;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.heading = 0;
    this.throttle = 0; this.brake = 0; this.steer = 0; this.steerAngle = 0; this.handbrake = false;
    this.health = 100; this.wrecked = false; this.driver = null; this.ai = null; this.playerOwned = false;
    this.wheelSpin = 0; this.lastImpact = 0; this.hornTimer = 0; this.y = 0;
    this.radius = Math.max(0.7, this.type.w / 2 + 0.15);
    this.circleCount = this.type.l > 6.5 ? 3 : 2;
    this.build();
  }
  build() {
    const t = this.type; const g = new THREE.Group(); this.mesh = g; g.userData.vehicle = this;
    this.bodyMat = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.35, metalness: 0.4 });
    const bodyH = this.typeName === 'bike' ? 0.35 : t.h * 0.5;
    if (this.typeName === 'bike') { this.buildBike(g); this.headlightGlow = headMat; return; }
    const body = new THREE.Mesh(new THREE.BoxGeometry(t.w, bodyH, t.l), this.bodyMat); body.position.y = 0.36 + bodyH / 2; body.castShadow = true; g.add(body);
    this.body = body;
    if (this.typeName === 'truck') {
      const box = new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h - bodyH, t.l * 0.68), mat(0xbfbfb8, { roughness: 0.8 })); box.position.set(0, 0.36 + bodyH + (t.h - bodyH) / 2, -t.l * 0.14); box.castShadow = true; g.add(box);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(t.w * 0.96, 1.3, t.l * 0.22), this.bodyMat); cab.position.set(0, 0.36 + bodyH + 0.65, t.l * 0.36); cab.castShadow = true; g.add(cab);
      const win = new THREE.Mesh(new THREE.BoxGeometry(t.w * 0.9, 0.6, t.l * 0.23), glassMat); win.position.set(0, 0.36 + bodyH + 0.85, t.l * 0.36); g.add(win);
    } else if (this.typeName === 'bus') {
      const top = new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h - bodyH, t.l * 0.98), this.bodyMat); top.position.set(0, 0.36 + bodyH + (t.h - bodyH) / 2, 0); top.castShadow = true; g.add(top);
      const win = new THREE.Mesh(new THREE.BoxGeometry(t.w + 0.04, 0.8, t.l * 0.9), glassMat); win.position.set(0, 0.36 + bodyH + 1.0, 0); g.add(win);
    } else if (this.typeName === 'van') {
      const top = new THREE.Mesh(new THREE.BoxGeometry(t.w * 0.96, t.h - bodyH, t.l * 0.75), this.bodyMat); top.position.set(0, 0.36 + bodyH + (t.h - bodyH) / 2, -t.l * 0.1); top.castShadow = true; g.add(top);
      const win = new THREE.Mesh(new THREE.BoxGeometry(t.w * 0.9, 0.6, t.l * 0.2), glassMat); win.position.set(0, 0.36 + bodyH + 0.35, t.l * 0.32); g.add(win);
    } else {
      const [cw, ch, cl, cz] = t.cabin;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(t.w * cw, ch, cl), this.bodyMat); cabin.position.set(0, 0.36 + bodyH + ch / 2, cz); cabin.castShadow = true; g.add(cabin);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(t.w * cw + 0.02, ch * 0.7, cl + 0.02), glassMat); glass.position.set(0, 0.36 + bodyH + ch * 0.4, cz); g.add(glass);
    }
    // lights
    for (const s of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.08), headMat); hl.position.set(s * (t.w / 2 - 0.3), 0.36 + bodyH * 0.6, t.l / 2 + 0.02); g.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.08), tailMat); tl.position.set(s * (t.w / 2 - 0.3), 0.36 + bodyH * 0.6, -t.l / 2 - 0.02); g.add(tl);
    }
    // wheels
    this.wheels = [];
    const wb = t.wheelbase / 2;
    const wheelPos = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
    if (this.circleCount === 3) wheelPos.push([1, 0.1], [-1, 0.1]);
    for (const [sx, sz] of wheelPos) {
      const pivot = new THREE.Group(); pivot.position.set(sx * (t.w / 2 - 0.1), 0.36, sz * wb);
      const w = new THREE.Mesh(wheelGeo, wheelMat); w.castShadow = true; pivot.add(w); g.add(pivot);
      this.wheels.push({ pivot, mesh: w, front: sz > 0.5 });
    }
    if (this.typeName === 'police') {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.35), mat(0x222222)); bar.position.set(0, 0.36 + bodyH + t.cabin[1] + 0.09, t.cabin[3]); g.add(bar);
      this.lightA = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.3), new THREE.MeshStandardMaterial({ color: 0x2222ff, emissive: 0x2222ff, emissiveIntensity: 0 })); this.lightA.position.set(0.35, 0.02, 0); bar.add(this.lightA);
      this.lightB = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.3), new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 0 })); this.lightB.position.set(-0.35, 0.02, 0); bar.add(this.lightB);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(t.w + 0.02, bodyH * 0.4, t.l * 0.5), mat(0xffffff)); stripe.position.set(0, 0.36 + bodyH / 2, 0); g.add(stripe);
    }
    if (this.typeName === 'taxi') {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 0.3), new THREE.MeshStandardMaterial({ color: 0xffdd33, emissive: 0xffcc00, emissiveIntensity: 0.4 })); sign.position.set(0, 0.36 + bodyH + t.cabin[1] + 0.11, t.cabin[3]); g.add(sign);
    }
    this.headlightGlow = headMat;
  }
  buildBike(g) {
    const t = this.type;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 1.5), this.bodyMat); frame.position.y = 0.6; frame.castShadow = true; g.add(frame); this.body = frame;
    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.6), this.bodyMat); tank.position.set(0, 0.85, 0.25); g.add(tank);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.7), mat(0x1a1a1a)); seat.position.set(0, 0.86, -0.35); g.add(seat);
    const engine = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.5), mat(0x555555, { metalness: 0.6, roughness: 0.4 })); engine.position.set(0, 0.5, 0.1); g.add(engine);
    const bars = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.06), mat(0x333333)); bars.position.set(0, 1.05, 0.75); g.add(bars);
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.1), headMat); hl.position.set(0, 0.9, 0.95); g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.08), tailMat); tl.position.set(0, 0.8, -1.05); g.add(tl);
    this.wheels = [];
    const bikeWheel = new THREE.CylinderGeometry(0.34, 0.34, 0.12, 12); bikeWheel.rotateZ(Math.PI / 2);
    for (const sz of [1, -1]) {
      const pivot = new THREE.Group(); pivot.position.set(0, 0.34, sz * t.wheelbase / 2);
      const w = new THREE.Mesh(bikeWheel, wheelMat); w.castShadow = true; pivot.add(w); g.add(pivot);
      this.wheels.push({ pivot, mesh: w, front: sz > 0 });
    }
    this.bikeParts = g.children.slice();
  }
  setPose(x, z, heading) { this.pos.set(x, 0, z); this.heading = heading; this.vel.set(0, 0, 0); this.syncMesh(); }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  forwardSpeed() { return this.vel.x * Math.sin(this.heading) + this.vel.z * Math.cos(this.heading); }
  /** two collision circles (front/back) */
  circles(out) {
    const f = fwdOf(this.heading, _f); const d = Math.max(0.3, this.type.l / 2 - this.radius);
    out[0].x = this.pos.x + f.x * d; out[0].z = this.pos.z + f.z * d;
    out[1].x = this.pos.x - f.x * d; out[1].z = this.pos.z - f.z * d;
    if (this.circleCount === 3) { out[2].x = this.pos.x; out[2].z = this.pos.z; }
    return out;
  }
  damage(amount, world) {
    if (this.wrecked) return;
    this.health -= amount;
    if (this.health <= 0) { this.health = 0; this.wrecked = true; this.bodyMat.color.setHex(0x1e1e1e); this.bodyMat.roughness = 0.95; this.bodyMat.metalness = 0; world?.onWrecked?.(this); }
  }
  update(dt, world) {
    const t = this.type;
    const f = fwdOf(this.heading, _f), r = rightOf(this.heading, _r);
    let vLong = this.vel.x * f.x + this.vel.z * f.z;
    let vLat = this.vel.x * r.x + this.vel.z * r.z;
    const wrecked = this.wrecked;
    const throttle = wrecked ? 0 : this.throttle, brake = wrecked ? 0 : this.brake;
    if (throttle > 0) vLong += t.accel * throttle * dt * (vLong < 0 ? 2 : 1);
    if (brake > 0) { if (vLong > 0.3) vLong -= t.brake * brake * dt; else vLong -= t.accel * 0.45 * brake * dt; }
    if (this.handbrake && !wrecked) vLong -= Math.sign(vLong) * Math.min(Math.abs(vLong), 8 * dt);
    vLong = clamp(vLong, -t.maxSpeed * 0.35, t.maxSpeed);
    // drag + rolling resistance
    vLong -= vLong * (0.25 + Math.abs(vLong) * 0.01) * dt;
    if (throttle === 0 && brake === 0 && Math.abs(vLong) < 0.15) vLong = 0;
    const grip = this.handbrake ? 1.6 : 7.5;
    vLat *= Math.exp(-grip * dt);
    if (Math.abs(vLat) < 0.02) vLat = 0;
    // steering
    const maxSteer = 0.6 / (1 + Math.abs(vLong) * 0.045);
    this.steerAngle = damp(this.steerAngle, (wrecked ? 0 : this.steer) * maxSteer, 9, dt);
    const turnRate = (vLong / t.wheelbase) * Math.tan(this.steerAngle);
    this.vel.set(f.x * vLong + r.x * vLat, 0, f.z * vLong + r.z * vLat);
    this.heading -= turnRate * dt;
    if (this.handbrake && Math.abs(vLong) > 4) this.heading -= this.steer * 1.4 * dt;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;

    // collisions with world (two circles)
    const cs = this.circles(_circles); let impact = 0;
    for (let k = 0; k < this.circleCount; k++) {
      const c = cs[k];
      resolveCircle(world.city.colliders, c.x, c.z, this.radius, _res);
      if (_res.hit) {
        const px = _res.x - c.x, pz = _res.z - c.z;
        this.pos.x += px; this.pos.z += pz;
        const vn = this.vel.x * _res.nx + this.vel.z * _res.nz;
        if (vn < 0) { this.vel.x -= _res.nx * vn * 1.3; this.vel.z -= _res.nz * vn * 1.3; impact = Math.max(impact, -vn); }
        // glancing: nudge heading away from wall
        const side = (k === 0 ? 1 : -1) * (f.x * _res.nz - f.z * _res.nx);
        this.heading += side * Math.min(1, Math.abs(vn) * 0.05) * dt * 3;
      }
    }
    // keep on island
    const bx = this.pos.x, bz = this.pos.z; world.city.clampToBounds(this.pos, 1.5);
    if (bx !== this.pos.x) this.vel.x *= -0.3; if (bz !== this.pos.z) this.vel.z *= -0.3;
    if (impact > 5) { this.damage(Math.min(35, (impact - 4) * 2) * (this.type.armor || 1), world); this.lastImpact = impact; world.onImpact?.(this, impact); }
    // ground height (sidewalk)
    this.y = damp(this.y, world.city.groundHeight(this.pos.x, this.pos.z), 12, dt);
    this.wheelSpin += vLong / 0.36 * dt;
    this.syncMesh();
  }
  syncMesh() {
    this.mesh.position.set(this.pos.x, this.y, this.pos.z);
    this.mesh.rotation.y = this.heading;
    const f = fwdOf(this.heading, _f), r = rightOf(this.heading, _r);
    const vLat = this.vel.x * r.x + this.vel.z * r.z;
    if (this.type.bike) { const lean = clamp(this.steerAngle * Math.min(1, this.speed / 8) * 1.2 + vLat * 0.03, -0.5, 0.5); this.mesh.rotation.z = -lean; }
    else this.body.rotation.z = clamp(vLat * 0.012, -0.08, 0.08);
    for (const w of this.wheels) { w.mesh.rotation.x = this.wheelSpin; w.pivot.rotation.y = w.front ? -this.steerAngle : 0; }
    void f;
  }
}
const _f = new THREE.Vector3(), _r = new THREE.Vector3();
const _circles = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];
const _res = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };

/** Resolve collisions between two vehicles (equal-ish mass impulse). Returns impact magnitude. */
const _ca = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }], _cb = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];
export function collideVehicles(a, b) {
  const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
  const reach = a.type.l / 2 + b.type.l / 2 + 1;
  if (dx * dx + dz * dz > reach * reach) return 0;
  a.circles(_ca); b.circles(_cb);
  let impact = 0;
  const ma = a.type.mass, mb = b.type.mass, wa = mb / (ma + mb), wb = ma / (ma + mb);
  for (let i = 0; i < a.circleCount; i++) for (let j = 0; j < b.circleCount; j++) {
    const ca = _ca[i], cb = _cb[j];
    let nx = ca.x - cb.x, nz = ca.z - cb.z; const d2 = nx * nx + nz * nz; const rr = a.radius + b.radius;
    if (d2 >= rr * rr || d2 < 1e-6) continue;
    const d = Math.sqrt(d2); nx /= d; nz /= d; const pen = rr - d;
    a.pos.x += nx * pen * wa; a.pos.z += nz * pen * wa; b.pos.x -= nx * pen * wb; b.pos.z -= nz * pen * wb;
    ca.x += nx * pen * wa; ca.z += nz * pen * wa; cb.x -= nx * pen * wb; cb.z -= nz * pen * wb;
    const rvx = a.vel.x - b.vel.x, rvz = a.vel.z - b.vel.z; const vn = rvx * nx + rvz * nz;
    if (vn < 0) {
      const j = -(1 + 0.3) * vn;
      a.vel.x += nx * j * wa; a.vel.z += nz * j * wa; b.vel.x -= nx * j * wb; b.vel.z -= nz * j * wb;
      impact = Math.max(impact, -vn);
    }
  }
  return impact;
}
