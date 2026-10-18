import * as THREE from 'three';

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,255,255,0.6)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); return t;
}
export const GLOW_TEX = glowTexture();

/** Pooled particle system (sparks, smoke, fire, debris, rain-free). One Points draw call. */
export class Particles {
  constructor(scene, max = 1500) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max); this.grav = new Float32Array(max); this.shrink = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3); this.colAttr = new THREE.BufferAttribute(this.col, 3); this.sizeAttr = new THREE.BufferAttribute(this.size, 1);
    g.setAttribute('position', this.posAttr); g.setAttribute('color', this.colAttr); g.setAttribute('size', this.sizeAttr);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: GLOW_TEX } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
      vertexShader: `attribute float size; varying vec3 vC; void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize = size*(300.0/-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; void main(){ vec4 t=texture2D(map,gl_PointCoord); gl_FragColor=vec4(vC*t.a, t.a); }`,
    });
    this.points = new THREE.Points(g, mat); this.points.frustumCulled = false; scene.add(this.points);
    g.setDrawRange(0, 0);
  }
  emit(x, y, z, { count = 10, color = [1, 0.6, 0.2], color2 = null, speed = 5, spread = 1, size = 1.2, life = 0.8, grav = -6, shrink = 1, up = 0 } = {}) {
    for (let k = 0; k < count; k++) {
      if (this.n >= this.max) { this._kill(Math.floor(Math.random() * this.n)); }
      const i = this.n++;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      const t = Math.random();
      const c = color2 ? [color[0] + (color2[0] - color[0]) * t, color[1] + (color2[1] - color[1]) * t, color[2] + (color2[2] - color[2]) * t] : color;
      this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
      const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * Math.PI * spread; const s = speed * (0.4 + Math.random() * 0.8);
      this.vel[i * 3] = Math.cos(a) * Math.cos(b) * s; this.vel[i * 3 + 1] = Math.sin(b) * s + up; this.vel[i * 3 + 2] = Math.sin(a) * Math.cos(b) * s;
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.8); this.size[i] = size * (0.7 + Math.random() * 0.6); this.grav[i] = grav; this.shrink[i] = shrink;
    }
  }
  _kill(i) {
    const j = --this.n; if (i === j) return;
    for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[j * 3 + k]; this.col[i * 3 + k] = this.col[j * 3 + k]; this.vel[i * 3 + k] = this.vel[j * 3 + k]; }
    this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j]; this.size[i] = this.size[j]; this.grav[i] = this.grav[j]; this.shrink[i] = this.shrink[j];
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this._kill(i); i--; continue; }
      this.vel[i * 3 + 1] += this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.05) { this.pos[i * 3 + 1] = 0.05; this.vel[i * 3 + 1] *= -0.3; this.vel[i * 3] *= 0.7; this.vel[i * 3 + 2] *= 0.7; }
      if (this.shrink[i]) { const f = this.life[i] / this.maxLife[i]; this.size[i] *= 1 - dt * (1 - f) * 2 * this.shrink[i]; }
    }
    this.posAttr.needsUpdate = true; this.colAttr.needsUpdate = true; this.sizeAttr.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.n);
  }
}

/** Short-lived line segments for bullet tracers. */
export class Tracers {
  constructor(scene, max = 64) {
    this.max = max; this.items = [];
    this.pos = new Float32Array(max * 6);
    const g = new THREE.BufferGeometry(); this.attr = new THREE.BufferAttribute(this.pos, 3); g.setAttribute('position', this.attr); g.setDrawRange(0, 0);
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.8 })); this.lines.frustumCulled = false; scene.add(this.lines);
  }
  add(a, b) { if (this.items.length >= this.max) this.items.shift(); this.items.push({ a: a.clone(), b: b.clone(), t: 0.07 }); }
  update(dt) {
    let k = 0;
    for (let i = this.items.length - 1; i >= 0; i--) { const it = this.items[i]; it.t -= dt; if (it.t <= 0) { this.items.splice(i, 1); continue; } this.pos.set([it.a.x, it.a.y, it.a.z, it.b.x, it.b.y, it.b.z], k * 6); k++; }
    this.attr.needsUpdate = true; this.lines.geometry.setDrawRange(0, k * 2);
  }
}

/** Ground decals (blood, scorch) as instanced discs. */
export class Decals {
  constructor(scene, max = 120) {
    this.max = max; this.i = 0; this.count = 0;
    const g = new THREE.CircleGeometry(0.6, 12); g.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), max);
    this.mesh.count = 0; scene.add(this.mesh); this.m = new THREE.Matrix4();
  }
  add(x, y, z, color, scale = 1) {
    const i = this.i; this.i = (this.i + 1) % this.max; this.count = Math.min(this.max, this.count + 1);
    this.m.makeRotationY(Math.random() * 6.28); this.m.scale(new THREE.Vector3(scale, 1, scale)); this.m.setPosition(x, y + 0.03, z);
    this.mesh.setMatrixAt(i, this.m); this.mesh.setColorAt(i, color); this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
  }
}

/** Rain: a Points cloud that follows the camera. */
export class Rain {
  constructor(scene, count = 1800) {
    this.count = count; this.box = 60; this.h = 40;
    this.pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { this.pos[i * 3] = (Math.random() - 0.5) * this.box; this.pos[i * 3 + 1] = Math.random() * this.h; this.pos[i * 3 + 2] = (Math.random() - 0.5) * this.box; }
    const g = new THREE.BufferGeometry(); this.attr = new THREE.BufferAttribute(this.pos, 3); g.setAttribute('position', this.attr);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xa9c4dd, size: 0.12, transparent: true, opacity: 0.55, depthWrite: false }));
    this.points.frustumCulled = false; this.points.visible = false; scene.add(this.points);
    this.intensity = 0;
  }
  update(dt, cam) {
    this.points.visible = this.intensity > 0.02;
    if (!this.points.visible) return;
    this.points.material.opacity = 0.55 * this.intensity;
    const cx = cam.x, cz = cam.z, half = this.box / 2;
    for (let i = 0; i < this.count; i++) {
      let y = this.pos[i * 3 + 1] - dt * 28;
      if (y < 0) { y += this.h; this.pos[i * 3] = cx + (Math.random() - 0.5) * this.box; this.pos[i * 3 + 2] = cz + (Math.random() - 0.5) * this.box; }
      this.pos[i * 3 + 1] = y;
      // keep inside the box around the camera (wrap)
      if (this.pos[i * 3] < cx - half) this.pos[i * 3] += this.box; else if (this.pos[i * 3] > cx + half) this.pos[i * 3] -= this.box;
      if (this.pos[i * 3 + 2] < cz - half) this.pos[i * 3 + 2] += this.box; else if (this.pos[i * 3 + 2] > cz + half) this.pos[i * 3 + 2] -= this.box;
    }
    this.attr.needsUpdate = true;
  }
}

/** Fires burning at a position for a time (used on wrecks). */
export class Fires {
  constructor(particles) { this.p = particles; this.list = []; }
  add(x, y, z, duration = 10, scale = 1) { this.list.push({ x, y, z, t: duration, scale }); }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i]; f.t -= dt; if (f.t <= 0) { this.list.splice(i, 1); continue; }
      if (Math.random() < 0.7) this.p.emit(f.x + (Math.random() - 0.5) * 1.5 * f.scale, f.y, f.z + (Math.random() - 0.5) * 2 * f.scale, { count: 2, color: [1, 0.5, 0.1], color2: [1, 0.15, 0.05], speed: 0.6, spread: 0.3, size: 2.2 * f.scale, life: 0.7, grav: 3, shrink: 1.5, up: 1.5 });
      if (Math.random() < 0.3) this.p.emit(f.x, f.y + 1, f.z, { count: 1, color: [0.12, 0.12, 0.12], speed: 0.4, spread: 0.3, size: 3.5 * f.scale, life: 2.5, grav: 1.2, shrink: 0.3, up: 1.5 });
    }
  }
}
