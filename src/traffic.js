import { CFG } from './config.js';
import { Vehicle, CAR_COLORS } from './vehicle.js';
import { LaneDriver } from './driver.js';
import { mulberry32, pick } from './util.js';

const TRAFFIC_TYPES = ['sedan', 'sedan', 'sedan', 'sports', 'muscle', 'van', 'truck', 'taxi', 'taxi', 'bike', 'bus'];

export class Traffic {
  constructor(game) {
    this.game = game; this.cars = []; this.rng = mulberry32(CFG.seed + 5);
    for (let i = 0; i < CFG.trafficCars; i++) this.spawn(true);
  }
  spawn(initial = false) {
    const g = this.game, city = g.city; const p = g.player;
    for (let tries = 0; tries < 25; tries++) {
      const from = pick(this.rng, city.nodes); const toId = pick(this.rng, from.adj); const to = city.nodes[toId];
      const t = 0.15 + this.rng() * 0.7;
      const x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
      const d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d2 < 45 * 45 || (!initial && d2 > 230 * 230)) continue;
      if (!initial) { // avoid spawning in view
        const cam = g.cam; const dx = x - cam.pos.x, dz = z - cam.pos.z; const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
        if ((dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1) > 0.3 && d2 < 160 * 160) continue;
      }
      let clear = true; for (const v of g.vehicles) { if ((v.pos.x - x) ** 2 + (v.pos.z - z) ** 2 < 100) { clear = false; break; } }
      if (!clear) continue;
      const type = pick(this.rng, TRAFFIC_TYPES);
      const v = new Vehicle(type, type === 'taxi' ? 0xf1c40f : pick(this.rng, CAR_COLORS));
      const rx = -(to.z - from.z) / Math.hypot(to.x - from.x, to.z - from.z), rz = (to.x - from.x) / Math.hypot(to.x - from.x, to.z - from.z);
      v.setPose(x + rx * CFG.laneOffset, z + rz * CFG.laneOffset, Math.atan2(to.x - from.x, to.z - from.z));
      v.ai = new LaneDriver(g, v, from.id, toId, this.rng); v.driver = 'ai';
      g.scene.add(v.mesh); g.vehicles.push(v); this.cars.push(v);
      return v;
    }
    return null;
  }
  release(v) { const i = this.cars.indexOf(v); if (i >= 0) this.cars.splice(i, 1); v.ai = null; v.driver = null; }
  carjack(v) {
    const g = this.game; this.release(v);
    // driver bails out on the left side and runs
    const lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
    const ped = g.peds.spawnAt(v.pos.x + lx * 2.2, v.pos.z + lz * 2.2, { flee: true });
    ped.flee(v.pos.x, v.pos.z, 7);
    v.throttle = 0; v.brake = 1;
    if (g.police?.nearestCopDist(v.pos.x, v.pos.z) < 60) g.addWanted(1);
    g.hud.toast('Carjacked!', 1.5);
  }
  scare(v) { if (v.ai) { v.ai.scared = 6; v.ai.cruise = Math.max(v.ai.cruise, 14); } }
  onCrash(a, b, imp) {
    const g = this.game; const pv = g.player.vehicle;
    for (const v of [a, b]) { if (v.ai && v.ai.mode !== 'pursuit') { v.ai.stun = Math.min(2.5, imp * 0.15); } }
    if ((a === pv || b === pv) && imp > 8) { const other = a === pv ? b : a; if (other.typeName === 'police') g.addWanted(1); }
  }
  update(dt) {
    const g = this.game; const px = g.player.x, pz = g.player.z;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const v = this.cars[i]; const d2 = (v.pos.x - px) ** 2 + (v.pos.z - pz) ** 2;
      if (d2 > 300 * 300 || (v.wrecked && (d2 > 120 * 120 || (v.wreckT = (v.wreckT || 0) + dt) > 40))) { g.removeVehicle(v); this.cars.splice(i, 1); continue; }
      v.mesh.visible = d2 < 260 * 260;
      if (d2 > 320 * 320) continue;
      v.ai.update(dt);
    }
    while (this.cars.length < CFG.trafficCars) { if (!this.spawn()) break; }
  }
}
