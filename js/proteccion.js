/* VIP-C · Protección básica contra copia
 * Bloquea el clic derecho, «Ver código fuente», «Guardar como», las herramientas de desarrollador
 * y copiar el texto de la página. En las casillas del formulario se puede copiar y pegar normalmente,
 * y Ctrl+V sigue funcionando para pegar fotos y PDF. */
(function () {
  "use strict";
  const enCampo = (el) => !!(el && el.closest && el.closest("input, textarea, select, [contenteditable='true']"));

  // Clic derecho (menú contextual), salvo en las casillas
  document.addEventListener("contextmenu", (e) => { if (!enCampo(e.target)) e.preventDefault(); });

  // Atajos de teclado
  document.addEventListener("keydown", (e) => {
    const k = (e.key || "").toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    const bloquear =
      k === "f12" ||                                                // herramientas de desarrollador
      (ctrl && e.shiftKey && ["i", "j", "c", "k"].includes(k)) ||  // inspeccionar / consola
      (e.metaKey && e.altKey && ["i", "j", "c", "u"].includes(k)) || // lo mismo en Mac
      (ctrl && ["u", "s", "p"].includes(k)) ||                     // ver código fuente, guardar, imprimir
      (ctrl && ["c", "x", "a"].includes(k) && !enCampo(document.activeElement)); // copiar texto de la página
    if (bloquear) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // Copiar o cortar texto de la página (menú del navegador o gestos), salvo dentro de las casillas
  ["copy", "cut"].forEach((t) => document.addEventListener(t, (e) => { if (!enCampo(e.target) && !enCampo(document.activeElement)) e.preventDefault(); }));

  // Arrastrar imágenes y logos fuera de la página
  document.addEventListener("dragstart", (e) => { if (e.target && e.target.tagName === "IMG") e.preventDefault(); });
})();
