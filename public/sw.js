// سرویس‌ورکر سبک: پوستهٔ برنامه کش می‌شود تا آیکون و صفحه آفلاین هم بالا بیاید.
// داده‌ها (/api/…) هیچ‌وقت کش نمی‌شوند.
const CACHE = 'assistant-v14';
const SHELL = [
  '/',
  '/style.css?v=14',
  '/app.js?v=14',
  '/summarize.js?v=14',
  '/openalex.js?v=14',
  '/pubchem.js?v=14',
  '/sources.js?v=14',
  '/ocr.js?v=14',
  '/extract.js?v=14',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // همیشه مستقیم از سرور

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/'))),
  );
});
