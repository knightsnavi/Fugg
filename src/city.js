import * as THREE from 'three';
import { CFG } from './config.js';
import { mergeGeometries, coloredBox, mulberry32, rand, pick } from './util.js';
import { SpatialHash } from './physics.js';
import { GLOW_TEX } from './effects.js';
import { makeFacade, makeSidewalk, makeGrass, makeAsphalt, makeBillboard } from './textures.js';
import { RoundedBoxGeometry } from '../vendor/jsm/geometries/RoundedBoxGeometry.js';

const TINTS = [0x9a9a9e, 0xa39c93, 0x8b9099, 0xa89a8c, 0x7d8690, 0xb2a99c, 0x95847a, 0x6f7784, 0xa49f96, 0x8f9aa5, 0xa79b8d, 0x857f78];
const GLASS = [0x8aa6bd, 0x7a96ad, 0x9bb0c2, 0x85a0b4, 0x6f8aa0];
const NEON = [0xff2d7a, 0x2dd4ff, 0xb6ff2d, 0xff8c2d, 0xd02dff, 0x2dff9a, 0xffe92d, 0xff4040];
const HOUSE = [0xb59f8a, 0xc4b8a9, 0x9aa5ab, 0xc9b79c, 0x8e9ca6, 0xb8aa9c, 0xd0c4b0];
const FACADE_STYLES = ['office', 'brick', 'panel', 'metal', 'house'];

/** world-space UVs for upward faces so textures tile seamlessly across merged slabs */
function worldUvTop(g, tile) {
  const p = g.attributes.position.array, n = g.attributes.normal.array, uv = g.attributes.uv.array;
  for (let i = 0; i < p.length / 3; i++) if (n[i * 3 + 1] > 0.5) { uv[i * 2] = p[i * 3] / tile; uv[i * 2 + 1] = p[i * 3 + 2] / tile; }
  return g;
}
function colorGeo(g, color) { const n = g.attributes.position.count; const c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; }

export class City {
  constructor(scene, seed = CFG.seed) {
    this.scene = scene;
    this.rng = mulberry32(seed);
    this.N = CFG.blocks; this.P = CFG.blockSize + CFG.roadWidth; this.R = CFG.roadWidth; this.B = CFG.blockSize;
    this.origin = -(this.N * this.P) / 2;
    this.half = (this.N * this.P) / 2 + this.R / 2;
    this.bound = this.half + 10;
    this.beachDepth = 48;
    this.bounds = { minX: -this.bound, maxX: this.bound, minZ: -this.bound, maxZ: this.half + this.beachDepth - 2 };
    this.colliders = new SpatialHash(16);
    this.blocks = []; this.buildings = []; this.parkingSpots = []; this.treeSpots = []; this.neonSpots = []; this.containerSpots = []; this.dumpsterSpots = [];
    this.hydrantSpots = []; this.canSpots = []; this.benchSpots = []; this.shelterSpots = []; this.billboardSpots = [];
    this.lampMaterial = null; this.billboardMats = [];
    this.build();
  }
  roadCenter(i) { return this.origin + i * this.P; }
  blockMin(i) { return this.origin + i * this.P + this.R / 2; }
  blockMax(i) { return this.origin + (i + 1) * this.P - this.R / 2; }
  block(i, j) { return this.blocks[i * this.N + j]; }
  blockAt(x, z) {
    const i = Math.floor((x - this.origin) / this.P), j = Math.floor((z - this.origin) / this.P);
    if (i < 0 || j < 0 || i >= this.N || j >= this.N) return null;
    const b = this.block(i, j);
    return (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) ? b : null;
  }
  groundHeight(x, z) {
    if (this.blockAt(x, z)) return 0.15;
    if (this.pier && x > this.pier.minX && x < this.pier.maxX && z > this.pier.minZ && z < this.pier.maxZ) return 0.7;
    return 0;
  }
  clampToBounds(p, m = 1) {
    const b = this.bounds; if (p.x < b.minX + m) p.x = b.minX + m; if (p.x > b.maxX - m) p.x = b.maxX - m; if (p.z < b.minZ + m) p.z = b.minZ + m; if (p.z > b.maxZ - m) p.z = b.maxZ - m;
    const beachEnd = this.half + this.beachDepth - 2;
    if (p.z > beachEnd && this.pier && (p.x < this.pier.minX + m || p.x > this.pier.maxX - m)) p.z = beachEnd;
  }
  nodeId(i, j) { return i * (this.N + 1) + j; }
  nearestNode(x, z) {
    const i = Math.round((x - this.origin) / this.P), j = Math.round((z - this.origin) / this.P);
    return this.nodeId(Math.max(0, Math.min(this.N, i)), Math.max(0, Math.min(this.N, j)));
  }
  district(i, j) {
    const N = this.N, cx = (N - 1) / 2; const dc = Math.hypot(i - cx, j - cx);
    if (i <= 2) return 'industrial';
    if (j >= N - 3) return 'beachside';
    if (i >= N - 3) return 'residential';
    if (dc < 3.4) return 'downtown';
    return 'commercial';
  }

  build() {
    this.buildGround();
    this.buildBlocks();
    this.buildRoads();
    this.buildRoadGraph();
    this.buildSidewalkGraph();
    this.buildLamps();
    this.buildTrafficLights();
    this.buildProps();
    this.buildBeach();
  }

  buildGround() {
    const s = this.scene;
    const asphalt = makeAsphalt(this.rng); asphalt.map.repeat.set(this.half * 2 / asphalt.tile, this.half * 2 / asphalt.tile); asphalt.normalMap.repeat.copy(asphalt.map.repeat);
    const paved = new THREE.Mesh(new THREE.PlaneGeometry(this.half * 2, this.half * 2), new THREE.MeshStandardMaterial({ map: asphalt.map, normalMap: asphalt.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.9, metalness: 0.05 }));
    paved.rotation.x = -Math.PI / 2; paved.receiveShadow = true; s.add(paved); this.roadMaterial = paved.material;
    const b = this.bounds; const w = b.maxX - b.minX + 2, d = b.maxZ - b.minZ + 2;
    const shore = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: 0xb3a582, roughness: 1 }));
    shore.rotation.x = -Math.PI / 2; shore.position.set((b.minX + b.maxX) / 2, -0.05, (b.minZ + b.maxZ) / 2); shore.receiveShadow = true; s.add(shore);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x1b4357, roughness: 0.12, metalness: 0.5 }));
    water.rotation.x = -Math.PI / 2; water.position.y = -0.6; s.add(water);
    this.water = water;
  }

  buildBlocks() {
    const rng = this.rng; const N = this.N;
    // facade materials
    this.facades = {};
    for (const st of FACADE_STYLES) {
      const f = makeFacade(st, rng);
      this.facades[st] = new THREE.MeshStandardMaterial({ map: f.map, normalMap: f.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), emissiveMap: f.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness: st === 'office' ? 0.4 : 0.85, metalness: st === 'office' ? 0.45 : 0.05 });
      this.facades[st].userData.tile = f.tile;
    }
    this.roofMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    this.storeMat = new THREE.MeshStandardMaterial({ color: 0x0e1419, roughness: 0.1, metalness: 0.85, emissive: 0x5a7a8c, emissiveIntensity: 0 });
    const sw = makeSidewalk(rng), grass = makeGrass(rng);
    const sidewalkMat = new THREE.MeshStandardMaterial({ map: sw.map, normalMap: sw.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), vertexColors: true, roughness: 0.95 });
    const grassMat = new THREE.MeshStandardMaterial({ map: grass.map, vertexColors: true, roughness: 1 });
    const lotMat = new THREE.MeshStandardMaterial({ map: this.roadMaterial.map.clone(), vertexColors: true, roughness: 0.9 }); lotMat.map.repeat.set(1, 1); lotMat.map.needsUpdate = true;
    const swGeos = [], grassGeos = [], lotGeos = [], storeGeos = [];
    const chunkSize = 4; const chunks = new Map();
    const chunkOf = (i, j) => { const k = Math.floor(i / chunkSize) * 100 + Math.floor(j / chunkSize); let c = chunks.get(k); if (!c) { c = { sides: {}, roofs: [] }; for (const st of FACADE_STYLES) c.sides[st] = []; chunks.set(k, c); } return c; };
    const col = new THREE.Color();
    const white = new THREE.Color(0xffffff), curbCol = new THREE.Color(0xc9c7c0), grassCol = new THREE.Color(0xffffff), lotCol = new THREE.Color(0x8a8a90), dirtCol = new THREE.Color(0x6a5e50);

    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const minX = this.blockMin(i), maxX = this.blockMax(i), minZ = this.blockMin(j), maxZ = this.blockMax(j);
      const district = this.district(i, j);
      let type = 'buildings';
      const r = rng();
      if (r < 0.09) type = 'park'; else if (r < 0.16) type = 'lot';
      if (i === Math.floor((N - 1) / 2) && j === Math.floor((N - 1) / 2)) type = 'park';
      const blk = { i, j, type, district, minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
      this.blocks.push(blk);
      const chunk = chunkOf(i, j);

      // sidewalk ring with a lighter curb edge
      const ring = worldUvTop(coloredBox(this.B, 0.3, this.B, white, { noBottom: true }).translate(blk.cx, 0, blk.cz), sw.tile); swGeos.push(ring);
      for (const [cx, cz, w, d] of [[blk.cx, minZ + 0.2, this.B, 0.4], [blk.cx, maxZ - 0.2, this.B, 0.4], [minX + 0.2, blk.cz, 0.4, this.B], [maxX - 0.2, blk.cz, 0.4, this.B]]) { const curb = worldUvTop(coloredBox(w, 0.32, d, curbCol, { noBottom: true }).translate(cx, 0, cz), sw.tile); swGeos.push(curb); }
      const innerSize = this.B - CFG.sidewalk * 2;
      if (type === 'park') grassGeos.push(worldUvTop(coloredBox(innerSize, 0.34, innerSize, grassCol, { noBottom: true }).translate(blk.cx, 0, blk.cz), grass.tile));
      else if (type === 'lot') lotGeos.push(worldUvTop(coloredBox(innerSize, 0.34, innerSize, lotCol, { noBottom: true }).translate(blk.cx, 0, blk.cz), 8));
      else if (district === 'industrial') lotGeos.push(worldUvTop(coloredBox(innerSize, 0.34, innerSize, dirtCol, { noBottom: true }).translate(blk.cx, 0, blk.cz), 8));

      // street furniture along the sidewalks
      const sideSpot = (f, inset) => rng() < 0.5 ? { x: minX + (maxX - minX) * f, z: minZ + inset, r: 0 } : { x: minX + inset, z: minZ + (maxZ - minZ) * f, r: Math.PI / 2 };
      if (rng() < 0.6) this.hydrantSpots.push(sideSpot(rand(rng, 0.15, 0.85), 0.9));
      if (rng() < 0.7) this.canSpots.push(sideSpot(rand(rng, 0.15, 0.85), 0.8));
      if ((district === 'commercial' || district === 'downtown') && rng() < 0.3) this.shelterSpots.push({ x: minX + rand(rng, 12, this.B - 12), z: minZ + 1.6, r: 0 });

      if (type === 'park') {
        const n = 10 + Math.floor(rng() * 8);
        for (let k = 0; k < n; k++) {
          const x = rand(rng, minX + 6, maxX - 6), z = rand(rng, minZ + 6, maxZ - 6);
          this.treeSpots.push({ x, z, s: rand(rng, 0.8, 1.4) });
          this.colliders.insert({ minX: x - 0.45, maxX: x + 0.45, minZ: z - 0.45, maxZ: z + 0.45, height: 2, kind: 'tree' });
        }
        for (let k = 0; k < 4; k++) { const bx = blk.cx + rand(rng, -12, 12), bz = k < 2 ? minZ + 5 : maxZ - 5; this.benchSpots.push({ x: bx, z: bz, r: k < 2 ? 0 : Math.PI }); this.colliders.insert({ minX: bx - 0.9, maxX: bx + 0.9, minZ: bz - 0.3, maxZ: bz + 0.3, height: 1, kind: 'prop' }); }
        // paths + fountain in the central plaza
        const path1 = worldUvTop(coloredBox(innerSize, 0.36, 3, white, { noBottom: true }).translate(blk.cx, 0, blk.cz), sw.tile); const path2 = worldUvTop(coloredBox(3, 0.36, innerSize, white, { noBottom: true }).translate(blk.cx, 0, blk.cz), sw.tile); swGeos.push(path1, path2);
        continue;
      }
      if (type === 'lot') {
        for (let rr = 0; rr < 2; rr++) for (let k = 0; k < 6; k++) {
          const x = minX + 8 + k * 5.2, z = rr === 0 ? minZ + 10 : maxZ - 10;
          const line = coloredBox(0.15, 0.36, 5.5, new THREE.Color(0xd8d8d0)); line.translate(x - 2.6, 0, z); lotGeos.push(worldUvTop(line, 8));
          if (rng() < 0.5) continue;
          this.parkingSpots.push({ x, z, heading: rr === 0 ? Math.PI : 0 });
        }
        this.addBuilding(chunk, blk.cx, blk.cz, 6, 5, 3.2, col.setHex(0xb59f8a), rng, { style: 'house', sign: true, face: 2 }, storeGeos);
        continue;
      }

      const inner = this.B - CFG.sidewalk * 2;
      if (district === 'industrial') {
        const nx = pick(rng, [1, 2]); const lw = inner / nx;
        for (let a = 0; a < nx; a++) {
          const x0 = minX + CFG.sidewalk + a * lw + lw / 2; const w = lw - 4, d = rand(rng, 14, 22), h = rand(rng, 6, 11);
          const z0 = minZ + CFG.sidewalk + d / 2 + 2;
          this.addBuilding(chunk, x0, z0, w, d, h, col.setHex(pick(rng, [0x9a968e, 0xa89684, 0x868a90, 0xb09a7c])), rng, { style: 'metal', face: 3 }, storeGeos);
          if (rng() < 0.4) { const sx = x0 + rand(rng, -w / 3, w / 3); const st = coloredBox(1.4, 16, 1.4, new THREE.Color(0x4a4644)); st.translate(sx, h + 8, z0); chunk.roofs.push(st); }
        }
        const rows = 2 + Math.floor(rng() * 3);
        for (let k = 0; k < rows; k++) {
          const x = rand(rng, minX + 6, maxX - 6), z = rand(rng, minZ + 30, maxZ - 5); const stack = 1 + Math.floor(rng() * 3); const rot = rng() < 0.5 ? 0 : Math.PI / 2;
          for (let s = 0; s < stack; s++) this.containerSpots.push({ x, z, y: 1.3 + s * 2.6, rot, color: pick(rng, [0xa33c2f, 0x2f5fa3, 0x3f7a3a, 0xb0893a, 0x6a6a6a, 0x8a3a6a]) });
          const hw = rot === 0 ? 1.25 : 3.1, hd = rot === 0 ? 3.1 : 1.25;
          this.colliders.insert({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, height: 2.6 * stack, kind: 'building' });
        }
        this.dumpsterSpots.push({ x: minX + 2.6, z: minZ + rand(rng, 8, this.B - 8), r: Math.PI / 2 });
        continue;
      }
      if (district === 'residential' || district === 'beachside') {
        const n = 3; const lw = inner / n;
        for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
          if (rng() < 0.12) continue;
          const x0 = minX + CFG.sidewalk + a * lw + lw / 2, z0 = minZ + CFG.sidewalk + b * lw + lw / 2;
          const w = rand(rng, 6, 8.5), d = rand(rng, 6, 8.5), h = rand(rng, 3.2, 4.2) + (rng() < 0.3 ? 3 : 0);
          grassGeos.push(worldUvTop(coloredBox(lw - 1, 0.36, lw - 1, grassCol, { noBottom: true }).translate(x0, 0, z0), grass.tile));
          const face = b === 0 ? 3 : b === n - 1 ? 2 : a === 0 ? 1 : 0;
          this.addHouse(chunk, x0, z0, w, d, h, col.setHex(pick(rng, HOUSE)), rng, face);
          if (rng() < 0.5) { const tx = x0 + (rng() < 0.5 ? -1 : 1) * (w / 2 + 2), tz = z0 + rand(rng, -d / 2, d / 2); this.treeSpots.push({ x: tx, z: tz, s: rand(rng, 0.7, 1.1) }); this.colliders.insert({ minX: tx - 0.4, maxX: tx + 0.4, minZ: tz - 0.4, maxZ: tz + 0.4, height: 2, kind: 'tree' }); }
        }
        continue;
      }
      const down = district === 'downtown';
      const nx = pick(rng, down ? [1, 1, 2] : [1, 2, 2, 3]), nz = pick(rng, down ? [1, 1, 2] : [1, 2, 2, 3]);
      const lw = inner / nx, ld = inner / nz;
      for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
        if (rng() < 0.05) continue;
        const inset = rand(rng, 0.8, 2.2);
        const w = lw - inset * 2, d = ld - inset * 2;
        const x0 = minX + CFG.sidewalk + a * lw + lw / 2, z0 = minZ + CFG.sidewalk + b * ld + ld / 2;
        let h = down ? rand(rng, 30, 95) : rand(rng, 8, 32);
        h = Math.round(h / 3.5) * 3.5;
        const style = h > 40 ? (rng() < 0.75 ? 'office' : 'panel') : pick(rng, ['brick', 'brick', 'panel', 'office']);
        col.setHex(style === 'office' ? pick(rng, GLASS) : pick(rng, TINTS));
        const face = a === 0 ? 1 : a === nx - 1 ? 0 : b === 0 ? 3 : 2;
        this.addBuilding(chunk, x0, z0, w, d, h, col, rng, { style, neon: down || rng() < 0.35, sign: true, face, ledges: style === 'brick' }, storeGeos);
        if (h < 26 && rng() < 0.3) this.billboardSpots.push({ x: x0, z: z0, y: h + 0.4, w: Math.min(w, d) * 0.8, face: pick(rng, [0, 1, 2, 3]) });
        if (rng() < 0.3) this.dumpsterSpots.push({ x: minX + 2.6, z: z0 + rand(rng, -3, 3), r: Math.PI / 2 });
        if (rng() < 0.4) { const bx = minX + 1.9, bz = z0 + rand(rng, -4, 4); this.benchSpots.push({ x: bx, z: bz, r: Math.PI / 2 }); }
      }
    }
    const addMesh = (geos, m) => { if (!geos.length) return; const mesh = new THREE.Mesh(mergeGeometries(geos), m); mesh.receiveShadow = true; mesh.castShadow = false; this.scene.add(mesh); return mesh; };
    addMesh(swGeos, sidewalkMat); addMesh(grassGeos, grassMat); addMesh(lotGeos, lotMat); addMesh(storeGeos, this.storeMat);
    for (const c of chunks.values()) {
      for (const st of FACADE_STYLES) { if (c.sides[st].length) { const m = new THREE.Mesh(mergeGeometries(c.sides[st]), this.facades[st]); m.castShadow = true; m.receiveShadow = true; this.scene.add(m); } }
      if (c.roofs.length) { const m = new THREE.Mesh(mergeGeometries(c.roofs), this.roofMaterial); m.castShadow = true; m.receiveShadow = true; this.scene.add(m); }
    }
    this.buildTrees();
  }

  /** place a box on the given face of a footprint (0 +x, 1 -x, 2 +z, 3 -z) */
  facePos(x, z, w, d, face, out = 0) { if (face === 0) return { x: x + w / 2 + out, z, ry: Math.PI / 2 }; if (face === 1) return { x: x - w / 2 - out, z, ry: -Math.PI / 2 }; if (face === 2) return { x, z: z + d / 2 + out, ry: 0 }; return { x, z: z - d / 2 - out, ry: Math.PI }; }
  addBuilding(chunk, x, z, w, d, h, color, rng, { style = 'brick', neon = false, sign = false, face = 2, ledges = false } = {}, storeGeos) {
    const tile = this.facades[style].userData.tile;
    const sides = coloredBox(w, h, d, color, { noTop: true, noBottom: true, uvScale: tile });
    const pa = sides.attributes.position.array, ca = sides.attributes.color.array;
    for (let i = 0; i < pa.length / 3; i++) if (pa[i * 3 + 1] < 0) { ca[i * 3] *= 0.7; ca[i * 3 + 1] *= 0.7; ca[i * 3 + 2] *= 0.7; }
    sides.translate(x, h / 2, z); chunk.sides[style].push(sides);
    const roofCol = color.clone().multiplyScalar(0.45);
    const roof = coloredBox(w, 0.4, d, roofCol, { noBottom: true }); roof.translate(x, h, z); chunk.roofs.push(roof);
    // parapet
    const pc = color.clone().multiplyScalar(0.8);
    for (const [cx, cz, pw, pd] of [[x, z - d / 2 + 0.2, w, 0.4], [x, z + d / 2 - 0.2, w, 0.4], [x - w / 2 + 0.2, z, 0.4, d], [x + w / 2 - 0.2, z, 0.4, d]]) { const p = coloredBox(pw + 0.1, 0.7, pd + 0.1, pc); p.translate(cx, h + 0.35, cz); chunk.roofs.push(p); }
    if (ledges && h > 14) { for (let y = 14; y < h - 3; y += 14) { const l = coloredBox(w + 0.5, 0.25, d + 0.5, pc, { noBottom: false }); l.translate(x, y, z); chunk.roofs.push(l); } }
    if (rng() < 0.6) {
      const bw = w * rand(rng, 0.2, 0.45), bd = d * rand(rng, 0.2, 0.45), bh = rand(rng, 1.2, 3);
      const b = coloredBox(bw, bh, bd, roofCol, { noBottom: true }); b.translate(x + rand(rng, -w / 4, w / 4), h + bh / 2, z + rand(rng, -d / 4, d / 4)); chunk.roofs.push(b);
    }
    if (rng() < 0.5) { for (let k = 0; k < 2 + Math.floor(rng() * 3); k++) { const ac = coloredBox(1.2, 0.8, 1.2, new THREE.Color(0x8c8f94)); ac.translate(x + rand(rng, -w / 3, w / 3), h + 0.6, z + rand(rng, -d / 3, d / 3)); chunk.roofs.push(ac); } }
    if (h > 30 && rng() < 0.5) { const a = coloredBox(0.3, 8, 0.3, new THREE.Color(0x2a2a2a)); a.translate(x, h + 4, z); chunk.roofs.push(a); }
    if (h > 50 && rng() < 0.4) { const wt = new THREE.CylinderGeometry(1.4, 1.2, 2.6, 10); colorGeo(wt, new THREE.Color(0x5a4a3a)); wt.translate(x + w / 4, h + 2.5, z - d / 4); chunk.roofs.push(wt); const legs = coloredBox(2.4, 1.3, 2.4, new THREE.Color(0x3a3a3a)); legs.translate(x + w / 4, h + 0.65, z - d / 4); chunk.roofs.push(legs); }
    // storefront on the street face: glass band, pilasters, awning and a sign
    if (sign && h > 5 && storeGeos) {
      const fp = this.facePos(x, z, w, d, face, 0.08); const along = (face < 2) ? d : w;
      const glass = new THREE.BoxGeometry(face < 2 ? 0.12 : along * 0.9, 2.6, face < 2 ? along * 0.9 : 0.12); glass.translate(fp.x, 1.5, fp.z); storeGeos.push(glass);
      const frameCol = color.clone().multiplyScalar(0.5);
      for (const s of [-0.46, -0.15, 0.15, 0.46]) { const pil = coloredBox(face < 2 ? 0.3 : 0.25, 3.0, face < 2 ? 0.25 : 0.3, frameCol); pil.translate(fp.x + (face < 2 ? 0 : s * along), 1.5, fp.z + (face < 2 ? s * along : 0)); chunk.roofs.push(pil); }
      const lintel = coloredBox(face < 2 ? 0.35 : along + 0.1, 0.4, face < 2 ? along + 0.1 : 0.35, frameCol); lintel.translate(fp.x, 3.2, fp.z); chunk.roofs.push(lintel);
      const neonCol = pick(rng, NEON);
      const aw = new THREE.Color(neonCol).multiplyScalar(0.6); const awning = coloredBox(face < 2 ? 1.3 : along * 0.42, 0.08, face < 2 ? along * 0.42 : 1.3, aw); awning.translate(fp.x + (face === 0 ? 0.6 : face === 1 ? -0.6 : 0), 3.05, fp.z + (face === 2 ? 0.6 : face === 3 ? -0.6 : 0)); chunk.roofs.push(awning);
      this.neonSpots.push({ x, z, y: 3.75, face, w: Math.min(along * 0.6, 8), h: 0.6, offX: w / 2, offZ: d / 2, color: neonCol });
      if (rng() < 0.3) { const sp = this.facePos(x, z, w, d, face, 2.2); this.canSpots.push({ x: sp.x + (face < 2 ? 0 : along * 0.3), z: sp.z + (face < 2 ? along * 0.3 : 0), r: 0 }); }
    }
    if (neon && h > 12) {
      const n = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) { const f = Math.floor(rng() * 4); this.neonSpots.push({ x, z, y: rand(rng, 6, h - 3), face: f, w: rand(rng, 0.5, 1.0), h: rand(rng, 3, 9), offX: w / 2, offZ: d / 2, color: pick(rng, NEON) }); }
    }
    const box = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, height: h, kind: 'building' };
    this.colliders.insert(box); this.buildings.push(box);
  }
  addHouse(chunk, x, z, w, d, h, color, rng, face = 2) {
    const walls = coloredBox(w, h, d, color, { noTop: true, noBottom: true, uvScale: this.facades.house.userData.tile }); walls.translate(x, h / 2, z); chunk.sides.house.push(walls);
    const rc = color.clone().multiplyScalar(0.35);
    const roof = new THREE.CylinderGeometry(0, Math.hypot(w, d) / 2 + 0.5, 2.4, 4, 1); roof.rotateY(Math.PI / 4); roof.scale((w + 0.8) / Math.hypot(w, d), 1, (d + 0.8) / Math.hypot(w, d));
    colorGeo(roof, rc); roof.translate(x, h + 1.2, z); chunk.roofs.push(roof);
    const eave = coloredBox(w + 0.8, 0.18, d + 0.8, rc); eave.translate(x, h + 0.09, z); chunk.roofs.push(eave);
    const fp = this.facePos(x, z, w, d, face, 0.02);
    const door = coloredBox(face < 2 ? 0.1 : 1.1, 2.1, face < 2 ? 1.1 : 0.1, new THREE.Color(0x3a2a22)); door.translate(fp.x, 1.05, fp.z); chunk.roofs.push(door);
    const porch = coloredBox(face < 2 ? 1.6 : 2.4, 0.2, face < 2 ? 2.4 : 1.6, new THREE.Color(0x7a6a5a)); const pp = this.facePos(x, z, w, d, face, 0.8); porch.translate(pp.x, 0.25, pp.z); chunk.roofs.push(porch);
    if (rng() < 0.5) { const ch = coloredBox(0.6, 1.6, 0.6, new THREE.Color(0x5a4a42)); ch.translate(x + w / 4, h + 1.6, z - d / 5); chunk.roofs.push(ch); }
    const box = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, height: h, kind: 'building' };
    this.colliders.insert(box); this.buildings.push(box);
  }

  buildTrees() {
    const n = this.treeSpots.length; if (!n) return;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.3, 2.6, 7), new THREE.MeshStandardMaterial({ color: 0x4a2f18, roughness: 1 }), n);
    const blobs = 4; const leaf = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.15, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), n * blobs);
    const m = new THREE.Matrix4(); const c = new THREE.Color(); const rng = this.rng;
    this.treeSpots.forEach((t, k) => {
      m.makeScale(t.s, t.s, t.s); m.setPosition(t.x, 1.3 * t.s + 0.15, t.z); trunk.setMatrixAt(k, m);
      const hue = 0.24 + rng() * 0.1, light = 0.2 + rng() * 0.1;
      for (let b = 0; b < blobs; b++) {
        const a = (b / blobs) * Math.PI * 2 + rng(); const r = b === 0 ? 0 : 0.7 * t.s; const sc = (b === 0 ? 1.35 : 0.9 + rng() * 0.3) * t.s;
        m.makeScale(sc, sc * (0.85 + rng() * 0.3), sc); m.setPosition(t.x + Math.cos(a) * r, 3.1 * t.s + 0.15 + (b === 0 ? 0.3 : rng() * 0.6 - 0.2) * t.s, t.z + Math.sin(a) * r);
        leaf.setMatrixAt(k * blobs + b, m); leaf.setColorAt(k * blobs + b, c.setHSL(hue + rng() * 0.02, 0.45, light + rng() * 0.06));
      }
    });
    trunk.castShadow = leaf.castShadow = true; leaf.receiveShadow = true;
    this.scene.add(trunk, leaf);
  }

  buildProps() {
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler(); const v = new THREE.Vector3(); const sc = new THREE.Vector3(1, 1, 1);
    const place = (mesh, k, x, y, z, ry = 0, s = 1) => { q.setFromEuler(e.set(0, ry, 0)); m.compose(v.set(x, y, z), q, sc.set(s, s, s)); mesh.setMatrixAt(k, m); };
    if (this.neonSpots.length) {
      const mesh = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 0.16, 2, 0.05), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.4, vertexColors: false }), this.neonSpots.length);
      this.neonSpots.forEach((s, k) => {
        let x = s.x, z = s.z, ry = 0;
        if (s.face === 0) { x += s.offX + 0.1; ry = Math.PI / 2; } else if (s.face === 1) { x -= s.offX + 0.1; ry = -Math.PI / 2; } else if (s.face === 2) { z += s.offZ + 0.1; ry = 0; } else { z -= s.offZ + 0.1; ry = Math.PI; }
        q.setFromEuler(e.set(0, ry, 0)); m.compose(v.set(x, s.y, z), q, sc.set(s.w, s.h, 1)); mesh.setMatrixAt(k, m); mesh.setColorAt(k, new THREE.Color(s.color));
      });
      this.scene.add(mesh); this.neonMesh = mesh;
    }
    if (this.containerSpots.length) {
      const mesh = new THREE.InstancedMesh(new RoundedBoxGeometry(2.5, 2.6, 6.2, 2, 0.08), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.35 }), this.containerSpots.length);
      this.containerSpots.forEach((s, k) => { place(mesh, k, s.x, s.y + 0.15, s.z, s.rot); mesh.setColorAt(k, new THREE.Color(s.color)); });
      mesh.castShadow = true; mesh.receiveShadow = true; this.scene.add(mesh);
    }
    if (this.dumpsterSpots.length) {
      const g = mergeGeometries([colorGeo(new RoundedBoxGeometry(1.0, 1.2, 1.8, 2, 0.06).translate(0, 0.75, 0), new THREE.Color(0x2f4a33)), colorGeo(new THREE.BoxGeometry(1.06, 0.1, 1.86).translate(0, 1.38, 0), new THREE.Color(0x203425))]);
      const mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.25 }), this.dumpsterSpots.length);
      this.dumpsterSpots.forEach((s, k) => { place(mesh, k, s.x, 0.15, s.z); this.colliders.insert({ minX: s.x - 0.5, maxX: s.x + 0.5, minZ: s.z - 0.9, maxZ: s.z + 0.9, height: 1.3, kind: 'prop' }); });
      mesh.castShadow = true; this.scene.add(mesh);
    }
    if (this.hydrantSpots.length) {
      const red = new THREE.Color(0xb3261e);
      const g = mergeGeometries([colorGeo(new THREE.CylinderGeometry(0.14, 0.16, 0.6, 10).translate(0, 0.45, 0), red), colorGeo(new THREE.SphereGeometry(0.15, 10, 8).translate(0, 0.76, 0), red), colorGeo(new THREE.CylinderGeometry(0.07, 0.07, 0.42, 8).rotateZ(Math.PI / 2).translate(0, 0.5, 0), red), colorGeo(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 10).translate(0, 0.2, 0), new THREE.Color(0x6a1a14))]);
      const mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 }), this.hydrantSpots.length);
      this.hydrantSpots.forEach((s, k) => { place(mesh, k, s.x, 0.15, s.z, s.r); this.colliders.insert({ minX: s.x - 0.2, maxX: s.x + 0.2, minZ: s.z - 0.2, maxZ: s.z + 0.2, height: 0.9, kind: 'prop' }); });
      mesh.castShadow = true; this.scene.add(mesh);
    }
    if (this.canSpots.length) {
      const g = mergeGeometries([colorGeo(new THREE.CylinderGeometry(0.3, 0.27, 0.9, 12).translate(0, 0.6, 0), new THREE.Color(0x3b4046)), colorGeo(new THREE.CylinderGeometry(0.33, 0.33, 0.08, 12).translate(0, 1.08, 0), new THREE.Color(0x2a2d31))]);
      const mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.4 }), this.canSpots.length);
      this.canSpots.forEach((s, k) => { place(mesh, k, s.x, 0.15, s.z); this.colliders.insert({ minX: s.x - 0.3, maxX: s.x + 0.3, minZ: s.z - 0.3, maxZ: s.z + 0.3, height: 1.1, kind: 'prop' }); });
      mesh.castShadow = true; this.scene.add(mesh);
    }
    if (this.benchSpots.length) {
      const wood = new THREE.Color(0x6b4a2e), iron = new THREE.Color(0x2b2b2b);
      const parts = [colorGeo(new RoundedBoxGeometry(1.8, 0.08, 0.5, 2, 0.02).translate(0, 0.6, 0), wood), colorGeo(new RoundedBoxGeometry(1.8, 0.4, 0.07, 2, 0.02).translate(0, 0.9, -0.24), wood)];
      for (const s of [-0.8, 0.8]) parts.push(colorGeo(new THREE.BoxGeometry(0.08, 0.6, 0.46).translate(s, 0.3, 0), iron));
      const mesh = new THREE.InstancedMesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), this.benchSpots.length);
      this.benchSpots.forEach((s, k) => place(mesh, k, s.x, 0.15, s.z, s.r)); mesh.castShadow = true; this.scene.add(mesh);
    }
    if (this.shelterSpots.length) {
      const frame = new THREE.Color(0x30343a);
      const parts = [colorGeo(new RoundedBoxGeometry(4.2, 0.12, 1.8, 2, 0.03).translate(0, 2.6, 0), frame)];
      for (const s of [-1.9, 1.9]) parts.push(colorGeo(new THREE.BoxGeometry(0.1, 2.6, 0.1).translate(s, 1.3, -0.8), frame), colorGeo(new THREE.BoxGeometry(0.1, 2.6, 0.1).translate(s, 1.3, 0.8), frame));
      parts.push(colorGeo(new RoundedBoxGeometry(1.6, 0.06, 0.5, 2, 0.02).translate(0, 0.55, -0.5), new THREE.Color(0x4a4e55)));
      const mesh = new THREE.InstancedMesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.5 }), this.shelterSpots.length);
      const glass = new THREE.InstancedMesh(new THREE.BoxGeometry(3.9, 2.4, 0.04), new THREE.MeshStandardMaterial({ color: 0x9fc3d8, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.6 }), this.shelterSpots.length);
      this.shelterSpots.forEach((s, k) => { place(mesh, k, s.x, 0.15, s.z, s.r); place(glass, k, s.x, 1.45, s.z - 0.82, s.r); this.colliders.insert({ minX: s.x - 2, maxX: s.x + 2, minZ: s.z - 0.9, maxZ: s.z - 0.7, height: 2.6, kind: 'prop' }); });
      mesh.castShadow = true; this.scene.add(mesh, glass);
    }
    // billboards
    const texes = []; for (let i = 0; i < 10; i++) texes.push(makeBillboard(this.rng));
    const postMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.6, metalness: 0.5 });
    this.billboardSpots.forEach((s, k) => {
      const t = texes[k % texes.length]; let mt = this.billboardMats[k % texes.length];
      if (!mt) { mt = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.7 }); this.billboardMats[k % texes.length] = mt; }
      const g = new THREE.Group(); const bw = Math.max(5, s.w), bh = bw / 2;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.15), [postMat, postMat, postMat, postMat, mt, postMat]); panel.position.y = 2.2 + bh / 2; g.add(panel);
      for (const px of [-bw / 3, bw / 3]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.4, 0.15), postMat); post.position.set(px, 1.2, 0); g.add(post); }
      g.position.set(s.x, s.y, s.z); g.rotation.y = [Math.PI / 2, -Math.PI / 2, 0, Math.PI][s.face]; panel.castShadow = true; this.scene.add(g);
    });
  }

  buildBeach() {
    const rng = this.rng; const b = this.bounds; const z0 = this.half + 2, z1 = b.maxZ;
    const n = 44;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.26, 7, 7), new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 1 }), n);
    // bent fronds
    const frond = new THREE.PlaneGeometry(0.75, 3.4, 1, 10); { const p = frond.attributes.position.array; for (let i = 0; i < p.length / 3; i++) { const x = p[i * 3], y = p[i * 3 + 1]; const t = (y + 1.7) / 3.4; p[i * 3] = x * (1 - t * 0.75); p[i * 3 + 1] = -(t * t) * 1.7; p[i * 3 + 2] = t * 3.4; } frond.computeVertexNormals(); }
    const fronds = 8; const leaf = new THREE.InstancedMesh(frond, new THREE.MeshStandardMaterial({ color: 0x4d8a3a, roughness: 0.85, side: THREE.DoubleSide }), n * fronds);
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler(); const v = new THREE.Vector3(); const sc = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      const x = rand(rng, b.minX + 8, b.maxX - 8), z = rand(rng, z0 + 4, z1 - 10); const s = rand(rng, 0.8, 1.3);
      q.setFromEuler(e.set(rand(rng, -0.08, 0.08), 0, rand(rng, -0.08, 0.08))); m.compose(v.set(x, 3.5 * s, z), q, sc.set(s, s, s)); trunk.setMatrixAt(k, m);
      for (let f = 0; f < fronds; f++) { q.setFromEuler(e.set(rand(rng, -0.1, 0.25), (f / fronds) * Math.PI * 2 + rng() * 0.4, 0)); m.compose(v.set(x, 7 * s, z), q, sc.set(s, s, s)); leaf.setMatrixAt(k * fronds + f, m); }
      this.colliders.insert({ minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35, height: 7, kind: 'tree' });
    }
    trunk.castShadow = leaf.castShadow = true; this.scene.add(trunk, leaf);
    const walk = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX, 0.3, 5), new THREE.MeshStandardMaterial({ color: 0x6a5238, roughness: 1 })); walk.position.set(0, 0.05, z0 + 2.5); walk.receiveShadow = true; this.scene.add(walk);
    const pierMat = new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 1 });
    const pier = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 90), pierMat); pier.position.set(0, 0.45, z1 + 25); pier.castShadow = pier.receiveShadow = true; this.scene.add(pier);
    this.pier = { minX: -4, maxX: 4, minZ: z1 - 20, maxZ: z1 + 70 };
    this.bounds.maxZ = z1 + 68;
    for (let k = 0; k < 8; k++) for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 3, 8), pierMat); post.position.set(s * 3.6, -1, z1 - 20 + k * 12); this.scene.add(post); }
    for (const s of [-1, 1]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 90), pierMat); rail.position.set(s * 3.9, 1.7, z1 + 25); this.scene.add(rail); for (let k = 0; k < 30; k++) { const bal = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), pierMat); bal.position.set(s * 3.9, 1.2, z1 - 20 + k * 3.1); this.scene.add(bal); } }
    this.colliders.insert({ minX: 3.8, maxX: 4.2, minZ: z1 - 20, maxZ: z1 + 70, height: 2, kind: 'prop' }); this.colliders.insert({ minX: -4.2, maxX: -3.8, minZ: z1 - 20, maxZ: z1 + 70, height: 2, kind: 'prop' });
    this.colliders.insert({ minX: -4.2, maxX: 4.2, minZ: z1 + 69.5, maxZ: z1 + 70.5, height: 2, kind: 'prop' });
    // a few beach umbrellas
    for (let k = 0; k < 14; k++) { const x = rand(rng, b.minX + 20, b.maxX - 20), z = rand(rng, z0 + 10, z1 - 12); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), pierMat); pole.position.set(x, 1.1, z); const top = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.5, 10, 1, true), new THREE.MeshStandardMaterial({ color: pick(rng, [0xe04a3a, 0x3a7ae0, 0xf2d33a, 0x2fb37a]), side: THREE.DoubleSide, roughness: 0.9 })); top.position.set(x, 2.2, z); this.scene.add(pole, top); }
  }

  buildRoads() {
    const geos = []; const N = this.N; const R = this.R; const yellow = new THREE.Color(0xc2a53a), white = new THREE.Color(0xc8c8c4);
    const y = 0.02;
    for (let i = 0; i <= N; i++) {
      const c = this.roadCenter(i);
      for (let j = 0; j < N; j++) {
        const a = this.blockMin(j), b = this.blockMax(j);
        for (let p = a + 1.5; p < b - 2; p += 6) {
          const g1 = coloredBox(0.22, 0.04, 3, yellow); g1.translate(c, y, p + 1.5); geos.push(g1);
          const g2 = coloredBox(3, 0.04, 0.22, yellow); g2.translate(p + 1.5, y, c); geos.push(g2);
        }
        for (const s of [-1, 1]) {
          const e1 = coloredBox(0.18, 0.04, b - a, white); e1.translate(c + s * (R / 2 - 0.4), y, (a + b) / 2); geos.push(e1);
          const e2 = coloredBox(b - a, 0.04, 0.18, white); e2.translate((a + b) / 2, y, c + s * (R / 2 - 0.4)); geos.push(e2);
        }
        // stop lines just before the crosswalks (right-hand lanes)
        const sz = R / 2 - 0.9;
        geos.push(coloredBox(sz, 0.04, 0.4, white).translate(c - R / 4, y, b - 3.0), coloredBox(sz, 0.04, 0.4, white).translate(c + R / 4, y, a + 3.0));
        geos.push(coloredBox(0.4, 0.04, sz, white).translate(b - 3.0, y, c + R / 4), coloredBox(0.4, 0.04, sz, white).translate(a + 3.0, y, c - R / 4));
      }
    }
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = this.roadCenter(i), z = this.roadCenter(j);
      for (const s of [-1, 1]) for (let k = -3; k <= 3; k++) {
        const g1 = coloredBox(0.6, 0.04, 2.2, white); g1.translate(x + k * 1.7, y, z + s * (R / 2 + 1.3)); geos.push(g1);
        const g2 = coloredBox(2.2, 0.04, 0.6, white); g2.translate(x + s * (R / 2 + 1.3), y, z + k * 1.7); geos.push(g2);
      }
    }
    const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    this.scene.add(m);
  }

  buildRoadGraph() {
    const N = this.N; this.nodes = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const adj = [];
      if (i > 0) adj.push(this.nodeId(i - 1, j)); if (i < N) adj.push(this.nodeId(i + 1, j));
      if (j > 0) adj.push(this.nodeId(i, j - 1)); if (j < N) adj.push(this.nodeId(i, j + 1));
      this.nodes.push({ id: this.nodeId(i, j), i, j, x: this.roadCenter(i), z: this.roadCenter(j), adj });
    }
  }
  lightGreen(node, axis, time) {
    const cycle = 16; const off = ((node.i + node.j) % 2) * (cycle / 2);
    const t = (time + off) % cycle;
    const zGreen = t < cycle / 2 - 1.5;
    const xGreen = t >= cycle / 2 && t < cycle - 1.5;
    return axis === 'z' ? zGreen : xGreen;
  }
  findPath(from, to) {
    if (from === to) return [from];
    const prev = new Map([[from, -1]]); const q = [from];
    while (q.length) {
      const n = q.shift();
      for (const a of this.nodes[n].adj) { if (prev.has(a)) continue; prev.set(a, n); if (a === to) { const path = [to]; let c = to; while (prev.get(c) !== -1) { c = prev.get(c); path.push(c); } return path.reverse(); } q.push(a); }
    }
    return [from];
  }

  buildSidewalkGraph() {
    const N = this.N; const s = CFG.sidewalk / 2; this.sidewalkNodes = [];
    const id = (i, j, c) => (i * N + j) * 4 + c;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const b = this.block(i, j);
      const corners = [[b.minX + s, b.minZ + s], [b.maxX - s, b.minZ + s], [b.maxX - s, b.maxZ - s], [b.minX + s, b.maxZ - s]];
      for (let c = 0; c < 4; c++) this.sidewalkNodes.push({ id: id(i, j, c), x: corners[c][0], z: corners[c][1], adj: [], block: b });
    }
    const link = (a, b) => { this.sidewalkNodes[a].adj.push(b); this.sidewalkNodes[b].adj.push(a); };
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      for (let c = 0; c < 4; c++) link(id(i, j, c), id(i, j, (c + 1) % 4));
      if (i < N - 1) { link(id(i, j, 1), id(i + 1, j, 0)); link(id(i, j, 2), id(i + 1, j, 3)); }
      if (j < N - 1) { link(id(i, j, 3), id(i, j + 1, 0)); link(id(i, j, 2), id(i, j + 1, 1)); }
    }
  }

  buildLamps() {
    const spots = []; const N = this.N; const inset = 0.6;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const b = this.block(i, j);
      for (const f of [0.3, 0.7]) {
        const px = b.minX + (b.maxX - b.minX) * f, pz = b.minZ + (b.maxZ - b.minZ) * f;
        spots.push({ x: px, z: b.minZ + inset, r: 0 }, { x: px, z: b.maxZ - inset, r: Math.PI }, { x: b.minX + inset, z: pz, r: Math.PI / 2 }, { x: b.maxX - inset, z: pz, r: -Math.PI / 2 });
      }
    }
    const n = spots.length;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: 0.5, metalness: 0.6 });
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.14, 6, 8), poleMat, n);
    const armGeo = new THREE.CylinderGeometry(0.06, 0.07, 1.7, 6); armGeo.rotateX(Math.PI / 2); armGeo.translate(0, 0.1, -0.85);
    const arm = new THREE.InstancedMesh(armGeo, poleMat, n);
    const headGeo = new THREE.CylinderGeometry(0.22, 0.32, 0.28, 10); const head = new THREE.InstancedMesh(headGeo, poleMat, n);
    this.lampMaterial = new THREE.MeshStandardMaterial({ color: 0xffe6b0, emissive: 0xffc46a, emissiveIntensity: 0, roughness: 0.4 });
    const bulb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 10, 8), this.lampMaterial, n);
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler(); const v = new THREE.Vector3(); const sc = new THREE.Vector3(1, 1, 1);
    const glowPos = new Float32Array(n * 3);
    spots.forEach((s, k) => {
      m.compose(v.set(s.x, 3.15, s.z), q.identity(), sc); pole.setMatrixAt(k, m);
      q.setFromEuler(e.set(0, s.r, 0));
      m.compose(v.set(s.x, 6, s.z), q, sc); arm.setMatrixAt(k, m);
      const end = new THREE.Vector3(0, 0, -1.6).applyQuaternion(q);
      m.compose(v.set(s.x + end.x, 6.0, s.z + end.z), q, sc); head.setMatrixAt(k, m);
      m.compose(v.set(s.x + end.x, 5.85, s.z + end.z), q, sc); bulb.setMatrixAt(k, m);
      glowPos[k * 3] = s.x + end.x; glowPos[k * 3 + 1] = 5.8; glowPos[k * 3 + 2] = s.z + end.z;
      this.colliders.insert({ minX: s.x - 0.2, maxX: s.x + 0.2, minZ: s.z - 0.2, maxZ: s.z + 0.2, height: 6, kind: 'lamp' });
    });
    pole.castShadow = true;
    this.scene.add(pole, arm, head, bulb);
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
    this.lampGlow = new THREE.Points(gg, new THREE.PointsMaterial({ map: GLOW_TEX, color: 0xffc46a, size: 4.5, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.scene.add(this.lampGlow);
  }

  buildTrafficLights() {
    const R = this.R; const approaches = [];
    for (const n of this.nodes) {
      for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rx = -d[1], rz = d[0];
        const x = n.x + d[0] * (R / 2 + 0.9) + rx * (R / 2 + 0.9), z = n.z + d[1] * (R / 2 + 0.9) + rz * (R / 2 + 0.9);
        approaches.push({ node: n, axis: d[0] !== 0 ? 'x' : 'z', x, z, heading: Math.atan2(-d[0], -d[1]) });
      }
    }
    const n = approaches.length; this.approaches = approaches;
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.1, 4.2, 8), new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.5, metalness: 0.5 }), n);
    const housing = new THREE.InstancedMesh(new RoundedBoxGeometry(0.36, 1.0, 0.36, 2, 0.05), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 }), n);
    this.redLights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    this.greenLights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler(); const v = new THREE.Vector3(); const sc = new THREE.Vector3(1, 1, 1);
    approaches.forEach((a, k) => {
      q.setFromEuler(e.set(0, a.heading, 0));
      m.compose(v.set(a.x, 2.1, a.z), q, sc); pole.setMatrixAt(k, m);
      m.compose(v.set(a.x, 4.4, a.z), q, sc); housing.setMatrixAt(k, m);
      const f = new THREE.Vector3(0, 0, 0.2).applyQuaternion(q);
      m.compose(v.set(a.x + f.x, 4.72, a.z + f.z), q, sc); this.redLights.setMatrixAt(k, m);
      m.compose(v.set(a.x + f.x, 4.1, a.z + f.z), q, sc); this.greenLights.setMatrixAt(k, m);
      this.redLights.setColorAt(k, new THREE.Color(1, 1, 1)); this.greenLights.setColorAt(k, new THREE.Color(1, 1, 1));
      this.colliders.insert({ minX: a.x - 0.15, maxX: a.x + 0.15, minZ: a.z - 0.15, maxZ: a.z + 0.15, height: 4, kind: 'pole' });
    });
    this.scene.add(pole, housing, this.redLights, this.greenLights);
    this._lightPhaseKey = -1;
  }
  updateTrafficLights(time) {
    const key = Math.floor(time * 4);
    if (key === this._lightPhaseKey) return; this._lightPhaseKey = key;
    const rOn = new THREE.Color(1.6, 0.2, 0.12), rOff = new THREE.Color(0.2, 0.03, 0.03), gOn = new THREE.Color(0.25, 1.6, 0.4), gOff = new THREE.Color(0.03, 0.15, 0.05);
    this.approaches.forEach((a, k) => {
      const g = this.lightGreen(a.node, a.axis, time);
      this.greenLights.setColorAt(k, g ? gOn : gOff); this.redLights.setColorAt(k, g ? rOff : rOn);
    });
    this.greenLights.instanceColor.needsUpdate = true; this.redLights.instanceColor.needsUpdate = true;
  }
}
