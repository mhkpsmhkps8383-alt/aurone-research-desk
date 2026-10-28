// سرویس‌ورکر سبک: پوستهٔ برنامه کش می‌شود تا آیکون و صفحه آفلاین هم بالا بیاید.
// داده‌ها (/api/…) هیچ‌وقت کش نمی‌شوند.
const CACHE = 'assistant-v21';
const SHELL = [
  '/',
  '/style.css?v=21',
  '/app.js?v=21',
  '/summarize.js?v=21',
  '/openalex.js?v=21',
  '/pubchem.js?v=21',
  '/sources.js?v=21',
  '/ocr.js?v=21',
  '/extract.js?v=21',
  '/figures.js?v=21',
  '/chembl.js?v=21',
  '/import.js?v=21',
  '/phrase.js?v=21',
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
