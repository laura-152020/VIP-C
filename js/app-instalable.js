/* VIP-C · Botón «Instalar software».
 * En Windows descarga el instalador del programa de escritorio (VIP-C-Instalador.exe) desde la misma página:
 * viene dividido en partes (descargas/instalador.json), se unen en el navegador y se verifica su huella SHA-256.
 * En otros sistemas (Mac, Linux, Chromebook) instala VIP-C como app desde el navegador, si este lo permite.
 * Dentro del programa de escritorio el botón no aparece. */
(function () {
  "use strict";
  // Opcional: un enlace directo propio (Drive, etc.) con CONFIG.INSTALADOR_URL en js/config.js
  const urlDirecta = () => (typeof CONFIG !== "undefined" && CONFIG.INSTALADOR_URL) || "";
  let descargando = false;

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

  const guardar = (href, nombre) => {
    const a = document.createElement("a");
    a.href = href; a.rel = "noopener"; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
  };
  const PASOS = "Ábrelo cuando termine y sigue los pasos. Si Windows muestra «Windows protegió su PC», " +
    "toca «Más información» y luego «Ejecutar de todas formas».";

  async function descargarInstalador() {
    if (descargando) return;
    if (urlDirecta()) { guardar(urlDirecta(), "VIP-C-Instalador.exe"); avisar("Descargando el instalador de VIP-C. " + PASOS); return; }
    const b = boton(), texto = b.textContent;
    descargando = true; b.disabled = true;
    try {
      const info = await (await fetch("descargas/instalador.json", { cache: "no-store" })).json();
      const trozos = []; let recibido = 0;
      for (const parte of info.partes) {
        const r = await fetch("descargas/" + parte);
        if (!r.ok) throw new Error("parte " + parte);
        const lector = r.body.getReader();
        for (;;) {
          const { done, value } = await lector.read();
          if (done) break;
          trozos.push(value); recibido += value.length;
          b.textContent = "Descargando " + Math.min(99, Math.floor(recibido * 100 / info.tamano)) + " %";
        }
      }
      const archivo = new Blob(trozos, { type: "application/vnd.microsoft.portable-executable" });
      if (archivo.size !== info.tamano) throw new Error("tamaño");
      if (crypto && crypto.subtle) {               // la huella confirma que el instalador llegó completo y sin alterar
        const h = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await archivo.arrayBuffer())))
          .map((x) => x.toString(16).padStart(2, "0")).join("");
        if (h !== info.sha256) throw new Error("huella");
      }
      const url = URL.createObjectURL(archivo);
      guardar(url, info.nombre || "VIP-C-Instalador.exe");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      avisar("Instalador de VIP-C " + info.version + " descargado. " + PASOS);
    } catch (_) {
      avisar("No se pudo descargar el instalador. Revisa la conexión a internet e inténtalo de nuevo.");
    } finally {
      descargando = false; b.disabled = false; b.textContent = texto;
    }
  }

  document.addEventListener("click", async (e) => {
    if (!e.target.closest || !e.target.closest("#instalar")) return;
    if (esWindows) { descargarInstalador(); return; }
    if (evento) { evento.prompt(); await evento.userChoice.catch(() => null); evento = null; preparar(); }
  });
})();
