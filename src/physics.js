/** Spatial hash of axis-aligned boxes {minX,maxX,minZ,maxZ,height,kind} */
export class SpatialHash {
  constructor(cell = 16) { this.cell = cell; this.map = new Map(); this.stamp = 1; this.all = []; }
  _key(cx, cz) { return cx * 100003 + cz; }
  insert(box) {
    box._stamp = 0; this.all.push(box);
    const c = this.cell;
    for (let cx = Math.floor(box.minX / c); cx <= Math.floor(box.maxX / c); cx++)
      for (let cz = Math.floor(box.minZ / c); cz <= Math.floor(box.maxZ / c); cz++) {
        const k = this._key(cx, cz); let a = this.map.get(k); if (!a) { a = []; this.map.set(k, a); } a.push(box);
      }
  }
  query(minX, maxX, minZ, maxZ, out = []) {
    out.length = 0; const c = this.cell; const s = ++this.stamp;
    for (let cx = Math.floor(minX / c); cx <= Math.floor(maxX / c); cx++)
      for (let cz = Math.floor(minZ / c); cz <= Math.floor(maxZ / c); cz++) {
        const a = this.map.get(this._key(cx, cz)); if (!a) continue;
        for (const b of a) { if (b._stamp === s) continue; b._stamp = s; if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue; out.push(b); }
      }
    return out;
  }
}

const _tmp = [];
/**
 * Push a circle (x,z,r) out of all boxes. Returns {x,z,hit,nx,nz} where n is the push normal.
 * Optional yTop: ignore boxes shorter than yTop (for jumping over low objects — unused for now).
 */
export function resolveCircle(hash, x, z, r, res) {
  const boxes = hash.query(x - r, x + r, z - r, z + r, _tmp);
  res.x = x; res.z = z; res.hit = false; res.nx = 0; res.nz = 0;
  for (let iter = 0; iter < 2; iter++) {
    for (const b of boxes) {
      const cx = res.x < b.minX ? b.minX : res.x > b.maxX ? b.maxX : res.x;
      const cz = res.z < b.minZ ? b.minZ : res.z > b.maxZ ? b.maxZ : res.z;
      let dx = res.x - cx, dz = res.z - cz;
      let d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let nx, nz, push;
      if (d2 > 1e-6) { const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; push = r - d; }
      else {
        // inside the box: push out along the axis of least penetration
        const pl = res.x - b.minX, pr = b.maxX - res.x, pt = res.z - b.minZ, pb = b.maxZ - res.z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) { nx = -1; nz = 0; } else if (m === pr) { nx = 1; nz = 0; } else if (m === pt) { nx = 0; nz = -1; } else { nx = 0; nz = 1; }
        push = m + r;
      }
      res.x += nx * push; res.z += nz * push; res.hit = true; res.nx += nx; res.nz += nz;
    }
  }
  if (res.hit) { const l = Math.hypot(res.nx, res.nz) || 1; res.nx /= l; res.nz /= l; }
  return res;
}
