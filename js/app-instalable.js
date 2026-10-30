/* VIP-C · Botón «Instalar software».
 * En Windows descarga el instalador del programa de escritorio (VIP-C-Instalador.exe).
 * En otros sistemas (Mac, Linux, Chromebook) instala VIP-C como app desde el navegador, si este lo permite.
 * Dentro del programa de escritorio el botón no aparece. */
(function () {
  "use strict";
  // Dirección pública del instalador (GitHub Releases). Se puede cambiar con CONFIG.INSTALADOR_URL en js/config.js
  const INSTALADOR = "https://github.com/laura-152020/vip-c-descargas/releases/latest/download/VIP-C-Instalador.exe";
  const urlInstalador = () => (typeof CONFIG !== "undefined" && CONFIG.INSTALADOR_URL) || INSTALADOR;

  const enPrograma = !!window.VIPC_ESCRITORIO || /[?&]app=escritorio/.test(location.search);
  const enVentanaApp = matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: window-controls-overlay)").matches;
  const ua = navigator.userAgent || "";
  const esWindows = /Windows/i.test(ua) && !/Windows Phone/i.test(ua);
  const esMovil = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);

  if ("serviceWorker" in navigator && location.protocol === "https:" && !enPrograma) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  let evento = null;                                    // instalación desde el navegador (Mac, Linux, Chromebook)
  const boton = () => document.getElementById("instalar");
  const mostrar = (si) => { const b = boton(); if (b) b.hidden = !si; };
  const avisar = (texto) => {
    const a = document.getElementById("aviso");
    if (!a) return;
    a.textContent = texto; a.className = "aviso"; a.hidden = false;
    a.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  function preparar() {
    if (enPrograma || enVentanaApp || esMovil) return mostrar(false);
    if (esWindows) return mostrar(true);
    mostrar(!!evento);
  }
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); evento = e; preparar(); });
  window.addEventListener("appinstalled", () => { evento = null; preparar(); });
  document.addEventListener("DOMContentLoaded", preparar);

  document.addEventListener("click", async (e) => {
    if (!e.target.closest || !e.target.closest("#instalar")) return;
    if (esWindows) {
      const a = document.createElement("a");
      a.href = urlInstalador(); a.rel = "noopener"; a.setAttribute("download", "VIP-C-Instalador.exe");
      document.body.appendChild(a); a.click(); a.remove();
      avisar("Descargando el instalador de VIP-C. Ábrelo cuando termine y sigue los pasos. " +
        "Si Windows muestra «Windows protegió su PC», toca «Más información» y luego «Ejecutar de todas formas».");
      return;
    }
    if (evento) { evento.prompt(); await evento.userChoice.catch(() => null); evento = null; preparar(); }
  });
})();
