import { defineConfig } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { PMTiles } from 'pmtiles';

const require = createRequire(import.meta.url);
let VectorTile = null;
let PbfReader = null;
function importarDecodificadorMVT() {
  if (VectorTile && PbfReader) return true;
  try {
    ({ VectorTile } = require('@mapbox/vector-tile'));
    PbfReader = require('pbf').PbfReader;
    return !!(VectorTile && PbfReader);
  } catch {
    return false;
  }
}

// ==============================================================
// Yvy Explorer v3 — Manifest derivado
// Fuente de verdad: data/registry/<nivel>.csv
//   (un CSV por nivel: paises, provincias, departamentos, municipios…)
// Geometría:        public/data/<nivel>.pmtiles
//   (un PMTiles por nivel: provincias.pmtiles, departamentos.pmtiles,
//   municipios.pmtiles…; el plugin lee el header una vez por nivel y
//   asigna centro/zoom/bounds/capa interna a todos sus objetos. Si el
//   nivel no tiene archivo propio, busca el modo heredado uno por objeto)
//
// Centro por objeto: se decodifican los tiles del nivel en el build y
// se calcula el centroide real de cada feature (id del archivo vs
// yvy_id del CSV). Resultado cacheado en <nivel>_centros.json, que se
// regenera solo si cambia el archivo de geometría.
//
// El build emite:
//   public/data/manifest.json                    — catálogo completo
//   public/data/tabla_provincias_yvy_join.json   — provincias alineadas
//     a yvy_id 1000-1023 con pais_yvy_id=0 y pais_georef_id=ARG
//
// Sin CSVs o sin PMTiles el build NO rompe: genera un manifest
// vacío y avisa por consola qué falta. Es intencional: el proyecto
// se replica en otra PC soltando archivos, sin tocar código.
// ==============================================================

const DATA_DIR = path.resolve('public/data');
const REGISTRY_DIR = path.resolve('data/registry');

const ORDEN_NIVEL = ['pais', 'provincia', 'depto', 'municipio', 'concesion'];
const ZOOM_DEFAULT = { pais: 3.5, provincia: 7, depto: 11, municipio: 13, concesion: 14 };
const CENTRO_DEFAULT = [-60, -20];
const RANGO_YVY = { pais: [0, 999], provincia: [1000, 1999], depto: [10000, 19999], municipio: [100000, 999999], concesion: [30000, 99999] };

// Zoom de escaneo para el cálculo de centros (detalle suficiente y tiles acotados)
const ZSCAN = { pais: 4, provincia: 7, depto: 10, municipio: 12, concesion: 12 };

// Columna de parent (y las alternativas) por nivel
const COL_PADRE = {
  pais: null,
  provincia: ['pais_yvy_id', 'parent_yvy_id'],
  depto: ['prov_yvy_id', 'provincia_yvy_id', 'parent_yvy_id'],
  municipio: ['depto_yvy_id', 'prov_yvy_id', 'parent_yvy_id'],
  concesion: ['parent_yvy_id'],
};

// Columna de id IGN (y alternativas) por nivel
const COL_ID_IGN = {
  pais: ['id_ign'],
  provincia: ['prov_id_ign', 'id_ign'],
  depto: ['depto_id_ign', 'prov_id_ign', 'id_ign'],
  municipio: ['depto_id_ign', 'id_ign'],
  concesion: ['id_ign'],
};

const PLURAL = { pais: 'paises', provincia: 'provincias', depto: 'deptos', municipio: 'municipios', concesion: 'concesiones' };
const SINGULAR = { paises: 'pais', provincias: 'provincia', deptos: 'depto', departamentos: 'depto', municipios: 'municipio', concesiones: 'concesion' };

/** Nombre del archivo único por nivel (public/data/<archivo>.pmtiles). */
const ARCHIVO_NIVEL = {
  pais: 'paises',
  provincia: 'provincias',
  depto: 'departamentos',
  municipio: 'municipios',
  concesion: 'concesiones',
};

/** Nombre de archivo esperado por nivel (formato corto). */
const ARCHIVOS_NIVEL = {
  'paises.csv': 'pais',
  'provincias.csv': 'provincia',
  'departamentos.csv': 'depto',
  'municipios.csv': 'municipio',
  'concesiones.csv': 'concesion',
};

/** Nivel desde el nombre del archivo (acepta corto y convención anterior). */
function nivelDeArchivo(archivo) {
  const corto = ARCHIVOS_NIVEL[archivo.toLowerCase()];
  if (corto) return corto;
  const cap = archivo.match(/^tabla_([a-z]+)_yvy_join\.csv$/i)?.[1].toLowerCase();
  return cap ? (SINGULAR[cap] || cap) : null;
}

// --------------------------------------------------------------
// CSV (formato RFC4180 básico: comillas dobles y saltos internos)
// --------------------------------------------------------------
function parsearCSV(texto) {
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1); // BOM
  const filas = [];
  let fila = [];
  let celda = '';
  let enComillas = false;
  const push = () => {
    fila.push(celda.trim());
    celda = '';
  };
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"' && texto[i + 1] === '"') { celda += '"'; i++; }
      else if (c === '"') enComillas = false;
      else celda += c;
    } else if (c === '"') {
      enComillas = true;
    } else if (c === ',') {
      push();
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      push();
      if (fila.some((v) => v !== '')) filas.push(fila);
      fila = [];
    } else {
      celda += c;
    }
  }
  push();
  if (fila.some((v) => v !== '')) filas.push(fila);
  return filas;
}

function aColumnas(encabezados, fila) {
  const cols = {};
  fila.forEach((v, i) => {
    if (encabezados[i]) cols[normalizar(encabezados[i])] = v;
  });
  return cols;
}

function normalizar(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/\s+/g, ''));
  return Number.isFinite(n) ? n : null;
}

// --------------------------------------------------------------
// Header PMTiles v3 (127 bytes, campos u64 fijos) + metadatos JSON
// --------------------------------------------------------------
function leerHeaderPMTiles(buf) {
  if (buf.length < 127 || buf.toString('latin1', 0, 7) !== 'PMTiles') return null;
  try {
    const spec = buf.readUInt8(7);
    if (spec !== 3) return null;
    const minZoom = buf.readUInt8(100);
    const maxZoom = buf.readUInt8(101);
    const minLon = buf.readInt32LE(102) / 1e7;
    const minLat = buf.readInt32LE(106) / 1e7;
    const maxLon = buf.readInt32LE(110) / 1e7;
    const maxLat = buf.readInt32LE(114) / 1e7;
    const centerZoom = buf.readUInt8(118);
    const centerLon = buf.readInt32LE(119) / 1e7;
    const centerLat = buf.readInt32LE(123) / 1e7;
    const ok = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
    if (!ok(minLon, -180, 180) || !ok(maxLon, -180, 180) || !ok(minLat, -90, 90) || !ok(maxLat, -90, 90)) return null;
    if (minZoom < 0 || maxZoom > 22 || maxZoom < minZoom) return null;
    return {
      minZoom, maxZoom,
      bounds: [minLon, minLat, maxLon, maxLat],
      center: ok(centerLon, -180, 180) && ok(centerLat, -90, 90) ? [centerLon, centerLat] : null,
      centerZoom,
    };
  } catch {
    return null;
  }
}

async function leerMetadatosPMTiles(ruta) {
  try {
    const buf = await fs.readFile(ruta);
    const h = leerHeaderPMTiles(buf);
    if (!h) return null;
    const off = Number(buf.readBigUInt64LE(24));
    const len = Number(buf.readBigUInt64LE(32));
    if (len > 0 && off + len <= buf.length) {
      try {
        const raw = buf.subarray(off, off + len);
        let json;
        try {
          json = JSON.parse(gunzipSync(raw).toString('utf8'));
        } catch {
          json = JSON.parse(raw.toString('utf8'));
        }
        if (Array.isArray(json.bounds) && json.bounds.length === 4) h.bounds = json.bounds.map(Number);
        if (Array.isArray(json.center)) h.center = [Number(json.center[0]), Number(json.center[1])];
        if (Array.isArray(json.vector_layers) && json.vector_layers.length > 0) h.capaInterna = json.vector_layers[0].id;
      } catch {}
    }
    return h;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------
// Centros reales por objeto: decodifica los tiles del nivel (MVT)
// y guarda el centroide de cada feature por su id (id o yvy_id).
// Cacheado en public/data/<nivel>_centros.json (mtime+size).
// --------------------------------------------------------------
const EXTENT_POR_DEFECTO = 4096;
const LAT_MIN_PARA_CENTRO = -60; // el territorio al sur del paralelo -60° (sector antártico) no cuenta para el centro del objeto

function yDeLatMercator(lat, n) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
}

function lngDeTile(x, z) {
  return (x / 2 ** z) * 360 - 180;
}

function latDeTile(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function anilloCentroide(pts) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  a /= 2;
  if (a === 0) return null;
  return { x: cx / (6 * a), y: cy / (6 * a), w: Math.abs(a) };
}

/**
 * Centros reales por id para un nivel (una vez por archivo, con caché).
 * @returns {{archivo: string, size: number, mtimeMs: number, porId: Record<string, [lng, lat]>}}
 */
async function leerCentrosNivel(nivel, metaNivel) {
  const ruta = path.join(DATA_DIR, metaNivel.rel);
  const st = await fs.stat(ruta);
  const cachePath = path.join(DATA_DIR, `${path.basename(metaNivel.rel, '.pmtiles')}_centros.json`);
  let cache = null;
  try {
    cache = JSON.parse(await fs.readFile(cachePath, 'utf8'));
  } catch {}
  if (cache && cache.v === 5 && cache.archivo === metaNivel.rel && cache.size === st.size && cache.mtimeMs === st.mtimeMs && cache.porId) {
    return cache;
  }
  if (!importarDecodificadorMVT()) {
    console.warn(`[yvy-manifest] ⚠ no se pudo cargar el decodificador MVT (¿faltan pbf/@mapbox/vector-tile?) — centros aproximados por nivel.`);
    return { archivo: metaNivel.rel, size: st.size, mtimeMs: st.mtimeMs, porId: {} };
  }

  const data = await fs.readFile(ruta);
  const fuente = {
    getKey: () => ruta,
    getBytes: async (off, len) => {
      const fin = len ? off + len : data.length;
      const slice = data.subarray(off, Math.min(fin, data.length));
      return { data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) };
    },
  };
  const pt = new PMTiles(fuente);
  const h = metaNivel;
  const z = Math.min(Math.max(ZSCAN[nivel] ?? 10, h.minZoom), h.maxZoom);
  const n = 2 ** z;
  const [minLon, minLat, maxLon, maxLat] = h.bounds;
  const x0 = Math.floor(((minLon + 180) / 360) * n);
  const x1 = Math.floor(((maxLon + 180) / 360) * n);
  const y0 = yDeLatMercator(maxLat, n);
  const y1 = yDeLatMercator(minLat, n);

  const porId = {};
  const detalle = {};
  const idsObservados = new Set();
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      let resp;
      try {
        resp = await pt.getZxy(z, x, y);
      } catch {
        continue;
      }
      if (!resp || !resp.data || resp.data.byteLength === 0) continue;
      try {
        const vt = new VectorTile(new PbfReader(new Uint8Array(resp.data)));
        for (const layer of Object.values(vt.layers)) {
          const extent = layer.extent || EXTENT_POR_DEFECTO;
          for (let i = 0; i < layer.length; i++) {
            const feat = layer.feature(i);
            const id = String(feat.properties.id ?? feat.properties.yvy_id ?? '').trim();
            if (!id) continue;
            idsObservados.add(id);
            for (const ring of feat.loadGeometry()) {
              if (ring.length < 3) continue;
              const c = anilloCentroide(ring);
              if (!c) continue;
              const lng = lngDeTile(x + c.x / extent, z);
              const lat = latDeTile(y + c.y / extent, z);
              const isAntarctic = lat < LAT_MIN_PARA_CENTRO;
              const isTDFAntarctic = isAntarctic && id === '1023';
              if (isAntarctic && !isTDFAntarctic) continue;
              let minLon = Infinity;
              let maxLon = -Infinity;
              let minLat = Infinity;
              let maxLat = -Infinity;
              for (const p of ring) {
                const pl = lngDeTile(x + p.x / extent, z);
                const pa = latDeTile(y + p.y / extent, z);
                if (pl < minLon) minLon = pl;
                if (pl > maxLon) maxLon = pl;
                if (pa < minLat) minLat = pa;
                if (pa > maxLat) maxLat = pa;
              }
              (detalle[id] ??= []).push({ lng, lat, w: isAntarctic ? 0 : c.w, minLon, maxLon, minLat, maxLat });
            }
          }
        }
      } catch {}
    }
  }
  for (const id of Object.keys(detalle)) {
    const anillos = detalle[id].sort((a, b) => a.lng - b.lng);
    const segmentos = [[anillos[0]]];
    let actual = segmentos[0];
    let prev = anillos[0];
    for (let i = 1; i < anillos.length; i++) {
      if (anillos[i].lng - prev.lng > 2.2) {
        actual = [];
        segmentos.push(actual);
      }
      actual.push(anillos[i]);
      prev = anillos[i];
    }
    let principal = null;
    let wMayor = -1;
    for (const s of segmentos) {
      let w = 0;
      for (const a of s) w += a.w;
      if (w > wMayor) {
        wMayor = w;
        principal = s;
      }
    }
    let sl = 0;
    let st = 0;
    let sw = 0;
    for (const a of principal) {
      sl += a.lng * a.w;
      st += a.lat * a.w;
      sw += a.w;
    }
    // Bounds: unión de TODOS los segmentos (incluye islas alejadas como Malvinas)
    // Centro: solo del segmento principal (evita que islas tiren el centro lejos)
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const a of anillos) {
      if (a.minLon < minLon) minLon = a.minLon;
      if (a.maxLon > maxLon) maxLon = a.maxLon;
      if (a.minLat < minLat) minLat = a.minLat;
      if (a.maxLat > maxLat) maxLat = a.maxLat;
    }
    if (sw > 0 && isFinite(sl / sw) && isFinite(st / sw)) porId[id] = { c: [sl / sw, st / sw], b: [minLon, minLat, maxLon, maxLat] };
  }
  const out = { v: 5, archivo: metaNivel.rel, size: st.size, mtimeMs: st.mtimeMs, porId, observados: [...idsObservados] };
  await fs.writeFile(cachePath, JSON.stringify(out), 'utf8');
  console.log(`[yvy-manifest] centros reales de ${metaNivel.rel} calculados: ${Object.keys(porId).length} features con id.`);
  return out;
}

// --------------------------------------------------------------
// Búsqueda del PMTiles de un objeto (acepta <nivel>s/ e id/ y
// carpetas con nombre singular o plural)
// --------------------------------------------------------------
async function buscarPMTiles(nivel, yvyId) {
  const candidatos = [];
  for (const dir of [PLURAL[nivel] || `${nivel}s`, nivel]) {
    candidatos.push(path.join(DATA_DIR, dir, `${yvyId}.pmtiles`));
  }
  for (const c of candidatos) {
    try {
      await fs.access(c);
      return { rel: `${path.basename(path.dirname(c))}/${yvyId}.pmtiles`.replace(/\\/g, '/') };
    } catch {}
  }
  // Escaneo genérico por si la carpeta se llama distinto
  try {
    const sub = (await fs.readdir(DATA_DIR, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && /^(paises?|provincias?|deptos?|municipios?|concesiones?)$/i.test(e.name));
    for (const d of sub) {
      const c = path.join(DATA_DIR, d.name, `${yvyId}.pmtiles`);
      try {
        await fs.access(c);
        return { rel: `${d.name}/${yvyId}.pmtiles`.replace(/\\/g, '/') };
      } catch {}
    }
  } catch {}
  return null;
}

// --------------------------------------------------------------
// Construcción del catálogo desde los CSVs del registry
// --------------------------------------------------------------
async function construirManifest() {
  const fuentes = [];
  const objetos = [];
  const advertencias = [];
  const entradas = await fs.readdir(REGISTRY_DIR).catch(() => []);

  const csvs = entradas.filter((f) => nivelDeArchivo(f)).sort();
  if (csvs.length === 0) {
    advertencias.push('No hay CSVs en data/registry/. Copiá paises.csv, provincias.csv, departamentos.csv y municipios.csv cuando los tengas.');
  }

  // Un PMTiles por nivel: public/data/provincias.pmtiles, departamentos.pmtiles…
  // (modo heredado: carpetas <nivel>s/<yvy_id>.pmtiles, solo si falta el único)
  const pmtilesPorNivel = new Map();
  {
    const archivos = await fs.readdir(DATA_DIR).catch(() => []);
    for (const archivo of archivos.filter((f) => f.toLowerCase().endsWith('.pmtiles')).sort()) {
      const base = path.basename(archivo, '.pmtiles').toLowerCase();
      const nivel = SINGULAR[base] || base;
      if (!ORDEN_NIVEL.includes(nivel)) {
        advertencias.push(`public/data/${archivo}: nivel "${nivel}" desconocido (se ignoró). Niveles válidos: ${ORDEN_NIVEL.join(', ')}.`);
        continue;
      }
      const meta = await leerMetadatosPMTiles(path.join(DATA_DIR, archivo));
      if (!meta) {
        advertencias.push(`public/data/${archivo}: no se pudo leer el header (¿no es PMTiles v3?).`);
        continue;
      }
      if (pmtilesPorNivel.has(nivel)) {
        advertencias.push(`public/data/${archivo}: ya hay un PMTiles para el nivel "${nivel}" (se usa ${pmtilesPorNivel.get(nivel).rel}).`);
        continue;
      }
      meta.rel = archivo;
      pmtilesPorNivel.set(nivel, meta);
    }
  }

  // Centros reales por nivel (cacheados en <nivel>_centros.json)
  const centrosNivel = new Map();

  for (const archivo of csvs) {
    const nivel = nivelDeArchivo(archivo);
    if (!ORDEN_NIVEL.includes(nivel)) {
      advertencias.push(`CSV "${archivo}" con nivel desconocido "${nivel}" (ignorado). Niveles válidos: ${ORDEN_NIVEL.join(', ')}.`);
      continue;
    }
    const texto = await fs.readFile(path.join(REGISTRY_DIR, archivo), 'utf8');
    const filas = parsearCSV(texto);
    if (filas.length === 0) continue;
    const encabezados = filas[0];

    const col = (nombres) => {
      for (const n of nombres) {
        const i = encabezados.findIndex((e) => normalizar(e) === n);
        if (i >= 0) return i;
      }
      return -1;
    };
    const iYvy = col(['yvy_id', 'id']);
    const iGeoref = col(['georef_id', 'georef']);
    const iParents = COL_PADRE[nivel] ? COL_PADRE[nivel].map((n) => col([n])).filter((i) => i >= 0) : [];
    const iNombre = col(['nombre_oficial', 'nombre']);
    const iSup = col(['sup_oficial_km2', 'sup_km2']);
    const iFuente = col(['sup_fuente', 'fuente']);
    const iUrl = col(['sup_fuente_url', 'fuente_url']);
    const iFuenteCorta = col(['sup_fuente_corta', 'fuente_corta']);
    const iTipo = col(['sup_oficial_tipo', 'tipo_superficie']);
    const iIgn = col(COL_ID_IGN[nivel] || ['id_ign']);
    const iCapaInterna = col(['capa_interna', 'nombre_capa_interna']);
    const iVisible = col(['visible_en_dashboard', 'visible_dashboard']);
    if (iYvy < 0) {
      advertencias.push(`CSV "${archivo}" no tiene columna "yvy_id" (ignorado).`);
      continue;
    }

    let filasValidas = 0;
    let pmtilesOk = 0;
    let centrosReales = 0;
    const metaNivel = pmtilesPorNivel.get(nivel);
    if (metaNivel && !centrosNivel.has(nivel)) {
      centrosNivel.set(nivel, await leerCentrosNivel(nivel, metaNivel));
    }
    const centros = metaNivel ? centrosNivel.get(nivel) : null;
    for (let r = 1; r < filas.length; r++) {
      const f = filas[r];
      const c = aColumnas(encabezados, f);
      const yvyId = num(f[iYvy]);
      if (yvyId == null) continue;
      filasValidas++;

      const [lo, hi] = RANGO_YVY[nivel] || [0, 999999];
      if (yvyId < lo || yvyId > hi) {
        advertencias.push(`${archivo}: yvy_id ${yvyId} fuera del rango ${lo}-${hi} del nivel "${nivel}".`);
      }

      const obj = {
        ...c,
        yvy_id: yvyId,
        nivel,
        parent_yvy_id: (() => { for (const ip of iParents) { const v = num(f[ip]); if (v != null) return v; } return null; })(),
        georef_id: iGeoref >= 0 ? f[iGeoref] || null : null,
        nombre_oficial: iNombre >= 0 && f[iNombre] ? f[iNombre] : `Objeto ${yvyId}`,
        sup_oficial_km2: iSup >= 0 ? num(f[iSup]) : null,
        sup_fuente: iFuente >= 0 ? f[iFuente] || null : null,
        sup_fuente_url: iUrl >= 0 ? f[iUrl] || null : null,
        sup_fuente_corta: iFuenteCorta >= 0 ? f[iFuenteCorta] || null : null,
        sup_oficial_tipo: iTipo >= 0 ? f[iTipo] || null : null,
        prov_id_ign: iIgn >= 0 ? f[iIgn] || null : null,
        capa_interna: iCapaInterna >= 0 ? f[iCapaInterna] || null : null,
        visible_en_dashboard: iVisible >= 0 ? !/^(0|no|false)$/i.test(f[iVisible]) : true,
        minzoom: 0,
        maxzoom: 22,
        centro: null,
        zoom: null,
        pmtiles: null,
        tiene_geometria: false,
      };

      const pmtiles = metaNivel || (await buscarPMTiles(nivel, yvyId));
      if (pmtiles) {
        const meta = metaNivel || (await leerMetadatosPMTiles(path.join(DATA_DIR, pmtiles.rel)));
        if (meta) {
          obj.minzoom = meta.minZoom;
          obj.maxzoom = meta.maxZoom;
          obj.centro = meta.center || [(meta.bounds[0] + meta.bounds[2]) / 2, (meta.bounds[1] + meta.bounds[3]) / 2];
          obj.zoom = ZOOM_DEFAULT[nivel];
          obj.bounds = meta.bounds;
          obj.capa_interna = obj.capa_interna || meta.capaInterna || null;
          pmtilesOk++;
        } else {
          advertencias.push(`${archivo}: no se pudo leer el header de ${pmtiles.rel} (¿no es PMTiles v3?).`);
        }
        obj.pmtiles = pmtiles.rel;
        obj.tiene_geometria = true;
      } else {
        advertencias.push(`${archivo}: falta geometría para yvy_id ${yvyId} (${obj.nombre_oficial}). Esperado: public/data/${ARCHIVO_NIVEL[nivel] || PLURAL[nivel] || `${nivel}s`}.pmtiles (o ${PLURAL[nivel] || `${nivel}s`}/${yvyId}.pmtiles)`);
      }

      if (centros && centros.porId) {
        const cr = centros.porId[String(yvyId)];
        if (cr) {
          if (Array.isArray(cr.c)) {
            obj.centro = [cr.c[0], cr.c[1]];
            centrosReales++;
          }
          if (Array.isArray(cr.b)) obj.bounds_objeto = cr.b;
        }
      }

      if (!obj.centro) {
        obj.centro = obj.nivel === 'pais' ? CENTRO_DEFAULT : null;
        obj.zoom = obj.zoom || ZOOM_DEFAULT[nivel];
      }

      objetos.push(obj);
    }
    if (metaNivel && filasValidas > 0) {
      const conGeometria = new Set([...Object.keys(centros?.porId || {}), ...(centros?.observados || [])]);
      if (conGeometria.size < filasValidas) {
        advertencias.push(`${archivo}: ${conGeometria.size}/${filasValidas} features con id coincidente con yvy_id en ${metaNivel.rel}. Esperado: una sola propiedad "id" con el valor de yvy_id (id actual: ${Object.keys(centros?.porId || {}).slice(0, 5).join(', ') || 'ninguna propiedad id/yvy_id'}).`);
      }
    }
    fuentes.push({ nivel, archivo, filas: filasValidas, pmtiles: pmtilesOk, faltantes: filasValidas - pmtilesOk });
  }

  objetos.sort((a, b) => ORDEN_NIVEL.indexOf(a.nivel) - ORDEN_NIVEL.indexOf(b.nivel) || a.yvy_id - b.yvy_id);

  return { fuentes, objetos, advertencias };
}

// --------------------------------------------------------------
// JSON de provincias derivado (alineado 1000-1023 + padre ARG)
// --------------------------------------------------------------
function jsonProvincias(objetos, advertencias) {
  const provincias = objetos
    .filter((o) => o.nivel === 'provincia')
    .map((o) => {
      const p = {
        yvy_id: o.yvy_id,
        georef_id: o.georef_id,
        pais_yvy_id: o.parent_yvy_id ?? 0,
        pais_georef_id: 'ARG',
        nombre_oficial: o.nombre_oficial,
        sup_oficial_km2: o.sup_oficial_km2,
        sup_fuente: o.sup_fuente,
        sup_fuente_url: o.sup_fuente_url,
        sup_oficial_tipo: o.sup_oficial_tipo,
      };
      if (o.prov_id_ign) p.prov_id_ign = o.prov_id_ign;
      return p;
    });
  for (const p of provincias) {
    if (p.yvy_id < 1000 || p.yvy_id > 1023) {
      advertencias.push(`tabla_provincias_yvy_join.json: yvy_id ${p.yvy_id} (${p.nombre_oficial}) fuera del rango oficial 1000-1023.`);
    }
    if (p.pais_yvy_id !== 0) {
      advertencias.push(`tabla_provincias_yvy_join.json: ${p.nombre_oficial} tiene pais_yvy_id ${p.pais_yvy_id}; se normalizó a 0 (ARG).`);
    }
    if (p.pais_georef_id !== 'ARG') {
      advertencias.push(`tabla_provincias_yvy_join.json: ${p.nombre_oficial} tiene pais_georef_id ${p.pais_georef_id}; se normalizó a "ARG".`);
    }
  }
  return provincias;
}

// --------------------------------------------------------------
// Escritura de los archivos
// --------------------------------------------------------------
async function escribirManifest() {
  const { fuentes, objetos, advertencias } = await construirManifest();
  const manifest = {
    generado: Date.now(),
    schema: 'yvy-manifest-v3',
    fuentes,
    objetos,
  };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const provincias = jsonProvincias(objetos, advertencias);
  await fs.writeFile(path.join(DATA_DIR, 'tabla_provincias_yvy_join.json'), JSON.stringify(provincias, null, 2) + '\n', 'utf8');

  const contextPath = path.join(DATA_DIR, 'context.jsonld');
  try { await fs.access(contextPath); } catch {
    const ctx = {
      "@context": {
        "yvy": "https://yvyexplorer.org/id/",
        "yvyont": "https://yvyexplorer.org/ontology#",
        "schema": "https://schema.org/",
        "skos": "http://www.w3.org/2004/02/skos/core#",
        "geo": "http://www.opengis.net/ont/geosparql#",
        "dct": "http://purl.org/dc/terms/",
        "xsd": "http://www.w3.org/2001/XMLSchema#",
        "id": "@id",
        "type": "@type",
        "yvy_id": { "@id": "yvyont:identifier", "@type": "xsd:integer" },
        "nombre_oficial": "schema:name",
        "nivel": { "@id": "yvyont:nivel", "@type": "@id" },
        "parent_yvy_id": { "@id": "skos:broader", "@type": "@id" },
        "georef_id": "dct:identifier",
        "sup_oficial_km2": { "@id": "yvyont:supOficialKm2", "@type": "xsd:double" },
        "sup_fuente": "dct:source",
        "sup_fuente_corta": "dct:bibliographicCitation",
        "centro": { "@id": "geo:hasCentroid", "@type": "geo:wktLiteral" },
        "pmtiles": { "@id": "yvyont:pmtiles", "@type": "@id" },
        "tiene_geometria": { "@id": "yvyont:tieneGeometria", "@type": "xsd:boolean" },
        "bounds_objeto": { "@id": "geo:hasBoundingBox", "@type": "geo:wktLiteral" }
      }
    };
    await fs.writeFile(contextPath, JSON.stringify(ctx, null, 2) + '\n', 'utf8');
  }

  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
  const graph = objetos.map((o) => {
    const n = { "@id": `yvy:${o.yvy_id}`, "@type": `yvyont:${cap(o.nivel)}`, "yvy_id": o.yvy_id, "nombre_oficial": o.nombre_oficial, "nivel": `yvyont:${cap(o.nivel)}`, "tiene_geometria": !!o.tiene_geometria };
    if (o.parent_yvy_id != null) n["parent_yvy_id"] = { "@id": `yvy:${o.parent_yvy_id}` };
    if (o.georef_id) n["georef_id"] = String(o.georef_id);
    if (o.sup_oficial_km2 != null) n["sup_oficial_km2"] = o.sup_oficial_km2;
    if (o.sup_fuente) n["sup_fuente"] = o.sup_fuente;
    if (o.sup_fuente_corta) n["sup_fuente_corta"] = o.sup_fuente_corta;
    if (o.centro) n["centro"] = `POINT(${o.centro[0]} ${o.centro[1]})`;
    if (o.bounds_objeto) n["bounds_objeto"] = `BOX(${o.bounds_objeto.join(' ')})`;
    if (o.pmtiles) n["pmtiles"] = o.pmtiles;
    return n;
  });
  const jsonld = { "@context": "./context.jsonld", "@graph": graph, "generatedAt": new Date().toISOString(), "schema": "yvy-manifest-v3-jsonld", "count": graph.length };
  await fs.writeFile(path.join(DATA_DIR, 'manifest.jsonld'), JSON.stringify(jsonld, null, 2), 'utf8');

  for (const f of fuentes) {
    console.log(`[yvy-manifest] ${f.nivel.padEnd(10)} ${f.archivo}: ${f.filas} objetos, ${f.pmtiles}/${f.filas} con geometría`);
  }
  for (const w of advertencias) console.warn(`[yvy-manifest] ⚠ ${w}`);
  console.log(`[yvy-manifest] manifest.json + tabla_provincias_yvy_join.json generados (${objetos.length} objetos)`);
  console.log(`[yvy-manifest] context.jsonld + manifest.jsonld generados (${graph.length} nodos)`);
}

/** Plugin de Vite: regenera manifest.json en cada buildStart. */
function yvyManifest() {
  return {
    name: 'yvy-manifest',
    async buildStart() {
      try {
        await escribirManifest();
      } catch (err) {
        console.error('[yvy-manifest] error:', err);
      }
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [yvyManifest()],
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
