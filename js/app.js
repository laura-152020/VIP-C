/* VIP-C — Visor interactivo de puntos críticos · Gobernación de Antioquia
 * 1) Carga manual de datos  ·  2) Carga fotográfica con relleno automático (lectura del sello)
 * Guardado: Apps Script (Drive + Sheets) si hay API_URL configurada; si no, en el navegador del dispositivo.
 */
(function () {
  "use strict";

  /* ======================= Catálogos ======================= */
  const TIPOS_AFECTACION = [
    "Deslizamiento / movimiento en masa", "Pérdida de banca", "Hundimiento de la vía",
    "Socavación", "Caída de rocas", "Obstrucción de drenaje o alcantarilla", "Daño en puente o pontón",
    "Daño en muro de contención", "Deterioro de la calzada (baches)", "Inundación", "Árbol caído", "Otro"
  ];
  const RESPONSABLES = ["Gobernación", "Rentan", "Alcaldía", "Ciudadanía"];
  const ESTADOS = ["Crítico", "No crítico"];
  const ANTIOQUIA = { latMin: 5.40, latMax: 8.90, lonMin: -77.15, lonMax: -73.85 };
  const HAY_BACKEND = typeof CONFIG !== "undefined" && !!CONFIG.API_URL;

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  let items = [];
  let sec = 1;

  /* ======================= Municipios ======================= */
  const MUN_POR_NOMBRE = {};
  MUNICIPIOS.forEach((m) => { MUN_POR_NOMBRE[norm(m.n)] = m; });
  // Alias comunes
  [["santa fe de antioquia", "santafe de antioquia"], ["carolina del principe", "carolina"], ["el penol", "penol"], ["el retiro", "retiro"],
   ["san vicente ferrer", "san vicente"], ["el santuario", "santuario"], ["donmatias", "don matias"], ["entrerrios", "entre rios"]]
    .forEach(([a, b]) => { if (MUN_POR_NOMBRE[a]) MUN_POR_NOMBRE[b] = MUN_POR_NOMBRE[a]; });
  $("#lista-municipios").innerHTML = MUNICIPIOS.map((m) => `<option value="${esc(m.n)}">`).join("");

  function enAnillo(x, y, r) {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function municipioEn(lat, lon) {
    if (lat == null || lon == null) return null;
    for (const m of MUNICIPIOS) for (const p of m.p) {
      if (enAnillo(lon, lat, p[0]) && !p.slice(1).some((h) => enAnillo(lon, lat, h))) return m;
    }
    return null;
  }

  /* ======================= Coordenadas ======================= */
  function dmsADecimal(s) {
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
  function decimalADMS(v, esLat) {
    if (v == null || isNaN(v)) return "";
    const a = Math.abs(v), g = Math.floor(a), mf = (a - g) * 60, m = Math.floor(mf), s = Math.round((mf - m) * 60 * 10) / 10;
    return `${g}°${m}'${s}"${esLat ? (v < 0 ? "S" : "N") : (v < 0 ? "W" : "E")}`;
  }
  const tieneCoord = (r) => r.latitud != null && r.longitud != null && !isNaN(r.latitud) && !isNaN(r.longitud);
  const fuera = (r) => tieneCoord(r) && (r.latitud < ANTIOQUIA.latMin || r.latitud > ANTIOQUIA.latMax || r.longitud < ANTIOQUIA.lonMin || r.longitud > ANTIOQUIA.lonMax);

  function nuevoRegistro(extra) {
    return Object.assign({
      id: sec++, origen: "manual", estado: "manual", mensaje: "",
      fecha: "", fechaTexto: "", latitudDMS: "", longitudDMS: "", latitud: null, longitud: null, origenUbicacion: "",
      codigoVia: "", nombreTramo: "", subregion: "", municipio: "", municipioAuto: false,
      tipoAfectacion: "", responsable: "", estadoPunto: "", observaciones: "", selloLegible: false
    }, extra || {});
  }

  // Al tener coordenadas, sugiere municipio y subregión (si el usuario no los escribió a mano)
  function completarDesdeCoordenadas(r) {
    if (!tieneCoord(r)) return;
    if (r.municipio && !r.municipioAuto) return;
    const m = municipioEn(r.latitud, r.longitud);
    if (m) { r.municipio = m.n; r.subregion = m.s; r.municipioAuto = true; }
  }
  /* Capas de ArcGIS (red vial y división política): completan vía, municipio, subregión y vereda.
     Solo llenan campos vacíos o que se llenaron solos; lo que la persona escribió no se toca. */
  async function enriquecer(r, repintar) {
    if (!tieneCoord(r) || typeof Capas === "undefined") return;
    const lat = r.latitud, lon = r.longitud;
    let info = null;
    try { info = await Capas.enPunto(lat, lon); } catch (_) { return; }
    if (!info || r.latitud !== lat || r.longitud !== lon) return; // cambiaron las coordenadas mientras tanto
    let cambio = false;
    const m = info.municipio && MUN_POR_NOMBRE[norm(info.municipio)];
    if (m && (r.municipioAuto || !r.municipio)) {
      r.municipio = m.n; r.subregion = m.s; r.municipioAuto = true; cambio = true;
      // El municipio ya viene de la capa oficial: el aviso de límites aproximados deja de aplicar
      if (/menciona .* y las coordenadas caen en/.test(r.mensaje || "")) r.mensaje = "";
    }
    const sub = info.subregion && SUBREGIONES.find((x) => norm(x) === norm(info.subregion));
    if (sub && r.municipioAuto && r.subregion !== sub) { r.subregion = sub; cambio = true; }
    const bonito = (t) => (t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(De|Del|La|Las|Los|El|Y)\b/g, (x) => x.toLowerCase()).replace(/^./, (c) => c.toUpperCase()) : t);
    const vereda = info.vereda ? bonito(info.vereda) : "";
    if (vereda && r.vereda !== vereda) { r.vereda = vereda; cambio = true; }
    const v = info.via;
    if (v) {
      const libre = r.viaAuto || (!String(r.codigoVia).trim() && !String(r.nombreTramo).trim());
      if (libre) { r.codigoVia = v.codigo; r.nombreTramo = v.nombre; r.viaAuto = true; cambio = true; }
      else if (!String(r.codigoVia).trim() && v.codigo) { r.codigoVia = v.codigo; cambio = true; } // ej. el sello trae el tramo pero no el código
      if (r.tramoDe === "ocr" && v.nombre && LectorSello.parecido(v.nombre, r.nombreTramo) >= 0.6) { r.nombreTramo = v.nombre; r.tramoDe = "redvial"; cambio = true; }
      r.viaInfo = `vía ${v.orden.toLowerCase()} a ${Math.round(v.distancia)} m`;
    }
    if (cambio || v) repintarSinPerderFoco(r, repintar);
  }
  // Relación código ↔ nombre de la red vial: al escribir uno, se completa el otro
  async function relacionarVia(r, k, repintar) {
    if (typeof Capas === "undefined") return;
    const texto = String(r[k] || "").trim();
    if (!texto) return;
    const avisar = (t, error) => { if (r === manual) msgManual(t, error); else if (regPdf() === r) msgPdf(t, error); };
    try {
      avisar("Buscando en la red vial…");
      const v = k === "codigoVia" ? await Capas.porCodigo(r.codigoVia) : await Capas.porNombre(r.nombreTramo);
      if (!v) { avisar(`No se encontró «${texto}» en la red vial (Circular 10). Revisa cómo está escrito o llena el otro campo a mano.`, true); return; }
      avisar(`Red vial: ${v.codigo} · ${v.nombre} (${v.orden.toLowerCase()}).`);
      const otro = k === "codigoVia" ? "nombreTramo" : "codigoVia";
      if (String(r[otro]).trim() && !(r.relAuto && r.relCampo === otro)) return;
      r[otro] = k === "codigoVia" ? v.nombre : v.codigo; r.relAuto = true; r.relCampo = otro;
      r[k] = k === "codigoVia" ? v.codigo : v.nombre; // escrito como en la red vial
      repintarSinPerderFoco(r, repintar);
    } catch (_) { avisar("No se pudo consultar la red vial. Revisa la conexión a internet.", true); }
  }
  function repintarSinPerderFoco(r, repintar) {
    const caja = r === manual ? $("#form-manual") : regPdf() === r ? $("#form-pdf") : document.querySelector(`.card[data-id="${r.id}"]`);
    const a = document.activeElement;
    if (caja && a && caja.contains(a) && a.matches("input,textarea") && a.value !== "") {
      // La persona está escribiendo en ese mismo formulario: solo se actualizan los otros campos
      ["codigoVia", "nombreTramo", "municipio", "subregion"].forEach((k) => { const el = $(`[data-k="${k}"]`, caja); if (el && el !== a) el.value = r[k] || ""; });
      const c = $("[data-coord]", caja); if (c) c.innerHTML = lineaCoord(r);
      return;
    }
    repintar();
  }
  // Listas desplegables de códigos y nombres de la red vial
  function cargarListasVias() {
    if (typeof Capas === "undefined") return;
    if (HAY_BACKEND) Capas.usarServidor((capa, ruta, params) => Api.post("arcgis", { capa, ruta, params }));
    Capas.listas().then((l) => {
      $("#lista-vias-cod").innerHTML = l.codigos.map((v) => `<option value="${esc(v.codigo)}">${esc(v.nombre)}</option>`).join("");
      $("#lista-vias-nom").innerHTML = l.nombres.map((v) => `<option value="${esc(v.nombre)}">${esc(v.codigo)}</option>`).join("");
    }).catch(() => {});
  }

  function completarSubregion(r) {
    const m = MUN_POR_NOMBRE[norm(r.municipio)];
    if (m) { r.municipio = m.n; r.subregion = m.s; }
  }

  /* ======================= Campos (compartidos: manual y tarjetas) ======================= */
  function opciones(arr, v) {
    return '<option value="">Seleccionar…</option>' + arr.map((o) => `<option${o === v ? " selected" : ""}>${esc(o)}</option>`).join("");
  }
  function lineaCoord(r) {
    if (!tieneCoord(r)) return "Sin coordenadas";
    const origen = { pdf: "leídas del PDF", sello: "leídas del sello", gps: "GPS de la foto", dispositivo: "ubicación del dispositivo", manual: "escritas a mano", servidor: "leídas del sello" }[r.origenUbicacion] || "";
    const extra = [r.vereda && "Vereda " + esc(r.vereda), r.viaInfo && esc(r.viaInfo)].filter(Boolean).join(" · ");
    return `${r.latitud.toFixed(6)}, ${r.longitud.toFixed(6)}${origen ? " · " + origen : ""}${extra ? " · " + extra : ""} <a href="https://www.google.com/maps?q=${r.latitud},${r.longitud}" target="_blank" rel="noopener">Ver ubicación</a>`;
  }
  function campos(r, p) {
    const alerta = fuera(r) ? '<div class="alerta">La ubicación cae fuera de Antioquia. Verifica las coordenadas.</div>' : "";
    return `
      <div class="grid">
        <label for="${p}fe"><span>Fecha de la visita <em>*</em></span><input id="${p}fe" type="date" data-k="fecha" value="${esc(r.fecha)}"></label>
        <label for="${p}la"><span>Latitud</span><input id="${p}la" class="mono" data-k="latitudDMS" value="${esc(r.latitudDMS)}" placeholder="6°10'42&quot;N" inputmode="text"></label>
        <label for="${p}lo"><span>Longitud</span><input id="${p}lo" class="mono" data-k="longitudDMS" value="${esc(r.longitudDMS)}" placeholder="75°9'57&quot;W" inputmode="text"></label>
      </div>
      <div class="coord" data-coord>${lineaCoord(r)}</div>${alerta}
      <div class="grid grid--2">
        <label for="${p}cv"><span>Código oficial de la vía ${r.viaAuto ? '<span class="auto">· red vial</span>' : ""}</span><input id="${p}cv" class="mono" data-k="codigoVia" value="${esc(r.codigoVia)}" placeholder="Ej. 60AN17" autocomplete="off" list="lista-vias-cod"></label>
        <label for="${p}nt"><span>Nombre del tramo ${r.viaAuto ? '<span class="auto">· red vial</span>' : ""}</span><input id="${p}nt" data-k="nombreTramo" value="${esc(r.nombreTramo)}" placeholder="Ej. Medellín - Turbo" autocomplete="off" list="lista-vias-nom"></label>
      </div>
      <div class="grid grid--2">
        <label for="${p}sr"><span>Subregión ${r.municipioAuto ? '<span class="auto">· automática</span>' : ""}</span><select id="${p}sr" data-k="subregion">${opciones(SUBREGIONES, r.subregion)}</select></label>
        <label for="${p}mu"><span>Municipio <em>*</em> ${r.municipioAuto ? '<span class="auto">· automático</span>' : ""}</span><input id="${p}mu" data-k="municipio" value="${esc(r.municipio)}" list="lista-municipios" placeholder="Escribe el municipio" autocomplete="off" autocapitalize="words"></label>
      </div>
      <div class="grid grid--2">
        <label for="${p}ta"><span>Tipo de afectación <em>*</em></span><select id="${p}ta" data-k="tipoAfectacion">${opciones(TIPOS_AFECTACION, r.tipoAfectacion)}</select></label>
        <label for="${p}re"><span>Responsable de la visita <em>*</em></span><select id="${p}re" data-k="responsable">${opciones(RESPONSABLES, r.responsable)}</select></label>
      </div>
      <label for="${p}ob"><span>Observaciones</span><textarea id="${p}ob" data-k="observaciones">${esc(r.observaciones)}</textarea></label>`;
  }

  // Edición genérica: aplica a la carga manual y a cada tarjeta
  function alEditar(r, el, contenedor, rerender) {
    const k = el.dataset.k; if (!k) return;
    r[k] = el.value;
    el.classList.remove("is-invalid");
    if (k === "estadoPunto") el.dataset.v = el.value;
    if (k === "latitudDMS" || k === "longitudDMS") {
      r.latitud = dmsADecimal(r.latitudDMS);
      let lo = dmsADecimal(r.longitudDMS);
      if (lo != null && lo > 60) lo = -lo; // Antioquia: longitud Oeste
      r.longitud = lo;
      r.origenUbicacion = "manual";
      const c = $("[data-coord]", contenedor); if (c) c.innerHTML = lineaCoord(r);
    }
    if (k === "nombreTramo") r.tramoDe = "";
    if (k === "codigoVia" || k === "nombreTramo") { r.viaAuto = false; r.viaInfo = ""; if (k === r.relCampo) r.relAuto = false; }
    if (k === "municipio") { r.municipioAuto = false; const m = MUN_POR_NOMBRE[norm(r.municipio)]; if (m) { r.subregion = m.s; const s = $('[data-k="subregion"]', contenedor); if (s) s.value = m.s; } }
  }
  function alCambiar(r, el, rerender) {
    const k = el.dataset.k; if (!k) return;
    if (k === "municipio") { completarSubregion(r); rerender(); }
    if ((k === "latitudDMS" || k === "longitudDMS") && tieneCoord(r)) {
      if (!r.latitudDMS.includes("°") && !/[NS]/i.test(r.latitudDMS)) r.latitudDMS = decimalADMS(r.latitud, true);
      if (!r.longitudDMS.includes("°") && !/[WOE]/i.test(r.longitudDMS)) r.longitudDMS = decimalADMS(r.longitud, false);
      completarDesdeCoordenadas(r); rerender();
      enriquecer(r, rerender);
    }
    if (k === "codigoVia" || k === "nombreTramo") relacionarVia(r, k, rerender);
  }

  /* ======================= Validación ======================= */
  function faltantes(r) {
    const f = [];
    if (!r.fecha) f.push("fecha");
    if (!String(r.municipio).trim()) f.push("municipio");
    if (!r.tipoAfectacion) f.push("tipoAfectacion");
    if (!r.responsable) f.push("responsable");
    if (!String(r.codigoVia).trim() && !String(r.nombreTramo).trim()) f.push("codigoVia", "nombreTramo");
    return f;
  }
  const NOMBRES = { fecha: "fecha", municipio: "municipio", tipoAfectacion: "tipo de afectación", responsable: "responsable", estadoPunto: "estado", codigoVia: "código de la vía o nombre del tramo" };
  function marcar(contenedor, f) {
    f.forEach((k) => { const el = $(`[data-k="${k}"]`, contenedor); if (el) el.classList.add("is-invalid"); });
  }
  function textoFaltantes(f) { return [...new Set(f.filter((k) => k !== "nombreTramo").map((k) => NOMBRES[k]))].join(", "); }

  /* ======================= 1. Carga manual ======================= */
  let manual = nuevoRegistro({ fecha: hoy() });
  const formManual = $("#form-manual");
  function pintarManual() { formManual.innerHTML = campos(manual, "m-"); }
  formManual.addEventListener("input", (e) => alEditar(manual, e.target, formManual, pintarManual));
  formManual.addEventListener("change", (e) => alCambiar(manual, e.target, pintarManual));

  function msgManual(t, error) { const m = $("#m-msg"); m.textContent = t; m.style.color = error ? "var(--err)" : ""; }

  $("#m-ubicacion").addEventListener("click", () => {
    if (!navigator.geolocation) { msgManual("Este navegador no permite obtener la ubicación.", true); return; }
    msgManual("Obteniendo ubicación…");
    navigator.geolocation.getCurrentPosition((pos) => {
      manual.latitud = Math.round(pos.coords.latitude * 1e6) / 1e6;
      manual.longitud = Math.round(pos.coords.longitude * 1e6) / 1e6;
      manual.latitudDMS = decimalADMS(manual.latitud, true);
      manual.longitudDMS = decimalADMS(manual.longitud, false);
      manual.origenUbicacion = "dispositivo";
      completarDesdeCoordenadas(manual);
      pintarManual();
      enriquecer(manual, pintarManual);
      msgManual(`Ubicación tomada (precisión aprox. ${Math.round(pos.coords.accuracy)} m).`);
    }, (err) => {
      const enMarco = window.self !== window.top; // VIP-C dentro de ArcGIS Experience: el visor puede no compartir la ubicación
      msgManual((err.code === 1 ? "Permiso de ubicación denegado. Escribe las coordenadas a mano." : "No se pudo obtener la ubicación. Escribe las coordenadas a mano.")
        + (enMarco ? " Si estás dentro del visor de ArcGIS, abre VIP-C en una pestaña aparte para usar tu ubicación." : ""), true);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });

  $("#m-agregar").addEventListener("click", () => {
    const f = faltantes(manual);
    if (f.length) { marcar(formManual, f); msgManual("Falta: " + textoFaltantes(f) + ".", true); return; }
    // Agregar NO guarda: el registro queda en «Registros» para verificarlo; se guarda con «Guardar datos»
    const r = Object.assign(manual, { estado: "listo", origen: "manual", enLista: true, verificado: false });
    items.unshift(r);
    manual = nuevoRegistro({ fecha: hoy(), responsable: r.responsable }); // el formulario queda en blanco
    pintarManual(); render();
    msgManual("Agregado a «Registros»: revísalo, marca «Verifiqué la información» y toca «Guardar datos».");
  });
  $("#m-limpiar").addEventListener("click", () => { manual = nuevoRegistro({ fecha: hoy() }); pintarManual(); msgManual(""); });

  /* ======================= 2. Carga fotográfica ======================= */
  async function optimizar(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = url; });
      const f = Math.min(1, (CONFIG.MAX_DIMENSION_PX || 2048) / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * f); cv.height = Math.round(img.height * f);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      const dataUrl = cv.toDataURL("image/jpeg", CONFIG.JPEG_QUALITY || 0.85);
      const t = Math.min(1, 520 / Math.max(img.width, img.height));
      const c2 = document.createElement("canvas");
      c2.width = Math.round(img.width * t); c2.height = Math.round(img.height * t);
      c2.getContext("2d").drawImage(img, 0, 0, c2.width, c2.height);
      // Copia más liviana solo para que Gemini lea el sello (se sube más rápido)
      const l = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c3 = document.createElement("canvas");
      c3.width = Math.round(img.width * l); c3.height = Math.round(img.height * l);
      c3.getContext("2d").drawImage(img, 0, 0, c3.width, c3.height);
      return { dataUrl, base64: dataUrl.split(",")[1], base64Lectura: c3.toDataURL("image/jpeg", 0.82).split(",")[1], miniatura: c2.toDataURL("image/jpeg", 0.75) };
    } finally { URL.revokeObjectURL(url); }
  }

  async function leerExif(file) {
    try {
      if (!window.exifr) return null;
      const d = await exifr.parse(file, { gps: true, pick: ["DateTimeOriginal", "latitude", "longitude"] });
      if (!d) return null;
      const f = d.DateTimeOriginal instanceof Date ? d.DateTimeOriginal : null;
      return {
        lat: typeof d.latitude === "number" ? Math.round(d.latitude * 1e6) / 1e6 : null,
        lon: typeof d.longitude === "number" ? Math.round(d.longitude * 1e6) / 1e6 : null,
        fecha: f ? `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}` : ""
      };
    } catch (_) { return null; }
  }

  async function agregarFotos(files) {
    const maxMB = CONFIG.MAX_FILE_SIZE_MB || 20;
    for (const f of files) {
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { aviso(f.name + " no es JPG, PNG ni WEBP.", true); continue; }
      if (f.size > maxMB * 1048576) { aviso(f.name + " supera " + maxMB + " MB.", true); continue; }
      let opt;
      try { opt = await optimizar(f); } catch (_) { aviso("No se pudo abrir " + f.name + ".", true); continue; }
      const r = nuevoRegistro({ origen: "foto", estado: "leyendo", nombreArchivo: f.name, dataUrl: opt.dataUrl, base64: opt.base64, base64Lectura: opt.base64Lectura, miniatura: opt.miniatura,
        responsable: manual.responsable || "" });
      r.exif = await leerExif(f);
      r.urlOriginal = URL.createObjectURL(f); // el lector usa la foto original: la copia recomprimida borra detalle del sello
      items.unshift(r);
      cola.push(r);
    }
    render();
    procesarCola();
  }

  const cola = [];
  let ocupado = false;
  async function procesarCola() {
    if (ocupado) return;
    ocupado = true;
    while (cola.length) await leer(cola.shift());
    ocupado = false;
  }

  let avisoPrimeraVez = true;
  async function leer(r) {
    r.estado = "leyendo"; actualizar(r);
    // Gemini (servidor) y el lector del navegador trabajan al mismo tiempo: se usa el primero que lea
    // el sello completo (fecha y coordenadas) y el otro solo completa lo que falte.
    let error = "";
    const completo = (x) => !!(x && x.fecha && x.latitud != null && !x.coordDudosa);
    const pGem = !HAY_BACKEND ? Promise.resolve(null) : Promise.race([
      Api.post("leer", { base64: r.base64Lectura || r.base64, mimeType: "image/jpeg" }).then((s) => s.status === "success"
        ? { fecha: s.fecha, fechaTexto: s.fechaTexto, latitud: s.latitud, longitud: s.longitud, latitudDMS: s.latitudDMS, longitudDMS: s.longitudDMS, tramo: LectorSello.corregirTramo(s.tramo || ""), codigoVia: s.codigoVia, municipioTexto: s.municipio, tipoAfectacion: s.tipoAfectacion }
        : null).catch(() => null),
      new Promise((ok) => setTimeout(() => ok(null), 30000)) // máximo 30 s esperando a Gemini
    ]);
    if (avisoPrimeraVez) { aviso("Preparando el lector de fotos. La primera vez tarda unos segundos."); avisoPrimeraVez = false; }
    const pOcr = LectorSello.leer(r.urlOriginal || r.dataUrl).catch((e) => { error = e.message || "No se pudo leer la foto."; return null; }).finally(() => aviso(""));
    const sinVacios = (x) => Object.fromEntries(Object.entries(x || {}).filter(([, v]) => v != null && v !== ""));
    const primero = await Promise.race([pGem.then((x) => ["gem", x]), pOcr.then((x) => ["ocr", x])]);
    const primeroFue = completo(primero[1]) ? primero[0] : "mezcla";
    let d, tarde = null;
    if (completo(primero[1])) {
      d = primero[1];
      tarde = primero[0] === "gem" ? pOcr : pGem; // el otro llega después y completa lo que falte
    } else {
      const otro = await (primero[0] === "gem" ? pOcr : pGem);
      const gem = primero[0] === "gem" ? primero[1] : otro, ocr = primero[0] === "gem" ? otro : primero[1];
      d = (gem || ocr) ? Object.assign({}, ocr || {}, sinVacios(gem)) : null; // como antes: Gemini manda sobre el lector
    }
    if (tarde) tarde.then((x) => {
      if (!x || r.estado === "guardado" || r.estado === "guardando") return;
      let cambio = false;
      if (x.tipoAfectacion && !r.tipoAfectacion && TIPOS_AFECTACION.includes(x.tipoAfectacion)) { r.tipoAfectacion = x.tipoAfectacion; cambio = true; }
      if (x.codigoVia && !r.codigoVia) { r.codigoVia = x.codigoVia; cambio = true; }
      // Gemini lee el nombre del tramo mejor que el lector del navegador: si el tramo salió del lector y nadie lo ha cambiado, se reemplaza
      if (x.tramo && (!r.nombreTramo || (r.tramoDe === "ocr" && x.tramo !== r.nombreTramo))) { r.nombreTramo = x.tramo; r.tramoDe = "gem"; cambio = true; }
      // Coordenadas: si las leyó el lector del navegador y Gemini las lee distinto, se confía en Gemini (salvo que la persona las haya cambiado)
      if (x.latitud != null && x.longitud != null && r.coordDe === "ocr" && r.origenUbicacion === "sello" &&
          Math.hypot((x.latitud - r.latitud) * 110574, (x.longitud - r.longitud) * 111320) > 5 && primeroFue === "ocr") {
        r.latitud = x.latitud; r.longitud = x.longitud;
        r.latitudDMS = x.latitudDMS && /[°NS]/.test(x.latitudDMS) ? x.latitudDMS : decimalADMS(x.latitud, true);
        r.longitudDMS = x.longitudDMS && /[°WOE]/.test(x.longitudDMS) ? x.longitudDMS : decimalADMS(x.longitud, false);
        r.coordDe = "gem"; cambio = true;
        enriquecer(r, () => actualizar(r));
      }
      if (cambio) repintarSinPerderFoco(r, () => actualizar(r));
    });
    d = d || {};
    if (d.fecha) { r.fecha = d.fecha; r.fechaTexto = d.fechaTexto || ""; }
    if (d.latitud != null && d.longitud != null) {
      r.latitud = d.latitud; r.longitud = d.longitud;
      r.latitudDMS = d.latitudDMS && /[°NS]/.test(d.latitudDMS) ? d.latitudDMS : decimalADMS(d.latitud, true);
      r.longitudDMS = d.longitudDMS && /[°WOE]/.test(d.longitudDMS) ? d.longitudDMS : decimalADMS(d.longitud, false);
      r.origenUbicacion = "sello"; r.coordDe = primeroFue === "gem" ? "gem" : "ocr";
    } else if (r.exif && r.exif.lat != null) {
      r.latitud = r.exif.lat; r.longitud = r.exif.lon;
      r.latitudDMS = decimalADMS(r.latitud, true); r.longitudDMS = decimalADMS(r.longitud, false);
      r.origenUbicacion = "gps";
    }
    if (!r.fecha && r.exif && r.exif.fecha) r.fecha = r.exif.fecha;
    if (d.tramo && !r.nombreTramo) { r.nombreTramo = d.tramo; r.tramoDe = primero && primero[0] === "gem" && completo(primero[1]) ? "gem" : "ocr"; }
    // Tramo leído por el lector del navegador: se corrige con el nombre más parecido de la red vial (Circular 10)
    if (r.tramoDe === "ocr" && typeof Capas !== "undefined") Capas.nombreParecido(r.nombreTramo, 0.7).then((v) => {
      if (!v || r.tramoDe !== "ocr" || r.estado === "guardado" || r.estado === "guardando") return;
      r.nombreTramo = v.nombre; r.tramoDe = "redvial";
      if (!r.codigoVia) r.codigoVia = v.codigo;
      repintarSinPerderFoco(r, () => actualizar(r));
    }).catch(() => {});
    if (d.codigoVia && !r.codigoVia) r.codigoVia = d.codigoVia;
    if (d.tipoAfectacion && !r.tipoAfectacion && TIPOS_AFECTACION.includes(d.tipoAfectacion)) r.tipoAfectacion = d.tipoAfectacion;
    completarDesdeCoordenadas(r);
    // Sin coordenadas: municipio por el nombre escrito en el sello (ej. "Grada el peñol" → El Peñol)
    if ((!r.municipio || r.municipioAuto) && !tieneCoord(r) && d.municipioTexto) {
      const m = MUN_POR_NOMBRE[norm(d.municipioTexto)];
      if (m) { r.municipio = m.n; r.subregion = m.s; r.municipioAuto = true; }
    }

    const dudosa = !!d.coordDudosa && r.origenUbicacion === "sello";
    // El sello nombra un municipio distinto al de las coordenadas: se avisa (los límites usados son aproximados)
    const otroMun = d.municipioTexto && r.municipio && norm(d.municipioTexto) !== norm(r.municipio) && r.municipioAuto ? d.municipioTexto : "";
    const leido = r.fecha && tieneCoord(r) && !dudosa;
    r.selloLegible = !!(d.fecha && d.latitud != null);
    r.estado = leido ? "listo" : "revisar";
    r.mensaje = error ? error + " Completa los datos a mano."
      : dudosa ? "Verifica las coordenadas: el sello se leyó con dudas. Compáralas con la foto (toca «Ampliar»)."
      : leido ? (otroMun ? `El sello menciona «${otroMun}» y las coordenadas caen en ${r.municipio}. Revisa el municipio.` : "") : (!tieneCoord(r) && r.fecha && r.municipio
        ? "La foto no trae coordenadas. El municipio se tomó del texto del sello; agrega las coordenadas si las tienes."
        : "No se leyó todo el sello. Completa " + [!r.fecha && "la fecha", !tieneCoord(r) && "las coordenadas"].filter(Boolean).join(" y ") + ".");
    actualizar(r);
    enriquecer(r, () => actualizar(r));
  }

  function aviso(texto, error) {
    const a = $("#aviso");
    a.textContent = texto || "";
    a.className = "aviso" + (error ? " is-error" : "");
    a.hidden = !texto;
  }


  /* ======================= 3. Carga desde PDF (acta de visita técnica) ======================= */
  function aBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  // Municipio escrito en el acta (ej. «MUNICIPIO Medellín/San Jerónimo VÍA …»)
  function municipiosDelTexto(plano) {
    const m = String(plano || "").match(/MUNICIPIO\s+(.{3,70}?)\s+(?:V[IÍ]A\b|C[OÓ]DIGO)/i);
    if (!m) return [];
    return m[1].split(/\s*(?:\/|,|;|\sy\s|\s-\s)\s*/).map((x) => MUN_POR_NOMBRE[norm(x)]).filter(Boolean);
  }

  // Sección 3: igual a la carga manual, pero los campos se llenan desde el PDF.
  // Un acta puede traer varios tramos (uno por coordenada): se elige cada uno con los botones de tramo.
  const formPdf = $("#form-pdf");
  let pdfActual = null;           // { nombre, base64, fileId, doc, d }
  let tramosPdf = [];             // un registro por tramo
  let selPdf = 0;
  let vacioPdf = nuevoRegistro({ origen: "pdf" });
  const regPdf = () => tramosPdf[selPdf] || vacioPdf;

  function msgPdf(t, error) { const m = $("#p-msg"); m.textContent = t || ""; m.style.color = error ? "var(--err)" : ""; }
  function pintarPdf() {
    const r = regPdf();
    // Mientras se leen las fotos del PDF, un tramo sin coordenadas no es un error todavía: se avisa que espere
    const esperando = pdfActual && pdfActual.leyendoFotos && !tieneCoord(r) && r.mensaje && /coordenadas/.test(r.mensaje);
    formPdf.innerHTML = (esperando ? '<div class="info"><span class="girando" aria-hidden="true"></span>Leyendo las imágenes del PDF para encontrar las coordenadas. Por favor espera unos segundos…</div>'
      : r.mensaje ? `<div class="alerta">${esc(r.mensaje)}</div>` : "") + campos(r, "p-");
    const t = $("#p-tramos");
    t.hidden = tramosPdf.length < 2;
    // Pestañas: punto verde = tiene coordenadas, naranja = le faltan; ✓ = ya se agregó
    t.innerHTML = tramosPdf.map((x, i) => `<button type="button" class="tramo${i === selPdf ? " is-sel" : ""}${x.agregado ? " is-ok" : ""}" data-i="${i}"${x.agregado ? " disabled" : ""} title="${tieneCoord(x) ? "Con coordenadas" : "Sin coordenadas todavía"}">${x.agregado ? "✓ " : `<span class="est${tieneCoord(x) ? " ok" : ""}"></span>`}${esc(x.punto)}</button>`).join("");
    // Resumen del documento
    const res = $("#p-resumen");
    if (pdfActual && pdfActual.d) {
      const d = pdfActual.d, conC = tramosPdf.filter(tieneCoord).length;
      res.hidden = false;
      res.innerHTML = [`<span><b>${esc(pdfActual.nombre)}</b> · ${pdfActual.doc.numPages} página(s)</span>`,
        d.fecha ? `<span>Fecha: <b>${esc(d.fecha.split("-").reverse().join("/"))}</b></span>` : "",
        d.codigoVia || d.via ? `<span>Vía: <b>${esc([d.codigoVia, d.via].filter(Boolean).join(" · "))}</b></span>` : "",
        `<span>Tramos: <b>${tramosPdf.length}</b> · con coordenadas: <b>${conC}</b>${tramosPdf.some((x) => x.agregado) ? ` · agregados: <b>${tramosPdf.filter((x) => x.agregado).length}</b>` : ""}</span>`].filter(Boolean).join("");
    } else { res.hidden = true; res.innerHTML = ""; }
    // Vista de la página del tramo (o de su foto) al lado del formulario
    const vista = $("#p-vista");
    vista.hidden = !(pdfActual && r.miniatura);
    if (!vista.hidden) {
      $("#p-miniatura").src = r.miniatura; $("#p-miniatura").alt = "Página " + (r.pagina || 1) + " del PDF";
      $("#p-pagina").textContent = `${r.fotoPropia ? "Foto del sello · " : ""}página ${r.pagina || 1} de ${pdfActual.doc.numPages}`;
    }
    const quedan = tramosPdf.filter((x) => !x.agregado).length;
    $("#p-todos").hidden = quedan < 2;
    $("#p-todos").textContent = `Agregar los ${quedan} tramos`;

  }
  formPdf.addEventListener("input", (e) => alEditar(regPdf(), e.target, formPdf, pintarPdf));
  formPdf.addEventListener("change", (e) => alCambiar(regPdf(), e.target, pintarPdf));
  $("#p-tramos").addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (!b) return; selPdf = Number(b.dataset.i); pintarPdf(); });
  // PDF completo: todas las páginas en una ventana, abierta en la página del tramo
  async function abrirPdfCompleto() {
    const pdf = pdfActual; if (!pdf) return;
    const dlg = $("#visor-pdf"), cont = $("#vp-paginas"), pag = regPdf().pagina || 1;
    $("#vp-nombre").textContent = pdf.nombre + " · " + pdf.doc.numPages + " página(s)";
    if (cont.dataset.pdf !== pdf.nombre + pdf.base64.length) {
      cont.dataset.pdf = pdf.nombre + pdf.base64.length;
      let prop = "612 / 792"; // tamaño carta, mientras se dibuja
      try { const v = (await pdf.doc.getPage(1)).getViewport({ scale: 1 }); prop = `${Math.round(v.width)} / ${Math.round(v.height)}`; } catch (_) {}
      cont.innerHTML = Array.from({ length: pdf.doc.numPages }, (_, i) => `<div class="vp-pagina" data-n="${i + 1}"><span>Página ${i + 1}</span><img alt="Página ${i + 1}" style="aspect-ratio:${prop}"></div>`).join("");
    }
    cont.querySelectorAll(".vp-pagina").forEach((el) => el.classList.toggle("is-actual", Number(el.dataset.n) === pag));
    if (dlg.showModal && !dlg.open) dlg.showModal();
    const actual = cont.querySelector(`.vp-pagina[data-n="${pag}"]`); if (actual) actual.scrollIntoView({ block: "start" });
    // Dibuja primero la página del tramo y luego las demás
    const orden = [pag, ...Array.from({ length: pdf.doc.numPages }, (_, i) => i + 1).filter((n) => n !== pag)];
    for (const n of orden) {
      const img = cont.querySelector(`.vp-pagina[data-n="${n}"] img`);
      if (!img || img.getAttribute("src") || pdfActual !== pdf || !dlg.open) continue;
      try { img.src = await LectorPDF.dibujarPagina(pdf.doc, n, 1000); } catch (_) {}
      if (n === pag && actual) actual.scrollIntoView({ block: "start" });
    }
  }
  $("#p-ver").addEventListener("click", abrirPdfCompleto);
  $("#p-ver-img").addEventListener("click", abrirPdfCompleto);
  $("#vp-cerrar").addEventListener("click", () => $("#visor-pdf").close());
  $("#visor-pdf").addEventListener("click", (e) => { if (e.target.id === "visor-pdf") e.target.close(); });

  function limpiarPdf() { $("#vp-paginas").innerHTML = ""; delete $("#vp-paginas").dataset.pdf; pdfActual = null; tramosPdf = []; selPdf = 0; vacioPdf = nuevoRegistro({ origen: "pdf" }); $("#p-archivo").textContent = "Ningún archivo seleccionado"; pintarPdf(); msgPdf(""); }
  $("#p-limpiar").addEventListener("click", limpiarPdf);

  function pasarALista(lista) {
    const copias = lista.map((r) => { r.agregado = true; return Object.assign({}, r, { estado: "listo", mensaje: "", enLista: true, verificado: false }); });
    items.unshift(...copias.slice().reverse());
    render();
    const sig = tramosPdf.findIndex((x) => !x.agregado);
    const nombres = lista.map((x) => x.punto).join(", ");
    if (sig < 0) limpiarPdf(); else { selPdf = sig; pintarPdf(); }
    msgPdf(`${nombres} agregado${lista.length > 1 ? "s" : ""} a «Registros»: revísalo, marca «Verifiqué la información» y toca «Guardar datos».` + (sig >= 0 && tramosPdf[sig] ? ` Sigue con ${tramosPdf[sig].punto}.` : ""));
  }
  $("#p-agregar").addEventListener("click", () => {
    if (!pdfActual) { msgPdf("Primero elige un PDF.", true); return; }
    const r = regPdf(), f = faltantes(r);
    if (f.length) { marcar(formPdf, f); msgPdf("Falta: " + textoFaltantes(f) + ".", true); return; }
    pasarALista([r]);
  });
  $("#p-todos").addEventListener("click", () => {
    const quedan = tramosPdf.filter((x) => !x.agregado);
    const malo = quedan.find((x) => faltantes(x).length);
    if (malo) { selPdf = tramosPdf.indexOf(malo); pintarPdf(); const f = faltantes(malo); marcar(formPdf, f); msgPdf(`${malo.punto}: falta ${textoFaltantes(f)}.`, true); return; }
    pasarALista(quedan);
  });

  async function cargarPDF(f) {
    if (!f) return;
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) { msgPdf(f.name + " no es un PDF.", true); return; }
    if (f.size > 20 * 1048576) { msgPdf(f.name + " supera 20 MB.", true); return; }
    $("#p-archivo").textContent = f.name;
    msgPdf("Leyendo el PDF…");
    let bytes, lectura, d;
    try {
      bytes = new Uint8Array(await f.arrayBuffer());
      lectura = await LectorPDF.abrir(bytes.slice());
      d = LectorPDF.interpretar(lectura.paginas);
    } catch (e) { msgPdf("No se pudo leer " + f.name + ": " + (e.message || "PDF dañado o protegido") + ".", true); return; }
    const sinTexto = !lectura.paginas.join("").trim();
    pdfActual = { nombre: f.name, base64: aBase64(bytes), fileId: null, doc: lectura.doc, d };
    const pdf = pdfActual;
    await armarTramos(pdf, d);
    leerFotosPdf(pdf, d); // en segundo plano: coordenadas de los sellos de las fotos del PDF
    msgPdf(sinTexto ? "El PDF no tiene texto (parece escaneado)." : `${d.puntos.length ? d.puntos.length + " tramo(s) encontrados" : "No se encontraron coordenadas"}. Revisa los datos y toca «Agregar a la lista».`, sinTexto);

    // Con el servidor: Gemini redacta el resumen de todo el acta y completa lo que falte
    if (!HAY_BACKEND) return;
    $("#p-ia").hidden = false;
    const g = await Api.post("leerPdf", { base64: pdf.base64 });
    $("#p-ia").hidden = true;
    if (pdfActual !== pdf || g.status !== "success") return;
    const habiaPuntos = d.puntos.length;
    d.fecha = d.fecha || g.fecha || ""; d.codigoVia = d.codigoVia || g.codigoVia || ""; d.via = d.via || g.via || ""; d.municipioTexto = g.municipio || "";
    const resumenAnterior = d.resumen;
    if (g.resumen) d.resumen = g.resumen;
    tramosPdf.forEach((r) => {
      if (!r.agregado && (!r.observaciones || r.observaciones === resumenAnterior)) r.observaciones = d.resumen;
      if (!r.fecha) r.fecha = d.fecha; if (!r.codigoVia) r.codigoVia = d.codigoVia; if (!r.nombreTramo) r.nombreTramo = d.via;
    });
    // Gemini entiende cualquier formato de PDF: sus sitios que no estén ya en la lista se agregan.
    // Un sitio sin coordenadas ni PR solo se agrega si el lector del navegador no encontró ningún sitio.
    if (Array.isArray(g.puntos)) {
      const hayLocales = tramosPdf.some((r) => tieneCoord(r) || r.pr);
      const limpiarPr = (x) => LectorPDF.prDe("pr" + String(x || "").replace(/^\s*(pr|k|km)\.?\s*/i, ""));
      await sumarPuntosPdf(pdf, d, g.puntos
        .map((p, k) => ({ lat: p.latitud, lon: p.longitud, pr: limpiarPr(p.pr), fecha: p.fecha || "", nombre: p.nombre || "Punto " + (k + 1),
          tipo: p.tipoAfectacion || "", descripcion: p.descripcion || "", pagina: p.pagina || 1, deGemini: true }))
        .filter((p) => (p.lat != null && p.lon != null) || p.pr || !hayLocales));
    }
    pintarPdf();
    if (g.resumen) msgPdf("Gemini leyó el documento completo (texto y fotos). Revisa los datos y toca «Agregar a la lista».");
  }

  const imagenesPagina = new WeakMap(); // por PDF: página → imagen dibujada
  async function crearTramo(pdf, d, p) {
    const enTexto = municipiosDelTexto(d.texto);
    // Sección 3: el tipo de afectación y el responsable los elige la persona (no se llenan solos)
    if (!imagenesPagina.has(pdf)) imagenesPagina.set(pdf, {});
    const cache = imagenesPagina.get(pdf);
    const pag = Math.min(Math.max(1, p.pagina || 1), pdf.doc.numPages);
    if (!cache[pag]) {
      try { cache[pag] = { grande: await LectorPDF.dibujarPagina(pdf.doc, pag, 1100), mini: await LectorPDF.dibujarPagina(pdf.doc, pag, 360) }; }
      catch (_) { cache[pag] = { grande: "", mini: "" }; }
    }
    const r = nuevoRegistro({
      origen: "pdf", estado: "listo", nombreArchivo: pdf.nombre, punto: p.nombre, pagina: pag, pdf,
      dataUrl: p.foto || cache[pag].grande, miniatura: p.foto || cache[pag].mini,
      fecha: p.fecha || d.fecha || "", fechaTexto: d.fechaTexto || "", codigoVia: d.codigoVia || "", nombreTramo: d.via || "",
      tipoAfectacion: "", responsable: "",
      observaciones: (p.pr || p.deGemini) && p.descripcion ? p.descripcion : (d.resumen || p.descripcion || ""), // sitio con su propio texto
      pr: p.pr || ""
    });
    if (p.lat != null && p.lon != null) {
      r.latitud = p.lat; r.longitud = p.lon;
      r.latitudDMS = decimalADMS(p.lat, true); r.longitudDMS = decimalADMS(p.lon, false);
      r.origenUbicacion = "pdf";
      completarDesdeCoordenadas(r);
    }
    if (!r.municipio) {
      const m = enTexto[0] || MUN_POR_NOMBRE[norm(d.municipioTexto)];
      if (m) { r.municipio = m.n; r.subregion = m.s; r.municipioAuto = true; }
    }
    const falta = [!r.fecha && "la fecha", !tieneCoord(r) && "las coordenadas"].filter(Boolean);
    const otroMun = tieneCoord(r) && enTexto.length && !enTexto.some((m) => m.n === r.municipio)
      ? `El acta menciona ${enTexto.map((m) => m.n).join(" / ")} y las coordenadas caen en ${r.municipio || "otro municipio"}. Revisa el municipio.` : "";
    r.mensaje = falta.length ? "No se encontró en el PDF " + falta.join(", ") + ". Complétalo a mano." : otroMun;
    enriquecer(r, () => { if (regPdf() === r) pintarPdf(); });
    return r;
  }

  async function armarTramos(pdf, d) {
    const puntos = d.puntos.length ? d.puntos : [{ lat: null, lon: null, nombre: "Acta", tipo: d.tipoGeneral, descripcion: "", pagina: 1 }];
    tramosPdf = [];
    for (const p of puntos) { const r = await crearTramo(pdf, d, p); if (!d.puntos.length) r.esActa = true; tramosPdf.push(r); }
    selPdf = 0;
    pintarPdf();
  }

  // Agrega puntos nuevos (de Gemini o de las fotos). Si ya hay un tramo a menos de 80 m, solo lo completa.
  const distanciaM = (a, b) => Math.hypot((a.lat - b.lat) * 110574, (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180));
  function ponerCoordsTramo(r, p) {
    r.latitud = p.lat; r.longitud = p.lon;
    r.latitudDMS = decimalADMS(p.lat, true); r.longitudDMS = decimalADMS(p.lon, false);
    r.origenUbicacion = "pdf"; r.municipioAuto = r.municipioAuto || !r.municipio;
    completarDesdeCoordenadas(r);
    if (!r.fecha && p.fecha) r.fecha = p.fecha;
    if (p.foto) { r.dataUrl = p.foto; r.miniatura = p.foto; r.fotoPropia = true; }
    r.mensaje = !r.fecha ? "No se encontró en el PDF la fecha. Complétala a mano." : "";
    enriquecer(r, () => { if (regPdf() === r) pintarPdf(); });
  }
  async function sumarPuntosPdf(pdf, d, puntos) {
    let nuevos = 0, completados = 0;
    const afectados = [];
    for (const p of puntos) {
      if (pdfActual !== pdf) return { nuevos, completados, afectados };
      // Foto con PR en el sello (ej. «pr18+200»): va a la sección de ese PR
      const mismoPr = p.pr && tramosPdf.find((r) => r.pr && r.pr === p.pr && !r.agregado);
      if (mismoPr && p.lat == null) { // mismo PR sin coordenadas: solo completa lo que falte
        continue;
      }
      if (mismoPr && p.lat != null) {
        if (!tieneCoord(mismoPr)) { ponerCoordsTramo(mismoPr, p); completados++; afectados.push(mismoPr); }
        continue;
      }
      // Foto sin PR legible en un informe por secciones: va a la sección en cuya página (o después) aparece la foto
      const secciones = tramosPdf.filter((r) => r.pr && !r.agregado);
      if (!p.pr && p.lat != null && secciones.length && !tramosPdf.some((r) => tieneCoord(r) && distanciaM({ lat: r.latitud, lon: r.longitud }, p) < 80)) {
        const previas = secciones.filter((r) => !tieneCoord(r) && (r.pagina || 1) <= (p.pagina || 1));
        const sec = previas.sort((a, b) => (b.pagina || 1) - (a.pagina || 1))[0];
        if (sec) { ponerCoordsTramo(sec, p); completados++; afectados.push(sec); }
        continue; // en informes por secciones no se crean puntos sueltos por cada foto
      }
      const cerca = p.lat != null && tramosPdf.find((r) => tieneCoord(r) && distanciaM({ lat: r.latitud, lon: r.longitud }, p) < 80);
      if (cerca) {
        if (!cerca.agregado) {
          let c = false;
          if (!cerca.fecha && p.fecha) { cerca.fecha = p.fecha; c = true; }
          if (p.foto && !cerca.fotoPropia) { cerca.dataUrl = p.foto; cerca.miniatura = p.foto; cerca.fotoPropia = true; c = true; }
          if (c) { cerca.mensaje = /fecha/.test(cerca.mensaje || "") && cerca.fecha ? "" : cerca.mensaje; completados++; }
          afectados.push(cerca);
        }
        continue;
      }
      // El tramo «Acta» sin coordenadas se reemplaza por el primer punto real
      const vacio = tramosPdf.findIndex((r) => r.esActa && !r.agregado);
      const r = await crearTramo(pdf, d, p);
      if (p.foto) r.fotoPropia = true;
      if (vacio >= 0) tramosPdf.splice(vacio, 1, r); else tramosPdf.push(r);
      nuevos++; afectados.push(r);
    }
    if (nuevos || completados) pintarPdf();
    return { nuevos, completados, afectados };
  }

  // Lee el sello (fecha y coordenadas) de cada foto que trae el PDF.
  // Con el servidor, Gemini lee todas las fotos en una sola consulta (mucho más preciso con fotos pequeñas);
  // sin servidor, o si Gemini falla, se usa el lector del navegador con reglas para descartar lecturas dudosas.
  async function achicar(dataUrl, max) {
    const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = dataUrl; });
    const f = Math.min(1, max / Math.max(img.width, img.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(img.width * f); cv.height = Math.round(img.height * f);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/jpeg", 0.85).split(",")[1];
  }
  async function leerFotosPdf(pdf, d) {
    pdf.leyendoFotos = true; pintarPdf();
    try { await leerFotosPdfInterno(pdf, d); }
    finally { pdf.leyendoFotos = false; if (pdfActual === pdf) { $("#p-fotos").hidden = true; pintarPdf(); } }
  }
  // Recorte del sello (abajo a la derecha), ampliado: el texto queda grande y nítido para Gemini
  async function recorteSello(dataUrl) {
    const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = dataUrl; });
    const x0 = Math.round(img.width * 0.2), y0 = Math.round(img.height * 0.6), w = img.width - x0, h = img.height - y0;
    const f = Math.min(3, Math.max(1, 1400 / w));
    const cv = document.createElement("canvas"); cv.width = Math.round(w * f); cv.height = Math.round(h * f);
    const cx = cv.getContext("2d"); cx.imageSmoothingQuality = "high";
    cx.drawImage(img, x0, y0, w, h, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/jpeg", 0.92).split(",")[1];
  }

  // Fotos del PDF: solo cuentan las que tienen sello con coordenadas (mapas, tablas y logos se ignoran).
  // Gemini (recortes del sello, en grupos de 3 a la vez) y el lector del navegador trabajan al mismo tiempo;
  // cada foto se aplica con el primer resultado confiable, y si Gemini lee distinto al lector, manda Gemini.
  async function leerFotosPdfInterno(pdf, d) {
    let fotos = [];
    try { fotos = await LectorPDF.imagenes(pdf.doc, 16, 300); } catch (_) { return; }
    if (!fotos.length || pdfActual !== pdf) return;
    const aviso3 = (t) => { $("#p-fotos").hidden = !t; $("#p-fotos").textContent = t || ""; };
    const aplicado = {};            // índice de foto → { fuente, lat, lon, tramo }
    let cola = Promise.resolve(), conCoord = 0, geminiOk = false, geminiFallo = false, geminiTerminado = !HAY_BACKEND;
    const aplicar = (i, x, fuente) => {
      cola = cola.then(async () => {
        if (pdfActual !== pdf) return;
        const f = fotos[i], prev = aplicado[i];
        const p = { lat: x.lat, lon: x.lon, fecha: x.fecha || "", pr: x.pr || "", foto: f.dataUrl, pagina: f.pagina,
          nombre: x.pr ? "PR " + x.pr : "Foto pág. " + f.pagina, tipo: "", descripcion: "" };
        if (prev) {
          // Ya se aplicó con el lector del navegador: si Gemini lee otra posición, se corrige ese tramo
          if (fuente === "gemini" && prev.fuente === "lector" && prev.tramo && distanciaM(prev, p) > 20 &&
              prev.tramo.latitud === prev.lat && prev.tramo.longitud === prev.lon && !prev.tramo.agregado) {
            ponerCoordsTramo(prev.tramo, p); Object.assign(prev, { fuente, lat: p.lat, lon: p.lon }); pintarPdf();
          }
          return;
        }
        conCoord++;
        const r = await sumarPuntosPdf(pdf, d, [p]);
        aplicado[i] = { fuente, lat: p.lat, lon: p.lon, tramo: r.afectados[0] || null };
      });
      return cola;
    };
    const prDe = (x) => LectorPDF.prDe("pr" + String(x || "").replace(/^\s*(pr|k|km)\.?\s*/i, ""));

    // 1) Gemini con recortes del sello
    const tGemini = !HAY_BACKEND ? Promise.resolve() : (async () => {
      try {
        const recortes = await Promise.all(fotos.map((f) => recorteSello(f.dataUrl)));
        const grupos = []; for (let i = 0; i < recortes.length; i += 3) grupos.push(i);
        await Promise.all(grupos.map(async (ini) => {
          const g = await Api.post("leerFotos", { imagenes: recortes.slice(ini, ini + 3) });
          if (g.status !== "success" || !Array.isArray(g.fotos)) { geminiFallo = true; return; }
          geminiOk = true;
          for (const x of g.fotos) {
            const i = ini + Number(x.indice);
            if (fotos[i] && x.legible && x.esFoto !== false) await aplicar(i, { lat: x.latitud, lon: x.longitud, fecha: x.fecha, pr: prDe(x.pr) }, "gemini");
          }
        }));
      } catch (_) { geminiFallo = true; }
      geminiTerminado = true;
    })();

    // 2) Lector del navegador, foto por foto (rápido con el sello estándar)
    const lecturas = []; // lecturas del navegador que esperan confirmación
    const tLector = (async () => {
      for (let i = 0; i < fotos.length; i++) {
        if (pdfActual !== pdf) return;
        // Si Gemini ya terminó y todos los tramos tienen coordenadas, no hace falta seguir leyendo
        if (geminiTerminado && geminiOk && tramosPdf.every((r) => tieneCoord(r) || r.agregado)) break;
        if (aplicado[i]) continue;
        aviso3(`· Leyendo las imágenes del PDF (${i + 1} de ${fotos.length})…`);
        let o = null;
        try { o = await LectorSello.leer(fotos[i].dataUrl, { rapido: true }); } catch (_) {}
        // Solo sellos de foto de campo: fecha + coordenadas, sin dudas de lectura
        if (!(o && o.latitud != null && o.longitud != null && o.fecha) || aplicado[i]) continue;
        const x = { i, lat: o.latitud, lon: o.longitud, fecha: o.fecha, pr: LectorPDF.prDe(o.textoLeido), dudosa: !!o.coordDudosa };
        // En fotos pequeñas el lector puede confundir un número: se acepta si la foto es grande o si otra foto coincide.
        // Una lectura dudosa (separadores perdidos, ej. «6853 N 7546 W») solo cuenta si otra foto del MISMO PR coincide (< 100 m).
        const grande = Math.max(fotos[i].ancho, fotos[i].alto) >= 1000 && !x.dudosa;
        const vale = (y) => y.i !== i && (x.dudosa || y.dudosa ? (x.pr && y.pr === x.pr && distanciaM(y, x) < 100) : distanciaM(y, x) < 60);
        const coincide = lecturas.find(vale) || (!x.dudosa && Object.values(aplicado).find((y) => distanciaM(y, x) < 60));
        lecturas.push(x);
        if (grande || coincide) {
          // Primero la foto anterior (la primera foto de la sección es la que manda)
          if (coincide && coincide.i != null && !aplicado[coincide.i]) await aplicar(coincide.i, coincide, "lector");
          await aplicar(i, x, "lector");
        }
      }
    })();

    await Promise.all([tGemini, tLector]);
    await cola;
    aviso3("");
    if (pdfActual !== pdf) return;
    const sinCoord = tramosPdf.filter((r) => !tieneCoord(r) && !r.agregado).length;
    msgPdf(`Imágenes del PDF: ${fotos.length} revisadas, ${conCoord} con sello y coordenadas` +
      (sinCoord ? `. ${sinCoord} tramo(s) siguen sin coordenadas: complétalas a mano.` : ". Todos los tramos tienen coordenadas.") +
      (HAY_BACKEND && geminiFallo && !geminiOk ? " (Gemini no respondió: se usó solo el lector del navegador.)" : ""), sinCoord > 0);
  }
  pintarPdf();

  /* ======================= Tarjetas ======================= */
  const ETIQUETAS = { leyendo: "Leyendo…", listo: "Listo", revisar: "Revisar", guardando: "Guardando…", guardado: "Guardado", error: "Error al guardar", manual: "Carga manual" };

  function tarjeta(r) {
    const esFoto = r.origen === "foto", esPdf = r.origen === "pdf", conImagen = !!r.miniatura;
    const bloqueado = r.estado === "guardado" || r.estado === "guardando" || r.estado === "leyendo";
    const cls = ["card", conImagen ? "" : "is-manual", r.estado === "guardado" ? "is-guardado" : "", r.estadoPunto === "Crítico" ? "is-critico" : ""].join(" ");
    const porVerificar = r.enLista && ["listo", "revisar", "error"].includes(r.estado);
    const etiqueta = porVerificar && r.estado !== "error" ? (r.verificado ? "Verificado" : "Por verificar")
      : r.estado === "listo" && !esFoto && !esPdf ? "Carga manual" : (r.estado === "listo" && esPdf ? "Listo · PDF" : ETIQUETAS[r.estado]);
    const nombre = esFoto ? r.nombreArchivo : esPdf ? r.nombreArchivo + (r.punto ? " · " + r.punto : "") : "Registro sin foto";
    return `<article class="${cls}" data-id="${r.id}">
      ${conImagen ? `<button type="button" class="card__foto" data-act="ver" aria-label="${esPdf ? "Ver página del PDF" : "Ver foto completa"}"><img src="${r.miniatura}" alt="${esPdf ? "Página" : "Foto"} ${esc(r.nombreArchivo)}"><span>Ampliar</span></button>` : ""}
      <div class="card__cuerpo">
        <div class="card__top"><span class="card__nombre">${esc(nombre)}${r.idRegistro ? " · " + esc(r.idRegistro) : ""}${r.idArcgis ? " · ArcGIS " + esc(r.idArcgis) : ""}</span><span class="chip chip--${porVerificar && r.estado !== "error" ? (r.verificado ? "listo" : "revisar") : (r.estado === "listo" && !esFoto && !esPdf ? "manual" : r.estado)}">${etiqueta}</span></div>
        ${r.mensaje ? `<div class="alerta">${esc(r.mensaje)}</div>` : ""}
        <fieldset style="border:0;padding:0;margin:0;display:grid;gap:12px;min-width:0"${bloqueado ? " disabled" : ""}>${campos(r, "c" + r.id + "-")}</fieldset>
        ${porVerificar ? `<label class="verificar"><input type="checkbox" data-act="verificar"${r.verificado ? " checked" : ""}> Verifiqué la información</label>` : ""}
        <div class="actions">
          ${esFoto && !r.enLista && ["listo", "revisar", "error"].includes(r.estado) ? '<button type="button" class="btn btn--sm btn--primary" data-act="agregar">Agregar a la lista</button>' : ""}
          ${esFoto && r.estado !== "guardado" && r.estado !== "leyendo" && r.estado !== "guardando" ? '<button type="button" class="btn btn--sm" data-act="releer">Volver a leer la foto</button>' : ""}
          ${r.estado !== "guardando" ? '<button type="button" class="btn btn--sm" data-act="quitar">Quitar de la lista</button>' : ""}
        </div>
      </div>
    </article>`;
  }

  function render() {
    // Las fotos se muestran dentro de su sección (2); la carga manual y los PDF, en «Registros»
    const enSeccion = (r) => r.origen === "foto" && !r.enLista && r.estado !== "guardado"; // al agregarla pasa a «Registros»
    const fotos = items.filter(enSeccion), otros = items.filter((r) => !enSeccion(r));
    $("#tarjetas-fotos").innerHTML = fotos.map(tarjeta).join("");
    $("#tarjetas").innerHTML = otros.length ? otros.map(tarjeta).join("")
      : '<p class="vacio">' + "Aquí aparecen los registros que vas agregando desde las secciones 1, 2 y 3." + "</p>";
    contadores();
  }
  function actualizar(r) {
    const el = document.querySelector(`.card[data-id="${r.id}"]`);
    if (el) el.outerHTML = tarjeta(r);
    contadores();
  }
  // Pendientes = registros agregados a «Registros» que aún no se han guardado
  const pendientes = () => items.filter((r) => r.enLista && ["listo", "revisar", "error", "manual"].includes(r.estado));
  function contadores() {
    const p = pendientes().length, leyendo = items.filter((r) => r.estado === "leyendo").length;
    const guardados = items.filter((r) => r.estado === "guardado").length;
    $("#n-listas").textContent = p;
    $("#n-leyendo").textContent = leyendo ? "· " + leyendo + " leyendo" : "";
    $("#resumen").textContent = items.length ? `${items.length} en la lista${HAY_BACKEND ? " · " + guardados + " guardados" : ""}` : "";
    const verificados = pendientes().filter((r) => r.verificado).length;
    $("#guardar").disabled = !p || guardando;
    // El botón dice cuántos registros verificados se van a guardar (Drive, Sheet y ArcGIS)
    $("#guardar").textContent = guardando ? "Guardando…" : (!p && guardados ? "✓ Todo guardado" : (!p ? "Guardar datos" : (verificados ? `Guardar ${verificados} verificado${verificados > 1 ? "s" : ""}` : "Verifica para guardar")));
    $("#guardar").title = !p ? (guardados ? "Todos los registros ya están guardados en Drive, Sheets y ArcGIS." : "Agrega un registro desde las secciones 1, 2 o 3.") : "Guarda en Drive, Sheet y ArcGIS los registros marcados como verificados.";
    $("#n-texto").textContent = (p === 1 ? "pendiente" : "pendientes") + (p ? ` · ${verificados} verificado${verificados === 1 ? "" : "s"}` : "");
  }

  const buscar = (el) => items.find((x) => x.id == el.closest(".card")?.dataset.id);
  ["#tarjetas", "#tarjetas-fotos"].forEach((sel) => {
  $(sel).addEventListener("input", (e) => {
    const r = buscar(e.target); if (!r) return;
    const card = e.target.closest(".card");
    alEditar(r, e.target, card, () => actualizar(r));
    if (e.target.dataset.k === "estadoPunto") card.classList.toggle("is-critico", r.estadoPunto === "Crítico");
  });
  $(sel).addEventListener("change", (e) => {
    const r = buscar(e.target); if (!r) return;
    if (e.target.dataset.act === "verificar") { r.verificado = e.target.checked; if (r.verificado) aviso(""); actualizar(r); return; }
    alCambiar(r, e.target, () => actualizar(r));
  });
  $(sel).addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const r = buscar(b); if (!r) return;
    if (b.dataset.act === "quitar") { if (r.urlOriginal) URL.revokeObjectURL(r.urlOriginal); items = items.filter((x) => x !== r); render(); if (!HAY_BACKEND) { try { escribirLocal(); } catch (_) {} } }
    if (b.dataset.act === "agregar") {
      const f = faltantes(r), card = b.closest(".card");
      const fm = $("#f-msg"), msgF = (t, e) => { fm.textContent = t; fm.style.color = e ? "var(--err)" : ""; };
      if (f.length) { marcar(card, f); msgF("Falta: " + textoFaltantes(f) + ".", true); return; }
      r.enLista = true; r.verificado = false; render();
      msgF(r.nombreArchivo + " agregada a «Registros»: revísalo, marca «Verifiqué la información» y toca «Guardar datos».");
      return;
    }
    if (b.dataset.act === "releer") { cola.push(r); r.estado = "leyendo"; actualizar(r); procesarCola(); }
    if (b.dataset.act === "ver") abrirVisor(r.dataUrl || r.miniatura, r.nombreArchivo + (r.punto ? " · " + r.punto + (r.pagina ? " (página " + r.pagina + ")" : "") : ""));
  });
  });

  /* ======================= Visor ======================= */
  const visor = $("#visor");
  function abrirVisor(src, nombre) {
    $("#visor-img").src = src; $("#visor-img").alt = nombre || "Foto";
    $("#visor-nombre").textContent = nombre || "";
    if (visor.showModal) visor.showModal();
  }
  $("#visor-cerrar").addEventListener("click", () => visor.close());
  visor.addEventListener("click", (e) => { if (e.target === visor) visor.close(); });

  /* ======================= Guardar / Descargar ======================= */
  const Api = {
    async post(accion, datos) {
      try {
        const r = await fetch(CONFIG.API_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" }, // evita preflight CORS en Apps Script
          body: JSON.stringify(Object.assign({ accion, token: CONFIG.TOKEN, sesion: Sesion.token() }, datos)),
          redirect: "follow"
        });
        const t = await r.text();
        let res;
        try { res = JSON.parse(t); } catch (_) { res = null; }
        if (res) { if (res.status === "sin_sesion" && accion !== "login") Sesion.vencida(res.message); return res; }
        try { return JSON.parse(t); }
        catch (_) { return { status: "error", message: /accounts\.google\.com|Sign in/i.test(t) ? "El servidor pide inicio de sesión. Revisa que la implementación tenga acceso para «Cualquier usuario»." : "Respuesta inesperada del servidor." }; }
      } catch (e) { return { status: "error", message: "Sin conexión con el servidor. Revisa internet e intenta de nuevo." }; }
    }
  };

  function validarTodos(lista) {
    let malos = 0;
    lista.forEach((r) => {
      const f = faltantes(r);
      if (f.length) { malos++; const c = document.querySelector(`.card[data-id="${r.id}"]`); if (c) marcar(c, f); }
    });
    return malos;
  }

  let guardando = false;
  let colaGuardado = Promise.resolve(); // un guardado a la vez (IDs consecutivos y un solo PDF en Drive)

  async function guardarUno(r) {
    r.estado = "guardando"; actualizar(r);
    const pdf = r.pdf; // los puntos de un mismo PDF comparten un solo archivo en Drive
    const res = await Api.post("subir", {
      base64: pdf ? (pdf.fileId ? "" : pdf.base64) : (r.base64 || ""), archivoId: pdf && pdf.fileId ? pdf.fileId : "",
      mimeType: pdf ? "application/pdf" : "image/jpeg", nombreArchivo: r.nombreArchivo || "", origen: r.origen,
      fecha: r.fecha, fechaTexto: r.fechaTexto, latitudDMS: r.latitudDMS, longitudDMS: r.longitudDMS,
      latitud: r.latitud, longitud: r.longitud, codigoVia: r.codigoVia, nombreTramo: r.nombreTramo,
      subregion: r.subregion, municipio: r.municipio, tipoAfectacion: r.tipoAfectacion, responsable: r.responsable,
      estadoPunto: r.estadoPunto, observaciones: r.observaciones, origenUbicacion: r.origenUbicacion, selloLegible: r.selloLegible, vereda: r.vereda || ""
    });
    let resultado;
    if (res.status === "success") {
      r.estado = "guardado"; r.idRegistro = res.id;
      if (pdf && res.fileId) pdf.fileId = res.fileId;
      const ag = res.arcgis;
      if (ag && ag.ok) { r.idArcgis = ag.fid; r.mensaje = ""; resultado = "arcgis"; }
      else { r.mensaje = "Guardado en Drive y Sheets, pero no llegó a ArcGIS" + (ag && ag.message ? " (" + ag.message + ")" : "") + ". Queda pendiente para reenviarlo."; resultado = "sinArcgis"; }
    } else { r.estado = "error"; r.mensaje = res.message || "No se pudo guardar."; resultado = "error"; }
    actualizar(r);
    return resultado;
  }

  // Guarda una lista de registros y devuelve el texto del resultado
  function guardarLista(lista) {
    const tarea = colaGuardado.then(async () => {
      if (!lista.length) return { texto: "", error: false };
      if (!HAY_BACKEND) { guardarEnDispositivo(lista); render(); return { texto: `${lista.length} registro(s) guardados en este dispositivo.`, error: false }; }
      guardando = true; contadores();
      let ok = 0, mal = 0, enArcgis = 0, sinArcgis = 0, ultimoError = "";
      for (const r of lista) {
        const x = await guardarUno(r);
        if (x === "error") { mal++; ultimoError = r.mensaje; } else { ok++; if (x === "arcgis") enArcgis++; else sinArcgis++; }
      }
      guardando = false; render();
      const ids = lista.filter((r) => r.idRegistro).map((r) => r.idRegistro).join(", ");
      const textoArcgis = sinArcgis ? ` ${enArcgis} enviados a ArcGIS y ${sinArcgis} sin enviar (ver tarjetas).` : (enArcgis ? " Enviados a ArcGIS." : "");
      const texto = mal
        ? `${ok} guardados, ${mal} con error${mal === 1 && lista.length === 1 ? ": " + ultimoError : ""}. Quedó en «Registros»; corrígelo y toca «Guardar datos».${textoArcgis}`
        : `${ok === 1 ? "Guardado" : ok + " guardados"} (${ids}).${textoArcgis}`;
      return { texto, error: mal > 0 || sinArcgis > 0 };
    });
    colaGuardado = tarea.catch(() => {});
    return tarea;
  }

  $("#guardar").addEventListener("click", async () => {
    const lista = pendientes().filter((r) => r.verificado);
    if (!lista.length) { aviso("Marca «Verifiqué la información» en los registros que ya revisaste para poder guardarlos.", true); $("#h-registros").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    const malos = validarTodos(lista);
    if (malos) { aviso(`${malos} registro(s) con datos obligatorios vacíos (marcados en rojo). Complétalos para guardar.`, true); return; }
    const r = await guardarLista(lista);
    aviso(r.texto, r.error);
  });

  /* Sin servidor: los registros se guardan en este navegador y se recuperan al volver a abrir la página */
  const CLAVE_LOCAL = "vipc-registros-v1";
  const CAMPOS_LOCALES = ["id", "origen", "estado", "idRegistro", "nombreArchivo", "miniatura", "fecha", "fechaTexto", "latitudDMS", "longitudDMS",
    "latitud", "longitud", "origenUbicacion", "codigoVia", "nombreTramo", "subregion", "municipio", "municipioAuto",
    "tipoAfectacion", "responsable", "estadoPunto", "observaciones", "selloLegible", "punto", "pagina", "vereda"];
  function escribirLocal() {
    const datos = items.filter((r) => r.estado === "guardado").map((r) => Object.fromEntries(CAMPOS_LOCALES.map((k) => [k, r[k]])));
    localStorage.setItem(CLAVE_LOCAL, JSON.stringify(datos));
  }
  function guardarEnDispositivo(lista) {
    const previos = lista.map((r) => [r, r.estado, r.idRegistro]);
    let n = items.filter((r) => r.estado === "guardado").length;
    lista.forEach((r) => { r.estado = "guardado"; r.idRegistro = r.idRegistro || "L-" + String(++n).padStart(4, "0"); r.mensaje = ""; });
    try {
      escribirLocal();
      lista.forEach(actualizar); contadores();
      aviso(`${lista.length} registro(s) guardados en este dispositivo. Siguen aquí aunque cierres la página.`);
    } catch (e) {
      previos.forEach(([r, est, id]) => { r.estado = est; r.idRegistro = id; });
      aviso("No hay espacio en este navegador para guardar más registros. Vacía la lista o conecta el servidor.", true);
    }
  }
  function leerLocal() {
    try {
      const datos = JSON.parse(localStorage.getItem(CLAVE_LOCAL) || "[]");
      if (!Array.isArray(datos)) return;
      datos.forEach((d) => { items.push(Object.assign(nuevoRegistro(), d, { id: sec++, estado: "guardado", mensaje: "" })); });
    } catch (_) { /* almacenamiento no disponible */ }
  }

  const COLS = [["Fecha", "fecha"], ["Latitud", "latitud"], ["Longitud", "longitud"], ["LatitudDMS", "latitudDMS"], ["LongitudDMS", "longitudDMS"],
    ["CodigoVia", "codigoVia"], ["NombreTramo", "nombreTramo"], ["Subregion", "subregion"], ["Municipio", "municipio"],
    ["TipoAfectacion", "tipoAfectacion"], ["Responsable", "responsable"], ["Estado", "estadoPunto"], ["Observaciones", "observaciones"],
    ["Origen", "origen"], ["Foto", "nombreArchivo"], ["FechaSello", "fechaTexto"], ["OrigenUbicacion", "origenUbicacion"]];
  const vaciar = $("#vaciar");
  vaciar.addEventListener("click", () => {
    if (vaciar.dataset.confirmar) {
      items = []; cola.length = 0; render(); aviso("");
      try { localStorage.removeItem(CLAVE_LOCAL); } catch (_) {}
      vaciar.textContent = "Vaciar"; delete vaciar.dataset.confirmar; return;
    }
    vaciar.dataset.confirmar = "1"; vaciar.textContent = "Confirmar vaciar";
    setTimeout(() => { if (vaciar.dataset.confirmar) { delete vaciar.dataset.confirmar; vaciar.textContent = "Vaciar"; } }, 4000);
  });

  window.addEventListener("beforeunload", (e) => {
    if (pendientes().length && HAY_BACKEND) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ======================= Carga de archivos ======================= */
  const drop = $("#fotos");
  $("#archivos").addEventListener("change", (e) => { agregarFotos([...e.target.files]); e.target.value = ""; });
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("is-over"); }));
  drop.addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) agregarFotos([...e.dataTransfer.files]); });
  /* Pegar imágenes o PDF copiados, sin tener que descargarlos primero.
     Funciona con Ctrl+V en cualquier parte de la página, con la caja «Pega aquí» (también en el celular:
     mantener presionado → Pegar) y con el botón, cuando el navegador lo permite. */
  const msgF = (t, e) => { const fm = $("#f-msg"); fm.textContent = t || ""; fm.style.color = e ? "var(--err)" : ""; };
  function nombrePegado(f, i) {
    const d = new Date(), z = (n) => String(n).padStart(2, "0");
    const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg");
    return new File([f], `pegada_${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}${i ? "_" + (i + 1) : ""}.${ext}`, { type: f.type });
  }
  // Imágenes en otros formatos (GIF, BMP, TIFF de algunos programas) se convierten a JPG
  async function aImagenCompatible(f) {
    if (/^image\/(jpeg|png|webp)$/.test(f.type)) return f;
    try {
      const bmp = await createImageBitmap(f);
      const cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height;
      cv.getContext("2d").drawImage(bmp, 0, 0);
      const blob = await new Promise((ok) => cv.toBlob(ok, "image/jpeg", 0.92));
      return blob ? new File([blob], "pegada.jpg", { type: "image/jpeg" }) : null;
    } catch (_) { return null; }
  }
  async function recibirPegados(files) {
    const imgs = (await Promise.all(files.filter((f) => /^image\//.test(f.type)).map(aImagenCompatible))).filter(Boolean);
    const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name || ""));
    if (imgs.length) { msgF(imgs.length === 1 ? "Imagen pegada. Leyendo el sello…" : imgs.length + " imágenes pegadas. Leyendo los sellos…"); agregarFotos(imgs.map(nombrePegado)); $("#seccion-fotos").scrollIntoView({ behavior: "smooth", block: "start" }); }
    if (pdfs.length) { cargarPDF(pdfs[0]); $("#pdfs").scrollIntoView({ behavior: "smooth", block: "start" }); }
    return imgs.length + pdfs.length;
  }
  // Saca los archivos de lo pegado: archivos, elementos de tipo archivo o imágenes incrustadas (data:)
  function archivosDe(dt) {
    const out = [...((dt && dt.files) || [])];
    if (!out.length && dt && dt.items) for (const it of dt.items) { if (it.kind === "file") { const f = it.getAsFile(); if (f) out.push(f); } }
    if (!out.length && dt) {
      const html = dt.getData("text/html") || "";
      const m = html.match(/<img[^>]+src="(data:image\/[a-z]+;base64,[^"]+)"/i);
      if (m) {
        const [cab, b64] = m[1].split(","), tipo = cab.slice(5, cab.indexOf(";"));
        const bin = atob(b64), u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        out.push(new File([u8], "pegada", { type: tipo }));
      } else if (/<img[^>]+src="https?:/i.test(html)) out.enlaceWeb = true;
    }
    return out;
  }
  document.addEventListener("paste", async (e) => {
    if ($("#app").hidden) return;
    const zona = e.target && e.target.closest && e.target.closest("#zona-pegar");
    const files = archivosDe(e.clipboardData);
    if (zona) e.preventDefault(); // la caja nunca guarda texto
    if (!files.length) {
      if (zona) msgF(files.enlaceWeb
        ? "Eso es un enlace a una imagen de una página web. Abre la imagen, haz clic derecho → «Copiar imagen» y vuelve a pegar."
        : "No hay ninguna imagen copiada. Copia la foto (clic derecho → «Copiar imagen») y vuelve a pegar.", true);
      return; // fuera de la caja, el texto se pega normal en las casillas
    }
    e.preventDefault();
    if (!(await recibirPegados(files))) msgF("Lo que pegaste no es una imagen ni un PDF.", true);
  });
  const zonaPegar = $("#zona-pegar");
  zonaPegar.addEventListener("keydown", (e) => { // solo deja pegar (Ctrl+V / Cmd+V / Shift+Insert), no escribir
    const ctrl = e.ctrlKey || e.metaKey, k = (e.key || "").toLowerCase();
    if (!((ctrl && k === "v") || (e.shiftKey && k === "insert") || k === "tab")) e.preventDefault();
  });
  zonaPegar.addEventListener("input", () => { zonaPegar.textContent = ""; });
  zonaPegar.addEventListener("drop", (e) => { e.preventDefault(); const f = archivosDe(e.dataTransfer); if (f.length) recibirPegados(f); });
  $("#pegar-foto").addEventListener("click", async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) throw new Error("sin permiso");
      const items = await navigator.clipboard.read(), files = [];
      for (const it of items) {
        const tipo = it.types.find((t) => /^image\//.test(t));
        if (tipo) files.push(new File([await it.getType(tipo)], "pegada", { type: tipo }));
      }
      if (!files.length) { msgF("No hay ninguna imagen copiada. Copia la foto (clic derecho → «Copiar imagen») y vuelve a intentar.", true); return; }
      await recibirPegados(files);
    } catch (_) {
      // El navegador no deja leer el portapapeles con un botón: se usa la caja
      zonaPegar.focus();
      msgF("Ahora presiona Ctrl+V (en el celular: mantén presionada la caja y elige «Pegar»).");
    }
  });

  const panelPdf = $("#pdfs");
  $("#archivos-pdf").addEventListener("change", (e) => { cargarPDF(e.target.files[0]); e.target.value = ""; });
  ["dragenter", "dragover"].forEach((t) => panelPdf.addEventListener(t, (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); panelPdf.classList.add("is-over"); } }));
  ["dragleave", "drop"].forEach((t) => panelPdf.addEventListener(t, (e) => { panelPdf.classList.remove("is-over"); if (t === "drop" && e.dataTransfer?.files?.length) { e.preventDefault(); cargarPDF(e.dataTransfer.files[0]); } }));

  /* ======================= Acceso (usuario y contraseña) ======================= */
  const Sesion = (function () {
    const CLAVE = "vipc-sesion";
    let actual = null;
    try { actual = JSON.parse(localStorage.getItem(CLAVE) || "null"); } catch (_) { actual = null; }
    if (actual && !(actual.expira > Date.now())) actual = null;
    return {
      token: () => (actual ? actual.sesion : ""),
      datos: () => actual,
      guardar(d) { actual = d; try { localStorage.setItem(CLAVE, JSON.stringify(d)); } catch (_) {} },
      borrar() { actual = null; try { localStorage.removeItem(CLAVE); } catch (_) {} },
      vencida(msg) { this.borrar(); mostrarAcceso(msg || "Tu sesión venció. Inicia sesión de nuevo."); }
    };
  })();

  const VISTAS_ACCESO = { ingreso: "#form-acceso", registro: "#form-registro", verificar: "#form-verificar", pendiente: "#caja-pendiente" };
  function verAcceso(cual) {
    Object.entries(VISTAS_ACCESO).forEach(([k, sel]) => { $(sel).hidden = k !== cual; });
    const primero = $(VISTAS_ACCESO[cual] + " input"); if (primero) setTimeout(() => { try { primero.focus(); } catch (_) {} }, 50);
  }
  function mostrarAcceso(msg) {
    $("#app").hidden = true; $("#barra").hidden = true; $("#usuario").hidden = true;
    $("#acceso").hidden = false;
    verAcceso("ingreso");
    $("#acc-msg").textContent = msg || "";
    $("#acc-entrar").disabled = !HAY_BACKEND;
    setTimeout(() => { try { $("#acc-usuario").focus(); } catch (_) {} }, 50);
  }
  let appIniciada = false;
  function mostrarApp() {
    const d = Sesion.datos();
    $("#acceso").hidden = true; $("#app").hidden = false; $("#barra").hidden = false;
    $("#usuario").hidden = false; $("#usuario-nombre").textContent = d ? d.nombre : "";
    if (!appIniciada) {
      appIniciada = true;
      pintarManual();
      cargarListasVias();
      render();
      // Precarga el lector en segundo plano para que la primera foto sea más rápida
      setTimeout(() => { try { LectorSello.iniciar().catch(() => {}); } catch (_) {} }, 1500);
    }
  }

  $("#form-acceso").addEventListener("submit", async (e) => {
    e.preventDefault();
    const usuario = $("#acc-usuario").value.trim(), clave = $("#acc-clave").value;
    $("#acc-msg").classList.remove("is-ok");
    if (!usuario || !clave) { $("#acc-msg").textContent = "Escribe tu usuario y tu contraseña."; return; }
    const b = $("#acc-entrar"); b.disabled = true; b.textContent = "Verificando…"; $("#acc-msg").textContent = "";
    const r = await Api.post("login", { usuario, clave });
    b.disabled = false; b.textContent = "Ingresar";
    if (r.status === "verificar") { pedirCodigo(r.usuario, r.correo, r.message); return; }
    if (r.status === "codigo") { $("#acc-clave").value = ""; pedirCodigo(r.usuario, r.correo, "", "ingreso"); return; }
    if (r.status !== "success") { $("#acc-msg").textContent = r.message || "No se pudo iniciar sesión."; $("#acc-clave").select(); return; }
    Sesion.guardar({ sesion: r.sesion, usuario: r.usuario, nombre: r.nombre, rol: r.rol, expira: r.expira });
    $("#acc-clave").value = "";
    mostrarApp();
  });

  /* ---------- Crear cuenta y verificar correo ---------- */
  let usuarioPorVerificar = "", modoCodigo = "registro"; // "registro": confirmar correo · "ingreso": código de cada ingreso
  function pedirCodigo(usuario, correo, msg, modo) {
    usuarioPorVerificar = usuario; modoCodigo = modo || "registro";
    $("#ver-titulo").textContent = modoCodigo === "ingreso" ? "Código de ingreso" : "Confirma tu correo";
    $("#ver-enviar").textContent = modoCodigo === "ingreso" ? "Ingresar" : "Confirmar";
    $("#ver-texto").textContent = `Te enviamos un código de 6 dígitos a ${correo || "tu correo"}. Revisa también la carpeta de spam.`;
    $("#ver-msg").textContent = msg && !/enviamos/i.test(msg) ? msg : ""; $("#ver-msg").className = "acceso__msg";
    $("#ver-codigo").value = "";
    verAcceso("verificar");
  }
  $("#ir-registro").addEventListener("click", () => { $("#reg-msg").textContent = ""; verAcceso("registro"); });
  document.querySelectorAll("[data-ir]").forEach((b) => b.addEventListener("click", () => { $("#acc-msg").textContent = ""; verAcceso(b.dataset.ir); }));
  $("#reg-entidad").addEventListener("change", () => { $("#bloque-empresa").hidden = $("#reg-entidad").value !== "Empresa externa"; });
  $("#reg-supervisor").addEventListener("input", (e) => e.target.classList.remove("is-invalid"));
  // Sugerir usuario a partir del correo
  $("#reg-correo").addEventListener("change", () => {
    const u = $("#reg-usuario");
    if (!u.value) u.value = $("#reg-correo").value.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 30);
  });

  $("#form-registro").addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = { nombre: $("#reg-nombre").value.trim(), correo: $("#reg-correo").value.trim(), entidad: $("#reg-entidad").value, empresa: $("#reg-empresa").value.trim(), supervisor: $("#reg-supervisor").value.trim().toLowerCase(),
      usuario: $("#reg-usuario").value.trim().toLowerCase(), clave: $("#reg-clave").value };
    const msg = $("#reg-msg");
    if (!d.nombre || !d.correo || !d.entidad || !d.usuario || !d.clave || (d.entidad === "Empresa externa" && !d.empresa)) { msg.textContent = "Completa todos los campos."; return; }
    if (d.clave !== $("#reg-clave2").value) { msg.textContent = "Las contraseñas no coinciden."; return; }
    if (d.clave.length < 8 || !/[a-zA-Z]/.test(d.clave) || !/\d/.test(d.clave)) { msg.textContent = "La contraseña debe tener al menos 8 caracteres, con letras y números."; return; }
    const b = $("#reg-enviar"); b.disabled = true; b.textContent = "Enviando…"; msg.textContent = "";
    const r = await Api.post("registro", d);
    b.disabled = false; b.textContent = "Crear cuenta";
    if (r.status === "verificar") { $("#acc-usuario").value = r.usuario; pedirCodigo(r.usuario, r.correo); }
    else if (r.status === "pendiente") { $("#acc-usuario").value = d.usuario; $("#pendiente-texto").textContent = r.message; verAcceso("pendiente"); }
    else {
      msg.textContent = r.message || "No se pudo crear la cuenta.";
      if (r.necesitaSupervisor) { $("#reg-entidad").value = "Empresa externa"; $("#bloque-empresa").hidden = false; $("#reg-supervisor").classList.add("is-invalid"); $("#reg-supervisor").focus(); }
    }
    if (r.status === "verificar" || r.status === "pendiente") ["#reg-clave", "#reg-clave2"].forEach((id) => { $(id).value = ""; });
  });

  $("#form-verificar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const codigo = $("#ver-codigo").value.replace(/\D/g, "");
    const msg = $("#ver-msg"); msg.className = "acceso__msg";
    if (codigo.length !== 6) { msg.textContent = "Escribe los 6 dígitos del código."; return; }
    const b = $("#ver-enviar"); const etiqueta = b.textContent; b.disabled = true; b.textContent = "Verificando…";
    if (modoCodigo === "ingreso") {
      const r = await Api.post("ingresoCodigo", { usuario: usuarioPorVerificar, codigo });
      b.disabled = false; b.textContent = etiqueta;
      if (r.status === "success") {
        Sesion.guardar({ sesion: r.sesion, usuario: r.usuario, nombre: r.nombre, rol: r.rol, expira: r.expira });
        mostrarApp(); return;
      }
      if (r.vencido) { mostrarAcceso(r.message); $("#acc-usuario").value = usuarioPorVerificar; return; }
      msg.textContent = r.message || "No se pudo verificar."; return;
    }
    const r = await Api.post("verificar", { usuario: usuarioPorVerificar, codigo });
    b.disabled = false; b.textContent = etiqueta;
    if (r.status === "pendiente_supervisor" || r.status === "pendiente") {
      $("#pendiente-texto").textContent = r.message; verAcceso("pendiente"); return;
    }
    if (r.status !== "success") { msg.textContent = r.message || "No se pudo verificar."; return; }
    verAcceso("ingreso");
    $("#acc-usuario").value = usuarioPorVerificar;
    $("#acc-msg").textContent = "Correo confirmado. Ingresa con tu contraseña."; $("#acc-msg").classList.add("is-ok");
    setTimeout(() => { try { $("#acc-clave").focus(); } catch (_) {} }, 60);
  });
  $("#ver-reenviar").addEventListener("click", async () => {
    const msg = $("#ver-msg");
    const r = await Api.post(modoCodigo === "ingreso" ? "reenviarIngreso" : "reenviar", { usuario: usuarioPorVerificar });
    msg.className = "acceso__msg" + (r.status === "success" ? " is-ok" : "");
    msg.textContent = r.message || "";
  });

  const salir = $("#salir");
  salir.addEventListener("click", () => {
    if (pendientes().length && !salir.dataset.confirmar) {
      salir.dataset.confirmar = "1"; salir.textContent = "Hay registros sin guardar. ¿Salir?";
      setTimeout(() => { delete salir.dataset.confirmar; salir.textContent = "Cerrar sesión"; }, 4000);
      return;
    }
    Sesion.borrar();
    location.reload();
  });

  /* ======================= Inicio ======================= */
  (async function iniciar() {
    if (!HAY_BACKEND) { mostrarAcceso("El acceso todavía no está configurado: falta conectar el servidor (ver README)."); return; }
    if (!Sesion.token()) { mostrarAcceso(""); return; }
    // Confirma con el servidor que la sesión guardada sigue activa
    $("#acc-msg").textContent = "Verificando sesión…";
    const r = await Api.post("sesion", {});
    if (r.status === "success") mostrarApp();
    else if (r.status !== "sin_sesion") mostrarAcceso(r.message || "No se pudo verificar la sesión.");
  })();
})();
