import * as THREE from 'three';

const matCache = new Map();
export function mat(hex, extra = {}) {
  const k = hex + JSON.stringify(extra);
  let m = matCache.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, ...extra }); matCache.set(k, m); }
  return m;
}
const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 10);
const G = {
  torso: (() => { const g = cap(0.2, 0.34); g.scale(1.3, 1, 0.72); g.translate(0, 0.32, 0); return g; })(),
  hipsG: (() => { const g = cap(0.16, 0.1); g.scale(1.3, 1, 0.8); g.translate(0, 0.02, 0); return g; })(),
  neck: new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8),
  head: (() => { const g = new THREE.SphereGeometry(0.145, 14, 12); g.scale(0.95, 1.1, 0.95); return g; })(),
  hair: new THREE.SphereGeometry(0.152, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
  shoulder: new THREE.SphereGeometry(0.085, 10, 8),
  upperArm: (() => { const g = cap(0.062, 0.24); g.translate(0, -0.16, 0); return g; })(),
  forearm: (() => { const g = cap(0.055, 0.22); g.translate(0, -0.15, 0); return g; })(),
  hand: new THREE.SphereGeometry(0.06, 8, 6),
  thigh: (() => { const g = cap(0.085, 0.3); g.translate(0, -0.2, 0); return g; })(),
  shin: (() => { const g = cap(0.07, 0.3); g.translate(0, -0.2, 0); return g; })(),
  foot: (() => { const g = new THREE.BoxGeometry(0.13, 0.08, 0.27); g.translate(0, -0.41, 0.06); return g; })(),
  cap: (() => { const g = new THREE.SphereGeometry(0.158, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5); g.translate(0, 0.02, 0); return g; })(),
  visor: (() => { const g = new THREE.BoxGeometry(0.22, 0.03, 0.14); g.translate(0, 0.02, 0.16); return g; })(),
};
G.neck.translate(0, 0.62, 0);
G.head.translate(0, 0.82, 0);
G.hair.translate(0, 0.84, -0.01);

export const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b3e26, 0xd9a27a];
export const SHIRTS = [0xb33a3a, 0x2d5fa8, 0x3f8a4f, 0xd9b84a, 0xe8e8e8, 0x202428, 0x6a3f8a, 0xcf6b2d, 0x2a8a80, 0x6c7580, 0x8a2a4a, 0x3a3a52];
export const PANTS = [0x2c3e50, 0x2f3a4a, 0x1f2a44, 0x4a3b30, 0x1e1e22, 0x5a6a80, 0x3b3b3b];
const HAIR = [0x1a1a1a, 0x3b2a1a, 0x7a5230, 0xd9c27a, 0x555555, 0x8a3a1a, 0x2a1f1a];

/** Smooth-shaded humanoid with jointed limbs and procedural animation. Faces +Z. Origin at the feet. */
export class Human {
  constructor({ skin = 0xe0ac69, shirt = 0x3b7dd8, pants = 0x2c3e50, hair = 0x2b1b0e, cop = false, rng = Math.random } = {}) {
    const g = new THREE.Group(); this.group = g;
    const legLen = 0.86; this.legLen = legLen;
    const skinM = mat(skin), shirtM = mat(shirt, { roughness: 0.9 }), pantsM = mat(pants, { roughness: 0.95 }), shoeM = mat(0x1b1b1b);
    this.hips = new THREE.Group(); this.hips.position.y = legLen; g.add(this.hips);
    this.torso = new THREE.Mesh(G.torso, shirtM); this.hips.add(this.torso);
    const hipsMesh = new THREE.Mesh(G.hipsG, pantsM); this.hips.add(hipsMesh);
    const neck = new THREE.Mesh(G.neck, skinM); this.hips.add(neck);
    this.headPivot = new THREE.Group(); this.headPivot.position.y = 0; this.hips.add(this.headPivot);
    this.head = new THREE.Mesh(G.head, skinM); this.headPivot.add(this.head);
    if (cop) { const c = new THREE.Mesh(G.cap, mat(0x1f3a93)); c.position.y = 0.86; this.headPivot.add(c); const v = new THREE.Mesh(G.visor, mat(0x111111)); v.position.y = 0.86; this.headPivot.add(v); }
    else if (rng() < 0.85) { const h = new THREE.Mesh(G.hair, mat(hair)); this.headPivot.add(h); }
    this.armL = this.makeArm(0.3, skinM, shirtM); this.armR = this.makeArm(-0.3, skinM, shirtM);
    this.legL = this.makeLeg(0.11, pantsM, shoeM); this.legR = this.makeLeg(-0.11, pantsM, shoeM);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.phase = 0; this.baseY = 0; this.pose = null; this.breath = rng() * 6;
  }
  makeArm(x, skinM, shirtM) {
    const sh = new THREE.Group(); sh.position.set(x, 0.56, 0); this.hips.add(sh);
    sh.add(new THREE.Mesh(G.shoulder, shirtM));
    sh.add(new THREE.Mesh(G.upperArm, shirtM));
    const el = new THREE.Group(); el.position.y = -0.3; sh.add(el); sh.elbow = el;
    el.add(new THREE.Mesh(G.forearm, skinM)); const hand = new THREE.Mesh(G.hand, skinM); hand.position.y = -0.3; el.add(hand); sh.hand = hand;
    return sh;
  }
  makeLeg(x, pantsM, shoeM) {
    const hip = new THREE.Group(); hip.position.set(x, 0, 0); this.hips.add(hip);
    hip.add(new THREE.Mesh(G.thigh, pantsM));
    const knee = new THREE.Group(); knee.position.y = -0.4; hip.add(knee); hip.knee = knee;
    knee.add(new THREE.Mesh(G.shin, pantsM)); knee.add(new THREE.Mesh(G.foot, shoeM));
    return hip;
  }
  /** speed in m/s */
  animate(speed, dt, { aiming = false } = {}) {
    const moving = speed > 0.25; const run = speed > 5;
    this.breath += dt;
    this.phase += dt * (moving ? 3.2 + speed * 1.5 : 0);
    const amp = moving ? Math.min(1, speed / 2.8) * (run ? 1.0 : 0.62) : 0;
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const L = this.legL, R = this.legR, AL = this.armL, AR = this.armR;
    // legs: thigh swings, knee bends on the swing-through
    L.rotation.x = -s * amp; L.knee.rotation.x = Math.max(0, c) * amp * 1.3;
    R.rotation.x = s * amp; R.knee.rotation.x = Math.max(0, -c) * amp * 1.3;
    if (this.pose === 'ride') { L.rotation.x = R.rotation.x = -1.25; L.knee.rotation.x = R.knee.rotation.x = 1.5; AL.rotation.x = AR.rotation.x = -0.95; AL.elbow.rotation.x = AR.elbow.rotation.x = -0.3; AL.rotation.z = -0.25; AR.rotation.z = 0.25; this.hips.rotation.x = 0.2; this.group.position.y = this.baseY; return; }
    // arms
    const swing = amp * (run ? 1.1 : 0.7);
    AL.rotation.x = s * swing; AL.elbow.rotation.x = -(0.25 + Math.max(0, -s) * 0.6 * amp + (run ? 0.6 : 0));
    AR.rotation.x = -s * swing; AR.elbow.rotation.x = -(0.25 + Math.max(0, s) * 0.6 * amp + (run ? 0.6 : 0));
    AL.rotation.z = -0.08; AR.rotation.z = 0.08;
    if (aiming) { AR.rotation.x = -Math.PI / 2 + this.aimPitch; AR.rotation.z = 0; AR.elbow.rotation.x = 0; AL.rotation.x = -1.25 + this.aimPitch; AL.rotation.z = 0.5; AL.elbow.rotation.x = -1.0; }
    this.hips.rotation.x = moving ? (run ? -0.18 : -0.05) : 0;
    this.torso.scale.y = 1 + Math.sin(this.breath * 2.2) * 0.012;
    this.group.position.y = this.baseY + (moving ? Math.abs(c) * 0.04 * amp : 0);
    // head bob follows a little
    this.headPivot.rotation.x = moving ? -this.hips.rotation.x * 0.6 : Math.sin(this.breath * 0.7) * 0.04;
  }
  aimPitch = 0;
  setVisible(v) { this.group.visible = v; }
  resetPose() { this.pose = null; for (const a of [this.armL, this.armR]) { a.rotation.set(0, 0, 0); a.elbow.rotation.set(0, 0, 0); } for (const l of [this.legL, this.legR]) { l.rotation.set(0, 0, 0); l.knee.rotation.set(0, 0, 0); } this.hips.rotation.set(0, 0, 0); }
}
export { HAIR };
