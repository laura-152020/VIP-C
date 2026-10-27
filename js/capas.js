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

  async function pedir(capa, ruta, params) {
    const q = new URLSearchParams(Object.assign({ f: "json" }, params || {}));
    const r = await fetch(url(capa) + (ruta || "") + "?" + q.toString());
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || "Error de ArcGIS");
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

  async function camposVia(capa) {
    const f = await esquema(capa);
    const codigo = buscarCampo(f, PAT_CODIGO);
    const nombre = buscarCampo(f, PAT_NOMBRE, codigo ? new RegExp("^" + codigo + "$") : null);
    return { codigo, nombre };
  }

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

  /* ---------- Vía más cercana al punto ---------- */
  async function viaCercana(lat, lon) {
    const res = await Promise.all(RED_VIAL.map(async (capa, k) => {
      try {
        const c = await camposVia(capa);
        if (!c.codigo && !c.nombre) return [];
        const d = await pedir(capa, "/query", Object.assign(punto(lat, lon), {
          distance: RADIO_VIA_M, units: "esriSRUnit_Meter", outFields: [c.codigo, c.nombre].filter(Boolean).join(","),
          returnGeometry: "true", outSR: "4326", resultRecordCount: "50"
        }));
        return (d.features || []).map((ft) => ({
          codigo: String(ft.attributes[c.codigo] ?? "").trim(), nombre: String(ft.attributes[c.nombre] ?? "").trim(),
          orden: ORDEN[k], distancia: distanciaALinea(lat, lon, ft.geometry && ft.geometry.paths)
        }));
      } catch (_) { return []; }
    }));
    const todas = res.flat().filter((v) => (v.codigo || v.nombre) && isFinite(v.distancia) && v.distancia <= RADIO_VIA_M);
    todas.sort((a, b) => a.distancia - b.distancia);
    return todas[0] || null;
  }

  /* ---------- Municipio, subregión y vereda donde cae el punto ---------- */
  async function valorEn(capa, patrones, lat, lon) {
    try {
      const f = await esquema(capa);
      const campo = buscarCampo(f, patrones);
      if (!campo) return "";
      const d = await pedir(capa, "/query", Object.assign(punto(lat, lon), { outFields: campo, returnGeometry: "false", resultRecordCount: "1" }));
      const ft = (d.features || [])[0];
      return ft ? String(ft.attributes[campo] ?? "").trim() : "";
    } catch (_) { return ""; }
  }
  async function division(lat, lon) {
    const [municipio, subregion, vereda] = await Promise.all([
      valorEn(CAPA_MUNICIPIOS, PAT_MUNICIPIO, lat, lon),
      valorEn(CAPA_SUBREGIONES, PAT_SUBREGION, lat, lon),
      valorEn(CAPA_VEREDAS, PAT_VEREDA, lat, lon)
    ]);
    return { municipio, subregion, vereda };
  }

  // Todo lo que se puede saber de un punto (cada parte falla por separado sin afectar a las demás)
  async function enPunto(lat, lon) {
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return null;
    const [via, div] = await Promise.all([viaCercana(lat, lon).catch(() => null), division(lat, lon).catch(() => ({}))]);
    return Object.assign({ via }, div);
  }

  /* ---------- Catálogo código ↔ nombre de toda la red vial ---------- */
  let catalogo = null;
  function cargarCatalogo() {
    if (catalogo) return catalogo;
    catalogo = (async () => {
      const porCodigo = new Map(), porNombre = new Map();
      for (const [k, capa] of RED_VIAL.entries()) {
        try {
          const c = await camposVia(capa);
          if (!c.codigo || !c.nombre) continue;
          for (let offset = 0, vuelta = 0; vuelta < 30; vuelta++) {
            const base = { where: "1=1", outFields: c.codigo + "," + c.nombre, returnGeometry: "false", resultOffset: String(offset), resultRecordCount: "2000" };
            let d;
            try { d = await pedir(capa, "/query", Object.assign({ returnDistinctValues: "true", orderByFields: c.codigo }, base)); }
            catch (_) { d = await pedir(capa, "/query", base); } // capas que no permiten valores distintos con paginación
            const fs = d.features || [];
            fs.forEach((ft) => {
              const cod = String(ft.attributes[c.codigo] ?? "").trim().toUpperCase(), nom = String(ft.attributes[c.nombre] ?? "").trim();
              if (!cod || !nom) return;
              if (!porCodigo.has(cod)) porCodigo.set(cod, { codigo: cod, nombre: nom, orden: ORDEN[k] });
              const kn = sinTilde(nom).replace(/\s+/g, " ");
              if (!porNombre.has(kn)) porNombre.set(kn, { codigo: cod, nombre: nom, orden: ORDEN[k] });
            });
            if (!d.exceededTransferLimit || !fs.length) break;
            offset += fs.length;
          }
        } catch (_) { /* esa capa no respondió */ }
      }
      return { porCodigo, porNombre };
    })();
    catalogo.catch(() => { catalogo = null; });
    return catalogo;
  }
  async function porCodigo(codigo) {
    const c = await cargarCatalogo();
    return c.porCodigo.get(String(codigo || "").trim().toUpperCase().replace(/\s+/g, "")) || null;
  }
  async function porNombre(nombre) {
    const c = await cargarCatalogo();
    return c.porNombre.get(sinTilde(nombre).replace(/\s+/g, " ").trim()) || null;
  }
  async function listas() {
    const c = await cargarCatalogo();
    return { codigos: [...c.porCodigo.values()], nombres: [...c.porNombre.values()] };
  }

  // Para revisar desde la consola del navegador qué campos se detectaron: Capas.diagnostico()
  async function diagnostico() {
    const out = {};
    for (const capa of RED_VIAL) out[capa] = await camposVia(capa).catch((e) => e.message);
    for (const [capa, p] of [[CAPA_MUNICIPIOS, PAT_MUNICIPIO], [CAPA_SUBREGIONES, PAT_SUBREGION], [CAPA_VEREDAS, PAT_VEREDA]]) {
      out[capa] = await esquema(capa).then((f) => buscarCampo(f, p)).catch((e) => e.message);
    }
    console.table(out);
    return out;
  }

  return { enPunto, viaCercana, division, porCodigo, porNombre, listas, cargarCatalogo, diagnostico, distanciaALinea };
})();
if (typeof module !== "undefined") module.exports = Capas;
