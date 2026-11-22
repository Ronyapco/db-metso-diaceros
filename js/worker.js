/* =====================================================================
   worker.js · Lee el Excel de Día Cero (inducción de seguridad HSE)
   Una fila = una persona convocada a un Día Cero: ITEM · DNI · Apellidos_Nombres ·
   Tipo_Personal · Cargo_Puesto · Gerencia · Sede_Base · Observacion · DIA ·
   Lugar de Dia cero · CLIENTE · Responsable HSE.
   Si el libro trae varias pestañas, usa la que tenga estos encabezados.
   Devuelve la hoja en columnas y comprimida (gzip + base64).
   ===================================================================== */

const DESTINO = { key: "dia-cero", sb: "DIA_CERO", kind: "dc", nombre: "Día Cero · Inducción de seguridad (HSE)" };

// Encabezado normalizado → campo
const MAP = {
  item: "item", dni: "dni", apellidosnombres: "nombre", apellidosynombres: "nombre", nombres: "nombre", tipopersonal: "tipo", cargopuesto: "cargo", cargo: "cargo", gerencia: "gerencia",
  sedebase: "sede", sede: "sede", observacion: "obs", dia: "fecha", fecha: "fecha", lugardediacero: "lugar", lugardiacero: "lugar", cliente: "cliente", responsablehse: "resp",
};
const TXT = ["dni", "nombre", "tipo", "cargo", "gerencia", "sede", "obs", "fecha", "lugar", "cliente", "resp"];
const NUM = ["item"];
const OBLIG = ["dni", "fecha", "sede", "cliente"];
// Campos que se escriben en mayúsculas; el resto conserva el texto y se unifica sin distinguir mayúsculas
const MAYUS = ["tipo", "sede", "obs"];


self.onmessage = async function (e) {
  const msg = e.data || {};
  const prog = (pct, label) => self.postMessage({ progress: true, pct, label });
  try {
    let sheet, rows;
    if (msg.buffer) {
      prog(4, "Cargando el lector de Excel…");
      if (typeof XLSX === "undefined") importScripts(msg.xlsxUrl);
      prog(10, "Leyendo los nombres de las pestañas…");
      const libro = XLSX.read(msg.buffer, { type: "array", bookSheets: true });
      const nombres = libro.SheetNames;
      sheet = nombres[0];
      if (nombres.length > 1) {
        // Varias pestañas: se mira solo el comienzo de cada una para elegir la que tiene los encabezados
        prog(14, "Buscando la hoja del balance metalúrgico…");
        const peek = XLSX.read(msg.buffer, { type: "array", sheetRows: 12 });
        let mejor = -1;
        nombres.forEach((n) => { const s = puntaje(leerHoja(peek.Sheets[n])); if (s > mejor) { mejor = s; sheet = n; } });
      }
      prog(20, `Abriendo «${sheet}»…`);
      const wb = XLSX.read(msg.buffer, { type: "array", cellDates: true, cellNF: false, cellStyles: false, cellHTML: false, cellFormula: false, sheets: [sheet] });
      prog(36, "Convirtiendo filas…");
      rows = leerHoja(wb.Sheets[sheet]);
    } else {
      const k = Object.keys(msg.sheets || {});
      if (!k.length) throw new Error("No llegó ninguna pestaña.");
      sheet = k.sort((a, b) => puntaje(msg.sheets[b]) - puntaje(msg.sheets[a]))[0];
      rows = msg.sheets[sheet];
    }
    prog(50, `Procesando «${sheet}»…`);
    const t0 = Date.now();
    const r = procesar(rows, sheet);
    prog(80, "Comprimiendo…");
    const json = JSON.stringify(r.enc);
    const z = await gzipB64(json);
    const payload = { meta: r.meta, kpis: r.kpis, ...(z ? { z } : { enc: r.enc }) };
    self.postMessage({ ok: true, resultado: [{ ...DESTINO, file: "bm", sheet, ok: true, payload, preview: r.preview, bytes: z ? z.length : json.length, crudo: json.length, ms: Date.now() - t0 }] });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message || String(err) });
  }
};

async function gzipB64(json) {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
function leerHoja(ws) {
  if (!ws || !ws["!ref"]) return [];
  const R = XLSX.utils.decode_range(ws["!ref"]);
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: false, range: { s: { r: R.s.r, c: R.s.c }, e: { r: R.e.r, c: Math.min(R.e.c, R.s.c + 40) } } });
}
function puntaje(rows) {
  let m = 0;
  (rows || []).slice(0, 12).forEach((r) => { const s = new Set((r || []).map((c) => MAP[normKey(c)]).filter(Boolean)).size; if (s > m) m = s; });
  return m;
}

/* ---------- Utilidades ---------- */
function norm(v) { return v === undefined || v === null ? "" : String(v).replace(/\s+/g, " ").trim(); }
function normKey(k) { return norm(k).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, ""); }
function txt(v) { const s = norm(v); return /^(#n\/a|n\/a|#¡?ref!?|#value!|#¡valor!|#div\/0!|null|none|nan|undefined)$/i.test(s) ? "" : s; }
function numOrNull(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = norm(v);
  if (!s || /^#/.test(s)) return null;
  const n = parseFloat(s.replace(/[^\d.,\-]/g, "").replace(",", "."));
  return isFinite(n) ? n : null;
}
// El DNI / documento: texto sin ".0" ni espacios (puede venir como número)
function docTxt(v) {
  if (typeof v === "number") return isFinite(v) ? String(Math.round(v)) : "";
  return txt(v).replace(/\.0+$/, "").replace(/\s+/g, "");
}
// Fechas: Date de Excel, serie numérica, «08/07/2026» (día/mes/año) o «2026-07-08»
function parseFecha(v) {
  if (v instanceof Date) { const d = new Date(v.getTime() + 60000); return isNaN(d) || d.getFullYear() < 1990 ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  if (typeof v === "number" && v > 30000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
  const s = norm(v);
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) return new Date(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1]);
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}
function iso(d) { if (!d) return ""; const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
const up = (s) => norm(s).toUpperCase();
const semTxt = (v) => { const n = numOrNull(v); return n == null ? txt(v) : "Sem " + String(Math.round(n)).padStart(2, "0"); };

function columnar(registros, TF, NF) {
  const dicts = {}, idx = {}, cols = {};
  TF.forEach((f) => { dicts[f] = []; idx[f] = new Map(); cols[f] = []; });
  NF.forEach((f) => { cols[f] = []; });
  registros.forEach((r) => {
    TF.forEach((f) => { const s = r[f] == null ? "" : String(r[f]); let i = idx[f].get(s); if (i === undefined) { i = dicts[f].length; dicts[f].push(s); idx[f].set(s, i); } cols[f].push(i); });
    NF.forEach((f) => cols[f].push(r[f] == null ? null : r[f]));
  });
  return { n: registros.length, dicts, cols };
}

/* =========================== Hoja Día Cero =========================== */
function procesar(rows, sheet) {
  if (!rows || !rows.length) throw new Error(`La pestaña "${sheet}" está vacía.`);
  let hIdx = -1, mejor = 0;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const s = new Set((rows[i] || []).map((c) => MAP[normKey(c)]).filter(Boolean)).size;
    if (s > mejor) { mejor = s; hIdx = i; }
  }
  if (hIdx < 0 || mejor < 6) throw new Error(`No encontré los encabezados en "${sheet}" (DNI, Tipo_Personal, Sede_Base, Observacion, DIA, CLIENTE…).`);
  const map = {}, columnas = {};
  rows[hIdx].forEach((h, j) => { const c = MAP[normKey(h)]; if (c && !(c in columnas)) { map[j] = c; columnas[c] = norm(h); } });
  const falt = OBLIG.filter((c) => !(c in columnas));
  if (falt.length) throw new Error(`En "${sheet}" faltan columnas obligatorias: ${falt.join(", ")}.`);

  const canon = {};   // texto sin distinguir mayúsculas → primera forma vista
  const unif = (f, v) => {
    const s = MAYUS.includes(f) ? up(v) : norm(v);
    if (!s) return "";
    const k = s.toUpperCase();
    const m = (canon[f] = canon[f] || {});
    return m[k] || (m[k] = s);
  };
  const regs = [];
  let omitidas = 0;
  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const o = {};
    for (const c in map) o[map[c]] = r[c];
    const dni = txt(o.dni).replace(/\.0+$/, "").replace(/\D/g, "");
    const item = numOrNull(o.item);
    const algo = TXT.some((f) => f !== "fecha" && txt(o[f]) !== "") || o.fecha;
    if (!dni && item == null && !algo) { omitidas++; continue; }
    if (!dni && !algo) { omitidas++; continue; }   // solo trae el número de ITEM: fila vacía
    const f = parseFecha(o.fecha);
    const reg = { item, dni, fecha: f ? iso(f) : "" };
    ["nombre", "tipo", "cargo", "gerencia", "sede", "obs", "lugar", "cliente", "resp"].forEach((k) => { reg[k] = unif(k, o[k]); });
    regs.push(reg);
  }
  if (!regs.length) throw new Error(`"${sheet}" no tiene filas con datos.`);
  const enc = columnar(regs, TXT, NUM);
  const fechas = regs.map((r) => r.fecha).filter(Boolean).sort();
  const uniq = (f) => new Set(regs.map((r) => r[f]).filter(Boolean)).size;
  const asist = new Set(regs.filter((r) => /^asisti/i.test(r.obs) && r.dni).map((r) => r.dni)).size;
  return {
    meta: { schema: 1, formato: "columnar", kind: "dc", hoja: sheet, columnas, faltantes: Object.keys(MAP).map((k) => MAP[k]).filter((c, i, a) => a.indexOf(c) === i && !(c in columnas)), filaEncabezado: hIdx + 1, filasOmitidas: omitidas, registros: regs.length },
    kpis: { filas: regs.length, trabajadores: uniq("dni"), asistentes: asist, clientes: uniq("cliente"), sedes: uniq("sede"), desde: fechas[0] || "", hasta: fechas[fechas.length - 1] || "" },
    preview: regs.slice(0, 8),
    enc,
  };
}
