import * as THREE from 'three';
import { CFG } from './config.js';
import { lerp, clamp } from './util.js';

export class DayNight {
  constructor(scene, city, { shadows = true } = {}) {
    this.scene = scene; this.city = city; this.time = 17.2; // start late afternoon
    this.sun = new THREE.DirectionalLight(0xffffff, 2.0);
    this.sun.castShadow = shadows;
    const sc = this.sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 400;
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -0.0008; this.sun.shadow.normalBias = 0.05;
    this.sunTarget = new THREE.Object3D(); scene.add(this.sunTarget); this.sun.target = this.sunTarget;
    scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0x9fb3c8, 0x3a3630, 0.8); scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.12); scene.add(this.ambient);
    scene.fog = new THREE.Fog(0x7a8794, 90, 520);
    scene.background = new THREE.Color(0x6f8699);
    this.cDay = new THREE.Color(0x6f8699); this.cDusk = new THREE.Color(0xb0623a); this.cNight = new THREE.Color(0x05070e);
    this.fogDay = new THREE.Color(0x7f8d9a); this.fogNight = new THREE.Color(0x070a12); this.fogDusk = new THREE.Color(0x9a5e42);
    this.col = new THREE.Color(); this.night = 0;
    // weather: 0 clear → 1 pouring
    this.rain = 0; this.rainTarget = 0; this.weatherT = 60;
  }
  get isNight() { return this.night > 0.5; }
  update(dt, focus, rainFx) {
    this.time = (this.time + dt * (24 / CFG.dayLengthSec)) % 24;
    this.weatherT -= dt;
    if (this.weatherT <= 0) { this.weatherT = 90 + Math.random() * 150; this.rainTarget = Math.random() < 0.4 ? 0.5 + Math.random() * 0.5 : 0; }
    this.rain = lerp(this.rain, this.rainTarget, 1 - Math.exp(-dt * 0.15));
    const a = ((this.time - 6) / 12) * Math.PI;
    const el = Math.sin(a);
    const sx = Math.cos(a) * 200, sy = el * 200, sz = 80;
    this.sun.position.set(focus.x + sx, Math.max(sy, -30), focus.z + sz);
    this.sunTarget.position.set(focus.x, 0, focus.z);
    const day = clamp(el * 2.5, 0, 1);
    const dusk = clamp(1 - Math.abs(el) * 4, 0, 1) * (el > -0.15 ? 1 : 0);
    const overcast = this.rain;
    this.sun.intensity = 2.2 * day * (1 - overcast * 0.8);
    this.sun.color.setRGB(1, lerp(0.55, 0.95, day), lerp(0.3, 0.85, day));
    this.hemi.intensity = lerp(0.32, 1.0, day) * (1 - overcast * 0.3);
    this.ambient.intensity = lerp(0.18, 0.16, day);
    const bg = this.col.copy(this.cNight).lerp(this.cDay, day).lerp(this.cDusk, dusk * 0.6 * (1 - overcast));
    bg.multiplyScalar(1 - overcast * 0.35);
    this.scene.background.copy(bg);
    this.scene.fog.color.copy(this.fogNight).lerp(this.fogDay, day).lerp(this.fogDusk, dusk * 0.5 * (1 - overcast)).multiplyScalar(1 - overcast * 0.3);
    this.scene.fog.near = lerp(90, 30, overcast); this.scene.fog.far = lerp(520, 220, overcast);
    const night = 1 - day; this.night = night;
    this.city.buildingMaterial.emissiveIntensity = night * 0.9;
    if (this.city.lampMaterial) this.city.lampMaterial.emissiveIntensity = night * 2.5;
    if (this.city.lampGlow) this.city.lampGlow.material.opacity = night * 0.55;
    if (this.city.roadMaterial) { this.city.roadMaterial.roughness = lerp(0.9, 0.35, overcast); this.city.roadMaterial.metalness = lerp(0.05, 0.4, overcast); }
    if (rainFx) rainFx.intensity = this.rain;
  }
  clockString() { const h = Math.floor(this.time), m = Math.floor((this.time - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
}
