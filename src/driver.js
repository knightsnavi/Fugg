import { CFG } from './config.js';
import { clamp, angleDiff, rand } from './util.js';

const _c = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];
/** AI driver that follows road lanes; modes: wander (random turns), path (node list), pursuit (chase player). */
export class LaneDriver {
  constructor(game, vehicle, fromId, toId, rng = Math.random) {
    this.game = game; this.v = vehicle; this.city = game.city; this.rng = rng;
    this.mode = 'wander'; this.path = null; this.pathT = 0;
    this.cruise = rand(rng, vehicle.type.cruise[0], vehicle.type.cruise[1]);
    this.setEdge(fromId, toId); this.next = this.pickNext();
    this.stuckT = 0; this.reverseT = 0; this.stun = 0; this.blockedT = 0; this.scared = 0;
  }
  setEdge(fromId, toId) {
    const a = this.city.nodes[fromId], b = this.city.nodes[toId];
    const dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz);
    this.edge = { from: a, to: b, dx: dx / l, dz: dz / l, len: l, axis: dx !== 0 ? 'x' : 'z' };
    const rx = -this.edge.dz, rz = this.edge.dx; // right-hand side
    this.edge.sx = a.x + rx * CFG.laneOffset; this.edge.sz = a.z + rz * CFG.laneOffset;
  }
  pickNext() {
    const e = this.edge; const cands = e.to.adj.filter((id) => id !== e.from.id);
    if (this.mode === 'path' && this.path && this.path.length) {
      const i = this.path.indexOf(e.to.id);
      if (i >= 0 && i + 1 < this.path.length) return this.path[i + 1];
    }
    if (!cands.length) return e.from.id;
    // prefer straight
    let straight = null;
    for (const id of cands) { const n = this.city.nodes[id]; const ddx = Math.sign(n.x - e.to.x), ddz = Math.sign(n.z - e.to.z); if (ddx === Math.sign(e.dx) && ddz === Math.sign(e.dz)) straight = id; }
    if (straight !== null && this.rng() < 0.55) return straight;
    return cands[Math.floor(this.rng() * cands.length)];
  }
  /** point on current lane at distance s from lane start */
  lanePoint(s, out) { const e = this.edge; out.x = e.sx + e.dx * s; out.z = e.sz + e.dz * s; return out; }
  setPath(nodeIds) { this.mode = 'path'; this.path = nodeIds; }
  update(dt) {
    const v = this.v, e = this.edge, city = this.city, g = this.game;
    if (v.wrecked) { v.throttle = 0; v.brake = 1; return; }
    if (this.stun > 0) { this.stun -= dt; v.throttle = 0; v.brake = 1; v.steer = 0; return; }
    // progress along lane
    let s = (v.pos.x - e.sx) * e.dx + (v.pos.z - e.sz) * e.dz;
    if (s >= e.len - 0.5) { this.setEdge(e.to.id, this.next); this.next = this.pickNext(); s = (v.pos.x - this.edge.sx) * this.edge.dx + (v.pos.z - this.edge.sz) * this.edge.dz; }
    const E = this.edge;
    const speed = v.speed; const look = 5 + speed * 0.55;
    let tx, tz; const ahead = s + look;
    if (ahead <= E.len) { tx = E.sx + E.dx * ahead; tz = E.sz + E.dz * ahead; }
    else { // on next edge
      const n = city.nodes[this.next]; const dx = n.x - E.to.x, dz = n.z - E.to.z; const l = Math.hypot(dx, dz) || 1; const ndx = dx / l, ndz = dz / l;
      const rx = -ndz, rz = ndx; const o = ahead - E.len;
      tx = E.to.x + rx * CFG.laneOffset + ndx * o; tz = E.to.z + rz * CFG.laneOffset + ndz * o;
    }
    let desired = this.cruise;
    const pursuit = this.mode === 'pursuit';
    if (pursuit) {
      desired = v.type.maxSpeed * 0.95;
      const pl = g.player; const dx = pl.x - v.pos.x, dz = pl.z - v.pos.z; const d = Math.hypot(dx, dz);
      const clear = d < 45 && g.weapons.lineOfSight(v.pos.x, 1, v.pos.z, pl.x, 1, pl.z);
      this.pathT -= dt;
      if (clear) { tx = pl.x + (pl.vehicle ? pl.vehicle.vel.x * 0.4 : 0); tz = pl.z + (pl.vehicle ? pl.vehicle.vel.z * 0.4 : 0); if (d < 14 && !pl.vehicle) desired = d < 5 ? 0 : 6; if (pl.vehicle && d < 6) desired = v.type.maxSpeed; this.direct = true; }
      else {
        this.direct = false;
        if (this.pathT <= 0) { this.pathT = 1.5; const from = this.edge.to.id; const to = city.nearestNode(pl.x, pl.z); this.path = city.findPath(from, to); this.next = this.pickNextPath(); }
      }
    } else {
      // traffic lights: stop line before the intersection
      const stopDist = E.len - s - CFG.roadWidth / 2 - 3.4;
      if (stopDist > -0.5 && stopDist < 2 + speed * speed / (2 * 6) + 1 && !city.lightGreen(E.to, E.axis, g.time)) { if (stopDist > -0.5) desired = Math.min(desired, Math.max(0, stopDist * 1.5)); }
      if (this.scared > 0) { this.scared -= dt; desired = v.type.maxSpeed * 0.8; }
    }
    // obstacles ahead (vehicles, peds, player)
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading); const rxh = -fz, rzh = fx;
    const checkDist = 4 + speed * 1.1;
    let blocked = false;
    const consider = (x, z, radius, otherSpeed) => {
      const dx = x - v.pos.x, dz = z - v.pos.z; const along = dx * fx + dz * fz; if (along < 0 || along > checkDist + v.type.l / 2) return;
      const side = Math.abs(dx * rxh + dz * rzh); if (side > 1.4 + radius) return;
      const gap = along - v.type.l / 2 - radius;
      if (gap < 2.5) { desired = Math.min(desired, Math.max(0, otherSpeed - 2)); blocked = true; } else desired = Math.min(desired, Math.max(otherSpeed, gap * 1.2));
    };
    if (!pursuit) {
      for (const o of g.vehicles) { if (o === v) continue; const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z; if (dx * dx + dz * dz > (checkDist + 6) ** 2) continue; consider(o.pos.x, o.pos.z, o.radius, o.forwardSpeed() * (Math.sin(o.heading) * fx + Math.cos(o.heading) * fz)); }
      for (const p of g.peds.list) { if (p.state === 'dead') continue; const dx = p.pos.x - v.pos.x, dz = p.pos.z - v.pos.z; if (dx * dx + dz * dz > (checkDist + 2) ** 2) continue; consider(p.pos.x, p.pos.z, 0.5, 0); }
      const pl = g.player; if (!pl.vehicle && pl.state !== 'dead') { const dx = pl.x - v.pos.x, dz = pl.z - v.pos.z; if (dx * dx + dz * dz < (checkDist + 2) ** 2) consider(pl.x, pl.z, 0.5, 0); }
    } else {
      for (const o of g.vehicles) { if (o === v || o === g.player.vehicle) continue; const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z; if (dx * dx + dz * dz > 64) continue; if (o.speed < 1) consider(o.pos.x, o.pos.z, o.radius, 0); }
    }
    this.blockedT = blocked && speed < 0.5 ? this.blockedT + dt : 0;
    if (this.blockedT > 1.5 && this.blockedT < 1.6 && g.dist2ToPlayer(v.pos) < 40 * 40) g.audio.hornBlip?.();
    // stuck handling: reverse
    if (speed < 0.4 && desired > 2 && !blocked) this.stuckT += dt; else this.stuckT = 0;
    if (this.stuckT > 2.5) { this.reverseT = 1.2; this.stuckT = 0; }
    if (this.reverseT > 0) { this.reverseT -= dt; v.throttle = 0; v.brake = 1; v.steer = -v.steer || 0.6; return; }
    // steering
    const want = Math.atan2(tx - v.pos.x, tz - v.pos.z);
    const diff = angleDiff(v.heading, want);
    v.steer = clamp(-diff / 0.45, -1, 1);
    if (speed > 12 && Math.abs(diff) > 0.6 && !pursuit) desired = Math.min(desired, 7);
    // throttle / brake
    const fs = v.forwardSpeed();
    if (fs < desired - 0.3) { v.throttle = clamp((desired - fs) * 0.5, 0.2, 1); v.brake = 0; }
    else if (fs > desired + 0.3) { v.throttle = 0; v.brake = clamp((fs - desired) * 0.3, 0.2, 1); }
    else { v.throttle = 0.1; v.brake = 0; }
    v.handbrake = false;
  }
  pickNextPath() {
    const e = this.edge; if (!this.path) return this.pickNext();
    const i = this.path.indexOf(e.to.id);
    if (i >= 0 && i + 1 < this.path.length) return this.path[i + 1];
    // path does not pass through e.to: steer toward the first path node
    const cands = e.to.adj.filter((id) => id !== e.from.id); return cands.includes(this.path[0]) ? this.path[0] : this.pickNext();
  }
}
void _c;
