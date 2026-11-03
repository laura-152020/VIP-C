/* VIP-C · Capas de referencia de ArcGIS Online (solo lectura)
 *  - Red vial (Circular 10): código y nombre de la vía, por cercanía al punto y por relación código ↔ nombre.
 *  - División política de Antioquia: municipio, subregión y vereda donde cae el punto.
 * Las capas son públicas: se consultan directo desde el navegador. Si no responden, la página sigue
 * funcionando con los límites del DANE que ya trae. */
const Capas = (function () {
  "use strict";
  const BASE = "https://services5.arcgis.com/K90UQIB09TmTjUL8/arcgis/rest/services/";
  const RED_VIAL = ["R10/FeatureServer/1", "R10/FeatureServer/2", "R10/FeatureServer/3"]; // primaria, secundaria, terciaria
  const ORDEN = ["Primaria", "Secundaria", "Terciaria"];
  const DIVISION = "División_política_de_Antioquia/FeatureServer/";
  const CAPA_VEREDAS = DIVISION + "2", CAPA_MUNICIPIOS = DIVISION + "3", CAPA_SUBREGIONES = DIVISION + "4";
  const RADIO_VIA_M = 200; // la vía más cercana debe estar a menos de esta distancia del punto

  const sinTilde = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const url = (capa) => BASE + encodeURI(capa);

  // Las consultas van directo del navegador a ArcGIS. Si el navegador no puede (bloqueo de la red,
  // de la organización o del dominio), se hacen a través del Apps Script, que no tiene esa restricción.
  let proxy = null, modo = "directo", ultimoError = "";
  function usarServidor(fn) { proxy = fn; }
  async function pedir(capa, ruta, params) {
    const p = Object.assign({ f: "json" }, params || {});
    if (modo === "directo") {
      try {
        const r = await fetch(url(capa) + (ruta || "") + "?" + new URLSearchParams(p).toString());
        const d = await r.json();
        if (!d.error) return d;
        throw new Error("ArcGIS " + (d.error.code || "") + ": " + (d.error.message || "error"));
      } catch (e) {
        ultimoError = "directo: " + (e.message || e);
        if (!proxy) throw e;
        console.warn("[VIP-C capas] consulta directa falló, uso el servidor:", ultimoError);
      }
    }
    const res = await proxy(capa, ruta || "", p);
    if (!res || res.status !== "success") { ultimoError = "servidor: " + ((res && res.message) || "sin respuesta"); throw new Error(ultimoError); }
    const d = res.datos || {};
    if (d.error) { ultimoError = "servidor: ArcGIS " + (d.error.code || "") + ": " + (d.error.message || ""); throw new Error(ultimoError); }
    if (modo === "directo") { modo = "servidor"; console.info("[VIP-C capas] desde ahora consulto ArcGIS a través del servidor"); }
    return d;
  }

  /* ---------- Campos de cada capa (se detectan por nombre o alias) ---------- */
  const esquemas = {};
  function esquema(capa) {
    if (!esquemas[capa]) esquemas[capa] = pedir(capa, "").then((d) => d.fields || []).catch((e) => { delete esquemas[capa]; throw e; });
    return esquemas[capa];
  }
  function buscarCampo(campos, patrones, excluir) {
    const texto = campos.filter((c) => c.type === "esriFieldTypeString" && !(excluir && excluir.test(c.name)));
    for (const p of patrones) {
      const c = texto.find((x) => p.test(x.name) || p.test(sinTilde(x.alias || "")));
      if (c) return c.name;
    }
    return "";
  }
  const PAT_CODIGO = [/^cod(igo)?_?via$/i, /^cod_?v$/i, /c[oó]d(igo)?[ _]?(de[ _])?(la[ _])?v[ií]a/i, /^codigo$/i, /^cod$/i, /cod(igo)?_?tramo/i, /^id_?via$/i, /cod/i];
  const PAT_NOMBRE = [/^nom(bre)?_?via$/i, /nombre[ _]?(de[ _])?(la[ _])?v[ií]a/i, /^nom_?tramo$/i, /^nombre$/i, /tramo/i, /^via$/i, /nom/i];
  const PAT_MUNICIPIO = [/^(nom_?)?municipio$/i, /^mpio_?cnmbr$/i, /^nom(bre)?_?mpio$/i, /municipio/i, /mpio/i, /^nombre$/i, /nom/i];
  const PAT_SUBREGION = [/^(nom_?)?subregi[oó]n$/i, /subreg/i, /^nombre$/i, /nom/i];
  const PAT_VEREDA = [/^(nom_?)?vereda$/i, /^nombre_?ver/i, /vereda/i, /^nombre$/i, /nom/i];

  // Columnas de código y nombre de la vía. Primero por el nombre de la columna; después se confirma
  // mirando los valores (un código se ve como 60AN17 o 05656VT131; un nombre es texto largo).
  const pareceCodigo = (v) => /^[0-9]{1,5}[A-Z]{1,4}[0-9]{1,5}[A-Z0-9-]*$/.test(normCodigo(v));
  const pareceNombre = (v) => { const t = String(v || "").trim(); return t.length >= 6 && /[a-záéíóúñ]{3}/i.test(t) && !pareceCodigo(t); };
  const camposPorCapa = {};
  function camposVia(capa) {
    if (camposPorCapa[capa]) return camposPorCapa[capa];
    camposPorCapa[capa] = (async () => {
      const f = await esquema(capa);
      const texto = f.filter((c) => c.type === "esriFieldTypeString");
      let muestra = [];
      try {
        let d;
        try { d = await pedir(capa, "/query", { where: "1=1", outFields: "*", returnGeometry: "false", resultRecordCount: "60" }); }
        catch (_) { d = await pedir(capa, "/query", { where: "1=1", outFields: "*", returnGeometry: "false" }); }
        muestra = (d.features || []).slice(0, 60).map((x) => x.attributes);
      } catch (_) {}
      const puntaje = (campo, prueba) => {
        const vals = muestra.map((a) => a[campo]).filter((v) => v != null && String(v).trim() !== "");
        return vals.length ? vals.filter(prueba).length / vals.length : 0;
      };
      let codigo = buscarCampo(f, PAT_CODIGO);
      if (muestra.length && (!codigo || puntaje(codigo, pareceCodigo) < 0.5)) {
        const mejor = texto.map((c) => [c.name, puntaje(c.name, pareceCodigo)]).sort((x, y) => y[1] - x[1])[0];
        if (mejor && mejor[1] >= 0.5) codigo = mejor[0];
      }
      let nombre = buscarCampo(f, PAT_NOMBRE, codigo ? new RegExp("^" + codigo + "$") : null);
      if (muestra.length && (!nombre || puntaje(nombre, pareceNombre) < 0.5)) {
        const mejor = texto.filter((c) => c.name !== codigo)
          .map((c) => [c.name, puntaje(c.name, (v) => pareceNombre(v) && / - |-|–/.test(String(v))) * 2 + puntaje(c.name, pareceNombre)])
          .sort((x, y) => y[1] - x[1])[0];
        if (mejor && mejor[1] >= 0.5) nombre = mejor[0];
      }
      const r = { codigo, nombre, ejemplo: muestra[0] ? { codigo: muestra[0][codigo], nombre: muestra[0][nombre] } : null };
      console.info("[VIP-C capas]", capa, r);
      return r;
    })();
    camposPorCapa[capa].catch(() => { delete camposPorCapa[capa]; });
    return camposPorCapa[capa];
  }
  const normCodigo = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const normNombre = (v) => sinTilde(v).replace(/[^a-z0-9]+/g, " ").trim();

  /* ---------- Distancia de un punto a una línea (metros, aproximación local) ---------- */
  function distanciaALinea(lat, lon, paths) {
    const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110574;
    let min = Infinity;
    (paths || []).forEach((path) => {
      for (let i = 1; i < path.length; i++) {
        const ax = (path[i - 1][0] - lon) * kx, ay = (path[i - 1][1] - lat) * ky;
        const bx = (path[i][0] - lon) * kx, by = (path[i][1] - lat) * ky;
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
        const px = ax + t * dx, py = ay + t * dy;
        min = Math.min(min, Math.hypot(px, py));
      }
      if (path.length === 1) min = Math.min(min, Math.hypot((path[0][0] - lon) * kx, (path[0][1] - lat) * ky));
    });
    return min;
  }

  const punto = (lat, lon) => ({
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects"
  });

  /* ---------- Vías cercanas al punto (la primera es la más cercana) ---------- */
  async function viasCercanas(lat, lon, radio, max) {
    radio = radio || RADIO_VIA_M;
    const res = await Promise.all(RED_VIAL.map(async (capa, k) => {
      try {
        const c = await camposVia(capa);
        if (!c.codigo && !c.nombre) return [];
        const d = await pedir(capa, "/query", Object.assign(punto(lat, lon), {
          distance: radio, units: "esriSRUnit_Meter", outFields: [c.codigo, c.nombre].filter(Boolean).join(","),
          returnGeometry: "true", outSR: "4326"
        }));
        return (d.features || []).map((ft) => ({
          codigo: String(ft.attributes[c.codigo] ?? "").trim(), nombre: String(ft.attributes[c.nombre] ?? "").trim(),
          orden: ORDEN[k], distancia: distanciaALinea(lat, lon, ft.geometry && ft.geometry.paths)
        }));
      } catch (e) { console.warn("[VIP-C capas] red vial", capa, e.message); return []; }
    }));
    const todas = res.flat().filter((v) => (v.codigo || v.nombre) && isFinite(v.distancia) && v.distancia <= radio);
    todas.sort((a, b) => a.distancia - b.distancia);
    const vistas = new Set(), unicas = [];
    todas.forEach((v) => { const k = normCodigo(v.codigo) + "|" + normNombre(v.nombre); if (!vistas.has(k)) { vistas.add(k); unicas.push(v); } });
    return unicas.slice(0, max || 8);
  }
  async function viaCercana(lat, lon) { return (await viasCercanas(lat, lon, RADIO_VIA_M, 1))[0] || null; }

  /* ---------- Municipio, subregión y vereda donde cae el punto ---------- */
  // Se piden todas las columnas del polígono donde cae el punto y se escoge el valor que corresponde,
  // mirando el contenido (un municipio de Antioquia, una subregión) y no solo el nombre de la columna.
  const NOMS_MUN = new Set((typeof MUNICIPIOS !== "undefined" ? MUNICIPIOS : []).map((m) => normNombre(m.n)));
  ["santafe de antioquia", "carolina", "penol", "retiro", "san vicente", "santuario", "don matias", "entrerrios", "san pedro", "yondo"]
    .forEach((x) => NOMS_MUN.add(x));
  const NOMS_SUB = new Set((typeof SUBREGIONES !== "undefined" ? SUBREGIONES : []).map(normNombre));
  const esMunicipio = (v) => { const k = normNombre(v); return NOMS_MUN.has(k) || NOMS_MUN.has(k.replace(/^(el|la|los|las) /, "")); };
  const esSubregion = (v) => NOMS_SUB.has(normNombre(v));
  async function atributosEn(capa, lat, lon) {
    try {
      const d = await pedir(capa, "/query", Object.assign(punto(lat, lon), { outFields: "*", returnGeometry: "false" }));
      const ft = (d.features || [])[0];
      return ft ? ft.attributes : null;
    } catch (e) { console.warn("[VIP-C capas]", capa, e.message); return null; }
  }
  const textos = (at) => Object.entries(at || {}).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => [k, v.trim()]);
  function elegir(at, patrones, valido) {
    const t = textos(at);
    for (const p of patrones) { const x = t.find(([k, v]) => p.test(k) && valido(v)); if (x) return x[1]; }
    const x = t.find(([, v]) => valido(v));
    return x ? x[1] : "";
  }
  async function division(lat, lon) {
    const [aMun, aSub, aVer] = await Promise.all([atributosEn(CAPA_MUNICIPIOS, lat, lon), atributosEn(CAPA_SUBREGIONES, lat, lon), atributosEn(CAPA_VEREDAS, lat, lon)]);
    const municipio = elegir(aMun, PAT_MUNICIPIO, esMunicipio) || elegir(aVer, PAT_MUNICIPIO, esMunicipio);
    const subregion = elegir(aSub, PAT_SUBREGION, esSubregion) || elegir(aMun, PAT_SUBREGION, esSubregion);
    const NO_VEREDA = /mpio|municip|subreg|dpto|depto|departa|cod|^id|fecha|fuente|area|shape|globalid/i;
    const vereda = elegir(Object.fromEntries(textos(aVer).filter(([k]) => !NO_VEREDA.test(k) || /ver/i.test(k) && !/cod|^id/i.test(k))),
      [/^(nom_?)?vereda$/i, /^nombre_?ver/i, /ver/i, /^nombre$/i, /nom/i],
      (v) => pareceNombre(v) && !esMunicipio(v) && !esSubregion(v) && !/^\d+$/.test(v));
    return { municipio, subregion, vereda, columnas: { municipios: aMun ? Object.keys(aMun) : null, subregiones: aSub ? Object.keys(aSub) : null, veredas: aVer } };
  }

  // Todo lo que se puede saber de un punto (cada parte falla por separado sin afectar a las demás)
  async function enPunto(lat, lon) {
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return null;
    const [via, div] = await Promise.all([viaCercana(lat, lon).catch(() => null), division(lat, lon).catch(() => ({}))]);
    return Object.assign({ via }, div);
  }

  /* ---------- Catálogo código ↔ nombre de toda la red vial ---------- */
  let catalogo = null;
  const CLAVE_CACHE = "vipc-redvial-v1", DIAS_CACHE = 7;
  function desdeCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CLAVE_CACHE) || "null");
      if (!c || !Array.isArray(c.v) || Date.now() - c.t > DIAS_CACHE * 864e5 || c.v.length < 10) return null;
      const porCodigo = new Map(), porNombre = new Map();
      c.v.forEach(([cod, nom, o]) => {
        const v = { codigo: cod, nombre: nom, orden: ORDEN[o] || "" };
        const kc = normCodigo(cod); if (!porCodigo.has(kc)) porCodigo.set(kc, v);
        const kn = normNombre(nom); if (!porNombre.has(kn)) porNombre.set(kn, v);
      });
      return { porCodigo, porNombre };
    } catch (_) { return null; }
  }
  function aCache(c) {
    try {
      const vistos = new Set(), v = [];
      [...c.porCodigo.values(), ...c.porNombre.values()].forEach((x) => { const k = x.codigo + "|" + x.nombre; if (!vistos.has(k)) { vistos.add(k); v.push([x.codigo, x.nombre, ORDEN.indexOf(x.orden)]); } });
      if (v.length >= 10) localStorage.setItem(CLAVE_CACHE, JSON.stringify({ t: Date.now(), v }));
    } catch (_) { /* sin espacio o sin almacenamiento: se vuelve a consultar la próxima vez */ }
  }
  function cargarCatalogo() {
    if (catalogo) return catalogo;
    const guardado = desdeCache();
    if (guardado) { catalogo = Promise.resolve(guardado); return catalogo; } // abre al instante: la red vial casi no cambia
    catalogo = (async () => {
      const porCodigo = new Map(), porNombre = new Map();
      let fallos = 0;
      // Las 3 capas (primaria, secundaria, terciaria) se consultan al mismo tiempo
      await Promise.all([...RED_VIAL.entries()].map(async ([k, capa]) => {
        try {
          const c = await camposVia(capa);
          if (!c.codigo || !c.nombre) return;
          for (let offset = 0, vuelta = 0; vuelta < 30; vuelta++) {
            const base = { where: "1=1", outFields: c.codigo + "," + c.nombre, returnGeometry: "false", resultOffset: String(offset), resultRecordCount: "2000" };
            let d;
            try { d = await pedir(capa, "/query", Object.assign({ returnDistinctValues: "true", orderByFields: c.codigo }, base)); }
            catch (_) {
              try { d = await pedir(capa, "/query", base); } // sin valores distintos
              catch (_2) { d = await pedir(capa, "/query", { where: "1=1", outFields: base.outFields, returnGeometry: "false" }); d.sinPaginar = true; } // sin paginación
            }
            const fs = d.features || [];
            fs.forEach((ft) => {
              const cod = String(ft.attributes[c.codigo] ?? "").trim().toUpperCase(), nom = String(ft.attributes[c.nombre] ?? "").trim();
              if (!cod || !nom) return;
              const kc = normCodigo(cod);
              if (!porCodigo.has(kc)) porCodigo.set(kc, { codigo: cod, nombre: nom, orden: ORDEN[k] });
              const kn = normNombre(nom);
              if (!porNombre.has(kn)) porNombre.set(kn, { codigo: cod, nombre: nom, orden: ORDEN[k] });
            });
            if (d.sinPaginar || !d.exceededTransferLimit || !fs.length) break;
            offset += fs.length;
          }
        } catch (e) { fallos++; console.warn("[VIP-C capas] catálogo", capa, e.message); }
      }));
      const c = { porCodigo, porNombre };
      if (!fallos) aCache(c); // solo se guarda la red vial completa
      return c;
    })();
    catalogo.catch(() => { catalogo = null; });
    return catalogo;
  }
  // Búsqueda tolerante: sin espacios ni guiones, y si no está exacto, por terminación (ej. 05656VT131 ↔ VT131)
  async function porCodigo(codigo) {
    const c = await cargarCatalogo();
    const k = normCodigo(codigo);
    if (k.length < 3) return null;
    if (c.porCodigo.has(k)) return c.porCodigo.get(k);
    const cand = [...c.porCodigo.entries()].filter(([x]) => Math.min(x.length, k.length) >= 5 && (x.endsWith(k) || k.endsWith(x)));
    cand.sort((a, b) => Math.abs(a[0].length - k.length) - Math.abs(b[0].length - k.length));
    return cand.length ? cand[0][1] : null;
  }
  async function porNombre(nombre) {
    const c = await cargarCatalogo();
    const k = normNombre(nombre);
    if (k.length < 4) return null;
    if (c.porNombre.has(k)) return c.porNombre.get(k);
    const cand = [...c.porNombre.entries()].filter(([x]) => Math.min(x.length, k.length) >= 6 && (x.includes(k) || k.includes(x)));
    cand.sort((a, b) => Math.abs(a[0].length - k.length) - Math.abs(b[0].length - k.length));
    return cand.length ? cand[0][1] : null;
  }
  // Nombre de la red vial más parecido a un texto leído con errores (ej. «Porcesito - La Evrtada - Yolombó»)
  async function nombreParecido(texto, minimo) {
    if (!texto || typeof LectorSello === "undefined") return null;
    const c = await cargarCatalogo();
    let mejor = null, p = 0;
    c.porNombre.forEach((v) => { const x = LectorSello.parecido(texto, v.nombre); if (x > p) { p = x; mejor = v; } });
    return p >= (minimo || 0.7) ? Object.assign({ parecido: p }, mejor) : null;
  }
  // Todas las vías (código + nombre), sin repetir, para la lista desplegable de tramos
  let todas = null;
  async function todasLasVias() {
    if (todas) return todas;
    const c = await cargarCatalogo(), vistas = new Set(), out = [];
    [...c.porCodigo.values(), ...c.porNombre.values()].forEach((v) => {
      const k = normCodigo(v.codigo) + "|" + normNombre(v.nombre);
      if (vistas.has(k)) return; vistas.add(k);
      out.push(Object.assign({ buscar: normNombre(v.nombre) + " " + normCodigo(v.codigo).toLowerCase() }, v));
    });
    out.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    todas = out;
    return out;
  }
  // Busca por palabras sueltas, sin importar tildes ni el orden (ej. «urrao caic» → Caicedo - Urrao)
  async function buscarVias(texto, max) {
    const lista = await todasLasVias();
    const q = normNombre(texto), qc = normCodigo(texto).toLowerCase();
    if (!q) return lista.slice(0, max || 60);
    const palabras = q.split(" ").filter(Boolean);
    const r = lista.filter((v) => palabras.every((w) => v.buscar.includes(w)) || (qc.length >= 3 && v.buscar.includes(qc)));
    const peso = (v) => (normCodigo(v.codigo).toLowerCase() === qc ? 0 : normNombre(v.nombre).startsWith(q) ? 1 : 2);
    r.sort((a, b) => peso(a) - peso(b));
    return r.slice(0, max || 60);
  }
  async function listas() {
    const c = await cargarCatalogo();
    return { codigos: [...c.porCodigo.values()], nombres: [...c.porNombre.values()] };
  }

  // Para revisar desde la consola del navegador qué campos se detectaron: Capas.diagnostico()
  async function diagnostico() {
    const out = {};
    for (const capa of RED_VIAL) out[capa] = await camposVia(capa).catch((e) => e.message);
    out.division = await division(6.369444, -75.707778).catch((e) => e.message);
    const cat = await cargarCatalogo().catch(() => null);
    out.catalogo = cat ? cat.porCodigo.size + " códigos de vía cargados" : "no se pudo cargar";
    out.modo = modo; out.ultimoError = ultimoError || "ninguno";
    out.prueba = await enPunto(6.369444, -75.707778).catch((e) => e.message);
    console.log(JSON.stringify(out, null, 2));
    return out;
  }

  return { nombreParecido, usarServidor, enPunto, viaCercana, viasCercanas, buscarVias, todasLasVias, division, porCodigo, porNombre, listas, cargarCatalogo, diagnostico, distanciaALinea };
})();
if (typeof module !== "undefined") module.exports = Capas;
