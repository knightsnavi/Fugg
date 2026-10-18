import * as THREE from 'three';

const VERT = `varying vec3 vDir; void main(){ vDir = (modelMatrix * vec4(position,1.0)).xyz - cameraPosition; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const FRAG = `
uniform vec3 topColor, horizonColor, sunColor, cloudColor; uniform vec3 sunDir; uniform float cloudiness, night, time;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.1 + 17.0; a *= 0.5; } return v; }
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(horizonColor, topColor, pow(h, 0.55));
  float sd = max(dot(d, sunDir), 0.0);
  col += sunColor * (pow(sd, 400.0) * 4.0 + pow(sd, 6.0) * 0.35) * (1.0 - night * 0.9);
  if (d.y > -0.02) {
    vec2 uv = d.xz / (d.y + 0.12) * 0.5 + vec2(time * 0.004, time * 0.002);
    float c = fbm(uv * 1.4);
    float cov = smoothstep(0.58 - cloudiness * 0.33, 0.82, c);
    vec3 cc = cloudColor * (1.0 - night * 0.9) + sunColor * pow(sd, 3.0) * 0.15;
    col = mix(col, cc, cov * smoothstep(0.0, 0.12, d.y));
  }
  if (night > 0.05 && d.y > 0.05) {
    vec2 sp = floor(d.xz / (d.y + 0.3) * 260.0);
    float s = hash(sp); float st = step(0.9965, s) * night * smoothstep(0.05, 0.3, d.y);
    col += vec3(st) * (0.5 + 0.5 * hash(sp + 1.3)) * (0.7 + 0.3 * sin(time * 3.0 + s * 40.0));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

/** Shader sky dome with sun, procedural clouds and stars. Also provides a PMREM environment map for reflections. */
export class Sky {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.uniforms = { topColor: { value: new THREE.Color(0x3a5f8a) }, horizonColor: { value: new THREE.Color(0x9fb4c4) }, sunColor: { value: new THREE.Color(1, 0.95, 0.85) }, cloudColor: { value: new THREE.Color(0.95, 0.95, 0.97) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, cloudiness: { value: 0.4 }, night: { value: 0 }, time: { value: 0 } };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1300, 40, 20), this.material); this.mesh.frustumCulled = false; this.mesh.renderOrder = -10; scene.add(this.mesh);
    // env map from a tiny sky-only scene
    this.envScene = new THREE.Scene(); this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), this.material));
    this.pmrem = new THREE.PMREMGenerator(renderer); this.envT = 99; this.envRT = null;
  }
  update(dt, cam, { sunDir, day, night, dusk, cloudiness }) {
    const u = this.uniforms; u.time.value += dt; u.night.value = night; u.cloudiness.value = cloudiness; u.sunDir.value.copy(sunDir);
    const top = new THREE.Color(0x060913).lerp(new THREE.Color(0x2f5a8a), day).lerp(new THREE.Color(0x4a3f66), dusk * 0.5);
    const hor = new THREE.Color(0x0a0f1c).lerp(new THREE.Color(0x9fb3c2), day).lerp(new THREE.Color(0xd4784a), dusk * 0.8);
    top.multiplyScalar(1 - cloudiness * 0.35); hor.multiplyScalar(1 - cloudiness * 0.25);
    u.topColor.value.copy(top); u.horizonColor.value.copy(hor);
    u.sunColor.value.setRGB(1, 0.6 + 0.35 * day, 0.35 + 0.5 * day);
    u.cloudColor.value.setRGB(0.95 - cloudiness * 0.5, 0.95 - cloudiness * 0.5, 0.97 - cloudiness * 0.45);
    this.mesh.position.copy(cam);
    this.envT += dt;
    if (this.envT > 4) { this.envT = 0; const rt = this.pmrem.fromScene(this.envScene, 0.04); if (this.envRT) this.envRT.dispose(); this.envRT = rt; this.scene.environment = rt.texture; }
  }
}
