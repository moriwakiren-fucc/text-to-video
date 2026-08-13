// Text Frame — Service Worker
// キャッシュにより、初回アクセス後はオフラインでもページ表示・動画生成（MP4変換含む）が可能になります。
// 依存ライブラリ（mp4-muxer）もすべてローカル同梱（vendor/）のためCDN接続は不要です。

const CACHE_VERSION = 'text-frame-v2';
const PRECACHE_URLS = [
  './',
  './index.html',
  './vendor/mp4-muxer.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Cache-first strategy: serve from cache when available, otherwise fetch
// and store a copy for next time. This keeps the app fully usable offline
// after the first successful visit.
self.addEventListener('fetch', (event) => {
  if(event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if(cached) return cached;

      return fetch(event.request)
        .then((response) => {
          if(!response || response.status !== 200 || response.type === 'opaque') {
            return response;
          }
          const responseClone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Fallback: if navigating and offline with no cache, try the cached index
          if(event.request.mode === 'navigate'){
            return caches.match('./index.html');
          }
        });
    })
  );
});
