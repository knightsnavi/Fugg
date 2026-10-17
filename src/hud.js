export class HUD {
  constructor(game) {
    this.game = game;
    const $ = (id) => document.getElementById(id);
    this.el = { hud: $('hud'), money: $('money'), wanted: $('wanted'), health: $('health-fill'), objective: $('objective'), objText: $('objective-text'), objTimer: $('objective-timer'), speedo: $('speedo'), speed: $('speed-val'), prompt: $('prompt'), toast: $('toast'), big: $('bigmsg'), clock: $('clock'), compass: $('compass') };
    this.map = $('minimap'); this.ctx = this.map.getContext('2d');
    this.toastT = 0; this.bigT = 0; this.moneyShown = 0;
  }
  show() { this.el.hud.classList.remove('hidden'); }
  toast(text, secs = 3) { this.el.toast.textContent = text; this.el.toast.classList.remove('hidden'); this.toastT = secs; }
  big(text, secs = 3) { this.el.big.textContent = text; this.el.big.classList.remove('hidden'); this.bigT = secs; }
  prompt(text) { if (text) { this.el.prompt.textContent = text; this.el.prompt.classList.remove('hidden'); } else this.el.prompt.classList.add('hidden'); }
  update(dt) {
    const g = this.game, p = g.player;
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.el.toast.classList.add('hidden'); }
    if (this.bigT > 0) { this.bigT -= dt; if (this.bigT <= 0) this.el.big.classList.add('hidden'); }
    this.moneyShown += (p.money - this.moneyShown) * Math.min(1, dt * 8);
    if (Math.abs(p.money - this.moneyShown) < 1) this.moneyShown = p.money;
    this.el.money.textContent = '$' + Math.round(this.moneyShown).toLocaleString();
    let stars = ''; for (let i = 0; i < 5; i++) stars += i < p.wanted ? '★' : '<span class="dim">★</span>';
    this.el.wanted.innerHTML = stars;
    this.el.health.style.width = p.health + '%';
    this.el.clock.textContent = g.daynight.clockString();
    if (p.state === 'car') { this.el.speedo.classList.remove('hidden'); this.el.speed.textContent = Math.round(p.vehicle.speed * 3.6); }
    else this.el.speedo.classList.add('hidden');
    const m = g.missions?.active;
    if (m) { this.el.objective.classList.remove('hidden'); this.el.objText.textContent = m.objective; this.el.objTimer.textContent = m.timeLeft != null ? Math.max(0, m.timeLeft).toFixed(1) : ''; }
    else this.el.objective.classList.add('hidden');
    this.drawMinimap();
  }
  drawMinimap() {
    const g = this.game, c = this.ctx, W = this.map.width, H = this.map.height; const city = g.city;
    const px = g.player.x, pz = g.player.z; const yaw = g.cam.yaw; const scale = 0.85;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#3a3d45'; c.fillRect(0, 0, W, H);
    c.save(); c.translate(W / 2, H / 2); c.rotate(-yaw); c.scale(scale, -scale); c.translate(-px, -pz);
    const r = 130 / scale;
    for (const b of city.blocks) {
      if (Math.abs(b.cx - px) > r + 30 || Math.abs(b.cz - pz) > r + 30) continue;
      c.fillStyle = b.type === 'park' ? '#3f7a3a' : b.type === 'lot' ? '#55585f' : '#8a8d94';
      c.fillRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
      if (b.type === 'buildings') { c.fillStyle = '#6a6d74'; c.fillRect(b.minX + 3, b.minZ + 3, b.maxX - b.minX - 6, b.maxZ - b.minZ - 6); }
    }
    // water edge
    c.strokeStyle = '#2a6fa8'; c.lineWidth = 6; c.strokeRect(-city.bound, -city.bound, city.bound * 2, city.bound * 2);
    // markers
    for (const mk of g.missions?.markers || []) { c.fillStyle = mk.color; c.beginPath(); c.arc(mk.x, mk.z, 4, 0, Math.PI * 2); c.fill(); }
    const tgt = g.missions?.active?.target; if (tgt) { c.fillStyle = '#ffcc33'; c.beginPath(); c.arc(tgt.x, tgt.z, 5, 0, Math.PI * 2); c.fill(); }
    for (const pk of g.missions?.packages || []) { if (!pk.collected && Math.abs(pk.x - px) < r && Math.abs(pk.z - pz) < r) { c.fillStyle = '#7ad7ff'; c.fillRect(pk.x - 2, pk.z - 2, 4, 4); } }
    // vehicles
    for (const v of g.vehicles) {
      if (v === g.player.vehicle) continue;
      if (Math.abs(v.pos.x - px) > r || Math.abs(v.pos.z - pz) > r) continue;
      c.fillStyle = v.typeName === 'police' ? '#4aa3ff' : '#dddddd'; c.fillRect(v.pos.x - 1.5, v.pos.z - 1.5, 3, 3);
    }
    c.restore();
    // player arrow (always centered, pointing up)
    c.save(); c.translate(W / 2, H / 2);
    c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(0, -8); c.lineTo(6, 7); c.lineTo(0, 3); c.lineTo(-6, 7); c.closePath(); c.fill(); c.restore();
    // objective direction tick on rim
    if (tgt) {
      const dx = tgt.x - px, dz = tgt.z - pz; const ang = Math.atan2(dx, dz) - yaw;
      const sx = Math.sin(ang) * 70, sy = -Math.cos(ang) * 70;
      c.fillStyle = '#ffcc33'; c.beginPath(); c.arc(W / 2 + sx, H / 2 + sy, 5, 0, Math.PI * 2); c.fill();
    }
    // compass
    const cx = Math.sin(-yaw) * 86, cy = -Math.cos(-yaw) * 86;
    c.fillStyle = '#fff'; c.font = 'bold 16px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('N', W / 2 + cx, H / 2 + cy);
  }
}
