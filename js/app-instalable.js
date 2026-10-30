/* VIP-C · App instalable (PWA): registra el service worker y muestra el botón «Instalar app»
 * en Chrome y Edge. Ya instalada, VIP-C abre en su propia ventana con su ícono, como un programa. */
(function () {
  "use strict";
  if (!("serviceWorker" in navigator) || location.protocol !== "https:") return;
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

  const enVentanaApp = matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: window-controls-overlay)").matches;
  const enIframe = window.top !== window.self;            // dentro de ArcGIS Experience Builder no se ofrece instalar
  let evento = null;
  const boton = () => document.getElementById("instalar");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); evento = e;
    const b = boton(); if (b && !enVentanaApp && !enIframe) b.hidden = false;
  });
  window.addEventListener("appinstalled", () => { evento = null; const b = boton(); if (b) b.hidden = true; });
  document.addEventListener("click", async (e) => {
    if (!e.target.closest || !e.target.closest("#instalar") || !evento) return;
    evento.prompt();
    await evento.userChoice.catch(() => null);
    evento = null; boton().hidden = true;
  });
})();
