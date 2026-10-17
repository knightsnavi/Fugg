import * as THREE from 'three';
import { CFG } from './config.js';
import { lerp, clamp } from './util.js';

export class DayNight {
  constructor(scene, city, { shadows = true } = {}) {
    this.scene = scene; this.city = city; this.time = 9.5; // hours
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = shadows;
    const sc = this.sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 400;
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -0.0008; this.sun.shadow.normalBias = 0.05;
    this.sunTarget = new THREE.Object3D(); scene.add(this.sunTarget); this.sun.target = this.sunTarget;
    scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x50483c, 0.9); scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.15); scene.add(this.ambient);
    scene.fog = new THREE.Fog(0xaec6e6, 120, 650);
    scene.background = new THREE.Color(0x87b7e8);
    this.cDay = new THREE.Color(0x8ec2f2), this.cDusk = new THREE.Color(0xf0905a), this.cNight = new THREE.Color(0x0a0f22);
    this.fogDay = new THREE.Color(0xb8d2ee), this.fogNight = new THREE.Color(0x0d1324), this.fogDusk = new THREE.Color(0xd99a6a);
    this.col = new THREE.Color();
  }
  get isNight() { return this.time < 6 || this.time > 19; }
  update(dt, focus) {
    this.time = (this.time + dt * (24 / CFG.dayLengthSec)) % 24;
    const a = ((this.time - 6) / 12) * Math.PI; // 0 at 6h, pi at 18h
    const el = Math.sin(a); // elevation -1..1
    const sx = Math.cos(a) * 200, sy = el * 200, sz = 80;
    this.sun.position.set(focus.x + sx, Math.max(sy, -30), focus.z + sz);
    this.sunTarget.position.set(focus.x, 0, focus.z);
    const day = clamp(el * 2.5, 0, 1);         // 0 at horizon → 1 shortly after
    const dusk = clamp(1 - Math.abs(el) * 4, 0, 1) * (el > -0.15 ? 1 : 0);
    this.sun.intensity = 2.4 * day;
    this.sun.color.setRGB(1, lerp(0.55, 1, day), lerp(0.3, 0.95, day));
    this.hemi.intensity = lerp(0.12, 0.9, day);
    this.ambient.intensity = lerp(0.08, 0.15, day);
    const bg = this.col.copy(this.cNight).lerp(this.cDay, day).lerp(this.cDusk, dusk * 0.7);
    this.scene.background.copy(bg);
    this.scene.fog.color.copy(this.fogNight).lerp(this.fogDay, day).lerp(this.fogDusk, dusk * 0.6);
    const night = 1 - day;
    this.city.buildingMaterial.emissiveIntensity = night * 0.9;
    if (this.city.lampMaterial) this.city.lampMaterial.emissiveIntensity = night * 2.5;
    this.city.updateTrafficLights(this.time * 3600 / 60); // 1 game minute = 1 second of light cycle
    this.night = night;
  }
  clockString() { const h = Math.floor(this.time), m = Math.floor((this.time - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
}
