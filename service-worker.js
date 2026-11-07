'use strict';
const CACHE = 'pair-comic-v4-20261107';
const FILES = ['./', './index.html', './style.css', './app.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './Yomogi-Regular.ttf', './ZenMaruGothic-Regular.ttf', './KiwiMaru-Regular.ttf', './ZenKakuGothicNew-Regular.ttf', './FONT-LICENSES.txt', './OFL-yomogi.txt', './OFL-zenmarugothic.txt', './OFL-kiwimaru.txt', './OFL-zenkakugothicnew.txt'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('pair-comic-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(caches.open(CACHE).then(cache => cache.match(event.request)).then(cached => cached || fetch(event.request)));
});
