/* VIP-C · Lectura de actas de visita técnica en PDF (en el navegador, sin servidor)
 * Extrae el texto con pdf.js y busca: fecha de la visita, código de la vía, nombre de la vía,
 * municipio y cada punto con coordenadas (un registro por punto), con su tipo de afectación y descripción. */
const LectorPDF = (function () {
  "use strict";
  const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/";
  const PDFJS_SRI = "sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e"; // huella del archivo: si alguien lo altera, no se ejecuta
  let carga = null;

  function cargarLib() {
    if (typeof window !== "undefined" && window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (carga) return carga;
    carga = new Promise((ok, mal) => {
      const s = document.createElement("script");
      s.src = PDFJS + "pdf.min.js"; s.integrity = PDFJS_SRI; s.crossOrigin = "anonymous";
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; ok(window.pdfjsLib); };
      s.onerror = () => { carga = null; mal(new Error("No se pudo cargar el lector de PDF. Revisa la conexión a internet.")); };
      document.head.appendChild(s);
    });
    return carga;
  }

  // Abre el PDF y devuelve el texto de cada página
  async function abrir(bytes) {
    const lib = await cargarLib();
    const doc = await lib.getDocument({ data: bytes }).promise;
    const paginas = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      let t = "";
      for (const it of tc.items) { t += it.str; if (it.hasEOL) t += "\n"; }
      paginas.push(t);
    }
    return { doc, paginas };
  }

  // Dibuja una página como imagen JPEG (para la miniatura y la vista ampliada)
  async function dibujarPagina(doc, n, ancho) {
    const pag = await doc.getPage(n);
    const v0 = pag.getViewport({ scale: 1 });
    const vp = pag.getViewport({ scale: ancho / v0.width });
    const cv = document.createElement("canvas");
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const cx = cv.getContext("2d");
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
    await pag.render({ canvasContext: cx, viewport: vp }).promise;
    return cv.toDataURL("image/jpeg", 0.8);
  }

  /* ---------------- Interpretación del texto ---------------- */
  const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
  const iso = (a, m, d) => (a > 1990 && a < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) ? `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : "";

  // Palabras clave → tipo de afectación (deben coincidir con la lista de app.js)
  const CLAVES = [
    ["Pérdida de banca", /p[eé]rdidas?\s+(?:parcial(?:es)?\s+|total(?:es)?\s+)?(?:de\s+)?(?:la\s+)?banca|banca\s+perdida/],
    ["Deslizamiento / movimiento en masa", /deslizamiento|movimiento\s+en\s+masa|remoci[oó]n\s+en\s+masa/],
    ["Hundimiento de la vía", /hundimiento|asentamiento\s+de\s+la\s+(?:v[ií]a|banca|calzada)/],
    ["Caída de rocas", /ca[ií]da\s+de\s+rocas|desprendimiento\s+de\s+rocas/],
    ["Daño en puente o pontón", /puente|pont[oó]n/],
    ["Daño en muro de contención", /muro\s+de\s+contenci[oó]n\s+(?:colapsad|fallad|da[nñ]ad)|falla\s+del?\s+muro/],
    ["Socavación", /socavaci[oó]n/],
    ["Obstrucción de drenaje o alcantarilla", /obstrucci[oó]n|alcantarilla|obras?\s+de\s+drenaje|sumidero/],
    ["Deterioro de la calzada (baches)", /baches?|deterioro\s+de\s+la\s+calzada|piel\s+de\s+cocodrilo/],
    ["Inundación", /inundaci[oó]n/],
    ["Árbol caído", /[aá]rbol(?:es)?\s+ca[ií]do/]
  ];
  function tipoDe(texto) {
    // «Puente Linda», «Puente Iglesias»…: nombres de lugares, no un daño en un puente
    const t = String(texto || "").replace(/\bPuente\s+(?=[A-ZÁÉÍÓÚÑ][a-záéíóúñ])/g, "").toLowerCase();
    let mejor = "", pos = Infinity, cuenta = 0;
    CLAVES.forEach(([tipo, re]) => {
      const g = new RegExp(re.source, "g"); let m, n = 0, p = Infinity;
      while ((m = g.exec(t))) { n++; if (m.index < p) p = m.index; }
      if (n > cuenta || (n === cuenta && n > 0 && p < pos)) { mejor = tipo; cuenta = n; pos = p; }
    });
    return mejor;
  }

  // Normaliza símbolos de grados, minutos y segundos
  function normalizar(t) {
    return String(t || "")
      .replace(/[º˚]/g, "°").replace(/[′’‘´`]/g, "'").replace(/[″”“]/g, '"').replace(/''/g, '"')
      .replace(/\r/g, "");
  }

  // Busca todas las coordenadas del texto (grados-minutos-segundos o decimales)
  function buscarCoordenadas(t) {
    const S = "\\s*";
    const num = "(\\d{1,3}(?:[.,]\\d+)?)";
    const dms = (h) => `${h ? "([NSWO])" + S : ""}(\\d{1,3})${S}°${S}(?:(\\d{1,2}(?:[.,]\\d+)?)${S}'${S})?(?:(\\d{1,2}(?:[.,]\\d+)?)${S}"?)?${h ? "" : S + "([NSWO])"}`;
    const res = [];
    const sep = "[\\s,;y–\\-]{0,12}";
    const aDec = (g, m, s, h) => {
      let v = Number(g) + Number(String(m || 0).replace(",", ".")) / 60 + Number(String(s || 0).replace(",", ".")) / 3600;
      if (/[SWO]/i.test(h)) v = -v;
      return Math.round(v * 1e6) / 1e6;
    };
    // N 6° 22' 10", W 75° 42' 28"
    let re = new RegExp(dms(true) + sep + dms(true), "gi"), m;
    while ((m = re.exec(t))) {
      const a = [m[1], m[2], m[3], m[4]], b = [m[5], m[6], m[7], m[8]];
      const lat = /[NS]/i.test(a[0]) ? a : b, lon = lat === a ? b : a;
      if (!/[NS]/i.test(lat[0]) || !/[WO]/i.test(lon[0])) continue;
      res.push({ i: m.index, f: m.index + m[0].length, lat: aDec(lat[1], lat[2], lat[3], lat[0]), lon: aDec(lon[1], lon[2], lon[3], lon[0]) });
    }
    // 6° 22' 10" N, 75° 42' 28" W
    re = new RegExp(dms(false) + sep + dms(false), "gi");
    while ((m = re.exec(t))) {
      if (res.some((r) => m.index < r.f && m.index + m[0].length > r.i)) continue;
      const a = [m[4], m[1], m[2], m[3]], b = [m[8], m[5], m[6], m[7]];
      const lat = /[NS]/i.test(a[0]) ? a : b, lon = lat === a ? b : a;
      if (!/[NS]/i.test(lat[0]) || !/[WO]/i.test(lon[0])) continue;
      res.push({ i: m.index, f: m.index + m[0].length, lat: aDec(lat[1], lat[2], lat[3], lat[0]), lon: aDec(lon[1], lon[2], lon[3], lon[0]) });
    }
    // Decimales con hemisferio: «6.4010N 76.0473W» · «N 6.4010 W 76.0473» · «6.4339N 75.8910» (sin W: en Antioquia siempre es oeste)
    re = new RegExp(`(?<![\\d.])([4-9][.,]\\d{3,})${S}°?${S}([NS])${S}[,;]?${S}(7[2-8][.,]\\d{3,})${S}°?${S}([WO])?(?![A-Za-z])`, "gi");
    while ((m = re.exec(t))) {
      if (res.some((r) => m.index < r.f && m.index + m[0].length > r.i)) continue;
      const la = Number(m[1].replace(",", ".")) * (/S/i.test(m[2]) ? -1 : 1);
      res.push({ i: m.index, f: m.index + m[0].length, lat: Math.round(la * 1e6) / 1e6, lon: -Math.round(Number(m[3].replace(",", ".")) * 1e6) / 1e6 });
    }
    re = new RegExp(`(?<![A-Za-z])([NS])${S}([4-9][.,]\\d{3,})${S}°?${S}[,;]?${S}([WO])${S}(7[2-8][.,]\\d{3,})`, "gi");
    while ((m = re.exec(t))) {
      if (res.some((r) => m.index < r.f && m.index + m[0].length > r.i)) continue;
      const la = Number(m[2].replace(",", ".")) * (/S/i.test(m[1]) ? -1 : 1);
      res.push({ i: m.index, f: m.index + m[0].length, lat: Math.round(la * 1e6) / 1e6, lon: -Math.round(Number(m[4].replace(",", ".")) * 1e6) / 1e6 });
    }
    // Decimales: 6.369444, -75.707778
    re = new RegExp(`(?<![\\d.])([5-9][.,]\\d{3,})${S}[,;]?${S}(-${S}7[3-7][.,]\\d{3,})`, "g");
    while ((m = re.exec(t))) {
      if (res.some((r) => m.index < r.f && m.index + m[0].length > r.i)) continue;
      res.push({ i: m.index, f: m.index + m[0].length, lat: Number(m[1].replace(",", ".")), lon: Number(m[2].replace(/\s/g, "").replace(",", ".")) });
    }
    void num;
    // Solo Antioquia y alrededores
    return res.filter((r) => r.lat > 4.5 && r.lat < 9.5 && r.lon < -72.5 && r.lon > -78).sort((x, y) => x.i - y.i);
  }

  function buscarFecha(plano) {
    const re = /(\d{1,2})\s*(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s*(?:de[l]?\s+)?(\d{4})/gi;
    let m, primera = "";
    while ((m = re.exec(plano))) {
      const f = iso(Number(m[3]), MESES[m[2].toLowerCase()], Number(m[1]));
      if (!f) continue;
      const antes = plano.slice(Math.max(0, m.index - 80), m.index).toLowerCase();
      if (/aprobaci/.test(antes)) continue;
      if (/visita|d[ií]a|realiz|inspecci/.test(antes)) return { fecha: f, texto: m[0] };
      if (!primera) primera = { fecha: f, texto: m[0] };
    }
    if (primera) return primera;
    const rn = /(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/g;
    while ((m = rn.exec(plano))) {
      const antes = plano.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
      if (/aprobaci/.test(antes)) continue;
      const f = iso(Number(m[3]), Number(m[2]), Number(m[1]));
      if (f) return { fecha: f, texto: m[0] };
    }
    return { fecha: "", texto: "" };
  }

  function buscarCodigo(plano) {
    const cod = "(\\d{2,5}[A-Z]{1,3}\\d{1,4}(?:-\\d+)?)";
    let m = plano.match(new RegExp("c[oó]digo(?:\\s+de\\s+(?:la\\s+)?v[ií]a)?[^A-Z0-9]{0,40}?" + cod, "i"));
    if (m) return m[1].toUpperCase();
    m = plano.match(new RegExp("(?:^|[^A-Z0-9-])" + cod + "(?![A-Z0-9])"));
    return m ? m[1].toUpperCase() : "";
  }

  function buscarVia(plano, texto) {
    // «VÍA 60AN16-1 Granada – El Choco – San Carlos» (título de informes de interventoría)
    const t = (texto || "").split("\n").map((l) => l.trim()).find((l) => /^v[ií]a\s+\d{2,5}[A-Z]{1,4}\d{1,4}(?:-\d+)?\s+\S/i.test(l) && l.length < 110);
    if (t) {
      const n = t.replace(/^v[ií]a\s+\d{2,5}[A-Z]{1,4}\d{1,4}(?:-\d+)?\s+/i, "").replace(/\s+/g, " ").trim();
      return n === n.toUpperCase() ? n.toLowerCase().replace(/(^|[\s(–-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/ (De|Del|Y) /g, (x) => x.toLowerCase()) : n;
    }
    const m = plano.match(/en\s+la\s+v[ií]a\s+(?!de\s|a\s|que\s)(.{4,140}?)(?=\s*,|\s*\.\s|\s+identificad|\s+en\s+atenci|\s+del\s+municipio|\s+solicitad|\s+ubicad)/i);
    if (!m) return "";
    return m[1].replace(/\s+/g, " ").replace(/^["«“]|["»”]$/g, "").trim();
  }

  // Quita encabezados y pies de página repetidos y pies de foto
  function limpiar(t) {
    return String(t || "")
      .split("\n")
      .filter((l) => !/^\s*(P[aá]gina\s+\d+\s+de\s+\d+|ACTA DE VISITA T[EÉ]CNICA|y\/o INFORME T[EÉ]CNICO|SECRETAR[IÍ]A DE INFRAESTRUCTURA F[IÍ]SICA|C[oó]digo:\s*FO-|Versi[oó]n:\s*\d|Fecha de aprobaci[oó]n:?|\d{2}\/\d{2}\/\d{4}\s*$|Registro fotogr[aá]fico:?\s*$)/i.test(l))
      .map((l) => l.replace(/Imagen\s+\d+\s*\.[^\n]*?(?=Imagen\s+\d+|$)/gi, ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function recortar(t, max) {
    if (t.length <= max) return t;
    const c = t.slice(0, max), p = c.lastIndexOf(". ");
    return (p > max * 0.5 ? c.slice(0, p + 1) : c + "…").trim();
  }

// Abscisas: PR 18+200 · Pr18+200 · K18+200 · Km 18+200 · abscisa 18+200
  const RE_PR = /\b(?:pr|k|km|abs(?:cisa)?)\s*\.?\s*(\d{1,3})\s*\+\s*(\d{1,3})\b/i;
  const prDe = (t) => { const m = String(t || "").match(RE_PR); return m ? `${Number(m[1])}+${m[2].padStart(3, "0")}` : ""; };
  function secciones(texto, fin, paginaDe, general) {
    const lineas = [], out = [];
    let pos = 0;
    texto.split("\n").forEach((l) => { lineas.push({ l: l.trim(), i: pos }); pos += l.length + 1; });
    const esTitulo = (x) => x.l.length >= 6 && x.l.length <= 80 && RE_PR.test(x.l) && x.i < fin
      && !/^(fotograf|foto|ilustraci|imagen|figura|tabla|durante|se\s|en\s|el\s|la\s|para\s|es\s)/i.test(x.l) && !/\$|\.\s*$/.test(x.l);
    const titulos = lineas.filter(esTitulo).filter((x, k, arr) => arr.findIndex((y) => prDe(y.l) === prDe(x.l)) === k);
    titulos.forEach((t, k) => {
      const hasta = Math.min(k + 1 < titulos.length ? titulos[k + 1].i : fin, (() => {
        const m = texto.slice(t.i).search(/\n\s*[•\-\d.]*\s*(PLAN DE INTERVENCI|ACCIONES INMEDIATAS|CONCLUSIONES)/i); return m > 0 ? t.i + m : fin; })());
      const cuerpo = texto.slice(t.i + t.l.length, hasta).split("\n")
        .filter((l) => !/^\s*(fotograf[ií]a|foto|ilustraci[oó]n|imagen)\s*\d/i.test(l)).join("\n");
      const pr = prDe(t.l);
      out.push({ lat: null, lon: null, pr, nombre: "PR " + pr, titulo: t.l.replace(/\s+/g, " "),
        tipo: tipoDe(t.l) || tipoDe(cuerpo) || general.tipoGeneral,
        descripcion: recortar(t.l.replace(/\s+/g, " ") + ": " + limpiar(cuerpo), 1500), pagina: paginaDe(t.i) });
    });
    return out;
  }

  /* Registros fotográficos en tabla (ej. «Anexo A. Registro fotográfico de pérdidas de banca»):
   *   Municipio | Punto | Vía | Abscisa | Latitud | Longitud
   *   Caicedo   | P1    | Caicedo – Urrao (25BAN06-1) Segundo Orden | K16+600 | 6.4010N | 76.0473W
   * Cada fila es un punto con su propio municipio, vía (nombre y código), abscisa y coordenadas. */
  const RE_COD_PAREN = /\(\s*(\d{2,5}\s?[A-Z]{1,4}\s?\d{1,4}(?:\s?-\s?\d{1,2})?)\s*\)/;
  const RE_COD_LIBRE = /(?:^|[^A-Z0-9-])(\d{2,5}[A-Z]{1,4}\d{1,4}(?:-\d{1,2})?)(?![A-Z0-9])/;
  const RE_ORDEN = /\b(primer|segundo|tercer)\s+orden\b/i;
  const esEncabezadoTabla = (l) => /\bpunto\b/i.test(l) && /\blatitud\b/i.test(l) && /\blongitud\b/i.test(l);
  const inicioFila = (l) => /^\s*(.{0,40}?)\s*\b(P\s?-?\s?\d{1,3})\s*$/i.exec(l) || /^\s*(.{0,40}?)\s*\b(P\s?-?\s?\d{1,3})\b(?=\s+[A-ZÁÉÍÓÚÑ(])/.exec(l);
  function tablaPuntos(paginas) {
    const out = [];
    paginas.forEach((pag, k) => {
      const lineas = normalizar(pag).split("\n").map((l) => l.trim()).filter(Boolean);
      let enTabla = false, fila = null;
      const cerrar = () => {
        if (!fila) return;
        const resto = fila.lineas.join("\n"), plano = resto.replace(/\s+/g, " ");
        const c = buscarCoordenadas(plano)[0];
        const pr = prDe(plano);
        if (c || pr) {
          const mCod = plano.match(RE_COD_PAREN) || plano.match(RE_COD_LIBRE);
          const codigo = mCod ? mCod[1].toUpperCase().replace(/\s/g, "") : "";
          const orden = (plano.match(RE_ORDEN) || [])[0] || "";
          // Nombre de la vía: el texto de la celda «Vía», sin el código, el orden, la abscisa ni las coordenadas
          let via = resto.split("\n").filter((l) => !RE_PR.test(l) && !buscarCoordenadas(l).length).join(" ");
          if (mCod) via = via.replace(/\(\s*\d{2,5}\s?[A-Z]{1,4}\s?\d{1,4}(?:\s?-\s?\d{1,2})?\s*\)/, " ").replace(mCod[1], " ");
          via = via.replace(RE_ORDEN, " ").replace(/\(\s*\)/g, " ").replace(/\s*[-–—]\s*/g, " - ").replace(/\s{2,}/g, " ").replace(/^[\s-]+|[\s-]+$/g, "").trim();
          const municipio = fila.municipio.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñü .-]/g, "").trim();
          const punto = fila.punto.toUpperCase().replace(/[^P0-9]/g, "");
          const nombre = (municipio ? municipio + " " : "") + punto;
          out.push({
            lat: c ? c.lat : null, lon: c ? c.lon : null, pr, codigoVia: codigo, via, orden, municipio, nombre, pagina: k + 1, deTabla: true,
            latitudDMS: c ? plano.slice(c.i, c.f) : "",
            descripcion: [nombre + ".", via || codigo ? "Vía " + [via, codigo && "(" + codigo + ")"].filter(Boolean).join(" ") + (orden ? ", " + orden.toLowerCase() : "") + "." : "",
              pr ? "Abscisa K" + pr + "." : ""].filter(Boolean).join(" ")
          });
        }
        fila = null;
      };
      for (const l of lineas) {
        if (esEncabezadoTabla(l)) { cerrar(); enTabla = true; continue; }
        if (!enTabla) continue;
        const m = inicioFila(l);
        if (m && !buscarCoordenadas(l).length) {
          cerrar();
          fila = { municipio: m[1] || "", punto: m[2], lineas: [l.slice(m.index + m[0].length).trim()].filter(Boolean) };
          continue;
        }
        if (fila) {
          fila.lineas.push(l);
          // La fila termina con las coordenadas (última celda)
          if (buscarCoordenadas(fila.lineas.join(" ")).length && /[WO]\s*$|\d\s*$/i.test(l) && buscarCoordenadas(l).length) cerrar();
        }
      }
      cerrar();
    });
    return out;
  }

  /* paginas: textos por página. Devuelve los datos generales y un punto por cada coordenada distinta. */
  function interpretar(paginas) {
    const offs = []; let texto = "";
    paginas.forEach((p) => { offs.push(texto.length); texto += normalizar(p) + "\n"; });
    const paginaDe = (i) => { let n = 0; offs.forEach((o, k) => { if (i >= o) n = k; }); return n + 1; };
    const plano = texto.replace(/\s+/g, " ");

    const fecha = buscarFecha(plano);
    const general = {
      fecha: fecha.fecha, fechaTexto: fecha.texto,
      codigoVia: buscarCodigo(plano),
      via: buscarVia(plano, texto),
      esGobernacion: /secretar[ií]a de infraestructura f[ií]sica|gobernaci[oó]n de antioquia/i.test(plano),
      tipoGeneral: tipoDe(plano.slice(0, 4000))
    };

    // Fin del cuerpo descriptivo (conclusiones)
    const mFin = texto.search(/\n\s*\d*\.?\s*CONCLUSIONES/i);
    const fin = mFin > 0 ? mFin : texto.length;

    const occ = buscarCoordenadas(texto);
    const puntos = [];
    const mismo = (a, b) => Math.abs(a.lat - b.lat) < 0.00006 && Math.abs(a.lon - b.lon) < 0.00006;
    occ.forEach((o) => { let p = puntos.find((x) => mismo(x, o)); if (!p) { p = { lat: o.lat, lon: o.lon, occ: [] }; puntos.push(p); } p.occ.push(o); });

    puntos.forEach((p, k) => {
      // El tramo detallado es la aparición seguida del texto más largo antes de otra coordenada distinta
      let mejor = null;
      p.occ.forEach((o) => {
        const sig = occ.find((x) => x.i > o.i && !mismo(x, p));
        let hasta = sig ? sig.i : texto.length;
        if (o.i < fin) hasta = Math.min(hasta, fin);
        if (sig) { const ini = texto.lastIndexOf("\n", sig.i); if (ini > o.f) hasta = Math.min(hasta, ini); }
        const linea = texto.slice(texto.lastIndexOf("\n", o.i) + 1, o.i);
        // Prioridad: encabezado tipo «Tramo 1.», luego la descripción más larga
        const titulo = /^\s*(?:tramo|punto|sitio|pk)\s*\d+/i.test(linea) ? 1 : 0;
        const largo = hasta - o.i;
        if (!mejor || titulo > mejor.titulo || (titulo === mejor.titulo && largo > mejor.largo)) mejor = { o, hasta, largo, titulo };
      });
      const iniLinea = texto.lastIndexOf("\n", mejor.o.i) + 1;
      const encabezado = texto.slice(iniLinea, texto.indexOf("\n", mejor.o.f) > 0 ? texto.indexOf("\n", mejor.o.f) : mejor.o.f);
      const tramo = texto.slice(iniLinea, mejor.hasta);
      const mNombre = encabezado.match(/^\s*((?:tramo|punto|sitio|pk)\s*\d+)/i);
      p.nombre = mNombre ? mNombre[1].replace(/\s+/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Punto " + (k + 1);
      p.tipo = tipoDe(encabezado) || tipoDe(tramo) || general.tipoGeneral;
      p.descripcion = recortar(limpiar(tramo), 1500);
      p.pagina = paginaDe(mejor.o.i);
      p.latitudDMS = texto.slice(mejor.o.i, mejor.o.f);
      delete p.occ;
    });

    // Registro fotográfico en tabla: cada fila es un punto con su vía, municipio y abscisa (manda sobre la lectura libre)
    const tabla = tablaPuntos(paginas);
    if (tabla.length && tabla.length >= puntos.length * 0.5) {
      puntos.length = 0;
      tabla.forEach((x) => { x.tipo = tipoDe(x.descripcion) || general.tipoGeneral; puntos.push(x); });
      // Datos generales solo si son los mismos en todo el documento (si no, cada punto lleva los suyos)
      const unico = (k) => { const v = [...new Set(tabla.map((x) => x[k]).filter(Boolean))]; return v.length === 1 ? v[0] : ""; };
      general.codigoVia = unico("codigoVia"); general.via = unico("via");
    }

    // Informes sin coordenadas en el texto: cada sección con un PR en el título es un punto
    // (ej. «Perdida de banca Pr18+200», «Falla en tramo de vía Pr25+300»). Las coordenadas se toman luego del sello de sus fotos.
    if (!puntos.length) secciones(texto, fin, paginaDe, general).forEach((x) => puntos.push(x));
    const r = Object.assign(general, { puntos, texto: plano });
    r.resumen = resumir(r);
    puntos.forEach((p) => { p.resumen = p.deTabla ? "" : resumenDePunto(p); });
    return r;
  }


  /* Resumen de todo el acta (sin servidor): motivo de la visita, lo encontrado y medido en cada tramo
     y las recomendaciones. Con el servidor conectado, Gemini lo reemplaza por uno redactado. */
  function frases(t) { return String(t || "").replace(/\s+/g, " ").split(/(?<=[.;])\s+(?=[A-ZÁÉÍÓÚÑ])/).map((x) => x.trim()).filter(Boolean); }
  const corta = (t, n) => (t.length > n ? t.slice(0, n).replace(/\s+\S*$/, "") + "…" : t);
  // Resumen de UN punto (para sus Observaciones): lo encontrado, las medidas y lo recomendado en ese sitio
  function resumenDePunto(p) {
    const fs = frases(p.descripcion).filter((f) => !/^(tramo|punto|sitio|pk)\s*\d+\s*[.:]/i.test(f) || /se\s+(evidenci|identific|observ)/i.test(f));
    const hallazgo = fs.find((f) => /se\s+(evidenci|identific|observ)/i.test(f));
    const medidas = fs.filter((f) => /se\s+estima|longitud|ancho\s+efectivo|altura/i.test(f) && f !== hallazgo).slice(0, 2);
    const rec = fs.find((f) => /se\s+recomienda|se\s+requiere/i.test(f));
    let h = hallazgo ? hallazgo.replace(/^.*?(se\s+(evidenci|identific|observ))/i, (m, a) => a.charAt(0).toUpperCase() + a.slice(1)) : "";
    // Frases sin punto final (líneas sueltas): que la recomendación no quede repetida dentro del hallazgo
    const iRec = rec ? h.search(/\s+se\s+(recomienda|requiere)/i) : -1;
    if (iRec > 20) h = h.slice(0, iRec).trim();
    const partes = [[h && corta(h, 320), ...medidas.map((m) => corta(m, 220))].filter(Boolean).join(" ")];
    if (rec) partes.push("Recomendación: " + corta(rec.slice(Math.max(0, rec.search(/se\s+recomienda|se\s+requiere/i))), 320));
    const t = partes.filter(Boolean).join("\n");
    return t ? (p.nombre ? p.nombre + ": " : "") + t : "";
  }
  function resumir(d) {
    const partes = [];
    const motivo = frases(d.texto).find((f) => /se\s+realiz[oó]\s+(?:una\s+)?visita|tuvo\s+como\s+objeto|se\s+llev[oó]\s+a\s+cabo\s+una\s+(?:inspecci|visita)/i.test(f));
    if (motivo) {
      let m = motivo.slice(Math.max(0, motivo.search(/se\s+realiz[oó]|la\s+visita\s+tuvo|se\s+llev[oó]\s+a\s+cabo/i)));
      const fin = m.search(/\.\s/); if (fin > 40) m = m.slice(0, fin + 1);
      partes.push(corta(m, 380));
    }
    const recs = [];
    (d.puntos || []).forEach((p) => {
      const fs = frases(p.descripcion).filter((f) => !/^(tramo|punto|sitio|pk)\s*\d+\s*[.:]/i.test(f) || /se\s+(evidenci|identific|observ)/i.test(f));
      const hallazgo = fs.find((f) => /se\s+(evidenci|identific|observ)/i.test(f));
      const medida = fs.find((f) => /se\s+estima|longitud|ancho\s+efectivo|altura/i.test(f) && f !== hallazgo);
      const rec = fs.find((f) => /se\s+recomienda|se\s+requiere/i.test(f));
      const txt = [hallazgo && corta(hallazgo.replace(/^.*?(se\s+(evidenci|identific|observ))/i, (m, a) => a.charAt(0).toUpperCase() + a.slice(1)), 260), medida && corta(medida, 200)].filter(Boolean).join(" ");
      if (txt) partes.push(p.nombre + ": " + txt);
      const recT = rec ? rec.slice(Math.max(0, rec.search(/se\s+recomienda|se\s+requiere/i))).replace(/\s*Se recomienda\s+([A-ZÁÉÍÓÚ])/, (m, c) => "Se recomiendan " + c.toLowerCase()) : "";
      if (recT && !recs.some((r) => r.slice(0, 40) === recT.slice(0, 40))) recs.push(p.nombre + ": " + corta(recT, 240));
    });
    if (recs.length) partes.push("Recomendaciones: " + recs.join(" "));
    return partes.join("\n").slice(0, 2000);
  }


  // Fotos incrustadas en el PDF (para leer el sello de cada una). Devuelve las más grandes primero.
  async function imagenes(doc, max, minLado) {
    const lib = await cargarLib(), OPS = lib.OPS, out = [];
    for (let n = 1; n <= doc.numPages && out.length < (max || 20); n++) {
      const pag = await doc.getPage(n);
      const ops = await pag.getOperatorList();
      const ids = [];
      ops.fnArray.forEach((f, i) => { if (f === OPS.paintImageXObject || f === OPS.paintJpegXObject) ids.push(ops.argsArray[i][0]); });
      for (const id of [...new Set(ids)]) {
        try {
          const img = await new Promise((ok) => { try { (id.startsWith("g_") ? pag.commonObjs : pag.objs).get(id, ok); } catch (_) { ok(null); } });
          if (!img || Math.min(img.width, img.height) < (minLado || 300)) continue;
          if (Math.max(img.width, img.height) / Math.min(img.width, img.height) > 2.6) continue; // franjas de encabezado o pie, no fotos
          const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
          const cx = cv.getContext("2d");
          if (img.bitmap) cx.drawImage(img.bitmap, 0, 0);
          else if (img.data) {
            const rgba = new Uint8ClampedArray(img.width * img.height * 4), d = img.data, px = img.width * img.height;
            if (d.length === px * 4) rgba.set(d);
            else if (d.length === px * 3) for (let i = 0, j = 0; i < px; i++) { rgba[j++] = d[i * 3]; rgba[j++] = d[i * 3 + 1]; rgba[j++] = d[i * 3 + 2]; rgba[j++] = 255; }
            else if (d.length === px) for (let i = 0, j = 0; i < px; i++) { rgba[j++] = rgba[j++] = rgba[j++] = d[i]; rgba[j++] = 255; }
            else continue; // formato de 1 bit (dibujos): no son fotos
            cx.putImageData(new ImageData(rgba, img.width, img.height), 0, 0);
          } else continue;
          const dataUrl = cv.toDataURL("image/png"); // sin recomprimir: el sello se lee mejor
          if (out.some((x) => x.dataUrl === dataUrl)) continue; // la misma imagen repetida en varias páginas
          out.push({ pagina: n, ancho: img.width, alto: img.height, dataUrl });
        } catch (_) { /* imagen que no se pudo extraer */ }
      }
    }
    return out;
  }

  return { cargarLib, abrir, dibujarPagina, imagenes, interpretar, tipoDe, resumir, resumenDePunto, prDe };
})();
if (typeof module !== "undefined") module.exports = LectorPDF;
