// سرویس‌ورکر سبک: پوستهٔ برنامه کش می‌شود تا آیکون و صفحه آفلاین هم بالا بیاید.
// داده‌ها (/api/…) هیچ‌وقت کش نمی‌شوند.
const CACHE = 'assistant-v18';
const SHELL = [
  '/',
  '/style.css?v=18',
  '/app.js?v=18',
  '/summarize.js?v=18',
  '/openalex.js?v=18',
  '/pubchem.js?v=18',
  '/sources.js?v=18',
  '/ocr.js?v=18',
  '/extract.js?v=18',
  '/figures.js?v=18',
  '/chembl.js?v=18',
  '/import.js?v=18',
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
