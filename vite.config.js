import { defineConfig } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { PMTiles } from 'pmtiles';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import { hashCanonico, payloadEntidad, payloadLinaje } from './src/js/canonico.js';
import {
  aplicarMigraciones,
  construirLedger,
  validarIdentidad,
} from './src/lib/identidad.js';

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
// Yvy Core v3 — Manifest derivado
// Fuente de verdad: data/registry/<nivel>.parquet
//   (un parquet por nivel: paises, provincias, departamentos, municipios…)
// Geometría:        public/data/<nivel>.pmtiles
//   (un PMTiles por nivel: provincias.pmtiles, departamentos.pmtiles,
//   municipios.pmtiles…; el plugin lee el header una vez por nivel y
//   asigna centro/zoom/bounds/capa interna a todos sus objetos. Si el
//   nivel no tiene archivo propio, busca el modo heredado uno por objeto)
//
// Centro por objeto: se decodifican los tiles del nivel en el build y
// se calcula el centroide real de cada feature (id del archivo vs
// yvy_id del parquet). Resultado cacheado en <nivel>_centros.json, que se
// regenera solo si cambia el archivo de geometría.
// Etiqueta: además se calcula el polylabel (polo de inaccesibilidad
// sobre ráster de la unión del segmento principal) como centro_etiqueta:
// punto INTERIOR del polígono para el label del mapa (cero mar).
//
// El build emite:
//   public/data/manifest.json   — catálogo completo
//   public/data/manifest.jsonld — grafo JSON-LD
//
// Sin parquets o sin PMTiles el build NO rompe: genera un manifest
// vacío y avisa por consola qué falta. Es intencional: el proyecto
// se replica en otra PC soltando archivos, sin tocar código.
// ==============================================================

const DATA_DIR = path.resolve('public/data');
const REGISTRY_DIR = path.resolve('data/registry');
const ONTOLOGIA_SRC = path.resolve('data/ontologia.json');
const IDS_EXCEPCIONES_SRC = path.resolve('data/ids.excepciones.json');
const RELACIONES_SRC = path.join(DATA_DIR, 'relaciones.json');

const ORDEN_NIVEL = ['pais', 'provincia', 'depto', 'municipio', 'barrio', 'concesion'];
const ZOOM_DEFAULT = { pais: 3.5, provincia: 7, depto: 11, municipio: 13, barrio: 15, concesion: 14 };
const CENTRO_DEFAULT = [-60, -20];
// Esquema yvy_id = offset + código oficial (disjuntos por nivel, chequeables
// por intervalo). municipio incluye los bloques reservados 2.000.000–2.199.999
// (ids no derivables: ver src/lib/identidad.js).
const RANGO_YVY = { pais: [0, 999], provincia: [1000, 1999], depto: [100000, 199999], municipio: [1000000, 2199999], barrio: [1000000000, 1999999999], concesion: [30000, 99999] };

// Zoom de escaneo para el cálculo de centros (detalle suficiente y tiles acotados)
const ZSCAN = { pais: 4, provincia: 7, depto: 10, municipio: 12, barrio: 14, concesion: 12 };

// Columna de parent (y las alternativas) por nivel — un solo padre, punto.
const COL_PADRE = {
  pais: null,
  provincia: ['pais_yvy_id', 'parent_yvy_id'],
  depto: ['prov_yvy_id', 'provincia_yvy_id', 'parent_yvy_id'],
  municipio: ['depto_yvy_id', 'parent_yvy_id'],
  barrio: ['municipio_yvy_id', 'parent_yvy_id'],
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

const PLURAL = { pais: 'paises', provincia: 'provincias', depto: 'deptos', municipio: 'municipios', barrio: 'barrios', concesion: 'concesiones' };
const SINGULAR = { paises: 'pais', provincias: 'provincia', deptos: 'depto', departamentos: 'depto', municipios: 'municipio', barrios: 'barrio', concesiones: 'concesion' };

/** Nombre del archivo único por nivel (public/data/<archivo>.pmtiles). */
const ARCHIVO_NIVEL = {
  pais: 'paises',
  provincia: 'provincias',
  depto: 'departamentos',
  municipio: 'municipios',
  barrio: 'barrios',
  concesion: 'concesiones',
};

/** Nombre de archivo esperado por nivel (formato corto, solo parquet). */
const ARCHIVOS_NIVEL = {
  'paises.parquet': 'pais',
  'provincias.parquet': 'provincia',
  'departamentos.parquet': 'depto',
  'municipios.parquet': 'municipio',
  'barrios.parquet': 'barrio',
  'concesiones.parquet': 'concesion',
};

/**
 * Registry unico: un solo parquet con todos los niveles (columna `nivel`).
 * Manda sobre los archivos por-nivel (se ignoran con aviso). Etiquetas
 * admitidas en la columna nivel -> nivel canonico del portal.
 */
const REGISTRO_UNICO = 'jurisdicciones.parquet';
const NIVEL_JURIS = {
  pais: 'pais',
  provincia: 'provincia',
  departamento: 'depto',
  gobierno_local: 'municipio',
  barrio: 'barrio',
  concesion: 'concesion',
};

/** Nivel desde el nombre del archivo parquet. */
function nivelDeArchivo(archivo) {
  return ARCHIVOS_NIVEL[archivo.toLowerCase()] || null;
}

// --------------------------------------------------------------
// Registry Parquet (fuente de verdad: data/registry/*.parquet)
// Columnas iguales al contrato registry; yvy_id obligatorio.
// --------------------------------------------------------------
function valorCelda(v) {
  if (v == null) return '';
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Lee un parquet y lo devuelve en forma [encabezados, filas[]] (strings). */
async function leerParquetFilas(ruta) {
  const file = await asyncBufferFromFile(ruta);
  const objetos = await parquetReadObjects({ file });
  if (objetos.length === 0) return { encabezados: [], filas: [] };
  const encabezados = Object.keys(objetos[0]);
  const filas = objetos.map((o) => encabezados.map((k) => valorCelda(o[k]).trim()));
  return { encabezados, filas };
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

// --------------------------------------------------------------
// Polylabel (polo de inaccesibilidad) para la ETIQUETA del mapa.
// El centroide cae fuera del polígono en formas cóncavas (Salta):
// aquí rellenamos en ráster la unión del segmento principal y
// buscamos el punto interior más alejado del borde. Garantía:
// la etiqueta sale SIEMPRE adentro del polígono (cero riesgo de mar).
// Grilla de ~160 cells sobre el bbox; chamfer de 2 pasadas para la
// distancia. Determinista y cacheado como el centro del flyTo.
// --------------------------------------------------------------
const CELLS_POLE = 160;

/** Relleno del anillo (scanline por fila de grilla) sobre la máscara. */
function rellenarAnilloEnGrilla(ring, minLon, minLat, paso, w, h, mask) {
  for (let gy = 0; gy < h; gy++) {
    const y = minLat + (gy + 0.5) * paso;
    const xs = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i][1];
      const yj = ring[j][1];
      if ((yi > y) !== (yj > y)) {
        xs.push(((ring[j][0] - ring[i][0]) * (y - yi)) / (yj - yi) + ring[i][0]);
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const gx0 = Math.max(0, Math.ceil((xs[k] - minLon) / paso - 0.5));
      const gx1 = Math.min(w - 1, Math.floor((xs[k + 1] - minLon) / paso - 0.5));
      for (let gx = gx0; gx <= gx1; gx++) mask[gy * w + gx] = 1;
    }
  }
}

/**
 * Polo de la unión de anillos (grados). Devuelve [lng, lat] del centro
 * de la celda interior con mayor distancia al borde, o null si degenera.
 */
function poloEtiqueta(ringsDeg) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const r of ringsDeg) {
    for (const p of r) {
      if (p[0] < minLon) minLon = p[0];
      if (p[0] > maxLon) maxLon = p[0];
      if (p[1] < minLat) minLat = p[1];
      if (p[1] > maxLat) maxLat = p[1];
    }
  }
  if (!isFinite(minLon)) return null;
  const dx = maxLon - minLon;
  const dy = maxLat - minLat;
  if (dx <= 0 && dy <= 0) return null;
  const paso = Math.max(Math.max(dx, dy) / CELLS_POLE, 1e-4);
  const w = Math.max(1, Math.min(CELLS_POLE + 1, Math.floor(dx / paso) + 1));
  const h = Math.max(1, Math.min(CELLS_POLE + 1, Math.floor(dy / paso) + 1));
  const mask = new Uint8Array(w * h);
  for (const ring of ringsDeg) rellenarAnilloEnGrilla(ring, minLon, minLat, paso, w, h, mask);

  // Distancia chamfer (8-conectada): exterior = 0, interior = acumulada.
  const INF = 1e9;
  const dist = new Float32Array(w * h);
  for (let i = 0; i < mask.length; i++) dist[i] = mask[i] ? INF : 0;
  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      const i = gy * w + gx;
      if (dist[i] === 0) continue;
      let m = dist[i];
      if (gx > 0) m = Math.min(m, dist[i - 1] + 1);
      if (gy > 0) m = Math.min(m, dist[i - w] + 1);
      if (gx > 0 && gy > 0) m = Math.min(m, dist[i - w - 1] + 1.41);
      if (gx < w - 1 && gy > 0) m = Math.min(m, dist[i - w + 1] + 1.41);
      dist[i] = m;
    }
  }
  for (let gy = h - 1; gy >= 0; gy--) {
    for (let gx = w - 1; gx >= 0; gx--) {
      const i = gy * w + gx;
      if (dist[i] === 0) continue;
      let m = dist[i];
      if (gx < w - 1) m = Math.min(m, dist[i + 1] + 1);
      if (gy < h - 1) m = Math.min(m, dist[i + w] + 1);
      if (gx < w - 1 && gy < h - 1) m = Math.min(m, dist[i + w + 1] + 1.41);
      if (gx > 0 && gy < h - 1) m = Math.min(m, dist[i + w - 1] + 1.41);
      dist[i] = m;
    }
  }
  let mejor = -1;
  let mejorI = -1;
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] < INF && dist[i] > mejor) {
      mejor = dist[i];
      mejorI = i;
    }
  }
  if (mejorI < 0) return null;
  return [
    minLon + ((mejorI % w) + 0.5) * paso,
    minLat + (Math.floor(mejorI / w) + 0.5) * paso,
  ];
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
  if (cache && cache.v === 6 && cache.archivo === metaNivel.rel && cache.size === st.size && cache.mtimeMs === st.mtimeMs && cache.porId) {
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
            // id top-level MVT (tippecanoe --use-attribute-for-id) o propiedad id/yvy_id
            const id = String(feat.id ?? feat.properties.id ?? feat.properties.yvy_id ?? '').trim();
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
              const ptsDeg = [];
              for (const p of ring) {
                const pl = lngDeTile(x + p.x / extent, z);
                const pa = latDeTile(y + p.y / extent, z);
                ptsDeg.push([pl, pa]);
                if (pl < minLon) minLon = pl;
                if (pl > maxLon) maxLon = pl;
                if (pa < minLat) minLat = pa;
                if (pa > maxLat) maxLat = pa;
              }
              (detalle[id] ??= []).push({ lng, lat, w: isAntarctic ? 0 : c.w, pts: ptsDeg, minLon, maxLon, minLat, maxLat });
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
    // Etiqueta: polylabel del segmento principal (punto interior que
    // sobrevive a las concavidades). El centro sigue siendo el
    // centroide ponderado (cámara del flyTo). Sin pole válido queda null
    // y el runtime cae al centro normal.
    const pole = poloEtiqueta(principal.map((a) => a.pts));
    // Bounds: unión de TODOS los segmentos (incluye islas alejadas)
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
    if (sw > 0 && isFinite(sl / sw) && isFinite(st / sw)) porId[id] = { c: [sl / sw, st / sw], e: pole, b: [minLon, minLat, maxLon, maxLat] };
  }
  const out = { v: 6, archivo: metaNivel.rel, size: st.size, mtimeMs: st.mtimeMs, porId, observados: [...idsObservados] };
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
// Construcción del catálogo desde los parquets del registry
// --------------------------------------------------------------
async function construirManifest() {
  const fuentes = [];
  const objetos = [];
  const advertencias = [];
  const excepcionesIds = await cargarExcepcionesIds(advertencias);
  const idsMigrados = new Set((excepcionesIds.migraciones || []).map((m) => Number(m.de)));
  const entradas = await fs.readdir(REGISTRY_DIR).catch(() => []);

  const parquetsPorNivel = entradas.filter((f) => nivelDeArchivo(f)).sort();
  // Registry: jurisdicciones.parquet (multi-nivel) manda; por-nivel solo si falta.
  const trozos = []; // {nivel, archivo, encabezados, filas}
  if (entradas.some((f) => f.toLowerCase() === REGISTRO_UNICO)) {
    for (const f of parquetsPorNivel) {
      advertencias.push(`Parquet "${f}" ignorado: ${REGISTRO_UNICO} manda como registry unico.`);
    }
    let encabezados = [];
    let filas = [];
    try {
      ({ encabezados, filas } = await leerParquetFilas(path.join(REGISTRY_DIR, REGISTRO_UNICO)));
    } catch (err) {
      advertencias.push(`Parquet "${REGISTRO_UNICO}" no se pudo leer (¿parquet válido?): ${err?.message || err}`);
    }
    if (filas.length > 0) {
      const iNiv = encabezados.findIndex((e) => normalizar(e) === 'nivel');
      if (iNiv < 0) {
        advertencias.push(`Parquet "${REGISTRO_UNICO}" no tiene columna "nivel" (ignorado).`);
      } else {
        const porNivel = new Map();
        let desconocidos = 0;
        for (const f of filas) {
          const n = NIVEL_JURIS[normalizar(String(f[iNiv] || ''))] || null;
          if (!n || !ORDEN_NIVEL.includes(n)) { desconocidos++; continue; }
          if (!porNivel.has(n)) porNivel.set(n, []);
          porNivel.get(n).push(f);
        }
        if (desconocidos > 0) {
          advertencias.push(`Parquet "${REGISTRO_UNICO}": ${desconocidos} filas con nivel desconocido (ignoradas).`);
        }
        for (const [nivel, fr] of [...porNivel.entries()]
          .sort((a, b) => ORDEN_NIVEL.indexOf(a[0]) - ORDEN_NIVEL.indexOf(b[0]))) {
          trozos.push({ nivel, archivo: REGISTRO_UNICO, encabezados, filas: fr });
        }
      }
    }
  } else {
    if (parquetsPorNivel.length === 0) {
      advertencias.push(`No hay parquets en data/registry/. Copiá ${REGISTRO_UNICO} (o paises.parquet, provincias.parquet, departamentos.parquet y municipios.parquet) cuando los tengas.`);
    }
    for (const archivo of parquetsPorNivel) {
      const nivel = nivelDeArchivo(archivo);
      if (!ORDEN_NIVEL.includes(nivel)) {
        advertencias.push(`Parquet "${archivo}" con nivel desconocido "${nivel}" (ignorado). Niveles válidos: ${ORDEN_NIVEL.join(', ')}.`);
        continue;
      }
      let encabezados = [];
      let filas = [];
      try {
        ({ encabezados, filas } = await leerParquetFilas(path.join(REGISTRY_DIR, archivo)));
      } catch (err) {
        advertencias.push(`Parquet "${archivo}" no se pudo leer (¿parquet válido?): ${err?.message || err}`);
        continue;
      }
      if (filas.length === 0) continue;
      trozos.push({ nivel, archivo, encabezados, filas });
    }
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

  for (const { nivel, archivo, encabezados, filas } of trozos) {
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
      advertencias.push(`Parquet "${archivo}" no tiene columna "yvy_id" (ignorado).`);
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
    for (let r = 0; r < filas.length; r++) {
      const f = filas[r];
      const c = aColumnas(encabezados, f);
      const yvyId = num(f[iYvy]);
      if (yvyId == null) continue;
      filasValidas++;

      const [lo, hi] = RANGO_YVY[nivel] || [0, 999999];
      if ((yvyId < lo || yvyId > hi) && !idsMigrados.has(yvyId)) {
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
          if (Array.isArray(cr.e)) obj.centro_etiqueta = [cr.e[0], cr.e[1]];
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

  // Padres huérfanos: warning, no bloqueo (un solo parent_yvy_id por objeto, punto).
  // Barrios: además del rango, el prefijo debe ser el yvy_id del padre
  // (1660063xxx → parent 1660063). Estructura, no solo intervalo.
  // Identidad (contrato de ids): las migraciones declaradas se aplican
  // ANTES de validar el árbol y de derivar agregados. Si un id cambia,
  // todo lo que cuelga de él tiene que ver el id nuevo (padres, agregados,
  // relaciones, certificados).
  let identidad = { excepciones: excepcionesIds, aplicadas: [], pendientes: [], violaciones: [], ledger: null };
  try {
    const m = aplicarMigraciones(objetos, excepcionesIds);
    identidad.aplicadas = m.aplicadas;
    identidad.pendientes = m.pendientes;
    if (m.aplicadas.length) {
      advertencias.push(`identidad: ${m.aplicadas.length} id(s) migrado(s) a rango reservado (${m.aplicadas.map((x) => `${x.desde}→${x.hasta}`).join(', ')}).`);
    }
    identidad.violaciones = validarIdentidad(objetos, excepcionesIds);
    identidad.ledger = construirLedger(objetos, excepcionesIds);
  } catch (err) {
    const msg = String(err?.message || err);
    identidad.violaciones = [msg.startsWith('identidad:') ? msg : `identidad: ${msg}`];
  }

  {
    const ids = new Set(objetos.map((o) => o.yvy_id));
    let huerfanos = 0;
    for (const o of objetos) {
      if (o.parent_yvy_id != null && !ids.has(Number(o.parent_yvy_id))) {
        if (huerfanos < 10) advertencias.push(`${o.nivel} ${o.yvy_id} (${o.nombre_oficial}): parent_yvy_id ${o.parent_yvy_id} no existe en el catálogo.`);
        huerfanos++;
      }
      if (o.nivel === 'barrio' && o.parent_yvy_id != null) {
        const pref = String(o.yvy_id).slice(0, String(o.parent_yvy_id).length);
        if (pref !== String(o.parent_yvy_id)) {
          advertencias.push(`barrio ${o.yvy_id} (${o.nombre_oficial}): no hereda el prefijo del padre ${o.parent_yvy_id}.`);
        }
      }
    }
    if (huerfanos > 10) advertencias.push(`...y ${huerfanos - 10} objetos más con padre inexistente.`);
  }

  // Identidad (ya aplicada antes del chequeo de árbol): acá solo se
  // derivan agregados sobre los ids definitivos.
  const datasets = await construirDatasets(objetos, advertencias);

  // Cámara heredada: si el PMTiles del nivel no está en el repo (R2, SPEC §6),
  // no hay centros/bounds nuevos. Se conservan los del manifest previo en
  // disco (última build con geometría completa) en vez de null: volar a un
  // municipio sin centro caía al centro del padre con zoom fijo ("zoom malo").
  // Solo cámara (centro/zoom/bounds/bounds_objeto); el resto lo manda el build.
  {
    let previos = null;
    try {
      const raw = await fs.readFile(path.join(DATA_DIR, 'manifest.json'), 'utf8');
      previos = new Map(JSON.parse(raw).objetos.map((o) => [Number(o.yvy_id), o]));
    } catch { /* primera build: no hay previo */ }
    if (previos) {
      let heredados = 0;
      for (const o of objetos) {
        const p = previos.get(Number(o.yvy_id));
        if (!p) continue;
        let tomo = false;
        if (!Array.isArray(o.centro) && Array.isArray(p.centro)) { o.centro = p.centro; tomo = true; }
        if (!Array.isArray(o.centro_etiqueta) && Array.isArray(p.centro_etiqueta)) { o.centro_etiqueta = p.centro_etiqueta; tomo = true; }
        if (o.zoom == null && p.zoom != null) { o.zoom = p.zoom; tomo = true; }
        if (!Array.isArray(o.bounds) && Array.isArray(p.bounds)) { o.bounds = p.bounds; tomo = true; }
        if (!Array.isArray(o.bounds_objeto) && Array.isArray(p.bounds_objeto)) { o.bounds_objeto = p.bounds_objeto; tomo = true; }
        if (tomo) heredados++;
      }
      if (heredados > 0) console.log(`[yvy-manifest] cámara heredada del manifest previo: ${heredados} objetos`);
    }
  }

  // Capitales provinciales (WGS 84, curadas en scripts/capitales.json):
  // capital_centro = sede de gobierno, no el centroide geométrico.
  // El panel Grafo posiciona los nodos de provincia en esta coordenada.
  // Zero-alucinación (SPEC §4): si una provincia no matchea ninguna
  // capital curada, queda sin capital_centro (missing explícito, no invento).
  {
    let capitales = null;
    try {
      const rawCap = await fs.readFile(path.resolve('scripts/capitales.json'), 'utf8');
      const crudo = JSON.parse(rawCap);
      capitales = Object.entries(crudo).filter(([k]) => !k.startsWith('_'));
    } catch (err) {
      advertencias.push(`scripts/capitales.json no se pudo leer: ${err?.message || err}`);
    }
    if (capitales) {
      let conCapital = 0;
      for (const o of objetos) {
        if (o.nivel !== 'provincia') continue;
        const norm = normalizar(o.nombre_oficial);
        for (const [key, lnglat] of capitales) {
          if (norm.startsWith(key)) {
            o.capital_centro = lnglat;
            conCapital++;
            break;
          }
        }
      }
      console.log(`[yvy-manifest] capital_centro inyectado: ${conCapital} provincias`);
    }
  }

  return { fuentes, objetos, datasets, advertencias, identidad };
}

// Categoría temática por tipo (vocabulario fijo SPEC §10; la columna manda si existe)
const CATEGORIA_TIPO = {
  demografia: 'Sociedad', escuelas: 'Sociedad', salud: 'Sociedad', barrios: 'Sociedad',
  empleo: 'Economía', produccion: 'Economía', mineria: 'Economía',
  ambiente: 'Ambiente', clima: 'Ambiente', hidrologia: 'Ambiente',
  rutas: 'Infraestructura', ffcc: 'Infraestructura', energia: 'Infraestructura', agua: 'Infraestructura',
  catastro: 'Infraestructura',
};
// Niveles donde aplica cada tipo (SPEC §10 nivel_agregacion; la ficha filtra por esto)
const NIVEL_AGREGACION = {
  demografia: ['pais', 'provincia', 'depto', 'municipio'],
  barrios: ['municipio'],
  mineria: ['depto'],
  catastro: ['depto'],
};
// Agregación curada por tipo (SPEC §10 métricas por tipo): solo estas
// columnas sobreviven al rollup por contenedor. El resto (códigos,
// expedientes) no se suma ni se lista: sumar códigos es basura.
const AGREGACION_TIPO = {
  mineria: {
    conteo: 'total_concesiones',
    sumas: { area_ha: 'area_total_ha' },
    top: { tipo: 'por_tipo', estado: 'por_estado', mineral: 'por_mineral' },
  },
  catastro: {
    conteo: 'total_parcelas',
    sumas: { area_m2: 'area_total_m2', area_ha: 'area_total_ha' },
    top: { categoria: 'por_categoria', localid: 'por_localidad' },
  },
};
// Columnas que NO son métricas (identidad/meta del agregado)
const NO_METRICA = new Set(['yvy_id', 'id', 'nivel', 'parent_yvy_id', 'yvy_id_contenedor', 'cod_indec', 'georef_id', 'nombre_oficial', 'nombre', 'fuente', 'fuente_url', 'fecha_vigencia', 'version', 'categoria', 'tipo']);

/**
 * Estado de un agregado según sus métricas: `ok` (todas con valor),
 * `parcial` (algunas en `null`) o `missing` (ninguna). Va siempre junto a
 * los `null`: un dato que no existe no se representa con 0.
 */
function estadoDeMetricas(metricas) {
  const claves = Object.keys(metricas || {});
  const faltan = claves.filter((k) => metricas[k] == null);
  const estado = !claves.length || faltan.length === claves.length
    ? 'missing'
    : (faltan.length ? 'parcial' : 'ok');
  return { estado, metricas_missing: faltan };
}

// ==============================================================
// Ontología + validador de contrato + certificado
// ==============================================================

/** Violación del contrato de datos: corta el build, no se degrada a aviso. */
class ErrorDeContrato extends Error {}

/** Acumulador de violaciones de una corrida del build. */
let violaciones = [];

/** Ontología activa (data/ontologia.json) y linaje indexado, cargados por build. */
let ontologia = null;
let linaje = { porOrigen: new Map(), crudas: [] };

function exigir(cond, mensaje) {
  if (!cond) violaciones.push(mensaje);
}

/** Lee la ontología (tipos, métricas, relaciones). Si falta, el build sigue sin contrato. */
async function cargarOntologia(advertencias) {
  try {
    const ontologia = JSON.parse(await fs.readFile(ONTOLOGIA_SRC, 'utf8'));
    if (!ontologia.tipos || !ontologia.metricas) {
      advertencias.push('ontologia.json sin "tipos" o sin "metricas": no se valida el contrato.');
      return null;
    }
    return ontologia;
  } catch (err) {
    advertencias.push(`ontologia.json no se pudo leer (${err?.code || err?.message}): sin validación de contrato.`);
    return null;
  }
}

/**
 * Excepciones de identidad (data/ids.excepciones.json). Si falta el
 * archivo, se sigue con cero excepciones: el contrato de ids se valida
 * igual, pero cualquier id en bloque reservado o fuera de rango corta.
 */
async function cargarExcepcionesIds(advertencias) {
  try {
    const exc = JSON.parse(await fs.readFile(IDS_EXCEPCIONES_SRC, 'utf8'));
    if (exc.schema !== 'yvy-ids-excepciones-v1') {
      advertencias.push(`ids.excepciones.json: schema inesperado "${exc.schema}" (se esperaba yvy-ids-excepciones-v1).`);
    }
    return exc;
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      advertencias.push(`ids.excepciones.json no se pudo leer (${err?.message || err}): sin excepciones de identidad.`);
    }
    return { schema: 'yvy-ids-excepciones-v1', rangos_reservados: [], migraciones: [] };
  }
}

/**
 * Índice de relaciones por origen para el hash_linaje. Orden determinista:
 * el mismo archivo tiene que dar el mismo hash siempre.
 */
async function cargarLinaje() {
  const vacio = new Map();
  try {
    const raw = JSON.parse(await fs.readFile(RELACIONES_SRC, 'utf8'));
    const porOrigen = new Map();
    for (const r of raw.relaciones || []) {
      const item = { tipo: r.tipo, destino: r.destino_yvy_id };
      if (r.dist_m != null) item.dist_m = r.dist_m;
      const k = Number(r.origen_yvy_id);
      if (!porOrigen.has(k)) porOrigen.set(k, []);
      porOrigen.get(k).push(item);
    }
    for (const lista of porOrigen.values()) {
      lista.sort((a, b) => (a.tipo === b.tipo ? a.destino - b.destino : a.tipo < b.tipo ? -1 : 1));
    }
    return { porOrigen, crudas: raw.relaciones || [] };
  } catch {
    return { porOrigen: vacio, crudas: [] };
  }
}

/** Certificado de una entidad: dos hashes, payload completo (no lo visible). */
async function certificar(ag, linaje) {
  const rels = linaje.porOrigen.get(ag.yvy_id) || [];
  const documentos = [];
  return {
    hash_entidad: await hashCanonico(payloadEntidad(ag)),
    hash_linaje: await hashCanonico(payloadLinaje(ag.yvy_id, rels, documentos)),
    canonico: 'RFC8785',
    algoritmo: 'sha256',
  };
}

/**
 * Valida el contrato completo ANTES de publicar:
 * tipos declarados, métricas con unidad, fuente obligatoria, relaciones
 * declaradas y tipos como campo. Devuelve la lista de violaciones.
 */
function validarContrato({ objetos, datasets, ontologia, relaciones, agregadosMuestra }) {
  if (!ontologia) return [];
  const tipos = ontologia.tipos || {};
  const metricasOnt = ontologia.metricas || {};
  const relacionesOnt = ontologia.relaciones || {};
  const out = [];

  for (const o of objetos) {
    if (!tipos[o.nivel]) out.push(`objeto ${o.yvy_id}: nivel "${o.nivel}" no declarado en ontologia.tipos`);
    if (!Number.isInteger(Number(o.yvy_id))) out.push(`objeto ${o.nombre_oficial}: yvy_id no entero`);
    const t = tipos[o.nivel];
    if (t && Array.isArray(t.padre) && t.padre.length && o.parent_yvy_id != null) {
      const padre = objetos.find((x) => Number(x.yvy_id) === Number(o.parent_yvy_id));
      if (padre && !t.padre.includes(padre.nivel)) {
        out.push(`objeto ${o.yvy_id}: padre es "${padre.nivel}" y la ontología admite ${JSON.stringify(t.padre)}`);
      }
    }
  }

  for (const d of datasets) {
    if (!d.fuente) out.push(`dataset "${d.tipo}": sin fuente (no entra)`);
  }

  for (const ag of agregadosMuestra) {
    if (!ag.tipo) out.push(`agregado ${ag.yvy_id}: sin tipo`);
    if (!ag.fuente) out.push(`agregado ${ag.tipo}/${ag.yvy_id}: sin fuente (no entra)`);
    for (const k of Object.keys(ag.metricas || {})) {
      const def = metricasOnt[k];
      if (!def) { out.push(`métrica "${k}" no declarada en ontologia.metricas (${ag.tipo}/${ag.yvy_id})`); continue; }
      if (!def.unidad) out.push(`métrica "${k}": sin unidad en la ontología`);
    }
  }

  for (const r of relaciones) {
    if (!relacionesOnt[r.tipo]) out.push(`relación "${r.tipo}" no declarada en ontologia.relaciones`);
    else if (!relacionesOnt[r.tipo].fuente) out.push(`relación "${r.tipo}": sin fuente en la ontología`);
  }

  return out;
}

/** Publica la ontología junto al manifest: el cliente la necesita para interpretar. */
async function publicarOntologia(ontologia) {
  if (!ontologia) return;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, 'ontologia.json'), JSON.stringify(ontologia, null, 2), 'utf8');
}

/**
 * Datasets: {tipo}_{version}.parquet → versión activa + agregados por yvy_id.
 * Escribe public/data/agregados/{tipo}/{yvy_id}.json y devuelve el índice
 * para el manifest. Métrica sin dato = null + estado (nunca 0 de relleno).
 * Rollup: cada agregado suma sus métricas numéricas a sus ancestros
 * (municipio→depto→provincia); el directo manda si ya existe.
 */
async function construirDatasets(objetos, advertencias) {
  const datasets = [];
  const idsCatalogo = new Set(objetos.map((o) => o.yvy_id));
  const padres = new Map(objetos.map((o) => [o.yvy_id, o.parent_yvy_id]));
  const entradas = await fs.readdir(REGISTRY_DIR).catch(() => []);
  const archivos = entradas.filter((f) => f.toLowerCase().endsWith('.parquet') && !nivelDeArchivo(f) && f.toLowerCase() !== REGISTRO_UNICO).sort();
  for (const archivo of archivos) {
    const m = path.basename(archivo, '.parquet').match(/^([a-z_]+?)(?:_(\d{4}-\d{2}))?$/i);
    if (!m) {
      advertencias.push(`Dataset "${archivo}" no matchea {tipo}_{YYYY-MM}.parquet (ignorado).`);
      continue;
    }
    const tipo = m[1].toLowerCase();
    let encabezados = [];
    let filas = [];
    try {
      ({ encabezados, filas } = await leerParquetFilas(path.join(REGISTRY_DIR, archivo)));
    } catch (err) {
      advertencias.push(`Dataset "${archivo}" no se pudo leer: ${err?.message || err}`);
      continue;
    }
    if (filas.length === 0) continue;
    const col = (nombres) => {
      for (const n of nombres) {
        const i = encabezados.findIndex((e) => normalizar(e) === n);
        if (i >= 0) return i;
      }
      return -1;
    };
    const iYvy = col(['yvy_id', 'id']);
    if (iYvy < 0) {
      advertencias.push(`Dataset "${archivo}" no tiene columna "yvy_id" (ignorado).`);
      continue;
    }
    const iFuente = col(['fuente']);
    const iFecha = col(['fecha_vigencia']);
    const iVersion = col(['version']);
    const iCat = col(['categoria']);
    const iMetrica = encabezados.map((_, i) => i).filter((i) => !NO_METRICA.has(normalizar(encabezados[i])));
    const dirOut = path.join(DATA_DIR, 'agregados', tipo);
    await fs.mkdir(dirOut, { recursive: true });
    let count = 0;
    let fuente = null;
    let fecha = null;
    let version = null;
    const base = [];
    // Agrupar filas por yvy_id: los datasets fila-a-fila (catastro, minería)
    // traen N filas por contenedor y se agregan (suma numérica + top-20 por
    // columna de texto). Un grupo de 1 fila sale idéntico a antes.
    const grupos = new Map();
    for (const f of filas) {
      const yvyId = num(f[iYvy]);
      if (yvyId == null) continue;
      if (!grupos.has(yvyId)) grupos.set(yvyId, []);
      grupos.get(yvyId).push(f);
    }
    const metricaDeCelda = (raw) => {
      // Contrato Yvy Core: dato faltante = null (+ estado en el agregado).
      // Nunca 0 de relleno — un 0 inventado es un dato falso.
      if (raw == null || raw === '') return null;
      const n = num(raw);
      return n == null ? raw : (Number.isInteger(n) ? n : Math.round(n * 100) / 100);
    };
    for (const [yvyId, gf] of grupos) {
      if (!idsCatalogo.has(yvyId)) {
        advertencias.push(`Dataset "${archivo}": yvy_id ${yvyId} no existe en el catálogo (agregado huérfano, igual se emite).`);
      }
      const f0 = gf[0];
      let metricas = {};
      const regla = AGREGACION_TIPO[tipo];
      if (!regla) {
        for (const i of iMetrica) metricas[normalizar(encabezados[i])] = metricaDeCelda(f0[i]);
      } else {
        // Agregado curado: conteo + sumas + top-20 de columnas listadas.
        // Nada fuera de la regla sobrevive (ni códigos sumados ni dropdowns).
        metricas[regla.conteo] = gf.length;
        const colIdx = {};
        for (let i = 0; i < encabezados.length; i++) colIdx[normalizar(encabezados[i])] = i;
        for (const [col, out] of Object.entries(regla.sumas || {})) {
          if (!(col in colIdx)) continue;
          const vals = gf.map((r) => num(r[colIdx[col]])).filter((n) => n != null);
          if (!vals.length) { metricas[out] = null; continue; }
          const s = vals.reduce((a, b) => a + b, 0);
          metricas[out] = Number.isInteger(s) ? s : Math.round(s * 100) / 100;
        }
        for (const [col, out] of Object.entries(regla.top || {})) {
          if (!(col in colIdx)) continue;
          const vc = new Map();
          for (const r of gf) {
            const v = r[colIdx[col]];
            if (v == null || v === '') continue;
            const k = String(v);
            vc.set(k, (vc.get(k) || 0) + 1);
          }
          if (!vc.size) { metricas[out] = null; continue; }
          const top = [...vc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
          metricas[out] = JSON.stringify(Object.fromEntries(top));
        }
      }
      const ag = {
        tipo,
        categoria: iCat >= 0 && f0[iCat] ? f0[iCat] : (CATEGORIA_TIPO[tipo] || null),
        yvy_id: yvyId,
        yvy_id_contenedor: yvyId,
        fuente: iFuente >= 0 && f0[iFuente] ? f0[iFuente] : null,
        fecha_vigencia: iFecha >= 0 && f0[iFecha] ? f0[iFecha] : null,
        version: (iVersion >= 0 && f0[iVersion] ? f0[iVersion] : null) || version,
        metricas,
        ...estadoDeMetricas(metricas),
      };
      ag.certificado = await certificar(ag, linaje);
      if (ag.fuente && !fuente) fuente = ag.fuente;
      if (ag.fecha_vigencia && !fecha) fecha = ag.fecha_vigencia;
      if (ag.version && !version) version = ag.version;
      await fs.writeFile(path.join(dirOut, `${yvyId}.json`), JSON.stringify(ag), 'utf8');
      count += gf.length;
      base.push(ag);
    }
    // Rollup a ancestros (suma numérica; el directo manda si ya existe)
    const directos = new Set(base.map((a) => a.yvy_id));
    const acumulado = new Map();
    for (const ag of base) {
      let p = padres.get(ag.yvy_id);
      const vistos = new Set([ag.yvy_id]);
      while (p != null && !vistos.has(p) && idsCatalogo.has(p)) {
        vistos.add(p);
        if (!directos.has(p)) {
          if (!acumulado.has(p)) acumulado.set(p, {});
          const acc = acumulado.get(p);
          for (const [k, v] of Object.entries(ag.metricas)) {
            if (typeof v === 'number' && Number.isFinite(v)) acc[k] = (acc[k] || 0) + v;
          }
        }
        p = padres.get(p);
      }
    }
    let rolled = 0;
    for (const [yvyId, metricas] of acumulado) {
      const primero = base[0];
      const ag = {
        tipo,
        categoria: primero.categoria,
        yvy_id: yvyId,
        yvy_id_contenedor: yvyId,
        fuente: primero.fuente,
        fecha_vigencia: primero.fecha_vigencia,
        version: primero.version,
        metricas,
        ...estadoDeMetricas(metricas),
        rollup: true,
      };
      ag.certificado = await certificar(ag, linaje);
      await fs.writeFile(path.join(dirOut, `${yvyId}.json`), JSON.stringify(ag), 'utf8');
      rolled++;
    }
    if (!version) version = m[2] || null;
    datasets.push({ tipo, categoria: CATEGORIA_TIPO[tipo] || null, niveles: NIVEL_AGREGACION[tipo] || null, version, fecha_vigencia: fecha, fuente, count: count + rolled, archivo });
  }
  return datasets;
}

// --------------------------------------------------------------
// Escritura de los archivos
// --------------------------------------------------------------
async function escribirManifest() {
  violaciones = [];
  const avisosOntologia = [];
  ontologia = await cargarOntologia(avisosOntologia);
  linaje = await cargarLinaje();
  const { fuentes, objetos, datasets, advertencias, identidad } = await construirManifest();
  advertencias.push(...avisosOntologia);

  // Contrato: si algo no está declarado (tipo, métrica, unidad, fuente,
  // relación) el build falla. Un dato sin contrato no se publica.
  const muestra = [];
  for (const tipo of ['demografia', 'catastro', 'mineria']) {
    const dir = path.join(DATA_DIR, 'agregados', tipo);
    for (const f of await fs.readdir(dir).catch(() => [])) {
      if (!f.endsWith('.json')) continue;
      const ag = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
      muestra.push(ag);
    }
  }
  violaciones = validarContrato({
    objetos,
    datasets,
    ontologia,
    relaciones: linaje.crudas,
    agregadosMuestra: muestra,
  });
  // El contrato de identidad corta el build igual que el de datos: un id
  // fuera de rango, duplicado o en bloque reservado sin excepción no se
  // publica nunca.
  if (identidad && identidad.violaciones?.length) {
    violaciones.push(...identidad.violaciones);
  }
  if (violaciones.length) {
    const resumen = violaciones.slice(0, 12).map((v) => `  - ${v}`).join('\n');
    throw new ErrorDeContrato(
      `[yvy-contrato] ${violaciones.length} violación(es) del contrato de datos:\n${resumen}`
      + (violaciones.length > 12 ? `\n  … y ${violaciones.length - 12} más` : '')
      + '\nCorregí data/ontologia.json o el registry antes de publicar.',
    );
  }

  await publicarOntologia(ontologia);

  // Ledger de identidad: se publica junto al manifest y su hash lo ata.
  // Es lo que permite verificar que un id no se recicló ni se renumeró.
  let identidadPublicada = null;
  if (identidad?.ledger) {
    const hashCatalogo = await hashCanonico({
      schema: identidad.ledger.schema,
      total: identidad.ledger.total,
      entidades: identidad.ledger.entidades,
    });
    const ledger = { ...identidad.ledger, hash_catalogo: hashCatalogo };
    await fs.mkdir(DATA_DIR, { recursive: true });
    // Una entidad por línea: diff legible y archivo auditable a mano.
    const lineas = [
      '{',
      `  "schema": ${JSON.stringify(ledger.schema)},`,
      `  "total": ${ledger.total},`,
      `  "hash_catalogo": ${JSON.stringify(hashCatalogo)},`,
      `  "reservados": ${JSON.stringify(ledger.reservados)},`,
      '  "entidades": [',
      ledger.entidades.map((e) => `    ${JSON.stringify(e)}`).join(',\n'),
      '  ]',
      '}',
    ];
    await fs.writeFile(path.join(DATA_DIR, 'ids.json'), lineas.join('\n') + '\n', 'utf8');
    identidadPublicada = {
      schema: ledger.schema,
      archivo: 'data/ids.json',
      hash_catalogo: hashCatalogo,
      total: ledger.total,
      migraciones: identidad.aplicadas,
    };
  }

  const manifest = {
    generado: Date.now(),
    schema: 'yvy-manifest-v3',
    ontologia: ontologia ? { schema: ontologia.schema, version: ontologia.version, archivo: 'data/ontologia.json' } : null,
    identidad: identidadPublicada,
    fuentes,
    objetos,
    datasets,
  };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

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
        "capital_centro": { "@id": "yvyont:capitalCentro", "@type": "geo:wktLiteral" },
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
    if (o.capital_centro) n["capital_centro"] = `POINT(${o.capital_centro[0]} ${o.capital_centro[1]})`;
    if (o.bounds_objeto) n["bounds_objeto"] = `BOX(${o.bounds_objeto.join(' ')})`;
    if (o.pmtiles) n["pmtiles"] = o.pmtiles;
    return n;
  });
  const jsonld = { "@context": "./context.jsonld", "@graph": graph, "generatedAt": new Date().toISOString(), "schema": "yvy-manifest-v3-jsonld", "count": graph.length };
  await fs.writeFile(path.join(DATA_DIR, 'manifest.jsonld'), JSON.stringify(jsonld, null, 2), 'utf8');

  for (const f of fuentes) {
    console.log(`[yvy-manifest] ${f.nivel.padEnd(10)} ${f.archivo}: ${f.filas} objetos, ${f.pmtiles}/${f.filas} con geometría`);
  }
  for (const d of manifest.datasets || []) {
    console.log(`[yvy-manifest] dataset    ${d.tipo} ${d.version || ''}: ${d.count} agregados (${d.fuente || 'sin fuente'})`);
  }
  for (const w of advertencias) console.warn(`[yvy-manifest] ⚠ ${w}`);
  console.log(`[yvy-manifest] manifest.json generado (${objetos.length} objetos)`);
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
        // Una violación del contrato no es un aviso: corta el build.
        if (err instanceof ErrorDeContrato) throw err;
        console.error('[yvy-manifest] error:', err);
      }
    },
  };
}

// La receta tabular (scripts/receta.mjs) usa ESTA función: si hubiera una
// segunda implementación, los hashes podrían divergir sin que nadie lo note.
export { escribirManifest };

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
