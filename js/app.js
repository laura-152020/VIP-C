/* VIP-C — Visor interactivo de puntos críticos · Gobernación de Antioquia
 * 1) Carga manual de datos  ·  2) Carga fotográfica con relleno automático (lectura del sello)
 * Guardado: Apps Script (Drive + Sheets) si hay API_URL configurada; si no, en el navegador del dispositivo.
 */
(function () {
  "use strict";

  /* ======================= Catálogos ======================= */
  const TIPOS_AFECTACION = [
    "Deslizamiento / movimiento en masa", "Pérdida de banca", "Hundimiento de la vía",
    "Socavación", "Obstrucción de drenaje o alcantarilla", "Daño en puente o pontón",
    "Daño en muro de contención", "Deterioro de la calzada (baches)", "Inundación", "Otro"
  ];
  const RESPONSABLES = ["Gobernación", "Rentan", "Alcaldía", "Ciudadanía"];
  const ESTADOS = ["Crítico", "No crítico"];
  const ANTIOQUIA = { latMin: 5.40, latMax: 8.90, lonMin: -77.15, lonMax: -73.85 };
  const HAY_BACKEND = typeof CONFIG !== "undefined" && !!CONFIG.API_URL;

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  /* Motivo corto (sin tecnicismos) de por qué no respondió la IA; se muestra en gris, nunca en rojo */
  function motivoIA(m) {
    m = String(m || "");
    if (!m) return "";
    if (/limitando|429|cuota|quota/i.test(m)) return "límite de uso de Gemini";
    if (/\b404\b|not found|no existe/i.test(m)) return "modelo de Gemini no disponible";
    if (/\b40[13]\b|api key|clave|permission|API_KEY/i.test(m)) return "clave de Gemini no válida";
    if (/Falta .*GEMINI|GEMINI_API_KEY/i.test(m)) return "falta la clave de Gemini";
    if (/sesi[oó]n/i.test(m)) return "sesión vencida";
    if (/acci[oó]n|desconocid|unknown/i.test(m)) return "el backend está desactualizado";
    if (/fetch|network|red|timeout|Failed/i.test(m)) return "sin conexión con el servidor";
    return "sin respuesta";
  }
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
    if (m && r.municipioDoc && m.n !== r.municipio && !/capa oficial/.test(r.mensaje || "")) {
      r.mensaje = `El documento dice ${r.municipio} y las coordenadas caen en ${m.n} (capa oficial). Revisa el municipio.`; cambio = true;
    }
    const sub = info.subregion && SUBREGIONES.find((x) => norm(x) === norm(info.subregion));
    if (sub && r.municipioAuto && r.subregion !== sub) { r.subregion = sub; cambio = true; }
    const bonito = (t) => (t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(De|Del|La|Las|Los|El|Y)\b/g, (x) => x.toLowerCase()).replace(/^./, (c) => c.toUpperCase()) : t);
    const vereda = info.vereda ? bonito(info.vereda) : "";
    if (vereda && r.vereda !== vereda) { r.vereda = vereda; cambio = true; }
    const v = info.via;
    if (v) {
      // El tramo y el código oficial salen de la red vial según las coordenadas; solo lo que la persona escribió o eligió se respeta.
      const propio = editado(r, "nombreTramo") || editado(r, "codigoVia") || r.tramoDe === "lista";
      if (!propio) {
        if (v.codigo && r.codigoVia !== v.codigo) { r.codigoVia = v.codigo; cambio = true; }
        if (v.nombre && r.nombreTramo !== v.nombre) { r.nombreTramo = v.nombre; cambio = true; }
        r.tramoDe = "redvial"; r.viaAuto = true;
      } else if (!String(r.codigoVia).trim() && v.codigo) { r.codigoVia = v.codigo; cambio = true; }
      r.viaInfo = `vía ${v.orden.toLowerCase()} a ${Math.round(v.distancia)} m`;
    } else {
      const propio = editado(r, "nombreTramo") || editado(r, "codigoVia") || r.tramoDe === "lista";
      if (!propio && r.latitud === lat && r.longitud === lon) {
        // Sin vía junto al punto: se busca en la red vial el nombre más parecido al del sello; si no hay, queda vacío
        const raw = r.tramoSello || (r.tramoDe === "gem" || r.tramoDe === "ocr" ? r.nombreTramo : "");
        let alt = null;
        try { alt = raw ? await Capas.nombreParecido(raw, 0.72) : null; } catch (_) { alt = undefined; }
        if (alt) { r.nombreTramo = alt.nombre; r.codigoVia = alt.codigo; r.tramoDe = "redvial"; r.viaAuto = true; r.viaInfo = "no hay vía a menos de 300 m; nombre más parecido al del sello"; cambio = true; }
        else if (alt === null) { if (r.nombreTramo || r.codigoVia) { r.nombreTramo = ""; r.codigoVia = ""; r.tramoDe = ""; r.viaAuto = false; } r.viaInfo = "no hay una vía de la red vial (Circular 10) a menos de 300 m de este punto: elígela de la lista"; cambio = true; }
      }
    }
    if (cambio || v) repintarSinPerderFoco(r, repintar);
  }
  // Relación código ↔ nombre de la red vial: al escribir uno, se completa el otro
  async function relacionarVia(r, k, repintar) {
    if (typeof Capas === "undefined") return;
    const texto = String(r[k] || "").trim();
    if (!texto) return;
    const avisar = (t, error) => { if (r === manual) msgManual(t, error); else if (regPdf() === r) msgPdf(t, error); };
    const t0 = Date.now();
    try {
      avisar("Buscando en la red vial…");
      const v = k === "codigoVia" ? await Capas.porCodigo(r.codigoVia) : await Capas.porNombre(r.nombreTramo);
      if (r.eleccion && r.eleccion >= t0) { avisar(""); return; } // eligió de la lista mientras tanto
      if (!v) { avisar(`No se encontró «${texto}» en la red vial (Circular 10). Despliega la lista (▾) para escogerlo, o déjalo escrito así.`, true); return; }
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
    Capas.todasLasVias().catch(() => {}); // precarga la red vial para que la lista de tramos abra rápido
  }

  /* ---------- Lista desplegable de tramos ----------
     Se despliega con ▾ o al escribir en «Código» o «Nombre del tramo». Arriba, las vías cercanas al punto
     (si tiene coordenadas); abajo, la red vial completa filtrada por lo escrito. Al elegir, se llenan los dos campos. */
  const cajaDe = (el) => el.closest("#form-manual, #form-pdf, .card");
  function registroDe(el) {
    const c = cajaDe(el); if (!c) return null;
    if (c.id === "form-manual") return manual;
    if (c.id === "form-pdf") return pdfActual ? regPdf() : null;
    return items.find((x) => x.id == c.dataset.id) || null;
  }
  function repintarCaja(c, r) { if (c.id === "form-manual") pintarManual(); else if (c.id === "form-pdf") pintarPdf(); else actualizar(r); }
  function cerrarListas(excepto) {
    document.querySelectorAll(".combo-lista:not([hidden])").forEach((l) => {
      if (l === excepto) return;
      l.hidden = true; l.innerHTML = "";
      l.parentNode.querySelectorAll('[aria-controls="' + l.id + '"]').forEach((i) => i.setAttribute("aria-expanded", "false"));
    });
  }
  let pedidoLista = 0;
  async function abrirLista(el, texto) {
    const c = cajaDe(el), r = registroDe(el), lista = c && $(".combo-lista", c);
    if (!lista || !r || typeof Capas === "undefined") return;
    cerrarListas(lista);
    const n = ++pedidoLista;
    lista.hidden = false; lista._listo = false;
    c.querySelectorAll('[aria-controls="' + lista.id + '"]').forEach((i) => i.setAttribute("aria-expanded", "true"));
    if (!lista.innerHTML) lista.innerHTML = '<div class="combo__vacio"><span class="girando" aria-hidden="true"></span> Cargando la red vial…</div>';
    const pCerca = tieneCoord(r) ? Capas.viasCercanas(r.latitud, r.longitud, 1500, 6).catch(() => []) : Promise.resolve([]);
    const pTodas = Capas.buscarVias(texto || "", 60).catch(() => null);
    // Lo que llegue primero se muestra ya (las vías cercanas suelen llegar antes que la red vial completa)
    const pintar = (cerca, todas, cargando) => {
      if (n !== pedidoLista || lista.hidden) return;
      pintarLista(lista, texto, cerca, todas, cargando);
    };
    pCerca.then((c) => { if (!lista._listo) pintar(c, [], true); });
    const [cerca, todas] = await Promise.all([pCerca, pTodas]);
    lista._listo = true;
    pintar(cerca, todas, false);
  }
  function pintarLista(lista, texto, cerca, todas, cargando) {
    const ops = [];
    const op = (v, extra) => { ops.push(v); return `<button type="button" class="combo__op" role="option" data-op="${ops.length - 1}"><b>${esc(v.nombre || "(sin nombre)")}</b><span>${esc(v.codigo || "")}</span>${extra ? `<small>${extra}</small>` : ""}</button>`; };
    let html = "";
    const q = norm(texto);
    const cercaF = cerca.filter((v) => !q || norm(v.nombre + " " + v.codigo).includes(q));
    if (cercaF.length) html += '<div class="combo__grupo">Cerca del punto</div>' + cercaF.map((v) => op(v, `Vía ${esc((v.orden || "").toLowerCase())} a ${Math.round(v.distancia)} m`)).join("");
    if (todas === null) html += '<div class="combo__vacio">No se pudo cargar la red vial. Revisa la conexión o escribe el tramo a mano.</div>';
    else {
      const resto = todas.filter((v) => !cercaF.some((x) => x.codigo === v.codigo && x.nombre === v.nombre));
      if (resto.length) html += `<div class="combo__grupo">${q ? "Red vial · coincidencias" : "Red vial (Circular 10)"}</div>` + resto.map((v) => op(v, v.orden ? "Vía " + esc(v.orden.toLowerCase()) : "")).join("");
      else if (cargando) html += '<div class="combo__vacio"><span class="girando" aria-hidden="true"></span> Cargando la red vial completa…</div>';
      else if (!cercaF.length) html += `<div class="combo__vacio">Ninguna vía de la red vial coincide con «${esc(texto)}». Puedes dejarlo escrito así.</div>`;
    }
    lista.innerHTML = html;
    lista._ops = ops;
  }
  function elegirVia(boton) {
    const c = cajaDe(boton), r = registroDe(boton), lista = boton.closest(".combo-lista");
    const v = lista && lista._ops && lista._ops[Number(boton.dataset.op)];
    if (!r || !v) return;
    r.codigoVia = v.codigo || ""; r.nombreTramo = v.nombre || "";
    r.tramoDe = "lista"; r.viaAuto = false; r.relAuto = false; r.eleccion = Date.now();
    r.editados = Object.assign(r.editados || {}, { codigoVia: true, nombreTramo: true });
    if (v.distancia != null) r.viaInfo = `vía ${String(v.orden || "").toLowerCase()} a ${Math.round(v.distancia)} m`;
    cerrarListas();
    repintarCaja(c, r);
    const n = document.getElementById((c.id === "form-manual" ? "m-" : c.id === "form-pdf" ? "p-" : "c" + r.id + "-") + "nt");
    if (n) n.focus();
  }
  let esperaLista = null;
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (!el.matches || !el.matches('[data-k="nombreTramo"], [data-k="codigoVia"]')) return;
    clearTimeout(esperaLista);
    esperaLista = setTimeout(() => abrirLista(el, el.value), 160);
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-combo]");
    if (b) {
      e.preventDefault();
      const c = cajaDe(b), lista = c && $(".combo-lista", c);
      if (lista && !lista.hidden) { cerrarListas(); return; }
      abrirLista(b, "");
      return;
    }
    const o = e.target.closest && e.target.closest("[data-op]");
    if (o) { e.preventDefault(); elegirVia(o); return; }
    if (!(e.target.closest && e.target.closest(".combo, .combo-lista"))) cerrarListas();
  });
  document.addEventListener("keydown", (e) => {
    const el = e.target;
    if (!el.closest) return;
    const enLista = el.closest(".combo-lista"), enCampo = el.matches('[data-k="nombreTramo"], [data-k="codigoVia"]');
    if (!enLista && !enCampo) return;
    if (e.key === "Escape") { cerrarListas(); if (enLista) { const c = cajaDe(el); const i = c && $('[data-k="nombreTramo"]', c); if (i) i.focus(); } return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const c = cajaDe(el), lista = c && $(".combo-lista", c);
    if (!lista || lista.hidden) { if (enCampo && e.key === "ArrowDown") { e.preventDefault(); abrirLista(el, ""); } return; }
    const ops = [...lista.querySelectorAll("[data-op]")]; if (!ops.length) return;
    e.preventDefault();
    const i = ops.indexOf(document.activeElement);
    const sig = enCampo ? (e.key === "ArrowDown" ? 0 : ops.length - 1) : Math.max(0, Math.min(ops.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
    if (enLista && i === 0 && e.key === "ArrowUp") { const f = $('[data-k="nombreTramo"]', c); if (f) f.focus(); return; }
    ops[sig].focus();
  });

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
  const origenTramo = (r) => {
    const t = r.viaAuto ? "red vial" : { lista: "de la lista", gem: "leído con IA", pdf: "del PDF", redvial: "red vial", ocr: "del sello" }[r.tramoDe] || "";
    return t ? `<span class="auto">· ${t}</span>` : "";
  };
  function campos(r, p) {
    const alerta = fuera(r) ? '<div class="alerta">La ubicación cae fuera de Antioquia. Verifica las coordenadas.</div>' : "";
    return `
      <div class="grid">
        <label for="${p}fe"><span>Fecha de la visita <em>*</em></span><input id="${p}fe" type="date" data-k="fecha" value="${esc(r.fecha)}"></label>
        <label for="${p}la"><span>Latitud</span><input id="${p}la" class="mono" data-k="latitudDMS" value="${esc(r.latitudDMS)}" placeholder="6°10'42&quot;N" inputmode="text"></label>
        <label for="${p}lo"><span>Longitud</span><input id="${p}lo" class="mono" data-k="longitudDMS" value="${esc(r.longitudDMS)}" placeholder="75°9'57&quot;W" inputmode="text"></label>
      </div>
      <div class="coord" data-coord>${lineaCoord(r)}</div>${alerta}
      <div class="grid grid--via">
        <label for="${p}cv"><span>Código oficial de la vía ${r.viaAuto ? '<span class="auto">· red vial</span>' : ""}</span><div class="combo"><input id="${p}cv" class="mono" data-k="codigoVia" value="${esc(r.codigoVia)}" placeholder="Ej. 60AN17" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="${p}vl" aria-expanded="false"><button type="button" class="combo__btn" data-combo aria-label="Ver la lista de vías" title="Ver la lista de vías">▾</button></div></label>
        <label for="${p}nt"><span>Nombre del tramo ${origenTramo(r)}</span><div class="combo"><input id="${p}nt" data-k="nombreTramo" value="${esc(r.nombreTramo)}" title="${esc(r.nombreTramo)}" placeholder="Escribe o despliega la lista" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="${p}vl" aria-expanded="false"><button type="button" class="combo__btn" data-combo aria-label="Ver la lista de tramos" title="Ver la lista de tramos">▾</button></div></label>
      </div>
      <div class="combo-lista" id="${p}vl" role="listbox" aria-label="Vías de la red vial" hidden></div>
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
    r.editados = r.editados || {};
    r.editados[k === "latitudDMS" || k === "longitudDMS" ? "coord" : k] = true;
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
      // Recorte de la franja inferior (45 %) a buena resolución: el texto del sello llega grande y nítido a Gemini
      const y0 = Math.round(img.height * 0.55), hR = img.height - y0, fR = Math.min(3, 2000 / img.width);
      const c4 = document.createElement("canvas");
      c4.width = Math.round(img.width * fR); c4.height = Math.round(hR * fR);
      const x4 = c4.getContext("2d"); x4.imageSmoothingQuality = "high"; x4.drawImage(img, 0, y0, img.width, hR, 0, 0, c4.width, c4.height);
      return { dataUrl, base64: dataUrl.split(",")[1], base64Lectura: c3.toDataURL("image/jpeg", 0.82).split(",")[1], recorte: c4.toDataURL("image/jpeg", 0.9).split(",")[1], miniatura: c2.toDataURL("image/jpeg", 0.75) };
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

  async function agregarFotos(files, opciones) {
    const creados = [];
    const maxMB = CONFIG.MAX_FILE_SIZE_MB || 20;
    for (const f of files) {
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { aviso(f.name + " no es JPG, PNG ni WEBP.", true); continue; }
      if (f.size > maxMB * 1048576) { aviso(f.name + " supera " + maxMB + " MB.", true); continue; }
      let opt;
      try { opt = await optimizar(f); } catch (_) { aviso("No se pudo abrir " + f.name + ".", true); continue; }
      const r = nuevoRegistro({ origen: "foto", estado: "leyendo", nombreArchivo: f.name, dataUrl: opt.dataUrl, base64: opt.base64, base64Lectura: opt.base64Lectura, recorte: opt.recorte, miniatura: opt.miniatura,
        responsable: manual.responsable || "" });
      if (opciones && opciones.dePdf) r.dePdf = true;
      r.exif = await leerExif(f);
      r.urlOriginal = URL.createObjectURL(f); // el lector usa la foto original: la copia recomprimida borra detalle del sello
      items.unshift(r);
      cola.push(r);
      creados.push(r);
    }
    render();
    procesarCola();
    return creados;
  }

  const cola = [];
  let ocupado = false;
  async function procesarCola() {
    if (ocupado) return;
    ocupado = true;
    while (cola.length) await leer(cola.shift());
    ocupado = false;
  }

  /* Lectura de una foto.
     Gemini (IA, en el servidor) es el lector principal: recibe la foto y una ampliación del sello.
     El lector del navegador trabaja al mismo tiempo y muestra un resultado rápido; cuando llega la IA,
     corrige todo lo que se llenó solo (nunca lo que la persona escribió). Si las dos lecturas no coinciden,
     o la IA no está segura, se pide una segunda lectura «precisa» (la IA razona dígito por dígito). */
  let avisoPrimeraVez = true;
  /* Consultas a Gemini EN FILA (máx. 2 a la vez) y con reintento automático si Gemini limita solicitudes (429).
     Mandar muchas consultas juntas hace que Gemini las rechace y todo termina en el lector lento del navegador. */
  const ColaIA = (() => {
    let activos = 0; const espera = [];
    const siguiente = () => { if (activos >= 2 || !espera.length) return; activos++; const t = espera.shift(); t().finally(() => { activos--; siguiente(); }); };
    return (fn) => new Promise((ok) => { espera.push(() => Promise.resolve().then(fn).then(ok, () => ok(null))); siguiente(); });
  })();
  const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
  async function postIA(accion, datos, sigue) {
    let r = null;
    for (let i = 0; i < 3; i++) {
      r = await ColaIA(() => (sigue && !sigue() ? { status: "omitido" } : Api.post(accion, datos)));
      if (!r || r.status === "success" || r.status === "omitido" || !r.reintentar) break;
      await pausa(3000 * (i + 1) + Math.random() * 1000); // Gemini pidió esperar: se reintenta solo
    }
    if (r && r.status !== "success" && r.status !== "omitido") console.warn("[VIP-C IA]", accion, r.message);
    return r || { status: "error", message: "sin respuesta" };
  }
  const deIA = (s) => ({ fecha: s.fecha, fechaTexto: s.fechaTexto, latitud: s.latitud, longitud: s.longitud, latitudDMS: s.latitudDMS, longitudDMS: s.longitudDMS,
    tramo: LectorSello.corregirTramo(s.tramo || ""), codigoVia: s.codigoVia, municipioTexto: s.municipio, tipoAfectacion: s.tipoAfectacion,
    seguridad: s.seguridad || "", preciso: !!s.preciso, legible: !!s.selloLegible });
  function pedirIA(r, preciso) {
    if (!HAY_BACKEND) return Promise.resolve(null);
    return Promise.race([
      postIA("leer", { base64: r.base64Lectura || r.base64, recorte: r.recorte || "", mimeType: "image/jpeg", preciso: !!preciso })
        .then((s) => { if (s.status === "success") return deIA(s); r.errorIA = s.message || "sin respuesta"; return null; }).catch(() => null),
      new Promise((ok) => setTimeout(() => ok(null), preciso ? 70000 : 45000)) // máximo 45 s (70 s en la lectura precisa), con reintentos
    ]);
  }
  const editado = (r, k) => !!(r.editados && r.editados[k]);
  const metros = (a, b) => Math.hypot((a.latitud - b.latitud) * 110574, (a.longitud - b.longitud) * 111320);
  function ponerCoords(r, x, de) {
    r.latitud = x.latitud; r.longitud = x.longitud;
    // Las coordenadas se muestran como están escritas en el sello (decimales o grados), sin convertirlas
    const comoSello = (t, v, esLat) => {
      t = String(t || "").trim();
      if (!/\d/.test(t)) return decimalADMS(v, esLat);
      return /[°NSWOE]/i.test(t) ? t : t.replace(/^-/, "") + (esLat ? (v < 0 ? "S" : "N") : (v < 0 ? "W" : "E"));
    };
    r.latitudDMS = comoSello(x.latitudDMS, x.latitud, true);
    r.longitudDMS = comoSello(x.longitudDMS, x.longitud, false);
    r.origenUbicacion = "sello"; r.coordDe = de;
  }
  // Lo que leyó la IA reemplaza lo que se llenó solo. Devuelve true si cambió algo.
  function aplicarIA(r, x) {
    if (!x || r.estado === "guardado" || r.estado === "guardando") return false;
    let cambio = false, coords = false;
    if (x.fecha && !editado(r, "fecha") && x.fecha !== r.fecha) { r.fecha = x.fecha; r.fechaTexto = x.fechaTexto || ""; cambio = true; }
    if (x.latitud != null && x.longitud != null && !editado(r, "coord") && (!tieneCoord(r) || metros(x, r) > 5)) { ponerCoords(r, x, "gem"); cambio = coords = true; }
    if (x.tramo) r.tramoSello = x.tramo; // lo escrito en el sello solo orienta: el tramo definitivo sale de la red vial
    if (x.tramo && !editado(r, "nombreTramo") && r.tramoDe !== "lista" && x.tramo !== r.nombreTramo && !tieneCoord(r)) { r.nombreTramo = x.tramo; r.tramoDe = "gem"; r.viaAuto = false; cambio = true; }
    if (x.codigoVia && !editado(r, "codigoVia") && r.tramoDe !== "lista" && x.codigoVia !== r.codigoVia) { r.codigoVia = x.codigoVia; cambio = true; }
    if (x.tipoAfectacion && !editado(r, "tipoAfectacion") && TIPOS_AFECTACION.includes(x.tipoAfectacion) && x.tipoAfectacion !== r.tipoAfectacion) { r.tipoAfectacion = x.tipoAfectacion; cambio = true; }
    if (x.municipioTexto) r.municipioTexto = x.municipioTexto;
    if (coords && (r.municipioAuto || !r.municipio)) {
      const antes = [r.municipio, r.subregion];
      r.municipio = ""; r.municipioAuto = true; completarDesdeCoordenadas(r);
      if (!r.municipio) [r.municipio, r.subregion] = antes; // fuera de los límites incluidos: se deja el que tenía
    }
    r.leidoPor = x.preciso ? "ia-preciso" : "ia";
    return cambio || coords;
  }
  // Estado de la tarjeta y aviso, según lo que quedó leído
  function evaluar(r, error) {
    const dudosa = !!r.coordDudosa && r.origenUbicacion === "sello";
    const otroMun = r.municipioTexto && r.municipio && norm(r.municipioTexto) !== norm(r.municipio) && r.municipioAuto ? r.municipioTexto : "";
    const leido = r.fecha && tieneCoord(r) && !dudosa;
    r.estado = leido ? "listo" : "revisar";
    r.mensaje = error ? error + " Completa los datos a mano."
      : dudosa ? (r.avisoDuda || "Verifica las coordenadas: el sello se leyó con dudas. Compáralas con la foto (toca «Ampliar»).")
      : leido ? (otroMun ? `El sello menciona «${otroMun}» y las coordenadas caen en ${r.municipio}. Revisa el municipio.` : "") : (!tieneCoord(r) && r.fecha && r.municipio
        ? "La foto no trae coordenadas. El municipio se tomó del texto del sello; agrega las coordenadas si las tienes."
        : "No se leyó todo el sello. Completa " + [!r.fecha && "la fecha", !tieneCoord(r) && "las coordenadas"].filter(Boolean).join(" y ") + ".");
  }
  // ¿Hace falta una segunda lectura precisa? (la IA no leyó todo, no está segura o no coincide con el lector del navegador)
  function hayQueVerificar(gem, ocr) {
    if (!gem) return false;
    if (gem.preciso) return false;
    if (gem.latitud == null || !gem.fecha) return true;
    if (gem.seguridad === "baja") return true;
    if (ocr && ocr.latitud != null && !ocr.coordDudosa && metros(gem, ocr) > 100) return true;
    if (ocr && ocr.fecha && ocr.fecha !== gem.fecha) return true;
    return false;
  }
  async function verificarIA(r, gem, ocr) {
    if (!hayQueVerificar(gem, ocr) || r.estado === "guardado" || r.estado === "guardando") return;
    r.confirmandoIA = true; actualizar(r);
    const x = await pedirIA(r, true);
    r.confirmandoIA = false;
    if (x && (x.latitud != null || x.fecha)) {
      const otra = gem.latitud != null && x.latitud != null && metros(gem, x) > 100 && !(ocr && ocr.latitud != null && metros(ocr, x) < 100);
      r.coordDudosa = otra; // dos lecturas de la IA muy distintas y el lector no confirma ninguna: que la persona la revise
      r.avisoDuda = otra ? "Verifica las coordenadas: la IA leyó dos valores distintos en el sello. Compáralas con la foto (toca «Ampliar»)." : "";
      if (aplicarIA(r, x)) enriquecer(r, () => actualizar(r));
    }
    evaluar(r, ""); repintarSinPerderFoco(r, () => actualizar(r));
  }

  async function leer(r) {
    r.estado = "leyendo"; r.confirmandoIA = false; r.leidoPor = ""; r.errorIA = ""; actualizar(r);
    const preciso = !!r.releerPreciso; r.releerPreciso = false; // «Volver a leer la foto» va directo a la lectura precisa
    let error = "";
    const completo = (x) => !!(x && x.fecha && x.latitud != null && !x.coordDudosa);
    const pGem = pedirIA(r, preciso);
    if (avisoPrimeraVez) { aviso("Preparando el lector de fotos. La primera vez tarda unos segundos."); avisoPrimeraVez = false; }
    const pOcr = LectorSello.leer(r.urlOriginal || r.dataUrl).catch((e) => { error = e.message || "No se pudo leer la foto."; return null; }).finally(() => aviso(""));
    const sinVacios = (x) => Object.fromEntries(Object.entries(x || {}).filter(([, v]) => v != null && v !== ""));
    const primero = await Promise.race([pGem.then((x) => ["gem", x]), pOcr.then((x) => ["ocr", x])]);
    let d, gem = null, ocr = null, falta = null;
    if (completo(primero[1])) {
      d = primero[1];
      if (primero[0] === "gem") { gem = d; falta = pOcr; } else { ocr = d; falta = pGem; }
    } else {
      const otro = await (primero[0] === "gem" ? pOcr : pGem);
      gem = primero[0] === "gem" ? primero[1] : otro; ocr = primero[0] === "gem" ? otro : primero[1];
      d = (gem || ocr) ? Object.assign({}, ocr || {}, sinVacios(gem)) : null; // Gemini manda sobre el lector
    }
    d = d || {};
    const deGem = !!gem && (d === gem || !ocr || completo(gem));
    if (d.fecha) { r.fecha = d.fecha; r.fechaTexto = d.fechaTexto || ""; }
    if (d.latitud != null && d.longitud != null) ponerCoords(r, d, deGem ? "gem" : "ocr");
    else if (r.exif && r.exif.lat != null) {
      r.latitud = r.exif.lat; r.longitud = r.exif.lon;
      r.latitudDMS = decimalADMS(r.latitud, true); r.longitudDMS = decimalADMS(r.longitud, false);
      r.origenUbicacion = "gps";
    }
    if (!r.fecha && r.exif && r.exif.fecha) r.fecha = r.exif.fecha;
    if (d.tramo) r.tramoSello = d.tramo;
    if (d.tramo && !tieneCoord(r) && (!r.nombreTramo || r.tramoDe === "ocr" || r.tramoDe === "gem")) { r.nombreTramo = d.tramo; r.tramoDe = gem && gem.tramo === d.tramo ? "gem" : "ocr"; }
    if (d.codigoVia && !r.codigoVia) r.codigoVia = d.codigoVia;
    if (d.tipoAfectacion && !r.tipoAfectacion && TIPOS_AFECTACION.includes(d.tipoAfectacion)) r.tipoAfectacion = d.tipoAfectacion;
    r.coordDudosa = !!d.coordDudosa && !deGem;
    r.municipioTexto = d.municipioTexto || "";
    completarDesdeCoordenadas(r);
    // Sin coordenadas: municipio por el nombre escrito en el sello (ej. "Grada el peñol" → El Peñol)
    if ((!r.municipio || r.municipioAuto) && !tieneCoord(r) && d.municipioTexto) {
      const m = MUN_POR_NOMBRE[norm(d.municipioTexto)];
      if (m) { r.municipio = m.n; r.subregion = m.s; r.municipioAuto = true; }
    }
    r.selloLegible = !!(d.fecha && d.latitud != null);
    r.iaSinSello = !!gem && !gem.fecha && gem.latitud == null; // la IA miró la imagen y no vio sello
    r.leidoPor = deGem ? (gem.preciso ? "ia-preciso" : "ia") : (ocr ? "lector" : "");
    r.confirmandoIA = !!falta && primero[0] === "ocr"; // se muestra lo del lector mientras llega la IA
    evaluar(r, error);
    actualizar(r);
    enriquecer(r, () => actualizar(r));
    // Tramo leído solo por el lector del navegador: se corrige con el nombre más parecido de la red vial (Circular 10)
    // Sin coordenadas: el nombre del sello se cambia por el más parecido de la red vial; si no hay ninguno, queda vacío (no se deja texto que no sea de la red vial)
    const corregirConRed = () => { if ((r.tramoDe === "ocr" || r.tramoDe === "gem") && typeof Capas !== "undefined") Capas.nombreParecido(r.nombreTramo, 0.72).then((v) => {
      if (r.estado === "guardado" || r.estado === "guardando" || (r.tramoDe !== "ocr" && r.tramoDe !== "gem") || editado(r, "nombreTramo")) return;
      if (v) { r.nombreTramo = v.nombre; r.tramoDe = "redvial"; if (!r.codigoVia) r.codigoVia = v.codigo; r.viaInfo = "nombre de la red vial más parecido al del sello"; }
      else { r.nombreTramo = ""; r.tramoDe = ""; r.viaInfo = "el tramo del sello no está en la red vial: elígelo de la lista"; }
      repintarSinPerderFoco(r, () => actualizar(r));
    }).catch(() => {}); };
    if (!falta) { corregirConRed(); verificarIA(r, gem, ocr); return; }
    // El segundo lector termina en segundo plano: la siguiente foto de la cola empieza ya
    falta.then((x) => {
    if (r.estado === "guardado" || r.estado === "guardando") return;
    if (primero[0] === "ocr") {
      // Llegó la IA después del lector: manda la IA
      r.confirmandoIA = false; gem = x; r.iaSinSello = !!x && !x.fecha && x.latitud == null;
      if (x) { r.coordDudosa = false; if (aplicarIA(r, x)) enriquecer(r, () => actualizar(r)); }
      else corregirConRed();
    } else {
      // Llegó el lector después de la IA: solo completa lo que falte
      ocr = x; r.iaSinSello = !!gem && !gem.fecha && gem.latitud == null;
      if (x && x.codigoVia && !r.codigoVia) r.codigoVia = x.codigoVia;
      if (x && x.tramo) r.tramoSello = r.tramoSello || x.tramo;
      if (x && x.tramo && !r.nombreTramo && !tieneCoord(r)) { r.nombreTramo = x.tramo; r.tramoDe = "ocr"; corregirConRed(); }
    }
    evaluar(r, x || gem ? "" : error);
    repintarSinPerderFoco(r, () => actualizar(r));
    verificarIA(r, gem, ocr);
    });
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
    const esperando = pdfActual && pdfActual.leyendoFotos && r.mensaje && /coordenadas|fecha/.test(r.mensaje);
    const falta = [!r.fecha && "la fecha", !tieneCoord(r) && "las coordenadas"].filter(Boolean).join(" y ") || "los datos";
    formPdf.innerHTML = (esperando ? `<div class="info"><span class="girando" aria-hidden="true"></span>Leyendo las imágenes del PDF para encontrar ${falta}. Por favor espera unos segundos…</div>`
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

  /* El PDF solo se usa como contenedor de fotos: se sacan sus imágenes y cada una se lee como una foto
     (sección 2), sin leer el texto del documento. */
  async function cargarPDF(f) {
    if (!f) return;
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) { msgPdf(f.name + " no es un PDF.", true); return; }
    if (f.size > 40 * 1048576) { msgPdf(f.name + " supera 40 MB.", true); return; }
    $("#p-archivo").textContent = f.name;
    msgPdf("Sacando las imágenes del PDF…");
    try {
      const { doc } = await LectorPDF.abrirSoloImagenes(new Uint8Array(await f.arrayBuffer()));
      const fotos = await LectorPDF.imagenes(doc, 60, 260);
      if (!fotos.length) { msgPdf("El PDF no tiene imágenes (fotos) para leer.", true); return; }
      const base = f.name.replace(/\.pdf$/i, "").replace(/[^\w.-]+/g, "_").slice(0, 40);
      const archivos = [];
      for (let i = 0; i < fotos.length; i++) {
        const img = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = fotos[i].dataUrl; });
        const cv = document.createElement("canvas"); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        cv.getContext("2d").drawImage(img, 0, 0);
        const blob = await new Promise((ok) => cv.toBlob(ok, "image/jpeg", 0.93));
        archivos.push(new File([blob], `${base}_p${fotos[i].pagina}_${i + 1}.jpg`, { type: "image/jpeg" }));
      }
      msgPdf(`${archivos.length} imagen(es) sacadas del PDF. Leyendo los sellos…`);
      const creados = await agregarFotos(archivos, { dePdf: true });
      const dest = document.querySelector("#seccion-fotos"); if (dest) dest.scrollIntoView({ behavior: "smooth", block: "start" });
      // Solo cuentan las imágenes con sello (fecha y coordenadas): mapas, capturas y logos se descartan al terminar de leerlas
      const t0 = Date.now(), terminado = (r) => r.estado !== "leyendo" && !r.confirmandoIA && !r.verificando;
      while (creados.some((r) => !terminado(r)) && Date.now() - t0 < 240000) {
        const n = creados.filter(terminado).length; msgPdf(`${archivos.length} imagen(es) del PDF · leyendo sellos (${n} de ${archivos.length})…`);
        await new Promise((ok) => setTimeout(ok, 500));
      }
      // Se descarta solo si la IA las leyó y no encontró sello; si solo las leyó el lector del navegador no hay certeza y quedan para revisar
      const sinSello = creados.filter((r) => !r.fecha && r.iaSinSello && items.includes(r));
      sinSello.forEach((r) => { if (r.urlOriginal) URL.revokeObjectURL(r.urlOriginal); });
      items = items.filter((x) => !sinSello.includes(x));
      render();
      const buenas = creados.length - sinSello.length;
      msgPdf(`${buenas} foto(s) con sello leídas${sinSello.length ? ` · ${sinSello.length} imagen(es) sin sello descartadas (mapas, capturas o logos)` : ""}.`, !buenas);
    } catch (e) { msgPdf("No se pudo abrir " + f.name + ": " + (e.message || "PDF dañado o protegido") + ".", true); }
  }
  async function cargarPDFViejo(f) {
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
    const g = await postIA("leerPdf", { base64: pdf.base64 });
    $("#p-ia").hidden = true;
    if (pdfActual !== pdf) return;
    if (g.status !== "success") { pdf.errorIA = g.message || "sin respuesta"; return; } // sigue con lo que leyó el navegador (el motivo queda en la consola)
    const habiaPuntos = d.puntos.length;
    d.fecha = d.fecha || g.fecha || ""; d.codigoVia = d.codigoVia || g.codigoVia || ""; d.via = d.via || g.via || ""; d.municipioTexto = g.municipio || "";
    if (g.resumen) d.resumen = g.resumen;
    const gPuntos = (Array.isArray(g.puntos) ? g.puntos : []).map((p) => Object.assign({}, p, { lat: p.latitud, lon: p.longitud, prN: LectorPDF.prDe("pr" + String(p.pr || "").replace(/^\s*(pr|k|km)\.?\s*/i, "")) }));
    const suyo = (r) => gPuntos.find((p) => p.lat != null && tieneCoord(r) && distanciaM({ lat: r.latitud, lon: r.longitud }, p) < 80)
      || gPuntos.find((p) => p.prN && r.pr && p.prN === r.pr) || gPuntos.find((p) => p.nombre && r.punto && norm(p.nombre) === norm(r.punto));
    tramosPdf.forEach((r) => {
      if (!r.agregado && r.obsAuto && !editado(r, "observaciones")) {
        const p = tramosPdf.length > 1 ? suyo(r) : null;
        if (p && p.descripcion) r.observaciones = (r.punto ? r.punto + ": " : "") + p.descripcion;
        else if (tramosPdf.length === 1 && d.resumen) r.observaciones = d.resumen;
      }
      if (!r.fecha) r.fecha = d.fecha; if (!r.codigoVia) r.codigoVia = d.codigoVia; if (!r.nombreTramo && d.via) { r.nombreTramo = d.via; r.tramoDe = "gem"; }
    });
    // Gemini entiende cualquier formato de PDF: sus sitios que no estén ya en la lista se agregan.
    // Un sitio sin coordenadas ni PR solo se agrega si el lector del navegador no encontró ningún sitio.
    if (Array.isArray(g.puntos)) {
      const hayLocales = tramosPdf.some((r) => tieneCoord(r) || r.pr);
      const limpiarPr = (x) => LectorPDF.prDe("pr" + String(x || "").replace(/^\s*(pr|k|km)\.?\s*/i, ""));
      await sumarPuntosPdf(pdf, d, g.puntos
        .map((p, k) => ({ lat: p.latitud, lon: p.longitud, pr: limpiarPr(p.pr), fecha: p.fecha || "", nombre: p.nombre || "Punto " + (k + 1),
          via: LectorSello.corregirTramo(p.via || ""), codigoVia: p.codigoVia || "", municipio: p.municipio || "",
          tipo: p.tipoAfectacion || "", descripcion: p.descripcion || "", pagina: p.pagina || 1, deGemini: true }))
        .filter((p) => (p.lat != null && p.lon != null) || p.pr || !hayLocales));
    }
    pintarPdf();
    if (g.resumen) msgPdf("Gemini leyó el documento completo (texto y fotos). Revisa los datos y toca «Agregar a la lista».");
  }

  // Observaciones de un tramo: si el documento describe varios sitios, cada uno lleva SOLO lo suyo
  // (hallazgo, medidas y recomendación); el resumen de todo el documento queda para actas de un solo sitio.
  const corto = (t, n) => (t.length > n ? t.slice(0, n).replace(/\s+\S*$/, "") + "…" : t);
  function obsDePunto(d, p) {
    const varios = (d.puntos || []).length > 1 || tramosPdf.length > 1;
    if (!varios) return d.resumen || p.resumen || p.descripcion || "";
    if (p.deGemini && p.descripcion) return (p.nombre ? p.nombre + ": " : "") + p.descripcion;
    return p.resumen || corto(String(p.descripcion || ""), 900);
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
      fecha: p.fecha || d.fecha || "", fechaTexto: d.fechaTexto || "", codigoVia: p.codigoVia || d.codigoVia || "", nombreTramo: p.via || d.via || "",
      tramoDe: p.via || d.via ? "pdf" : "",
      tipoAfectacion: "", responsable: "",
      observaciones: obsDePunto(d, p), obsAuto: true,
      pr: p.pr || ""
    });
    // Municipio escrito en la fila del punto: lo dice el documento, no se cambia solo
    const mDoc = p.municipio && MUN_POR_NOMBRE[norm(p.municipio)];
    if (mDoc) { r.municipio = mDoc.n; r.subregion = mDoc.s; r.municipioAuto = false; r.municipioDoc = true; }
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
    const otroMun = !mDoc && tieneCoord(r) && enTexto.length && !enTexto.some((m) => m.n === r.municipio)
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
    completarTramo(r, Object.assign({}, p, { foto: "" }));
    r.mensaje = !r.fecha ? "No se encontró en el PDF la fecha. Complétala a mano." : "";
    enriquecer(r, () => { if (regPdf() === r) pintarPdf(); });
  }
  // Completa lo que le falte a un tramo con los datos de otra lectura (Gemini, foto o tabla). Nunca pisa lo que ya tiene.
  const codNorm = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  function completarTramo(r, p) {
    let c = false;
    if (!r.fecha && p.fecha) { r.fecha = p.fecha; c = true; }
    if (p.foto && !r.fotoPropia) { r.dataUrl = p.foto; r.miniatura = p.foto; r.fotoPropia = true; c = true; }
    if (!String(r.nombreTramo).trim() && p.via) { r.nombreTramo = p.via; r.tramoDe = p.deGemini ? "gem" : "pdf"; c = true; }
    if (!String(r.codigoVia).trim() && p.codigoVia) { r.codigoVia = p.codigoVia; c = true; }
    if (!r.pr && p.pr) { r.pr = p.pr; c = true; }
    if ((!r.municipio || r.municipioAuto) && !tieneCoord(r) && p.municipio) {
      const m = MUN_POR_NOMBRE[norm(p.municipio)]; if (m) { r.municipio = m.n; r.subregion = m.s; r.municipioAuto = true; c = true; }
    }
    if (c && r.fecha && /fecha/.test(r.mensaje || "") && tieneCoord(r)) r.mensaje = "";
    return c;
  }
  async function sumarPuntosPdf(pdf, d, puntos) {
    let nuevos = 0, completados = 0;
    const afectados = [];
    for (const p of puntos) {
      if (pdfActual !== pdf) return { nuevos, completados, afectados };
      // 1) Ya hay un tramo a menos de 80 m (con la misma abscisa, si las dos la tienen): solo se completa
      const cerca = p.lat != null && tramosPdf.find((r) => tieneCoord(r) && distanciaM({ lat: r.latitud, lon: r.longitud }, p) < 80 && (!p.pr || !r.pr || r.pr === p.pr));
      if (cerca) {
        if (!cerca.agregado) { if (completarTramo(cerca, p)) completados++; afectados.push(cerca); }
        continue;
      }
      // 2) Misma abscisa PR (y misma vía, si las dos la traen): va a ese tramo (ej. foto con «pr18+200» en el sello)
      const mismoPr = p.pr && tramosPdf.find((r) => r.pr && r.pr === p.pr && !r.agregado && (!p.codigoVia || !r.codigoVia || codNorm(r.codigoVia) === codNorm(p.codigoVia)));
      if (mismoPr) {
        if (p.lat != null && !tieneCoord(mismoPr)) { ponerCoordsTramo(mismoPr, p); completados++; }
        else if (completarTramo(mismoPr, p)) completados++;
        afectados.push(mismoPr);
        continue;
      }
      // 3) Foto sin PR legible en un informe por secciones: va a la sección en cuya página (o después) aparece la foto
      const secciones = tramosPdf.filter((r) => r.pr && !r.agregado);
      if (!p.pr && p.lat != null && secciones.length) {
        const previas = secciones.filter((r) => !tieneCoord(r) && (r.pagina || 1) <= (p.pagina || 1));
        const sec = previas.sort((a, b) => (b.pagina || 1) - (a.pagina || 1))[0];
        if (sec) { ponerCoordsTramo(sec, p); completados++; afectados.push(sec); }
        continue; // en informes por secciones no se crean puntos sueltos por cada foto
      }
      // 4) Punto nuevo. El tramo «Acta» sin coordenadas se reemplaza por el primer punto real
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
  // Si el texto del PDF ya trae coordenadas y fecha de todos los tramos, NO se leen fotos (es lo más rápido).
  // Si falta algo: primero Gemini (grupos de 6 fotos, en fila); el lector del navegador solo si Gemini no puede.
  async function leerFotosPdfInterno(pdf, d) {
    const falta = () => pdfActual === pdf && tramosPdf.some((r) => !r.agregado && (!tieneCoord(r) || !r.fecha));
    if (!falta()) return;
    let fotos = [];
    try { fotos = await LectorPDF.imagenes(pdf.doc, 60, 240); } catch (_) { return; }
    if (!fotos.length || !falta()) return;
    const aviso3 = (t) => { $("#p-fotos").hidden = !t; $("#p-fotos").textContent = t || ""; };
    const aplicado = {};            // índice de foto → { fuente, lat, lon, tramo }
    let cola = Promise.resolve(), conCoord = 0, geminiOk = false, geminiFallo = false;
    const aplicar = (i, x, fuente) => {
      cola = cola.then(async () => {
        if (pdfActual !== pdf) return;
        const f = fotos[i], prev = aplicado[i];
        const p = { lat: x.lat, lon: x.lon, fecha: x.fecha || "", pr: x.pr || "", via: x.via || "", foto: f.dataUrl, pagina: f.pagina,
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

    // 1) Gemini con recortes del sello: grupos de 6, en fila (la cola deja máx. 2 consultas a la vez)
    if (HAY_BACKEND) {
      aviso3(`· Leyendo las ${fotos.length} fotos del PDF con IA…`);
      const grupos = []; for (let i = 0; i < fotos.length; i += 6) grupos.push(i);
      let listos = 0;
      await Promise.all(grupos.map(async (ini) => {
        const recortes = await Promise.all(fotos.slice(ini, ini + 6).map((f) => recorteSello(f.dataUrl).catch(() => "")));
        const g = await postIA("leerFotos", { imagenes: recortes.filter(Boolean) }, falta);
        if (g.status === "omitido") return;
        if (g.status !== "success" || !Array.isArray(g.fotos)) { geminiFallo = true; pdf.errorIA = pdf.errorIA || g.message || "sin respuesta"; return; }
        geminiOk = true; listos += recortes.length;
        if (falta()) aviso3(`· Leyendo las fotos del PDF con IA (${Math.min(listos, fotos.length)} de ${fotos.length})…`);
        for (const x of g.fotos) {
          const i = ini + Number(x.indice);
          if (fotos[i] && x.legible && x.esFoto !== false) await aplicar(i, { lat: x.latitud, lon: x.longitud, fecha: x.fecha, pr: prDe(x.pr), via: LectorSello.corregirTramo(x.tramo || "") }, "gemini");
        }
      }));
    }

    // 2) Lector del navegador, foto por foto (rápido con el sello estándar)
    const lecturas = []; // lecturas del navegador que esperan confirmación
    // 2) Lector del navegador (respaldo): sin servidor, o si Gemini no pudo; se detiene apenas no falte nada
    const tLector = (async () => {
      if (HAY_BACKEND && geminiOk && !geminiFallo) return;
      for (let i = 0; i < fotos.length; i++) {
        if (!falta()) break;
        if (aplicado[i]) continue;
        aviso3(`· Leyendo las imágenes del PDF (${i + 1} de ${fotos.length})…`);
        let o = null;
        try { o = await LectorSello.leer(fotos[i].dataUrl, { rapido: true }); } catch (_) {}
        // Solo sellos de foto de campo: fecha + coordenadas, sin dudas de lectura
        if (!(o && o.latitud != null && o.longitud != null && o.fecha) || aplicado[i]) continue;
        const x = { i, lat: o.latitud, lon: o.longitud, fecha: o.fecha, pr: LectorPDF.prDe(o.textoLeido), via: o.tramo || "", dudosa: !!o.coordDudosa };
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

    await tLector;
    await cola;
    aviso3("");
    if (pdfActual !== pdf) return;
    const sinCoord = tramosPdf.filter((r) => !tieneCoord(r) && !r.agregado).length;
    const sinFecha = tramosPdf.filter((r) => !r.fecha && !r.agregado).length;
    void conCoord;
    msgPdf(sinCoord || sinFecha
      ? [sinCoord && `${sinCoord} tramo(s) sin coordenadas`, sinFecha && `${sinFecha} sin fecha`].filter(Boolean).join(" y ") + ": complétalos a mano y toca «Agregar a la lista»."
      : `Listo: los ${tramosPdf.length} tramos tienen fecha y coordenadas. Revisa los datos y toca «Agregar a la lista».`, !!(sinCoord || sinFecha));
  }
  pintarPdf();

  /* ======================= Tarjetas ======================= */
  const ETIQUETAS = { leyendo: "Leyendo…", listo: "Listo", revisar: "Revisar", guardando: "Guardando…", guardado: "Guardado", error: "Error al guardar", manual: "Carga manual", eliminado: "Eliminado" };

  function tarjeta(r) {
    const esFoto = r.origen === "foto", esPdf = r.origen === "pdf", conImagen = !!r.miniatura;
    const bloqueado = r.estado === "guardado" || r.estado === "guardando" || r.estado === "leyendo" || r.estado === "eliminado";
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
        ${esFoto && (r.confirmandoIA || r.leidoPor) && r.estado !== "leyendo" ? `<div class="lectura${r.confirmandoIA ? " is-ia" : ""}"${r.errorIA ? ` title="IA: ${esc(r.errorIA)}"` : ""}>${r.confirmandoIA ? '<span class="girando" aria-hidden="true"></span>Confirmando la lectura con IA…'
          : { ia: "✓ Leído con IA", "ia-preciso": "✓ Revisado con IA (lectura precisa)", lector: "Leído con el lector del navegador" + (r.errorIA ? " · IA no disponible: " + motivoIA(r.errorIA) : "") }[r.leidoPor] || ""}</div>` : ""}
        <fieldset style="border:0;padding:0;margin:0;display:grid;gap:12px;min-width:0"${bloqueado ? " disabled" : ""}>${campos(r, "c" + r.id + "-")}</fieldset>
        ${porVerificar ? `<label class="verificar"><input type="checkbox" data-act="verificar"${r.verificado ? " checked" : ""}> Verifiqué la información</label>` : ""}
        <div class="actions">
          ${esFoto && !r.enLista && ["listo", "revisar", "error"].includes(r.estado) ? '<button type="button" class="btn btn--sm btn--primary" data-act="agregar">Agregar a la lista</button>' : ""}
          ${esFoto && r.estado !== "guardado" && r.estado !== "leyendo" && r.estado !== "guardando" ? '<button type="button" class="btn btn--sm" data-act="releer">Volver a leer la foto</button>' : ""}
          ${HAY_BACKEND && r.estado === "guardado" && r.idRegistro && !String(r.idRegistro).startsWith("L-") ? '<button type="button" class="btn btn--sm btn--peligro" data-act="eliminar">Eliminar punto</button>' : ""}
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
    if (b.dataset.act === "eliminar") { pedirEliminar({ id: r.idRegistro, fid: r.idArcgis || "", municipio: r.municipio, tramo: r.nombreTramo || r.codigoVia }); return; }
    if (b.dataset.act === "releer") { r.releerPreciso = true; cola.push(r); r.estado = "leyendo"; actualizar(r); procesarCola(); }
    if (b.dataset.act === "ver") abrirVisor(r.dataUrl || r.miniatura, r.nombreArchivo + (r.punto ? " · " + r.punto + (r.pagina ? " (página " + r.pagina + ")" : "") : ""));
  });
  });

  /* ======================= 4. Puntos guardados · eliminar en ArcGIS ======================= */
  // Lista los puntos ya guardados (del Sheet) y permite eliminarlos de la capa de ArcGIS.
  // El servidor decide quién puede: administradores, cualquiera; los demás, solo los que registraron.
  let puntosG = [], adminG = false;
  const msgG = (t, e) => { const m = $("#g-msg"); m.textContent = t || ""; m.style.color = e ? "var(--err)" : ""; };
  async function cargarPuntos() {
    if (!HAY_BACKEND) { msgG("Conecta el servidor para ver los puntos guardados.", true); return; }
    const b = $("#g-cargar"); b.disabled = true; msgG("Cargando los puntos guardados…");
    const r = await Api.post("puntos", { buscar: $("#g-buscar").value.trim() });
    b.disabled = false; b.textContent = "Actualizar";
    if (r.status !== "success") { msgG(r.message || "No se pudieron cargar los puntos.", true); return; }
    puntosG = r.puntos || []; adminG = !!r.admin;
    pintarPuntos();
    msgG(puntosG.length ? `${puntosG.length} punto(s)${adminG ? " · eres administrador: ves los de todos" : " registrados por ti"}${puntosG.length >= 150 ? " · se muestran los 150 más recientes: busca para ver otros" : ""}.` : "No hay puntos guardados" + ($("#g-buscar").value.trim() ? " con esa búsqueda." : "."));
  }
  function pintarPuntos() {
    $("#g-lista").innerHTML = puntosG.map((p, i) => `<article class="punto-g">
      <div class="punto-g__datos">
        <b class="mono">${esc(p.id)}</b>${p.fecha ? ` · ${esc(p.fecha.split("-").reverse().join("/"))}` : ""}${p.municipio ? ` · ${esc(p.municipio)}` : ""}
        <span>${esc([p.tramo, p.codigo && "(" + p.codigo + ")"].filter(Boolean).join(" ") || "Sin vía")}</span>
        <small>${esc(p.tipo || "")}${p.fid ? ` · ArcGIS FID ${esc(p.fid)}` : " · no llegó a ArcGIS"}${adminG && p.por ? ` · registró ${esc(p.por)}` : ""}</small>
      </div>
      <div class="punto-g__acc">
        ${p.latitud != null && p.longitud != null ? `<a class="btn btn--sm btn--ghost" href="https://www.google.com/maps?q=${p.latitud},${p.longitud}" target="_blank" rel="noopener">Ubicación</a>` : ""}
        ${/^https:\/\/(drive|docs)\.google\.com\//.test(p.url || "") ? `<a class="btn btn--sm btn--ghost" href="${esc(p.url)}" target="_blank" rel="noopener">Archivo</a>` : ""}
        <button type="button" class="btn btn--sm btn--peligro" data-eliminar="${i}">Eliminar</button>
      </div>
    </article>`).join("");
  }
  $("#g-form").addEventListener("submit", (e) => { e.preventDefault(); cargarPuntos(); });
  $("#g-lista").addEventListener("click", (e) => {
    const b = e.target.closest("[data-eliminar]"); if (!b) return;
    const p = puntosG[Number(b.dataset.eliminar)];
    if (p) pedirEliminar({ id: p.id, fid: p.fid, municipio: p.municipio, tramo: p.tramo || p.codigo });
  });

  const dlgEl = $("#dlg-eliminar");
  let porEliminar = null;
  function pedirEliminar(d) {
    porEliminar = d;
    $("#de-texto").innerHTML = `Se borrará el punto <b>${esc(d.id || "FID " + d.fid)}</b>${d.municipio || d.tramo ? " (" + esc([d.municipio, d.tramo].filter(Boolean).join(" · ")) + ")" : ""} de la capa de ArcGIS y el registro quedará como <b>ELIMINADO</b> en el Sheet. ` +
      "Se guarda una copia completa en la hoja «Eliminados», por si hay que restaurarlo.";
    $("#de-motivo").value = ""; $("#de-msg").textContent = ""; $("#de-confirmar").disabled = false; $("#de-confirmar").textContent = "Eliminar de ArcGIS";
    if (dlgEl.showModal) dlgEl.showModal();
    setTimeout(() => { try { $("#de-motivo").focus(); } catch (_) {} }, 50);
  }
  $("#de-cancelar").addEventListener("click", () => dlgEl.close());
  $("#de-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const motivo = $("#de-motivo").value.trim();
    if (motivo.length < 3) { $("#de-msg").textContent = "Escribe el motivo de la eliminación."; $("#de-motivo").focus(); return; }
    const d = porEliminar; if (!d) return;
    const b = $("#de-confirmar"); b.disabled = true; b.textContent = "Eliminando…"; $("#de-msg").textContent = "";
    const r = await Api.post("eliminar", { id: d.id || "", fid: d.id ? "" : d.fid, motivo });
    b.disabled = false; b.textContent = "Eliminar de ArcGIS";
    if (r.status !== "success") { $("#de-msg").textContent = r.message || "No se pudo eliminar."; return; }
    dlgEl.close();
    puntosG = puntosG.filter((p) => !(d.id ? p.id === d.id : p.fid === d.fid)); pintarPuntos();
    const enSesion = items.find((x) => d.id && x.idRegistro === d.id);
    if (enSesion) { enSesion.estado = "eliminado"; enSesion.mensaje = "Eliminado de ArcGIS. Motivo: " + motivo; actualizar(enSesion); contadores(); }
    const texto = `Punto ${d.id || "FID " + d.fid} ${r.arcgis === "eliminado" ? "eliminado de ArcGIS" : "marcado como eliminado (" + r.arcgis + ")"}. La copia quedó en la hoja «Eliminados».`;
    msgG(texto); aviso(texto);
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
  // Aviso fijo si Gemini no responde: sin la IA, los sellos pequeños o borrosos no se leen bien
  async function avisarEstadoIA() {
    if (!HAY_BACKEND) return;
    const caja = $("#ia-estado");
    try {
      const r = await Api.post("estadoIA", {});
      if (r && r.status === "success" && r.ok === false) { caja.textContent = "La IA (Gemini) no está respondiendo: " + r.motivo + ". Mientras tanto las fotos se leen con el lector del navegador, que falla con sellos pequeños. Avisa al administrador."; caja.hidden = false; }
      else caja.hidden = true;
    } catch (_) { caja.hidden = true; }
  }
  function mostrarApp() {
    const d = Sesion.datos();
    $("#acceso").hidden = true; $("#app").hidden = false; $("#barra").hidden = false;
    $("#usuario").hidden = false; $("#usuario-nombre").textContent = d ? d.nombre : "";
    if (!appIniciada) {
      appIniciada = true;
      pintarManual();
      cargarListasVias();
      avisarEstadoIA();
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

