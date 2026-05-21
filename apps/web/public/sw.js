// myMaison service worker — minimal, intentionally no caching.
// Exists so the app qualifies as an installable PWA on Chrome/Android
// and so iOS treats the home-screen shortcut as standalone. During beta
// we never want a stale cache to mask a deploy.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Chrome's installability heuristic requires the SW to have a fetch
// handler. Pass-through only — do not add caching here.
self.addEventListener('fetch', () => {});
