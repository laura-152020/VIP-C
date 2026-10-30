/* VIP-C · Service worker de la app instalable.
 * Solo guarda en caché los archivos propios de la página (para abrir rápido y mostrar la pantalla aunque
 * falle la red). Las lecturas, el guardado (Apps Script) y ArcGIS van SIEMPRE por la red: nunca se cachean. */
const CACHE = "vipc-8.7";
const BASE = ["./", "index.html", "css/style.css?v=8.7", "img/logo-gobernacion-antioquia-blanco.png?v=8.7",
  "img/app/icono-192.png", "img/app/icono-512.png", "img/app/icono-maskable-512.png", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return; // Apps Script, ArcGIS y CDN: directo a la red
  if (url.pathname.endsWith("/js/config.js")) return;                 // la configuración nunca se cachea
  if (url.pathname.includes("/descargas/")) return;                   // el instalador no se guarda en caché
  // Primero la red (así siempre se ve la versión nueva); si no hay conexión, lo último guardado
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && res.type === "basic") { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
    return res;
  }).catch(() => caches.match(req).then((r) => r || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});
