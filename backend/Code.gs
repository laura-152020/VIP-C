/**
 * VIP-C · Visor interactivo de puntos críticos — Backend v7.5 (Google Apps Script)
 * ----------------------------------------------------------
 * Un solo archivo. Guarda fotos en Drive, lee el sello de la foto con Gemini
 * y registra cada punto (con o sin foto) en Google Sheets. Expone los datos para ArcGIS.
 *
 * PROPIEDADES DEL SCRIPT (Configuración del proyecto → Propiedades del script):
 *   GEMINI_API_KEY   Clave de Google AI Studio (https://aistudio.google.com/apikey)
 *   GEMINI_MODEL     Opcional. Por defecto: gemini-3.5-flash-lite
 *   GEMINI_MODEL_PRECISO Opcional. Modelo para la relectura precisa de un sello dudoso (por defecto, el mismo GEMINI_MODEL con razonamiento)
 *   ROOT_FOLDER_ID   ID de la carpeta raíz en Drive donde se guardan las fotos
 *   SPREADSHEET_ID   ID del Google Sheet que funciona como base de datos
 *   APP_TOKEN        Opcional. Clave compartida con la página (la misma de config.js)
 *   ADMIN_TOKEN      Clave de administrador: anular registros y exportar a ArcGIS
 *   SESSION_SECRET   Se crea sola la primera vez. Si la cambias o la borras, se cierran todas las sesiones.
 *   DOMINIO_INSTITUCIONAL  Opcional. Por defecto antioquia.gov.co (esos correos se activan con un código)
 *   DURACION_EMPRESA Opcional. Cuánto dura la autorización de una empresa: "12 meses" (defecto), "90 dias", "1 hora", "30 minutos"
 *   CODIGO_EN_CADA_INGRESO  Opcional. SI (defecto) = código al correo en cada ingreso; NO = solo usuario y contraseña
 *   MODO_PRUEBA      Opcional. SI = permite probar con un Gmail usando tucorreo+gob@… y tucorreo+empX1@… (borrar al terminar)
 *   ADMIN_EMAIL      Opcional. A dónde llegan los avisos de solicitudes. Por defecto, el dueño del script
 *
 * USUARIOS (hoja "Usuarios" del mismo Sheet; se crea sola)
 *   Para dar de alta: escribe Usuario, Nombre y una contraseña en "ContraseñaNueva", con Activo = SI.
 *   En el primer ingreso (o al ejecutar actualizarUsuarios) la contraseña se cifra y se borra de la hoja.
 *   Para dar de baja: Activo = NO (la sesión abierta deja de funcionar de inmediato).
 *   Para cambiar una contraseña: escribe la nueva en "ContraseñaNueva".
 *   Registro propio (botón «Crear cuenta»): correos @antioquia.gov.co o de un dominio de la hoja «EmpresasAutorizadas»
 *   → Activo = VERIFICAR hasta confirmar el código que llega al correo (luego SI, automático).
 *   Correos personales (gmail, hotmail, outlook, yahoo…) → registro RECHAZADO de inmediato.
 *   Correo de una empresa que no está en la lista → la persona indica a su supervisor (@antioquia.gov.co); tras confirmar su correo,
 *   al supervisor le llega un correo con botones: aprobar a la persona, aprobar a toda la empresa (12 meses) o rechazar.
 *   Al vencer la empresa, se le pide la renovación al supervisor con otro botón. El administrador no interviene.
 *
 * EMPRESAS AUTORIZADAS (hoja «EmpresasAutorizadas»; se crea sola)
 *   Dominio (ej. consorciovial.com) · Empresa · Activo (SI/NO) · Vence (fecha de fin del contrato, opcional) · Notas.
 *   Al vencer o al poner NO, todos los usuarios de esa empresa pierden el acceso automáticamente (también las sesiones abiertas).
 *   Los correos personales (gmail, hotmail…) nunca se autorizan por dominio.
 *
 * ACCIONES (todas, salvo "login", exigen una sesión válida en el campo "sesion")
 *   POST {accion:"login", usuario, clave}                     → {token de sesión, nombre, expira}
 *   POST {accion:"registro", nombre, correo, entidad, usuario, clave} → institucional: envía código · otros: PENDIENTE
 *   POST {accion:"verificar", usuario, codigo} / {accion:"reenviar", usuario} → confirma el correo institucional
 *   POST {accion:"sesion", sesion}                            → confirma que la sesión sigue activa
 *   POST {accion:"leer",  sesion, base64, mimeType}           → datos del sello (no guarda nada)
 *   POST {accion:"subir", sesion, base64?, ...campos}         → guarda en Drive (si hay foto) + Sheets
 *   POST {accion:"anular", sesion, adminToken, id, motivo}    → marca el registro ANULADO y manda la foto a la papelera
 *   POST {accion:"puntos", sesion, buscar?}                   → puntos guardados (administradores: todos; los demás: los suyos)
 *   POST {accion:"eliminar", sesion, id | fid, motivo}        → borra el punto de ArcGIS (con copia en la hoja «Eliminados») y marca el registro ELIMINADO
 *   GET  ?accion=listar&admin=ADMIN_TOKEN&formato=json|geojson|csv → registros para ArcGIS
 *   GET  (sin parámetros)                                     → estado del servicio
 */

const HOJA = "Registro_VIPC";
const COLUMNAS = [
  "ID", "FechaRegistro", "FechaVisita", "FechaSello", "LatitudDMS", "LongitudDMS",
  "Latitud", "Longitud", "CodigoVia", "NombreTramo", "Subregion", "Municipio",
  "TipoAfectacion", "Responsable", "Estado", "Observaciones", "Origen",
  "Archivo", "FileId", "URL", "OrigenUbicacion", "SelloLegible", "FueraDeAntioquia",
  "EstadoRegistro", "FechaAnulacion", "MotivoAnulacion", "RegistradoPor", "ArcGIS_FID", "ArcGIS_Estado", "Vereda"
];
const HOJA_USUARIOS = "Usuarios";
const COLUMNAS_USUARIOS = ["Usuario", "Nombre", "Rol", "Activo", "ContraseñaNueva", "Hash", "Sal", "UltimoIngreso", "Correo", "Entidad", "Empresa", "Supervisor", "FechaSolicitud", "Vence"];
const ENTIDADES = ["Gobernación de Antioquia", "Empresa externa"];
const HOJA_EMPRESAS = "EmpresasAutorizadas";
const COLUMNAS_EMPRESAS = ["Dominio", "Empresa", "Activo", "Vence", "AutorizadaPor", "Notas"];
const OPCIONES_DURACION = ["1 dia", "30 dias", "12 meses"]; // lo que el supervisor puede elegir en el correo
const DURACION_EMPRESA_DEFECTO = "12 meses"; // cuánto dura la autorización de una empresa (propiedad DURACION_EMPRESA para cambiarla)
const MINUTOS_CODIGO_INGRESO = 10;           // vigencia del código que se pide en cada ingreso
const DIAS_ENLACE = 7;           // vigencia de los botones del correo al supervisor
const DOMINIOS_PERSONALES = ["gmail.com", "googlemail.com", "hotmail.com", "hotmail.es", "hotmail.co", "outlook.com", "outlook.es", "live.com", "live.com.co",
  "msn.com", "yahoo.com", "yahoo.es", "yahoo.com.co", "ymail.com", "icloud.com", "me.com", "mac.com", "protonmail.com", "proton.me",
  "aol.com", "gmx.com", "zoho.com", "mail.com", "yandex.com", "une.net.co", "etb.net.co", "tutanota.com"];
const MINUTOS_CODIGO = 30;       // vigencia del código de verificación enviado al correo
const HORAS_SESION = 8;
const INTENTOS_MAX = 5;          // intentos fallidos antes de bloquear
const MINUTOS_BLOQUEO = 15;
const RESPONSABLES = ["Gobernación", "Rentan", "Alcaldía", "Ciudadanía"];
const TIPOS_AFECTACION = ["Deslizamiento / movimiento en masa", "Pérdida de banca", "Hundimiento de la vía",
  "Socavación", "Obstrucción de drenaje o alcantarilla", "Daño en puente o pontón",
  "Daño en muro de contención", "Deterioro de la calzada (baches)", "Inundación", "Otro"];
const ESTADOS = ["Crítico", "No crítico"];
const ANTIOQUIA = { latMin: 5.40, latMax: 8.90, lonMin: -77.15, lonMax: -73.85 };

/* ======================= Entradas HTTP ======================= */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!p.accion) return json_({ status: "online", servicio: "VIP-C", version: "7.10.0", gemini: !!prop_("GEMINI_API_KEY", true) });
  if (p.accion === "decidir") return decidir_(p.t);
  try {
    // Exportación (ArcGIS): con la clave de administrador o con una sesión válida
    const admin = prop_("ADMIN_TOKEN", true);
    if (!(admin && p.admin === admin)) validarSesion_(p.sesion);
    if (p.accion === "listar") {
      const registros = listarRegistros_();
      if (p.formato === "csv") return ContentService.createTextOutput(aCSV_(registros)).setMimeType(ContentService.MimeType.CSV);
      if (p.formato === "geojson") return json_(aGeoJSON_(registros));
      return json_({ status: "success", total: registros.length, registros: registros });
    }
    return json_({ status: "error", message: "Acción no reconocida." });
  } catch (err) {
    return json_({ status: "error", message: err.message || String(err) });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error("Solicitud vacía.");
    const payload = JSON.parse(e.postData.contents);
    validarToken_(payload.token);
    if (payload.accion === "login") return json_(login_(payload));
    if (payload.accion === "registro") return json_(registro_(payload));
    if (payload.accion === "verificar") return json_(verificar_(payload));
    if (payload.accion === "reenviar") return json_(reenviarCodigo_(payload));
    if (payload.accion === "ingresoCodigo") return json_(ingresoCodigo_(payload));
    if (payload.accion === "reenviarIngreso") return json_(reenviarCodigoIngreso_(payload));
    const usuario = validarSesion_(payload.sesion);
    if (payload.accion === "sesion") return json_({ status: "success", usuario: usuario.usuario, nombre: usuario.nombre, rol: usuario.rol });
    if (payload.accion === "leer") return json_(leerSello_(payload));
    if (payload.accion === "ocrGoogle") return json_(ocrGoogle_(payload));
    if (payload.accion === "estadoIA") return json_(estadoIA_());
    if (payload.accion === "leerPdf") return json_(leerPdf_(payload));
    if (payload.accion === "leerFotos") return json_(leerFotos_(payload));
    if (payload.accion === "arcgis") return json_(consultarCapa_(payload));
    if (payload.accion === "subir") { payload.registradoPor = usuario.usuario; return json_(subirFoto_(payload)); }
    if (payload.accion === "anular") return json_(anularRegistro_(payload));
    if (payload.accion === "puntos") return json_(puntosGuardados_(payload, usuario));
    if (payload.accion === "eliminar") return json_(eliminarPunto_(payload, usuario));
    throw new Error("Acción no reconocida.");
  } catch (err) {
    return json_({ status: err.sinSesion ? "sin_sesion" : "error", message: err.message || String(err) });
  }
}

/* ======================= Usuarios y sesiones ======================= */

function hojaUsuarios_() {
  const ss = SpreadsheetApp.openById(prop_("SPREADSHEET_ID"));
  let h = ss.getSheetByName(HOJA_USUARIOS);
  if (!h) h = ss.insertSheet(HOJA_USUARIOS);
  if (h.getLastRow() === 0) {
    h.appendRow(COLUMNAS_USUARIOS);
    h.getRange(1, 1, 1, COLUMNAS_USUARIOS.length).setFontWeight("bold");
    h.setFrozenRows(1);
  }
  return h;
}

// Encabezados tolerantes: sin importar mayúsculas, tildes, espacios o la forma de la ñ
function claveEncabezado_(c) {
  return String(c || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}
const ALIAS_USUARIOS = {
  usuario: "Usuario", user: "Usuario", nombre: "Nombre", rol: "Rol", activo: "Activo",
  contrasenanueva: "ContraseñaNueva", contrasena: "ContraseñaNueva", clave: "ContraseñaNueva", clavenueva: "ContraseñaNueva", password: "ContraseñaNueva",
  hash: "Hash", sal: "Sal", ultimoingreso: "UltimoIngreso",
  correo: "Correo", email: "Correo", correoelectronico: "Correo", entidad: "Entidad", fechasolicitud: "FechaSolicitud", empresa: "Empresa", supervisor: "Supervisor", vence: "Vence"
};

function leerUsuarios_() {
  const h = hojaUsuarios_();
  // Encabezados que falten (Hash, Sal, UltimoIngreso...) se agregan al final
  let enc = h.getRange(1, 1, 1, Math.max(h.getLastColumn(), 1)).getValues()[0];
  const tiene = {}; enc.forEach(function (c) { const k = ALIAS_USUARIOS[claveEncabezado_(c)]; if (k) tiene[k] = true; });
  COLUMNAS_USUARIOS.forEach(function (c) {
    if (!tiene[c]) { h.getRange(1, enc.length + 1).setValue(c).setFontWeight("bold"); enc.push(c); tiene[c] = true; }
  });
  const rango = h.getDataRange();
  const datos = rango.getValues();
  const texto = rango.getDisplayValues(); // la contraseña tal como se ve (sin que Sheets la convierta en número o fecha)
  const col = {};
  datos[0].forEach(function (c, i) { const k = ALIAS_USUARIOS[claveEncabezado_(c)]; if (k && col[k] === undefined) col[k] = i; });
  return { h: h, col: col, filas: datos.slice(1).map(function (f, i) { return { fila: i + 2, v: f, t: texto[i + 1] }; }) };
}

function cifrar_(clave, sal) {
  // SHA-256 con sal, 2000 rondas
  let d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sal + "|" + clave, Utilities.Charset.UTF_8);
  for (let i = 0; i < 2000; i++) d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, d.concat(Utilities.newBlob(sal).getBytes()));
  return "h1$" + Utilities.base64Encode(d); // prefijo: evita que Sheets lo tome como fórmula (+, -, =)
}

// Escribe un texto literal en una celda (sin que Sheets lo interprete como fórmula, fecha o número)
function escribirTexto_(h, fila, col, valor) {
  h.getRange(fila, col).setNumberFormat("@").setValue(celda_(valor));
}
// Evita que un texto escrito por un usuario se ejecute como fórmula en el Sheet (=, +, -, @)
function celda_(v) { const t = texto_(v); return /^[=+\-@\t\r]/.test(t) ? "'" + t : t; }

// Cifra las contraseñas escritas en "ContraseñaNueva" y las borra de la hoja.
function actualizarUsuarios() {
  const u = leerUsuarios_();
  let n = 0;
  u.filas.forEach(function (r) {
    const nueva = String(r.t[u.col["ContraseñaNueva"]] || "").trim();
    if (!nueva) return;
    const sal = Utilities.getUuid();
    escribirTexto_(u.h, r.fila, u.col["Hash"] + 1, cifrar_(nueva, sal));
    escribirTexto_(u.h, r.fila, u.col["Sal"] + 1, sal);
    u.h.getRange(r.fila, u.col["ContraseñaNueva"] + 1).setValue("");
    if (!texto_(r.v[u.col["Activo"]])) u.h.getRange(r.fila, u.col["Activo"] + 1).setValue("SI");
    n++;
  });
  Logger.log(n + " contraseña(s) cifradas.");
  return n;
}

const normUsuario_ = function (s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim(); };

// Busca por usuario o, si no hay coincidencia, por nombre completo
function buscarUsuario_(usuario) {
  const u = leerUsuarios_();
  const k = normUsuario_(usuario);
  if (!k) return null;
  const arma = function (r) {
    return {
      u: u, fila: r.fila, usuario: texto_(r.t[u.col["Usuario"]]), nombre: texto_(r.t[u.col["Nombre"]]),
      rol: texto_(r.t[u.col["Rol"]]) || "usuario", correo: texto_(r.t[u.col["Correo"]]),
      empresa: texto_(r.t[u.col["Empresa"]]), supervisor: texto_(r.t[u.col["Supervisor"]]).toLowerCase(),
      vence: u.col["Vence"] === undefined ? null : fechaVence_(r.v[u.col["Vence"]], r.t[u.col["Vence"]]),
      activo: ["SI", "SÍ", "S", "TRUE", "VERDADERO", "1", "X"].indexOf(normUsuario_(r.t[u.col["Activo"]]).toUpperCase()) >= 0,
      estado: normUsuario_(r.t[u.col["Activo"]]).toUpperCase(),
      nueva: String(r.t[u.col["ContraseñaNueva"]] || "").trim(), hash: texto_(r.t[u.col["Hash"]]), sal: texto_(r.t[u.col["Sal"]])
    };
  };
  for (let i = 0; i < u.filas.length; i++) if (normUsuario_(u.filas[i].t[u.col["Usuario"]]) === k) return arma(u.filas[i]);
  for (let i = 0; i < u.filas.length; i++) if (u.col["Correo"] !== undefined && normUsuario_(u.filas[i].t[u.col["Correo"]]) === k) return arma(u.filas[i]);
  for (let i = 0; i < u.filas.length; i++) if (normUsuario_(u.filas[i].t[u.col["Nombre"]]) === k) return arma(u.filas[i]);
  return null;
}

function login_(p) {
  const usuario = texto_(p.usuario), clave = String(p.clave || "").trim();
  if (!usuario || !clave) return { status: "error", message: "Escribe tu usuario y tu contraseña." };

  const cache = CacheService.getScriptCache();
  const kFallos = "fallos_" + normUsuario_(usuario);
  const fallos = Number(cache.get(kFallos) || 0);
  if (fallos >= INTENTOS_MAX) return { status: "error", message: "Demasiados intentos fallidos. Espera " + MINUTOS_BLOQUEO + " minutos e intenta de nuevo." };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let u;
  try {
    u = buscarUsuario_(usuario);
    if (u && u.nueva) { actualizarUsuarios(); u = buscarUsuario_(usuario); } // contraseña recién asignada
  } finally { lock.releaseLock(); }

  const claveOk = u && u.hash && u.sal && cifrar_(clave, u.sal) === u.hash;
  if (!claveOk) {
    cache.put(kFallos, String(fallos + 1), MINUTOS_BLOQUEO * 60);
    return { status: "error", message: "Usuario o contraseña incorrectos." };
  }
  cache.remove(kFallos);
  // La contraseña es correcta: ahora sí se puede decir en qué estado está la cuenta
  if (!u.activo) {
    if (u.estado === "VERIFICAR") return { status: "verificar", usuario: u.usuario, correo: ocultarCorreo_(u.correo), message: "Confirma tu correo con el código que te enviamos." };
    if (u.estado === "PENDIENTE") return { status: "error", message: u.supervisor
      ? "Tu supervisor (" + ocultarCorreo_(u.supervisor) + ") aún no ha aprobado tu acceso. Recibió un correo con un botón para aprobarlo."
      : "Tu solicitud está pendiente de aprobación. Podrás ingresar cuando un administrador la active." };
    return { status: "error", message: "Tu cuenta no está activa. Habla con el administrador." };
  }
  const bloqueo = bloqueoPorEmpresa_(u);
  if (bloqueo) return { status: "error", message: bloqueo };
  // Verificación en dos pasos: código al correo en cada ingreso (las cuentas sin correo entran solo con contraseña)
  if (dosPasos_() && u.correo) {
    enviarCodigoIngreso_(u);
    return { status: "codigo", usuario: u.usuario, correo: ocultarCorreo_(u.correo), message: "Te enviamos un código de ingreso a tu correo." };
  }
  return abrirSesion_(u);
}

function dosPasos_() { return String(prop_("CODIGO_EN_CADA_INGRESO", true) || "SI").toUpperCase() !== "NO"; }

function abrirSesion_(u) {
  u.u.h.getRange(u.fila, u.u.col["UltimoIngreso"] + 1).setValue(Utilities.formatDate(new Date(), "America/Bogota", "yyyy-MM-dd HH:mm:ss"));
  const expira = Date.now() + HORAS_SESION * 3600 * 1000;
  return { status: "success", sesion: firmarSesion_({ u: u.usuario, exp: expira }), usuario: u.usuario, nombre: u.nombre || u.usuario, rol: u.rol, expira: expira };
}

function enviarCodigoIngreso_(u) {
  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  CacheService.getScriptCache().put("ingreso_" + normUsuario_(u.usuario), JSON.stringify({ c: cifrar_(codigo, u.usuario), n: 0 }), MINUTOS_CODIGO_INGRESO * 60);
  MailApp.sendEmail({
    to: u.correo,
    subject: "VIP-C · Código de ingreso: " + codigo,
    body: "Hola " + u.nombre + ",\n\nTu código para ingresar a VIP-C es:\n\n    " + codigo +
      "\n\nVence en " + MINUTOS_CODIGO_INGRESO + " minutos. Si no fuiste tú quien intentó ingresar, cambia tu contraseña: alguien la conoce.\n\nGobernación de Antioquia · Secretaría de Infraestructura Física"
  });
}

// Segundo paso del ingreso: valida el código y abre la sesión
function ingresoCodigo_(p) {
  const usuario = texto_(p.usuario), codigo = texto_(p.codigo).replace(/\D/g, "");
  const cache = CacheService.getScriptCache(), k = "ingreso_" + normUsuario_(usuario);
  const dato = cache.get(k);
  if (!dato) return { status: "error", vencido: true, message: "El código venció. Vuelve a ingresar tu usuario y contraseña." };
  const d = JSON.parse(dato);
  if (d.n >= 5) { cache.remove(k); return { status: "error", vencido: true, message: "Demasiados intentos con el código. Vuelve a ingresar tu usuario y contraseña." }; }
  const u = buscarUsuario_(usuario);
  if (!u || cifrar_(codigo, u.usuario) !== d.c) {
    d.n++; cache.put(k, JSON.stringify(d), MINUTOS_CODIGO_INGRESO * 60);
    return { status: "error", message: "Código incorrecto. Revisa el correo e intenta de nuevo." };
  }
  cache.remove(k);
  if (!u.activo) return { status: "error", message: "Tu cuenta no está activa." };
  const bloqueo = bloqueoPorEmpresa_(u);
  if (bloqueo) return { status: "error", message: bloqueo };
  return abrirSesion_(u);
}

function reenviarCodigoIngreso_(p) {
  const usuario = texto_(p.usuario);
  const cache = CacheService.getScriptCache();
  if (!cache.get("ingreso_" + normUsuario_(usuario))) return { status: "error", vencido: true, message: "Vuelve a ingresar tu usuario y contraseña para recibir un código nuevo." };
  if (cache.get("reenvio_ing_" + normUsuario_(usuario))) return { status: "error", message: "Espera un minuto antes de pedir otro código." };
  const u = buscarUsuario_(usuario);
  if (!u || !u.correo) return { status: "error", message: "No se pudo reenviar el código." };
  cache.put("reenvio_ing_" + normUsuario_(usuario), "1", 60);
  enviarCodigoIngreso_(u);
  return { status: "success", message: "Te enviamos un código nuevo." };
}

/* ======================= Registro de usuarios ======================= */
// Correos de la Gobernación o de una empresa autorizada: se activan al confirmar un código enviado al correo.
// Correo personal: rechazado. Empresa no autorizada: queda PENDIENTE hasta que un administrador escriba SI.

function dominioInstitucional_() { return (prop_("DOMINIO_INSTITUCIONAL", true) || "antioquia.gov.co").toLowerCase().replace(/^@/, ""); }
function correoAdmin_() { return prop_("ADMIN_EMAIL", true) || Session.getEffectiveUser().getEmail(); }
/* ---------- Modo prueba (propiedad MODO_PRUEBA = SI) ----------
 * Permite probar con un solo Gmail usando direcciones con "+":
 *   tucorreo+gob@gmail.com       → se trata como correo de la Gobernación
 *   tucorreo+empnorte1@gmail.com → se trata como empleado de la empresa "empnorte" (empnorte.prueba)
 *   tucorreo@gmail.com           → correo personal (bloqueado)
 * Los correos llegan igual a la bandeja de tucorreo@gmail.com. Borra la propiedad al terminar las pruebas. */
function modoPrueba_() { return String(prop_("MODO_PRUEBA", true) || "").toUpperCase() === "SI"; }
function efectivo_(correo) {
  const c = String(correo || "").toLowerCase().trim();
  if (!modoPrueba_()) return c;
  const m = c.match(/^([^@+]+)\+(gob|emp[a-z]+)[0-9]*@(gmail\.com|googlemail\.com|outlook\.com|hotmail\.com|live\.com)$/);
  if (!m) return c;
  return m[2] === "gob" ? m[1] + "@" + dominioInstitucional_() : m[1] + "@" + m[2] + ".prueba";
}
function dominioDe_(correo) { return (efectivo_(correo).split("@")[1] || "").toLowerCase(); }

function terminaEnDominio_(correo, d) {
  const c = efectivo_(correo); d = String(d || "").toLowerCase().trim().replace(/^@/, "");
  return !!d && (c.slice(-(d.length + 1)) === "@" + d || c.slice(-(d.length + 1)) === "." + d); // incluye subdominios
}
function esInstitucional_(correo) { return terminaEnDominio_(correo, dominioInstitucional_()); }
function esPersonal_(correo) { return DOMINIOS_PERSONALES.some(function (d) { return terminaEnDominio_(correo, d); }); }

function hojaEmpresas_() {
  const ss = SpreadsheetApp.openById(prop_("SPREADSHEET_ID"));
  let h = ss.getSheetByName(HOJA_EMPRESAS);
  if (!h) h = ss.insertSheet(HOJA_EMPRESAS);
  if (h.getLastRow() === 0) {
    h.appendRow(COLUMNAS_EMPRESAS);
    h.getRange(1, 1, 1, COLUMNAS_EMPRESAS.length).setFontWeight("bold");
    h.setFrozenRows(1);
  } else {
    // Hoja de una versión anterior: agrega la columna Vence (u otras) si falta
    const enc = h.getRange(1, 1, 1, Math.max(h.getLastColumn(), 1)).getValues()[0].map(claveEncabezado_);
    COLUMNAS_EMPRESAS.forEach(function (c) {
      if (enc.indexOf(claveEncabezado_(c)) < 0) { h.getRange(1, enc.length + 1).setValue(c).setFontWeight("bold"); enc.push(claveEncabezado_(c)); }
    });
  }
  return h;
}

// Duración de la autorización de una empresa: "30 minutos", "1 hora", "90 dias", "12 meses" (también 30m, 1h, 90d, 12M)
function duracionEmpresa_(texto) {
  const crudo = String(texto || prop_("DURACION_EMPRESA", true) || DURACION_EMPRESA_DEFECTO);
  const t = normUsuario_(crudo);
  const m = t.match(/^(\d+)\s*([a-z]*)/);
  const n = m ? Math.max(1, Number(m[1])) : 12, u = m ? m[2] : "meses";
  if (/^min|^m$/.test(u) && !/M$/.test(crudo.trim())) return { min: n, etiqueta: n + (n === 1 ? " minuto" : " minutos") };
  if (/^h/.test(u)) return { min: n * 60, etiqueta: n + (n === 1 ? " hora" : " horas") };
  if (/^d/.test(u)) return { min: n * 1440, etiqueta: n + (n === 1 ? " día" : " días") };
  return { meses: n, etiqueta: n + (n === 1 ? " mes" : " meses") };
}
function calcularVence_(texto) {
  const d = duracionEmpresa_(texto), v = new Date();
  if (d.meses) { v.setHours(0, 0, 0, 0); v.setMonth(v.getMonth() + d.meses); } // vence al final de ese día
  else v.setTime(v.getTime() + d.min * 60000);                                 // vence a la hora exacta
  return v;
}
function textoVence_(v) {
  const conHora = v.getHours() || v.getMinutes() || v.getSeconds();
  return Utilities.formatDate(v, "America/Bogota", conHora ? "dd/MM/yyyy 'a las' HH:mm" : "dd/MM/yyyy");
}

// Fecha de la columna Vence: fecha de Sheets (con o sin hora), AAAA-MM-DD [HH:mm] o DD/MM/AAAA [HH:mm]. Vacía = sin vencimiento.
function fechaVence_(valor, texto) {
  if (valor instanceof Date && !isNaN(valor)) return valor;
  const t = String(texto || valor || "").trim();
  const hora = t.match(/(\d{1,2}):(\d{2})/);
  const h = hora ? Number(hora[1]) : 0, mi = hora ? Number(hora[2]) : 0;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, mi);
  m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), h, mi);
  return null;
}
// Sin hora (00:00) = vigente hasta el final de ese día; con hora = hasta ese minuto exacto
function sigueVigente_(vence) {
  if (!vence) return true;
  const fin = new Date(vence.getTime());
  if (!fin.getHours() && !fin.getMinutes() && !fin.getSeconds()) fin.setDate(fin.getDate() + 1);
  return Date.now() < fin.getTime();
}

// Estado de la empresa a la que pertenece un correo, según la hoja EmpresasAutorizadas.
// { listada: el dominio aparece en la hoja, vigente: Activo = SI y no ha vencido, empresa: nombre }
function estadoEmpresa_(correo) {
  const h = hojaEmpresas_();
  const r = h.getDataRange(), vals = r.getValues(), txt = r.getDisplayValues();
  const col = {}; vals[0].forEach(function (c, i) { col[claveEncabezado_(c)] = i; });
  const iDom = col["dominio"], iEmp = col["empresa"], iAct = col["activo"], iVen = col["vence"], iAut = col["autorizadapor"];
  let listada = null;
  for (let i = 1; i < vals.length; i++) {
    const dom = texto_(txt[i][iDom]);
    if (!dom || DOMINIOS_PERSONALES.indexOf(dom.replace(/^@/, "").toLowerCase()) >= 0 || !terminaEnDominio_(correo, dom)) continue;
    const activo = ["SI", "SÍ", "S", "X", "1", "TRUE", "VERDADERO"].indexOf(normUsuario_(txt[i][iAct]).toUpperCase()) >= 0;
    const vence = iVen === undefined ? null : fechaVence_(vals[i][iVen], txt[i][iVen]);
    const vigente = activo && sigueVigente_(vence);
    const e = { listada: true, vigente: vigente, empresa: texto_(txt[i][iEmp]) || dom, dominio: dom.replace(/^@/, "").toLowerCase(),
      autorizadaPor: iAut === undefined ? "" : texto_(txt[i][iAut]).toLowerCase() };
    if (vigente) return e;
    listada = listada || e;
  }
  return listada || { listada: false, vigente: false, empresa: "" };
}
// Devuelve el nombre de la empresa si el dominio del correo está autorizado y vigente; si no, ""
function empresaAutorizada_(correo) { const e = estadoEmpresa_(correo); return e.vigente ? e.empresa : ""; }

// Si el usuario es de una empresa listada cuyo acceso venció o se desactivó, devuelve el mensaje de bloqueo
function bloqueoPorEmpresa_(u) {
  if (!u || !u.correo || esInstitucional_(u.correo)) return "";
  // 1) Vencimiento individual (aprobación «solo a esta persona»)
  if (u.vence && !sigueVigente_(u.vence)) {
    if (esInstitucional_(u.supervisor)) {
      const cache = CacheService.getScriptCache(), k = "renovp_" + normUsuario_(u.usuario);
      if (!cache.get(k)) { cache.put(k, "1", 86400); try { pedirRenovacionPersona_(u); } catch (_) {} }
      return "Tu acceso a VIP-C venció. Le enviamos a tu supervisor (" + ocultarCorreo_(u.supervisor) + ") un correo para renovarlo.";
    }
    return "Tu acceso a VIP-C venció. Habla con tu supervisor en la Gobernación.";
  }
  if (u.vence) return ""; // aprobación individual vigente: no depende de la empresa
  const e = estadoEmpresa_(u.correo);
  if (!e.listada || e.vigente) return "";
  // Pide la renovación al supervisor que autorizó la empresa (máximo un correo al día por empresa)
  const sup = esInstitucional_(e.autorizadaPor) ? e.autorizadaPor : (esInstitucional_(u.supervisor) ? u.supervisor : "");
  if (sup) {
    const cache = CacheService.getScriptCache(), k = "renov_" + e.dominio;
    if (!cache.get(k)) { cache.put(k, "1", 86400); try { pedirRenovacion_(e, sup, u); } catch (_) {} }
    return "El acceso de " + e.empresa + " a VIP-C venció. Le enviamos a " + ocultarCorreo_(sup) + " un correo para renovarlo.";
  }
  return "El acceso de " + e.empresa + " a VIP-C venció o fue desactivado. Habla con tu supervisor en la Gobernación.";
}
// Quién puede activarse solo con el código del correo
function puedeAutoactivarse_(correo) { return esInstitucional_(correo) || !!empresaAutorizada_(correo); }
function ocultarCorreo_(c) { c = String(c || ""); const i = c.indexOf("@"); return i > 1 ? c[0] + "•••" + c.slice(i - 1) : c; }

function registro_(p) {
  const nombre = texto_(p.nombre), correo = texto_(p.correo).toLowerCase(), entidad = texto_(p.entidad), empresa = texto_(p.empresa);
  const usuario = texto_(p.usuario).toLowerCase(), clave = String(p.clave || "");
  const supervisor = texto_(p.supervisor).toLowerCase();
  const faltan = [];
  if (nombre.length < 5) faltan.push("tu nombre completo");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo)) faltan.push("un correo válido");
  const esGob = esInstitucional_(correo); // con correo institucional no importa lo que marque
  if (!esGob && ENTIDADES.indexOf(entidad) < 0) faltan.push("si eres de la Gobernación o de una empresa externa");
  if (!esGob && entidad === "Empresa externa" && empresa.length < 2) faltan.push("el nombre de tu empresa");
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) faltan.push("un usuario de 3 a 30 caracteres (letras, números, punto o guion, sin espacios)");
  if (clave.length < 8 || !/[a-zA-Z]/.test(clave) || !/\d/.test(clave)) faltan.push("una contraseña de al menos 8 caracteres con letras y números");
  if (faltan.length) return { status: "error", message: "Revisa: " + faltan.join("; ") + "." };

  // Restricción: los correos personales no pueden registrarse (solo Gobernación y empresas)
  if (esPersonal_(correo)) {
    return { status: "error", bloqueado: true, message: "VIP-C es solo para personal de la Gobernación de Antioquia y empresas autorizadas. Regístrate con tu correo institucional o el de tu empresa (no se aceptan Gmail, Hotmail, Outlook, Yahoo ni similares)." };
  }

  // Freno contra registros masivos: máximo 30 por hora
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get("registros_hora") || 0);
  if (n >= 30) return { status: "error", message: "Hay muchas solicitudes en este momento. Intenta de nuevo en una hora." };

  const institucional = esInstitucional_(correo);
  const empresaOk = !institucional ? empresaAutorizada_(correo) : "";
  const autoactiva = institucional || !!empresaOk;
  const manual = !autoactiva && permiteSolicitudes_(); // modo antiguo: aprueba el administrador
  if (!autoactiva && !manual) {
    if (!supervisor) return { status: "error", necesitaSupervisor: true, message: "La empresa @" + dominioDe_(correo) + " aún no está autorizada. Escribe el correo de tu supervisor en la Gobernación (@" + dominioInstitucional_() + ") para que apruebe tu acceso." };
    if (!esInstitucional_(supervisor) || !/^[^\s@]+@[^\s@]+$/.test(supervisor)) return { status: "error", necesitaSupervisor: true, message: "El supervisor debe tener correo @" + dominioInstitucional_() + "." };
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const u = leerUsuarios_();
    const existe = u.filas.some(function (r) {
      return normUsuario_(r.t[u.col["Usuario"]]) === usuario || (correo && normUsuario_(r.t[u.col["Correo"]]) === correo);
    });
    if (existe) return { status: "error", message: "Ese usuario o ese correo ya están registrados. Si es tuyo, ingresa o pide ayuda al administrador." };

    const sal = Utilities.getUuid();
    const fila = u.h.getLastRow() + 1;
    const valores = {
      Usuario: usuario, Nombre: nombre, Rol: "usuario", Activo: manual ? "PENDIENTE" : "VERIFICAR",
      Hash: cifrar_(clave, sal), Sal: sal, Correo: correo, Entidad: institucional ? "Gobernación de Antioquia" : "Empresa externa",
      Empresa: institucional ? "" : (empresaOk || empresa), Supervisor: autoactiva ? "" : supervisor,
      FechaSolicitud: Utilities.formatDate(new Date(), "America/Bogota", "yyyy-MM-dd HH:mm:ss")
    };
    Object.keys(valores).forEach(function (k) { if (u.col[k] !== undefined) escribirTexto_(u.h, fila, u.col[k] + 1, valores[k]); });
  } finally { lock.releaseLock(); }
  cache.put("registros_hora", String(n + 1), 3600);

  if (!manual) {
    // Gobernación, empresa autorizada o externo con supervisor: primero confirma su correo con el código
    enviarCodigo_(usuario, correo, nombre);
    return { status: "verificar", usuario: usuario, correo: ocultarCorreo_(correo), message: "Te enviamos un código a tu correo." };
  }
  avisarAdmin_(nombre, correo, entidad, usuario, empresa);
  return { status: "pendiente", message: "Solicitud enviada. Un administrador debe aprobarla; podrás ingresar cuando la active." };
}

// Por defecto no hay solicitudes manuales: solo Gobernación y empresas autorizadas.
// Para volver a recibir solicitudes de empresas no listadas, crea la propiedad PERMITIR_SOLICITUDES = SI.
function permiteSolicitudes_() { return String(prop_("PERMITIR_SOLICITUDES", true) || "").toUpperCase() === "SI"; }
function noAutorizado_(correo) {
  return { status: "error", bloqueado: true, message: "El correo @" + dominioDe_(correo) + " no está autorizado para VIP-C. Si tu empresa tiene contrato con la Gobernación de Antioquia, pide a tu supervisor que la autorice." };
}

function enviarCodigo_(usuario, correo, nombre) {
  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  CacheService.getScriptCache().put("verif_" + usuario, JSON.stringify({ c: cifrar_(codigo, usuario), n: 0 }), MINUTOS_CODIGO * 60);
  MailApp.sendEmail({
    to: correo,
    subject: "VIP-C · Código de verificación: " + codigo,
    body: "Hola " + nombre + ",\n\nTu código para activar tu cuenta en VIP-C (Visor interactivo de puntos críticos) es:\n\n    " + codigo +
      "\n\nVence en " + MINUTOS_CODIGO + " minutos. Si no solicitaste esta cuenta, ignora este mensaje.\n\nGobernación de Antioquia · Secretaría de Infraestructura Física"
  });
}

function avisarAdmin_(nombre, correo, entidad, usuario, empresa) {
  let url = "";
  try { url = SpreadsheetApp.openById(prop_("SPREADSHEET_ID")).getUrl(); } catch (_) { /* sin link, el aviso igual sale */ }
  try {
    MailApp.sendEmail({
      to: correoAdmin_(),
      subject: "VIP-C · Nueva solicitud de acceso: " + nombre,
      body: "Hay una nueva solicitud de acceso a VIP-C:\n\n" +
        "Nombre: " + nombre + "\nCorreo: " + correo + "\nDice ser de: " + entidad + (empresa ? " · " + empresa : "") + "\nUsuario: " + usuario +
        (esPersonal_(correo) ? "\n\n⚠ Es un correo PERSONAL (no institucional ni de empresa). Verifica la identidad antes de aprobar." :
          entidad === "Gobernación de Antioquia" ? "\n\n⚠ Dice ser de la Gobernación pero no usa un correo @" + dominioInstitucional_() + "." :
          "\n\nLa empresa no está en la hoja «" + HOJA_EMPRESAS + "». Si la autorizas, agrega su dominio (" + dominioDe_(correo) + ") y sus empleados podrán entrar solos con código.") +
        "\n\nPara aprobar esta solicitud, abre la hoja «Usuarios» y cambia PENDIENTE por SI en la columna Activo. Para rechazarla, escribe NO.\n\n" + url
    });
  } catch (_) { /* si falla el correo, la solicitud igual queda en la hoja */ }
}

function verificar_(p) {
  const usuario = texto_(p.usuario).toLowerCase(), codigo = texto_(p.codigo).replace(/\D/g, "");
  const cache = CacheService.getScriptCache();
  const dato = cache.get("verif_" + usuario);
  if (!dato) return { status: "error", vencido: true, message: "El código venció o no existe. Pide uno nuevo." };
  const d = JSON.parse(dato);
  if (d.n >= 5) return { status: "error", vencido: true, message: "Demasiados intentos con el código. Pide uno nuevo." };
  if (cifrar_(codigo, usuario) !== d.c) {
    d.n++; cache.put("verif_" + usuario, JSON.stringify(d), MINUTOS_CODIGO * 60);
    return { status: "error", message: "Código incorrecto. Revisa el correo e intenta de nuevo." };
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const u = buscarUsuario_(usuario);
    if (!u || u.estado !== "VERIFICAR") return { status: "error", message: "Esta cuenta no está esperando verificación." };
    cache.remove("verif_" + usuario);
    if (puedeAutoactivarse_(u.correo)) {
      u.u.h.getRange(u.fila, u.u.col["Activo"] + 1).setValue("SI");
      return { status: "success", message: "Correo confirmado. Ya puedes ingresar." };
    }
    u.u.h.getRange(u.fila, u.u.col["Activo"] + 1).setValue("PENDIENTE");
    if (u.supervisor) {
      pedirAprobacion_(u);
      return { status: "pendiente_supervisor", supervisor: ocultarCorreo_(u.supervisor),
        message: "Correo confirmado. Le enviamos a tu supervisor (" + ocultarCorreo_(u.supervisor) + ") un correo para aprobar tu acceso. Te avisaremos por correo cuando lo haga." };
    }
    return { status: "pendiente", message: "Correo confirmado. Tu solicitud queda pendiente de aprobación." };
  } finally { lock.releaseLock(); }
}

function reenviarCodigo_(p) {
  const usuario = texto_(p.usuario).toLowerCase();
  const cache = CacheService.getScriptCache();
  if (cache.get("reenvio_" + usuario)) return { status: "error", message: "Espera un minuto antes de pedir otro código." };
  const u = buscarUsuario_(usuario);
  if (!u || u.estado !== "VERIFICAR" || !u.correo) return { status: "error", message: "Esta cuenta no está esperando verificación." };
  cache.put("reenvio_" + usuario, "1", 60);
  enviarCodigo_(u.usuario, u.correo, u.nombre);
  return { status: "success", correo: ocultarCorreo_(u.correo), message: "Te enviamos un código nuevo." };
}

/* ======================= Aprobación por el supervisor (un clic en el correo) ======================= */

function urlServicio_() {
  const p = prop_("WEBAPP_URL", true);
  if (p) return p;
  try { return ScriptApp.getService().getUrl(); } catch (_) { return ""; }
}
function enlace_(datos) {
  datos.k = "d"; datos.exp = Date.now() + DIAS_ENLACE * 86400000;
  return urlServicio_() + "?accion=decidir&t=" + encodeURIComponent(firmarSesion_(datos));
}
function boton_(texto, url, color) {
  return '<a href="' + url + '" style="display:inline-block;margin:6px 8px 6px 0;padding:12px 18px;border-radius:6px;background:' + color +
    ';color:#fff;text-decoration:none;font:600 15px Arial,sans-serif">' + texto + '</a>';
}
function esc_(t) { return String(t || "").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

function pedirAprobacion_(u) {
  const dom = dominioDe_(u.correo);
  const base = { u: u.usuario, sup: u.supervisor };
  const html = '<div style="font:15px/1.5 Arial,sans-serif;color:#1b231e;max-width:560px">' +
    '<h2 style="margin:0 0 8px">Solicitud de acceso a VIP-C</h2>' +
    '<p><b>' + esc_(u.nombre) + '</b> (' + esc_(u.correo) + '), de <b>' + esc_(u.empresa || dom) + '</b>, pide acceso a VIP-C – Visor interactivo de puntos críticos, y te indicó como su supervisor en la Gobernación.</p>' +
    '<p>Su correo ya fue verificado. Elige a quién das acceso y por cuánto tiempo:</p>' +
    '<p style="margin:14px 0 2px"><b>Solo a ' + esc_(u.nombre) + ':</b></p>' +
    botonesDuracion_(Object.assign({ d: "persona" }, base), "#0b7a3e") +
    '<p style="margin:14px 0 2px"><b>A toda la empresa</b> (cualquier persona con correo @' + esc_(dom) + '):</p>' +
    botonesDuracion_(Object.assign({ d: "empresa" }, base), "#1c4220") +
    '<p style="margin:14px 0 2px"><b>No dar acceso:</b></p>' +
    boton_("Rechazar", enlace_(Object.assign({ d: "rechazar" }, base)), "#b3261e") +
    '<p style="color:#5b675f;font-size:13px">Al vencer el tiempo, el acceso se cierra solo y te llegará un correo por si quieres renovarlo. ' +
    'Los botones funcionan durante ' + DIAS_ENLACE + ' días. Si no conoces a esta persona, toca Rechazar.</p>' +
    '<p style="color:#5b675f;font-size:13px">Gobernación de Antioquia · Secretaría de Infraestructura Física</p></div>';
  MailApp.sendEmail({ to: u.supervisor, subject: "VIP-C · " + u.nombre + " (" + (u.empresa || dom) + ") pide acceso", htmlBody: html,
    body: u.nombre + " (" + u.correo + ") pide acceso a VIP-C. Abre este correo en un programa que muestre HTML para aprobar o rechazar." });
}

function botonesDuracion_(base, color) {
  return OPCIONES_DURACION.map(function (dur) {
    return boton_(duracionEmpresa_(dur).etiqueta, enlace_(Object.assign({ dur: dur }, base)), color);
  }).join("");
}

function pedirRenovacion_(e, sup, u) {
  const html = '<div style="font:15px/1.5 Arial,sans-serif;color:#1b231e;max-width:560px">' +
    '<h2 style="margin:0 0 8px">Renovar acceso de ' + esc_(e.empresa) + ' a VIP-C</h2>' +
    '<p>La autorización de <b>' + esc_(e.empresa) + '</b> (@' + esc_(e.dominio) + ') venció. ' + esc_(u.nombre) + ' intentó ingresar y no pudo.</p>' +
    '<p style="margin:14px 0 2px"><b>Renovar a toda la empresa por:</b></p>' +
    botonesDuracion_({ d: "renovar", dom: e.dominio, sup: sup }, "#0b7a3e") +
    '<p style="color:#5b675f;font-size:13px">Si el contrato terminó, no hagas nada: el acceso seguirá cerrado.</p></div>';
  MailApp.sendEmail({ to: sup, subject: "VIP-C · Renovar acceso de " + e.empresa, htmlBody: html, body: "La autorización de " + e.empresa + " en VIP-C venció." });
}

function pedirRenovacionPersona_(u) {
  const html = '<div style="font:15px/1.5 Arial,sans-serif;color:#1b231e;max-width:560px">' +
    '<h2 style="margin:0 0 8px">Renovar acceso de ' + esc_(u.nombre) + ' a VIP-C</h2>' +
    '<p>El acceso que le diste a <b>' + esc_(u.nombre) + '</b> (' + esc_(u.correo) + (u.empresa ? ', ' + esc_(u.empresa) : '') + ') venció y acaba de intentar ingresar.</p>' +
    '<p style="margin:14px 0 2px"><b>Renovar por:</b></p>' +
    botonesDuracion_({ d: "renovarPersona", u: u.usuario, sup: u.supervisor }, "#0b7a3e") +
    '<p style="color:#5b675f;font-size:13px">Si ya no necesita acceso, no hagas nada: seguirá cerrado.</p></div>';
  MailApp.sendEmail({ to: u.supervisor, subject: "VIP-C · Renovar acceso de " + u.nombre, htmlBody: html, body: "El acceso de " + u.nombre + " en VIP-C venció." });
}

// Agrega o renueva una empresa en EmpresasAutorizadas
function autorizarEmpresa_(dominio, nombre, sup, dur) {
  const h = hojaEmpresas_();
  const datos = h.getDataRange().getDisplayValues();
  const col = {}; datos[0].forEach(function (c, i) { col[claveEncabezado_(c)] = i + 1; });
  const vence = calcularVence_(dur);
  let fila = -1;
  for (let i = 1; i < datos.length; i++) if (texto_(datos[i][col["dominio"] - 1]).replace(/^@/, "").toLowerCase() === dominio) { fila = i + 1; break; }
  if (fila < 0) {
    fila = h.getLastRow() + 1;
    escribirTexto_(h, fila, col["dominio"], dominio);
    escribirTexto_(h, fila, col["empresa"], nombre || dominio);
  }
  h.getRange(fila, col["activo"]).setValue("SI");
  h.getRange(fila, col["vence"]).setValue(vence);
  if (col["autorizadapor"]) h.getRange(fila, col["autorizadapor"]).setValue(sup);
  if (col["notas"]) h.getRange(fila, col["notas"]).setValue("Autorizada por " + sup + " el " + Utilities.formatDate(new Date(), "America/Bogota", "yyyy-MM-dd"));
  return vence;
}

function avisarUsuario_(u, aprobado, vence) {
  try {
    MailApp.sendEmail({ to: u.correo, subject: aprobado ? "VIP-C · Tu acceso fue aprobado" : "VIP-C · Tu solicitud de acceso no fue aprobada",
      body: "Hola " + u.nombre + ",\n\n" + (aprobado
        ? "Tu supervisor aprobó tu acceso a VIP-C" + (vence ? " hasta el " + textoVence_(vence) : "") + ". Ya puedes ingresar con tu usuario (" + u.usuario + ") y tu contraseña."
        : "Tu supervisor no aprobó tu acceso a VIP-C. Si crees que es un error, comunícate con él.") +
        "\n\nGobernación de Antioquia · Secretaría de Infraestructura Física" });
  } catch (_) {}
}

function paginaResultado_(titulo, texto, ok) {
  const html = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;font:16px/1.5 Arial,sans-serif;background:#f2f4f1;color:#1b231e">' +
    '<div style="background:#081c15;color:#fff;padding:16px 20px;font:700 22px Arial">VIP-C <span style="font-weight:400;font-size:13px;letter-spacing:.08em">VISOR INTERACTIVO DE PUNTOS CRÍTICOS</span></div>' +
    '<div style="height:5px;background:#f2b705"></div>' +
    '<div style="padding:0 16px"><div style="max-width:520px;margin:32px auto;padding:24px;background:#fff;border:1px solid #d7dcd5;border-radius:10px">' +
    '<h1 style="margin:0 0 8px;font-size:22px;color:' + (ok ? "#0b7a3e" : "#b3261e") + '">' + esc_(titulo) + '</h1><p style="margin:0">' + texto + '</p></div></div></body>';
  return HtmlService.createHtmlOutput(html).setTitle("VIP-C");
}

// Lo que pasa cuando el supervisor toca un botón del correo
function decidir_(token) {
  const partes = String(token || "").split(".");
  if (partes.length !== 2 || b64url_(Utilities.computeHmacSha256Signature(partes[0], secreto_())) !== partes[1]) return paginaResultado_("Enlace no válido", "Este enlace está dañado o no es de VIP-C.", false);
  let d;
  try { d = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(partes[0] + "===".slice((partes[0].length + 3) % 4))).getDataAsString()); }
  catch (_) { return paginaResultado_("Enlace no válido", "Este enlace está dañado.", false); }
  if (d.k !== "d") return paginaResultado_("Enlace no válido", "Este enlace no es de aprobación.", false);
  if (Date.now() > d.exp) return paginaResultado_("Enlace vencido", "Este enlace venció. Si la persona sigue necesitando acceso, puede volver a registrarse.", false);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const dur = OPCIONES_DURACION.indexOf(d.dur) >= 0 ? d.dur : DURACION_EMPRESA_DEFECTO;
    if (d.d === "renovar") {
      const v = autorizarEmpresa_(d.dom, "", d.sup, dur);
      return paginaResultado_("Acceso renovado", "Las personas con correo @" + esc_(d.dom) + " pueden volver a ingresar hasta el " + textoVence_(v) + ".", true);
    }
    const u = buscarUsuario_(d.u);
    if (!u) return paginaResultado_("Solicitud no encontrada", "La cuenta ya no existe.", false);
    if (d.d === "renovarPersona") {
      const v = calcularVence_(dur);
      u.u.h.getRange(u.fila, u.u.col["Vence"] + 1).setValue(v);
      u.u.h.getRange(u.fila, u.u.col["Activo"] + 1).setValue("SI");
      avisarUsuario_(u, true, v);
      return paginaResultado_("Acceso renovado", esc_(u.nombre) + " puede ingresar hasta el " + textoVence_(v) + ".", true);
    }
    if (u.estado !== "PENDIENTE") return paginaResultado_("Solicitud ya resuelta", esc_(u.nombre) + " ya tiene una decisión (estado actual: " + esc_(u.estado || "—") + "). No hace falta hacer nada más.", true);
    const col = u.u.col["Activo"] + 1;
    if (d.d === "rechazar") {
      u.u.h.getRange(u.fila, col).setValue("NO");
      avisarUsuario_(u, false);
      return paginaResultado_("Solicitud rechazada", esc_(u.nombre) + " no tendrá acceso a VIP-C.", true);
    }
    u.u.h.getRange(u.fila, col).setValue("SI");
    if (d.d === "empresa") {
      const dom = dominioDe_(u.correo);
      const v = autorizarEmpresa_(dom, u.empresa, d.sup, dur);
      avisarUsuario_(u, true, v);
      // Activa también a otras personas de la misma empresa que estaban esperando
      const todos = leerUsuarios_(); let otros = 0;
      todos.filas.forEach(function (r) {
        const c = texto_(r.t[todos.col["Correo"]]).toLowerCase();
        if (c && c !== u.correo && terminaEnDominio_(c, dom) && normUsuario_(r.t[todos.col["Activo"]]).toUpperCase() === "PENDIENTE") {
          todos.h.getRange(r.fila, todos.col["Activo"] + 1).setValue("SI"); otros++;
          avisarUsuario_({ correo: c, nombre: texto_(r.t[todos.col["Nombre"]]), usuario: texto_(r.t[todos.col["Usuario"]]) }, true, v);
        }
      });
      return paginaResultado_("Empresa autorizada", esc_(u.nombre) + " ya puede ingresar. Además, cualquier persona con correo @" + esc_(dom) +
        " podrá registrarse y entrar sola hasta el " + textoVence_(v) + (otros ? " (" + otros + " solicitud(es) más de la misma empresa quedaron aprobadas)" : "") + ".", true);
    }
    // Solo esta persona: vencimiento individual
    const v = calcularVence_(dur);
    u.u.h.getRange(u.fila, u.u.col["Vence"] + 1).setValue(v);
    avisarUsuario_(u, true, v);
    return paginaResultado_("Acceso aprobado", esc_(u.nombre) + " puede ingresar a VIP-C hasta el " + textoVence_(v) + ". Le enviamos un correo avisándole.", true);
  } finally { lock.releaseLock(); }
}

function secreto_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty("SESSION_SECRET");
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty("SESSION_SECRET", s); }
  return s;
}

function b64url_(bytesOrText) {
  const b = typeof bytesOrText === "string" ? Utilities.base64EncodeWebSafe(bytesOrText, Utilities.Charset.UTF_8) : Utilities.base64EncodeWebSafe(bytesOrText);
  return b.replace(/=+$/, "");
}

function firmarSesion_(datos) {
  const cuerpo = b64url_(JSON.stringify(datos));
  const firma = b64url_(Utilities.computeHmacSha256Signature(cuerpo, secreto_()));
  return cuerpo + "." + firma;
}

function errorSesion_(msg) { const e = new Error(msg); e.sinSesion = true; return e; }

// Devuelve el usuario de una sesión válida o lanza error "sin_sesion"
function validarSesion_(token) {
  const partes = String(token || "").split(".");
  if (partes.length !== 2) throw errorSesion_("Inicia sesión para continuar.");
  const esperada = b64url_(Utilities.computeHmacSha256Signature(partes[0], secreto_()));
  if (esperada !== partes[1]) throw errorSesion_("Sesión no válida. Inicia sesión de nuevo.");
  let datos;
  try { datos = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(partes[0] + "===".slice((partes[0].length + 3) % 4))).getDataAsString()); }
  catch (_) { throw errorSesion_("Sesión no válida. Inicia sesión de nuevo."); }
  if (datos.k || !datos.exp || Date.now() > datos.exp) throw errorSesion_(datos.k ? "Sesión no válida. Inicia sesión de nuevo." : "Tu sesión venció. Inicia sesión de nuevo.");
  const u = buscarUsuario_(datos.u);
  if (!u || !u.activo) throw errorSesion_("Tu usuario no está activo. Habla con el administrador.");
  const bloqueo = bloqueoPorEmpresa_(u);
  if (bloqueo) throw errorSesion_(bloqueo);
  return u;
}

/* ======================= Lectura del sello (Gemini) ======================= */

// Llamada rápida a Gemini: sin «razonamiento» extra (responde mucho más rápido para leer sellos).
// Si el modelo no acepta esa opción, se repite la llamada sin ella.
// Llamada a Gemini con reintento: si responde 429 (límite por minuto) o 503 (ocupado), espera y vuelve a intentar
function fetchGemini_(url, key, body) {
  let res;
  for (let i = 0; i < 3; i++) {
    res = UrlFetchApp.fetch(url, { method: "post", contentType: "application/json", muteHttpExceptions: true, headers: { "x-goog-api-key": key }, payload: JSON.stringify(body) });
    const c = res.getResponseCode();
    if (c !== 429 && c !== 503) return res;
    if (i < 2) Utilities.sleep(2500 * (i + 1) + Math.floor(Math.random() * 800));
  }
  return res;
}

// Modelo que sí existe para esta clave: si el configurado no existe (404), prueba otros y recuerda el que funcione 6 horas.
const MODELOS_RESPALDO = ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash"];
function modeloQueFunciona_(key, fallido) {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get("gemini_modelo_ok");
  if (guardado && guardado !== fallido) return guardado;
  let lista = [];
  try {
    const l = JSON.parse(UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key }, muteHttpExceptions: true }).getContentText());
    lista = (l.models || []).filter(function (m) { return (m.supportedGenerationMethods || []).indexOf("generateContent") >= 0; })
      .map(function (m) { return String(m.name).replace("models/", ""); });
  } catch (_) {}
  const ordenados = MODELOS_RESPALDO.filter(function (m) { return lista.indexOf(m) >= 0; })
    .concat(lista.filter(function (n) { return /flash/.test(n) && !/lite|image|tts|live|audio|thinking|exp/.test(n) && MODELOS_RESPALDO.indexOf(n) < 0; }).sort().reverse())
    .concat(lista.length ? [] : MODELOS_RESPALDO);
  for (let i = 0; i < ordenados.length && i < 4; i++) {
    if (ordenados[i] === fallido) continue;
    const r = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(ordenados[i]) + ":generateContent",
      { method: "post", contentType: "application/json", muteHttpExceptions: true, headers: { "x-goog-api-key": key },
        payload: JSON.stringify({ contents: [{ parts: [{ text: "Responde solo: ok" }] }] }) });
    const c = r.getResponseCode();
    if (c === 200) { cache.put("gemini_modelo_ok", ordenados[i], 21600); return ordenados[i]; }
  }
  return "";
}

// 429: ¿se acabó el cupo del DÍA (se reinicia a las 3:00 a.m. hora Colombia) o solo el del minuto?
function limite429_(res) {
  const t = String(res.getContentText() || "").slice(0, 2000);
  if (/PerDay|per day/i.test(t)) return { status: "error", message: "Se acabó el cupo diario gratis de Gemini (429 cuota diaria). Se reinicia a las 3:00 a.m. (hora Colombia)." };
  return { status: "error", reintentar: true, message: "Gemini está limitando solicitudes por minuto (429). Se reintenta solo." };
}

function geminiRapido_(key, modelo, body, preciso) {
  if (preciso) modelo = prop_("GEMINI_MODEL_PRECISO", true) || modelo;
  const cacheado = CacheService.getScriptCache().get("gemini_modelo_ok");
  if (cacheado && modelo === (prop_("GEMINI_MODEL", true) || "gemini-3.5-flash-lite")) modelo = cacheado; // el configurado ya falló antes
  const llamar = function (m) {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(m) + ":generateContent";
    const enviar = function (b) { return fetchGemini_(url, key, b); };
    // Modo preciso: el modelo razona antes de responder (más lento, pero revisa dígito por dígito)
    if (preciso) return enviar(body);
    const rapido = JSON.parse(JSON.stringify(body));
    rapido.generationConfig = Object.assign({}, rapido.generationConfig, { thinkingConfig: { thinkingBudget: 0 } });
    let r = enviar(rapido);
    if (r.getResponseCode() === 400) r = enviar(body);
    return r;
  };
  let res = llamar(modelo);
  const cod = res.getResponseCode(), sinCupo = cod === 429 && /limit:\s*0|RESOURCE_EXHAUSTED/i.test(res.getContentText().slice(0, 1500));
  if (cod === 404 || sinCupo) { // modelo inexistente, o sin cupo gratuito para esta clave
    const otro = modeloQueFunciona_(key, modelo);
    if (otro) res = llamar(otro);
  }
  return res;
}


// Formatos de sello que llegan (todos con el texto sobre la foto, casi siempre abajo a la derecha):
//   «26/10/26, 10:36 a.m.» / «6° 38' 21.075" N, 74° 53' 24.732" W» / «Porcesito - La Cortada - Yolombó - Vegachí»
//   «6.40101N 76.04736W» / «Antioquia» / «Caicedo - Urrao» / «1 jun. 2025 9:32:48 a. m.»
//   «13/05/26, 8:40 a.m. N 6° 22' 10" W 75° 42' 28" Palmitas»
const REGLAS_SELLO =
  "Formatos de sello que se usan (ejemplos reales):\n" +
  "A) «26/10/26, 10:36 a.m.» / «6° 38' 21.075\" N, 74° 53' 24.732\" W» / «Porcesito - La Cortada - Yolombó - Vegachí»\n" +
  "B) «6.40101N 76.04736W» / «Antioquia» / «Caicedo - Urrao» / «1 jun. 2025 9:32:48 a. m.» (coordenadas en grados decimales con N y W)\n" +
  "C) «13/05/26, 8:40 a.m. N 6° 22' 10\" W 75° 42' 28\" Palmitas»\n" +
  "Reglas: las fechas numéricas van en formato día/mes/año. En Antioquia la latitud está entre 5 y 9 grados N y la longitud entre 73 y 77 grados W. " +
  "Copia cada dígito tal cual (no redondees ni completes). «Antioquia», «Colombia» o «Antioquia, Colombia» son el departamento y el país: NUNCA son el tramo. " +
  "El tramo es el nombre del lugar o de la vía (ej. «Caicedo - Urrao», «Remedios», «Vía Granada - Guatapé» → «Granada - Guatapé»).\n" +
  "Solo cuenta como sello el texto con FECHA y coordenadas sobre una fotografía. Si la imagen es un mapa, una captura de pantalla, una tabla o un logo (aunque tenga coordenadas escritas en el mapa), NO tiene sello: devuelve todo vacío y selloLegible=false.\n";

function leerSello_(payload) {
  if (!payload.base64) throw new Error("No llegó la imagen.");
  const key = prop_("GEMINI_API_KEY");
  const modelo = prop_("GEMINI_MODEL", true) || "gemini-3.5-flash-lite";
  const conRecorte = typeof payload.recorte === "string" && payload.recorte.length > 100;

  const prompt =
    "La imagen es una foto de inspección vial de la Gobernación de Antioquia (Colombia). " +
    "Suele tener un sello de texto superpuesto con fecha, coordenadas y el nombre del tramo o lugar.\n" +
    (conRecorte ? "Te envío dos imágenes: la 1 es la foto completa y la 2 es una AMPLIACIÓN de la parte baja de la misma foto, donde suele ir el sello. " +
      "Lee el texto en la ampliación (se ve más nítido) y usa la foto completa para ver la afectación y por si el sello está en otra parte.\n" : "") +
    REGLAS_SELLO +
    "Lee ese sello EXACTAMENTE como aparece. No inventes: si algo no se lee, devuelve \"\".\n" +
    "Responde SOLO JSON con estas claves:\n" +
    "fecha_texto (tal cual), fecha_iso (AAAA-MM-DD), " +
    "latitud (tal cual, ej 6°10'42\"N o 6.40101N), longitud (tal cual, ej 75°9'57\"W o 76.04736W), " +
    "tramo (nombre del tramo COMPLETO y exacto, sin la palabra Vía, ej \"Porcesito - La Cortada - Yolombó - Vegachí\", \"Caicedo - Urrao\" o \"Remedios\"), " +
    "codigo_via (código oficial de la vía si aparece, ej 60AN17; si no, \"\"), " +
    "municipio (municipio de Antioquia escrito en el sello, si aparece; si no, \"\"), " +
    "pr (abscisa PR o K escrita en el sello, ej 18+200, o \"\"), " +
    "tipo_afectacion (lo que se VE en la foto, exactamente uno de: " + TIPOS_AFECTACION.join(" | ") + "), " +
    "seguridad (alta, media o baja: qué tan seguro estás de cada dígito de las coordenadas), " +
    "sello_legible (true/false).";

  const parts = [{ text: prompt }, { inline_data: { mime_type: payload.mimeType || "image/jpeg", data: payload.base64 } }];
  if (conRecorte) parts.push({ inline_data: { mime_type: "image/jpeg", data: payload.recorte } });
  const body = { contents: [{ parts: parts }], generationConfig: { responseMimeType: "application/json", temperature: 0 } };

  const res = geminiRapido_(key, modelo, body, !!payload.preciso);
  const code = res.getResponseCode();
  if (code === 429) return limite429_(res);
  if (code !== 200) return { status: "error", message: "Gemini respondió " + code + ": " + errorGemini_(res) };

  const d = jsonGemini_(res);
  if (!d) return { status: "error", message: "No se pudo interpretar la respuesta de Gemini." };

  const lat = dmsADecimal_(d.latitud);
  let lon = dmsADecimal_(d.longitud);
  if (lon !== null && lon > 60) lon = -lon; // Antioquia siempre es longitud Oeste
  const fuera = fueraDeAntioquia_(lat, lon);
  const tramo = String(d.tramo || "").replace(/^\s*v[ií]a\s*/i, "").replace(/^\s*(antioquia|colombia)[\s,.\-–]*(colombia)?[\s,.\-–]*/i, "").trim();

  return {
    status: "success",
    preciso: !!payload.preciso,
    fechaTexto: d.fecha_texto || "",
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(d.fecha_iso || "") ? d.fecha_iso : "",
    latitudDMS: d.latitud || "",
    longitudDMS: d.longitud || "",
    latitud: fuera ? null : lat,
    longitud: fuera ? null : lon,
    tramo: /^(antioquia|colombia)$/i.test(tramo) ? "" : tramo,
    codigoVia: String(d.codigo_via || "").toUpperCase().replace(/\s/g, ""),
    municipio: String(d.municipio || ""),
    pr: String(d.pr || ""),
    tipoAfectacion: TIPOS_AFECTACION.indexOf(d.tipo_afectacion) >= 0 ? d.tipo_afectacion : "",
    seguridad: ["alta", "media", "baja"].indexOf(String(d.seguridad || "").toLowerCase()) >= 0 ? String(d.seguridad).toLowerCase() : "",
    selloLegible: !!d.sello_legible && lat !== null && lon !== null && !fuera,
    fueraDeAntioquia: fuera
  };
}

// Mensaje corto del error que devuelve Gemini (ej. modelo inexistente, clave inválida, cuota agotada)
function errorGemini_(res) {
  try { const e = JSON.parse(res.getContentText()).error; if (e && e.message) return String(e.message).slice(0, 180); } catch (_) {}
  return res.getContentText().slice(0, 180);
}

// Texto JSON de la respuesta de Gemini (con o sin ```json)
function jsonGemini_(res) {
  try {
    const r = JSON.parse(res.getContentText());
    const partes = (r && r.candidates && r.candidates[0] && r.candidates[0].content && r.candidates[0].content.parts) || [];
    const texto = partes.filter(function (p) { return p && p.text && !p.thought; }).map(function (p) { return p.text; }).join("");
    return texto ? JSON.parse(texto.replace(/^\s*```json\s*|\s*```\s*$/g, "")) : null;
  } catch (_) { return null; }
}

/* ======================= Capas de referencia (red vial y división política) ======================= */
// La página consulta estas capas directo; si el navegador no puede, las pide aquí. Solo lectura y solo estas capas.
const CAPAS_REFERENCIA = /^(R10\/FeatureServer\/[1-3]|División_política_de_Antioquia\/FeatureServer\/[1-4])$/;
function consultarCapa_(p) {
  const capa = texto_(p.capa), ruta = texto_(p.ruta);
  if (!CAPAS_REFERENCIA.test(capa) || (ruta !== "" && ruta !== "/query")) throw new Error("Capa no permitida.");
  const params = p.params && typeof p.params === "object" ? p.params : {};
  params.f = "json";
  const qs = Object.keys(params).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(String(params[k])); }).join("&");
  const url = "https://services5.arcgis.com/K90UQIB09TmTjUL8/arcgis/rest/services/" + encodeURI(capa) + ruta + "?" + qs;
  const cache = CacheService.getScriptCache();
  const clave = "capa_" + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, url));
  const guardado = cache.get(clave);
  if (guardado) return { status: "success", datos: JSON.parse(guardado) };
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const texto = res.getContentText();
  let datos;
  try { datos = JSON.parse(texto); } catch (_) { return { status: "error", message: "ArcGIS respondió " + res.getResponseCode() + "." }; }
  if (!datos.error && texto.length < 95000) { try { cache.put(clave, texto, 6 * 3600); } catch (_) {} }
  return { status: "success", datos: datos };
}

/* ======================= Lectura de actas en PDF (Gemini) ======================= */
// Redacta el resumen de todo el acta y completa lo que el lector del navegador no encontró.
function leerPdf_(payload) {
  if (!payload.base64) throw new Error("No llegó el PDF.");
  const key = prop_("GEMINI_API_KEY");
  const modelo = prop_("GEMINI_MODEL", true) || "gemini-3.5-flash-lite";
  const prompt =
    "El PDF es un acta de visita técnica o informe técnico de vías de la Gobernación de Antioquia (Colombia). " +
    "Extrae los datos EXACTAMENTE como aparecen. No inventes: si algo no aparece, devuelve \"\".\n" +
    "Responde SOLO JSON con estas claves:\n" +
    "fecha_iso (fecha en que se hizo la visita, AAAA-MM-DD; NO la fecha de aprobación del formato), " +
    "codigo_via (código oficial de la vía, ej 05656VT131 o 60AN17), " +
    "via (nombre de la vía o tramo, ej \"El Puerto - La Miserenga\"), " +
    "municipio (municipio de Antioquia donde está la vía), " +
    "responsable (quién hizo la visita, exactamente uno de: " + RESPONSABLES.join(" | ") + "; Rentan = RENTAN y sus contratistas o interventorías; vacío si no es claro), " +
    "puntos (lista: un elemento por cada SITIO o AFECTACIÓN distinta que describa el documento, sin importar el formato del documento: " +
    "puede identificarse por coordenadas, por abscisa PR/K (ej PR 18+200, K25+300), por número de tramo o por el nombre del lugar; " +
    "si el documento es un registro fotográfico con una tabla por punto (Municipio | Punto | Vía | Abscisa | Latitud | Longitud), cada fila es un punto: " +
    "NO omitas ninguna fila aunque el documento tenga muchas páginas; " +
    "incluye también los sitios cuyas coordenadas solo aparecen en los sellos superpuestos de las FOTOGRAFÍAS de campo (léelas con cuidado: grados, minutos y segundos; N/S y W/O); " +
    "NO tomes coordenadas de mapas, imágenes satelitales ni capturas de pantalla. " +
    "No inventes sitios ni coordenadas. Claves: nombre (ej \"Tramo 1\", \"PR 18+200\" o \"Caicedo P1\"), latitud (tal cual o vacío), longitud (tal cual o vacío; en Antioquia siempre es W aunque no lo diga), " +
    "via (nombre COMPLETO de la vía o tramo de ESE sitio, sin el código ni el orden, ej \"La Miserenga (Cruce Ruta 62) - Ebéjico - Heliconia - Alto del Chuscal\"), " +
    "codigo_via (código de la vía de ESE sitio, ej 25BAN06-1), municipio (municipio de ESE sitio), " +
    "pr (abscisa PR o K si aparece, ej 18+200, o vacío), fecha_iso (fecha de ese sitio si es distinta a la de la visita, o vacío), " +
    "tipo_afectacion (exactamente uno de: " + TIPOS_AFECTACION.join(" | ") + "), " +
    "descripcion (lo que dice el documento sobre ese sitio: lo encontrado, medidas y lo recomendado, máximo 5 frases), pagina (página donde se describe)), " +
    "resumen (resumen de TODO el documento en 4 a 6 frases claras: motivo de la visita, qué se encontró en cada tramo con sus medidas, " +
    "el riesgo para la vía y las recomendaciones; sin repetir coordenadas ni datos del encabezado del formato).";
  const body = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "application/pdf", data: payload.base64 } }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 }
  };
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(modelo) + ":generateContent";
  const res = fetchGemini_(url, key, body);
  const code = res.getResponseCode();
  if (code === 429) return limite429_(res);
  if (code !== 200) return { status: "error", message: "Gemini respondió " + code + ": " + errorGemini_(res) };
  const r = JSON.parse(res.getContentText());
  const texto = r && r.candidates && r.candidates[0] && r.candidates[0].content &&
    r.candidates[0].content.parts && r.candidates[0].content.parts[0] && r.candidates[0].content.parts[0].text;
  if (!texto) return { status: "error", message: "Gemini no devolvió texto para este PDF." };
  let d;
  try { d = JSON.parse(texto.replace(/^```json\s*|```$/g, "")); }
  catch (_) { return { status: "error", message: "No se pudo interpretar la respuesta de Gemini." }; }
  const puntos = (Array.isArray(d.puntos) ? d.puntos : []).map(function (p) {
    const lat = dmsADecimal_(p.latitud);
    let lon = dmsADecimal_(p.longitud);
    if (lon !== null && lon > 60) lon = -lon;
    return {
      nombre: String(p.nombre || ""), latitud: fueraDeAntioquia_(lat, lon) ? null : lat, longitud: fueraDeAntioquia_(lat, lon) ? null : lon,
      via: String(p.via || "").replace(/^\s*v[ií]a\s*/i, ""), codigoVia: String(p.codigo_via || "").toUpperCase().replace(/\s/g, ""), municipio: String(p.municipio || ""),
      tipoAfectacion: TIPOS_AFECTACION.indexOf(p.tipo_afectacion) >= 0 ? p.tipo_afectacion : "",
      descripcion: String(p.descripcion || ""), pr: String(p.pr || ""), pagina: Number(p.pagina) || 1,
      fecha: /^\d{4}-\d{2}-\d{2}$/.test(p.fecha_iso || "") ? p.fecha_iso : ""
    };
  });
  return {
    status: "success",
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(d.fecha_iso || "") ? d.fecha_iso : "",
    codigoVia: String(d.codigo_via || "").toUpperCase().replace(/\s/g, ""),
    via: String(d.via || "").replace(/^\s*v[ií]a\s*/i, ""),
    municipio: String(d.municipio || ""),
    resumen: String(d.resumen || "").trim(),
    responsable: d.responsable === "Rental" ? "Rentan" : (RESPONSABLES.indexOf(d.responsable) >= 0 ? d.responsable : ""),
    puntos: puntos
  };
}

/* ======================= Sellos de varias fotos a la vez (fotos que vienen dentro de un PDF) ======================= */
function leerFotos_(payload) {
  const imgs = (Array.isArray(payload.imagenes) ? payload.imagenes : []).slice(0, 16).filter(function (b) { return typeof b === "string" && b.length > 100; });
  if (!imgs.length) throw new Error("No llegaron fotos.");
  const key = prop_("GEMINI_API_KEY");
  const modelo = prop_("GEMINI_MODEL", true) || "gemini-3.5-flash-lite";
  const prompt =
    "Te envío " + imgs.length + " imágenes en orden (0 a " + (imgs.length - 1) + "), sacadas de un acta de visita vial de Antioquia (Colombia). " +
    "Muchas son fotos con un sello de texto superpuesto (fecha, hora, coordenadas y lugar), por ejemplo «13/05/26, 8:40 a.m. N 6° 22' 10\" W 75° 42' 28\" Palmitas»; " +
    "otras son mapas, imágenes satelitales, capturas de pantalla, tablas o logos. SOLO cuentan las coordenadas del SELLO de una FOTOGRAFÍA de campo: " +
    REGLAS_SELLO +
    "en mapas, capturas, tablas o cualquier imagen sin ese sello devuelve es_foto_con_sello=false y legible=false aunque se vean coordenadas. " +
    "Lee EXACTAMENTE lo escrito, sin inventar ni deducir del paisaje. " +
    "Las fechas numéricas van en formato día/mes/año. Responde SOLO JSON: {\"fotos\":[{\"indice\":0, \"fecha_iso\":\"AAAA-MM-DD o vacío\", " +
    "\"latitud\":\"tal cual, ej N 6°22'10\\\" o vacío\", \"longitud\":\"tal cual, ej W 75°42'28\\\" o vacío\", " +
    "\"pr\":\"abscisa PR escrita en el sello, ej 18+200, o vacío\", \"tramo\":\"nombre del tramo o lugar del sello (nunca Antioquia ni Colombia), o vacío\", " +
    "\"es_foto_con_sello\":true, \"legible\":true}]} con un elemento por imagen.";
  const parts = [{ text: prompt }];
  imgs.forEach(function (b) { parts.push({ inline_data: { mime_type: "image/jpeg", data: b } }); });
  const res = geminiRapido_(key, modelo, { contents: [{ parts: parts }], generationConfig: { responseMimeType: "application/json", temperature: 0 } });
  const code = res.getResponseCode();
  if (code === 429) return limite429_(res);
  if (code !== 200) return { status: "error", message: "Gemini respondió " + code + ": " + errorGemini_(res) };
  const r = JSON.parse(res.getContentText());
  const texto = r && r.candidates && r.candidates[0] && r.candidates[0].content && r.candidates[0].content.parts && r.candidates[0].content.parts[0] && r.candidates[0].content.parts[0].text;
  let d;
  try { d = JSON.parse(String(texto || "").replace(/^```json\s*|```$/g, "")); } catch (_) { return { status: "error", message: "No se pudo interpretar la respuesta de Gemini." }; }
  const fotos = (Array.isArray(d.fotos) ? d.fotos : []).map(function (f) {
    const lat = dmsADecimal_(f.latitud); let lon = dmsADecimal_(f.longitud);
    if (lon !== null && lon > 60) lon = -lon;
    return { indice: Number(f.indice), esFoto: f.es_foto_con_sello !== false, pr: String(f.pr || ""),
      tramo: /^\s*(antioquia|colombia)\s*$/i.test(String(f.tramo || "")) ? "" : String(f.tramo || "").replace(/^\s*v[ií]a\s*/i, ""), fecha: /^\d{4}-\d{2}-\d{2}$/.test(f.fecha_iso || "") ? f.fecha_iso : "", latitud: lat, longitud: lon,
      legible: !!f.legible && f.es_foto_con_sello !== false && lat !== null && lon !== null && !fueraDeAntioquia_(lat, lon) };
  });
  return { status: "success", fotos: fotos };
}

/* ======================= Guardado (Drive + Sheets) ======================= */

function subirFoto_(p) {
  if (texto_(p.responsable) === "Rental") p.responsable = "Rentan";   // nombre anterior de la opción
  const faltan = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto_(p.fecha))) faltan.push("fecha (AAAA-MM-DD)");
  if (!texto_(p.municipio)) faltan.push("municipio");
  if (!texto_(p.tipoAfectacion)) faltan.push("tipo de afectación");
  if (RESPONSABLES.indexOf(texto_(p.responsable)) < 0) faltan.push("responsable de la visita");
  if (!texto_(p.codigoVia) && !texto_(p.nombreTramo)) faltan.push("código de la vía o nombre del tramo");
  if (faltan.length) throw new Error("Falta: " + faltan.join(", ") + ".");

  const lat = numero_(p.latitud), lon = numero_(p.longitud);
  if ((lat === null) !== (lon === null)) throw new Error("Faltan latitud o longitud.");
  if (lat !== null && (lat < -90 || lat > 90 || lon < -180 || lon > 180)) throw new Error("Coordenadas fuera de rango.");

  // Drive (solo si hay foto o PDF): Raíz / Subregion / Municipio / archivo
  let archivo = null;
  if (p.archivoId) {
    // Otro punto del mismo PDF: se reutiliza el archivo ya subido (solo archivos creados por VIP-C)
    try { archivo = DriveApp.getFileById(texto_(p.archivoId)); } catch (_) { archivo = null; }
    if (!archivo || String(archivo.getDescription() || "").indexOf("VIP-C") !== 0) throw new Error("No se encontró el PDF ya guardado. Vuelve a cargarlo.");
  } else if (p.base64) {
    const raiz = DriveApp.getFolderById(prop_("ROOT_FOLDER_ID"));
    const cSub = carpeta_(raiz, limpiar_(p.subregion || "Sin subregion"));
    const cMun = carpeta_(cSub, limpiar_(p.municipio));
    const esPdf = p.mimeType === "application/pdf";
    const nombre = limpiar_((texto_(p.fecha) || "sin-fecha") + "_" + (texto_(p.codigoVia) || texto_(p.nombreTramo) || "via") + "_" + (p.nombreArchivo || (esPdf ? "acta.pdf" : "foto.jpg")));
    const blob = Utilities.newBlob(Utilities.base64Decode(p.base64), esPdf ? "application/pdf" : "image/jpeg", nombre);
    archivo = cMun.createFile(blob);
    archivo.setDescription("VIP-C | " + texto_(p.codigoVia) + " " + texto_(p.nombreTramo) + " | " + texto_(p.municipio) + " | " + texto_(p.tipoAfectacion));
    try { archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (_) { /* dominio restringido */ }
  }

  // Sheets con bloqueo para que el ID consecutivo no se repita
  let fila = 0, idGuardado = "";
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const hoja = hoja_();
    const id = siguienteId_(hoja);
    const ahora = Utilities.formatDate(new Date(), "America/Bogota", "yyyy-MM-dd HH:mm:ss");
    hoja.appendRow([
      id, ahora, celda_(p.fecha), celda_(p.fechaTexto), celda_(p.latitudDMS), celda_(p.longitudDMS),
      lat === null ? "" : lat, lon === null ? "" : lon,
      celda_(texto_(p.codigoVia).toUpperCase()), celda_(p.nombreTramo), celda_(p.subregion), celda_(p.municipio),
      celda_(p.tipoAfectacion), celda_(p.responsable), celda_(p.estadoPunto), celda_(p.observaciones),
      archivo ? (p.origen === "pdf" ? "pdf" : "foto") : "manual",
      archivo ? celda_(archivo.getName()) : "", archivo ? archivo.getId() : "", archivo ? archivo.getUrl() : "",
      texto_(p.origenUbicacion) || "manual", p.selloLegible ? "SI" : "NO",
      fueraDeAntioquia_(lat, lon) ? "SI" : "NO",
      "ACTIVO", "", "", celda_(p.registradoPor), "", "PENDIENTE", celda_(p.vereda)
    ]);
    fila = hoja.getLastRow();
    idGuardado = id;
  } catch (err) {
    return { status: "partial_error", message: (archivo ? "El archivo quedó en Drive pero falló" : "Falló") + " el registro en Sheets: " + err.message };
  } finally {
    lock.releaseLock();
  }

  // ArcGIS: se envía después de guardar en Sheets; si falla, el registro queda PENDIENTE para reenviarlo
  const ag = enviarArcgis_(p, idGuardado, lat, lon, archivo);
  marcarArcgis_(fila, idGuardado, ag);
  return { status: "success", id: idGuardado, fileId: archivo ? archivo.getId() : "", url: archivo ? archivo.getUrl() : "", arcgis: ag };
}

/* ======================= ArcGIS Online (capa Inventario_Avanzadas) ======================= */
// Cada registro guardado se agrega como punto a la capa y se le adjunta la foto o el PDF.
// Propiedades opcionales: ARCGIS_URL (otra capa), ARCGIS_USUARIO y ARCGIS_CLAVE (si la capa no es editable en público).
const ARCGIS_URL_DEFECTO = "https://services5.arcgis.com/K90UQIB09TmTjUL8/arcgis/rest/services/Inventario_Avanzadas/FeatureServer/0";
const FUENTES_XY = { sello: "Sello foto", gps: "GPS foto", dispositivo: "GPS celular", manual: "Manual", pdf: "Acta PDF", servidor: "Sello foto" };
const ORIGENES = { manual: "Carga manual", foto: "Carga fotográfica", pdf: "Acta PDF" };

function arcgisUrl_() { return (prop_("ARCGIS_URL", true) || ARCGIS_URL_DEFECTO).replace(/\/+$/, ""); }
function corta_(v, n) { const t = texto_(v); return t.length > n ? t.slice(0, n - 1) + "…" : t; }

function tokenArcgis_() {
  const usuario = prop_("ARCGIS_USUARIO", true), clave = prop_("ARCGIS_CLAVE", true);
  if (!usuario || !clave) return "";
  const cache = CacheService.getScriptCache();
  const guardado = cache.get("arcgis_token");
  if (guardado) return guardado;
  const res = UrlFetchApp.fetch("https://www.arcgis.com/sharing/rest/generateToken", {
    method: "post", muteHttpExceptions: true,
    payload: { username: usuario, password: clave, referer: "https://www.arcgis.com", expiration: 120, f: "json" }
  });
  const d = JSON.parse(res.getContentText() || "{}");
  if (!d.token) throw new Error("ArcGIS no aceptó el usuario o la clave (" + ((d.error && d.error.message) || res.getResponseCode()) + ").");
  cache.put("arcgis_token", d.token, 100 * 60);
  return d.token;
}

// Grados → Web Mercator (la capa está en 102100)
function aMercator_(lat, lon) {
  const x = lon * 20037508.34 / 180;
  const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * 20037508.34 / 180;
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, spatialReference: { wkid: 102100 } };
}

// Atributos de la capa Inventario_Avanzadas (ARCHIVO, COD_VIA, NOM_VIA, MUNICIPIO, SUBREGION, TIPO_AFEC, OBSERV, FECHA, LAT_DEC, LON_DEC, FUENTE)
function atributosArcgis_(p, id, lat, lon, archivo) {
  const f = texto_(p.fecha).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const origen = ORIGENES[texto_(p.origen)] || "Carga manual";
  const fuenteXY = FUENTES_XY[texto_(p.origenUbicacion)] || "Manual";
  return {
    ARCHIVO: archivo ? archivo.getName() : "",
    COD_VIA: texto_(p.codigoVia).toUpperCase(),
    NOM_VIA: texto_(p.nombreTramo),
    MUNICIPIO: texto_(p.municipio),
    SUBREGION: texto_(p.subregion),
    TIPO_AFEC: texto_(p.tipoAfectacion),
    OBSERV: texto_(p.observaciones),
    FECHA: f ? Date.UTC(Number(f[1]), Number(f[2]) - 1, Number(f[3]), 17, 0, 0) : null, // 12:00 m. en Colombia
    LAT_DEC: lat, LON_DEC: lon,
    FUENTE: origen + (lat !== null && fuenteXY !== origen ? " (" + fuenteXY + ")" : "")
  };
}

// Campos que tiene hoy la capa (nombre → largo máximo). Se consulta a ArcGIS y se guarda 6 horas.
// Así, si la capa cambia, solo se envían los campos que existen y cada texto se recorta a su largo.
function camposArcgis_(token) {
  const cache = CacheService.getScriptCache();
  const g = cache.get("arcgis_campos");
  if (g) return JSON.parse(g);
  const res = UrlFetchApp.fetch(arcgisUrl_() + "?f=json" + (token ? "&token=" + encodeURIComponent(token) : ""), { muteHttpExceptions: true });
  const d = JSON.parse(res.getContentText() || "{}");
  if (!d.fields) return null;
  const campos = {};
  d.fields.forEach(function (c) { if (c.editable !== false) campos[c.name] = { t: c.type, n: c.length || 0 }; });
  cache.put("arcgis_campos", JSON.stringify(campos), 6 * 3600);
  return campos;
}
function ajustarAtributos_(attrs, campos) {
  if (!campos) return attrs;
  const out = {};
  Object.keys(attrs).forEach(function (k) {
    const c = campos[k]; if (!c) return; // la capa no tiene ese campo
    let v = attrs[k];
    if (c.t === "esriFieldTypeString" && v !== null && c.n) {
      v = String(v);
      if (v.length > c.n) {
        const ext = (v.match(/\.[a-z0-9]{2,4}$/i) || [""])[0]; // nombres de archivo: conserva la extensión
        v = ext && k === "ARCHIVO" ? v.slice(0, c.n - ext.length - 1) + "…" + ext : v.slice(0, c.n - 1) + "…";
      }
    }
    out[k] = v;
  });
  return out;
}

function enviarArcgis_(p, id, lat, lon, archivo) {
  try {
    const url = arcgisUrl_(), token = tokenArcgis_();
    let campos = null; try { campos = camposArcgis_(token); } catch (_) {}
    const feature = { attributes: ajustarAtributos_(atributosArcgis_(p, id, lat, lon, archivo), campos), geometry: lat === null ? null : aMercator_(lat, lon) };
    const pl = { features: JSON.stringify([feature]), rollbackOnFailure: "true", f: "json" };
    if (token) pl.token = token;
    const res = UrlFetchApp.fetch(url + "/addFeatures", { method: "post", payload: pl, muteHttpExceptions: true });
    const d = JSON.parse(res.getContentText() || "{}");
    const r = d.addResults && d.addResults[0];
    if (!r || !r.success) {
      const e = (r && r.error) || d.error || {};
      return { ok: false, message: "ArcGIS: " + (e.message || e.description || ("respuesta " + res.getResponseCode())) + (e.code === 499 || e.code === 498 ? " (la capa pide iniciar sesión: configura ARCGIS_USUARIO y ARCGIS_CLAVE)" : "") };
    }
    let adjunto = "";
    if (archivo) {
      try {
        const blob = archivo.getBlob();
        if (blob.getBytes().length <= 20 * 1024 * 1024) {
          const fa = { attachment: blob, f: "json" };
          if (token) fa.token = token;
          const ra = JSON.parse(UrlFetchApp.fetch(url + "/" + r.objectId + "/addAttachment", { method: "post", payload: fa, muteHttpExceptions: true }).getContentText() || "{}");
          adjunto = ra.addAttachmentResult && ra.addAttachmentResult.success ? "con adjunto" : "sin adjunto";
        } else adjunto = "sin adjunto (archivo de más de 20 MB)";
      } catch (e) { adjunto = "sin adjunto (" + e.message + ")"; }
    }
    return { ok: true, fid: r.objectId, adjunto: adjunto };
  } catch (err) {
    return { ok: false, message: "ArcGIS: " + (err.message || String(err)) };
  }
}

function marcarArcgis_(fila, id, ag) {
  try {
    const h = hoja_();
    const enc = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
    if (!fila || String(h.getRange(fila, 1).getValue()) !== String(id)) {
      const ids = h.getRange(1, 1, h.getLastRow(), 1).getValues();
      fila = 0; for (let i = ids.length - 1; i >= 1; i--) if (String(ids[i][0]) === String(id)) { fila = i + 1; break; }
      if (!fila) return;
    }
    const cF = enc.indexOf("ArcGIS_FID") + 1, cE = enc.indexOf("ArcGIS_Estado") + 1;
    if (cF) h.getRange(fila, cF).setValue(ag.ok ? ag.fid : "");
    if (cE) h.getRange(fila, cE).setValue(ag.ok ? "ENVIADO" + (ag.adjunto ? " " + ag.adjunto : "") : "ERROR: " + String(ag.message || "").slice(0, 200));
  } catch (_) { /* no impide la respuesta */ }
}

// Reenvía a ArcGIS los registros activos que quedaron sin enviar (ejecútala a mano desde el editor)
function reenviarArcgis() {
  const h = hoja_();
  const datos = h.getDataRange().getValues();
  const enc = datos[0], c = function (n) { return enc.indexOf(n); };
  let ok = 0, mal = 0;
  for (let i = 1; i < datos.length; i++) {
    const r = datos[i];
    if (inactivo_(r[c("EstadoRegistro")]) || r[c("ArcGIS_FID")] !== "") continue;
    const fecha = r[c("FechaVisita")];
    const p = {
      fecha: fecha instanceof Date ? Utilities.formatDate(fecha, "America/Bogota", "yyyy-MM-dd") : texto_(fecha),
      fechaTexto: r[c("FechaSello")], codigoVia: r[c("CodigoVia")], nombreTramo: r[c("NombreTramo")],
      subregion: r[c("Subregion")], municipio: r[c("Municipio")], tipoAfectacion: r[c("TipoAfectacion")],
      responsable: r[c("Responsable")], observaciones: r[c("Observaciones")], origen: r[c("Origen")],
      origenUbicacion: r[c("OrigenUbicacion")], registradoPor: r[c("RegistradoPor")]
    };
    let archivo = null;
    try { if (r[c("FileId")]) archivo = DriveApp.getFileById(r[c("FileId")]); } catch (_) {}
    const lat = numero_(r[c("Latitud")]), lon = numero_(r[c("Longitud")]);
    const ag = enviarArcgis_(p, r[c("ID")], lat, lon, archivo);
    marcarArcgis_(i + 1, r[c("ID")], ag);
    if (ag.ok) ok++; else { mal++; Logger.log(r[c("ID")] + " → " + ag.message); }
  }
  Logger.log("Enviados a ArcGIS: " + ok + " · Con error: " + mal);
}

// ENSAYO: crea un punto de prueba en la capa (frente a la Gobernación, La Alpujarra) y le sube una imagen.
// Ejecútala desde el editor; luego mira el punto en el mapa y bórralo con borrarEnsayosArcgis.
function ensayarArcgis() {
  CacheService.getScriptCache().remove("arcgis_campos");
  const token = tokenArcgis_();
  const campos = camposArcgis_(token);
  Logger.log("1) Campos de la capa: " + (campos ? Object.keys(campos).join(", ") : "no se pudieron leer"));
  const p = { fecha: Utilities.formatDate(new Date(), "America/Bogota", "yyyy-MM-dd"), codigoVia: "PRUEBA", nombreTramo: "ENSAYO VIP-C",
    municipio: "Medellín", subregion: "Valle de Aburrá", tipoAfectacion: "Otro", observaciones: "ENSAYO VIP-C: punto de prueba, se puede borrar.",
    origen: "manual", origenUbicacion: "manual" };
  const lat = 6.244747, lon = -75.574828;
  const feature = { attributes: ajustarAtributos_(atributosArcgis_(p, "ENSAYO", lat, lon, null), campos), geometry: aMercator_(lat, lon) };
  const pl = { features: JSON.stringify([feature]), f: "json" }; if (token) pl.token = token;
  const res = UrlFetchApp.fetch(arcgisUrl_() + "/addFeatures", { method: "post", payload: pl, muteHttpExceptions: true });
  Logger.log("2) Crear el punto → " + res.getContentText().slice(0, 300));
  const r = (JSON.parse(res.getContentText() || "{}").addResults || [])[0];
  if (!r || !r.success) { Logger.log("No se creó el punto. Mándale este registro a quien te ayuda."); return; }
  // Imagen de prueba (cuadro verde de 8x8)
  const png = Utilities.newBlob(Utilities.base64Decode("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGPgrrLDihiGlgQAACUwwZIoS6cAAAAASUVORK5CYII="), "image/png", "ensayo_vipc.png");
  const fa = { attachment: png, f: "json" }; if (token) fa.token = token;
  const ra = UrlFetchApp.fetch(arcgisUrl_() + "/" + r.objectId + "/addAttachment", { method: "post", payload: fa, muteHttpExceptions: true });
  Logger.log("3) Subir la imagen al punto " + r.objectId + " → " + ra.getContentText().slice(0, 300));
  Logger.log("Listo: busca el punto en el mapa, en La Alpujarra (Medellín). FID = " + r.objectId);
}

// Borra de la capa los puntos creados por ensayarArcgis
function borrarEnsayosArcgis() {
  const token = tokenArcgis_();
  const pl = { where: "NOM_VIA = 'ENSAYO VIP-C'", f: "json" }; if (token) pl.token = token;
  const res = UrlFetchApp.fetch(arcgisUrl_() + "/deleteFeatures", { method: "post", payload: pl, muteHttpExceptions: true });
  Logger.log("Borrar ensayos → " + res.getContentText().slice(0, 300));
}

// Revisa la conexión con la capa sin crear nada (ejecútala desde el editor)
function probarArcgis() {
  const token = tokenArcgis_();
  const res = UrlFetchApp.fetch(arcgisUrl_() + "?f=json" + (token ? "&token=" + encodeURIComponent(token) : ""), { muteHttpExceptions: true });
  const d = JSON.parse(res.getContentText() || "{}");
  if (d.error) { Logger.log("Error: " + d.error.message); return; }
  Logger.log("Capa: " + d.name + " · Permisos: " + d.capabilities + (token ? " · con usuario ArcGIS" : " · acceso público"));
}

/* ======================= Borrado seguro (anulación) ======================= */

function anularRegistro_(p) {
  const admin = prop_("ADMIN_TOKEN", true);
  if (!admin) throw new Error("El borrado no está habilitado: falta la propiedad ADMIN_TOKEN.");
  if (p.adminToken !== admin) throw new Error("Clave de administrador incorrecta.");
  if (!texto_(p.id)) throw new Error("Falta el ID del registro.");

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const hoja = hoja_();
    const enc = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
    const col = function (n) { return enc.indexOf(n) + 1; };
    const ids = hoja.getRange(2, 1, Math.max(hoja.getLastRow() - 1, 1), 1).getValues();
    let fila = -1;
    for (let i = 0; i < ids.length; i++) { if (String(ids[i][0]) === String(p.id)) { fila = i + 2; break; } }
    if (fila < 0) throw new Error("No se encontró el registro " + p.id + ".");

    hoja.getRange(fila, col("EstadoRegistro")).setValue("ANULADO");
    hoja.getRange(fila, col("FechaAnulacion")).setValue(Utilities.formatDate(new Date(), "America/Bogota", "yyyy-MM-dd HH:mm:ss"));
    hoja.getRange(fila, col("MotivoAnulacion")).setValue(texto_(p.motivo) || "Sin motivo");

    const fileId = hoja.getRange(fila, col("FileId")).getValue();
    let papelera = false;
    if (fileId) { try { DriveApp.getFileById(String(fileId)).setTrashed(true); papelera = true; } catch (_) { /* ya no existe */ } }
    return { status: "success", id: p.id, fotoEnPapelera: papelera };
  } finally {
    lock.releaseLock();
  }
}

/* ======================= Eliminar puntos de ArcGIS ======================= */
// Quién puede eliminar: los administradores (Rol = admin en la hoja Usuarios) cualquier punto;
// los demás, solo los puntos que ellos mismos registraron. Antes de borrar se guarda una copia
// completa del punto (atributos y ubicación) en la hoja «Eliminados», para poder restaurarlo.
const HOJA_ELIMINADOS = "Eliminados";
const COLUMNAS_ELIMINADOS = ["Fecha", "Usuario", "ID", "ArcGIS_FID", "Motivo", "Atributos", "Geometria", "Restaurado"];
function inactivo_(estado) { return ["ANULADO", "ELIMINADO"].indexOf(texto_(estado).toUpperCase()) >= 0; }
function esAdmin_(u) { return /^(admin|administrador|administradora|superadmin)$/i.test(texto_(u && u.rol)); }
function hojaEliminados_() {
  const ss = SpreadsheetApp.openById(prop_("SPREADSHEET_ID"));
  let h = ss.getSheetByName(HOJA_ELIMINADOS);
  if (!h) { h = ss.insertSheet(HOJA_ELIMINADOS); h.appendRow(COLUMNAS_ELIMINADOS); h.getRange(1, 1, 1, COLUMNAS_ELIMINADOS.length).setFontWeight("bold"); h.setFrozenRows(1); }
  return h;
}

function puntosGuardados_(p, u) {
  const h = hoja_();
  const datos = h.getDataRange().getValues();
  if (datos.length < 2) return { status: "success", admin: esAdmin_(u), puntos: [] };
  const enc = datos[0], c = function (n) { return enc.indexOf(n); };
  const admin = esAdmin_(u), yo = normUsuario_(u.usuario);
  const q = normUsuario_(p.buscar);
  const fecha = function (v) { return v instanceof Date ? Utilities.formatDate(v, "America/Bogota", "yyyy-MM-dd") : texto_(v); };
  const out = [];
  for (let i = datos.length - 1; i >= 1 && out.length < 150; i--) {
    const r = datos[i];
    if (inactivo_(r[c("EstadoRegistro")])) continue;
    if (!admin && normUsuario_(r[c("RegistradoPor")]) !== yo) continue;
    const x = {
      id: texto_(r[c("ID")]), fecha: fecha(r[c("FechaVisita")]), municipio: texto_(r[c("Municipio")]), tramo: texto_(r[c("NombreTramo")]),
      codigo: texto_(r[c("CodigoVia")]), tipo: texto_(r[c("TipoAfectacion")]), fid: texto_(r[c("ArcGIS_FID")]), arcgis: texto_(r[c("ArcGIS_Estado")]),
      por: texto_(r[c("RegistradoPor")]), url: texto_(r[c("URL")]), latitud: numero_(r[c("Latitud")]), longitud: numero_(r[c("Longitud")])
    };
    if (q && normUsuario_([x.id, x.fecha, x.municipio, x.tramo, x.codigo, x.tipo, x.fid, x.por].join(" ")).indexOf(q) < 0) continue;
    out.push(x);
  }
  return { status: "success", admin: admin, puntos: out };
}

function eliminarPunto_(p, u) {
  const motivo = texto_(p.motivo);
  if (motivo.length < 3) throw new Error("Escribe el motivo de la eliminación.");
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const h = hoja_();
    const datos = h.getDataRange().getValues();
    const enc = datos[0], c = function (n) { return enc.indexOf(n); };
    let fila = -1;
    for (let i = datos.length - 1; i >= 1; i--) {
      if ((p.id && texto_(datos[i][c("ID")]) === texto_(p.id)) || (!p.id && p.fid && texto_(datos[i][c("ArcGIS_FID")]) === texto_(p.fid))) { fila = i; break; }
    }
    const r = fila > 0 ? datos[fila] : null;
    if (!r && !p.fid) throw new Error("No se encontró el registro " + texto_(p.id) + ".");
    if (r && inactivo_(r[c("EstadoRegistro")])) throw new Error("El registro " + texto_(r[c("ID")]) + " ya estaba " + texto_(r[c("EstadoRegistro")]).toLowerCase() + ".");
    if (!esAdmin_(u) && (!r || normUsuario_(r[c("RegistradoPor")]) !== normUsuario_(u.usuario)))
      throw new Error(r ? "Solo puedes eliminar los puntos que tú registraste. Pídeselo a un administrador." : "Solo un administrador puede eliminar puntos que no se cargaron con VIP-C.");

    const id = r ? texto_(r[c("ID")]) : "";
    const fid = texto_(r ? r[c("ArcGIS_FID")] : p.fid);
    const ahora = Utilities.formatDate(new Date(), "America/Bogota", "yyyy-MM-dd HH:mm:ss");
    let resultadoArcgis = "no estaba en ArcGIS";

    if (fid) {
      const url = arcgisUrl_(), token = tokenArcgis_();
      // 1) Copia completa del punto antes de borrarlo
      const q = { objectIds: fid, outFields: "*", returnGeometry: "true", f: "json" }; if (token) q.token = token;
      const dq = JSON.parse(UrlFetchApp.fetch(url + "/query", { method: "post", payload: q, muteHttpExceptions: true }).getContentText() || "{}");
      if (dq.error) throw new Error("ArcGIS: " + (dq.error.message || "no se pudo consultar el punto") + ". No se eliminó nada.");
      const ft = (dq.features || [])[0];
      if (ft) {
        hojaEliminados_().appendRow([ahora, celda_(u.usuario), celda_(id), fid, celda_(motivo), JSON.stringify(ft.attributes || {}), JSON.stringify(ft.geometry || null), ""]);
        // 2) Borrado
        const pl = { objectIds: fid, f: "json" }; if (token) pl.token = token;
        const d = JSON.parse(UrlFetchApp.fetch(url + "/deleteFeatures", { method: "post", payload: pl, muteHttpExceptions: true }).getContentText() || "{}");
        const dr = d.deleteResults && d.deleteResults[0];
        if (!dr || !dr.success) {
          const e = (dr && dr.error) || d.error || {};
          throw new Error("ArcGIS no dejó eliminar el punto: " + (e.message || e.description || "error") +
            (e.code === 499 || e.code === 498 || e.code === 403 ? " (la capa no permite borrar: configura ARCGIS_USUARIO y ARCGIS_CLAVE de una cuenta con permiso de edición, o activa «Eliminar» en la capa)" : "") + ".");
        }
        resultadoArcgis = "eliminado";
      } else resultadoArcgis = "ya no estaba en ArcGIS";
    }

    if (r) {
      const n = fila + 1;
      h.getRange(n, c("EstadoRegistro") + 1).setValue("ELIMINADO");
      h.getRange(n, c("FechaAnulacion") + 1).setValue(ahora);
      h.getRange(n, c("MotivoAnulacion") + 1).setValue(celda_(motivo + " (eliminado por " + u.usuario + ")"));
      if (c("ArcGIS_Estado") >= 0) h.getRange(n, c("ArcGIS_Estado") + 1).setValue(resultadoArcgis === "eliminado" ? "ELIMINADO " + ahora + " por " + u.usuario : texto_(r[c("ArcGIS_Estado")]));
      const fileId = r[c("FileId")];
      // La foto va a la papelera de Drive (se puede recuperar 30 días). Un PDF compartido por otros puntos activos se deja.
      if (fileId) {
        const otros = datos.some(function (x, k) { return k !== fila && k > 0 && texto_(x[c("FileId")]) === texto_(fileId) && !inactivo_(x[c("EstadoRegistro")]); });
        if (!otros) { try { DriveApp.getFileById(String(fileId)).setTrashed(true); } catch (_) {} }
      }
    }
    return { status: "success", id: id, fid: fid, arcgis: resultadoArcgis };
  } finally {
    lock.releaseLock();
  }
}

/** Restaura en ArcGIS un punto eliminado desde VIP-C (copia de la hoja «Eliminados»).
 *  Cambia ID_O_FID por el ID del registro (ej. F-000123) o el FID de ArcGIS y ejecútala desde el editor. */
function restaurarPuntoEliminado() {
  const ID_O_FID = "F-000000";
  const he = hojaEliminados_(), filas = he.getDataRange().getValues();
  let k = -1;
  for (let i = filas.length - 1; i >= 1; i--) if (texto_(filas[i][2]) === ID_O_FID || texto_(filas[i][3]) === ID_O_FID) { k = i; break; }
  if (k < 0) { Logger.log("No está en la hoja Eliminados: " + ID_O_FID); return; }
  if (texto_(filas[k][7])) { Logger.log("Ya se había restaurado: " + filas[k][7]); return; }
  const attrs = JSON.parse(filas[k][5] || "{}"), geom = JSON.parse(filas[k][6] || "null");
  ["OBJECTID", "FID", "GlobalID", "globalid", "objectid"].forEach(function (x) { delete attrs[x]; });
  const token = tokenArcgis_();
  const pl = { features: JSON.stringify([{ attributes: attrs, geometry: geom }]), f: "json" }; if (token) pl.token = token;
  const d = JSON.parse(UrlFetchApp.fetch(arcgisUrl_() + "/addFeatures", { method: "post", payload: pl, muteHttpExceptions: true }).getContentText() || "{}");
  const r = d.addResults && d.addResults[0];
  if (!r || !r.success) { Logger.log("No se pudo restaurar: " + JSON.stringify(d).slice(0, 300)); return; }
  const ahora = Utilities.formatDate(new Date(), "America/Bogota", "yyyy-MM-dd HH:mm:ss");
  he.getRange(k + 1, 8).setValue("Restaurado " + ahora + " · FID nuevo " + r.objectId);
  // El registro vuelve a quedar activo, con su foto (si sigue en la papelera de Drive)
  const id = texto_(filas[k][2]);
  if (id) {
    const h = hoja_(), datos = h.getDataRange().getValues(), enc = datos[0], c = function (n) { return enc.indexOf(n) + 1; };
    for (let i = datos.length - 1; i >= 1; i--) if (texto_(datos[i][0]) === id) {
      h.getRange(i + 1, c("EstadoRegistro")).setValue("ACTIVO");
      h.getRange(i + 1, c("ArcGIS_FID")).setValue(r.objectId);
      h.getRange(i + 1, c("ArcGIS_Estado")).setValue("RESTAURADO " + ahora);
      const fileId = datos[i][c("FileId") - 1];
      if (fileId) {
        try {
          const f = DriveApp.getFileById(String(fileId)); f.setTrashed(false);
          const fa = { attachment: f.getBlob(), f: "json" }; if (token) fa.token = token;
          UrlFetchApp.fetch(arcgisUrl_() + "/" + r.objectId + "/addAttachment", { method: "post", payload: fa, muteHttpExceptions: true });
        } catch (_) {}
      }
      break;
    }
  }
  Logger.log("Restaurado " + ID_O_FID + " con FID nuevo " + r.objectId);
}

/* ======================= Lectura de registros ======================= */

function listarRegistros_() {
  const hoja = hoja_();
  const datos = hoja.getDataRange().getValues();
  if (datos.length < 2) return [];
  const enc = datos[0];
  return datos.slice(1).map(function (fila) {
    const o = {};
    enc.forEach(function (c, i) { o[c] = fila[i] instanceof Date ? Utilities.formatDate(fila[i], "America/Bogota", "yyyy-MM-dd") : fila[i]; });
    return o;
  }).filter(function (o) { return !inactivo_(o.EstadoRegistro); });
}

function aGeoJSON_(registros) {
  return {
    type: "FeatureCollection",
    features: registros.filter(function (r) { return r.Latitud !== "" && r.Longitud !== ""; }).map(function (r) {
      return { type: "Feature", geometry: { type: "Point", coordinates: [Number(r.Longitud), Number(r.Latitud)] }, properties: r };
    })
  };
}

function aCSV_(registros) {
  const q = function (v) { v = v === null || v === undefined ? "" : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return [COLUMNAS.join(",")].concat(registros.map(function (r) { return COLUMNAS.map(function (c) { return q(r[c]); }).join(","); })).join("\n");
}

/* ======================= Utilidades ======================= */

function dmsADecimal_(s) {
  if (s === null || s === undefined || s === "") return null;
  s = String(s).replace(/,/g, ".").trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*[°º]?\s*(?:(\d+(?:\.\d+)?)\s*['′’]?)?\s*(?:(\d+(?:\.\d+)?)\s*["″”]?)?\s*([NSEWOnsewo])?/);
  if (!m) return null;
  let v = Math.abs(Number(m[1])) + Number(m[2] || 0) / 60 + Number(m[3] || 0) / 3600;
  const h = (m[4] || "").toUpperCase();
  if (h === "S" || h === "W" || h === "O" || Number(m[1]) < 0) v = -v;
  return Math.round(v * 1e6) / 1e6;
}

function fueraDeAntioquia_(lat, lon) {
  if (lat === null || lon === null) return false;
  return lat < ANTIOQUIA.latMin || lat > ANTIOQUIA.latMax || lon < ANTIOQUIA.lonMin || lon > ANTIOQUIA.lonMax;
}

function hoja_() {
  const ss = SpreadsheetApp.openById(prop_("SPREADSHEET_ID"));
  let h = ss.getSheetByName(HOJA);
  if (!h) h = ss.insertSheet(HOJA);
  if (h.getLastRow() === 0) {
    h.appendRow(COLUMNAS);
    h.getRange(1, 1, 1, COLUMNAS.length).setFontWeight("bold");
    h.setFrozenRows(1);
  } else if (h.getLastColumn() < COLUMNAS.length) {
    // Hoja creada con una versión anterior: agrega los encabezados nuevos
    h.getRange(1, 1, 1, COLUMNAS.length).setValues([COLUMNAS]).setFontWeight("bold");
  }
  return h;
}

function siguienteId_(hoja) {
  const ultima = hoja.getLastRow();
  if (ultima <= 1) return "F-000001";
  const m = String(hoja.getRange(ultima, 1).getValue()).match(/F-(\d+)/);
  const n = m ? Number(m[1]) + 1 : ultima;
  return "F-" + String(n).padStart(6, "0");
}

function carpeta_(padre, nombre) {
  const it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

function validarToken_(t) {
  const esperado = prop_("APP_TOKEN", true);
  if (esperado && t !== esperado) throw new Error("Clave de acceso inválida.");
}

function prop_(nombre, opcional) {
  const v = PropertiesService.getScriptProperties().getProperty(nombre);
  if (!v && !opcional) throw new Error("Falta configurar la propiedad del script " + nombre + ".");
  return v;
}

function limpiar_(s) { return String(s || "").trim().replace(/[\/\\:*?"<>|]/g, "_").slice(0, 120) || "SIN_NOMBRE"; }
function texto_(v) { return v === null || v === undefined ? "" : String(v).trim(); }
function numero_(v) { if (v === null || v === undefined || v === "") return null; const n = Number(v); return isNaN(n) ? null : n; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ======================= Ayudas para el administrador ======================= */
/** Ejecuta en el editor para ver por qué un usuario no puede entrar. Cambia "laura" por el usuario. */
function diagnosticarUsuario() {
  const USUARIO = "laura";
  const u = leerUsuarios_();
  Logger.log("Columnas encontradas: " + JSON.stringify(u.col));
  const r = buscarUsuario_(USUARIO);
  if (!r) { Logger.log("No existe el usuario «" + USUARIO + "». Usuarios en la hoja: " + u.filas.map(function (f) { return "«" + f.t[u.col["Usuario"]] + "»"; }).join(", ")); return; }
  Logger.log("Usuario: «" + r.usuario + "» · Nombre: «" + r.nombre + "» · Activo: " + (r.activo ? "SÍ" : "NO (escribe SI en la columna Activo)"));
  Logger.log("ContraseñaNueva pendiente: " + (r.nueva ? "sí (" + r.nueva.length + " caracteres, se cifra en el próximo ingreso)" : "no"));
  Logger.log("Clave cifrada guardada: " + (r.hash ? (r.hash.indexOf("h1$") === 0 ? "sí" : "sí, pero en formato antiguo o dañado: escribe una ContraseñaNueva") : "no (escribe una ContraseñaNueva)"));
  const bloqueo = CacheService.getScriptCache().get("fallos_" + normUsuario_(USUARIO));
  Logger.log("Intentos fallidos recientes: " + (bloqueo || 0) + (Number(bloqueo) >= INTENTOS_MAX ? " → BLOQUEADO (ejecuta desbloquearUsuario)" : ""));
}

/** Quita el bloqueo por intentos fallidos. Cambia "laura" por el usuario. */
function desbloquearUsuario() {
  const USUARIO = "laura";
  CacheService.getScriptCache().remove("fallos_" + normUsuario_(USUARIO));
  const r = buscarUsuario_(USUARIO);
  if (r) { CacheService.getScriptCache().remove("fallos_" + normUsuario_(r.usuario)); CacheService.getScriptCache().remove("fallos_" + normUsuario_(r.nombre)); }
  Logger.log("Desbloqueado: " + USUARIO);
}

/* ======================= Prueba de Gemini ======================= */
/** Ejecútala desde el editor (Ejecutar → probarGemini) si la página dice «Gemini no respondió».
 *  Muestra en el registro qué modelo se usa y la respuesta exacta de Gemini. */
/** OCR de Google Drive: no usa la cuota de Gemini. Sube la imagen como documento de Google (Drive hace el OCR), lee el texto y borra el archivo.
 *  Requiere activar el servicio «Drive API» en Apps Script (Servicios → + → Drive API), que habilita la API para este proyecto. */
function ocrGoogle_(payload) {
  const imagenes = [payload.recorte, payload.base64].filter(function (s) { return typeof s === "string" && s.length > 100; });
  if (!imagenes.length) throw new Error("No llegó la imagen.");
  const token = ScriptApp.getOAuthToken(), auth = { Authorization: "Bearer " + token };
  let texto = "";
  for (let i = 0; i < imagenes.length; i++) {
    let id = "";
    try {
      const borde = "vipc" + Date.now() + i;
      const meta = JSON.stringify({ name: "vipc_ocr_tmp", mimeType: "application/vnd.google-apps.document" });
      const cabeza = Utilities.newBlob("--" + borde + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta + "\r\n--" + borde + "\r\nContent-Type: image/jpeg\r\n\r\n").getBytes();
      const cola = Utilities.newBlob("\r\n--" + borde + "--").getBytes();
      const cuerpo = cabeza.concat(Utilities.base64Decode(imagenes[i])).concat(cola);
      const up = UrlFetchApp.fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&ocrLanguage=es&fields=id", {
        method: "post", contentType: "multipart/related; boundary=" + borde, payload: cuerpo, headers: auth, muteHttpExceptions: true });
      if (up.getResponseCode() !== 200) {
        if (up.getResponseCode() === 403) return { status: "error", message: "Falta activar el servicio Drive API en Apps Script (Servicios → + → Drive API)." };
        continue;
      }
      id = JSON.parse(up.getContentText()).id;
      const ex = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files/" + id + "/export?mimeType=text%2Fplain", { headers: auth, muteHttpExceptions: true });
      if (ex.getResponseCode() === 200) texto += "\n" + ex.getContentText();
    } catch (e) { /* se prueba con la otra imagen */ }
    finally { if (id) { try { UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files/" + id, { method: "delete", headers: auth, muteHttpExceptions: true }); } catch (_) {} } }
    if (/\d{1,2}\s*[°º]?\s*\d{1,2}.{0,6}\d{2,3}\s*[°º]?/.test(texto) && /\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}|\d{4}/.test(texto)) break; // ya trae fecha y coordenadas
  }
  return { status: "success", texto: texto.replace(/\uFEFF/g, "").trim() };
}

/** Estado real de Gemini para la página (se recuerda 10 minutos para no gastar cuota). */
function estadoIA_() {
  const cache = CacheService.getScriptCache(), previo = cache.get("estado_ia");
  if (previo) return JSON.parse(previo);
  let r;
  const key = prop_("GEMINI_API_KEY", true);
  if (!key) r = { status: "success", ok: false, motivo: "falta la clave de Gemini (GEMINI_API_KEY)" };
  else {
    try {
      const modelo = prop_("GEMINI_MODEL", true) || "gemini-3.5-flash-lite";
      const res = geminiRapido_(key, modelo, { contents: [{ parts: [{ text: "Responde solo: ok" }] }] });
      const code = res.getResponseCode();
      const detalle = code === 200 ? "" : " (" + String(errorGemini_(res)).slice(0, 160) + ")";
      r = code === 200 ? { status: "success", ok: true }
        : { status: "success", ok: false, motivo: code === 429 ? "Google rechazó por límite de cuota" + detalle : code === 404 ? "el modelo de Gemini no existe para tu clave" : (code === 400 || code === 403) ? "la clave de Gemini no es válida o no tiene permiso" : "Gemini respondió error " + code };
    } catch (e) { r = { status: "success", ok: false, motivo: "no se pudo consultar a Gemini" }; }
  }
  cache.put("estado_ia", JSON.stringify(r), r.ok ? 600 : 120);
  return r;
}

function probarGemini() {
  const key = prop_("GEMINI_API_KEY", true);
  if (!key) { Logger.log("Falta la propiedad GEMINI_API_KEY (Configuración del proyecto → Propiedades del script)."); return; }
  const modelos = [prop_("GEMINI_MODEL", true) || "gemini-3.5-flash-lite"];
  if (prop_("GEMINI_MODEL_PRECISO", true)) modelos.push(prop_("GEMINI_MODEL_PRECISO", true));
  modelos.forEach(function (modelo) {
    const body = { contents: [{ parts: [{ text: "Responde solo este JSON: {\"ok\":true}" }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } };
    const t0 = Date.now();
    const res = geminiRapido_(key, modelo, body);
    const code = res.getResponseCode();
    Logger.log("Modelo «" + modelo + "» → " + code + " en " + (Date.now() - t0) + " ms · " + (code === 200 ? "FUNCIONA" : errorGemini_(res)));
  });
  // Modelos disponibles para esta clave (para escoger uno si el configurado no existe)
  try {
    const l = JSON.parse(UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key }, muteHttpExceptions: true }).getContentText());
    const nombres = (l.models || []).filter(function (m) { return (m.supportedGenerationMethods || []).indexOf("generateContent") >= 0; })
      .map(function (m) { return String(m.name).replace("models/", ""); }).filter(function (n) { return /flash|pro/.test(n); });
    Logger.log("Modelos disponibles: " + (nombres.join(", ") || JSON.stringify(l).slice(0, 200)));
  } catch (e) { Logger.log("No se pudo listar los modelos: " + e.message); }
}

/* ======================= Prueba manual ======================= */
/** Ejecuta esta función desde el editor para verificar la configuración. */
function probarConfiguracion() {
  ["GEMINI_API_KEY", "ROOT_FOLDER_ID", "SPREADSHEET_ID"].forEach(function (k) { prop_(k); });
  DriveApp.getFolderById(prop_("ROOT_FOLDER_ID")).getName();
  hoja_();
  hojaUsuarios_();
  hojaEmpresas_();
  secreto_();
  Logger.log("Configuración correcta. Modelo: " + (prop_("GEMINI_MODEL", true) || "gemini-3.5-flash-lite") +
    ". Ahora agrega usuarios en la hoja «Usuarios» del Sheet.");
}
