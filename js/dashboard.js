/* =====================================================================
   dashboard.js · CORE HSE · Día Cero (inducción de seguridad)
   Tablero único sobre el registro de Día Cero. Una fila = una persona convocada:
   DNI · Tipo_Personal · Cargo_Puesto · Gerencia · Sede_Base · Observacion · DIA ·
   Lugar de Dia cero · CLIENTE · Responsable HSE.
   - Todo se cuenta por trabajador (DNI distinto): si una persona aparece en
     varias filas cuenta una vez; asistió si alguna fila dice ASISTIO.
   - Asistió = Observacion en CONFIG.ASISTE (por defecto «ASISTIO»); cualquier
     otro estado, o vacío, cuenta como no asistió.
   - Tipos de personal, sedes, clientes, lugares, cargos, gerencias, responsables
     y estados salen de los datos: nada está escrito a mano.
   Sincronización: aviso entre pestañas, Realtime, sondeo liviano, al volver
   a la pestaña y al restaurar desde el historial (bfcache).
   ===================================================================== */
"use strict";

/* =========================== CONFIGURACIÓN =========================== */
const CONFIG = {
  SUPABASE_URL: "https://ylokcbajvrqfgscsgvtl.supabase.co",
  SUPABASE_KEY: "sb_publishable_NkHystpxh-d56YACYspsKg_V8bnnVCc",
  TABLE: "dashboard_data",
  HOME_URL: "index.html",
  BUS: "core-dashboard",
  LS_UPLOAD: "core:lastUpload",
  LS_THEME: "core:theme",
  LS_DATASET: "core:dc:tablero",
  POLL_MS: 20000,

  // Reglas de cálculo (editables)
  ASISTE: ["ASISTIO"],       // valores de Observacion que cuentan como asistencia
  META_ASIS: 90,             // % de asistencia a partir del cual el estado es «en meta» (referencial)
  TOP_N: 15,
  PAGE_SIZE: 50,
};

const noStoreFetch = (input, init = {}) => fetch(input, { ...init, cache: "no-store" });
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
  global: { fetch: noStoreFetch },
  auth: { persistSession: false },
});
const REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* =========================== CONSTANTES =========================== */
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MES_CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const DIA_CORTO = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

// Catálogo de segmentadores
const DIMCAT = {
  tipo: { label: "Tipo de personal", icon: "fa-id-badge", empty: "(Sin tipo)" },
  cargo: { label: "Cargo / puesto", icon: "fa-user-gear", empty: "(Sin cargo)" },
  gerencia: { label: "Gerencia", icon: "fa-sitemap", empty: "(Sin gerencia)" },
  sede: { label: "Sede base", icon: "fa-location-dot", empty: "(Sin sede)" },
  obs: { label: "Observación", icon: "fa-clipboard-check", empty: "(Sin observación)" },
  lugar: { label: "Lugar de Día Cero", icon: "fa-map-pin", empty: "(Sin lugar)" },
  cliente: { label: "Cliente", icon: "fa-building", empty: "(Sin cliente)" },
  resp: { label: "Responsable HSE", icon: "fa-user-shield", empty: "(Sin responsable)" },
};

const FILES = { dc: { label: "Día Cero HSE", icon: "fa-helmet-safety", excel: "BD-DIA_CERO__FSE_2026" } };

/* ---------- El tablero ----------
   sheet = sheet_name en Supabase (el mismo que usa index.js) */
const DATASETS = {
  "dia-cero": {
    file: "dc", sheet: "DIA_CERO", tab: "Registro Día Cero", engine: "dc",
    titulo: "Día Cero · Inducción de seguridad (HSE)", icon: "fa-helmet-safety", term: ["registro", "registros"], fechaLabel: "Día",
    dims: [["tipo", "main"], ["sede", "main"], ["cliente", "main"], ["obs", "main"], ["gerencia", "main"], ["lugar", "main"], ["cargo", "more"], ["resp", "more"]],
    kpis: ["dcAsis", "dcUnicos", "dcCobertura", "dcClientes", "dcSinDia"],
    secs: [
      { k: "resumen", t: "Resumen", icon: "fa-gauge-high", desc: "Cuántos trabajadores se convocaron al Día Cero, cuántos asistieron y cómo evoluciona la asistencia día a día.", kpis: true,
        items: [["dcDia", 12, "lg"], ["dcPctDia", 12], ["dcTipo", 5, "donut"], ["dcObs", 7, "donut"], ["xHall", 12]] },
      { k: "asistencia", t: "Asistencia", icon: "fa-user-check", desc: "Asistencia por sede base, cliente, tipo de personal y gerencia.",
        items: [["dcSede", 7], ["dcTipoAsis", 5], ["dcCliente", 12], ["dcGerencia", 12], ["tSede", 12], ["tCliente", 12], ["tTipo", 12], ["tGerencia", 12]] },
      { k: "distribucion", t: "Cargos, responsables y lugares", icon: "fa-people-group", desc: "Quiénes asisten y dónde se dictan los Día Cero: cargos, responsables HSE y lugares.",
        items: [["dcCargo", 12], ["dcResp", 6], ["dcLugar", 6], ["tLugar", 12]] },
      { k: "cruces", t: "Cruces", icon: "fa-table-cells", desc: "Asistentes por sede y cliente, por tipo de personal y cliente, y por gerencia y sede.",
        items: [["dcSedeCliente", 6], ["dcTipoCliente", 6], ["dcGerSede", 12], ["tMatriz", 12]] },
      { k: "calidad", t: "Calidad y cumplimiento", icon: "fa-shield-halved", desc: "Qué tan completo está el registro y qué personas requieren seguimiento HSE.",
        items: [["dcCalidad", 12], ["tCumpl", 12]] },
      { k: "detalle", t: "Detalle", icon: "fa-table-list", desc: "Cada registro de Día Cero. Respeta los filtros.", items: [["tDetalle", 12]] },
    ],
  },
};
const DS_KEYS = Object.keys(DATASETS);
DS_KEYS.forEach((k) => { DATASETS[k].key = k; });
const dsOf = (sheet) => DS_KEYS.find((k) => DATASETS[k].sheet === sheet);

/* =========================== ESTADO =========================== */
const DS_FIELDS = ["payload", "filas", "dims", "rango", "filtros", "seccion", "signature", "uploadedAt", "sort", "page", "q", "moreOpen"];
const nuevoStore = () => ({ payload: null, filas: [], dims: {}, rango: { min: "", max: "" }, filtros: { desde: "", hasta: "" }, seccion: "", signature: null, uploadedAt: null, sort: {}, page: {}, q: {}, moreOpen: false });
const STORE = Object.fromEntries(DS_KEYS.map((k) => [k, nuevoStore()]));
const PUB = {};

const state = { ds: DS_KEYS[0], ...nuevoStore(), vista: [], d: null, lastSync: null, loading: null, error: null, tk: null };
const charts = {};
const outs = {};
const tables = {};
const DS = () => DATASETS[state.ds];
const ENG = () => ENGINES[DS().engine];
/* =========================== UTILIDADES =========================== */
const $ = (id) => document.getElementById(id);
const NF = {};
const fmt = (v, d = 0) => (NF[d] || (NF[d] = new Intl.NumberFormat("es-PE", { maximumFractionDigits: d, minimumFractionDigits: d }))).format(Number(v || 0));
const compactNF = new Intl.NumberFormat("es-PE", { notation: "compact", maximumFractionDigits: 1 });
const fmtSC = (v) => compactNF.format(Number(v || 0));
const fmtD = (v) => fmt(v, 1) + " días";
const fmtPct = (v, d = 1) => fmt(v, d) + " %";
const fmtC = (v) => compactNF.format(Number(v || 0));
const fmtX = (v) => (v == null ? "—" : fmt(v, 2) + "×");
const signo = (v, f = (x) => fmt(x, 1)) => (v > 0 ? "+" : v < 0 ? "−" : "") + f(Math.abs(v));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cell = (v, f) => ({ v, f: f ? f(v) : v });
const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fold2 = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const maxBy = (arr, k) => arr.reduce((a, b) => (b[k] > a[k] ? b : a), arr[0]);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const trunc = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const nOpt = (d = 0) => (v) => (v == null ? "—" : fmt(v, d));
const pOpt = (v) => (v == null ? "—" : fmt(v, 1));
const si = (b) => (b ? "Sí" : "—");
const vacio = (s) => !s || String(s).startsWith("(");

function rgba(hex, a) {
  const h = String(hex).trim().replace("#", "");
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function isObj(x) { return x && typeof x === "object" && !Array.isArray(x) && !(x instanceof Function); }
function merge(target, ...srcs) {
  srcs.forEach((src) => {
    Object.keys(src || {}).forEach((k) => {
      if (isObj(src[k]) && isObj(target[k])) merge(target[k], src[k]);
      else target[k] = src[k];
    });
  });
  return target;
}
function relTime(date) {
  if (!date) return "—";
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (isNaN(s)) return "—";
  if (s < 10) return "recién";
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return new Date(date).toLocaleDateString("es-PE", { day: "2-digit", month: "short" });
}
function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n) => cs.getPropertyValue(n).trim();
  const series = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => g(`--series-${i}`));
  return {
    ink: g("--ink"), ink2: g("--ink-2"), ink3: g("--ink-3"), line: g("--line"), lineStrong: g("--line-strong"),
    grid: g("--grid"), surface: g("--surface"), brand: g("--brand"), series,
    neutral: g("--series-neutral"), good: g("--good"), warn: g("--warn"), crit: g("--crit"),
    // Colores fijos de significado en todo el dashboard
    stock: series[0], ing: series[2], egr: series[1],
  };
}

/* ---------- Fechas ---------- */
const parseISO = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
const fmtDia = (iso) => { if (!iso) return "—"; const d = parseISO(iso); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; };
const fdia = (v) => (v ? fmtDia(v) + "/" + v.slice(2, 4) : "—");
const fmtDiaLargo = (iso) => { if (!iso) return "—"; const d = parseISO(iso); return `${DIA_CORTO[d.getDay()]} ${d.getDate()} ${MES_CORTO[d.getMonth()]} ${d.getFullYear()}`; };
const diasEntre = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
const mesLabel = (key, multi) => { const [y, m] = key.split("-").map(Number); const n = MESES[m - 1]; return n ? (multi ? `${MES_CORTO[m - 1]} ${y}` : n.charAt(0).toUpperCase() + n.slice(1)) : key; };
function lunesDe(iso) { const d = parseISO(iso); const day = d.getDay() || 7; d.setDate(d.getDate() - day + 1); return toISO(d); }

/* =========================== DATOS: DECODIFICACIÓN =========================== */
// El payload llega comprimido (data.z = gzip + base64) o en columnas planas (data.enc)
async function descomprimir(data) {
  if (data.enc) return data.enc;
  if (!data.z) return null;
  if (typeof DecompressionStream === "undefined") throw new Error("Este navegador no puede leer datos comprimidos. Actualizalo (Chrome, Edge, Firefox o Safari recientes).");
  const bin = atob(data.z);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}
function decodificar(e) {
  if (!e || !e.n) return [];
  const D = e.dicts, C = e.cols, n = e.n;
  const dictF = Object.keys(D), numF = Object.keys(C).filter((f) => !(f in D));
  const filas = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = {};
    for (const f of dictF) r[f] = D[f][C[f][i]] ?? "";
    for (const f of numF) r[f] = C[f][i] == null ? null : Number(C[f][i]);
    filas[i] = r;
  }
  return filas;
}

/* =========================== DIMENSIONES =========================== */
const dimDef = (k) => {
  const x = DS().dims.find((d) => d[0] === k);
  return x ? { ...DIMCAT[k], group: x[1], label: x[2] || DIMCAT[k].label } : DIMCAT[k] ? { ...DIMCAT[k], group: "" } : null;
};
const FILTER_KEYS = () => DS().dims.map((d) => d[0]);
const EXTRA_LABEL = { codigo: "Orden de trabajo", set: "Selección", flag: "Control", mesKey: "Mes", item: "Ítem", _hora: "Hora de reporte", clave: "Equipo", _nombre: "Orden de trabajo", _bajoMeta: "Bajo meta", fecha: "Fecha" };
const dimLabel = (k) => (dimDef(k) ? dimDef(k).label : EXTRA_LABEL[k] || k);
const term = (i = 1, cap = false) => { const s = DS().term[i]; return cap ? s.charAt(0).toUpperCase() + s.slice(1) : s; };

function rellenarDims(r, keys) {
  for (const k of keys) if (!r[k]) r[k] = (DIMCAT[k] && DIMCAT[k].empty) || "(Sin dato)";
}
function calcDims(filas) {
  const porTexto = (a, b) => (a.startsWith("(") ? 1 : b.startsWith("(") ? -1 : a.localeCompare(b, "es", { numeric: true, sensitivity: "base" }));
  const out = {};
  const keys = new Set([...FILTER_KEYS(), ...(ENG().dimsExtra || [])]);
  keys.forEach((k) => {
    if (ENG().dimValores && ENG().dimValores[k]) { out[k] = ENG().dimValores[k](filas); return; }
    if (!filas.length || !(k in filas[0])) { out[k] = []; return; }
    const vals = Array.from(new Set(filas.map((r) => r[k])));
    if (DIMCAT[k] && DIMCAT[k].sort === "mes") {
      const key = new Map(filas.map((r) => [r.mes, r._m || "9999"]));
      out[k] = vals.sort((a, b) => (key.get(a) < key.get(b) ? -1 : 1));
    } else out[k] = vals.sort(porTexto);
  });
  out.fechas = Array.from(new Set(filas.map((r) => r.fecha).filter(Boolean))).sort();
  return out;
}

/* =========================== AGREGACIÓN GENÉRICA =========================== */
function groupBy(rows, fn) {
  const m = new Map();
  for (const r of rows) { const k = fn(r); let a = m.get(k); if (!a) { a = []; m.set(k, a); } a.push(r); }
  return m;
}
function porDim(rows, dim, sortKey = "n") {
  const agg = ENG().agg;
  return Array.from(groupBy(rows, (r) => r[dim]).entries())
    .map(([label, v]) => ({ label, ...agg(v), _rows: v }))
    .sort((a, b) => b[sortKey] - a[sortKey]);
}
function porMes(rows) {
  const agg = ENG().agg;
  return Array.from(groupBy(rows.filter((r) => r._m), (r) => r._m).entries())
    .map(([key, v]) => ({ key, label: v[0].mes, short: MES_CORTO[+key.slice(5, 7) - 1] || key, ...agg(v), _rows: v }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}
// Propiedades que se calculan solo si un gráfico las pide
function lazy(obj, defs) {
  Object.keys(defs).forEach((k) => {
    let val, done = false;
    Object.defineProperty(obj, k, { enumerable: true, get() { if (!done) { val = defs[k](); done = true; } return val; } });
  });
  return obj;
}

function filtrar(rows, f, except) {
  const usaFecha = except !== "fecha" && (f.desde || f.hasta);
  const vd = ENG().vistaDims || [], hook = ENG().rowOk;
  const dims = FILTER_KEYS().filter((k) => k !== except && f[k] && !vd.includes(k));
  if (!usaFecha && !dims.length && !hook) return rows;
  return rows.filter((r) => {
    if (hook && !hook(r, f, except)) return false;
    if (usaFecha && (!r.fecha || (f.desde && r.fecha < f.desde) || (f.hasta && r.fecha > f.hasta))) return false;
    for (const k of dims) if (r[k] !== f[k]) return false;
    return true;
  });
}
function matchCond(r, c) {
  if (c.dim === "codigo") return r._id === c.value;
  if (c.dim === "set") return c.value.includes(r._id);
  if (c.dim === "flag") return !!(r._f && r._f[c.value]);
  if (c.dim === "mesKey") return r._m === c.value;
  if (c.dim === "transf") return r._transf;
  return r[c.dim] === c.value;
}

/* Color por entidad (no por ranking): un filtro nunca repinta a los que quedan */
function colorOf(dim, value, t) {
  if (value === "Otros" || vacio(value)) return t.neutral;
  const list = (state.dims[dim] || []).filter((x) => !vacio(x));
  const i = list.indexOf(value);
  return i < 0 ? t.neutral : t.series[i % t.series.length];
}
function fold(list, max = 7, keys = []) {
  if (list.length <= max + 1) return list;
  const top = list.slice(0, max), rest = list.slice(max);
  const otros = { label: "Otros", _otros: rest.map((r) => r.label) };
  keys.forEach((k) => { otros[k] = rest.reduce((a, r) => a + (r[k] || 0), 0); });
  return [...top, otros];
}
const pctDe = (a, b) => (b ? (a / b) * 100 : null);


const fmtH = (v) => (v == null ? "—" : fmt(v, 1) + " h");
const pctOpt = (v) => (v == null ? "—" : fmt(v, 1) + " %");
function semanaISO(iso) { const d = parseISO(iso); d.setDate(d.getDate() + 4 - (d.getDay() || 7)); const y0 = new Date(d.getFullYear(), 0, 1); return Math.ceil(((d - y0) / 86400000 + 1) / 7); }

/* =========================== MOTOR · DÍA CERO =========================== */
const DIAS_LARGO = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const diaCorto = (iso) => `${DIA_CORTO[parseISO(iso).getDay()]} ${fmtDia(iso)}`;
const pct0 = (a, b) => (b > 0 ? (a / b) * 100 : null);
const esAsiste = (obs) => CONFIG.ASISTE.includes(String(obs || "").toUpperCase());

const ENGINE_DC = {
  conFecha: true, unidad: "registros", shareKey: "conv", shareLabel: "los trabajadores en vista",
  dimsExtra: ["tipo", "cargo", "gerencia", "sede", "obs", "lugar", "cliente", "resp", "mes"],

  prep(filas) {
    const años = new Set(filas.map((r) => (r.fecha || "").slice(0, 4)).filter(Boolean));
    const multi = años.size > 1;
    const cnt = new Map();
    filas.forEach((r, i) => {
      r._i = i; r._id = String(i);
      r._dni = r.dni || "";
      r._asis = esAsiste(r.obs);
      r._m = r.fecha ? r.fecha.slice(0, 7) : "";
      r.mes = r._m ? mesLabel(r._m, multi) : "";
      if (r._dni && r.fecha) { const k = r._dni + "|" + r.fecha; cnt.set(k, (cnt.get(k) || 0) + 1); }
    });
    filas.forEach((r) => {
      r._dup = !!(r._dni && r.fecha && cnt.get(r._dni + "|" + r.fecha) > 1);
      r._sinDia = !r.fecha; r._sinObs = !r.obs; r._sinDni = !r._dni;
      // Estado de cumplimiento: Alerta (sin DNI, sin día o duplicado) · Pendiente (sin observación o no asistió) · Cumple
      r._estado = r._sinDni || r._sinDia || r._dup ? "Alerta" : r._sinObs || !r._asis ? "Pendiente" : "Cumple";
      r._nombre = `${r.nombre || r._dni || "Registro"} · ${r.fecha ? fdia(r.fecha) : "sin día"}`;
      rellenarDims(r, ["tipo", "cargo", "gerencia", "sede", "obs", "lugar", "cliente", "resp", "mes"]);
    });
    return filas;
  },

  agg(rows) {
    const dni = new Set(), asis = new Set(), conDia = new Set(), sinDia = new Set(), dd = new Set();
    const S = { tipo: new Set(), cargo: new Set(), gerencia: new Set(), sede: new Set(), lugar: new Set(), cliente: new Set(), resp: new Set() };
    let rDni = 0, rObs = 0, rDia = 0, rLugar = 0, rResp = 0, rDniDia = 0, sinObs = 0;
    for (const r of rows) {
      if (r._dni) {
        rDni++; dni.add(r._dni);
        if (r._asis) asis.add(r._dni);
        if (r.fecha) { conDia.add(r._dni); rDniDia++; dd.add(r._dni + "|" + r.fecha); } else sinDia.add(r._dni);
      }
      if (!r._sinObs) rObs++; else sinObs++;
      if (r.fecha) rDia++;
      if (!vacio(r.lugar)) rLugar++;
      if (!vacio(r.resp)) rResp++;
      for (const k in S) if (!vacio(r[k])) S[k].add(r[k]);
    }
    const n = rows.length, conv = dni.size;
    return {
      n, conv, asis: asis.size, noAsis: conv - asis.size, pctAsis: pct0(asis.size, conv), pctNo: pct0(conv - asis.size, conv),
      conDia: conDia.size, sinDia: sinDia.size, pctCob: pct0(conDia.size, conv),
      tipos: S.tipo.size, cargos: S.cargo.size, gerencias: S.gerencia.size, sedes: S.sede.size, lugares: S.lugar.size, clientes: S.cliente.size, resps: S.resp.size,
      dupExtra: rDniDia - dd.size, sinObs,
      pDni: pct0(rDni, n), pObs: pct0(rObs, n), pDia: pct0(rDia, n), pLugar: pct0(rLugar, n), pResp: pct0(rResp, n),
    };
  },

  calc(v, filas) {
    const sinTiempo = filtrar(filas, { ...state.filtros, mes: "" }, "fecha");
    const d = lazy({ k: this.agg(v), base: v }, {
      dias: () => conVarDia(porFecha(v.filter((r) => r.fecha))),
      meses: () => porMes(v.filter((r) => r._m)),
      tendencia: () => porMes(sinTiempo.filter((r) => r._m)),
      tipos: () => porDim(v, "tipo", "conv"),
      sedes: () => porDim(v, "sede", "conv"),
      clientes: () => porDim(v, "cliente", "conv"),
      gerencias: () => porDim(v, "gerencia", "conv"),
      cargos: () => porDim(v, "cargo", "asis"),
      resps: () => porDim(v, "resp", "asis"),
      lugares: () => porDim(v, "lugar", "asis"),
      obs: () => porDim(v, "obs", "n"),
    });
    return d;
  },

  drillMini(k) {
    return [["Convocados", fmt(k.conv)], ["Asistentes", fmt(k.asis)], ["% asistencia", pctOpt(k.pctAsis)], ["No asistieron", fmt(k.noAsis)],
      ["Con Día Cero", fmt(k.conDia)], ["Sin Día Cero", fmt(k.sinDia)], ["Registros", fmt(k.n)], ["Duplicados DNI + día", fmt(k.dupExtra)]];
  },
  drillDims: [["sede", "Sede base"], ["cliente", "Cliente"], ["tipo", "Tipo de personal"], ["gerencia", "Gerencia"], ["lugar", "Lugar de Día Cero"], ["resp", "Responsable HSE"], ["obs", "Observación"]],
  drillCols: (x) => [["Convocados", x.conv, fmt, 1], ["Asistentes", x.asis, fmt], ["% asistencia", x.pctAsis, pOpt]],
};

function porFecha(rows) {
  const agg = ENGINE_DC.agg;
  return Array.from(groupBy(rows, (r) => r.fecha).entries()).map(([fecha, v]) => ({ label: fecha, fecha, ...agg(v), _rows: v })).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
}
// Variación contra el día anterior con datos
function conVarDia(L) {
  L.forEach((x, i) => { const p = L[i - 1]; x.dAsis = p ? x.asis - p.asis : null; x.dConv = p ? x.conv - p.conv : null; x.dPct = p && x.pctAsis != null && p.pctAsis != null ? x.pctAsis - p.pctAsis : null; });
  return L;
}
// Agrupa por dos dimensiones y agrega
function cruce(rows, da, db) {
  const agg = ENGINE_DC.agg;
  return Array.from(groupBy(rows, (r) => r[da] + "\u0001" + r[db]).values()).map((v) => ({ a: v[0][da], b: v[0][db], ...agg(v), _rows: v }));
}
const condDim = (dim) => (x) => [{ dim, value: x.label }];
const condPar = (da, db) => (x) => [{ dim: da, value: x.a }, { dim: db, value: x.b }];

const ENGINES = { dc: ENGINE_DC };
/* =========================== CHART.JS: PLUGINS =========================== */
const bgPlugin = {
  id: "coreBg",
  beforeDraw(chart) {
    const { ctx, width, height } = chart;
    ctx.save(); ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = (state.tk && state.tk.surface) || "#fff";
    ctx.fillRect(0, 0, width, height); ctx.restore();
  },
};
const crossPlugin = {
  id: "coreCross",
  afterDatasetsDraw(chart, _a, opts) {
    if (!opts || !opts.enabled) return;
    const act = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
    if (!act.length) return;
    const x = act[0].element.x, a = chart.chartArea, ctx = chart.ctx;
    ctx.save(); ctx.strokeStyle = state.tk.lineStrong; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke(); ctx.restore();
  },
};
const refPlugin = {
  id: "coreRef",
  afterDatasetsDraw(chart, _a, opts) {
    if (!opts || !Array.isArray(opts.lines)) return;
    const { ctx, chartArea: a } = chart;
    opts.lines.forEach((l) => {
      const sc = chart.scales[l.axis || "y"];
      if (!sc || l.value == null || !isFinite(l.value)) return;
      const p = sc.getPixelForValue(l.value);
      const vertical = sc.axis === "x";
      if (vertical ? (p < a.left - 1 || p > a.right + 1) : (p < a.top - 1 || p > a.bottom + 1)) return;
      ctx.save();
      ctx.strokeStyle = l.color || state.tk.ink3; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath();
      if (vertical) { ctx.moveTo(p, a.top); ctx.lineTo(p, a.bottom); } else { ctx.moveTo(a.left, p); ctx.lineTo(a.right, p); }
      ctx.stroke(); ctx.setLineDash([]);
      if (l.label) {
        ctx.font = "600 11px 'Instrument Sans', system-ui, sans-serif";
        const w = ctx.measureText(l.label).width + 12;
        const x = vertical ? Math.min(p + 4, a.right - w) : a.right - w;
        const y = vertical ? a.top : p - 20;
        ctx.fillStyle = state.tk.surface; ctx.globalAlpha = 0.92;
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, 18, 5) : ctx.rect(x, y, w, 18); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = state.tk.ink2; ctx.textBaseline = "middle";
        ctx.fillText(l.label, x + 6, y + 9);
      }
      ctx.restore();
    });
  },
};
const centerPlugin = {
  id: "coreCenter",
  afterDraw(chart, _a, opts) {
    if (!opts || !opts.title) return;
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data || !meta.data[0]) return;
    const { x, y } = meta.data[0];
    const ctx = chart.ctx;
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = state.tk.ink; ctx.font = "700 19px 'Bricolage Grotesque', system-ui, sans-serif";
    ctx.fillText(opts.title, x, y - 8);
    ctx.fillStyle = state.tk.ink3; ctx.font = "500 11px 'Instrument Sans', system-ui, sans-serif";
    ctx.fillText(opts.sub || "", x, y + 13);
    ctx.restore();
  },
};

/* =========================== CHART.JS: FÁBRICAS =========================== */
function setupChartDefaults() {
  Chart.register(ChartDataLabels, bgPlugin, crossPlugin, refPlugin, centerPlugin);
  Chart.defaults.font.family = "'Instrument Sans', system-ui, sans-serif";
  Chart.defaults.font.size = 11.5;
  Chart.defaults.plugins.datalabels.display = false;
  Chart.defaults.plugins.legend.display = false;
  if (REDUCED) Chart.defaults.animation = false;
}

function tooltipCfg(t) {
  return {
    backgroundColor: t.surface, titleColor: t.ink, bodyColor: t.ink2, footerColor: t.ink,
    borderColor: t.lineStrong, borderWidth: 1, padding: 12, cornerRadius: 10, caretSize: 6,
    titleFont: { weight: "700", size: 12.5 }, bodyFont: { size: 12 }, footerFont: { weight: "600", size: 12 },
    boxWidth: 9, boxHeight: 9, boxPadding: 5, usePointStyle: true, displayColors: true,
  };
}
function legendCfg(t, show) {
  return {
    display: !!show, position: "bottom", align: "start",
    labels: { color: t.ink2, usePointStyle: true, pointStyle: "circle", boxWidth: 8, boxHeight: 8, padding: 16, font: { size: 12 } },
  };
}
function baseOptions(t, o = {}) {
  const fmtAxis = o.axisFmt || ((v) => fmt(v));
  const valueAxis = {
    beginAtZero: o.min == null, min: o.min, max: o.max, suggestedMax: o.suggestedMax, suggestedMin: o.suggestedMin, stacked: !!o.stacked,
    grid: { color: t.grid, drawTicks: false }, border: { display: false },
    ticks: { color: t.ink3, padding: 8, maxTicksLimit: 6, callback: (v) => fmtAxis(v) },
    title: o.valueTitle ? { display: true, text: o.valueTitle, color: t.ink3, font: { size: 11 } } : undefined,
  };
  const catAxis = {
    stacked: !!o.stacked, grid: { display: false }, border: { color: t.line },
    ticks: {
      color: t.ink2, padding: 6, autoSkip: !o.horizontal, maxRotation: 0, autoSkipPadding: 12, font: { size: 11.5 },
      callback: o.horizontal ? function (v) { const l = this && this.getLabelForValue ? this.getLabelForValue(v) : v; return trunc(l, o.maxLabel || 30); } : undefined,
    },
  };
  return {
    responsive: true, maintainAspectRatio: false,
    animation: REDUCED ? false : { duration: 650, easing: "easeOutQuart" },
    interaction: { mode: o.mode || "index", intersect: false, axis: o.horizontal ? "y" : "x" },
    indexAxis: o.horizontal ? "y" : "x",
    layout: { padding: { top: o.padTop ?? 10, right: o.padRight ?? 8, left: 0, bottom: 0 } },
    scales: o.horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
    plugins: { legend: legendCfg(t, o.legend), tooltip: tooltipCfg(t), datalabels: { display: false } },
  };
}

// Atenúa lo que no está bajo el cursor (enfoque visual)
const focusColor = (c, by = "index") => (ctx) => {
  const base = Array.isArray(c) ? c[ctx.dataIndex % c.length] : c;
  const f = ctx.chart.$focus;
  if (!f) return base;
  const hit = by === "dataset" ? ctx.datasetIndex === f.ds : by === "cell" ? (ctx.datasetIndex === f.ds && ctx.dataIndex === f.i) : ctx.dataIndex === f.i;
  return hit ? base : rgba(base, 0.28);
};
function barDs(t, label, data, color, o = {}) {
  return {
    label, data,
    backgroundColor: focusColor(color, o.by || "index"),
    hoverBackgroundColor: Array.isArray(color) ? color : color,
    borderRadius: o.stacked ? 3 : 5,
    borderSkipped: o.stacked ? false : "start",
    borderWidth: o.stacked ? 1 : 0,
    borderColor: t.surface,
    maxBarThickness: o.thick || 40,
    barPercentage: 0.78, categoryPercentage: 0.82,
    order: o.order || 1,
  };
}
function lineDs(t, label, data, color, o = {}) {
  return {
    label, data,
    borderColor: color, borderWidth: 2, tension: 0.35,
    borderDash: o.dashed ? [6, 5] : [],
    fill: o.fill ? "origin" : false,
    backgroundColor: o.fill
      ? (ctx) => {
          const { chart } = ctx; const a = chart.chartArea;
          if (!a) return rgba(color, 0.1);
          const g = chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
          g.addColorStop(0, rgba(color, 0.24)); g.addColorStop(1, rgba(color, 0));
          return g;
        }
      : color,
    pointStyle: o.dashed ? "line" : "circle",
    pointRadius: o.dashed ? 0 : 4, pointHoverRadius: o.dashed ? 0 : 7, pointHitRadius: 16,
    pointBackgroundColor: t.surface, pointBorderColor: color, pointBorderWidth: 2,
    pointHoverBackgroundColor: color, pointHoverBorderColor: t.surface, pointHoverBorderWidth: 3,
    spanGaps: true,
  };
}
const endLabels = (t, formatter) => ({
  display: (ctx) => ctx.dataset.data[ctx.dataIndex] != null,
  anchor: "end", align: "end", offset: 4, clamp: true,
  color: t.ink2, font: { weight: "600", size: 11 }, formatter,
});

/* =========================== INFO (botón "i") =========================== */
const INFO = {};
const txt = (x) => (typeof x === "function" ? x(DS()) : x);

/* =========================== CONSTRUCTORES DE GRÁFICOS =========================== */
// Ranking horizontal (un valor por categoría)
function ranking(d, t, o) {
  const all = o.list;
  const L = all.slice(0, o.top || CONFIG.TOP_N);
  const color = o.color || t.series[0];
  const colors = o.colorFn ? L.map((x) => o.colorFn(x)) : color;
  const lbl = (x) => (o.labelFn ? o.labelFn(x) : x.label);
  const cond = (x) => (x._otros ? null : o.condFn ? o.condFn(x) : [{ dim: o.dim, value: x.label, label: o.labelFn ? lbl(x) : undefined }]);
  return {
    empty: !L.length || (o.emptyIf && o.emptyIf(L)),
    emptyMsg: o.emptyMsg,
    sub: all.length > L.length ? `Top ${L.length} de ${fmt(all.length)}` : "",
    config: {
      type: "bar",
      data: { labels: L.map(lbl), datasets: [barDs(t, o.name, L.map((x) => x[o.key]), colors, { thick: 22 })] },
      options: merge(baseOptions(t, { horizontal: true, axisFmt: o.axisFmt || ((v) => fmtC(v)), padRight: 74, padTop: o.ref ? 22 : 10, mode: "nearest", maxLabel: o.maxLabel || 30, min: o.min, max: o.max }), {
        layout: o.padLeft ? { padding: { left: o.padLeft } } : {},
        plugins: {
          coreRef: o.ref ? { lines: [{ axis: "x", value: o.ref.value, label: o.ref.label }] } : undefined,
          datalabels: endLabels(t, o.endFmt || ((v) => fmtC(v))),
          tooltip: { callbacks: {
            title: (items) => (o.titleFn ? o.titleFn(L[items[0].dataIndex]) : L[items[0].dataIndex].label),
            label: (c) => ` ${o.name}: ${o.fmtV(c.parsed ? c.parsed.x : null)}`,
            afterLabel: (c) => (o.extra ? o.extra(L[c.dataIndex]) : []),
          } },
        },
      }),
    },
    table: {
      head: [{ t: o.colName || dimLabel(o.dim) }, ...o.cols.map((c) => ({ t: c[0], num: 1 }))],
      rows: all.map((x) => [o.labelFn ? cell(x.label, () => (o.titleFn ? o.titleFn(x) : lbl(x))) : x.label, ...o.cols.map((c) => cell(x[c[1]], c[2]))]),
      conds: all.map(cond),
      searchable: all.length > 20, pageSize: 25,
    },
    drill: (e) => { const x = L[e.index]; return x && cond(x); },
  };
}

// Barras agrupadas (dos o más series por categoría)
function grouped(d, t, o) {
  const all = o.list;
  const L = all.slice(0, o.top || 12);
  const lbl = (x) => (o.labelFn ? o.labelFn(x) : x.label);
  const cond = (x) => (x._otros ? null : o.condFn ? o.condFn(x) : [{ dim: o.dim, value: x.label }]);
  const h = !!o.horizontal;
  return {
    empty: !L.length,
    emptyMsg: o.emptyMsg,
    sub: all.length > L.length ? `Top ${L.length} de ${fmt(all.length)}` : "",
    config: {
      type: "bar",
      data: { labels: L.map(lbl), datasets: o.series.map((s) => barDs(t, s.name, L.map((x) => x[s.key]), s.color, { thick: h ? 13 : 30, stacked: o.stacked })) },
      options: merge(baseOptions(t, { horizontal: h, legend: true, stacked: o.stacked, axisFmt: o.axisFmt || fmtSC, mode: "index", maxLabel: o.maxLabel || 28, min: o.min, max: o.max, suggestedMax: o.suggestedMax, padTop: o.refs ? 24 : 10 }), {
        plugins: { coreRef: o.refs ? { lines: o.refs } : undefined, tooltip: { callbacks: {
          title: (items) => (o.titleFn ? o.titleFn(L[items[0].dataIndex]) : L[items[0].dataIndex].label),
          label: (c) => ` ${c.dataset.label}: ${o.fmtV(c.parsed ? (h ? c.parsed.x : c.parsed.y) : null)}`,
          footer: (items) => (o.extra ? o.extra(L[items[0].dataIndex]) : []),
        } } },
      }),
    },
    table: {
      head: [{ t: o.colName || dimLabel(o.dim) }, ...o.cols.map((c) => ({ t: c[0], num: 1 }))],
      rows: all.map((x) => [o.labelFn ? cell(x.label, () => lbl(x)) : x.label, ...o.cols.map((c) => cell(x[c[1]], c[2]))]),
      conds: all.map(cond), searchable: all.length > 20, pageSize: 25,
    },
    drill: (e) => { const x = L[e.index]; return x && cond(x); },
  };
}

// Anillo con leyenda directa (valor y %)
function donut(d, t, o) {
  const L = o.list.filter((x) => x[o.key] > 0);
  const total = L.reduce((a, x) => a + x[o.key], 0) || 1;
  const colors = L.map((x, i) => (o.colorFn ? o.colorFn(x, i) : colorOf(o.dim, x.label, t)));
  const cond = (x) => (x._otros ? null : o.condFn ? o.condFn(x) : [{ dim: o.dim, value: x.label }]);
  return {
    empty: !L.length, emptyMsg: o.emptyMsg,
    config: {
      type: "doughnut",
      data: { labels: L.map((x) => x.label), datasets: [{ data: L.map((x) => x[o.key]), backgroundColor: focusColor(colors), hoverBackgroundColor: colors, borderColor: t.surface, borderWidth: 3, hoverOffset: 10, borderRadius: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "70%",
        animation: REDUCED ? false : { animateRotate: true, duration: 750, easing: "easeOutQuart" },
        layout: { padding: 10 },
        plugins: {
          legend: { display: false },
          tooltip: merge(tooltipCfg(t), { callbacks: { label: (c) => ` ${c.label}: ${o.fmtV(c.parsed)} (${fmtPct((c.parsed / total) * 100)})`, afterLabel: (c) => (o.extra ? o.extra(L[c.dataIndex]) : []) } }),
          coreCenter: o.center ? o.center(total) : undefined,
          datalabels: { display: false },
        },
      },
    },
    legend: L.map((x, i) => ({ label: x.label, full: x.label, color: colors[i], value: o.legendFmt ? o.legendFmt(x[o.key]) : o.fmtV(x[o.key]), pct: (x[o.key] / total) * 100, index: i })),
    table: {
      head: [{ t: o.colName || dimLabel(o.dim) }, { t: o.name, num: 1 }, { t: "%", num: 1 }, ...(o.cols || []).map((c) => ({ t: c[0], num: 1 }))],
      rows: L.map((x) => [x.label, cell(x[o.key], o.fmtV), cell((x[o.key] / total) * 100, fmtPct), ...(o.cols || []).map((c) => cell(x[c[1]], c[2]))]),
      conds: L.map(cond),
    },
    drill: (e) => { const x = L[e.index]; return x && cond(x); },
  };
}

// Puente (cascada): del saldo inicial al final
function puente(t, steps, o = {}) {
  let acc = 0;
  const data = [], colors = [];
  steps.forEach((s) => {
    if (s.kind === "total") { data.push([0, s.value]); acc = s.value; colors.push(s.color || t.stock); }
    else if (s.kind === "up") { data.push([acc, acc + s.value]); acc += s.value; colors.push(t.ing); }
    else if (s.kind === "down") { data.push([acc - s.value, acc]); acc -= s.value; colors.push(t.egr); }
    else { data.push([Math.min(acc, acc + s.value), Math.max(acc, acc + s.value)]); acc += s.value; colors.push(t.neutral); }
  });
  const fv = (s) => (s.kind === "total" ? fmtSC(s.value) : (s.kind === "down" ? "−" : s.value >= 0 ? "+" : "−") + fmtSC(Math.abs(s.value)));
  return {
    empty: steps.every((s) => !s.value),
    config: {
      type: "bar",
      data: { labels: steps.map((s) => s.label), datasets: [barDs(t, "Importe", data, colors, { thick: 70 })] },
      options: merge(baseOptions(t, { axisFmt: fmtSC, padTop: 26, mode: "nearest" }), {
        plugins: {
          datalabels: { display: true, anchor: "end", align: "end", offset: 2, clamp: true, color: t.ink2, font: { weight: "650", size: 11.5 }, formatter: (_v, c) => fv(steps[c.dataIndex]) },
          tooltip: { callbacks: { label: (c) => { const s = steps[c.dataIndex]; return ` ${s.label}: ${s.kind === "down" ? "−" : ""}${fmt(Math.abs(s.value), 2)}`; }, afterLabel: (c) => steps[c.dataIndex].note || "" } },
        },
      }),
    },
    table: {
      head: [{ t: "Concepto" }, { t: "Importe (S/)", num: 1 }, { t: "Acumulado (S/)", num: 1 }],
      rows: steps.map((s, i) => [s.label, cell(s.kind === "down" ? -s.value : s.value, nOpt(2)), cell(data[i][s.kind === "down" ? 0 : 1], nOpt(2))]),
    },
  };
}

// Histograma por rangos
function histo(t, o) {
  const total = o.bins.reduce((a, b) => a + b.n, 0) || 1;
  return {
    empty: !o.bins.some((b) => b.n), emptyMsg: o.emptyMsg,
    config: {
      type: "bar",
      data: { labels: o.bins.map((b) => b.label), datasets: [barDs(t, o.name, o.bins.map((b) => b.n), o.bins.map((b) => b.color || o.color || t.series[0]), { thick: 56 })] },
      options: merge(baseOptions(t, { axisFmt: (v) => fmt(v), padTop: 22, mode: "nearest" }), {
        plugins: { datalabels: endLabels(t, (v) => fmt(v)), tooltip: { callbacks: { label: (c) => ` ${fmt(c.parsed.y)} ${o.unit} (${fmtPct((c.parsed.y / total) * 100)})` } } },
      }),
    },
    table: {
      head: [{ t: o.colName || "Rango" }, { t: o.name, num: 1 }, { t: "%", num: 1 }],
      rows: o.bins.map((b) => [b.label, cell(b.n, fmt), cell((b.n / total) * 100, fmtPct)]),
      conds: o.bins.map((b) => (b.n ? [{ dim: o.dim, value: b.label, label: `${o.colName || "Rango"}: ${b.label}` }] : null)),
    },
    drill: (e) => { const b = o.bins[e.index]; return b && b.n && [{ dim: o.dim, value: b.label, label: `${o.colName || "Rango"}: ${b.label}` }]; },
  };
}
const RANGOS_LT = [["0–7 días", 7], ["8–15 días", 15], ["16–30 días", 30], ["31–60 días", 60], ["61–90 días", 90], ["Más de 90 días", Infinity]];
const rangoDe = (v) => (v == null ? "" : RANGOS_LT.find((x) => v <= x[1])[0]);
const binsDe = (rows, key) => { const c = new Map(RANGOS_LT.map((x) => [x[0], 0])); rows.forEach((r) => { if (r[key]) c.set(r[key], c.get(r[key]) + 1); }); return RANGOS_LT.map(([label]) => ({ label, n: c.get(label) })); };

const mesDrill = (P) => (e) => { const p = P[e.index]; return p && [{ dim: "mesKey", value: p.key, label: p.label }]; };
const recLabel = (x) => trunc(x.nombre || x.label, 34);
const recTitle = (x) => `${x.nombre}${x.codigo && x.codigo !== x.nombre ? " · " + x.codigo : ""}`;
const recCond = (x) => [{ dim: "codigo", value: x.label, label: x.nombre }];
const varPct = (a, b) => (b ? ((a - b) / Math.abs(b)) * 100 : null);
const tipoLabel = (x) => (x.desc ? `${x.label} · ${trunc(x.desc, 26)}` : x.label);
const dirColor = (t) => (x) => (x.nIng >= x.nEgr ? t.ing : t.egr);


/* =========================== CONSTRUCTOR: COLUMNAS CON META =========================== */
// Una barra vertical por categoría (equipo) con línea de meta / óptimo
function columnas(d, t, o) {
  const L = o.list.filter((x) => o.val(x) != null);
  const lbl = (x) => (o.labelFn ? o.labelFn(x) : x.label);
  const cond = (x) => (o.condFn ? o.condFn(x) : [{ dim: o.dim, value: x.label }]);
  const colors = L.map((x) => (o.colorFn ? o.colorFn(x) : o.color || t.series[0]));
  return {
    empty: !L.length, emptyMsg: o.emptyMsg,
    sub: o.subFn ? o.subFn(L) : "",
    config: {
      type: "bar",
      data: { labels: L.map(lbl), datasets: [barDs(t, o.name, L.map(o.val), colors, { thick: 44 })] },
      options: merge(baseOptions(t, { axisFmt: o.axisFmt || ((v) => fmt(v)), padTop: 26, mode: "nearest", min: o.min, max: o.max, suggestedMax: o.suggestedMax }), {
        plugins: {
          coreRef: o.refs ? { lines: o.refs } : undefined,
          datalabels: endLabels(t, o.endFmt || ((v) => fmt(v, 1))),
          tooltip: { callbacks: { title: (it) => (o.titleFn ? o.titleFn(L[it[0].dataIndex]) : lbl(L[it[0].dataIndex])), label: (c) => ` ${o.name}: ${o.fmtV(c.parsed ? c.parsed.y : null)}`, afterLabel: (c) => (o.extra ? o.extra(L[c.dataIndex]) : []) } },
        },
      }),
    },
    table: {
      head: [{ t: o.colName || dimLabel(o.dim) }, ...o.cols.map((c) => ({ t: c[0], num: 1 }))],
      rows: o.list.map((x) => [lbl(x), ...o.cols.map((c) => cell(typeof c[1] === "function" ? c[1](x) : x[c[1]], c[2]))]),
      conds: o.list.map(cond),
    },
    drill: (e) => { const x = L[e.index]; return x && cond(x); },
  };
}
// Agrupa filas en series apiladas (p. ej. horas por mes y tipo)
function apilar(items, rowsOf, dim, valFn, top = 5) {
  const tot = new Map();
  items.forEach((x) => rowsOf(x).forEach((r) => tot.set(r[dim], (tot.get(r[dim]) || 0) + valFn(r))));
  const orden = [...tot.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const keep = orden.slice(0, top), otros = orden.length > top;
  items.forEach((x) => {
    keep.forEach((k) => { x["s_" + k] = 0; });
    if (otros) x["s_Otros"] = 0;
    rowsOf(x).forEach((r) => { const k = keep.includes(r[dim]) ? r[dim] : "Otros"; x["s_" + k] = (x["s_" + k] || 0) + valFn(r); });
  });
  return otros ? [...keep, "Otros"] : keep;
}
const eqCond = (x) => [{ dim: "equipo", value: x.equipo || x.label }];
const okColor = (t, ok) => (ok ? t.series[0] : t.series[1]);

/* =========================== CONSTRUCTORES PROPIOS =========================== */
// Líneas sobre una lista de períodos (días, semanas…)
function lineas(d, t, o) {
  const L = o.list;
  const lbl = (x) => (o.labelFn ? o.labelFn(x) : x.label);
  const tl = o.tableLabelFn || lbl;
  const cond = (x) => (o.condFn ? o.condFn(x) : null);
  const datasets = o.series.map((s) => lineDs(t, s.name, L.map((x) => x[s.key]), s.color, { fill: s.fill, dashed: s.dashed }));
  if (L.length > 45) datasets.forEach((ds) => { ds.pointRadius = 0; ds.pointHoverRadius = 5; });
  return {
    empty: !L.length, emptyMsg: o.emptyMsg, sub: o.subFn ? o.subFn(L) : "",
    config: {
      type: "line",
      data: { labels: L.map(lbl), datasets },
      options: merge(baseOptions(t, { axisFmt: o.axisFmt || ((v) => fmt(v)), padTop: 24, legend: o.series.length > 1, mode: "index", min: o.min, max: o.max, suggestedMax: o.suggestedMax }), {
        plugins: {
          coreCross: { enabled: true },
          coreRef: o.refs ? { lines: o.refs } : undefined,
          tooltip: { callbacks: {
            title: (it) => (o.titleFn ? o.titleFn(L[it[0].dataIndex]) : lbl(L[it[0].dataIndex])),
            label: (c) => ` ${c.dataset.label}: ${o.fmtV(c.parsed ? c.parsed.y : null)}`,
            footer: (items) => (o.extra && items.length ? o.extra(L[items[0].dataIndex]) : []),
          } },
        },
      }),
    },
    table: {
      head: [{ t: o.colName }, ...o.cols.map((c) => ({ t: c[0], num: 1 }))],
      rows: L.map((x) => [tl(x), ...o.cols.map((c) => cell(x[c[1]], c[2]))]),
      conds: L.map(cond), searchable: L.length > 20, pageSize: 25,
    },
    drill: (e) => { const x = L[e.index]; return x && cond(x); },
  };
}

/* ---------- Ayudas ---------- */
const fP1 = (v) => (v == null ? "—" : fmt(v, 1) + " %");
const fN = (v) => (v == null ? "—" : fmt(v) + (v === 1 ? " persona" : " personas"));
const fPP = (v) => (v == null ? "—" : (v >= 0 ? "+" : "−") + fmt(Math.abs(v), 1) + " pp");
const fD = (v) => (v == null ? "—" : (v >= 0 ? "+" : "−") + fmt(Math.abs(v)));
const condDia = (x) => [{ dim: "fecha", value: x.fecha, label: fmtDiaLargo(x.fecha) }];
const cAsis = (t) => t.series[2], cNo = (t) => t.series[4];
const extraAsis = (x) => [`Convocados ${fmt(x.conv)} · asistieron ${fmt(x.asis)} (${fP1(x.pctAsis)})`];
const colsAsis = [["Convocados", "conv", fmt], ["Asistentes", "asis", fmt], ["No asistieron", "noAsis", fmt], ["% asistencia", "pctAsis", pOpt]];
const serAsis = (t) => [{ key: "asis", name: "Asistieron", color: cAsis(t) }, { key: "noAsis", name: "No asistieron", color: cNo(t) }];
const stackBy = (d, t, list, dim, apDim, o) => {
  const ks = apilar(list, (x) => x._rows.filter((r) => r._dni && r._asis), apDim, () => 1, 6);
  return grouped(d, t, { list, dim, fmtV: fN, axisFmt: (v) => fmt(v), top: o.top || 10, stacked: true, condFn: o.condFn, colName: o.colName,
    series: ks.map((k, i) => ({ key: "s_" + k, name: k, color: colorOf(apDim, k, t) })), extra: extraAsis, cols: colsAsis });
};

/* =========================== BIBLIOTECA DE GRÁFICOS =========================== */
const INFO_CONT = "Todo se cuenta por trabajador (DNI distinto): si una persona aparece en varias filas cuenta una vez, y se considera que asistió si alguna fila dice ASISTIO. Cualquier otra observación, o vacío, cuenta como no asistió.";
const CHARTLIB = {
  dcDia: {
    size: "lg", focus: false,
    title: "Convocados y asistentes por día", sub: "Trabajadores distintos por fecha de Día Cero",
    info: { what: "Cuántas personas se convocaron cada día y cuántas asistieron.", how: INFO_CONT + " Cada punto es un día (columna DIA).", tip: "Clic en un punto para ver el detalle de ese día." },
    build: (d, t) => lineas(d, t, { list: d.dias, colName: "Día", labelFn: (x) => fmtDia(x.fecha), tableLabelFn: (x) => diaCorto(x.fecha) + "/" + x.fecha.slice(2, 4), titleFn: (x) => fmtDiaLargo(x.fecha), fmtV: fN, axisFmt: (v) => fmt(v),
      series: [{ name: "Convocados", key: "conv", color: t.series[0] }, { name: "Asistentes", key: "asis", color: cAsis(t), fill: true }], condFn: condDia,
      extra: (x) => [`% asistencia ${fP1(x.pctAsis)}`, `Vs. día anterior: ${fD(x.dAsis)} asistentes`], cols: [["Convocados", "conv", fmt], ["Asistentes", "asis", fmt], ["% asistencia", "pctAsis", pOpt], ["Var. asistentes", "dAsis", (v) => fD(v)]], emptyMsg: "No hay registros con día en vista." }),
  },
  dcPctDia: {
    size: "md", focus: true,
    title: "% de asistencia por día", sub: () => `Línea punteada: meta referencial ${CONFIG.META_ASIS} %`,
    info: { what: "Qué porcentaje de los convocados de cada día asistió.", how: INFO_CONT + " % asistencia = asistentes ÷ convocados del día × 100. La meta es referencial y se edita en CONFIG.META_ASIS." },
    build: (d, t) => lineas(d, t, { list: d.dias.filter((x) => x.pctAsis != null), colName: "Día", labelFn: (x) => fmtDia(x.fecha), tableLabelFn: (x) => diaCorto(x.fecha) + "/" + x.fecha.slice(2, 4), titleFn: (x) => fmtDiaLargo(x.fecha), fmtV: fP1, axisFmt: (v) => v + " %",
      series: [{ name: "% asistencia", key: "pctAsis", color: t.series[1] }], suggestedMax: 100, refs: [{ axis: "y", value: CONFIG.META_ASIS, label: `Meta ${CONFIG.META_ASIS} %` }], condFn: condDia,
      extra: (x) => [`${fmt(x.asis)} de ${fmt(x.conv)} convocados`, `Variación: ${fPP(x.dPct)}`], cols: [["% asistencia", "pctAsis", pOpt], ["Variación pp", "dPct", pOpt], ["Convocados", "conv", fmt]] }),
  },
  dcTipo: {
    size: "donut", focus: true,
    title: "Trabajadores por tipo de personal", sub: "% de trabajadores únicos",
    info: { what: "Cómo se reparte el personal convocado entre interno, tercero, eventual u otros tipos.", how: "Trabajadores distintos (DNI) por Tipo_Personal. Los tipos salen de los datos." },
    build: (d, t) => donut(d, t, { list: d.tipos, key: "conv", name: "Trabajadores", dim: "tipo", fmtV: fN, condFn: condDim("tipo"), extra: (x) => [`% asistencia ${fP1(x.pctAsis)}`], center: () => ({ title: fmt(d.k.conv), sub: "trabajadores" }), cols: [["Trabajadores", "conv", fmt], ["Asistentes", "asis", fmt], ["% asistencia", "pctAsis", pOpt]] }),
  },
  dcObs: {
    size: "donut", focus: true,
    title: "Estados de la observación", sub: "% de registros por Observacion",
    info: { what: "Cuántos registros hay por cada estado: asistió, no asistió, virtual, vacío, etc.", how: "Conteo de filas por la columna Observacion (los vacíos aparecen como «Sin observación»).", tip: "Clic en un estado para filtrar el tablero." },
    build: (d, t) => donut(d, t, { list: d.obs, key: "n", name: "Registros", dim: "obs", fmtV: fmt, condFn: condDim("obs"), center: () => ({ title: fmt(d.k.n), sub: "registros" }), cols: [["Registros", "n", fmt], ["Trabajadores", "conv", fmt]] }),
  },
  dcSede: {
    size: "md", focus: true,
    title: "Asistencia por sede base", sub: "Trabajadores que asistieron y no asistieron",
    info: { what: "Cuántos convocados asistieron en cada sede y cuántos no.", how: INFO_CONT, tip: "El tooltip trae el % de asistencia de la sede." },
    build: (d, t) => grouped(d, t, { list: d.sedes, dim: "sede", fmtV: fN, axisFmt: (v) => fmt(v), top: 10, stacked: true, series: serAsis(t), condFn: condDim("sede"), colName: "Sede base", extra: extraAsis, cols: colsAsis }),
  },
  dcTipoAsis: {
    size: "md", focus: true,
    title: "% de asistencia por tipo de personal", sub: "Asistentes ÷ convocados de cada tipo",
    info: { what: "Qué tipo de personal asiste más.", how: "% = trabajadores que asistieron ÷ trabajadores convocados de ese tipo × 100." },
    build: (d, t) => columnas(d, t, { list: d.tipos, dim: "tipo", name: "% asistencia", val: (x) => x.pctAsis, fmtV: fP1, axisFmt: (v) => v + " %", endFmt: (v) => fmt(v, 0) + " %", min: 0, suggestedMax: 100, color: t.series[1], colName: "Tipo", condFn: condDim("tipo"), extra: extraAsis, cols: colsAsis }),
  },
  dcCliente: {
    size: "lg", focus: true,
    title: "Asistencia por cliente", sub: "Asistieron y no asistieron · ordenado por convocados",
    info: { what: "Cuántos trabajadores se convocaron por cliente y cuántos asistieron.", how: INFO_CONT },
    build: (d, t) => grouped(d, t, { list: d.clientes, dim: "cliente", fmtV: fN, axisFmt: (v) => fmt(v), top: 12, stacked: true, series: serAsis(t), condFn: condDim("cliente"), colName: "Cliente", extra: extraAsis, cols: colsAsis }),
  },
  dcGerencia: {
    size: "lg", focus: true,
    title: "Asistentes por gerencia", sub: "Trabajadores que asistieron",
    info: { what: "Qué gerencias aportan más asistentes.", how: INFO_CONT },
    build: (d, t) => ranking(d, t, { list: d.gerencias, dim: "gerencia", key: "asis", name: "Asistentes", fmtV: fN, endFmt: (v) => fmt(v), color: t.series[0], colName: "Gerencia", condFn: condDim("gerencia"), top: 10, extra: extraAsis, cols: colsAsis }),
  },
  dcCargo: {
    size: "lg", focus: true,
    title: "Asistentes por cargo o puesto", sub: () => `Los ${CONFIG.TOP_N} cargos con más asistentes`,
    info: { what: "Qué cargos o puestos asisten más al Día Cero.", how: INFO_CONT + " Los cargos salen de los datos.", tip: "Usa «Más filtros» → Cargo para filtrar el tablero." },
    build: (d, t) => ranking(d, t, { list: d.cargos, dim: "cargo", key: "asis", name: "Asistentes", fmtV: fN, endFmt: (v) => fmt(v), color: t.series[6], colName: "Cargo / puesto", condFn: condDim("cargo"), top: CONFIG.TOP_N, extra: extraAsis, cols: colsAsis }),
  },
  dcResp: {
    size: "md", focus: true,
    title: "Asistentes por responsable HSE", sub: "Quién conduce cada Día Cero",
    info: { what: "Cuántos asistentes tuvo cada responsable HSE.", how: INFO_CONT },
    build: (d, t) => ranking(d, t, { list: d.resps, dim: "resp", key: "asis", name: "Asistentes", fmtV: fN, endFmt: (v) => fmt(v), color: t.series[3], colName: "Responsable HSE", condFn: condDim("resp"), top: 10, extra: extraAsis, cols: colsAsis }),
  },
  dcLugar: {
    size: "md", focus: true,
    title: "Asistentes por lugar de Día Cero", sub: "Dónde se dictó la inducción",
    info: { what: "En qué lugares se concentra la asistencia.", how: INFO_CONT },
    build: (d, t) => ranking(d, t, { list: d.lugares, dim: "lugar", key: "asis", name: "Asistentes", fmtV: fN, endFmt: (v) => fmt(v), color: t.series[4 - 1], colName: "Lugar", condFn: condDim("lugar"), top: 10, extra: extraAsis, cols: colsAsis }),
  },
  dcSedeCliente: {
    size: "md", focus: true,
    title: "Asistentes por sede y cliente", sub: "Apilado por cliente",
    info: { what: "Qué clientes atiende cada sede base, contando solo asistentes.", how: "Registros con asistencia por sede, apilados por cliente. Los clientes salen de los datos." },
    build: (d, t) => stackBy(d, t, d.sedes, "sede", "cliente", { condFn: condDim("sede"), colName: "Sede base" }),
  },
  dcTipoCliente: {
    size: "md", focus: true,
    title: "Asistentes por tipo de personal y cliente", sub: "Apilado por tipo de personal",
    info: { what: "Qué tipo de personal aporta cada cliente.", how: "Registros con asistencia por cliente, apilados por Tipo_Personal." },
    build: (d, t) => stackBy(d, t, d.clientes, "cliente", "tipo", { condFn: condDim("cliente"), colName: "Cliente" }),
  },
  dcGerSede: {
    size: "lg", focus: true,
    title: "Asistentes por gerencia y sede", sub: "Apilado por sede base",
    info: { what: "En qué sedes asisten las personas de cada gerencia.", how: "Registros con asistencia por gerencia, apilados por Sede_Base." },
    build: (d, t) => stackBy(d, t, d.gerencias, "gerencia", "sede", { condFn: condDim("gerencia"), colName: "Gerencia" }),
  },
  dcCalidad: {
    size: "lg", focus: true,
    title: "Calidad del registro", sub: "% de registros con cada dato completo",
    info: { what: "Qué tan completo está el Excel: qué porcentaje de las filas trae cada dato.", how: "Filas con el dato ÷ filas totales × 100, para DNI, observación, día, lugar y responsable HSE. Los duplicados DNI + día y los trabajadores sin día se ven en la tabla de cumplimiento." },
    build: (d, t) => columnas(d, t, { list: [["DNI", d.k.pDni], ["Observación", d.k.pObs], ["Día Cero (DIA)", d.k.pDia], ["Lugar de Día Cero", d.k.pLugar], ["Responsable HSE", d.k.pResp]].map(([label, p]) => ({ label, p })),
      dim: "calidad", name: "% completo", val: (x) => x.p, fmtV: fP1, axisFmt: (v) => v + " %", endFmt: (v) => fmt(v, 1) + " %", min: 0, suggestedMax: 100, colName: "Dato",
      colorFn: (x) => (x.p == null ? t.neutral : x.p >= 99 ? cAsis(t) : x.p >= 90 ? t.series[3] : cNo(t)), condFn: () => null, extra: () => [`${fmt(d.k.dupExtra)} duplicados DNI + día · ${fmt(d.k.sinDia)} trabajadores sin día`], cols: [["% completo", "p", pOpt]] }),
  },
};

/* =========================== TABLAS =========================== */
const condFila = (r) => [{ dim: "codigo", value: r._id, label: r._nombre }];
const colsAsisT = [
  { t: "Total convocados", num: 1, get: (x) => x.conv, f: fmt }, { t: "Asistentes", num: 1, get: (x) => x.asis, f: fmt }, { t: "No asistentes", num: 1, get: (x) => x.noAsis, f: fmt }, { t: "% asistencia", num: 1, get: (x) => x.pctAsis, f: pOpt },
];
const resumenT = (dim, titulo, sub, info, cols) => ({
  title: titulo, sub, info,
  table: (d) => ({ src: porDim(d.base, dim, "conv"), cols, condFn: condDim(dim), searchable: true, pageSize: 25, defaultSort: { col: 1, dir: "desc" } }),
});
const textoDe = (r, k) => (vacio(r[k]) ? "—" : r[k]);
const joinDistintos = (x, k) => Array.from(new Set(x._rows.map((r) => r[k]).filter((v) => !vacio(v)))).join(", ");
const TLIB = {
  tDetalle: {
    title: "Detalle de Día Cero", sub: "Tabla 1 · una fila por registro · busca por DNI, nombre, cargo o cliente",
    info: { what: "El registro limpio y filtrado: cada persona convocada con su asistencia.", how: "Respeta todos los filtros. Los textos se limpian (espacios y mayúsculas); la fecha es la columna DIA." },
    table: () => ({
      src: state.vista,
      cols: [
        { t: "ITEM", num: 1, get: (r) => r.item, f: nOpt(0) }, { t: "DNI", get: (r) => r.dni }, { t: "Apellidos y nombres", get: (r) => r.nombre }, { t: "Tipo de personal", get: (r) => r.tipo }, { t: "Cargo / puesto", get: (r) => r.cargo },
        { t: "Gerencia", get: (r) => r.gerencia }, { t: "Sede base", get: (r) => r.sede }, { t: "Observación", get: (r) => r.obs }, { t: "Día", get: (r) => r.fecha, f: (v) => (v ? fdia(v) : "—") },
        { t: "Lugar de Día Cero", get: (r) => r.lugar }, { t: "Cliente", get: (r) => r.cliente }, { t: "Responsable HSE", get: (r) => r.resp },
      ],
      condFn: condFila, searchable: true, pageSize: CONFIG.PAGE_SIZE, defaultSort: { col: 0, dir: "asc" },
    }),
  },
  tSede: resumenT("sede", "Resumen por sede base", "Tabla 2 · convocados, asistentes, clientes y lugares",
    { what: "El cumplimiento de cada sede base.", how: "Convocados = DNI distintos. Asistentes = DNI con ASISTIO. % = asistentes ÷ convocados. Clientes y lugares = valores distintos." },
    [{ t: "Sede base", get: (x) => x.label }, ...colsAsisT, { t: "Clientes atendidos", num: 1, get: (x) => x.clientes, f: fmt }, { t: "Lugares de Día Cero", num: 1, get: (x) => x.lugares, f: fmt }]),
  tCliente: resumenT("cliente", "Resumen por cliente", "Tabla 3 · asistencia y alcance por cliente",
    { what: "Cómo cumple cada cliente.", how: "Convocados y asistentes por DNI distinto; sedes, tipos, lugares y responsables = valores distintos." },
    [{ t: "Cliente", get: (x) => x.label }, { t: "Total convocados", num: 1, get: (x) => x.conv, f: fmt }, { t: "Asistentes", num: 1, get: (x) => x.asis, f: fmt }, { t: "% asistencia", num: 1, get: (x) => x.pctAsis, f: pOpt },
      { t: "Sedes base", num: 1, get: (x) => x.sedes, f: fmt }, { t: "Tipos de personal", num: 1, get: (x) => x.tipos, f: fmt }, { t: "Lugares de Día Cero", num: 1, get: (x) => x.lugares, f: fmt }, { t: "Responsables HSE", num: 1, get: (x) => x.resps, f: fmt }]),
  tTipo: {
    title: "Resumen por tipo de personal", sub: "Tabla 4 · trabajadores, asistentes y participación",
    info: { what: "El peso y la asistencia de cada tipo de personal.", how: "% participación = trabajadores del tipo ÷ trabajadores en vista. Sedes y clientes = valores distintos." },
    table: (d) => ({ src: d.tipos,
      cols: [{ t: "Tipo de personal", get: (x) => x.label }, { t: "Total trabajadores", num: 1, get: (x) => x.conv, f: fmt }, { t: "Asistentes", num: 1, get: (x) => x.asis, f: fmt }, { t: "% asistencia", num: 1, get: (x) => x.pctAsis, f: pOpt },
        { t: "% participación", num: 1, get: (x) => pct0(x.conv, d.k.conv), f: pOpt }, { t: "Sedes", num: 1, get: (x) => x.sedes, f: fmt }, { t: "Clientes", num: 1, get: (x) => x.clientes, f: fmt }],
      condFn: condDim("tipo"), searchable: false, pageSize: 25, defaultSort: { col: 1, dir: "desc" } }),
  },
  tGerencia: resumenT("gerencia", "Resumen por gerencia", "Tabla 5 · trabajadores, asistencia, sedes, cargos y clientes",
    { what: "La asistencia de cada gerencia.", how: "Trabajadores y asistentes por DNI distinto; sedes, cargos y clientes = valores distintos." },
    [{ t: "Gerencia", get: (x) => x.label }, { t: "Total trabajadores", num: 1, get: (x) => x.conv, f: fmt }, { t: "Asistentes", num: 1, get: (x) => x.asis, f: fmt }, { t: "% asistencia", num: 1, get: (x) => x.pctAsis, f: pOpt },
      { t: "Sedes", num: 1, get: (x) => x.sedes, f: fmt }, { t: "Cargos", num: 1, get: (x) => x.cargos, f: fmt }, { t: "Clientes", num: 1, get: (x) => x.clientes, f: fmt }]),
  tLugar: {
    title: "Resumen por lugar de Día Cero", sub: "Tabla 6 · lugar y cliente: convocados, asistentes y responsable",
    info: { what: "Cómo le fue a cada lugar de inducción con cada cliente.", how: "Una fila por lugar + cliente. Responsable HSE = el que figura en esas filas (si hay varios, se listan)." },
    table: (d) => ({ src: cruce(d.base, "lugar", "cliente"),
      cols: [{ t: "Lugar de Día Cero", get: (x) => x.a }, { t: "Cliente", get: (x) => x.b }, ...colsAsisT, { t: "Sedes base", num: 1, get: (x) => x.sedes, f: fmt }, { t: "Responsable HSE", get: (x) => joinDistintos(x, "resp") }],
      condFn: condPar("lugar", "cliente"), searchable: true, pageSize: 25, defaultSort: { col: 2, dir: "desc" } }),
  },
  tMatriz: {
    title: "Matriz sede vs cliente", sub: "Tabla 7 · trabajadores, asistencia y participación",
    info: { what: "El cruce de cada sede base con cada cliente.", how: "% participación sede = trabajadores del cruce ÷ trabajadores de esa sede; % participación cliente = ÷ trabajadores de ese cliente." },
    table: (d) => { const ts = {}, tc = {}; porDim(d.base, "sede", "conv").forEach((x) => { ts[x.label] = x.conv; }); porDim(d.base, "cliente", "conv").forEach((x) => { tc[x.label] = x.conv; });
      return { src: cruce(d.base, "sede", "cliente"),
        cols: [{ t: "Sede base", get: (x) => x.a }, { t: "Cliente", get: (x) => x.b }, { t: "Total trabajadores", num: 1, get: (x) => x.conv, f: fmt }, { t: "Asistentes", num: 1, get: (x) => x.asis, f: fmt }, { t: "% asistencia", num: 1, get: (x) => x.pctAsis, f: pOpt },
          { t: "% participación sede", num: 1, get: (x) => pct0(x.conv, ts[x.a]), f: pOpt }, { t: "% participación cliente", num: 1, get: (x) => pct0(x.conv, tc[x.b]), f: pOpt }],
        condFn: condPar("sede", "cliente"), searchable: true, pageSize: 25, defaultSort: { col: 2, dir: "desc" } }; },
  },
  tCumpl: {
    title: "Control de cumplimiento HSE", sub: "Tabla 8 · banderas y estado por persona · busca por DNI o nombre",
    info: { what: "Qué registros requieren seguimiento.", how: "Sin Día Cero = DIA vacío. Sin observación = Observacion vacía. Duplicado = el mismo DNI aparece más de una vez el mismo día. Estado: Alerta (sin DNI, sin día o duplicado) · Pendiente (sin observación o no asistió) · Cumple (asistió, con día y sin duplicado)." },
    table: () => ({ src: state.vista,
      cols: [{ t: "DNI", get: (r) => r.dni }, { t: "Apellidos y nombres", get: (r) => r.nombre }, { t: "Tipo de personal", get: (r) => r.tipo }, { t: "Sede base", get: (r) => r.sede }, { t: "Cliente", get: (r) => r.cliente },
        { t: "Día", get: (r) => r.fecha, f: (v) => (v ? fdia(v) : "—") }, { t: "Observación", get: (r) => r.obs },
        { t: "Sin Día Cero", get: (r) => (r._sinDia ? "Sí" : "No") }, { t: "Sin observación", get: (r) => (r._sinObs ? "Sí" : "No") }, { t: "Duplicado", get: (r) => (r._dup ? "Sí" : "No") }, { t: "Estado", get: (r) => r._estado }],
      condFn: condFila, searchable: true, pageSize: CONFIG.PAGE_SIZE, defaultSort: { col: 10, dir: "asc" } }),
  },
};

/* =========================== KPIs =========================== */
const estadoMeta = (ok, txtOk, txtMal, malo = "warn") => (ok ? ["good", "fa-circle-check", txtOk] : [malo, "fa-circle-exclamation", txtMal]);
const KLIB = {
  dcAsis: { label: "% de asistencia a Día Cero", icon: "fa-user-check", slot: 2, val: (k) => k.pctAsis, f: (v) => (v == null ? "—" : fmt(v, 1)), unit: "%", delta: "pp", better: "up", bar: (k) => k.pctAsis || 0,
    sub: (k) => `<b>${fmt(k.asis)}</b> asistentes de <b>${fmt(k.conv)}</b> convocados`,
    status: (v) => (v == null ? null : estadoMeta(v >= CONFIG.META_ASIS, `En la meta referencial (${CONFIG.META_ASIS} %)`, `${fmt(CONFIG.META_ASIS - v, 1)} pp bajo la meta referencial (${CONFIG.META_ASIS} %)`)),
    info: { what: "Qué porcentaje de las personas convocadas asistió a la inducción de Día Cero.", how: "Asistentes (DNI con Observacion = ASISTIO) ÷ trabajadores convocados (DNI distintos) × 100. La flecha compara el último mes con el anterior; la meta es referencial (CONFIG.META_ASIS)." } },
  dcUnicos: { nodelta: true, label: "Total de trabajadores únicos", icon: "fa-users", slot: 0, val: (k) => k.conv, f: fmt, unit: "",
    sub: (k, d) => d.tipos.length ? d.tipos.map((x) => `${esc(x.label)} <b>${fmt(x.conv)}</b>`).join(" · ") : "Sin datos",
    info: { what: "Cuántas personas distintas hay en el registro y cómo se reparten por tipo de personal.", how: "Conteo de DNI distintos. Debajo ves el desglose por Tipo_Personal (los tipos salen de los datos)." } },
  dcCobertura: { label: "% de cobertura de Día Cero", icon: "fa-shield-halved", slot: 6, val: (k) => k.pctCob, f: (v) => (v == null ? "—" : fmt(v, 1)), unit: "%", delta: "pp", better: "up", bar: (k) => k.pctCob || 0,
    sub: (k) => `<b>${fmt(k.conDia)}</b> con Día Cero registrado · <b>${fmt(k.sinDia)}</b> sin día`,
    status: (v) => (v == null ? null : estadoMeta(v >= 100, "Todos tienen Día Cero registrado", "Hay trabajadores sin Día Cero registrado")),
    info: { what: "Qué parte de los trabajadores tiene una fecha de Día Cero registrada.", how: "Trabajadores con la columna DIA llena ÷ trabajadores totales × 100." } },
  dcClientes: { nodelta: true, label: "Clientes atendidos", icon: "fa-building", slot: 1, val: (k) => k.clientes, f: fmt, unit: "",
    sub: (k) => `<b>${fmt(k.sedes)}</b> sede${k.sedes === 1 ? "" : "s"} base activa${k.sedes === 1 ? "" : "s"} · <b>${fmt(k.lugares)}</b> lugar${k.lugares === 1 ? "" : "es"}`,
    info: { what: "Cuántos clientes tuvieron personal en el Día Cero y en cuántas sedes base.", how: "Valores distintos de CLIENTE y de Sede_Base con los filtros actuales." } },
  dcSinDia: { nodelta: true, label: "Trabajadores sin Día Cero", icon: "fa-triangle-exclamation", slot: 4,
  val: (k) => k.sinDia + k.noAsis, f: fmt, unit: "",
  sub: (k) => `<b>${fmt(k.noAsis)}</b> no asistieron · <b>${fmt(k.sinDia)}</b> sin día registrado`,
  status: (v) => (v == null ? null : estadoMeta(v === 0, "Todos tienen Día Cero", `${fmt(v)} por programar o regularizar`)),
  info: { what: "Personas que aún no tienen su Día Cero cumplido.", how: "Trabajadores (DNI distintos) que no asistieron, más los que no tienen fecha DIA. Quien no asistió cuenta como sin Día Cero." } },
};

/* =========================== HALLAZGOS =========================== */
function hallazgosDC(d) {
  const k = d.k, L = [];
  if (!k.n) return L;
  L.push({ icon: "fa-users", tone: "brand", html: `Hay <b>${fmt(k.conv)}</b> trabajadores convocados en <b>${fmt(d.dias.length)}</b> día${d.dias.length === 1 ? "" : "s"} de Día Cero; asistieron <b>${fmt(k.asis)}</b> (<b>${fP1(k.pctAsis)}</b>).` });
  if (k.noAsis) { const g = d.sedes.filter((x) => x.noAsis > 0).sort((a, b) => b.noAsis - a.noAsis)[0]; L.push({ icon: "fa-user-xmark", tone: "warn", html: `<b>${fmt(k.noAsis)}</b> trabajadores no asistieron${g ? `; la mayoría es de <b>${esc(g.label)}</b>` : ""}.`, cond: g ? condDim("sede")(g) : null }); }
  const S = d.sedes.filter((x) => x.conv >= 5 && x.pctAsis != null).sort((a, b) => a.pctAsis - b.pctAsis);
  if (S.length > 1) L.push({ icon: "fa-location-dot", tone: "warn", html: `La sede con menor asistencia es <b>${esc(S[0].label)}</b> (<b>${fP1(S[0].pctAsis)}</b>); la mayor, <b>${esc(S[S.length - 1].label)}</b> (${fP1(S[S.length - 1].pctAsis)}).`, cond: condDim("sede")(S[0]) });
  const C = d.clientes.filter((x) => x.conv >= 5 && x.pctAsis != null).sort((a, b) => a.pctAsis - b.pctAsis);
  if (C.length > 1) L.push({ icon: "fa-building", tone: "warn", html: `El cliente con menor asistencia es <b>${esc(C[0].label)}</b> (<b>${fP1(C[0].pctAsis)}</b> de ${fmt(C[0].conv)} convocados).`, cond: condDim("cliente")(C[0]) });
  if (d.dias.length) { const p = d.dias.reduce((a, b) => (b.conv > a.conv ? b : a)); L.push({ icon: "fa-calendar-day", tone: "brand", html: `El día con más convocados fue el <b>${esc(fmtDiaLargo(p.fecha))}</b>: <b>${fmt(p.conv)}</b> (${fP1(p.pctAsis)} asistió).`, cond: condDia(p) }); }
  if (k.sinDia) L.push({ icon: "fa-triangle-exclamation", tone: "warn", html: `<b>${fmt(k.sinDia)}</b> trabajador${k.sinDia === 1 ? "" : "es"} no tiene${k.sinDia === 1 ? "" : "n"} Día Cero registrado (cobertura <b>${fP1(k.pctCob)}</b>).` });
  if (k.dupExtra) L.push({ icon: "fa-clone", tone: "warn", html: `Hay <b>${fmt(k.dupExtra)}</b> registro${k.dupExtra === 1 ? "" : "s"} duplicado${k.dupExtra === 1 ? "" : "s"} (mismo DNI y mismo día): revísalos en el control de cumplimiento.` });
  const T = d.tipos.filter((x) => x.conv > 0).sort((a, b) => b.conv - a.conv)[0];
  if (T) L.push({ icon: "fa-id-badge", tone: "brand", html: `El tipo de personal más numeroso es <b>${esc(T.label)}</b>: <b>${fmt(T.conv)}</b> trabajadores (${fP1(pct0(T.conv, k.conv))}).`, cond: condDim("tipo")(T) });
  return L;
}
function renderHallazgos(d, el) {
  const shown = hallazgosDC(d).slice(0, 8);
  el._conds = shown.map((x) => x.cond || null);
  el.innerHTML = shown.length
    ? `<ul class="insights cols-2">${shown.map((x, i) => `
        <li class="insight tone-${x.tone}">
          ${x.cond ? `<button type="button" class="insight-btn" data-insight="${i}">` : `<div class="insight-btn is-static">`}
            <span class="insight-ico"><i class="fas ${x.icon}"></i></span>
            <span class="insight-text">${x.html}</span>
            ${x.cond ? `<i class="fas fa-chevron-right insight-go" aria-hidden="true"></i></button>` : `</div>`}
        </li>`).join("")}</ul>`
    : `<p class="table-empty">No hay suficientes datos en vista para generar hallazgos.</p>`;
}
const XLIB = {
  xHall: { title: "Hallazgos automáticos", sub: "Lo que más se destaca con los filtros actuales",
    info: { what: "Frases que resumen lo más relevante del tablero con los filtros actuales.", how: "Se recalculan cada vez que cambias un filtro o llegan datos nuevos. Ninguna está escrita a mano.", tip: "Clic en un hallazgo para abrir su detalle." },
    render: renderHallazgos },
};
/* =========================== KPIs: utilidades =========================== */
function sparkSVG(values, hi, color) {
  const v = values.filter((x) => isFinite(x));
  if (v.length < 2) return "";
  values = values.map((x) => (isFinite(x) ? x : Math.min(...v)));
  const W = 92, H = 32, pad = 3;
  const min = Math.min(...v), max = Math.max(...v), rng = max - min || 1;
  const pts = values.map((x, i) => [pad + (i / (values.length - 1)) * (W - pad * 2), H - pad - ((x - min) / rng) * (H - pad * 2)]);
  const dPath = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${dPath} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;
  const h = pts[Math.max(0, Math.min(pts.length - 1, hi))];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <path d="${area}" fill="${color}" opacity=".12"></path>
    <path d="${dPath}" fill="none" stroke="${color}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"></path>
    <circle cx="${h[0].toFixed(1)}" cy="${h[1].toFixed(1)}" r="3" fill="${color}" stroke="var(--surface)" stroke-width="1.5"></circle>
  </svg>`;
}
function animateNumber(el, to, f) {
  const from = typeof el._val === "number" ? el._val : 0;
  el._val = to;
  if (REDUCED || from === to) { el.textContent = f(to); return; }
  cancelAnimationFrame(el._raf);
  const t0 = performance.now(), dur = 750;
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = f(from + (to - from) * e);
    if (p < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

/* =========================== KPIs: render =========================== */
function kpiTxt(def, key) { const v = def[key]; return typeof v === "function" ? v(DS()) : v; }
function renderKPIs() {
  const d = state.d, ds = DS();
  const conTiempo = !!ENG().conFecha;
  let S = [];
  if (conTiempo) {
    let T = d.tendencia.filter((p) => !state.filtros.hasta || p.key <= state.filtros.hasta.slice(0, 7));
    if (state.filtros.mes) { const i = T.findIndex((p) => p.label === state.filtros.mes); if (i >= 0) T = T.slice(0, i + 1); }
    S = T.slice(-12);
  }
  const cur = S.length - 1, prev = cur - 1;
  ds.kpis.forEach((id) => {
    const k = KLIB[id];
    const card = document.querySelector(`.kpi[data-kpi="${id}"]`);
    if (!card) return;
    const valor = k.val(d.k, d);
    const num = card.querySelector(".kpi-num");
    if (num.querySelector(".sk")) num.textContent = "";
    if (valor == null) { num._val = null; num.textContent = "—"; } else animateNumber(num, valor, k.f);
    const uni = card.querySelector(".kpi-val small");
    if (uni) uni.hidden = valor == null;
    num.title = valor == null ? "" : k.f(valor);

    let mid = `<p class="kpi-sub">${k.sub(d.k, d, ds)}</p>`;
    if (k.bar) mid += `<div class="kpi-bar" role="presentation"><i style="width:${Math.max(0, Math.min(100, k.bar(d.k, d) || 0))}%"></i></div>`;
    const st = k.status ? k.status(valor, d.k) : null;
    if (st) mid += `<span class="status status-${st[0]}"><i class="fas ${st[1]}"></i>${st[2]}</span>`;
    card.querySelector(".kpi-mid").innerHTML = mid;

    const foot = card.querySelector(".kpi-foot");
    if (k.nodelta) { foot.innerHTML = ""; return; }
    if (!conTiempo) {
      const c = k.cmp ? k.cmp(d.k, d) : null;
      foot.innerHTML = c ? `<div class="delta-wrap"><span class="delta ref"><i class="fas fa-code-compare"></i>${esc(c.txt)}</span><span class="delta-ref">${esc(c.ref)}</span></div>` : "";
      return;
    }
    let deltaHTML = `<span class="delta flat"><i class="fas fa-minus"></i>Sin mes anterior</span>`;
    if (cur >= 1) {
      const dv = k.dval || k.val; const a = dv(S[cur], d), b = dv(S[prev], d);
      if (a == null || b == null) deltaHTML = `<span class="delta flat"><i class="fas fa-minus"></i>Sin dato para comparar</span>`;
      else {
        let diff, t;
        if (k.delta === "pct") { diff = b ? ((a - b) / Math.abs(b)) * 100 : 0; t = `${diff >= 0 ? "+" : "−"}${fmt(Math.abs(diff), 1)} %`; }
        else if (k.delta === "pp") { diff = a - b; t = `${diff >= 0 ? "+" : "−"}${fmt(Math.abs(diff), 1)} pp`; }
        else { diff = a - b; t = `${diff >= 0 ? "+" : "−"}${fmt(Math.abs(diff), k.dec ?? 1)}`; }
        const eps = 1e-6, up = diff > eps, down = diff < -eps;
        const good = (k.better === "up" && up) || (k.better === "down" && down);
        const bad = (k.better === "up" && down) || (k.better === "down" && up);
        const cls = !up && !down ? "flat" : good ? "good" : bad ? "bad" : "ref";
        const ico = up ? "fa-arrow-trend-up" : down ? "fa-arrow-trend-down" : "fa-minus";
        deltaHTML = `<span class="delta ${cls}" title="${esc(S[cur].label)} comparado con ${esc(S[prev].label)}"><i class="fas ${ico}"></i>${t}</span><span class="delta-ref">${esc(S[cur].short)} vs. ${esc(S[prev].short)}${k.dnote ? " · " + esc(k.dnote) : ""}</span>`;
      }
    }
    foot.innerHTML = `<div class="delta-wrap">${deltaHTML}</div>${sparkSVG(S.map((p) => (k.dval || k.val)(p, d) ?? NaN), cur, state.tk.series[k.slot] || state.tk.brand)}`;
  });
}

/* =========================== LAYOUT (se arma por tablero) =========================== */
let SPECS = [];     // gráficos del tablero actual
let XSPECS = [];    // tablas y hallazgos del tablero actual
const SEC_KEYS = () => DS().secs.map((s) => s.k);
const secDef = (k) => DS().secs.find((s) => s.k === k) || DS().secs[0];

function renderBoardNav() {
  const grupos = Object.keys(FILES).map((f) => ({ f, list: DS_KEYS.filter((k) => DATASETS[k].file === f) }));
  $("boardNav").innerHTML = grupos.map(({ f, list }) => `
    <div class="board-group">
      <p class="bg-label"><i class="fas ${FILES[f].icon}"></i>${FILES[f].label}</p>
      ${list.map((k) => {
        const ds = DATASETS[k], pub = PUB[ds.sheet], on = k === state.ds;
        const n = pub && pub.meta ? pub.meta.registros : null;
        const estado = pub ? (STORE[k].signature && STORE[k].signature !== firmaPub(pub) ? "stale" : "ok") : PUB._checked ? "empty" : "wait";
        return `<a href="#${k}/${(on ? state.seccion : "") || ds.secs[0].k}" class="board ${on ? "active" : ""}" data-ds="${k}" ${on ? 'aria-current="page"' : ""} title="${esc(FILES[f].excel)} · pestaña ${esc(ds.tab)}">
          <i class="fas ${ds.icon} board-ico"></i>
          <span class="board-txt"><b>${ds.titulo}</b><small>${esc(ds.tab)}${n != null ? ` · ${fmt(n)} filas` : estado === "empty" ? " · sin datos" : ""}</small></span>
          <span class="board-dot is-${estado}" aria-hidden="true"></span></a>`;
      }).join("")}
    </div>`).join("");
}

function construirLayout() {
  const ds = DS();
  Object.keys(charts).forEach((id) => { charts[id].destroy(); delete charts[id]; });
  Object.keys(outs).forEach((id) => delete outs[id]);
  Object.keys(tables).forEach((id) => delete tables[id]);
  Object.keys(INFO).forEach((k) => delete INFO[k]);
  SPECS = []; XSPECS = [];

  renderBoardNav();
  $("dashTabs").innerHTML = ds.secs.map((s, i) => `<a href="#${state.ds}/${s.k}" class="tab" role="tab" data-seccion="${s.k}" aria-selected="false"><i class="fas ${s.icon}"></i><span>${s.t}</span><kbd>${i + 1}</kbd></a>`).join("");
  $("boardHead").innerHTML = `
    <span class="bh-ico"><i class="fas ${ds.icon}"></i></span>
    <div class="bh-txt"><p class="bh-kicker"><i class="fas ${FILES[ds.file].icon}"></i>${FILES[ds.file].label} · pestaña «${esc(ds.tab)}»</p><h1>${ds.titulo}</h1></div>
    <span class="bh-meta" id="bhMeta"></span>`;
  $("stSheet").textContent = `${CONFIG.TABLE} · ${ds.sheet}`;

  $("sections").innerHTML = ds.secs.map((s) => {
    const items = s.items.map(([id, span, size]) => {
      const c = CHARTLIB[id];
      if (c) {
        const spec = { id, sec: s.k, span, size: size || c.size, focus: c.focus, title: txt(c.title), sub: txt(c.sub), subFn: typeof c.sub === "function" ? () => c.sub(DS()) : null, build: c.build.bind(c) };
        SPECS.push(spec);
        INFO["chart:" + id] = { title: spec.title, ...txt(c.info) };
        return chartCard(spec);
      }
      const x = TLIB[id] || XLIB[id];
      if (!x) return "";
      const xs = { id, sec: s.k, span, title: txt(x.title), sub: txt(x.sub), table: x.table, render: x.render };
      XSPECS.push(xs);
      INFO["extra:" + id] = { title: xs.title, ...txt(x.info) };
      return extraCard(xs);
    }).join("");
    const kpis = s.kpis ? `<div class="kpi-row" id="kpiRow">${ds.kpis.map((id) => {
      const k = KLIB[id], label = kpiTxt(k, "label");
      INFO["kpi:" + id] = { title: label, ...txt(k.info) };
      return `<article class="card kpi" data-kpi="${id}" style="--accent: var(--series-${k.slot + 1})">
        <header class="kpi-head"><span class="kpi-ico"><i class="fas ${k.icon}"></i></span><h3>${label}</h3>${infoBtn("kpi:" + id, label)}</header>
        <div class="kpi-val"><span class="kpi-num"><span class="sk sk-kpi"></span></span>${k.unit ? `<small>${k.unit}</small>` : ""}</div>
        <div class="kpi-mid"></div>
        <footer class="kpi-foot"><span class="sk sk-line"></span></footer>
      </article>`;
    }).join("")}</div>` : "";
    return `<section id="sec-${s.k}" class="dash-section" data-seccion="${s.k}" hidden>
      <header class="page-head"><div class="page-head-ico"><i class="fas ${s.icon}"></i></div><div><h2>${s.t}</h2><p>${s.desc}</p></div></header>
      ${kpis}<div class="grid" id="grid-${s.k}">${items}</div></section>`;
  }).join("");
  const nCharts = SPECS.length, nTablas = XSPECS.filter((x) => x.table).length;
  $("stContenido").textContent = `${ds.kpis.length} KPIs · ${nCharts} gráficos · ${nTablas} tablas`;
  $("kbdN").textContent = ds.secs.length;
}

function infoBtn(key, label) {
  return `<button type="button" class="card-btn info-btn js-info" data-info="${key}" aria-label="Qué significa: ${esc(label)}" aria-expanded="false"><i class="fas fa-circle-info"></i></button>`;
}
function chartCard(c) {
  return `
  <article class="card chart-card span-${c.span}" id="card-${c.id}" data-chart="${c.id}">
    <header class="card-head">
      <div class="card-titles"><h3>${c.title}</h3><p data-sub="${esc(c.sub)}">${c.sub}</p></div>
      <div class="card-actions">
        ${infoBtn("chart:" + c.id, c.title)}
        <button type="button" class="card-btn js-table" aria-pressed="false" title="Ver como tabla" aria-label="Ver ${esc(c.title)} como tabla"><i class="fas fa-table-list"></i></button>
        <button type="button" class="card-btn js-expand" title="Ampliar" aria-label="Ampliar ${esc(c.title)}"><i class="fas fa-up-right-and-down-left-from-center"></i></button>
        <button type="button" class="card-btn js-png" title="Descargar imagen PNG" aria-label="Descargar ${esc(c.title)} como imagen"><i class="fas fa-download"></i></button>
      </div>
    </header>
    <div class="card-body">
      <div class="plot plot-${c.size}">
        <canvas id="${c.id}" role="img" aria-label="${esc(c.title)}"></canvas>
        <div class="sk sk-plot" aria-hidden="true"></div>
      </div>
      ${c.size === "donut" ? `<ul class="donut-legend" data-legend="${c.id}"></ul>` : ""}
      <div class="table-view" data-tableview="${c.id}" hidden></div>
      <div class="empty-card" hidden>
        <i class="fas fa-filter-circle-xmark"></i>
        <p>No hay datos para esta combinación de filtros.</p>
        <button type="button" class="btn-chip js-clear">Limpiar filtros</button>
      </div>
    </div>
  </article>`;
}
function extraCard(x) {
  return `
  <article class="card extra-card span-${x.span}" id="card-${x.id}" data-extra="${x.id}">
    <header class="card-head">
      <div class="card-titles"><h3>${x.title}</h3><p>${x.sub}</p></div>
      <div class="card-actions">${infoBtn("extra:" + x.id, x.title)}${x.table ? `<button type="button" class="card-btn js-csv-table" data-table="${x.id}" title="Descargar esta tabla en CSV" aria-label="Descargar ${esc(x.title)} en CSV"><i class="fas fa-file-csv"></i></button>` : ""}</div>
    </header>
    <div class="card-body" id="${x.id}"><div class="sk sk-block"></div></div>
  </article>`;
}

/* =========================== MONTAJE DE GRÁFICOS =========================== */
function wire(spec, out, config) {
  config.options = config.options || {};
  config.options.onHover = (evt, els, chart) => {
    const e = els[0];
    const f = e ? { i: e.index, ds: e.datasetIndex } : null;
    const p = chart.$focus;
    if (spec.focus && ((p && p.i) !== (f && f.i) || (p && p.ds) !== (f && f.ds))) { chart.$focus = f; chart.update("none"); }
    chart.canvas.style.cursor = e && out.drill ? "pointer" : "default";
  };
  config.options.onClick = (evt, els) => {
    const e = els[0];
    if (!e || !out.drill) return;
    const cond = out.drill(e);
    if (cond) abrirDrill(cond.filter(Boolean));
  };
  return config;
}
function mountChart(spec, { force = false } = {}) {
  const canvas = $(spec.id);
  if (!canvas) return;
  const card = $("card-" + spec.id);
  let out;
  try { out = spec.build(state.d, state.tk, DS()); }
  catch (err) { console.error(`Gráfico ${spec.id}:`, err); out = { empty: true, emptyMsg: "No se pudo calcular este gráfico con los datos publicados." }; }
  outs[spec.id] = out;
  card.classList.toggle("is-empty", !!out.empty);
  card.querySelector(".empty-card").hidden = !out.empty;
  card.querySelector(".empty-card p").textContent = out.emptyMsg || "No hay datos para esta combinación de filtros.";
  card.querySelector(".empty-card .js-clear").hidden = !(filtrosActivos().length || hayFecha());
  const sub = card.querySelector(".card-titles p");
  const sb0 = spec.subFn ? spec.subFn() : sub.dataset.sub;
  sub.textContent = out.sub ? `${sb0} · ${out.sub}` : sb0;

  renderTabla(card.querySelector(`[data-tableview="${spec.id}"]`), "tv-" + spec.id, out.table);
  const leg = card.querySelector(`[data-legend="${spec.id}"]`);
  if (leg) renderDonutLegend(leg, spec, out);

  if (out.empty) { if (charts[spec.id]) { charts[spec.id].destroy(); delete charts[spec.id]; } return; }

  const config = wire(spec, out, out.config);
  const prev = charts[spec.id];
  if (prev && !force && prev.config.type === config.type && prev.data.datasets.length === config.data.datasets.length) {
    prev.data.labels = config.data.labels;
    config.data.datasets.forEach((ds, i) => { Object.assign(prev.data.datasets[i], ds); });
    prev.options = config.options;
    prev.$focus = null;
    prev.update();
    return;
  }
  if (prev) prev.destroy();
  charts[spec.id] = new Chart(canvas, config);
}
function renderDonutLegend(ul, spec, out) {
  if (!out.legend || out.empty) { ul.innerHTML = ""; return; }
  ul.innerHTML = out.legend.map((l) => `
    <li><button type="button" class="dl-item" data-chart="${spec.id}" data-index="${l.index}" title="${esc(l.full || l.label)}">
      <span class="dl-dot" style="background:${l.color}"></span>
      <span class="dl-label">${esc(l.label)}</span>
      <span class="dl-val">${l.value}</span>
      <span class="dl-pct">${fmt(l.pct, 1)} %</span>
    </button></li>`).join("");
}

/* =========================== TABLAS (orden, búsqueda y páginas) =========================== */
const COLL = new Intl.Collator("es", { numeric: true, sensitivity: "base" });
const cellVal = (c) => (c && typeof c === "object" && "v" in c ? c.v : c);
const cellTxt = (c) => (c && typeof c === "object" && "f" in c ? c.f : c);
/* Una tabla puede venir de dos formas:
   - rows: arreglo de filas ya armadas (tablas chicas)
   - src + cols: filas crudas y columnas {t, get, f, num, bar}; solo se formatea la página visible
     (así el detalle de 50 000 movimientos se abre al instante) */
function acceso(def) {
  if (def.src) {
    const C = def.cols;
    return {
      n: def.src.length,
      val: (i, c) => C[c].get(def.src[i]),
      txt: (i, c) => { const v = C[c].get(def.src[i]); return C[c].f ? C[c].f(v) : v ?? ""; },
      buscable: (i) => { const Q = def._qs || (def._qs = []); return Q[i] ?? (Q[i] = fold2(C.map((x) => x.get(def.src[i]) ?? "").join(" "))); },
      cond: (i) => (def.condFn ? def.condFn(def.src[i]) : null),
      head: C,
    };
  }
  return {
    n: def.rows.length,
    val: (i, c) => cellVal(def.rows[i][c]),
    txt: (i, c) => cellTxt(def.rows[i][c]),
    buscable: (i) => (def._txt || (def._txt = def.rows.map((r) => fold2(r.map(cellTxt).join(" ")))))[i],
    cond: (i) => (def.conds ? def.conds[i] : null),
    head: def.head,
  };
}
function renderTabla(container, id, def) {
  if (!container) return;
  tables[id] = { def, container };
  if (!def || !(def.src || def.rows) || !(def.src || def.rows).length) {
    container.innerHTML = `<p class="table-empty">${esc((def && def.empty) || "Sin filas para mostrar.")}</p>`;
    return;
  }
  def._a = acceso(def);
  let host = container.querySelector(":scope > .tbl-host");
  if (!host || !!container.querySelector(":scope > .tbl-tools") !== !!def.searchable) {
    container.innerHTML = (def.searchable
      ? `<div class="tbl-tools"><label class="tbl-search"><i class="fas fa-magnifying-glass"></i><input type="search" data-table="${id}" placeholder="Buscar en la tabla…" aria-label="Buscar en la tabla" autocomplete="off"></label><span class="tbl-count"></span></div>`
      : "") + `<div class="tbl-host"></div>`;
    host = container.querySelector(":scope > .tbl-host");
    const inp = container.querySelector(".tbl-search input");
    if (inp) inp.value = state.q[id] || "";
  }
  pintarTabla(id);
}

function pintarTabla(id) {
  const tb = tables[id]; if (!tb) return;
  const { def, container } = tb;
  const A = def._a;
  const host = container.querySelector(":scope > .tbl-host");
  if (!host || !A) return;
  const head = A.head;
  // Búsqueda (sin acentos ni mayúsculas)
  const q = fold2(state.q[id] || "").trim();
  let idx = [];
  for (let i = 0; i < A.n; i++) if (!q || A.buscable(i).includes(q)) idx.push(i);
  // Orden
  const s = state.sort[id] || def.defaultSort;
  if (s && s.col >= 0) {
    const vals = new Map(idx.map((i) => [i, A.val(i, s.col)]));
    idx.sort((a, b) => {
      const x = vals.get(a), y = vals.get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const r = typeof x === "number" && typeof y === "number" ? x - y : COLL.compare(String(x), String(y));
      return s.dir === "asc" ? r : -r;
    });
  }
  // Páginas
  const size = def.pageSize || idx.length || 1;
  const pages = Math.max(1, Math.ceil(idx.length / size));
  const page = Math.min(state.page[id] || 0, pages - 1);
  state.page[id] = page;
  const slice = idx.slice(page * size, page * size + size);

  const barCols = head.map((h, i) => (h.bar ? i : -1)).filter((i) => i >= 0);
  const maxes = {};
  barCols.forEach((c) => { let m = 1e-9; for (let i = 0; i < A.n; i++) { const v = Math.abs(Number(A.val(i, c)) || 0); if (v > m) m = v; } maxes[c] = m; });

  const count = container.querySelector(".tbl-count");
  if (count) count.textContent = q ? `${fmt(idx.length)} de ${fmt(A.n)} filas` : `${fmt(A.n)} filas`;

  host.innerHTML = (idx.length ? `<div class="tbl-wrap"><table class="tbl">
    <thead><tr>${head.map((h, i) => {
      const act = s && s.col === i;
      const dir = act ? (s.dir === "asc" ? "ascending" : "descending") : "none";
      return `<th class="${h.num ? "num" : ""}" aria-sort="${dir}"><button type="button" class="th-sort" data-table="${id}" data-col="${i}">${h.t}<i class="fas ${act ? (s.dir === "asc" ? "fa-arrow-up-short-wide" : "fa-arrow-down-wide-short") : "fa-sort"}"></i></button></th>`;
    }).join("")}</tr></thead>
    <tbody>${slice.map((ri) => {
      const cond = A.cond(ri);
      return `<tr ${cond ? `class="is-clickable" tabindex="0" data-table="${id}" data-row="${ri}"` : ""}>${head.map((h, ci) => {
        const f = A.txt(ri, ci);
        const bar = barCols.includes(ci) ? `<span class="cell-bar" style="--w:${Math.max(2, (Math.abs(Number(A.val(ri, ci)) || 0) / maxes[ci]) * 100)}%"></span>` : "";
        return `<td class="${h.num ? "num" : ""} ${ci === 0 ? "name" : ""}" ${String(f).length > 40 ? `title="${esc(f)}"` : ""}>${bar}<span>${esc(trunc(f, 60))}</span></td>`;
      }).join("")}</tr>`;
    }).join("")}</tbody></table></div>` : `<p class="table-empty">Ninguna fila coincide con «${esc(state.q[id])}».</p>`)
    + (pages > 1 ? `<div class="tbl-pager">
        <span>Filas ${fmt(page * size + 1)}–${fmt(Math.min(idx.length, page * size + size))} de ${fmt(idx.length)}</span>
        <div class="pager-btns">
          <button type="button" class="btn-chip js-page" data-table="${id}" data-page="0" ${page === 0 ? "disabled" : ""} aria-label="Primera página"><i class="fas fa-angles-left"></i></button>
          <button type="button" class="btn-chip js-page" data-table="${id}" data-page="${page - 1}" ${page === 0 ? "disabled" : ""} aria-label="Página anterior"><i class="fas fa-angle-left"></i></button>
          <span class="pager-n">Página ${fmt(page + 1)} de ${fmt(pages)}</span>
          <button type="button" class="btn-chip js-page" data-table="${id}" data-page="${page + 1}" ${page >= pages - 1 ? "disabled" : ""} aria-label="Página siguiente"><i class="fas fa-angle-right"></i></button>
          <button type="button" class="btn-chip js-page" data-table="${id}" data-page="${pages - 1}" ${page >= pages - 1 ? "disabled" : ""} aria-label="Última página"><i class="fas fa-angles-right"></i></button>
        </div></div>` : "");
}

/* =========================== FILTROS =========================== */
const conFecha = () => !!ENG().conFecha;
function filtrosActivos() { return FILTER_KEYS().filter((k) => state.filtros[k]); }
function hayFecha() { return !!(state.filtros.desde || state.filtros.hasta); }
function textoFecha() {
  const { desde, hasta } = state.filtros;
  if (!desde && !hasta) return "Todo el período";
  if (desde && desde === hasta) return fmtDiaLargo(desde);
  return `${fdia(desde || state.rango.min)} – ${fdia(hasta || state.rango.max)}`;
}
function fchip(k) {
  const cur = state.filtros[k], d = dimDef(k);
  return `<button type="button" class="fchip js-fopen ${cur ? "is-active" : ""}" data-dim="${k}" aria-haspopup="dialog" aria-expanded="false" title="${esc(cur || "Todos")}">
    <i class="fas ${d.icon}"></i><span class="fchip-label">${d.label}</span>
    <span class="fchip-value">${cur ? esc(cur) : "Todos"}</span><i class="fas fa-chevron-down fchip-caret" aria-hidden="true"></i></button>`;
}
function renderFiltros() {
  const fb = $("filterbar");
  const keys = FILTER_KEYS();
  const n = filtrosActivos().length + (hayFecha() ? 1 : 0);
  const more = keys.filter((k) => dimDef(k).group === "more");
  const masActivos = more.filter((k) => state.filtros[k]).length;
  fb.innerHTML = `
    <div class="fb-main">
      <span class="fb-title"><i class="fas fa-sliders"></i><span>Segmentadores</span>${n ? `<b class="fb-count">${n}</b>` : ""}</span>
      <div class="fb-chips">
        ${conFecha() ? `<button type="button" class="fchip js-fopen ${hayFecha() ? "is-active" : ""}" data-dim="fecha" aria-haspopup="dialog" aria-expanded="false">
          <i class="fas fa-calendar-days"></i><span class="fchip-label">${DS().fechaLabel || "Fecha"}</span><span class="fchip-value">${esc(textoFecha())}</span><i class="fas fa-chevron-down fchip-caret" aria-hidden="true"></i></button>` : ""}
        ${keys.filter((k) => dimDef(k).group === "main").map(fchip).join("")}
        ${more.length ? `<button type="button" class="fchip fchip-more js-more ${masActivos ? "is-active" : ""}" aria-expanded="${state.moreOpen}">
          <i class="fas ${state.moreOpen ? "fa-minus" : "fa-plus"}"></i><span class="fchip-value">${state.moreOpen ? "Menos filtros" : `Más filtros (${more.length})`}</span>${masActivos ? `<b class="fb-count">${masActivos}</b>` : ""}</button>` : ""}
      </div>
      <div class="fb-actions">
        <button type="button" class="btn-chip js-clear" ${n ? "" : "disabled"}><i class="fas fa-filter-circle-xmark"></i>Limpiar</button>
        <button type="button" class="btn-chip js-csv" title="Descargar el detalle en vista"><i class="fas fa-file-csv"></i>Exportar CSV</button>
      </div>
    </div>
    ${more.length ? `<div class="fb-more" ${state.moreOpen ? "" : "hidden"}>${more.map(fchip).join("")}</div>` : ""}`;
}

let fpState = { dim: null, btn: null };
const FP_MAX = 400; // opciones dibujadas a la vez; el buscador recorre todas
function abrirPanel(btn) {
  const dim = btn.dataset.dim;
  if (fpState.dim === dim) { cerrarPanel(); return; }
  cerrarPanel();
  const p = $("fpanel");
  if (dim === "fecha") {
    const meses = Array.from(new Set(state.dims.fechas.map((f) => f.slice(0, 7))));
    const { min, max } = state.rango;
    p.innerHTML = `
      <div class="fp-head"><b>${DS().fechaLabel || "Fecha"}</b><small>Datos del ${fdia(min)} al ${fdia(max)}</small></div>
      <div class="fp-presets">
        ${ENG().presetsFecha ? ENG().presetsFecha() : ""}
        <button type="button" class="fp-preset" data-preset="all">Todo el período</button>
        <button type="button" class="fp-preset" data-preset="30">Últimos 30 días</button>
        <button type="button" class="fp-preset" data-preset="90">Últimos 90 días</button>
        <button type="button" class="fp-preset" data-preset="year">Año de la última fecha</button>
        ${meses.map((m) => { const [y, mm] = m.split("-"); return `<button type="button" class="fp-preset" data-month="${m}">${MES_CORTO[+mm - 1]} ${y}</button>`; }).join("")}
      </div>
      <div class="fp-dates">
        <label>Desde<input type="date" id="fpDesde" min="${min}" max="${max}" value="${state.filtros.desde || min}"></label>
        <label>Hasta<input type="date" id="fpHasta" min="${min}" max="${max}" value="${state.filtros.hasta || max}"></label>
      </div>
      <div class="fp-foot"><button type="button" class="btn-primary js-fp-apply"><i class="fas fa-check"></i>Aplicar rango</button></div>`;
  } else {
    const def = dimDef(dim);
    const base = filtrar(state.filas, state.filtros, dim);
    const counts = new Map();
    base.forEach((r) => counts.set(r[dim], (counts.get(r[dim]) || 0) + 1));
    if ((ENG().vistaDims || []).includes(dim)) (state.dims[dim] || []).forEach((v) => counts.set(v, base.length));
    const all = (state.dims[dim] || []).slice();
    const vals = def.sort === "mes" ? all : all.sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0));
    const cur = state.filtros[dim];
    p._vals = vals; p._counts = counts; p._dim = dim;
    p.innerHTML = `
      <div class="fp-head"><b>${def.label}</b><small>${fmt(vals.length)} valores · el número es la cantidad de filas con los demás filtros</small></div>
      ${vals.length > 8 ? `<label class="fp-search"><i class="fas fa-magnifying-glass"></i><input type="search" id="fpSearch" placeholder="Buscar ${def.label.toLowerCase()}…" autocomplete="off" aria-label="Buscar"></label>` : ""}
      <ul class="fp-list" role="listbox" aria-label="${def.label}">
        <li><button type="button" role="option" class="fp-opt ${!cur ? "is-sel" : ""}" data-value="" aria-selected="${!cur}"><span>Todos</span><b>${fmt(base.length)}</b></button></li>
        ${fpOpciones(vals, counts, cur, "")}
      </ul>`;
  }
  p.dataset.dim = dim;
  p.hidden = false;
  fpState = { dim, btn };
  btn.setAttribute("aria-expanded", "true");
  posicionarPanel();
  requestAnimationFrame(() => {
    p.classList.add("show");
    const f = p.querySelector("#fpSearch") || p.querySelector(".fp-opt.is-sel") || p.querySelector(".fp-preset");
    if (f) f.focus({ preventScroll: true });
  });
}
function fpOpciones(vals, counts, cur, q) {
  const L = q ? vals.filter((v) => fold2(v).includes(q)) : vals;
  const shown = L.slice(0, FP_MAX);
  return shown.map((v) => { const c = counts.get(v) || 0; return `<li data-opt><button type="button" role="option" class="fp-opt ${v === cur ? "is-sel" : ""} ${c ? "" : "is-zero"}" data-value="${esc(v)}" aria-selected="${v === cur}" title="${esc(v)}"><span>${esc(v)}</span><b>${fmt(c)}</b></button></li>`; }).join("")
    + (L.length > shown.length ? `<li class="fp-more">Se muestran ${fmt(shown.length)} de ${fmt(L.length)}: escribí para encontrar el resto.</li>` : "")
    + (q && !L.length ? `<li class="fp-more">Ningún valor contiene «${esc(q)}».</li>` : "");
}
function filtrarPanel(q) {
  const p = $("fpanel");
  if (!p._vals) return;
  const list = p.querySelector(".fp-list");
  list.querySelectorAll("li[data-opt], li.fp-more").forEach((li) => li.remove());
  list.insertAdjacentHTML("beforeend", fpOpciones(p._vals, p._counts, state.filtros[p._dim], fold2(q).trim()));
}
function posicionarPanel() {
  const p = $("fpanel"), b = fpState.btn;
  if (!b || p.hidden) return;
  const r = b.getBoundingClientRect(), m = 10;
  const w = Math.min(fpState.dim === "fecha" ? 390 : 360, window.innerWidth - m * 2);
  p.style.width = w + "px";
  p.style.left = Math.min(window.innerWidth - w - m, Math.max(m, r.left)) + "px";
  const espacio = window.innerHeight - r.bottom - m - 8;
  p.style.top = r.bottom + 8 + "px";
  p.style.maxHeight = Math.max(240, espacio) + "px";
}
function cerrarPanel() {
  const p = $("fpanel");
  if (fpState.btn) fpState.btn.setAttribute("aria-expanded", "false");
  p.classList.remove("show"); p.hidden = true; p.dataset.dim = ""; p._vals = null;
  fpState = { dim: null, btn: null };
}
function aplicarPreset(btn) {
  const { min, max } = state.rango;
  let desde = "", hasta = "";
  const pr = btn.dataset.preset, mo = btn.dataset.month;
  if (btn.dataset.desde) { setFecha(btn.dataset.desde, btn.dataset.hasta); return; }   // período fijo (no se recorta al rango de datos)
  if (pr === "30") { desde = addDays(max, -29); hasta = max; }
  else if (pr === "90") { desde = addDays(max, -89); hasta = max; }
  else if (pr === "year") { desde = max.slice(0, 4) + "-01-01"; hasta = max; }
  else if (mo) { const [y, m] = mo.split("-").map(Number); desde = `${mo}-01`; hasta = toISO(new Date(y, m, 0)); }
  if (desde && desde < min) desde = min;
  if (hasta && hasta > max) hasta = max;
  if (desde === min && hasta === max) { desde = ""; hasta = ""; }
  setFecha(desde, hasta);
}
function setFecha(desde, hasta) {
  if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde];
  state.filtros.desde = desde || "";
  state.filtros.hasta = hasta || "";
  cerrarPanel();
  render();
}
function setFiltro(k, v) {
  if (k === "fecha") { setFecha("", ""); return; }
  if (!FILTER_KEYS().includes(k)) return;
  state.filtros[k] = v || "";
  if (dimDef(k).group === "more" && v) state.moreOpen = true;
  cerrarPanel();
  render();
}
function limpiarFiltros() {
  state.filtros = { desde: "", hasta: "" };
  cerrarPanel();
  render();
}

/* =========================== CONTEXTO =========================== */

function renderContexto() {
  const s = secDef(state.seccion), ds = DS();
  const total = state.filas.length, enVista = state.vista.length;
  const chips = [];
  if (hayFecha()) chips.push({ k: "fecha", icon: "fa-calendar-days", label: "Fecha", val: textoFecha() });
  filtrosActivos().forEach((k) => chips.push({ k, icon: dimDef(k).icon, label: dimDef(k).label, val: state.filtros[k] }));

  $("crumbs").innerHTML = `
    <span class="crumb-sec"><i class="fas ${ds.icon}"></i>${ds.titulo}</span>
    <i class="fas fa-chevron-right crumb-sep" aria-hidden="true"></i>
    <span class="crumb-sec is-sub">${s.t}</span>
    <i class="fas fa-chevron-right crumb-sep" aria-hidden="true"></i>
    <span class="crumb-filters">${chips.length ? chips.map((c) => `${c.label}: <b>${esc(trunc(c.val, 28))}</b>`).join('<span class="crumb-dot"></span>') : "Todos los datos"}</span>`;

  $("contextBar").innerHTML = `
    <div class="ctx-main">
      <span class="ctx-pill"><i class="fas ${s.icon}"></i>Estás en <b>${ds.titulo} › ${s.t}</b></span>
      <span class="ctx-count">Mostrando <b>${fmt(enVista)}</b> de ${fmt(total)} ${ENG().unidad}${total ? ` · ${fmtPct((enVista / total) * 100, 0)}` : ""}${conFecha() ? ` · <b>${esc(textoFecha())}</b>` : ""}</span>
    </div>
    <div class="ctx-filters">
      ${chips.length
        ? chips.map((c) => `<button type="button" class="ctx-chip js-remove-filter" data-dim="${c.k}" title="Quitar este filtro"><i class="fas ${c.icon}"></i>${c.label}: <b>${esc(trunc(c.val, 34))}</b><i class="fas fa-xmark ctx-x"></i></button>`).join("")
        : `<span class="ctx-none"><i class="fas fa-layer-group"></i>Sin filtros: ves todos los datos</span>`}
    </div>`;
  $("contextBar").classList.toggle("has-filters", chips.length > 0);
  $("contextBar").classList.toggle("is-empty-view", total > 0 && enVista === 0);
  document.title = `${ds.titulo} · ${s.t}${chips.length ? " · " + chips.map((c) => trunc(c.val, 20)).join(" · ") : ""} | CORE HSE`;
}

/* =========================== RENDER =========================== */
function render({ force = false } = {}) {
  if (!state.payload) return;
  state.tk = tokens();
  state.vista = filtrar(state.filas, state.filtros);
  state.d = ENG().calc(state.vista, state.filas);
  renderFiltros();
  renderContexto();
  writeHash();
  renderSeccion(state.seccion, { force });
}
function renderSeccion(sec, { force = false } = {}) {
  SEC_KEYS().forEach((k) => {
    const el = $("sec-" + k);
    const on = k === sec;
    if (on && el.hidden) { el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter"); }
    el.hidden = !on;
  });
  document.querySelectorAll("#dashTabs .tab").forEach((t) => {
    const on = t.dataset.seccion === sec;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
  if (!state.payload || !state.d) return;
  if (secDef(sec).kpis) renderKPIs();
  SPECS.filter((c) => c.sec === sec).forEach((c) => mountChart(c, { force }));
  XSPECS.filter((x) => x.sec === sec).forEach((x) => {
    const el = $(x.id);
    try {
      if (x.render) x.render(state.d, el);
      else { if (el.querySelector(".sk")) el.innerHTML = ""; renderTabla(el, x.id, x.table(state.d)); }
    } catch (err) { console.error(`Tabla ${x.id}:`, err); el.innerHTML = `<p class="table-empty">No se pudo calcular esta tabla.</p>`; }
  });
}
function cambiarSeccion(sec) {
  if (!SEC_KEYS().includes(sec)) sec = SEC_KEYS()[0];
  const cambio = sec !== state.seccion;
  state.seccion = sec;
  cerrarPopover(); cerrarPanel();
  if (state.payload) renderContexto();
  writeHash();
  renderSeccion(sec, { force: cambio });
  renderBoardNav();
  if (cambio) window.scrollTo({ top: 0, behavior: REDUCED ? "auto" : "smooth" });
}

/* =========================== TABLEROS =========================== */
function guardarStore() { DS_FIELDS.forEach((f) => { STORE[state.ds][f] = state[f]; }); }
function cambiarDataset(key, { sec, filtros } = {}) {
  if (!DATASETS[key]) return;
  if (key === state.ds && !filtros) { if (sec) cambiarSeccion(sec); return; }
  cerrarPopover(); cerrarPanel(); cerrarDrill(); cerrarModal();
  guardarStore();
  state.ds = key;
  DS_FIELDS.forEach((f) => { state[f] = STORE[key][f]; });
  if (filtros) state.filtros = filtros;
  state.seccion = sec && SEC_KEYS().includes(sec) ? sec : state.seccion && SEC_KEYS().includes(state.seccion) ? state.seccion : SEC_KEYS()[0];
  state.vista = []; state.d = null;
  try { localStorage.setItem(CONFIG.LS_DATASET, key); } catch (_) {}
  construirLayout();
  const pub = PUB[DS().sheet];
  const vigente = state.payload && (!PUB._checked || (pub && firmaPub(pub) === state.signature));
  if (vigente) {
    mostrarEstadoGlobal(null);
    pintarStatus();
    render({ force: true });
  } else {
    if (PUB._checked && !pub) { state.payload = null; state.filas = []; pintarStatus(); mostrarEstadoGlobal("vacio"); writeHash(); renderSeccion(state.seccion); return; }
    document.body.classList.add("is-loading");
    mostrarEstadoGlobal(null);
    $("filterbar").innerHTML = ""; $("contextBar").innerHTML = "";
    renderSeccion(state.seccion);
    writeHash();
    cargarDatos("tablero");
  }
  window.scrollTo({ top: 0, behavior: "auto" });
}

/* =========================== URL (#tablero/sección?filtros) =========================== */
function leerHash() {
  const raw = location.hash.replace(/^#/, "");
  const [path, qs] = raw.split("?");
  const [ds, sec] = path.split("/").map((x) => decodeURIComponent(x || ""));
  const p = new URLSearchParams(qs || "");
  const filtros = {};
  p.forEach((v, k) => { filtros[k] = v; });
  return { ds: DATASETS[ds] ? ds : null, sec, filtros };
}
function writeHash() {
  const p = new URLSearchParams();
  ["desde", "hasta", ...FILTER_KEYS()].forEach((k) => { if (state.filtros[k]) p.set(k, state.filtros[k]); });
  const qs = p.toString();
  const url = new URL(location.href);
  url.searchParams.delete("t");
  url.hash = `${state.ds}/${state.seccion}` + (qs ? "?" + qs : "");
  if (url.href !== location.href) history.replaceState(null, "", url.href);
}

/* =========================== DRILL-DOWN =========================== */
let drillReturnFocus = null;

function abrirDrill(conds) {
  if (!conds || !conds.length || !state.d) return;
  cerrarPanel();
  const eng = ENG(), ds = DS();
  const rows = state.vista.filter((r) => conds.every((c) => matchCond(r, c)));
  const k = eng.agg(rows);
  const sk = eng.shareKey, tot = state.d.k[sk];
  const porValor = tot > 0 && k[sk] > 0;
  const share = porValor ? (k[sk] / tot) * 100 : state.d.k.n ? (k.n / state.d.k.n) * 100 : 0;
  $("drawerKicker").textContent = `${ds.titulo} · ${conds.map((c) => dimLabel(c.dim)).join(" · ")}`;
  $("drawerTitle").textContent = conds.map((c) => c.label || String(c.value)).join(" · ");

  const usados = new Set(conds.map((c) => (c.dim === "mesKey" ? "mes" : c.dim === "codigo" || c.dim === "set" ? "_nombre" : c.dim)));
  const [bdim, blabel] = eng.drillDims.find(([dm]) => !usados.has(dm) && rows.length && dm in rows[0] && new Set(rows.map((r) => r[dm])).size > 1) || [];
  let breakdown = null;
  if (bdim) {
    const list = bdim === "mes" ? porMes(rows) : porDim(rows, bdim, sk);
    const c0 = eng.drillCols(list[0]);
    breakdown = {
      head: [{ t: blabel }, ...c0.map((c, i) => ({ t: c[0], num: 1, bar: c[3] ? 1 : 0 }))],
      rows: list.map((x) => [bdim === "mes" ? cell(x.key, () => x.label) : x.label, ...eng.drillCols(x).map((c) => cell(c[1], c[2]))]),
      searchable: list.length > 15, pageSize: 15,
    };
  }
  $("drawerBody").innerHTML = `
    <div class="drill-share">
      <div class="drill-share-top"><span>Peso en ${porValor ? ENG().shareLabel : "las filas en vista"}</span><b>${fmtPct(share)}</b></div>
      <div class="kpi-bar"><i style="width:${Math.min(100, share)}%"></i></div>
      <small>${fmt(rows.length)} ${ENG().unidad} · ${conds.length > 1 ? "combinación seleccionada" : "dentro de los filtros actuales"}</small>
    </div>
    <dl class="drill-grid">${eng.drillMini(k).map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join("")}</dl>
    ${breakdown ? `<h3 class="drill-sub">Desglose por ${blabel.toLowerCase()}</h3><div id="drillTable"></div>` : ""}`;
  if (breakdown) { state.page.drill = 0; state.q.drill = ""; renderTabla($("drillTable"), "drill", breakdown); }

  const aplicables = [];
  conds.forEach((c) => {
    if (c.dim === "mesKey") { if (FILTER_KEYS().includes("mes") && rows[0]) aplicables.push({ dim: "mes", value: rows[0].mes, label: rows[0].mes }); }
    else if (c.dim === "codigo" && FILTER_KEYS().includes("recurso") && rows[0]) aplicables.push({ dim: "recurso", value: rows[0].recurso, label: rows[0].recurso });
    else if (c.dim === "fecha" && conFecha()) aplicables.push({ dim: "fecha", value: c.value, label: fdia(c.value) });
    else if (FILTER_KEYS().includes(c.dim)) aplicables.push({ dim: c.dim, value: c.value, label: c.label || c.value });
  });
  $("drawerFoot").innerHTML = aplicables.length
    ? `<button type="button" class="btn-primary" id="drillApply"><i class="fas fa-filter"></i>Filtrar el tablero por ${esc(trunc(aplicables.map((a) => a.label).join(" + "), 56))}</button>
       <button type="button" class="btn-ghost" id="drillCancel">Cerrar</button>`
    : `<p class="drill-note"><i class="fas fa-circle-info"></i>${esc(dimLabel(conds[0].dim))} no es un segmentador de este tablero: esta vista es solo de detalle.</p>
       <button type="button" class="btn-ghost" id="drillCancel">Cerrar</button>`;
  const ap = $("drillApply");
  if (ap) ap.addEventListener("click", () => {
    aplicables.forEach((a) => { if (a.dim === "fecha") { state.filtros.desde = a.value; state.filtros.hasta = a.value; } else { state.filtros[a.dim] = a.value; if (dimDef(a.dim).group === "more") state.moreOpen = true; } });
    cerrarDrill(); render();
    toast(`Filtro aplicado: ${aplicables.map((a) => a.label).join(", ")}`, "info");
  });
  $("drillCancel").addEventListener("click", cerrarDrill);

  drillReturnFocus = document.activeElement;
  $("scrim").hidden = false;
  requestAnimationFrame(() => { document.body.classList.add("drawer-open"); $("drawer").setAttribute("aria-hidden", "false"); });
  setTimeout(() => $("drawerClose").focus(), 60);
}
function cerrarDrill() {
  if (!document.body.classList.contains("drawer-open")) return;
  document.body.classList.remove("drawer-open");
  $("drawer").setAttribute("aria-hidden", "true");
  setTimeout(() => { $("scrim").hidden = true; }, 280);
  if (drillReturnFocus && drillReturnFocus.focus) drillReturnFocus.focus();
}

/* =========================== POPOVER DE AYUDA =========================== */
let popState = { btn: null, pinned: false, timer: null };
function mostrarPopover(btn, pinned = false) {
  const info = INFO[btn.dataset.info];
  if (!info) return;
  const pop = $("popover");
  pop.innerHTML = `
    <p class="pop-title">${esc(info.title)}</p>
    <div class="pop-block"><span class="pop-label"><i class="fas fa-eye"></i>Qué muestra</span><p>${esc(info.what)}</p></div>
    <div class="pop-block"><span class="pop-label"><i class="fas fa-calculator"></i>Cómo se calcula</span><p>${esc(info.how)}</p></div>
    ${info.tip ? `<p class="pop-tip"><i class="fas fa-hand-pointer"></i>${esc(info.tip)}</p>` : ""}`;
  if (popState.btn && popState.btn !== btn) popState.btn.setAttribute("aria-expanded", "false");
  popState.btn = btn; popState.pinned = pinned;
  btn.setAttribute("aria-expanded", "true");
  pop.hidden = false;
  pop.classList.toggle("is-pinned", pinned);
  // Posición: debajo y alineado a la derecha del botón, sin salirse de la pantalla
  const r = btn.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight, m = 10;
  let left = Math.min(window.innerWidth - pw - m, Math.max(m, r.right - pw + 8));
  let top = r.bottom + 8, above = false;
  if (top + ph > window.innerHeight - m) { top = r.top - ph - 8; above = true; }
  pop.style.left = left + "px"; pop.style.top = Math.max(m, top) + "px";
  pop.style.setProperty("--arrow-x", Math.min(pw - 14, Math.max(14, r.left + r.width / 2 - left)) + "px");
  pop.classList.toggle("above", above);
  pop.classList.remove("show"); void pop.offsetWidth; pop.classList.add("show");
}
function cerrarPopover() {
  const pop = $("popover");
  if (popState.btn) popState.btn.setAttribute("aria-expanded", "false");
  popState = { btn: null, pinned: false, timer: null };
  pop.classList.remove("show"); pop.hidden = true;
}


/* =========================== MODAL (ampliar) =========================== */
let modalChart = null, modalReturnFocus = null;
function abrirModal(id) {
  const spec = SPECS.find((c) => c.id === id);
  if (!spec || !state.d) return;
  const out = spec.build(state.d, state.tk, DS());
  if (out.empty) { toast("No hay datos para ampliar con estos filtros.", "info"); return; }
  $("modalTitle").textContent = spec.title;
  const ctx = filtrosActivos().map((k) => `${dimLabel(k)}: ${state.filtros[k]}`).join(" · ");
  $("modalSub").textContent = `${DS().titulo} · ${spec.subFn ? spec.subFn() : spec.sub}${ctx ? " · " + ctx : ""}`;
  modalReturnFocus = document.activeElement;
  $("modal").hidden = false;
  document.body.classList.add("modal-open");
  if (modalChart) modalChart.destroy();
  const cfg = wire(spec, out, out.config);
  if (cfg.type === "doughnut") cfg.options.plugins.legend = merge(legendCfg(state.tk, true), { position: "right" });
  if (cfg.type === "bar" && cfg.options.indexAxis === "y") cfg.options.scales.y.ticks.callback = function (v) { const l = this && this.getLabelForValue ? this.getLabelForValue(v) : v; return trunc(l, 60); };
  modalChart = new Chart($("modalCanvas"), cfg);
  setTimeout(() => $("modalClose").focus(), 30);
}
function cerrarModal() {
  if ($("modal").hidden) return;
  $("modal").hidden = true;
  document.body.classList.remove("modal-open");
  if (modalChart) { modalChart.destroy(); modalChart = null; }
  if (modalReturnFocus && modalReturnFocus.focus) modalReturnFocus.focus();
}

/* =========================== EXPORTAR =========================== */
function descargarPNG(id) {
  const ch = charts[id];
  const spec = SPECS.find((c) => c.id === id);
  if (!ch || !spec) { toast("Este gráfico no tiene datos para exportar.", "info"); return; }
  const a = document.createElement("a");
  a.href = ch.toBase64Image("image/png", 1);
  a.download = `${slug(DS().titulo)}_${slug(spec.title)}_${new Date().toISOString().slice(0, 10)}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  toast(`Imagen descargada: ${spec.title}`, "ok", 2600);
}
function descargarCSV(def, nombre) {
  const q = (v) => { const s = v == null ? "" : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const A = acceso(def);
  const val = (i, c) => { const v = A.val(i, c); return typeof v === "string" && v.startsWith("(") ? "" : v; };
  const lines = [A.head.map((h) => q(h.t)).join(",")];
  for (let i = 0; i < A.n; i++) lines.push(A.head.map((_, c) => q(val(i, c))).join(","));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const suf = [state.filtros.desde, state.filtros.hasta, ...filtrosActivos().map((k) => slug(trunc(state.filtros[k], 24)))].filter(Boolean).join("_");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${nombre}${suf ? "_" + suf : ""}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`CSV descargado: ${fmt(A.n)} filas`, "ok", 2600);
}
function exportarCSV(id) {
  if (!state.d) return;
  const det = id || DS().secs.flatMap((s) => s.items.map((i) => i[0])).find((x) => /^tDet/.test(x));
  const x = TLIB[det];
  if (!x) return;
  descargarCSV(x.table(state.d), `${slug(DS().titulo)}_${slug(txt(x.title))}`);
}

/* =========================== TOASTS =========================== */
function toast(texto, tipo = "info", ms = 4200) {
  const t = document.createElement("div");
  t.className = `toast ${tipo}`;
  const ico = { ok: "fa-circle-check", error: "fa-circle-exclamation", info: "fa-circle-info", new: "fa-bolt" }[tipo] || "fa-circle-info";
  t.innerHTML = `<i class="fas ${ico}"></i><span>${esc(texto)}</span><button type="button" class="toast-x" aria-label="Cerrar aviso"><i class="fas fa-xmark"></i></button>`;
  const close = () => { t.classList.add("out"); setTimeout(() => t.remove(), 260); };
  t.querySelector(".toast-x").addEventListener("click", close);
  $("toasts").appendChild(t);
  setTimeout(close, ms);
}

/* =========================== DATOS: CARGA Y SINCRONIZACIÓN =========================== */
function firma(rowIndex, meta) { return `${rowIndex}|${(meta && meta.uploadedAt) || "legacy"}`; }
const firmaPub = (pub) => (pub ? firma(pub.row_index, pub.meta) : null);

// Consulta liviana: la última versión de los 8 tableros (sin traer los datos)
async function consultarPublicados() {
  const sheets = DS_KEYS.map((k) => DATASETS[k].sheet);
  const { data, error } = await sb.from(CONFIG.TABLE)
    .select("sheet_name, row_index, meta:data->meta")
    .in("sheet_name", sheets)
    .order("row_index", { ascending: false });
  if (error) throw error;
  const ult = {};
  (data || []).forEach((r) => { if (!ult[r.sheet_name]) ult[r.sheet_name] = r; });
  sheets.forEach((s) => { PUB[s] = ult[s] || null; });
  PUB._checked = true;
  // Los tableros guardados en memoria con una versión vieja se vuelven a leer al abrirlos
  DS_KEYS.forEach((k) => {
    if (k === state.ds) return;
    const st = STORE[k], pub = PUB[DATASETS[k].sheet];
    if (st.signature && (!pub || firmaPub(pub) !== st.signature)) { st.payload = null; st.filas = []; st.signature = null; }
  });
  renderBoardNav();
  return PUB;
}

async function fetchDataset(key) {
  const { data, error } = await sb.from(CONFIG.TABLE)
    .select("row_index, data")
    .eq("sheet_name", DATASETS[key].sheet)
    .order("row_index", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data && data[0] ? data[0] : null;
}

function setSync(modo, texto) {
  const s = $("syncStatus");
  s.dataset.mode = modo;
  $("syncText").textContent = texto;
}
function pintarSync() {
  if (!state.lastSync) return;
  if ($("syncStatus").dataset.mode === "error") return;
  setSync("live", `En vivo · ${relTime(state.lastSync)}`);
  $("stSync").textContent = relTime(state.lastSync);
  if (state.uploadedAt) { $("stPublicado").textContent = relTime(state.uploadedAt); const bm = $("bhMeta"); if (bm) bm.innerHTML = `<i class="fas fa-cloud-arrow-up"></i>Publicado ${relTime(state.uploadedAt)}`; }
}
function pintarStatus() {
  const m = (state.payload && state.payload.meta) || {};
  $("stArchivo").textContent = m.archivo || "—";
  $("stArchivo").title = m.archivo || "";
  $("stHoja").textContent = m.hoja || DS().tab;
  $("stRegistros").textContent = state.payload ? fmt(state.filas.length) : "—";
  $("stPeriodo").textContent = state.rango.min ? `${fdia(state.rango.min)} – ${fdia(state.rango.max)}` : m.desde ? `${fdia(m.desde)} – ${fdia(m.hasta)}` : "—";
  $("stPublicado").textContent = state.uploadedAt ? relTime(state.uploadedAt) : "—";
  $("stPublicado").title = state.uploadedAt ? new Date(state.uploadedAt).toLocaleString("es-PE") : "";
  const bm = $("bhMeta");
  if (bm) bm.innerHTML = state.uploadedAt ? `<i class="fas fa-cloud-arrow-up"></i>Publicado ${relTime(state.uploadedAt)}${m.archivo ? ` · <span title="${esc(m.archivo)}">${esc(trunc(m.archivo, 34))}</span>` : ""}` : "";
}

/**
 * Carga completa del tablero actual desde Supabase.
 * motivo: "inicial" | "manual" | "nuevo" | "aviso" | "visible" | "tablero"
 */
function cargarDatos(motivo = "inicial") {
  if (state.loading) return state.loading;
  const key = state.ds;
  const inicial = !state.payload;
  document.body.classList.add(inicial ? "is-loading" : "is-refreshing");
  document.querySelectorAll(".js-refresh").forEach((b) => { b.disabled = true; b.classList.add("is-loading"); });
  setSync("syncing", "Sincronizando…");

  state.loading = (async () => {
    try {
      const firmaPrev = state.signature;
      await consultarPublicados().catch((e) => console.warn("Consulta de tableros falló:", e));
      let row = await fetchDataset(key);
      const debeEsperar = motivo === "aviso" || motivo === "nuevo" || !!state.payload;
      for (let i = 0; !row && debeEsperar && i < 3; i++) { await sleep(600 * (i + 1)); row = await fetchDataset(key); }
      if (key !== state.ds) return;          // el usuario cambió de tablero mientras cargaba
      await aplicarRow(row);
      state.lastSync = new Date();
      state.error = null;
      pintarSync();
      renderBoardNav();
      if (motivo === "manual") toast(firmaPrev && firmaPrev === state.signature ? "Ya tenés los datos más recientes." : "Datos actualizados desde Supabase.", "ok", 2800);
      else if ((motivo === "nuevo" || motivo === "aviso") && firmaPrev && firmaPrev !== state.signature) toast(`Llegó una versión nueva de «${DS().tab}»: el tablero se actualizó.`, "new", 5000);
    } catch (err) {
      console.error(err);
      state.error = err;
      setSync("error", "Sin conexión · reintentando");
      if (!state.payload) mostrarEstadoGlobal("error", err);
      else if (motivo === "manual") toast("No se pudo actualizar: " + (err.message || err), "error", 6000);
    } finally {
      document.body.classList.remove("is-loading", "is-refreshing");
      document.querySelectorAll(".js-refresh").forEach((b) => { b.disabled = false; b.classList.remove("is-loading"); });
      state.loading = null;
    }
  })();
  return state.loading;
}

async function aplicarRow(row) {
  const ds = DS();
  const enc = row && row.data ? await descomprimir(row.data) : null;
  const filas = enc ? decodificar(enc) : [];
  if (!filas.length) {
    state.payload = null; state.filas = []; state.signature = row ? firma(row.row_index, row.data && row.data.meta) : null;
    state.rango = { min: "", max: "" }; state.uploadedAt = null;
    Object.keys(charts).forEach((id) => { charts[id].destroy(); delete charts[id]; });
    pintarStatus();
    mostrarEstadoGlobal("vacio");
    guardarStore();
    return;
  }
  const meta = row.data.meta || {};
  state.signature = firma(row.row_index, meta);
  state.payload = { meta, kpis: row.data.kpis };
  state.uploadedAt = meta.uploadedAt || null;
  state.filas = ENGINES[ds.engine].prep(filas, meta, ds);
  state.dims = calcDims(state.filas);
  state.rango = { min: state.dims.fechas[0] || "", max: state.dims.fechas[state.dims.fechas.length - 1] || "" };

  FILTER_KEYS().forEach((k) => { if (state.filtros[k] && !(state.dims[k] || []).includes(state.filtros[k])) state.filtros[k] = ""; });
  if (state.filtros.desde && state.filtros.desde > state.rango.max) state.filtros.desde = "";
  if (state.filtros.hasta && state.filtros.hasta < state.rango.min) state.filtros.hasta = "";

  pintarStatus();
  mostrarEstadoGlobal(null);
  render({ force: true });
  guardarStore();
}

function mostrarEstadoGlobal(tipo, err) {
  const g = $("globalState");
  document.body.classList.toggle("no-data", !!tipo);
  if (!tipo) { g.innerHTML = ""; return; }
  SEC_KEYS().forEach((k) => { const s = $("sec-" + k); if (s) s.hidden = true; });
  $("filterbar").innerHTML = ""; $("contextBar").innerHTML = ""; cerrarPanel();
  const ds = DS();
  $("crumbs").innerHTML = `<span class="crumb-sec"><i class="fas ${ds.icon}"></i>${ds.titulo}</span><i class="fas fa-chevron-right crumb-sep"></i><span class="crumb-filters">Sin datos</span>`;
  const otros = DS_KEYS.filter((k) => k !== state.ds && PUB[DATASETS[k].sheet]);
  g.innerHTML = tipo === "vacio"
    ? `<div class="global-empty">
         <span class="ge-ico"><i class="fas fa-file-excel"></i></span>
         <h2>«${ds.titulo}» todavía no tiene datos</h2>
         <p>Cargá el Excel <b>${esc(FILES[ds.file].excel)}</b> (pestaña «${esc(ds.tab)}») en la pantalla de inicio. Apenas lo publiques, este tablero se actualiza solo.</p>
         <a class="btn-primary js-go-home" href="${CONFIG.HOME_URL}"><i class="fas fa-file-arrow-up"></i>Cargar Excel</a>
         ${otros.length ? `<p class="ge-alt">Con datos ahora: ${otros.map((k) => `<a href="#${k}/${DATASETS[k].secs[0].k}" class="ge-link" data-ds="${k}">${DATASETS[k].titulo}</a>`).join(" · ")}</p>` : ""}
       </div>`
    : `<div class="global-empty is-error">
         <span class="ge-ico"><i class="fas fa-plug-circle-xmark"></i></span>
         <h2>No se pudo leer el tablero</h2>
         <p>${esc((err && err.message) || "Revisá tu conexión a internet.")}</p>
         <button type="button" class="btn-primary js-refresh"><i class="fas fa-rotate"></i>Reintentar</button>
       </div>`;
}

/* Chequeo liviano: solo trae la versión de cada tablero, no los datos */
async function hayNovedades() {
  if (state.loading || document.visibilityState !== "visible") return;
  try {
    await consultarPublicados();
    state.lastSync = new Date();
    if (state.error) { state.error = null; setSync("live", "En vivo"); }
    const pub = PUB[DS().sheet];
    if (!pub) { if (state.payload) await cargarDatos("nuevo"); else pintarSync(); return; }
    if (firmaPub(pub) !== state.signature) await cargarDatos("nuevo");
    else pintarSync();
  } catch (err) {
    console.warn("Chequeo de novedades falló:", err);
    setSync("error", "Sin conexión · reintentando");
  }
}
const hayNovedadesDebounced = debounce(hayNovedades, 400);

function iniciarSincronizacion() {
  let ultimoAviso = 0;
  const alAviso = (msg) => {
    if (!msg || msg.type !== "data-updated" || msg.at === ultimoAviso) return;   // llega por BroadcastChannel y por storage
    ultimoAviso = msg.at;
    const sheets = msg.sheets || [];
    if (!sheets.length || sheets.includes(DS().sheet)) cargarDatos("aviso");
    else consultarPublicados().catch(() => {});
    if (sheets.length) {
      const nombres = sheets.map(dsOf).filter(Boolean).filter((k) => k !== state.ds).map((k) => DATASETS[k].titulo);
      if (nombres.length) toast(`Datos nuevos en: ${nombres.join(", ")}`, "new", 5000);
    }
  };
  // 1) Aviso inmediato desde la pestaña de carga (mismo navegador)
  try { const bc = new BroadcastChannel(CONFIG.BUS); bc.onmessage = (e) => alAviso(e.data); } catch (_) {}
  window.addEventListener("storage", (e) => { if (e.key === CONFIG.LS_UPLOAD && e.newValue) { try { alAviso(JSON.parse(e.newValue)); } catch (_) {} } });
  // 2) Supabase Realtime (si está habilitado para la tabla; si no, no molesta)
  try { sb.channel("core-dia-cero-data").on("postgres_changes", { event: "*", schema: "public", table: CONFIG.TABLE }, () => hayNovedadesDebounced()).subscribe(); } catch (_) {}
  // 3) Al volver a la pestaña / ventana
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") hayNovedadesDebounced(); });
  window.addEventListener("focus", hayNovedadesDebounced);
  // 4) Restaurado desde el historial (bfcache)
  window.addEventListener("pageshow", (e) => { if (e.persisted) cargarDatos("visible"); });
  // 5) Sondeo liviano
  setInterval(hayNovedades, CONFIG.POLL_MS);
  setInterval(pintarSync, 15000);
  // 6) Vuelve la red
  window.addEventListener("online", () => cargarDatos("visible"));
}

/* =========================== TEMA =========================== */
function setTheme(t, { rerender = true } = {}) {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem(CONFIG.LS_THEME, t); } catch (_) {}
  const b = $("btnTheme");
  b.innerHTML = `<i class="fas ${t === "dark" ? "fa-sun" : "fa-moon"}"></i>`;
  b.title = `Cambiar a tema ${t === "dark" ? "claro" : "oscuro"} (tecla T)`;
  if (rerender && state.payload) render({ force: true });
}
function toggleTheme() { setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"); }

/* =========================== EVENTOS =========================== */
function engancharEventos() {
  document.addEventListener("click", (e) => {
    const t = e.target;
    const board = t.closest(".board[data-ds], .ge-link[data-ds]");
    if (board) { e.preventDefault(); cambiarDataset(board.dataset.ds); return; }
    const tab = t.closest("#dashTabs .tab");
    if (tab) { e.preventDefault(); cambiarSeccion(tab.dataset.seccion); return; }

    const home = t.closest(".js-go-home");
    if (home) { e.preventDefault(); window.location.href = `${CONFIG.HOME_URL}?t=${Date.now()}`; return; }

    if (t.closest(".js-refresh")) { cargarDatos("manual"); return; }
    if (t.closest("#btnTheme")) { toggleTheme(); return; }

    const info = t.closest(".js-info");
    if (info) {
      e.stopPropagation();
      if (popState.btn === info && popState.pinned) cerrarPopover(); else mostrarPopover(info, true);
      return;
    }
    if (!t.closest("#popover") && popState.pinned) cerrarPopover();

    const fo = t.closest(".js-fopen");
    if (fo) { e.stopPropagation(); abrirPanel(fo); return; }
    if (t.closest(".js-more")) { state.moreOpen = !state.moreOpen; cerrarPanel(); renderFiltros(); return; }
    const opt = t.closest(".fp-opt");
    if (opt) { setFiltro($("fpanel").dataset.dim, opt.dataset.value); return; }
    const pre = t.closest(".fp-preset");
    if (pre) { aplicarPreset(pre); return; }
    if (t.closest(".js-fp-apply")) { setFecha($("fpDesde").value, $("fpHasta").value); return; }
    if (!t.closest("#fpanel") && fpState.dim) cerrarPanel();

    const pg = t.closest(".js-page");
    if (pg) { state.page[pg.dataset.table] = +pg.dataset.page; pintarTabla(pg.dataset.table); return; }

    if (t.closest(".js-clear")) { limpiarFiltros(); return; }
    if (t.closest(".js-csv")) { exportarCSV(); return; }
    const csvT = t.closest(".js-csv-table");
    if (csvT) { exportarCSV(csvT.dataset.table); return; }
    const rm = t.closest(".js-remove-filter");
    if (rm) { setFiltro(rm.dataset.dim, ""); return; }

    const card = t.closest(".chart-card");
    if (card && t.closest(".js-table")) {
      const btn = t.closest(".js-table");
      const on = !card.classList.contains("show-table");
      card.classList.toggle("show-table", on);
      card.querySelector(".table-view").hidden = !on;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.innerHTML = `<i class="fas ${on ? "fa-chart-simple" : "fa-table-list"}"></i>`;
      btn.title = on ? "Ver como gráfico" : "Ver como tabla";
      return;
    }
    if (card && t.closest(".js-expand")) { abrirModal(card.dataset.chart); return; }
    if (card && t.closest(".js-png")) { descargarPNG(card.dataset.chart); return; }

    const dl = t.closest(".dl-item");
    if (dl) {
      const out = outs[dl.dataset.chart];
      const cond = out && out.drill && out.drill({ index: +dl.dataset.index, datasetIndex: 0 });
      if (cond) abrirDrill(cond);
      return;
    }
    const th = t.closest(".th-sort");
    if (th) {
      const id = th.dataset.table, col = +th.dataset.col;
      const s = state.sort[id];
      state.sort[id] = s && s.col === col ? { col, dir: s.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" };
      state.page[id] = 0;
      pintarTabla(id);
      return;
    }
    const tr = t.closest("tr.is-clickable");
    if (tr) { const tb = tables[tr.dataset.table]; const c = tb && tb.def._a && tb.def._a.cond(+tr.dataset.row); if (c) abrirDrill(c); return; }

    const ins = t.closest(".insight-btn[data-insight]");
    if (ins) { const host = ins.closest(".card-body"); const c = host && host._conds && host._conds[+ins.dataset.insight]; if (c) abrirDrill(c); return; }

    if (t.closest("#drawerClose") || t.closest("#scrim")) { cerrarDrill(); return; }
    if (t.closest("#modalClose") || t === $("modal")) { cerrarModal(); return; }
  });

  const buscarTabla = debounce((id) => { state.page[id] = 0; pintarTabla(id); }, 180);
  const buscarPanel = debounce((q) => filtrarPanel(q), 120);
  document.addEventListener("input", (e) => {
    const ts = e.target.closest(".tbl-search input");
    if (ts) { state.q[ts.dataset.table] = ts.value; buscarTabla(ts.dataset.table); return; }
    if (e.target.id === "fpSearch") buscarPanel(e.target.value);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "fpSearch") {
      const first = document.querySelector("#fpanel .fp-list li[data-opt] .fp-opt");
      if (first) { e.preventDefault(); first.click(); }
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.target.closest && e.target.closest("#fpanel")) {
      const items = Array.from(document.querySelectorAll("#fpanel .fp-opt, #fpanel #fpSearch"));
      const i = items.indexOf(document.activeElement);
      const nxt = items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (nxt) { e.preventDefault(); nxt.focus(); }
    }
  });

  document.addEventListener("mouseover", (e) => {
    const b = e.target.closest(".js-info");
    if (!b || popState.pinned) return;
    clearTimeout(popState.timer);
    popState.timer = setTimeout(() => mostrarPopover(b, false), 140);
  });
  document.addEventListener("mouseout", (e) => {
    const b = e.target.closest(".js-info");
    if (!b || popState.pinned) return;
    clearTimeout(popState.timer);
    if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest(".js-info")) cerrarPopover();
  });
  document.addEventListener("focusin", (e) => { const b = e.target.closest && e.target.closest(".js-info"); if (b && !popState.pinned) mostrarPopover(b, false); });
  document.addEventListener("focusout", (e) => { const b = e.target.closest && e.target.closest(".js-info"); if (b && !popState.pinned) cerrarPopover(); });
  window.addEventListener("scroll", () => { if (popState.btn && !popState.pinned) cerrarPopover(); posicionarPanel(); }, { passive: true });
  window.addEventListener("resize", debounce(() => { if (popState.btn) mostrarPopover(popState.btn, popState.pinned); posicionarPanel(); }, 100));

  document.addEventListener("mouseover", (e) => {
    const dl = e.target.closest(".dl-item");
    if (!dl) return;
    const ch = charts[dl.dataset.chart];
    if (!ch) return;
    const i = +dl.dataset.index;
    ch.$focus = { i, ds: 0 };
    ch.setActiveElements([{ datasetIndex: 0, index: i }]);
    ch.tooltip.setActiveElements([{ datasetIndex: 0, index: i }], { x: 0, y: 0 });
    ch.update("none");
  });
  document.addEventListener("mouseout", (e) => {
    const dl = e.target.closest(".dl-item");
    if (!dl || (e.relatedTarget && dl.contains(e.relatedTarget))) return;
    const ch = charts[dl.dataset.chart];
    if (!ch) return;
    ch.$focus = null; ch.setActiveElements([]); ch.tooltip.setActiveElements([], { x: 0, y: 0 }); ch.update("none");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (fpState.dim) { const b = fpState.btn; cerrarPanel(); if (b) b.focus(); return; }
      cerrarPopover(); cerrarDrill(); cerrarModal(); return;
    }
    const tr = e.target.closest && e.target.closest("tr.is-clickable");
    if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); tr.click(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (document.body.classList.contains("drawer-open") || document.body.classList.contains("modal-open")) return;
    const secs = SEC_KEYS();
    if (e.key >= "1" && e.key <= String(secs.length)) cambiarSeccion(secs[+e.key - 1]);
    else if (e.key === "[" || e.key === "]") { const i = DS_KEYS.indexOf(state.ds); cambiarDataset(DS_KEYS[(i + (e.key === "]" ? 1 : DS_KEYS.length - 1)) % DS_KEYS.length]); }
    else if (e.key === "r" || e.key === "R") cargarDatos("manual");
    else if (e.key === "t" || e.key === "T") toggleTheme();
  });

  window.addEventListener("hashchange", () => {
    const h = leerHash();
    if (h.ds && h.ds !== state.ds) { cambiarDataset(h.ds, { sec: h.sec, filtros: { desde: "", hasta: "", ...h.filtros } }); return; }
    const f = { desde: "", hasta: "", ...h.filtros };
    const same = ["desde", "hasta", ...FILTER_KEYS()].every((k) => (state.filtros[k] || "") === (f[k] || ""));
    if (!same) { state.filtros = f; if (h.sec && SEC_KEYS().includes(h.sec)) state.seccion = h.sec; render(); }
    else if (h.sec && h.sec !== state.seccion) cambiarSeccion(h.sec);
  });

  try {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (ev) => {
      let saved = null; try { saved = localStorage.getItem(CONFIG.LS_THEME); } catch (_) {}
      if (!saved) setTheme(ev.matches ? "dark" : "light");
    });
  } catch (_) {}
}

/* =========================== INICIO =========================== */
(async function init() {
  setupChartDefaults();
  const h = leerHash();
  let ini = h.ds;
  if (!ini) { try { ini = localStorage.getItem(CONFIG.LS_DATASET); } catch (_) {} }
  if (!DATASETS[ini]) ini = DS_KEYS[0];
  state.ds = ini;
  DS_FIELDS.forEach((f) => { state[f] = STORE[ini][f]; });
  if (h.ds) state.filtros = { desde: "", hasta: "", ...h.filtros };
  state.seccion = h.ds && SEC_KEYS().includes(h.sec) ? h.sec : SEC_KEYS()[0];
  construirLayout();
  setTheme(document.documentElement.getAttribute("data-theme") || "light", { rerender: false });
  engancharEventos();
  renderSeccion(state.seccion);   // esqueletos mientras llega Supabase
  writeHash();
  iniciarSincronizacion();
  await cargarDatos("inicial");
})();
