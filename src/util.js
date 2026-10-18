import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export function dampAngle(a, b, lambda, dt) { return a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt)); }
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export const rand = (rng, a, b) => a + rng() * (b - a);
// heading convention: forward = (sin h, 0, cos h); right = (-cos h, 0, sin h); turning right = decreasing h
export const fwdOf = (h, out = new THREE.Vector3()) => out.set(Math.sin(h), 0, Math.cos(h));
export const rightOf = (h, out = new THREE.Vector3()) => out.set(-Math.cos(h), 0, Math.sin(h));
export const headingOf = (x, z) => Math.atan2(x, z);
export const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };

/** Merge indexed BufferGeometries that share position/normal/uv (+ optional color). */
export function mergeGeometries(geos) {
  let vCount = 0, iCount = 0, hasColor = false;
  for (const g of geos) { if (!g.index) { const n = g.attributes.position.count; const idx = new Uint32Array(n); for (let k = 0; k < n; k++) idx[k] = k; g.setIndex(new THREE.BufferAttribute(idx, 1)); } vCount += g.attributes.position.count; iCount += g.index.count; if (g.attributes.color) hasColor = true; }
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
  const col = hasColor ? new Float32Array(vCount * 3) : null;
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    if (col) { if (g.attributes.color) col.set(g.attributes.color.array, vo * 3); else col.fill(1, vo * 3, (vo + n) * 3); }
    const gi = g.index.array;
    for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo;
    vo += n; io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
/** Box geometry with a vertex color and (optionally) without top/bottom faces. */
export function coloredBox(w, h, d, color, { noTop = false, noBottom = false, uvScale = 0 } = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (uvScale > 0) {
    // faces: px(0-3) nx(4-7) py(8-11) ny(12-15) pz(16-19) nz(20-23)
    const uv = g.attributes.uv.array;
    const scale = (i0, su, sv) => { for (let i = i0; i < i0 + 4; i++) { uv[i * 2] *= su; uv[i * 2 + 1] *= sv; } };
    scale(0, d / uvScale, h / uvScale); scale(4, d / uvScale, h / uvScale);
    scale(16, w / uvScale, h / uvScale); scale(20, w / uvScale, h / uvScale);
  }
  if (noTop || noBottom) {
    const src = g.index.array; const keep = [];
    for (let i = 0; i < src.length; i += 6) {
      const face = i / 6; // 0 px,1 nx,2 py,3 ny,4 pz,5 nz
      if ((noTop && face === 2) || (noBottom && face === 3)) continue;
      for (let k = 0; k < 6; k++) keep.push(src[i + k]);
    }
    g.setIndex(keep);
  }
  return g;
}
