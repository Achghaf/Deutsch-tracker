self.addEventListener('install', event => {
  // Service worker installed
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Claim clients immediately so new service worker starts controlling pages
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  // Default fetch handler: just fetch from network
  event.respondWith(fetch(event.request));
});
