import * as THREE from 'three';
import { CFG } from './config.js';
import { mergeGeometries, coloredBox, mulberry32, rand, pick } from './util.js';
import { SpatialHash } from './physics.js';

const TINTS = [0xc9c2b5, 0x9aa0a6, 0x7b8a99, 0xb08968, 0xd6cfc4, 0x5c6b73, 0x8c6d5a, 0xa3b1c6, 0x6f7f8c, 0xe0d8cc, 0x4f5d75, 0x3d5a80, 0x98c1d9, 0xbfa58a];

function makeWindowTexture(rng) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#8f8f8f'; g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const lit = rng() < 0.4;
    g.fillStyle = lit ? (rng() < 0.5 ? '#ffe9a8' : '#fff6d6') : (rng() < 0.5 ? '#1c2533' : '#263447');
    g.fillRect(x * 64 + 14, y * 64 + 10, 36, 44);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function makeRoadTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#2b2b30'; g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${40 + Math.random() * 30 | 0},${40 + Math.random() * 30 | 0},${45 + Math.random() * 30 | 0},0.6)`; g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class City {
  constructor(scene, seed = CFG.seed) {
    this.scene = scene;
    this.rng = mulberry32(seed);
    this.N = CFG.blocks; this.P = CFG.blockSize + CFG.roadWidth; this.R = CFG.roadWidth; this.B = CFG.blockSize;
    this.origin = -(this.N * this.P) / 2;
    this.half = (this.N * this.P) / 2 + this.R / 2; // half extent of paved area
    this.bound = this.half + 10;                    // playable bound (shore)
    this.colliders = new SpatialHash(16);
    this.blocks = [];        // [{i,j,type,minX,maxX,minZ,maxZ}]
    this.buildings = [];
    this.parkingSpots = [];  // [{x,z,heading}]
    this.lampMaterial = null;
    this.buildingMaterial = null;
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
  groundHeight(x, z) { return this.blockAt(x, z) ? 0.15 : 0; }
  nodePos(id) { const i = Math.floor(id / (this.N + 1)), j = id % (this.N + 1); return { x: this.roadCenter(i), z: this.roadCenter(j), i, j }; }
  nodeId(i, j) { return i * (this.N + 1) + j; }
  nearestNode(x, z) {
    const i = Math.round((x - this.origin) / this.P), j = Math.round((z - this.origin) / this.P);
    return this.nodeId(Math.max(0, Math.min(this.N, i)), Math.max(0, Math.min(this.N, j)));
  }
  randomSidewalkPoint(rng = this.rng) {
    const n = pick(rng, this.sidewalkNodes); return { x: n.x, z: n.z, node: n };
  }

  build() {
    this.buildGround();
    this.buildBlocks();
    this.buildRoads();
    this.buildRoadGraph();
    this.buildSidewalkGraph();
    this.buildLamps();
    this.buildTrafficLights();
  }

  buildGround() {
    const s = this.scene;
    const roadTex = makeRoadTexture(); roadTex.repeat.set(200, 200);
    const paved = new THREE.Mesh(new THREE.PlaneGeometry(this.half * 2, this.half * 2), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95 }));
    paved.rotation.x = -Math.PI / 2; paved.receiveShadow = true; s.add(paved);
    const shore = new THREE.Mesh(new THREE.PlaneGeometry(this.bound * 2 + 2, this.bound * 2 + 2), new THREE.MeshStandardMaterial({ color: 0xcfc29a, roughness: 1 }));
    shore.rotation.x = -Math.PI / 2; shore.position.y = -0.05; shore.receiveShadow = true; s.add(shore);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x1b4f72, roughness: 0.3, metalness: 0.2 }));
    water.rotation.x = -Math.PI / 2; water.position.y = -0.6; s.add(water);
    this.water = water;
  }

  buildBlocks() {
    const rng = this.rng; const N = this.N;
    const winTex = makeWindowTexture(rng);
    this.buildingMaterial = new THREE.MeshStandardMaterial({ map: winTex, vertexColors: true, emissiveMap: winTex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.7, metalness: 0.1 });
    this.roofMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    const slabMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const slabGeos = [];
    const chunkSize = 3; const chunks = new Map();
    const chunkOf = (i, j) => { const k = Math.floor(i / chunkSize) * 100 + Math.floor(j / chunkSize); let c = chunks.get(k); if (!c) { c = { sides: [], roofs: [] }; chunks.set(k, c); } return c; };
    this.treeSpots = [];
    const cx = (N - 1) / 2;
    const col = new THREE.Color();

    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const minX = this.blockMin(i), maxX = this.blockMax(i), minZ = this.blockMin(j), maxZ = this.blockMax(j);
      const dc = Math.hypot(i - cx, j - cx);
      let type = 'buildings';
      const r = rng();
      if (r < 0.11) type = 'park'; else if (r < 0.19) type = 'lot';
      if (i === Math.floor(cx) && j === Math.floor(cx)) type = 'park'; // central plaza
      const blk = { i, j, type, minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
      this.blocks.push(blk);

      // slab (sidewalk / park / lot)
      const slabColor = type === 'park' ? new THREE.Color(0x4f8a3f) : type === 'lot' ? new THREE.Color(0x3a3a40) : new THREE.Color(0x9a9a9a);
      const slab = coloredBox(this.B, 0.3, this.B, slabColor, { noBottom: true });
      slab.translate(blk.cx, 0.0, blk.cz); slabGeos.push(slab);
      if (type !== 'park') { // sidewalk ring for lots too
        // nothing extra; lot is flat
      } else {
        const ring = coloredBox(this.B, 0.3, this.B, new THREE.Color(0x9a9a9a), { noBottom: true });
        // park gets a sidewalk ring by overlaying a slightly lower grass square
        slab.translate(0, -0.02, 0); ring.translate(blk.cx, -0.01, blk.cz); slabGeos.push(ring);
        const grass = coloredBox(this.B - CFG.sidewalk * 2, 0.34, this.B - CFG.sidewalk * 2, slabColor, { noBottom: true });
        grass.translate(blk.cx, 0.0, blk.cz); slabGeos.push(grass);
      }

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
        // rows of parking spots
        const rows = 2; const perRow = 6;
        for (let rr = 0; rr < rows; rr++) for (let k = 0; k < perRow; k++) {
          if (rng() < 0.45) continue;
          const x = minX + 8 + k * 5.2, z = rr === 0 ? minZ + 10 : maxZ - 10;
          this.parkingSpots.push({ x, z, heading: rr === 0 ? Math.PI : 0 });
        }
        // small kiosk
        const kw = 6, kd = 5, kh = 3.2;
        const kx = blk.cx, kz = blk.cz;
        this.addBuilding(chunkOf(i, j), kx, kz, kw, kd, kh, new THREE.Color(0xb08968), rng);
        continue;
      }

      // buildings: subdivide into lots
      const inner = this.B - CFG.sidewalk * 2;
      const nx = pick(rng, dc < 2.2 ? [1, 1, 2] : [1, 2, 2, 3]), nz = pick(rng, dc < 2.2 ? [1, 1, 2] : [1, 2, 2, 3]);
      const lw = inner / nx, ld = inner / nz;
      for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
        if (rng() < 0.06) continue; // empty lot
        const inset = rand(rng, 0.8, 2.2);
        const w = lw - inset * 2, d = ld - inset * 2;
        const x0 = minX + CFG.sidewalk + a * lw + lw / 2, z0 = minZ + CFG.sidewalk + b * ld + ld / 2;
        let h;
        if (dc < 2.2) h = rand(rng, 24, 80); else if (dc < 4) h = rand(rng, 10, 36); else h = rand(rng, 5, 18);
        h = Math.round(h / 3.5) * 3.5;
        col.setHex(pick(rng, TINTS));
        if (h > 40 && rng() < 0.6) col.setHex(pick(rng, [0x3d5a80, 0x4f5d75, 0x98c1d9, 0x6f7f8c]));
        this.addBuilding(chunkOf(i, j), x0, z0, w, d, h, col, rng);
      }
    }
    const slabMesh = new THREE.Mesh(mergeGeometries(slabGeos), slabMat); slabMesh.receiveShadow = true; this.scene.add(slabMesh);
    for (const c of chunks.values()) {
      if (c.sides.length) { const m = new THREE.Mesh(mergeGeometries(c.sides), this.buildingMaterial); m.castShadow = true; m.receiveShadow = true; this.scene.add(m); }
      if (c.roofs.length) { const m = new THREE.Mesh(mergeGeometries(c.roofs), this.roofMaterial); m.castShadow = true; m.receiveShadow = true; this.scene.add(m); }
    }
    this.buildTrees();
  }

  addBuilding(chunk, x, z, w, d, h, color, rng) {
    const sides = coloredBox(w, h, d, color, { noTop: true, noBottom: true, uvScale: 7 });
    sides.translate(x, h / 2, z); chunk.sides.push(sides);
    const roofCol = color.clone().multiplyScalar(0.55);
    const roof = coloredBox(w, 0.4, d, roofCol, { noBottom: true }); roof.translate(x, h, z); chunk.roofs.push(roof);
    if (rng() < 0.55) { // rooftop box
      const bw = w * rand(rng, 0.2, 0.45), bd = d * rand(rng, 0.2, 0.45), bh = rand(rng, 1.2, 3);
      const b = coloredBox(bw, bh, bd, roofCol, { noBottom: true }); b.translate(x + rand(rng, -w / 4, w / 4), h + bh / 2, z + rand(rng, -d / 4, d / 4)); chunk.roofs.push(b);
    }
    if (h > 30 && rng() < 0.4) { const a = coloredBox(0.3, 6, 0.3, new THREE.Color(0x333333)); a.translate(x, h + 3, z); chunk.roofs.push(a); }
    const box = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, height: h, kind: 'building' };
    this.colliders.insert(box); this.buildings.push(box);
  }

  buildTrees() {
    const n = this.treeSpots.length; if (!n) return;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 1 }), n);
    const leaf = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.6, 1), new THREE.MeshStandardMaterial({ color: 0x2f7a2f, roughness: 0.9, flatShading: true }), n);
    const m = new THREE.Matrix4(); const c = new THREE.Color();
    this.treeSpots.forEach((t, k) => {
      m.makeScale(t.s, t.s, t.s); m.setPosition(t.x, 1.1 * t.s + 0.15, t.z); trunk.setMatrixAt(k, m);
      m.makeScale(t.s, t.s * 1.1, t.s); m.setPosition(t.x, 3.2 * t.s + 0.15, t.z); leaf.setMatrixAt(k, m);
      leaf.setColorAt(k, c.setHSL(0.28 + this.rng() * 0.08, 0.55, 0.3 + this.rng() * 0.12));
    });
    trunk.castShadow = leaf.castShadow = true; leaf.receiveShadow = true;
    this.scene.add(trunk, leaf);
  }

  buildRoads() {
    const geos = []; const N = this.N; const R = this.R; const yellow = new THREE.Color(0xd8b84a), white = new THREE.Color(0xdddddd);
    const y = 0.02;
    for (let i = 0; i <= N; i++) {
      const c = this.roadCenter(i);
      for (let j = 0; j < N; j++) {
        const a = this.blockMin(j), b = this.blockMax(j);
        // dashed center line along both axes
        for (let p = a + 1.5; p < b - 2; p += 6) {
          const g1 = coloredBox(0.25, 0.04, 3, yellow); g1.translate(c, y, p + 1.5); geos.push(g1);
          const g2 = coloredBox(3, 0.04, 0.25, yellow); g2.translate(p + 1.5, y, c); geos.push(g2);
        }
        // edge lines
        for (const s of [-1, 1]) {
          const e1 = coloredBox(0.2, 0.04, b - a, white); e1.translate(c + s * (R / 2 - 0.4), y, (a + b) / 2); geos.push(e1);
          const e2 = coloredBox(b - a, 0.04, 0.2, white); e2.translate((a + b) / 2, y, c + s * (R / 2 - 0.4)); geos.push(e2);
        }
      }
    }
    // crosswalks at each intersection
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = this.roadCenter(i), z = this.roadCenter(j);
      for (const s of [-1, 1]) {
        for (let k = -3; k <= 3; k++) {
          const g1 = coloredBox(0.6, 0.04, 2.2, white); g1.translate(x + k * 1.7, y, z + s * (R / 2 + 1.3)); geos.push(g1);
          const g2 = coloredBox(2.2, 0.04, 0.6, white); g2.translate(x + s * (R / 2 + 1.3), y, z + k * 1.7); geos.push(g2);
        }
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
  /** Traffic light: returns true if green for travel along axis ('x' or 'z') at node */
  lightGreen(node, axis, time) {
    const cycle = 14; const off = ((node.i + node.j) % 2) * (cycle / 2);
    const t = (time + off) % cycle;
    const zGreen = t < cycle / 2 - 1.5;
    const xGreen = t >= cycle / 2 && t < cycle - 1.5;
    return axis === 'z' ? zGreen : xGreen;
  }
  /** BFS shortest path between node ids. */
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
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 6, 6), new THREE.MeshStandardMaterial({ color: 0x444a52, roughness: 0.6, metalness: 0.5 }), n);
    const armGeo = new THREE.BoxGeometry(0.16, 0.16, 1.6); armGeo.translate(0, 0, -0.8);
    const arm = new THREE.InstancedMesh(armGeo, pole.material, n);
    this.lampMaterial = new THREE.MeshStandardMaterial({ color: 0xffe6b0, emissive: 0xffd27a, emissiveIntensity: 0, roughness: 0.4 });
    const bulb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 8, 6), this.lampMaterial, n);
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler(); const v = new THREE.Vector3(); const sc = new THREE.Vector3(1, 1, 1);
    spots.forEach((s, k) => {
      const ang = s.r; // arm points toward the road (outward from block)
      const ox = -Math.sin(ang) * 0, oz = 0;
      m.compose(v.set(s.x, 3.15, s.z), q.identity(), sc); pole.setMatrixAt(k, m);
      q.setFromEuler(e.set(0, ang, 0));
      m.compose(v.set(s.x, 6, s.z), q, sc); arm.setMatrixAt(k, m);
      // bulb at arm end: arm local -Z rotated by ang -> world (-sin(ang)*-1.. ) compute via quaternion
      const end = new THREE.Vector3(0, 0, -1.5).applyQuaternion(q);
      m.compose(v.set(s.x + end.x, 5.9, s.z + end.z), q, sc); bulb.setMatrixAt(k, m);
      this.colliders.insert({ minX: s.x - 0.2, maxX: s.x + 0.2, minZ: s.z - 0.2, maxZ: s.z + 0.2, height: 6, kind: 'lamp' });
      void ox; void oz;
    });
    pole.castShadow = true;
    this.scene.add(pole, arm, bulb);
  }

  buildTrafficLights() {
    const N = this.N; const R = this.R; const approaches = [];
    for (const n of this.nodes) {
      // four approaches: travel dir d; light stands on the far-right corner, facing back.
      for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rx = -d[1], rz = d[0]; // right = (-dz, dx)
        const x = n.x + d[0] * (R / 2 + 0.9) + rx * (R / 2 + 0.9), z = n.z + d[1] * (R / 2 + 0.9) + rz * (R / 2 + 0.9);
        approaches.push({ node: n, axis: d[0] !== 0 ? 'x' : 'z', x, z, heading: Math.atan2(-d[0], -d[1]) });
      }
    }
    const n = approaches.length; this.approaches = approaches;
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6), new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.6 }), n);
    const housing = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 1.1, 0.4), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }), n);
    const redMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const greenMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.redLights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 8, 6), redMat, n);
    this.greenLights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 8, 6), greenMat, n);
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
