// Text Frame — Service Worker
// キャッシュにより、初回アクセス後はオフラインでもページ表示・動画生成（MP4変換含む）が可能になります。
// 依存ライブラリ（mp4-muxer）もすべてローカル同梱（vendor/）のためCDN接続は不要です。
//
// バージョン確認の仕組み上、update.json は常にネットワークから最新のものを
// 取得する必要があるため、キャッシュ対象から除外し、fetchハンドラでも
// network-first（かつキャッシュへの保存もしない）で扱います。

const CACHE_VERSION = 'text-frame-v6';
const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './main.js',
  './update.js',
  './vendor/mp4-muxer.js',
  './manifest.webmanifest',
  './apple-touch-icon.png',
  './icons/icon-120.png',
  './icons/icon-152.png',
  './icons/icon-167.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-32.png',
  './icons/icon-16.png'
];

// update.json はキャッシュ経由で返さない（常に最新版と比較したいため）
const NETWORK_ONLY_PATTERNS = [
  /update\.json(\?.*)?$/
];

function isNetworkOnly(url){
  return NETWORK_ONLY_PATTERNS.some((re) => re.test(url));
}

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

self.addEventListener('fetch', (event) => {
  if(event.request.method !== 'GET') return;

  const url = event.request.url;

  // update.json: 常にネットワークから取得し、キャッシュには保存しない。
  // オフライン時はエラーを返す（update.js 側で静かに諦める設計）。
  if(isNetworkOnly(url)){
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch((err) => {
        return new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // それ以外は cache-first: キャッシュにあればそれを返し、なければ取得して
  // 次回のためにキャッシュへ保存する。これによりオフラインでも一通り使える。
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

