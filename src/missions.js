import * as THREE from 'three';
import { CFG } from './config.js';
import { mulberry32, pick, rand } from './util.js';

function labelSprite(text, color = '#ffffff') {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
  g.strokeStyle = color; g.lineWidth = 8; g.stroke();
  g.fillStyle = color; g.font = 'bold 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false })); s.scale.set(3, 3, 1); return s;
}
const markerGeo = new THREE.CylinderGeometry(2, 2, 1.2, 24, 1, true);
const beamGeo = new THREE.CylinderGeometry(1.2, 2.0, 60, 16, 1, true);

const SHOP = [
  { w: 'pistol', ammo: 34, cost: 150, name: 'Pistol + 34 rounds' },
  { w: 'smg', ammo: 60, cost: 400, name: 'SMG + 60 rounds' },
  { w: 'shotgun', ammo: 16, cost: 350, name: 'Shotgun + 16 shells' },
];

export class Missions {
  constructor(game) {
    this.game = game; this.rng = mulberry32(CFG.seed + 31);
    this.markers = []; this.pickups = []; this.packages = []; this.active = null; this.cooldown = 0;
    this.completed = 0; this.bestRace = null; this.shopIndex = 0; this.inMarker = null;
    this.targetMesh = this.makeTarget(); this.targetMesh.visible = false; game.scene.add(this.targetMesh);
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 8), new THREE.MeshBasicMaterial({ color: 0xffcc33 })); this.arrow.rotation.x = Math.PI / 2; this.arrowPivot = new THREE.Group(); this.arrowPivot.add(this.arrow); this.arrowPivot.visible = false; game.scene.add(this.arrowPivot);
    this.setup();
  }
  makeTarget() {
    const g = new THREE.Group();
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffcc33, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })); beam.position.y = 30; g.add(beam);
    const ring = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: 0xffcc33, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })); ring.position.y = 0.6; g.add(ring);
    return g;
  }
  addMarker(kind, x, z, color, letter, label) {
    const m = { kind, x, z, color, label, mesh: new THREE.Group() };
    const ring = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })); ring.position.y = 0.6; m.mesh.add(ring);
    const s = labelSprite(letter, '#' + new THREE.Color(color).getHexString()); s.position.y = 4; m.mesh.add(s);
    m.mesh.position.set(x, this.game.city.groundHeight(x, z), z); this.game.scene.add(m.mesh); this.markers.push(m); return m;
  }
  setup() {
    const city = this.game.city, rng = this.rng;
    const corner = (i, j, c) => city.sidewalkNodes[((i * city.N) + j) * 4 + c];
    const N = city.N, mid = Math.floor(N / 2);
    const nearRoad = (n, side) => ({ x: n.x, z: n.z }); // sidewalk corner nodes already sit by the road
    const H = corner(mid - 3, mid - 2, 1); this.hospital = nearRoad(H); this.addMarker('hospital', H.x, H.z, 0xff5a5a, 'H', 'Hospital');
    const P = corner(mid + 3, mid + 2, 3); this.station = nearRoad(P); this.addMarker('station', P.x, P.z, 0x4aa3ff, 'P', 'Police station');
    const S = corner(mid + 2, mid - 3, 0); this.addMarker('spray', S.x, S.z, 0xc06cff, 'S', 'Pay n Spray');
    const A = corner(mid - 1, mid + 3, 2); this.addMarker('gunshop', A.x, A.z, 0xffa33c, 'A', 'Ammu-Mart');
    const C = corner(mid, mid - 1, 0); this.addMarker('courier', C.x, C.z, 0x7CFC9A, 'C', 'Courier job');
    const T = corner(mid - 2, mid + 1, 1); this.addMarker('taxi', T.x, T.z, 0xffe14a, 'T', 'Taxi job');
    const R = corner(mid + 3, mid - 1, 2); this.addMarker('race', R.x, R.z, 0xff8c3c, 'R', 'Street race');
    const K = corner(mid - 4, mid + 3, 0); this.addMarker('hitman', K.x, K.z, 0xff3c5c, 'X', 'Contract');
    // hidden packages
    for (let i = 0; i < 20; i++) {
      let n; do { n = pick(rng, city.sidewalkNodes); } while (n.block.type !== 'park' && rng() < 0.6);
      const x = n.x + rand(rng, -1, 1), z = n.z + rand(rng, -1, 1);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), new THREE.MeshStandardMaterial({ color: 0x3ec1ff, emissive: 0x1a7acc, emissiveIntensity: 0.8 }));
      mesh.position.set(x, city.groundHeight(x, z) + 0.6, z); this.game.scene.add(mesh);
      this.packages.push({ id: i, x, z, mesh, collected: false });
    }
    // pickups: weapons, health, cash
    const addPickup = (kind, data, color) => { const n = pick(rng, city.sidewalkNodes); const x = n.x + rand(rng, -0.8, 0.8), z = n.z + rand(rng, -0.8, 0.8); const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 })); mesh.position.set(x, city.groundHeight(x, z) + 0.8, z); this.game.scene.add(mesh); this.pickups.push({ kind, data, x, z, mesh, t: 0 }); };
    for (let i = 0; i < 4; i++) addPickup('weapon', { w: 'pistol', ammo: 24 }, 0xffffff);
    for (let i = 0; i < 2; i++) addPickup('weapon', { w: 'smg', ammo: 40 }, 0xffb0ff);
    for (let i = 0; i < 2; i++) addPickup('weapon', { w: 'shotgun', ammo: 10 }, 0xffd0a0);
    for (let i = 0; i < 8; i++) addPickup('health', { hp: 50 }, 0xff4444);
    for (let i = 0; i < 12; i++) addPickup('cash', { amount: 50 + Math.floor(rng() * 4) * 50 }, 0x7CFC9A);
    // starter pistol next to spawn
    const sp = this.game.spawnPoint; const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6 })); mesh.position.set(sp.x + 4, 0.95, sp.z + 3); this.game.scene.add(mesh); this.pickups.push({ kind: 'weapon', data: { w: 'pistol', ammo: 30 }, x: sp.x + 4, z: sp.z + 3, mesh, t: 0 });
  }
  saveState() { return { packages: this.packages.filter((p) => p.collected).map((p) => p.id), completed: this.completed, bestRace: this.bestRace }; }
  loadState(s) { if (!s) return; for (const id of s.packages || []) { const p = this.packages[id]; if (p) { p.collected = true; p.mesh.visible = false; } } this.completed = s.completed || 0; this.bestRace = s.bestRace || null; }

  randomFarPoint(minD = 150, maxD = 420) {
    const g = this.game; for (let i = 0; i < 40; i++) { const n = pick(Math.random, g.city.sidewalkNodes); const d = Math.hypot(n.x - g.player.x, n.z - g.player.z); if (d > minD && d < maxD) return { x: n.x, z: n.z }; }
    const n = pick(Math.random, g.city.sidewalkNodes); return { x: n.x, z: n.z };
  }
  start(kind) {
    const g = this.game, p = g.player; const inCar = p.state === 'car';
    if (kind === 'courier') {
      const t = this.randomFarPoint(); const d = Math.hypot(t.x - p.x, t.z - p.z);
      this.active = { kind, objective: 'Deliver the package to the marker', target: t, timeLeft: 20 + d / 9, reward: 150 + Math.round(d / 2) };
      g.hud.toast('Courier: package picked up. Go!', 3);
    } else if (kind === 'taxi') {
      if (!inCar) { g.hud.toast('You need a car for taxi jobs.', 2.5); this.cooldown = 2; return; }
      const t = this.randomFarPoint(80, 250);
      const ped = g.peds.spawnAt(t.x, t.z, {}); ped.state = 'walk'; ped.idleT = 9999; ped.isFare = true;
      this.active = { kind, objective: 'Pick up the passenger', target: t, timeLeft: 35 + Math.hypot(t.x - p.x, t.z - p.z) / 10, ped, stage: 0, reward: 250 };
    } else if (kind === 'race') {
      if (!inCar) { g.hud.toast('Get a car to race.', 2.5); this.cooldown = 2; return; }
      const city = g.city; let node = city.nearestNode(p.x, p.z); const cps = []; let prev = -1; let total = 0;
      for (let i = 0; i < 7; i++) { const cands = city.nodes[node].adj.filter((id) => id !== prev); let next = pick(Math.random, cands); if (i > 0 && Math.random() < 0.5) { const straight = cands.find((id) => { const a = city.nodes[prev], b = city.nodes[node], c = city.nodes[id]; return Math.sign(c.x - b.x) === Math.sign(b.x - a.x) && Math.sign(c.z - b.z) === Math.sign(b.z - a.z); }); if (straight !== undefined) next = straight; } prev = node; node = next; const n = city.nodes[node]; cps.push({ x: n.x, z: n.z }); total += city.P; }
      this.active = { kind, objective: 'Checkpoint 1 / 7', cps, idx: 0, target: cps[0], timeLeft: total / 11 + 8, par: total / 14, elapsed: 0, reward: 500 };
      g.hud.toast('Race! Hit all checkpoints before time runs out.', 3);
    } else if (kind === 'hitman') {
      const t = this.randomFarPoint(120, 350); const ped = g.peds.spawnAt(t.x, t.z, {}); ped.isTarget = true; ped.speed = 1.4;
      ped.human.torso.material = ped.human.torso.material.clone(); ped.human.torso.material.color.setHex(0x111111);
      this.active = { kind, objective: 'Eliminate the target (marked)', target: ped.pos, ped, timeLeft: 150, reward: 600 };
      g.hud.toast('Contract: the target wears black. Make it quick.', 3.5);
    }
    if (this.active) { this.targetMesh.visible = true; this.arrowPivot.visible = true; }
  }
  complete(bonusText) {
    const m = this.active; if (!m) return; const g = this.game;
    g.addMoney(m.reward); this.completed++; g.hud.big('MISSION PASSED', 3); g.hud.toast(`+$${m.reward} ${bonusText || ''}`, 4); g.audio.pickup();
    this.end();
  }
  fail(reason) { const m = this.active; if (!m) return; this.game.hud.big('MISSION FAILED', 3); this.game.hud.toast(reason, 3); this.game.audio.fail(); this.end(); }
  end() { const m = this.active; if (m?.ped) { if (m.kind === 'taxi') { m.ped.idleT = 0; m.ped.isFare = false; m.ped.mesh.visible = true; } } this.active = null; this.targetMesh.visible = false; this.arrowPivot.visible = false; this.cooldown = 3; this.game.save(); }

  update(dt) {
    const g = this.game, p = g.player; const px = p.x, pz = p.z; const t = g.time;
    this.cooldown = Math.max(0, this.cooldown - dt);
    // marker bobbing
    for (const mk of this.markers) { mk.mesh.children[0].rotation.y += dt * 0.6; }
    for (const pk of this.packages) { if (!pk.collected) { pk.mesh.rotation.y += dt; pk.mesh.position.y = g.city.groundHeight(pk.x, pk.z) + 0.6 + Math.sin(t * 2 + pk.id) * 0.1; if ((pk.x - px) ** 2 + (pk.z - pz) ** 2 < 2.2) { pk.collected = true; pk.mesh.visible = false; g.addMoney(100); g.audio.pickup(); const n = this.packages.filter((q) => q.collected).length; g.hud.toast(`Hidden package ${n} / ${this.packages.length}  +$100`, 3); if (n === this.packages.length) { g.addMoney(5000); g.hud.big('ALL PACKAGES', 3); } g.save(); } } }
    for (const pk of this.pickups) {
      if (pk.t > 0) { pk.t -= dt; if (pk.t <= 0) pk.mesh.visible = true; continue; }
      pk.mesh.rotation.y += dt * 1.5;
      if ((pk.x - px) ** 2 + (pk.z - pz) ** 2 < 2.0 && p.state !== 'dead') {
        if (pk.kind === 'weapon') { g.weapons.give(pk.data.w, pk.data.ammo); g.hud.toast(`Picked up ${pk.data.w.toUpperCase()}`, 2); }
        else if (pk.kind === 'health') { if (p.health >= 100) continue; p.health = Math.min(100, p.health + pk.data.hp); g.hud.toast('Health +50', 1.5); }
        else if (pk.kind === 'cash') { g.addMoney(pk.data.amount); g.hud.toast(`+$${pk.data.amount}`, 1.5); }
        pk.mesh.visible = false; pk.t = 120; g.audio.pickup();
      }
    }
    // markers interaction
    this.inMarker = null;
    for (const mk of this.markers) { if ((mk.x - px) ** 2 + (mk.z - pz) ** 2 < 2.3 * 2.3) { this.inMarker = mk; break; } }
    if (this.inMarker && !this.active && this.cooldown <= 0 && p.state !== 'dead') this.handleMarker(this.inMarker);
    // active mission
    const m = this.active;
    if (!m) return;
    if (m.timeLeft != null) { m.timeLeft -= dt; if (m.timeLeft <= 0) { this.fail('Out of time'); return; } }
    const tgt = m.target; const d = Math.hypot(tgt.x - px, tgt.z - pz);
    this.targetMesh.position.set(tgt.x, g.city.groundHeight(tgt.x, tgt.z), tgt.z); this.targetMesh.children[1].rotation.y += dt * 2;
    this.arrowPivot.position.set(px, p.worldPos.y + 2.6, pz); this.arrowPivot.rotation.y = Math.atan2(tgt.x - px, tgt.z - pz); this.arrow.position.y = Math.sin(t * 4) * 0.1;
    if (m.kind === 'courier') { if (d < 2.5 && p.state === 'foot') this.complete(`(${Math.ceil(m.timeLeft)}s to spare)`); }
    else if (m.kind === 'taxi') {
      if (m.stage === 0) { if (d < 6 && p.state === 'car' && p.vehicle.speed < 1.5) { m.stage = 1; m.ped.mesh.visible = false; m.ped.pos.set(9999, 0, 9999); const dest = this.randomFarPoint(120, 320); m.target = dest; m.objective = 'Drop the passenger at the marker'; m.timeLeft = 25 + Math.hypot(dest.x - px, dest.z - pz) / 9; g.hud.toast('Passenger aboard. Drive!', 2); } }
      else if (d < 6 && p.state === 'car' && p.vehicle.speed < 1.5) { m.ped.pos.set(px + 2, 0, pz + 2); m.ped.mesh.visible = true; this.complete(`tip $${Math.ceil(m.timeLeft) * 2}`); g.addMoney(Math.ceil(m.timeLeft) * 2); }
      if (p.state !== 'car' && m.stage === 1) { m.leftT = (m.leftT || 0) + dt; if (m.leftT > 8) this.fail('You abandoned the passenger'); } else m.leftT = 0;
    } else if (m.kind === 'race') {
      m.elapsed += dt;
      if (d < 7 && p.state === 'car') { m.idx++; g.audio.pickup(); if (m.idx >= m.cps.length) { const bonus = Math.max(0, Math.round((m.par - m.elapsed) * 15)); m.reward += bonus; if (!this.bestRace || m.elapsed < this.bestRace) this.bestRace = m.elapsed; this.complete(`time ${m.elapsed.toFixed(1)}s`); } else { m.target = m.cps[m.idx]; m.objective = `Checkpoint ${m.idx + 1} / ${m.cps.length}`; m.timeLeft += 4; } }
    } else if (m.kind === 'hitman') {
      if (!m.ped.alive) this.complete('target eliminated');
      else if (d < 25 && m.ped.state === 'walk') m.ped.flee(px, pz, 8);
    }
  }
  handleMarker(mk) {
    const g = this.game, p = g.player, inp = g.input; const pressed = inp.pressed('interact');
    const key = g.settings.touch ? 'ENTER' : 'E';
    if (mk.kind === 'hospital') { g.hud.prompt(`Hospital — press ${key} to heal ($50)`); if (pressed) { if (p.health >= 100) g.hud.toast('You are at full health.', 1.5); else if (p.money >= 50) { g.addMoney(-50); p.health = 100; g.hud.toast('Patched up.', 1.5); g.audio.pickup(); } else g.hud.toast('Not enough cash.', 1.5); this.cooldown = 0.5; } }
    else if (mk.kind === 'station') { g.hud.prompt('Police station. Nothing to see here.'); }
    else if (mk.kind === 'spray') { if (p.state !== 'car') g.hud.prompt('Pay n Spray — drive a car in to lose the cops ($100)'); else if (p.wanted === 0) g.hud.prompt('Pay n Spray — you are clean.'); else if (p.money >= 100) { g.addMoney(-100); p.wanted = 0; g.police?.clear(); g.hud.toast('Resprayed. The cops lost you.', 2.5); g.audio.pickup(); this.cooldown = 3; } else g.hud.prompt('Pay n Spray — need $100'); }
    else if (mk.kind === 'gunshop') {
      if (inp.pressed('weaponNext') || inp.pressed('weaponPrev')) this.shopIndex = (this.shopIndex + 1) % SHOP.length;
      const item = SHOP[this.shopIndex];
      g.hud.prompt(`Ammu-Mart — ${key}: buy ${item.name} ($${item.cost})  |  Q/WPN: next item`);
      if (pressed) { if (p.money >= item.cost) { g.addMoney(-item.cost); g.weapons.give(item.w, item.ammo); g.hud.toast(`Bought ${item.name}`, 2); g.audio.cash(); } else g.hud.toast('Not enough cash.', 1.5); this.cooldown = 0.4; }
    }
    else { g.hud.prompt(`${mk.label} — press ${key} to start`); if (pressed) this.start(mk.kind); }
  }
}
