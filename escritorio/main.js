/* VIP-C · Aplicación de escritorio (Windows).
 * Ventana segura que abre la página oficial de VIP-C: el código de la aplicación NO va dentro del instalador,
 * siempre se usa la última versión publicada y los datos se guardan igual que en la web (Drive, Sheet y ArcGIS).
 * Para cambiar la dirección, edita "url" en config.json y vuelve a construir el instalador. */
const { app, BrowserWindow, Menu, shell, session } = require("electron");
const path = require("path");
const URL_APP = new URL(process.env.VIPC_URL || require("./config.json").url);
const esPropio = (u) => { try { return new URL(u).origin === URL_APP.origin; } catch (_) { return false; } };

if (!app.requestSingleInstanceLock()) app.quit();
let win = null;
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
const cargar = () => win.loadURL(URL_APP.href + (URL_APP.search ? "&" : "?") + "app=escritorio");

function crear() {
  win = new BrowserWindow({
    width: 1320, height: 900, minWidth: 380, minHeight: 600,
    title: "VIP-C", icon: path.join(__dirname, "build", "icon.png"),
    backgroundColor: "#283517", show: false, autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      devTools: !app.isPackaged,           // sin herramientas de desarrollador en la versión instalada
      partition: "persist:vipc"            // la sesión se conserva al cerrar la app
    }
  });
  win.once("ready-to-show", () => win.show());
  // Enlaces externos (Ver ubicación, Drive, ArcGIS) se abren en el navegador
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith("vipc://")) { e.preventDefault(); cargar(); return; }
    if (!esPropio(url)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  win.webContents.on("did-fail-load", (_e, codigo, _d, _u, principal) => {
    if (principal && codigo !== -3) win.loadFile(path.join(__dirname, "sin-conexion.html"));
  });
  win.webContents.on("before-input-event", (e, i) => {
    const k = (i.key || "").toLowerCase();
    if (app.isPackaged && (k === "f12" || (i.control && i.shift && ["i", "j", "c"].includes(k)) || (i.control && k === "u"))) e.preventDefault();
  });
  cargar();
}

app.whenReady().then(() => {
  const s = session.fromPartition("persist:vipc");
  // Permisos solo para VIP-C: ubicación, pegar imágenes, notificaciones. Todo lo demás se niega.
  const OK = ["geolocation", "clipboard-read", "clipboard-sanitized-write", "notifications", "fullscreen"];
  s.setPermissionRequestHandler((wc, p, cb) => cb(esPropio(wc.getURL()) && OK.includes(p)));
  s.setPermissionCheckHandler((wc, p) => !!wc && esPropio(wc.getURL()) && OK.includes(p));
  Menu.setApplicationMenu(Menu.buildFromTemplate([   // oculto; se muestra con Alt
    { label: "VIP-C", submenu: [
      { label: "Recargar", accelerator: "F5", click: () => win && win.reload() },
      { label: "Abrir en el navegador", click: () => shell.openExternal(URL_APP.href) },
      { type: "separator" }, { role: "quit", label: "Salir" }] },
    { label: "Editar", submenu: [
      { role: "undo", label: "Deshacer" }, { role: "redo", label: "Rehacer" }, { type: "separator" },
      { role: "cut", label: "Cortar" }, { role: "copy", label: "Copiar" }, { role: "paste", label: "Pegar" },
      { role: "selectAll", label: "Seleccionar todo" }] },
    { label: "Ver", submenu: [
      { role: "zoomIn", label: "Acercar" }, { role: "zoomOut", label: "Alejar" }, { role: "resetZoom", label: "Tamaño normal" },
      { type: "separator" }, { role: "togglefullscreen", label: "Pantalla completa" }] }
  ]));
  crear();
});
app.on("window-all-closed", () => app.quit());
app.on("web-contents-created", (_e, wc) => wc.on("will-attach-webview", (e) => e.preventDefault()));
