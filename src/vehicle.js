import * as THREE from 'three';
import { RoundedBoxGeometry } from '../vendor/jsm/geometries/RoundedBoxGeometry.js';
import { clamp, damp, fwdOf, rightOf } from './util.js';
import { resolveCircle } from './physics.js';
import { mat } from './characters.js';

export const CAR_TYPES = {
  sedan:  { name: 'Sedan',      w: 1.95, l: 4.5, h: 1.45, maxSpeed: 30, accel: 10, brake: 22, wheelbase: 2.7, cruise: [10, 14], mass: 1, wheelR: 0.34 },
  sports: { name: 'Sports',     w: 1.98, l: 4.3, h: 1.2,  maxSpeed: 42, accel: 15, brake: 26, wheelbase: 2.6, cruise: [12, 16], mass: 0.9, wheelR: 0.35, spoiler: true },
  muscle: { name: 'Muscle',     w: 2.05, l: 4.9, h: 1.35, maxSpeed: 38, accel: 13, brake: 22, wheelbase: 2.9, cruise: [11, 15], mass: 1.2, wheelR: 0.37, spoiler: true },
  van:    { name: 'Van',        w: 2.2,  l: 5.4, h: 2.2,  maxSpeed: 24, accel: 7,  brake: 18, wheelbase: 3.3, cruise: [9, 12], mass: 1.6, wheelR: 0.36 },
  truck:  { name: 'Box Truck',  w: 2.5,  l: 7.5, h: 3.0,  maxSpeed: 22, accel: 5,  brake: 16, wheelbase: 4.6, cruise: [8, 11], mass: 2.6, wheelR: 0.45 },
  bus:    { name: 'Bus',        w: 2.5,  l: 10.5, h: 3.0, maxSpeed: 24, accel: 5,  brake: 16, wheelbase: 6.2, cruise: [8, 11], mass: 3.5, wheelR: 0.45 },
  taxi:   { name: 'Taxi',       w: 1.95, l: 4.5, h: 1.45, maxSpeed: 30, accel: 10, brake: 22, wheelbase: 2.7, cruise: [11, 14], mass: 1, wheelR: 0.34 },
  police: { name: 'Cruiser',    w: 1.98, l: 4.7, h: 1.45, maxSpeed: 38, accel: 14, brake: 26, wheelbase: 2.8, cruise: [11, 14], mass: 1.1, armor: 0.45, wheelR: 0.35 },
  bike:   { name: 'Motorcycle', w: 0.8,  l: 2.2, h: 1.1,  maxSpeed: 46, accel: 16, brake: 24, wheelbase: 1.5, cruise: [12, 17], mass: 0.4, bike: true, wheelR: 0.33 },
};
export const CAR_COLORS = [0x9b1c1c, 0x1f4e8c, 0xd4b32a, 0xe8e8e8, 0x1c2430, 0x2a7a3a, 0x5a2d82, 0xc9571a, 0x8a8f96, 0x1b8a80, 0x3a3f45, 0x7a1f3a, 0x2f3a4a, 0xf4f4f4, 0x0f0f12, 0x6b4a2a, 0xa86f2a];

// side profiles (z from front to back, y height); the extrude gives the body its silhouette
const PROFILES = {
  sedan:  [[2.25, 0.38], [2.25, 0.72], [1.25, 0.82], [0.6, 1.4], [-0.7, 1.43], [-1.45, 0.98], [-2.22, 0.92], [-2.25, 0.38]],
  sports: [[2.15, 0.32], [2.15, 0.6], [0.95, 0.74], [0.25, 1.16], [-0.85, 1.18], [-1.55, 0.86], [-2.13, 0.82], [-2.15, 0.32]],
  muscle: [[2.45, 0.36], [2.45, 0.8], [0.95, 0.88], [0.4, 1.33], [-0.75, 1.35], [-1.45, 0.98], [-2.43, 0.92], [-2.45, 0.36]],
  van:    [[2.7, 0.38], [2.7, 0.95], [2.25, 1.05], [1.65, 2.12], [-2.62, 2.17], [-2.7, 0.38]],
  bus:    [[5.25, 0.42], [5.25, 2.75], [5.0, 3.0], [-5.0, 3.0], [-5.25, 2.75], [-5.25, 0.42]],
  truckCab: [[3.75, 0.42], [3.75, 1.05], [3.3, 1.15], [2.9, 2.62], [1.95, 2.7], [1.9, 0.42]],
};
PROFILES.taxi = PROFILES.sedan; PROFILES.police = PROFILES.sedan;
// window indices into the profile: [hoodBack, roofFront, roofBack, trunkFront]
const WINDOWS = { sedan: [2, 3, 4, 5], sports: [2, 3, 4, 5], muscle: [2, 3, 4, 5], van: [2, 3, 4, 4], truckCab: [2, 3, 4, 4] };
WINDOWS.taxi = WINDOWS.sedan; WINDOWS.police = WINDOWS.sedan;

let HIGH_QUALITY = true;
export function setVehicleQuality(high) { HIGH_QUALITY = high; }
const glassMat = new THREE.MeshStandardMaterial({ color: 0x18222e, roughness: 0.12, metalness: 0.85 });
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.25, metalness: 0.95 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.7, metalness: 0.2 });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 });
const plateMat = new THREE.MeshStandardMaterial({ color: 0xe8e4d0, roughness: 0.6 });
const geoCache = new Map();
function bodyGeometry(key, w) {
  const ck = key + w; if (geoCache.has(ck)) return geoCache.get(ck);
  const pts = PROFILES[key]; const shape = new THREE.Shape(); shape.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]); shape.closePath();
  const b = 0.07; const g = new THREE.ExtrudeGeometry(shape, { depth: w - b * 2, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 4 });
  g.rotateY(-Math.PI / 2); g.translate(w / 2 - b, 0, 0); g.computeVertexNormals(); geoCache.set(ck, g); return g;
}
function wheelGeo(r, wdt) { const k = 'w' + r + wdt; if (geoCache.has(k)) return geoCache.get(k); const g = new THREE.Group(); const tire = new THREE.CylinderGeometry(r, r, wdt, 20); tire.rotateZ(Math.PI / 2); const rim = new THREE.CylinderGeometry(r * 0.62, r * 0.62, wdt + 0.02, 12); rim.rotateZ(Math.PI / 2); const hub = new THREE.CylinderGeometry(r * 0.2, r * 0.2, wdt + 0.05, 8); hub.rotateZ(Math.PI / 2); g.userData = { tire, rim, hub }; geoCache.set(k, g.userData); return g.userData; }

let _id = 0;
export class Vehicle {
  constructor(type = 'sedan', color = 0xc0392b) {
    this.id = _id++;
    this.typeName = type; this.type = CAR_TYPES[type];
    this.color = color;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.heading = 0;
    this.throttle = 0; this.brake = 0; this.steer = 0; this.steerAngle = 0; this.handbrake = false;
    this.health = 100; this.wrecked = false; this.driver = null; this.ai = null; this.playerOwned = false;
    this.wheelSpin = 0; this.lastImpact = 0; this.y = 0; this.accelVis = 0; this.lastFwd = 0;
    this.radius = Math.max(0.7, this.type.w / 2 + 0.15);
    this.circleCount = this.type.l > 6.5 ? 3 : 2;
    this.build();
  }
  build() {
    const t = this.type; const g = new THREE.Group(); this.mesh = g; g.userData.vehicle = this;
    this.bodyMat = HIGH_QUALITY
      ? new THREE.MeshPhysicalMaterial({ color: this.color, roughness: 0.32, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.08 })
      : new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.3, metalness: 0.5 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x6a0a0a, emissive: 0xff2020, emissiveIntensity: 0.25, roughness: 0.3 });
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xf4f4ec, emissive: 0xfff6d0, emissiveIntensity: 0.2, roughness: 0.2 });
    this.reverseMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3 });
    this.body = new THREE.Group(); g.add(this.body);
    if (this.typeName === 'bike') { this.buildBike(); this.buildWheels([[0, 1], [0, -1]], 0.12); return; }
    const key = this.typeName === 'truck' ? 'truckCab' : this.typeName;
    const shell = new THREE.Mesh(bodyGeometry(key, t.w), this.bodyMat); shell.castShadow = true; shell.receiveShadow = true; this.body.add(shell);
    const prof = PROFILES[key];
    // windows
    const wi = WINDOWS[key];
    if (wi) {
      const P = (i) => prof[i];
      const glassQuad = (a, b, sign) => { const [za, ya] = a, [zb, yb] = b; const len = Math.hypot(zb - za, yb - ya); const m = new THREE.Mesh(new THREE.BoxGeometry(t.w * 0.84, len - 0.08, 0.03), glassMat); const dz = zb - za, dy = yb - ya; m.rotation.x = Math.atan2(dz, dy); const nl = Math.hypot(dz, dy); m.position.set(0, (ya + yb) / 2 + (dy / nl) * 0 + (-dz / nl) * 0.035 * sign, (za + zb) / 2 + (dy / nl) * 0.035 * sign); this.body.add(m); };
      glassQuad(P(wi[0]), P(wi[1]), 1);                // windshield
      if (wi[2] !== wi[3]) glassQuad(P(wi[2]), P(wi[3]), 1); // rear window
      // side windows: trapezoid
      const hb = P(wi[0]), rf = P(wi[1]), rb = P(wi[2]), tf = P(wi[3]);
      const belt = hb[1] + 0.1; const roofY = Math.min(rf[1], rb[1]) - 0.06;
      const shp = new THREE.Shape(); shp.moveTo(hb[0] - 0.05, belt); shp.lineTo(rf[0] - 0.12, roofY); shp.lineTo(rb[0] + 0.1, roofY); shp.lineTo((wi[2] === wi[3] ? rb[0] - 0.4 : tf[0] + 0.05), belt); shp.closePath();
      const sg = new THREE.ExtrudeGeometry(shp, { depth: 0.03, bevelEnabled: false }); sg.rotateY(-Math.PI / 2);
      for (const s of [-1, 1]) { const m = new THREE.Mesh(sg, glassMat); m.position.x = s * (t.w / 2 - 0.04) + (s > 0 ? 0 : -0.03); this.body.add(m); if (this.typeName === 'bus' || this.typeName === 'van') m.scale.z = 1; }
      // b-pillar
      const pil = new THREE.Mesh(new THREE.BoxGeometry(t.w + 0.02, roofY - belt, 0.08), this.bodyMat); pil.position.set(0, (belt + roofY) / 2, (rf[0] + rb[0]) / 2 - 0.1); this.body.add(pil);
      // mirrors
      for (const s of [-1, 1]) { const mr = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.1, 0.2, 2, 0.03), this.bodyMat); mr.position.set(s * (t.w / 2 + 0.1), belt + 0.08, hb[0] - 0.15); this.body.add(mr); }
    }
    if (this.typeName === 'bus') {
      for (const s of [-1, 1]) { const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.0, t.l * 0.9), glassMat); strip.position.set(s * (t.w / 2 - 0.0), 1.95, 0); this.body.add(strip); }
      const front = new THREE.Mesh(new THREE.BoxGeometry(t.w * 0.9, 1.2, 0.03), glassMat); front.position.set(0, 2.0, t.l / 2 + 0.0); this.body.add(front);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.0, 1.0), darkMat); door.position.set(-(t.w / 2), 1.4, t.l / 2 - 1.6); this.body.add(door);
    }
    if (this.typeName === 'truck') {
      const box = new THREE.Mesh(new RoundedBoxGeometry(t.w, 2.6, 5.4, 2, 0.06), mat(0xbdbab2, { roughness: 0.85 })); box.position.set(0, 0.55 + 1.3, -1.05); box.castShadow = true; this.body.add(box);
      for (let k = 0; k < 6; k++) { const rib = new THREE.Mesh(new THREE.BoxGeometry(t.w + 0.04, 2.5, 0.06), mat(0xa9a69e)); rib.position.set(0, 1.85, -1.05 - 2.5 + k * 1.0); this.body.add(rib); }
      const front = new THREE.Mesh(new THREE.BoxGeometry(t.w * 0.9, 1.0, 0.03), glassMat); front.position.set(0, 2.0, 3.32); front.rotation.x = -0.25; this.body.add(front);
    }
    // bumpers, grille, plates, lights
    const bh = prof[0][1];
    const front = prof[0][0], back = prof[prof.length - 1][0];
    for (const [z, sgn] of [[front, 1], [back, -1]]) {
      const bumper = new THREE.Mesh(new RoundedBoxGeometry(t.w * 0.98, 0.2, 0.28, 2, 0.06), darkMat); bumper.position.set(0, bh + 0.06, z + sgn * 0.06); this.body.add(bumper);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.13, 0.02), plateMat); plate.position.set(0, bh + 0.32, z + sgn * 0.17); this.body.add(plate);
    }
    const grille = new THREE.Mesh(new THREE.BoxGeometry(t.w * 0.45, 0.16, 0.05), darkMat); grille.position.set(0, prof[1][1] - 0.14, front + 0.02); this.body.add(grille);
    const lw = t.w > 2.3 ? 0.4 : 0.34;
    for (const s of [-1, 1]) {
      const hl = new THREE.Mesh(new RoundedBoxGeometry(lw, 0.17, 0.1, 2, 0.04), this.headMat); hl.position.set(s * (t.w / 2 - lw / 2 - 0.08), prof[1][1] - 0.12, front + 0.03); this.body.add(hl);
      const tl = new THREE.Mesh(new RoundedBoxGeometry(lw, 0.16, 0.1, 2, 0.04), this.tailMat); tl.position.set(s * (t.w / 2 - lw / 2 - 0.08), prof[prof.length - 2][1] - 0.12, back - 0.03); this.body.add(tl);
      const rv = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.06), this.reverseMat); rv.position.set(s * (t.w / 2 - lw - 0.2), prof[prof.length - 2][1] - 0.12, back - 0.03); this.body.add(rv);
    }
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.3, 8), chromeMat); exhaust.rotation.x = Math.PI / 2; exhaust.position.set(-t.w / 2 + 0.3, bh - 0.02, back - 0.05); this.body.add(exhaust);
    if (t.spoiler) { const sp = new THREE.Mesh(new RoundedBoxGeometry(t.w * 0.9, 0.06, 0.3, 2, 0.02), this.bodyMat); sp.position.set(0, prof[prof.length - 2][1] + 0.28, back + 0.25); this.body.add(sp); for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.1), darkMat); post.position.set(s * t.w * 0.35, prof[prof.length - 2][1] + 0.14, back + 0.25); this.body.add(post); } }
    if (this.typeName === 'police') {
      const roofY = prof[WINDOWS.sedan[1]][1]; const z = (prof[3][0] + prof[4][0]) / 2;
      const bar = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.14, 0.32, 2, 0.04), darkMat); bar.position.set(0, roofY + 0.07, z); this.body.add(bar);
      this.lightA = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.16, 0.26, 2, 0.04), new THREE.MeshStandardMaterial({ color: 0x2222ff, emissive: 0x3333ff, emissiveIntensity: 0 })); this.lightA.position.set(0.33, 0.04, 0); bar.add(this.lightA);
      this.lightB = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.16, 0.26, 2, 0.04), new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff3333, emissiveIntensity: 0 })); this.lightB.position.set(-0.33, 0.04, 0); bar.add(this.lightB);
      for (const s of [-1, 1]) { const door = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 1.6), mat(0xf2f2f2, { roughness: 0.35, metalness: 0.4 })); door.position.set(s * (t.w / 2 + 0.005), 0.72, 0.1); this.body.add(door); }
      const hood = new THREE.Mesh(new THREE.BoxGeometry(t.w * 0.6, 0.02, 1.0), mat(0xf2f2f2, { roughness: 0.35, metalness: 0.4 })); hood.position.set(0, prof[2][1] + 0.0, 1.7); hood.rotation.x = -0.1; this.body.add(hood);
    }
    if (this.typeName === 'taxi') {
      const roofY = prof[3][1]; const z = (prof[3][0] + prof[4][0]) / 2;
      const sign = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.22, 0.28, 2, 0.05), new THREE.MeshStandardMaterial({ color: 0xffdd33, emissive: 0xffcc00, emissiveIntensity: 0.35 })); sign.position.set(0, roofY + 0.11, z); this.body.add(sign);
      const check = new THREE.Mesh(new THREE.BoxGeometry(t.w + 0.02, 0.12, 2.4), mat(0x111111)); check.position.set(0, 0.62, 0); this.body.add(check);
    }
    const wb = t.wheelbase / 2; const pos = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
    if (this.circleCount === 3) pos.push([1, 0.1], [-1, 0.1]);
    this.buildWheels(pos, t.w > 2.3 ? 0.32 : 0.24, wb);
    this.body.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  }
  buildWheels(pos, width, wb = this.type.wheelbase / 2) {
    const t = this.type; const r = t.wheelR; const wg = wheelGeo(r, width); this.wheels = [];
    for (const [sx, sz] of pos) {
      const pivot = new THREE.Group(); pivot.position.set(sx * (t.w / 2 - width / 2 + 0.02), r, sz * wb);
      const spin = new THREE.Group(); pivot.add(spin);
      const tire = new THREE.Mesh(wg.tire, tireMat); tire.castShadow = true; spin.add(tire);
      spin.add(new THREE.Mesh(wg.rim, chromeMat)); spin.add(new THREE.Mesh(wg.hub, darkMat));
      this.mesh.add(pivot); this.wheels.push({ pivot, spin, front: sz > 0.5 });
    }
  }
  buildBike() {
    const b = this.body; const t = this.type;
    const frame = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.26, 1.3, 2, 0.06), this.bodyMat); frame.position.set(0, 0.62, 0.05); frame.rotation.x = 0.08; b.add(frame);
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.35, 4, 10), this.bodyMat); tank.rotation.x = Math.PI / 2; tank.scale.set(1, 1, 0.75); tank.position.set(0, 0.88, 0.3); b.add(tank);
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.1, 0.7, 2, 0.04), darkMat); seat.position.set(0, 0.86, -0.35); b.add(seat);
    const engine = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.36, 0.5, 2, 0.05), chromeMat); engine.position.set(0, 0.5, 0.15); b.add(engine);
    for (const s of [-1, 1]) { const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 1.1, 8), chromeMat); pipe.rotation.x = Math.PI / 2; pipe.position.set(s * 0.2, 0.42, -0.45); b.add(pipe); }
    for (const s of [-1, 1]) { const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6), chromeMat); fork.rotation.x = 0.45; fork.position.set(s * 0.09, 0.65, 0.78); b.add(fork); }
    const bars = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 6), darkMat); bars.rotation.z = Math.PI / 2; bars.position.set(0, 1.04, 0.62); b.add(bars);
    const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.12, 10), this.headMat); hl.rotation.x = Math.PI / 2; hl.position.set(0, 0.92, 0.9); b.add(hl);
    const tl = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.08, 0.06, 2, 0.02), this.tailMat); tl.position.set(0, 0.8, -1.05); b.add(tl);
    const fender = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.14, 12, 1, false, Math.PI * 0.55, Math.PI * 0.9), this.bodyMat); fender.rotation.z = Math.PI / 2; fender.position.set(0, 0.36, -0.75); b.add(fender);
    b.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    void t;
  }
  setPose(x, z, heading) { this.pos.set(x, 0, z); this.heading = heading; this.vel.set(0, 0, 0); this.syncMesh(); }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  forwardSpeed() { return this.vel.x * Math.sin(this.heading) + this.vel.z * Math.cos(this.heading); }
  circles(out) {
    const f = fwdOf(this.heading, _f); const d = Math.max(0.3, this.type.l / 2 - this.radius);
    out[0].x = this.pos.x + f.x * d; out[0].z = this.pos.z + f.z * d;
    out[1].x = this.pos.x - f.x * d; out[1].z = this.pos.z - f.z * d;
    if (this.circleCount === 3) { out[2].x = this.pos.x; out[2].z = this.pos.z; }
    return out;
  }
  /** world position of a rear wheel (side -1/1) for skid marks / exhaust */
  rearWheelPos(side, out) { const f = fwdOf(this.heading, _f), r = rightOf(this.heading, _r); const wb = this.type.wheelbase / 2; out.set(this.pos.x - f.x * wb + r.x * side * (this.type.w / 2 - 0.15), 0.03, this.pos.z - f.z * wb + r.z * side * (this.type.w / 2 - 0.15)); return out; }
  damage(amount, world) {
    if (this.wrecked) return;
    this.health -= amount;
    if (this.health <= 0) { this.health = 0; this.wrecked = true; this.bodyMat.color.setHex(0x1e1e1e); this.bodyMat.roughness = 0.95; this.bodyMat.metalness = 0; if (this.bodyMat.clearcoat !== undefined) this.bodyMat.clearcoat = 0; this.headMat.emissiveIntensity = 0; this.tailMat.emissiveIntensity = 0; world?.onWrecked?.(this); }
  }
  update(dt, world) {
    const t = this.type;
    const f = fwdOf(this.heading, _f), r = rightOf(this.heading, _r);
    let vLong = this.vel.x * f.x + this.vel.z * f.z;
    let vLat = this.vel.x * r.x + this.vel.z * r.z;
    const wrecked = this.wrecked;
    const throttle = wrecked ? 0 : this.throttle, brake = wrecked ? 0 : this.brake;
    const prevLong = vLong;
    if (throttle > 0) vLong += t.accel * throttle * dt * (vLong < 0 ? 2 : 1);
    if (brake > 0) { if (vLong > 0.3) vLong -= t.brake * brake * dt; else vLong -= t.accel * 0.45 * brake * dt; }
    if (this.handbrake && !wrecked) vLong -= Math.sign(vLong) * Math.min(Math.abs(vLong), 8 * dt);
    vLong = clamp(vLong, -t.maxSpeed * 0.35, t.maxSpeed);
    vLong -= vLong * (0.25 + Math.abs(vLong) * 0.01) * dt;
    if (throttle === 0 && brake === 0 && Math.abs(vLong) < 0.15) vLong = 0;
    this.accelVis = damp(this.accelVis, (vLong - prevLong) / Math.max(dt, 1e-3), 6, dt);
    const grip = this.handbrake ? 1.6 : 7.5;
    vLat *= Math.exp(-grip * dt);
    if (Math.abs(vLat) < 0.02) vLat = 0;
    this.vLat = vLat;
    const maxSteer = 0.6 / (1 + Math.abs(vLong) * 0.045);
    this.steerAngle = damp(this.steerAngle, (wrecked ? 0 : this.steer) * maxSteer, 9, dt);
    const turnRate = (vLong / t.wheelbase) * Math.tan(this.steerAngle);
    this.vel.set(f.x * vLong + r.x * vLat, 0, f.z * vLong + r.z * vLat);
    this.heading -= turnRate * dt;
    if (this.handbrake && Math.abs(vLong) > 4) this.heading -= this.steer * 1.4 * dt;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;

    const cs = this.circles(_circles); let impact = 0;
    for (let k = 0; k < this.circleCount; k++) {
      const c = cs[k];
      resolveCircle(world.city.colliders, c.x, c.z, this.radius, _res);
      if (_res.hit) {
        const px = _res.x - c.x, pz = _res.z - c.z;
        this.pos.x += px; this.pos.z += pz;
        const vn = this.vel.x * _res.nx + this.vel.z * _res.nz;
        if (vn < 0) { this.vel.x -= _res.nx * vn * 1.3; this.vel.z -= _res.nz * vn * 1.3; impact = Math.max(impact, -vn); }
        const side = (k === 0 ? 1 : -1) * (f.x * _res.nz - f.z * _res.nx);
        this.heading += side * Math.min(1, Math.abs(vn) * 0.05) * dt * 3;
      }
    }
    const bx = this.pos.x, bz = this.pos.z; world.city.clampToBounds(this.pos, 1.5);
    if (bx !== this.pos.x) this.vel.x *= -0.3; if (bz !== this.pos.z) this.vel.z *= -0.3;
    if (impact > 5) { this.damage(Math.min(35, (impact - 4) * 2) * (this.type.armor || 1), world); this.lastImpact = impact; world.onImpact?.(this, impact); }
    this.y = damp(this.y, world.city.groundHeight(this.pos.x, this.pos.z), 12, dt);
    this.wheelSpin += vLong / t.wheelR * dt;
    this.syncMesh();
  }
  syncMesh() {
    this.mesh.position.set(this.pos.x, this.y, this.pos.z);
    this.mesh.rotation.y = this.heading;
    const vLat = this.vLat || 0;
    if (this.type.bike) { const lean = clamp(this.steerAngle * Math.min(1, this.speed / 8) * 1.2 + vLat * 0.03, -0.5, 0.5); this.mesh.rotation.z = -lean; }
    else { this.body.rotation.z = clamp(vLat * 0.014, -0.09, 0.09); this.body.rotation.x = clamp(-this.accelVis * 0.012, -0.05, 0.05); }
    for (const w of this.wheels) { w.spin.rotation.x = this.wheelSpin; w.pivot.rotation.y = w.front ? -this.steerAngle : 0; }
    // lights
    if (!this.wrecked) {
      this.tailMat.emissiveIntensity = this.brake > 0.1 || this.handbrake ? 2.5 : (this.lightsOn ? 0.8 : 0.25);
      this.reverseMat.emissiveIntensity = this.forwardSpeed() < -0.5 ? 2 : 0;
      this.headMat.emissiveIntensity = this.lightsOn ? 2.2 : 0.2;
    }
  }
}
const _f = new THREE.Vector3(), _r = new THREE.Vector3();
const _circles = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];
const _res = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };

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
