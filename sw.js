const CACHE = 'expense-tracker-v19';
const ASSETS = ['./', './index.html', './styles.css?v=19', './enhancements.css?v=19', './supabase-config.js?v=19', './app.js?v=19', './manifest.webmanifest?v=19', './icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.open(CACHE).then(cache => fetch(event.request).then(response => {
    if (response.ok) cache.put(event.request, response.clone());
    return response;
  }).catch(() => cache.match(event.request))));
});
