/* VIP-C escritorio · Barra de título propia (logo, nombre y botones) dibujada sobre la página.
 * La página no recibe acceso al sistema: solo puede pedir «Recargar» y «Acerca de». */
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("VIPC_ESCRITORIO", true);

const ALTO = 40;
const ICONOS = {
  recargar: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/></svg>',
  acerca: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.6"/><circle cx="8" cy="5" r=".4" fill="currentColor"/></svg>'
};

function barra() {
  if (document.getElementById("vipc-barra")) return;
  const host = document.createElement("div");
  host.id = "vipc-barra";
  host.style.cssText = `position:fixed;top:0;left:0;right:0;height:${ALTO}px;z-index:2147483646`;
  const raiz = host.attachShadow({ mode: "closed" });
  const logo = ipcRenderer.sendSync("vipc:logo");
  raiz.innerHTML = `
  <style>
    :host{all:initial}
    .b{height:${ALTO}px;display:flex;align-items:center;gap:10px;padding:0 0 0 12px;background:linear-gradient(180deg,#24311a,#1d2711);
       color:#fff;font:12.5px/1 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;-webkit-app-region:drag;user-select:none;
       border-bottom:1px solid #f2b705;box-sizing:border-box;padding-right:calc(100vw - env(titlebar-area-width, calc(100vw - 140px)) - env(titlebar-area-x, 0px))}
    img{width:24px;height:24px;flex:none}
    .n{font-weight:700;letter-spacing:.06em;font-size:13px}
    .s{color:#c9d3ba;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sep{width:1px;height:16px;background:rgba(255,255,255,.22)}
    .esp{flex:1}
    button{-webkit-app-region:no-drag;background:none;border:0;color:#dfe6d4;height:${ALTO - 1}px;width:42px;display:grid;place-items:center;cursor:default;border-radius:0}
    button:hover{background:rgba(255,255,255,.1);color:#fff}
    button:active{background:rgba(255,255,255,.16)}
    button:focus-visible{outline:2px solid #f2b705;outline-offset:-2px}
    @media (max-width:560px){.s,.sep{display:none}}
  </style>
  <div class="b">
    <img src="${logo}" alt="">
    <span class="n">VIP-C</span><span class="sep"></span><span class="s">Visor interactivo de puntos críticos · Gobernación de Antioquia</span>
    <span class="esp"></span>
    <button id="r" title="Recargar (F5)" aria-label="Recargar">${ICONOS.recargar}</button>
    <button id="a" title="Acerca de VIP-C" aria-label="Acerca de VIP-C">${ICONOS.acerca}</button>
  </div>`;
  raiz.getElementById("r").addEventListener("click", () => ipcRenderer.send("vipc:recargar"));
  raiz.getElementById("a").addEventListener("click", () => ipcRenderer.send("vipc:acerca"));
  document.documentElement.appendChild(host);

  // Deja espacio para la barra y corrige los elementos que se quedan pegados arriba
  const st = document.createElement("style");
  st.textContent = `html{scroll-padding-top:${ALTO + 8}px}body{padding-top:${ALTO}px!important}
    .card__foto,.pdf-vista{top:${ALTO + 12}px!important}
    .topbar__in{padding-top:6px!important;padding-bottom:6px!important}.topbar .logo{height:58px!important}
    .marca__sigla{font-size:30px!important}`;
  (document.head || document.documentElement).appendChild(st);
}
window.addEventListener("DOMContentLoaded", barra);
