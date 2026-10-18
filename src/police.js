import { Vehicle } from './vehicle.js';
import { LaneDriver } from './driver.js';
import { pick } from './util.js';

export class Police {
  constructor(game) { this.game = game; this.cars = []; this.cops = []; this.calm = 0; this.lightT = 0; this.spawnT = 0; }
  desiredCars() { return [0, 1, 2, 3, 4, 6][this.game.player.wanted] || 0; }
  nearestCopDist(x, z) { let b = Infinity; for (const c of this.cars) { const d = Math.hypot(c.pos.x - x, c.pos.z - z); if (d < b) b = d; } for (const c of this.cops) { if (c.state !== 'cop') continue; const d = Math.hypot(c.pos.x - x, c.pos.z - z); if (d < b) b = d; } return b; }
  onWantedChanged() { this.calm = 0; }
  onGunshot() { const g = this.game; if (this.nearestCopDist(g.player.x, g.player.z) < 70 && g.player.wanted < 2) g.addWanted(1); else if (g.player.wanted === 0 && Math.random() < 0.08) g.addWanted(1); }
  clear() { for (const c of this.cars) this.game.removeVehicle(c); this.cars = []; for (const c of this.cops) this.game.peds.remove(c); this.cops = []; }
  spawnCar() {
    const g = this.game, city = g.city; const p = g.player;
    for (let tries = 0; tries < 30; tries++) {
      const from = pick(Math.random, city.nodes); const toId = pick(Math.random, from.adj); const to = city.nodes[toId];
      const t = 0.2 + Math.random() * 0.6; const x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
      const d = Math.hypot(x - p.x, z - p.z); if (d < 70 || d > 170) continue;
      const cam = g.cam; const dx = x - cam.pos.x, dz = z - cam.pos.z; if ((dx * Math.sin(cam.yaw) + dz * Math.cos(cam.yaw)) / (Math.hypot(dx, dz) || 1) > 0.2) continue;
      const v = new Vehicle('police', 0xffffff); const l = Math.hypot(to.x - from.x, to.z - from.z);
      v.setPose(x - (to.z - from.z) / l * 3.5, z + (to.x - from.x) / l * 3.5, Math.atan2(to.x - from.x, to.z - from.z));
      v.ai = new LaneDriver(g, v, from.id, toId); v.ai.mode = 'pursuit'; v.ai.pathT = 0; v.driver = 'ai'; v.copsLeft = 2;
      g.scene.add(v.mesh); g.vehicles.push(v); this.cars.push(v); return v;
    }
    return null;
  }
  update(dt) {
    const g = this.game, p = g.player; const w = p.wanted;
    // decay
    const near = this.nearestCopDist(p.x, p.z);
    if (w > 0) { if (near > 90) { this.calm += dt; if (this.calm > 14) { p.wanted--; this.calm = 6; if (p.wanted === 0) g.hud.toast('You lost the cops.', 2); } } else this.calm = Math.max(0, this.calm - dt * 0.5); }
    // population
    const want = this.desiredCars();
    this.spawnT -= dt;
    if (this.cars.length < want && this.spawnT <= 0) { this.spawnT = 1.2; this.spawnCar(); }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i]; const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z);
      if (c.wrecked) { c.wreckT = (c.wreckT || 0) + dt; if (c.wreckT > 20 || d > 150) { g.removeVehicle(c); this.cars.splice(i, 1); } continue; }
      if (w === 0 || this.cars.length > want + 1 || d > 320) { if (w === 0 && d < 120) { c.ai.mode = 'wander'; c.ai.path = null; g.traffic.cars.push(c); this.cars.splice(i, 1); continue; } g.removeVehicle(c); this.cars.splice(i, 1); continue; }
      c.ai.update(dt);
      // cops bail out to chase a player on foot
      if ((p.state === 'foot' || p.state === 'ragdoll') && d < 16 && c.speed < 2.5 && c.copsLeft > 0 && this.cops.filter((k) => k.state === 'cop').length < 4) {
        c.copsLeft--; const lx = Math.cos(c.heading), lz = -Math.sin(c.heading);
        const cop = g.peds.spawnAt(c.pos.x + lx * 2.2, c.pos.z + lz * 2.2, { cop: true }); this.cops.push(cop);
      }
      // ramming / busted when the player's car is stopped and boxed in
      if (p.state === 'car' && p.vehicle.speed < 1.5 && d < 5.5) { c.bustT = (c.bustT || 0) + dt; if (c.bustT > 2.5) g.onBusted(); } else c.bustT = 0;
      // flashing lights
    }
    this.lightT += dt; const phase = Math.floor(this.lightT * 5) % 2;
    for (const c of this.cars) { if (c.lightA) { c.lightA.material.emissiveIntensity = phase ? 3 : 0; c.lightB.material.emissiveIntensity = phase ? 0 : 3; } }
    for (let i = this.cops.length - 1; i >= 0; i--) { const c = this.cops[i]; if (c.state !== 'cop') { if (c.state === 'dead' && c.deadT > 20) { g.peds.remove(c); this.cops.splice(i, 1); } else if (!c.cop) this.cops.splice(i, 1); } }
    if (w === 0 && this.cops.length) { for (const c of this.cops) if (c.state === 'cop') { c.state = 'walk'; c.cop = false; c.node = c.nearestNode(); c.prev = null; c.pickNext(); } this.cops = this.cops.filter((c) => c.state === 'dead'); }
    // siren audio
    g.audio.updateSiren(dt, w > 0 && near < 120 ? Math.max(0.15, 1 - near / 120) : 0);
  }
}
