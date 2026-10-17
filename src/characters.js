import * as THREE from 'three';

const matCache = new Map();
export function mat(hex, extra = {}) {
  const k = hex + JSON.stringify(extra);
  let m = matCache.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.8, ...extra }); matCache.set(k, m); }
  return m;
}
const G = {
  head: new THREE.BoxGeometry(0.32, 0.34, 0.32),
  torso: new THREE.BoxGeometry(0.5, 0.62, 0.28),
  arm: (() => { const g = new THREE.BoxGeometry(0.14, 0.6, 0.14); g.translate(0, -0.3, 0); return g; })(),
  leg: (() => { const g = new THREE.BoxGeometry(0.18, 0.78, 0.18); g.translate(0, -0.39, 0); return g; })(),
  hair: new THREE.BoxGeometry(0.34, 0.1, 0.34),
};
G.head.translate(0, 0.17, 0);

export const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b3e26];
export const SHIRTS = [0xd94848, 0x3b7dd8, 0x58b368, 0xf2d35b, 0xffffff, 0x222222, 0x8e44ad, 0xe67e22, 0x1abc9c, 0x7f8c8d];
export const PANTS = [0x2c3e50, 0x34495e, 0x1f2a44, 0x5d4037, 0x222222, 0x7a8ca3];

/** Simple blocky humanoid with procedural walk animation. Faces +Z. Origin at feet. */
export class Human {
  constructor({ skin = 0xe0ac69, shirt = 0x3b7dd8, pants = 0x2c3e50, hair = 0x2b1b0e } = {}) {
    const g = new THREE.Group();
    this.group = g;
    const legY = 0.78, torsoY = legY + 0.31, headY = legY + 0.62;
    this.torso = new THREE.Mesh(G.torso, mat(shirt)); this.torso.position.y = torsoY; g.add(this.torso);
    this.head = new THREE.Mesh(G.head, mat(skin)); this.head.position.y = headY; g.add(this.head);
    const h = new THREE.Mesh(G.hair, mat(hair)); h.position.y = 0.36; this.head.add(h);
    this.armL = new THREE.Mesh(G.arm, mat(skin)); this.armL.position.set(0.32, headY - 0.02, 0); g.add(this.armL);
    this.armR = new THREE.Mesh(G.arm, mat(skin)); this.armR.position.set(-0.32, headY - 0.02, 0); g.add(this.armR);
    this.legL = new THREE.Mesh(G.leg, mat(pants)); this.legL.position.set(0.12, legY, 0); g.add(this.legL);
    this.legR = new THREE.Mesh(G.leg, mat(pants)); this.legR.position.set(-0.12, legY, 0); g.add(this.legR);
    for (const m of [this.torso, this.head, this.armL, this.armR, this.legL, this.legR]) m.castShadow = true;
    this.phase = 0;
  }
  /** speed in m/s; dt seconds */
  animate(speed, dt) {
    const moving = speed > 0.2;
    this.phase += dt * (2.2 + speed * 1.6) * (moving ? 1 : 0);
    const amp = Math.min(1, speed / 3) * 0.8;
    const s = Math.sin(this.phase);
    const target = moving ? s * amp : 0;
    this.legL.rotation.x = target; this.legR.rotation.x = -target;
    this.armL.rotation.x = -target * 0.8; this.armR.rotation.x = target * 0.8;
    this.torso.rotation.x = moving ? 0.08 * Math.min(1, speed / 6) : 0;
    this.group.position.y = this.baseY + (moving ? Math.abs(Math.cos(this.phase)) * 0.05 * amp : 0);
  }
  baseY = 0;
  setVisible(v) { this.group.visible = v; }
}
