// Fugg City service worker: network-first for the app shell, falling back to the cache when offline.
const CACHE = 'fugg-city-v2';
const ASSETS = [
  './', './index.html', './style.css', './manifest.webmanifest', './vendor/three.module.js',
  './src/main.js', './src/config.js', './src/util.js', './src/physics.js', './src/input.js', './src/touch.js', './src/city.js', './src/characters.js',
  './src/vehicle.js', './src/player.js', './src/camera.js', './src/daynight.js', './src/hud.js', './src/audio.js', './src/effects.js', './src/weapons.js',
  './src/pedestrians.js', './src/driver.js', './src/traffic.js', './src/police.js', './src/missions.js', './assets/icon-192.png', './assets/icon-512.png',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return res; })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});
