/* VIP-C · Aplicación de escritorio (Windows).
 * Ventana segura que abre la página oficial de VIP-C: el código de la aplicación NO va dentro del instalador,
 * siempre se usa la última versión publicada y los datos se guardan igual que en la web (Drive, Sheet y ArcGIS).
 * Para cambiar la dirección, edita "url" en config.json y vuelve a construir el instalador. */
const { app, BrowserWindow, Menu, shell, session, ipcMain, nativeTheme, screen } = require("electron");
const path = require("path"), fs = require("fs");
const URL_APP = new URL(process.env.VIPC_URL || require("./config.json").url);
const esPropio = (u) => { try { return new URL(u).origin === URL_APP.origin; } catch (_) { return false; } };
const VERDE = "#1d2711";
const archivo = (f) => path.join(__dirname, f);

app.setAppUserModelId("co.gov.antioquia.vipc");      // ícono y nombre correctos en la barra de tareas
if (!app.requestSingleInstanceLock()) app.quit();
let win = null, splash = null, acerca = null;
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });

// Recuerda el tamaño y la posición de la ventana entre sesiones
const estadoArchivo = () => path.join(app.getPath("userData"), "ventana.json");
function leerEstado() {
  try {
    const e = JSON.parse(fs.readFileSync(estadoArchivo(), "utf8"));
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea; return e.x >= a.x - 50 && e.y >= a.y - 50 && e.x < a.x + a.width && e.y < a.y + a.height;
    });
    return visible ? e : { width: e.width, height: e.height, maximizada: e.maximizada };
  } catch (_) { return { width: 1360, height: 900 }; }
}
function guardarEstado() {
  if (!win || win.isDestroyed()) return;
  try { fs.writeFileSync(estadoArchivo(), JSON.stringify(Object.assign(win.getNormalBounds(), { maximizada: win.isMaximized() }))); } catch (_) {}
}

function mostrarSplash() {
  splash = new BrowserWindow({
    width: 520, height: 340, frame: false, resizable: false, movable: true, show: false, center: true,
    skipTaskbar: false, backgroundColor: VERDE, icon: archivo("build/icon.png"), title: "VIP-C",
    webPreferences: { sandbox: true, contextIsolation: true, devTools: false }
  });
  splash.loadFile(archivo("splash.html"));
  splash.once("ready-to-show", () => {
    splash.show();
    splash.webContents.executeJavaScript(`document.getElementById("v").textContent = "Versión ${app.getVersion()}"`).catch(() => {});
  });
}

const cargar = () => win.loadURL(URL_APP.href + (URL_APP.search ? "&" : "?") + "app=escritorio");

function crear() {
  const e = leerEstado();
  win = new BrowserWindow({
    x: e.x, y: e.y, width: e.width || 1360, height: e.height || 900, minWidth: 420, minHeight: 600,
    title: "VIP-C", icon: archivo("build/icon.png"), backgroundColor: "#f5f6f2", show: false,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: VERDE, symbolColor: "#ffffff", height: 40 },
    webPreferences: {
      preload: archivo("preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      devTools: !app.isPackaged,           // sin herramientas de desarrollador en la versión instalada
      partition: "persist:vipc"            // la sesión se conserva al cerrar la app
    }
  });
  const inicio = Date.now();
  let mostrada = false;
  const mostrar = () => {
    if (mostrada) return; mostrada = true;
    setTimeout(() => {                     // el splash se ve al menos 1,5 s para que no parpadee
      if (e.maximizada) win.maximize();
      win.show(); win.focus();
      if (splash && !splash.isDestroyed()) splash.close(); splash = null;
    }, Math.max(0, 1500 - (Date.now() - inicio)));
  };
  win.webContents.once("did-finish-load", mostrar);
  setTimeout(mostrar, 20000);              // si el servidor tarda mucho, se muestra igual

  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (ev, url) => {
    if (url.startsWith("vipc://")) { ev.preventDefault(); cargar(); return; }
    if (!esPropio(url)) { ev.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  win.webContents.on("did-fail-load", (_ev, codigo, _d, _u, principal) => {
    if (principal && codigo !== -3) win.loadFile(archivo("sin-conexion.html"));
  });
  win.webContents.on("before-input-event", (ev, i) => {
    if (i.type !== "keyDown") return;
    const k = (i.key || "").toLowerCase();
    if (k === "f5" || (i.control && k === "r")) { ev.preventDefault(); win.webContents.reload(); return; }
    if (app.isPackaged && (k === "f12" || (i.control && i.shift && ["i", "j", "c"].includes(k)) || (i.control && k === "u"))) ev.preventDefault();
  });
  ["resize", "move"].forEach((t) => win.on(t, () => { clearTimeout(win._g); win._g = setTimeout(guardarEstado, 400); }));
  win.on("close", guardarEstado);
  cargar();
}

function abrirAcerca() {
  if (acerca && !acerca.isDestroyed()) { acerca.focus(); return; }
  acerca = new BrowserWindow({
    parent: win, modal: true, width: 480, height: 340, resizable: false, minimizable: false, maximizable: false,
    title: "Acerca de VIP-C", icon: archivo("build/icon.png"), show: false, autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#171c12" : "#f6f7f3",
    webPreferences: { sandbox: true, contextIsolation: true, devTools: false }
  });
  acerca.setMenu(null);
  acerca.loadFile(archivo("acerca.html"));
  acerca.once("ready-to-show", () => {
    acerca.webContents.executeJavaScript(`document.getElementById("ver").textContent=${JSON.stringify(app.getVersion())};
      document.getElementById("url").textContent=${JSON.stringify(URL_APP.host)};`).catch(() => {});
    acerca.show();
  });
}

ipcMain.on("vipc:logo", (e) => {
  e.returnValue = "data:image/png;base64," + fs.readFileSync(archivo("build/logo.png")).toString("base64");
});
ipcMain.on("vipc:recargar", (e) => { if (win && e.sender === win.webContents) {
  if (win.webContents.getURL().startsWith("file:")) cargar(); else win.webContents.reload(); } });
ipcMain.on("vipc:acerca", (e) => { if (win && e.sender === win.webContents) abrirAcerca(); });

app.whenReady().then(() => {
  mostrarSplash();
  const s = session.fromPartition("persist:vipc");
  // Permisos solo para VIP-C: ubicación, pegar imágenes, notificaciones. Todo lo demás se niega.
  const OK = ["geolocation", "clipboard-read", "clipboard-sanitized-write", "notifications", "fullscreen"];
  s.setPermissionRequestHandler((wc, p, cb) => cb(esPropio(wc.getURL()) && OK.includes(p)));
  s.setPermissionCheckHandler((wc, p) => !!wc && esPropio(wc.getURL()) && OK.includes(p));
  Menu.setApplicationMenu(Menu.buildFromTemplate([   // invisible: solo mantiene los atajos de edición y zoom
    { label: "Editar", submenu: [{ role: "undo" }, { role: "redo" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "Ver", submenu: [{ role: "zoomIn" }, { role: "zoomIn", accelerator: "CommandOrControl+=", visible: false },
      { role: "zoomOut" }, { role: "resetZoom" }, { role: "togglefullscreen" }] }
  ]));
  crear();
});
app.on("window-all-closed", () => app.quit());
app.on("web-contents-created", (_e, wc) => wc.on("will-attach-webview", (e) => e.preventDefault()));
