const CACHE = 'jug-scan-v1.1.0-neon';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './assets/bg-main.webp',
  './assets/bg-store.webp',
  './assets/jugscan-logo.webp',
  './assets/clown-face.png',
  './assets/machine-funky.webp',
  './assets/machine-neo.webp',
  './assets/machine-happy.webp',
  './assets/machine-my5.webp',
  './assets/machine-gogo3.webp',
  './assets/machine-other.webp',
  './assets/panel-blue.webp'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match('./index.html')))
  );
});
