const CACHE = 'expense-tracker-v25';
const ASSETS = ['./', './index.html', './styles.css?v=25', './enhancements.css?v=25', './core.js?v=25', './recovery.js?v=25', './sync.js?v=25', './supabase-config.js?v=25', './app.js?v=25', './manifest.webmanifest?v=25', './icon.svg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('expense-tracker-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()).then(() => self.clients.matchAll({ type: 'window' })).then(clients => {
    for (const client of clients) client.postMessage({ type: 'expense-tracker-updated', cache: CACHE });
  }));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Only cache the app shell. Never cache authentication or shared financial data.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !ASSETS.some(asset => new URL(asset, self.registration.scope).href === url.href)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, response.clone())));
    return response;
  }).catch(async () => (await caches.match(event.request)) || new Response('Offline. Reconnect to load this page.', { status: 503 })));
});
