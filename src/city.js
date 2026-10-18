import * as THREE from 'three';
import { CFG } from './config.js';
import { mergeGeometries, coloredBox, mulberry32, rand, pick } from './util.js';
import { SpatialHash } from './physics.js';
import { GLOW_TEX } from './effects.js';

// gritty, desaturated palette
const TINTS = [0x9a9a9e, 0xa39c93, 0x8b9099, 0xa89a8c, 0x7d8690, 0xb2a99c, 0x95847a, 0x6f7784, 0xa49f96, 0x8f9aa5, 0xa79b8d, 0x857f78];
const GLASS = [0x7f9ab0, 0x6f8aa0, 0x8ea3b5, 0x7a93a7];
const NEON = [0xff2d7a, 0x2dd4ff, 0xb6ff2d, 0xff8c2d, 0xd02dff, 0x2dff9a, 0xffe92d, 0xff4040];
const HOUSE = [0xa08a78, 0xb0a498, 0x8c969c, 0xb8a68e, 0x7f8c96, 0xa89a8e];

function makeWindowTexture(rng) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d2cec8'; g.fillRect(0, 0, 128, 128);
  // grime streaks
  for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(20,18,16,${0.05 + rng() * 0.12})`; const x = rng() * 128; g.fillRect(x, 0, 1 + rng() * 3, 128); }
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${rng() * 0.25})`; g.fillRect(rng() * 128, rng() * 128, 2, 2); }
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const lit = rng() < 0.3;
    g.fillStyle = lit ? (rng() < 0.5 ? '#f0d9a0' : '#d8e6ff') : (rng() < 0.5 ? '#141a22' : '#1b2430');
    g.fillRect(x * 64 + 14, y * 64 + 10, 36, 44);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x * 64 + 14, y * 64 + 50, 36, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function makeRoadTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#24242a'; g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(${30 + Math.random() * 30 | 0},${30 + Math.random() * 30 | 0},${35 + Math.random() * 30 | 0},0.7)`; g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2); }
  for (let i = 0; i < 6; i++) { g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.random() * 64, Math.random() * 64); g.lineTo(Math.random() * 64, Math.random() * 64); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class City {
  constructor(scene, seed = CFG.seed) {
    this.scene = scene;
    this.rng = mulberry32(seed);
    this.N = CFG.blocks; this.P = CFG.blockSize + CFG.roadWidth; this.R = CFG.roadWidth; this.B = CFG.blockSize;
    this.origin = -(this.N * this.P) / 2;
    this.half = (this.N * this.P) / 2 + this.R / 2; // half extent of paved area
    this.bound = this.half + 10;
    this.beachDepth = 48;
    this.bounds = { minX: -this.bound, maxX: this.bound, minZ: -this.bound, maxZ: this.half + this.beachDepth - 2 };
    this.colliders = new SpatialHash(16);
    this.blocks = []; this.buildings = []; this.parkingSpots = []; this.treeSpots = []; this.palmSpots = []; this.neonSpots = []; this.containerSpots = []; this.dumpsterSpots = [];
    this.lampMaterial = null; this.buildingMaterial = null;
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
  nodePos(id) { const i = Math.floor(id / (this.N + 1)), j = id % (this.N + 1); return { x: this.roadCenter(i), z: this.roadCenter(j), i, j }; }
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
    const roadTex = makeRoadTexture(); roadTex.repeat.set(240, 240);
    const paved = new THREE.Mesh(new THREE.PlaneGeometry(this.half * 2, this.half * 2), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.9, metalness: 0.05 }));
    paved.rotation.x = -Math.PI / 2; paved.receiveShadow = true; s.add(paved); this.roadMaterial = paved.material;
    const b = this.bounds; const w = b.maxX - b.minX + 2, d = b.maxZ - b.minZ + 2;
    const shore = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: 0x9c8f72, roughness: 1 }));
    shore.rotation.x = -Math.PI / 2; shore.position.set((b.minX + b.maxX) / 2, -0.05, (b.minZ + b.maxZ) / 2); shore.receiveShadow = true; s.add(shore);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x15303d, roughness: 0.25, metalness: 0.3 }));
    water.rotation.x = -Math.PI / 2; water.position.y = -0.6; s.add(water);
    this.water = water;
  }

  buildBlocks() {
    const rng = this.rng; const N = this.N;
    const winTex = makeWindowTexture(rng);
    this.buildingMaterial = new THREE.MeshStandardMaterial({ map: winTex, vertexColors: true, emissiveMap: winTex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.75, metalness: 0.15 });
    this.roofMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const slabMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const slabGeos = [];
    const chunkSize = 4; const chunks = new Map();
    const chunkOf = (i, j) => { const k = Math.floor(i / chunkSize) * 100 + Math.floor(j / chunkSize); let c = chunks.get(k); if (!c) { c = { sides: [], roofs: [] }; chunks.set(k, c); } return c; };
    const col = new THREE.Color();
    const sidewalkCol = new THREE.Color(0x6e6c68), grassCol = new THREE.Color(0x3f5a33), lotCol = new THREE.Color(0x2c2c30), dirtCol = new THREE.Color(0x4a4238);

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

      // slab: sidewalk ring + inner fill
      const ring = coloredBox(this.B, 0.3, this.B, sidewalkCol, { noBottom: true }); ring.translate(blk.cx, 0, blk.cz); slabGeos.push(ring);
      const innerCol = type === 'park' ? grassCol : type === 'lot' ? lotCol : district === 'industrial' ? dirtCol : null;
      if (innerCol) { const inner = coloredBox(this.B - CFG.sidewalk * 2, 0.34, this.B - CFG.sidewalk * 2, innerCol, { noBottom: true }); inner.translate(blk.cx, 0, blk.cz); slabGeos.push(inner); }

      if (type === 'park') {
        const n = 10 + Math.floor(rng() * 8);
        for (let k = 0; k < n; k++) {
          const x = rand(rng, minX + 6, maxX - 6), z = rand(rng, minZ + 6, maxZ - 6);
          this.treeSpots.push({ x, z, s: rand(rng, 0.8, 1.4) });
          this.colliders.insert({ minX: x - 0.45, maxX: x + 0.45, minZ: z - 0.45, maxZ: z + 0.45, height: 2, kind: 'tree' });
        }
        continue;
      }
      if (type === 'lot') {
        for (let rr = 0; rr < 2; rr++) for (let k = 0; k < 6; k++) {
          if (rng() < 0.5) continue;
          const x = minX + 8 + k * 5.2, z = rr === 0 ? minZ + 10 : maxZ - 10;
          this.parkingSpots.push({ x, z, heading: rr === 0 ? Math.PI : 0 });
        }
        this.addBuilding(chunk, blk.cx, blk.cz, 6, 5, 3.2, col.setHex(0xa08a78), rng, { sign: true });
        continue;
      }

      const inner = this.B - CFG.sidewalk * 2;
      if (district === 'industrial') {
        // warehouses + container yard
        const nx = pick(rng, [1, 2]); const lw = inner / nx;
        for (let a = 0; a < nx; a++) {
          const x0 = minX + CFG.sidewalk + a * lw + lw / 2; const w = lw - 4, d = rand(rng, 14, 22), h = rand(rng, 6, 11);
          const z0 = minZ + CFG.sidewalk + d / 2 + 2;
          this.addBuilding(chunk, x0, z0, w, d, h, col.setHex(pick(rng, [0x8c8880, 0x9a8a78, 0x767a80, 0xa08c70])), rng, { plain: true });
          if (rng() < 0.4) { const sx = x0 + rand(rng, -w / 3, w / 3); const st = coloredBox(1.4, 16, 1.4, new THREE.Color(0x3a3634)); st.translate(sx, h + 8, z0); chunk.roofs.push(st); }
        }
        // containers in the back yard
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
        // houses in a 3x3 grid with yards
        const n = 3; const lw = inner / n;
        for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
          if (rng() < 0.12) continue;
          const x0 = minX + CFG.sidewalk + a * lw + lw / 2, z0 = minZ + CFG.sidewalk + b * lw + lw / 2;
          const w = rand(rng, 6, 8.5), d = rand(rng, 6, 8.5), h = rand(rng, 3.2, 4.2) + (rng() < 0.3 ? 3 : 0);
          const yard = coloredBox(lw - 1, 0.36, lw - 1, grassCol, { noBottom: true }); yard.translate(x0, 0, z0); slabGeos.push(yard);
          this.addHouse(chunk, x0, z0, w, d, h, col.setHex(pick(rng, HOUSE)), rng);
          if (rng() < 0.5) { const tx = x0 + (rng() < 0.5 ? -1 : 1) * (w / 2 + 2), tz = z0 + rand(rng, -d / 2, d / 2); this.treeSpots.push({ x: tx, z: tz, s: rand(rng, 0.7, 1.1) }); this.colliders.insert({ minX: tx - 0.4, maxX: tx + 0.4, minZ: tz - 0.4, maxZ: tz + 0.4, height: 2, kind: 'tree' }); }
        }
        continue;
      }
      // downtown / commercial towers
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
        col.setHex(pick(rng, TINTS));
        if (h > 45 && rng() < 0.65) col.setHex(pick(rng, GLASS));
        this.addBuilding(chunk, x0, z0, w, d, h, col, rng, { neon: down || rng() < 0.35, sign: true });
        if (rng() < 0.3) this.dumpsterSpots.push({ x: minX + 2.6, z: z0 + rand(rng, -3, 3), r: Math.PI / 2 });
      }
    }
    const slabMesh = new THREE.Mesh(mergeGeometries(slabGeos), slabMat); slabMesh.receiveShadow = true; this.scene.add(slabMesh);
    for (const c of chunks.values()) {
      if (c.sides.length) { const m = new THREE.Mesh(mergeGeometries(c.sides), this.buildingMaterial); m.castShadow = true; m.receiveShadow = true; this.scene.add(m); }
      if (c.roofs.length) { const m = new THREE.Mesh(mergeGeometries(c.roofs), this.roofMaterial); m.castShadow = true; m.receiveShadow = true; this.scene.add(m); }
    }
    this.buildTrees();
  }

  addBuilding(chunk, x, z, w, d, h, color, rng, { plain = false, neon = false, sign = false } = {}) {
    const sides = coloredBox(w, h, d, color, { noTop: true, noBottom: true, uvScale: plain ? 1000 : 7 });
    // grime: darken the base vertices
    const pa = sides.attributes.position.array, ca = sides.attributes.color.array;
    for (let i = 0; i < pa.length / 3; i++) if (pa[i * 3 + 1] < 0) { ca[i * 3] *= 0.55; ca[i * 3 + 1] *= 0.55; ca[i * 3 + 2] *= 0.55; }
    sides.translate(x, h / 2, z); chunk.sides.push(sides);
    const roofCol = color.clone().multiplyScalar(0.5);
    const roof = coloredBox(w, 0.4, d, roofCol, { noBottom: true }); roof.translate(x, h, z); chunk.roofs.push(roof);
    if (rng() < 0.6) {
      const bw = w * rand(rng, 0.2, 0.45), bd = d * rand(rng, 0.2, 0.45), bh = rand(rng, 1.2, 3);
      const b = coloredBox(bw, bh, bd, roofCol, { noBottom: true }); b.translate(x + rand(rng, -w / 4, w / 4), h + bh / 2, z + rand(rng, -d / 4, d / 4)); chunk.roofs.push(b);
    }
    if (h > 30 && rng() < 0.5) { const a = coloredBox(0.3, 8, 0.3, new THREE.Color(0x2a2a2a)); a.translate(x, h + 4, z); chunk.roofs.push(a); }
    // ground-floor storefront band (darker) + sign
    if (sign && h > 5) {
      const band = coloredBox(w + 0.1, 3.6, d + 0.1, new THREE.Color(0x33363c), { noTop: true, noBottom: true }); band.translate(x, 1.8, z); chunk.roofs.push(band);
      const face = Math.floor(rng() * 4); // 0 +x 1 -x 2 +z 3 -z
      const sw = Math.min(w, d) * rand(rng, 0.4, 0.8);
      this.neonSpots.push({ x, z, y: 3.3, face, w: sw, h: 0.7, offX: w / 2, offZ: d / 2, color: pick(rng, NEON) });
    }
    if (neon && h > 12) {
      const n = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) { const face = Math.floor(rng() * 4); this.neonSpots.push({ x, z, y: rand(rng, 6, h - 3), face, w: rand(rng, 0.6, 1.2), h: rand(rng, 3, 9), offX: w / 2, offZ: d / 2, color: pick(rng, NEON) }); }
    }
    const box = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, height: h, kind: 'building' };
    this.colliders.insert(box); this.buildings.push(box);
  }
  addHouse(chunk, x, z, w, d, h, color, rng) {
    const walls = coloredBox(w, h, d, color, { noTop: true, noBottom: true, uvScale: 1000 }); walls.translate(x, h / 2, z); chunk.sides.push(walls);
    const roof = new THREE.CylinderGeometry(0, Math.hypot(w, d) / 2 + 0.3, 2.2, 4, 1); roof.rotateY(Math.PI / 4); roof.scale(w / Math.hypot(w, d) * 1.05, 1, d / Math.hypot(w, d) * 1.05);
    const rc = color.clone().multiplyScalar(0.45); const n = roof.attributes.position.count; const ca = new Float32Array(n * 3); for (let i = 0; i < n; i++) { ca[i * 3] = rc.r; ca[i * 3 + 1] = rc.g; ca[i * 3 + 2] = rc.b; }
    roof.setAttribute('color', new THREE.BufferAttribute(ca, 3)); roof.translate(x, h + 1.1, z); chunk.roofs.push(roof);
    const door = coloredBox(1.1, 2.1, 0.2, new THREE.Color(0x2a2220)); door.translate(x, 1.05, z + d / 2); chunk.roofs.push(door);
    const box = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, height: h, kind: 'building' };
    this.colliders.insert(box); this.buildings.push(box);
  }

  buildTrees() {
    const n = this.treeSpots.length; if (!n) return;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x4a2f18, roughness: 1 }), n);
    const leaf = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.6, 1), new THREE.MeshStandardMaterial({ color: 0x2f5a2a, roughness: 0.9, flatShading: true }), n);
    const m = new THREE.Matrix4(); const c = new THREE.Color();
    this.treeSpots.forEach((t, k) => {
      m.makeScale(t.s, t.s, t.s); m.setPosition(t.x, 1.1 * t.s + 0.15, t.z); trunk.setMatrixAt(k, m);
      m.makeScale(t.s, t.s * 1.1, t.s); m.setPosition(t.x, 3.2 * t.s + 0.15, t.z); leaf.setMatrixAt(k, m);
      leaf.setColorAt(k, c.setHSL(0.26 + this.rng() * 0.08, 0.4, 0.22 + this.rng() * 0.1));
    });
    trunk.castShadow = leaf.castShadow = true; leaf.receiveShadow = true;
    this.scene.add(trunk, leaf);
  }

  buildProps() {
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler(); const v = new THREE.Vector3(); const sc = new THREE.Vector3(1, 1, 1);
    // neon signs / storefront signs
    if (this.neonSpots.length) {
      const geo = new THREE.BoxGeometry(1, 1, 0.18);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), this.neonSpots.length);
      this.neonSpots.forEach((s, k) => {
        let x = s.x, z = s.z, ry = 0;
        if (s.face === 0) { x += s.offX + 0.12; ry = Math.PI / 2; } else if (s.face === 1) { x -= s.offX + 0.12; ry = -Math.PI / 2; } else if (s.face === 2) { z += s.offZ + 0.12; ry = 0; } else { z -= s.offZ + 0.12; ry = Math.PI; }
        q.setFromEuler(e.set(0, ry, 0)); m.compose(v.set(x, s.y, z), q, sc.set(s.w, s.h, 1)); mesh.setMatrixAt(k, m); mesh.setColorAt(k, new THREE.Color(s.color));
      });
      this.scene.add(mesh); this.neonMesh = mesh;
    }
    if (this.containerSpots.length) {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.5, 2.6, 6.2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.3 }), this.containerSpots.length);
      this.containerSpots.forEach((s, k) => { q.setFromEuler(e.set(0, s.rot, 0)); m.compose(v.set(s.x, s.y + 0.15, s.z), q, sc.set(1, 1, 1)); mesh.setMatrixAt(k, m); mesh.setColorAt(k, new THREE.Color(s.color)); });
      mesh.castShadow = true; mesh.receiveShadow = true; this.scene.add(mesh);
    }
    if (this.dumpsterSpots.length) {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 1.3, 1.8), new THREE.MeshStandardMaterial({ color: 0x2f4a33, roughness: 0.9, metalness: 0.2 }), this.dumpsterSpots.length);
      this.dumpsterSpots.forEach((s, k) => { q.setFromEuler(e.set(0, 0, 0)); m.compose(v.set(s.x, 0.8, s.z), q, sc.set(1, 1, 1)); mesh.setMatrixAt(k, m); this.colliders.insert({ minX: s.x - 0.5, maxX: s.x + 0.5, minZ: s.z - 0.9, maxZ: s.z + 0.9, height: 1.3, kind: 'prop' }); });
      mesh.castShadow = true; this.scene.add(mesh);
    }
  }

  buildBeach() {
    const rng = this.rng; const b = this.bounds; const z0 = this.half + 2, z1 = b.maxZ;
    // sand already covered by the shore plane; add palms, a boardwalk and a pier
    const n = 40;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.28, 7, 6), new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 1 }), n);
    const leaf = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 1.2, 6, 1, true), new THREE.MeshStandardMaterial({ color: 0x3e7a3a, roughness: 0.9, side: THREE.DoubleSide, flatShading: true }), n);
    const m = new THREE.Matrix4();
    for (let k = 0; k < n; k++) {
      const x = rand(rng, b.minX + 8, b.maxX - 8), z = rand(rng, z0 + 4, z1 - 10); const s = rand(rng, 0.8, 1.3);
      m.makeScale(s, s, s); m.setPosition(x, 3.5 * s, z); trunk.setMatrixAt(k, m);
      m.makeScale(s, s, s); m.setPosition(x, 7 * s, z); leaf.setMatrixAt(k, m);
      this.colliders.insert({ minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35, height: 7, kind: 'tree' });
    }
    trunk.castShadow = leaf.castShadow = true; this.scene.add(trunk, leaf);
    const walk = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX, 0.3, 5), new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 })); walk.position.set(0, 0.05, z0 + 2.5); walk.receiveShadow = true; this.scene.add(walk);
    const pier = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 90), new THREE.MeshStandardMaterial({ color: 0x4f3d2c, roughness: 1 })); pier.position.set(0, 0.45, z1 + 25); pier.castShadow = pier.receiveShadow = true; this.scene.add(pier);
    this.pier = { minX: -4, maxX: 4, minZ: z1 - 20, maxZ: z1 + 70 };
    this.bounds.maxZ = z1 + 68; // allow walking out onto the pier (beach water beyond is clamped by groundHeight)
    this.pierOnly = { minX: -4, maxX: 4, minZ: z1 - 2 };
    for (let k = 0; k < 8; k++) for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 3, 6), pier.material); post.position.set(s * 3.6, -1, z1 - 20 + k * 12); this.scene.add(post); }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1, 90), pier.material); rail.position.set(3.9, 1.2, z1 + 25); this.scene.add(rail); const rail2 = rail.clone(); rail2.position.x = -3.9; this.scene.add(rail2);
    this.colliders.insert({ minX: 3.8, maxX: 4.2, minZ: z1 - 20, maxZ: z1 + 70, height: 2, kind: 'prop' }); this.colliders.insert({ minX: -4.2, maxX: -3.8, minZ: z1 - 20, maxZ: z1 + 70, height: 2, kind: 'prop' });
    this.colliders.insert({ minX: -4.2, maxX: 4.2, minZ: z1 + 69.5, maxZ: z1 + 70.5, height: 2, kind: 'prop' });
  }
  /** true if (x,z) is on solid ground (island or pier) */
  onLand(x, z) { const b = this.bounds; if (z <= this.half + this.beachDepth - 2) return x > b.minX && x < b.maxX && z > b.minZ; return this.pier && x > this.pier.minX && x < this.pier.maxX && z < this.pier.maxZ; }

  buildRoads() {
    const geos = []; const N = this.N; const R = this.R; const yellow = new THREE.Color(0xb59a3a), white = new THREE.Color(0xb8b8b8);
    const y = 0.02;
    for (let i = 0; i <= N; i++) {
      const c = this.roadCenter(i);
      for (let j = 0; j < N; j++) {
        const a = this.blockMin(j), b = this.blockMax(j);
        for (let p = a + 1.5; p < b - 2; p += 6) {
          const g1 = coloredBox(0.25, 0.04, 3, yellow); g1.translate(c, y, p + 1.5); geos.push(g1);
          const g2 = coloredBox(3, 0.04, 0.25, yellow); g2.translate(p + 1.5, y, c); geos.push(g2);
        }
        for (const s of [-1, 1]) {
          const e1 = coloredBox(0.2, 0.04, b - a, white); e1.translate(c + s * (R / 2 - 0.4), y, (a + b) / 2); geos.push(e1);
          const e2 = coloredBox(b - a, 0.04, 0.2, white); e2.translate((a + b) / 2, y, c + s * (R / 2 - 0.4)); geos.push(e2);
        }
      }
    }
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = this.roadCenter(i), z = this.roadCenter(j);
      for (const s of [-1, 1]) for (let k = -3; k <= 3; k++) {
        const g1 = coloredBox(0.6, 0.04, 2.2, white); g1.translate(x + k * 1.7, y, z + s * (R / 2 + 1.3)); geos.push(g1);
        const g2 = coloredBox(2.2, 0.04, 0.6, white); g2.translate(x + s * (R / 2 + 1.3), y, z + k * 1.7); geos.push(g2);
      }
    }
    const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
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
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 6, 6), new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.6, metalness: 0.5 }), n);
    const armGeo = new THREE.BoxGeometry(0.16, 0.16, 1.6); armGeo.translate(0, 0, -0.8);
    const arm = new THREE.InstancedMesh(armGeo, pole.material, n);
    this.lampMaterial = new THREE.MeshStandardMaterial({ color: 0xffe6b0, emissive: 0xffc46a, emissiveIntensity: 0, roughness: 0.4 });
    const bulb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 8, 6), this.lampMaterial, n);
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler(); const v = new THREE.Vector3(); const sc = new THREE.Vector3(1, 1, 1);
    const glowPos = new Float32Array(n * 3);
    spots.forEach((s, k) => {
      m.compose(v.set(s.x, 3.15, s.z), q.identity(), sc); pole.setMatrixAt(k, m);
      q.setFromEuler(e.set(0, s.r, 0));
      m.compose(v.set(s.x, 6, s.z), q, sc); arm.setMatrixAt(k, m);
      const end = new THREE.Vector3(0, 0, -1.5).applyQuaternion(q);
      m.compose(v.set(s.x + end.x, 5.9, s.z + end.z), q, sc); bulb.setMatrixAt(k, m);
      glowPos[k * 3] = s.x + end.x; glowPos[k * 3 + 1] = 5.9; glowPos[k * 3 + 2] = s.z + end.z;
      this.colliders.insert({ minX: s.x - 0.2, maxX: s.x + 0.2, minZ: s.z - 0.2, maxZ: s.z + 0.2, height: 6, kind: 'lamp' });
    });
    pole.castShadow = true;
    this.scene.add(pole, arm, bulb);
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
    this.lampGlow = new THREE.Points(gg, new THREE.PointsMaterial({ map: GLOW_TEX, color: 0xffc46a, size: 7, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
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
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6), new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.6 }), n);
    const housing = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 1.1, 0.4), new THREE.MeshStandardMaterial({ color: 0x151515 }), n);
    this.redLights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    this.greenLights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler(); const v = new THREE.Vector3(); const sc = new THREE.Vector3(1, 1, 1);
    approaches.forEach((a, k) => {
      q.setFromEuler(e.set(0, a.heading, 0));
      m.compose(v.set(a.x, 2.1, a.z), q, sc); pole.setMatrixAt(k, m);
      m.compose(v.set(a.x, 4.4, a.z), q, sc); housing.setMatrixAt(k, m);
      const f = new THREE.Vector3(0, 0, 0.22).applyQuaternion(q);
      m.compose(v.set(a.x + f.x, 4.75, a.z + f.z), q, sc); this.redLights.setMatrixAt(k, m);
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
    const rOn = new THREE.Color(1, 0.15, 0.1), rOff = new THREE.Color(0.2, 0.03, 0.03), gOn = new THREE.Color(0.2, 1, 0.3), gOff = new THREE.Color(0.03, 0.15, 0.05);
    this.approaches.forEach((a, k) => {
      const g = this.lightGreen(a.node, a.axis, time);
      this.greenLights.setColorAt(k, g ? gOn : gOff); this.redLights.setColorAt(k, g ? rOff : rOn);
    });
    this.greenLights.instanceColor.needsUpdate = true; this.redLights.instanceColor.needsUpdate = true;
  }
}
