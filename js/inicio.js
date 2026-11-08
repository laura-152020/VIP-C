/* Pantalla de inicio: tres cajas (manual, fotográfica, PDF). Cada botón abre solo su sección. */
(() => {
  "use strict";
  const app = () => document.getElementById("app");
  function ir(v) {
    const a = app(); if (!a) return;
    a.dataset.vista = v || "inicio";
    window.scrollTo({ top: 0, behavior: "auto" });
    document.dispatchEvent(new CustomEvent("vista", { detail: a.dataset.vista }));
    if (v === "manual") { const e = document.querySelector("#manual input,#manual select"); if (e && matchMedia("(min-width:700px)").matches) e.focus({ preventScroll: true }); }
  }
  window.VistaInicio = { ir };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-vista]");
    if (b) { e.preventDefault(); ir(b.dataset.vista); }
  });
})();
