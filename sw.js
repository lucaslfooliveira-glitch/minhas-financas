/* Cache exclusivo da interface. Nenhum dado financeiro ou token é armazenado. */
const CACHE_PREFIX = 'minhas-financas-shell:' + new URL('./', self.location.href).pathname + ':';
const CACHE = CACHE_PREFIX + 'v1.0.0';
const SHELL = [
  './', './index.html', './config.js', './manifest.webmanifest',
  './css/tailwind.css', './css/styles.css', './css/integration.css',
  './js/app.js', './js/utils.js', './js/api.js', './js/pwa.js', './js/demo.js', './js/demo-engine.js',
  './vendor/chart.umd.min.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/mark.svg'
];
const ALLOWED = new Set(SHELL.map(path => new URL(path, self.location.href).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([...ALLOWED])));
  // A nova versão aguarda todas as páginas antigas fecharem, preservando formulários abertos.
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE).map(name => caches.delete(name)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Não interceptar Google, POST, parâmetros de consulta ou arquivos fora do shell explícito.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search || !ALLOWED.has(url.href)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (!response.ok || response.type !== 'basic') return response;
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
      return response;
    }).catch(async () => (await caches.match(request)) || (await caches.match(new URL('./index.html', self.location.href).href))));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
    }
    return response;
  })));
});
