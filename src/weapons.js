import * as THREE from 'three';
import { clamp } from './util.js';

export const WEAPONS = {
  fists:   { name: 'Fists',   dmg: 14, range: 1.7, rate: 0.45, melee: true, ammo: Infinity, icon: '✊' },
  pistol:  { name: 'Pistol',  dmg: 30, range: 70,  rate: 0.32, spread: 0.012, clip: 17, icon: '🔫' },
  smg:     { name: 'SMG',     dmg: 13, range: 55,  rate: 0.085, spread: 0.045, clip: 30, icon: '🔫' },
  shotgun: { name: 'Shotgun', dmg: 11, range: 28,  rate: 0.95, spread: 0.07, pellets: 7, clip: 8, icon: '🔫' },
};
export const WEAPON_ORDER = ['fists', 'pistol', 'smg', 'shotgun'];

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _tmp = [];

export class WeaponSystem {
  constructor(game) {
    this.game = game;
    this.ammo = { pistol: 0, smg: 0, shotgun: 0 };
    this.have = { fists: true, pistol: false, smg: false, shotgun: false };
    this.current = 'fists'; this.cool = 0; this.aiming = false; this.target = null; this.recoil = 0;
    this.muzzle = new THREE.PointLight(0xffc070, 0, 10); game.scene.add(this.muzzle);
  }
  get weapon() { return WEAPONS[this.current]; }
  give(type, ammo = 0) { if (type === 'fists') return; this.have[type] = true; this.ammo[type] += ammo; if (this.current === 'fists' || this.current === type) this.current = type; }
  cycle(dir) {
    const list = WEAPON_ORDER.filter((w) => this.have[w]); let i = list.indexOf(this.current);
    i = (i + dir + list.length) % list.length; this.current = list[i];
  }
  saveState() { return { ammo: this.ammo, have: this.have, current: this.current }; }
  loadState(s) { if (!s) return; Object.assign(this.ammo, s.ammo || {}); Object.assign(this.have, s.have || {}); if (s.current && this.have[s.current]) this.current = s.current; }

  /** 2D ray-march against buildings; returns distance to wall or Infinity. */
  wallDistance(ox, oy, oz, dx, dy, dz, range) {
    const hash = this.game.city.colliders; const step = 0.8;
    for (let t = step; t < range; t += step) {
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      if (y < 0) return t;
      const boxes = hash.query(x - 0.1, x + 0.1, z - 0.1, z + 0.1, _tmp);
      for (const b of boxes) { if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && y <= b.height) return t; }
    }
    return Infinity;
  }
  lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az; const l = Math.hypot(dx, dy, dz) || 1;
    return this.wallDistance(ax, ay, az, dx / l, dy / l, dz / l, l) === Infinity;
  }
  /** Hitscan from origin along dir. Returns {kind, obj, dist, point}. */
  hitscan(origin, dir, range, ignore) {
    const g = this.game; let best = { kind: 'none', dist: this.wallDistance(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range), obj: null };
    if (best.dist === Infinity) best.dist = range;
    // peds: sphere at chest
    for (const p of g.peds.list) {
      if (p === ignore || p.state === 'dead') continue;
      const cy = p.state === 'down' ? 0.5 : 1.1; const r = p.state === 'down' ? 0.6 : 0.55;
      const t = raySphere(origin, dir, p.pos.x, p.pos.y + cy, p.pos.z, r, best.dist);
      if (t !== null) { best = { kind: 'ped', dist: t, obj: p }; }
    }
    // player (for cops)
    if (ignore !== g.player && g.player.state !== 'car' && g.player.state !== 'dead') {
      const pl = g.player; const t = raySphere(origin, dir, pl.pos.x, pl.pos.y + 1.1, pl.pos.z, 0.55, best.dist);
      if (t !== null) best = { kind: 'player', dist: t, obj: pl };
    }
    // vehicles: vertical cylinders
    for (const v of g.vehicles) {
      if (v === ignore) continue;
      const dx = v.pos.x - origin.x, dz = v.pos.z - origin.z; if (dx * dx + dz * dz > (best.dist + 4) ** 2) continue;
      v.circles(_cv);
      for (let k = 0; k < v.circleCount; k++) {
        const t = rayCylinder(origin, dir, _cv[k].x, _cv[k].z, v.radius + 0.1, v.type.h + 0.5, best.dist);
        if (t !== null) best = { kind: 'vehicle', dist: t, obj: v };
      }
    }
    best.point = new THREE.Vector3().copy(origin).addScaledVector(dir, best.dist);
    return best;
  }
  /** Pick an auto-aim target in a cone in front of the camera. */
  findTarget(maxDist, cone = 0.45) {
    const g = this.game, cam = g.cam; const px = g.player.x, pz = g.player.z;
    const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
    let best = null, bs = -Infinity;
    const consider = (x, z, obj) => {
      const dx = x - px, dz = z - pz; const d = Math.hypot(dx, dz); if (d < 0.5 || d > maxDist) return;
      const dot = (dx * fx + dz * fz) / d; if (dot < 1 - cone) return;
      const s = dot * 2 - d / maxDist; if (s > bs) { bs = s; best = obj; }
    };
    for (const p of g.peds.list) if (p.state !== 'dead' && p.mesh.visible) consider(p.pos.x, p.pos.z, p);
    return best;
  }

  update(dt, input) {
    const g = this.game, pl = g.player;
    this.cool -= dt; this.recoil = Math.max(0, this.recoil - dt * 4);
    this.muzzle.intensity *= 0.6;
    if (pl.state !== 'foot') { this.aiming = false; this.target = null; return; }
    if (g.input.pressed('weaponNext')) this.cycle(1); if (g.input.pressed('weaponPrev')) this.cycle(-1);
    this.aiming = !!input.aim && !this.weapon.melee;
    if (this.aiming || g.settings.touch || g.input.gamepadIndex >= 0) {
      const t = this.findTarget(this.weapon.melee ? 2.5 : this.weapon.range * 0.8, this.aiming ? 0.5 : 0.25);
      if (t && !g.weapons.lineOfSight(pl.pos.x, pl.pos.y + 1.2, pl.pos.z, t.pos.x, t.pos.y + 1.1, t.pos.z)) this.target = null; else this.target = t;
    } else this.target = null;
    if (this.weapon.melee && this.target) { const d = Math.hypot(this.target.pos.x - pl.x, this.target.pos.z - pl.z); if (d > 2.4) this.target = null; }
    if (input.fire && this.cool <= 0) this.fire();
  }
  aimDirection(out) {
    const g = this.game, pl = g.player, cam = g.cam;
    _o.set(pl.pos.x, pl.pos.y + 1.25, pl.pos.z);
    if (this.target) { out.set(this.target.pos.x - _o.x, this.target.pos.y + 1.0 - _o.y, this.target.pos.z - _o.z).normalize(); return _o; }
    // camera forward, but originate at the player: aim at the point the camera looks at far away
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    _p.set(cam.pos.x + Math.sin(cam.yaw) * cp * 80, cam.pos.y - sp * 80, cam.pos.z + Math.cos(cam.yaw) * cp * 80);
    out.copy(_p).sub(_o).normalize(); return _o;
  }
  fire() {
    const g = this.game, pl = g.player, w = this.weapon;
    if (!w.melee && this.ammo[this.current] <= 0) { this.cool = 0.3; g.audio._blip(200, 0.08, 'square', 0.1); g.hud.toast('Out of ammo', 1.2); return; }
    this.cool = w.rate; this.recoil = 1;
    const origin = this.aimDirection(_d);
    if (this.target) pl.heading = Math.atan2(_d.x, _d.z); else pl.heading = g.cam.yaw;
    if (w.melee) {
      g.audio.noise(0.08, 0.25);
      const hit = this.hitscan(origin, _d, w.range + 0.4, pl);
      if (hit.kind === 'ped') { hit.obj.hit(w.dmg, 'player'); hit.obj.vel.add(_d.clone().multiplyScalar(2)); g.audio.impact(2); if (!hit.obj.alive) {} else if (hit.obj.cop) g.addWanted(1); }
      else if (hit.kind === 'vehicle') { hit.obj.damage(2, g); g.audio.impact(1.5); }
      return;
    }
    this.ammo[this.current]--;
    const pellets = w.pellets || 1;
    for (let k = 0; k < pellets; k++) {
      const dir = _p.copy(_d); dir.x += (Math.random() - 0.5) * w.spread * 2; dir.y += (Math.random() - 0.5) * w.spread * 2; dir.z += (Math.random() - 0.5) * w.spread * 2; dir.normalize();
      const hit = this.hitscan(origin, dir, w.range, pl);
      g.fx.tracers.add(origin, hit.point);
      this.applyHit(hit, w.dmg, 'player', dir);
    }
    this.muzzle.position.copy(origin).addScaledVector(_d, 0.8); this.muzzle.intensity = 25;
    g.fx.particles.emit(origin.x + _d.x * 0.7, origin.y, origin.z + _d.z * 0.7, { count: 3, color: [1, 0.8, 0.3], speed: 1, spread: 1, size: 0.6, life: 0.08, grav: 0 });
    g.audio.gunshot(this.current);
    g.peds.alertGunshot(pl.x, pl.z, 30);
    g.police?.onGunshot?.();
    g.cam.shake = Math.max(g.cam.shake, this.current === 'shotgun' ? 0.5 : 0.15);
  }
  applyHit(hit, dmg, by, dir) {
    const g = this.game;
    if (hit.kind === 'ped') { const wasCop = hit.obj.cop; hit.obj.hit(dmg, by); if (wasCop && by === 'player' && hit.obj.alive) g.addWanted(1); }
    else if (hit.kind === 'vehicle') { hit.obj.damage(dmg * 0.4, g); g.fx.particles.emit(hit.point.x, hit.point.y, hit.point.z, { count: 4, color: [1, 0.9, 0.5], speed: 4, spread: 1, size: 0.35, life: 0.3, grav: -8 }); if (hit.obj.ai && by === 'player') g.traffic?.scare(hit.obj); }
    else if (hit.kind === 'player') { g.player.damage(dmg); }
    else { g.fx.particles.emit(hit.point.x, hit.point.y, hit.point.z, { count: 3, color: [0.8, 0.8, 0.7], speed: 2, spread: 1, size: 0.3, life: 0.3, grav: -8 }); }
  }
  copShoot(cop, dist) {
    const g = this.game, pl = g.player;
    const origin = _o.set(cop.pos.x, cop.pos.y + 1.25, cop.pos.z);
    _d.set(pl.x - origin.x, pl.worldPos.y + 1.0 - origin.y, pl.z - origin.z).normalize();
    const miss = 0.06 + dist * 0.006; _d.x += (Math.random() - 0.5) * miss * 2; _d.y += (Math.random() - 0.5) * miss; _d.z += (Math.random() - 0.5) * miss * 2; _d.normalize();
    const hit = this.hitscan(origin, _d, 40, cop);
    g.fx.tracers.add(origin, hit.point);
    this.applyHit(hit, 9, 'cop', _d);
    g.audio.gunshot('pistol', 0.5);
  }
}
const _cv = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];

function raySphere(o, d, cx, cy, cz, r, maxT) {
  const lx = cx - o.x, ly = cy - o.y, lz = cz - o.z; const tca = lx * d.x + ly * d.y + lz * d.z; if (tca < 0 || tca > maxT) return null;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca; if (d2 > r * r) return null;
  const t = tca - Math.sqrt(r * r - d2); return t < maxT ? Math.max(0, t) : null;
}
function rayCylinder(o, d, cx, cz, r, h, maxT) {
  const ox = o.x - cx, oz = o.z - cz; const a = d.x * d.x + d.z * d.z; if (a < 1e-6) return null;
  const b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r; const disc = b * b - 4 * a * c; if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a); if (t < 0 || t > maxT) return null;
  const y = o.y + d.y * t; if (y < 0 || y > h) return null; return t;
}
export { clamp };
