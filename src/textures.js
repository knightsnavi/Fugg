import * as THREE from 'three';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, { srgb = true } = {}) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
/** Build a tangent-space normal map from a height canvas (grayscale). */
function normalFromHeight(hc, strength = 2) {
  const w = hc.width, h = hc.height; const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h); const g = out.getContext('2d'); const img = g.createImageData(w, h); const d = img.data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    let nx = -dx, ny = dy, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4; d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); return tex(out, { srgb: false });
}
const grime = (g, w, h, rng, amount = 0.12) => { for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(10,8,6,${rng() * amount})`; const x = rng() * w; g.fillRect(x, 0, 1 + rng() * 4, h); } for (let i = 0; i < 600; i++) { g.fillStyle = `rgba(0,0,0,${rng() * 0.2})`; g.fillRect(rng() * w, rng() * h, 2, 2); } };

/**
 * Facade texture set: {map, normalMap, emissiveMap, tile} where tile = world meters per texture repeat.
 * Styles: office (glass grid), brick (punched windows + sills), panel (window strips), metal (corrugated warehouse), house (siding)
 */
export function makeFacade(style, rng) {
  const S = 512; const c = canvas(S, S), hc = canvas(S, S), ec = canvas(S, S);
  const g = c.getContext('2d'), hg = hc.getContext('2d'), eg = ec.getContext('2d');
  eg.fillStyle = '#000'; eg.fillRect(0, 0, S, S);
  hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
  const cols = 4, rows = 4; const cw = S / cols, rh = S / rows; // 4 windows x 4 floors per tile (14 m x 14 m)
  const litColors = ['#ffe3a6', '#fff2d4', '#d9e8ff', '#ffd98a'];
  if (style === 'office') {
    g.fillStyle = '#c9ccd1'; g.fillRect(0, 0, S, S);
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const x = k * cw, y = r * rh; const shade = 0.75 + rng() * 0.25;
      g.fillStyle = `rgb(${38 * shade | 0},${52 * shade | 0},${68 * shade | 0})`; g.fillRect(x + 6, y + 8, cw - 12, rh - 16);
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 6, y + 8, cw - 12, 10);
      hg.fillStyle = '#5a5a5a'; hg.fillRect(x + 6, y + 8, cw - 12, rh - 16);
      if (rng() < 0.35) { eg.fillStyle = litColors[Math.floor(rng() * litColors.length)]; eg.fillRect(x + 8, y + 10, cw - 16, rh - 20); }
    }
    for (let r = 0; r <= rows; r++) { g.fillStyle = '#e4e6ea'; g.fillRect(0, r * rh - 3, S, 6); hg.fillStyle = '#b0b0b0'; hg.fillRect(0, r * rh - 3, S, 6); }
    for (let k = 0; k <= cols; k++) { g.fillStyle = '#dcdfe3'; g.fillRect(k * cw - 3, 0, 6, S); hg.fillStyle = '#a8a8a8'; hg.fillRect(k * cw - 3, 0, 6, S); }
  } else if (style === 'brick') {
    g.fillStyle = '#c7bcae'; g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 10) for (let x = 0; x < S; x += 24) { const off = (y / 10) % 2 ? 12 : 0; g.fillStyle = `rgba(${150 + rng() * 40 | 0},${110 + rng() * 30 | 0},${90 + rng() * 25 | 0},0.35)`; g.fillRect(x + off, y, 22, 8); hg.fillStyle = '#7a7a7a'; hg.fillRect(x + off, y + 8, 24, 2); }
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const x = k * cw + cw * 0.25, y = r * rh + rh * 0.18, w = cw * 0.5, h = rh * 0.58;
      g.fillStyle = '#4a4238'; g.fillRect(x - 5, y - 5, w + 10, h + 10);
      g.fillStyle = rng() < 0.5 ? '#1c2129' : '#232c38'; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x, y, w, 8);
      g.fillStyle = '#d8d2c6'; g.fillRect(x - 10, y + h + 4, w + 20, 7); // sill
      hg.fillStyle = '#404040'; hg.fillRect(x, y, w, h); hg.fillStyle = '#c8c8c8'; hg.fillRect(x - 10, y + h + 4, w + 20, 7);
      if (rng() < 0.3) { eg.fillStyle = litColors[Math.floor(rng() * litColors.length)]; eg.fillRect(x + 2, y + 2, w - 4, h - 4); }
    }
  } else if (style === 'panel') {
    g.fillStyle = '#9ea5ad'; g.fillRect(0, 0, S, S);
    for (let r = 0; r < rows; r++) {
      const y = r * rh; g.fillStyle = r % 2 ? '#8a9199' : '#a7adb5'; g.fillRect(0, y, S, rh * 0.42);
      g.fillStyle = '#1f2a36'; g.fillRect(0, y + rh * 0.42, S, rh * 0.5); hg.fillStyle = '#505050'; hg.fillRect(0, y + rh * 0.42, S, rh * 0.5);
      g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(0, y + rh * 0.42, S, 6);
      for (let k = 0; k < cols * 2; k++) { g.fillStyle = '#6d757d'; g.fillRect(k * cw / 2 - 2, y + rh * 0.42, 4, rh * 0.5); hg.fillStyle = '#a0a0a0'; hg.fillRect(k * cw / 2 - 2, y + rh * 0.42, 4, rh * 0.5); if (rng() < 0.3) { eg.fillStyle = litColors[Math.floor(rng() * litColors.length)]; eg.fillRect(k * cw / 2 + 3, y + rh * 0.44, cw / 2 - 6, rh * 0.46); } }
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y + rh * 0.92, S, rh * 0.08);
    }
  } else if (style === 'metal') {
    g.fillStyle = '#8d9096'; g.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 8) { g.fillStyle = x % 16 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.08)'; g.fillRect(x, 0, 8, S); hg.fillStyle = x % 16 ? '#606060' : '#a0a0a0'; hg.fillRect(x, 0, 8, S); }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(120,70,40,${rng() * 0.35})`; g.fillRect(rng() * S, rng() * S, 6 + rng() * 30, 3 + rng() * 60); }
    g.fillStyle = '#2a3038'; g.fillRect(0, 40, S, 50); hg.fillStyle = '#505050'; hg.fillRect(0, 40, S, 50); // high window strip
    for (let k = 0; k < 8; k++) { g.fillStyle = '#9a9ea4'; g.fillRect(k * 64 - 2, 40, 4, 50); if (rng() < 0.4) { eg.fillStyle = '#cfe0ff'; eg.fillRect(k * 64 + 4, 44, 56, 42); } }
  } else { // house: siding
    g.fillStyle = '#cfc7b8'; g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 14) { g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(0, y + 11, S, 3); hg.fillStyle = '#606060'; hg.fillRect(0, y + 11, S, 3); }
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      if (rng() < 0.35) continue;
      const x = k * cw + cw * 0.28, y = r * rh + rh * 0.2, w = cw * 0.44, h = rh * 0.55;
      g.fillStyle = '#f0ece4'; g.fillRect(x - 6, y - 6, w + 12, h + 12); g.fillStyle = '#20262e'; g.fillRect(x, y, w, h);
      g.fillStyle = '#f0ece4'; g.fillRect(x + w / 2 - 2, y, 4, h); g.fillRect(x, y + h / 2 - 2, w, 4);
      hg.fillStyle = '#404040'; hg.fillRect(x, y, w, h);
      if (rng() < 0.4) { eg.fillStyle = litColors[Math.floor(rng() * litColors.length)]; eg.fillRect(x + 2, y + 2, w - 4, h - 4); }
    }
  }
  grime(g, S, S, rng, style === 'office' ? 0.06 : 0.12);
  return { map: tex(c), normalMap: normalFromHeight(hc, style === 'office' ? 1.5 : 2.5), emissiveMap: tex(ec), tile: 14 };
}

export function makeSidewalk(rng) {
  const S = 256; const c = canvas(S, S), hc = canvas(S, S); const g = c.getContext('2d'), hg = hc.getContext('2d');
  g.fillStyle = '#8f8d88'; g.fillRect(0, 0, S, S); hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
  for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(${60 + rng() * 60 | 0},${60 + rng() * 60 | 0},${60 + rng() * 55 | 0},0.25)`; g.fillRect(rng() * S, rng() * S, 2, 2); }
  for (let k = 0; k <= 2; k++) { g.fillStyle = 'rgba(40,38,35,0.6)'; g.fillRect(k * 128 - 2, 0, 4, S); g.fillRect(0, k * 128 - 2, S, 4); hg.fillStyle = '#404040'; hg.fillRect(k * 128 - 2, 0, 4, S); hg.fillRect(0, k * 128 - 2, S, 4); }
  for (let i = 0; i < 12; i++) { g.fillStyle = `rgba(0,0,0,${0.1 + rng() * 0.2})`; g.beginPath(); g.arc(rng() * S, rng() * S, 4 + rng() * 14, 0, 7); g.fill(); }
  return { map: tex(c), normalMap: normalFromHeight(hc, 1.5), tile: 2 };
}
export function makeGrass(rng) {
  const S = 256; const c = canvas(S, S); const g = c.getContext('2d');
  g.fillStyle = '#4b6b35'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(${40 + rng() * 60 | 0},${80 + rng() * 70 | 0},${30 + rng() * 40 | 0},0.5)`; g.fillRect(rng() * S, rng() * S, 2, 3); }
  for (let i = 0; i < 20; i++) { g.fillStyle = `rgba(110,90,50,${rng() * 0.25})`; g.beginPath(); g.arc(rng() * S, rng() * S, 6 + rng() * 20, 0, 7); g.fill(); }
  return { map: tex(c), tile: 6 };
}
export function makeAsphalt(rng) {
  const S = 256; const c = canvas(S, S), hc = canvas(S, S); const g = c.getContext('2d'), hg = hc.getContext('2d');
  g.fillStyle = '#2a2b30'; g.fillRect(0, 0, S, S); hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
  for (let i = 0; i < 5000; i++) { const v = 30 + rng() * 40 | 0; g.fillStyle = `rgba(${v},${v},${v + 6},0.6)`; g.fillRect(rng() * S, rng() * S, 2, 2); hg.fillStyle = rng() < 0.5 ? '#707070' : '#909090'; hg.fillRect(rng() * S, rng() * S, 2, 2); }
  for (let i = 0; i < 8; i++) { g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1.5; g.beginPath(); let x = rng() * S, y = rng() * S; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rng() - 0.5) * 60; y += (rng() - 0.5) * 60; g.lineTo(x, y); } g.stroke(); }
  for (let i = 0; i < 10; i++) { g.fillStyle = `rgba(0,0,0,${rng() * 0.3})`; g.beginPath(); g.arc(rng() * S, rng() * S, 10 + rng() * 30, 0, 7); g.fill(); }
  return { map: tex(c), normalMap: normalFromHeight(hc, 0.8), tile: 8 };
}
const ADS = ['FUGG COLA', 'NITE CLUB', 'LUCKY 7', 'BAIL BONDS', 'MOTEL', 'PAWN', 'LIQUOR', 'TATTOO', 'DINER', 'CASINO', 'NOODLES', 'GARAGE', 'DELUXE', 'BURGER', 'VINYL', 'PIZZA'];
export function makeBillboard(rng) {
  const c = canvas(512, 256); const g = c.getContext('2d');
  const hue = Math.floor(rng() * 360); const grad = g.createLinearGradient(0, 0, 512, 256); grad.addColorStop(0, `hsl(${hue},60%,30%)`); grad.addColorStop(1, `hsl(${(hue + 60) % 360},70%,45%)`);
  g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
  g.fillStyle = 'rgba(255,255,255,0.12)'; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(rng() * 512, rng() * 256, 30 + rng() * 80, 0, 7); g.fill(); }
  const text = ADS[Math.floor(rng() * ADS.length)];
  g.font = `900 ${text.length > 8 ? 70 : 96}px Impact, Arial Black, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillText(text, 262, 136); g.fillStyle = rng() < 0.5 ? '#fff' : '#ffe14a'; g.fillText(text, 256, 128);
  g.font = '28px Arial, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillText(['OPEN LATE', 'SINCE 1987', 'NO REFUNDS', 'TWO FOR ONE', 'ALL NIGHT'][Math.floor(rng() * 5)], 256, 210);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
