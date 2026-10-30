// VIP-C escritorio: la página no recibe ningún acceso al sistema (sin Node). Solo se le indica que corre en la app.
const { contextBridge } = require("electron");
contextBridge.exposeInMainWorld("VIPC_ESCRITORIO", true);
