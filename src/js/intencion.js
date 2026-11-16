// ==============================================================
// intencion.js — Búsqueda ontológica sobre el manifest (R14).
// No es "Google Suggest": el universo es el catálogo real (3.334
// objetos) + los datasets declarados. El usuario ve lo que EXISTE
// antes de dar Enter, y si pide algo que no tenemos, la respuesta
// es determinística: qué sí hay para esa entidad.
// Sin dependencias (scorer propio, sin Fuse): 3.334 objetos entran
// de sobra en un scorer de prefijo/contiene sin acentos.
// ==============================================================

import { getObjetos, getDatasets, getAgregado } from './manifest.js';

const NUM = new Intl.NumberFormat('es-AR');

/** Normaliza: minúsculas, sin acentos, sin puntuación. */
export function normalizar(txt) {
  return String(txt || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Metadatos de presentación por dataset (los datos vienen del manifest).
const DATASET_META = {
  demografia: { nombre: 'Demografía', corto: 'Censo 2022', metrica: 'poblacion', plural: 'habitantes', orden: 0 },
  catastro: { nombre: 'Catastro', corto: 'Catastro', metrica: 'total_parcelas', plural: 'parcelas', orden: 1 },
  mineria: { nombre: 'Minería', corto: 'Minería', metrica: 'total_concesiones', plural: 'concesiones', orden: 2 },
};

// Sinónimos → dataset. Prefijo (>=3) para autocompletar mientras tipea.
const SINONIMOS = {
  demografia: ['demografia', 'demografico', 'censo', 'poblacion', 'poblacional', 'habitantes', 'viviendas', 'densidad', 'indec'],
  catastro: ['catastro', 'catastral', 'parcela', 'parcelas', 'propiedad', 'propiedades', 'inmueble', 'inmuebles', 'dgi'],
  mineria: ['mineria', 'minero', 'minera', 'mineros', 'concesion', 'concesiones', 'litio', 'cobre', 'oro'],
};

// Verbos de relación → lo que ya sabe el catálogo (relaciones reales).
const RELACIONES = {
  lindero: ['limita', 'limitan', 'linda', 'lindan', 'lindero', 'linderos', 'vecino', 'vecinos', 'frontera', 'fronteras', 'colinda'],
  contiene: ['contiene', 'contienen', 'depto', 'deptos', 'departamento', 'departamentos', 'hijos', 'subdivision', 'subdivisiones', 'composicion'],
};

const STOP = new Set([
  'y', 'e', 'o', 'u', 'en', 'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'con', 'para', 'por', 'que', 'sobre', 'datos', 'dato', 'muestra', 'mostrar', 'ver', 'buscar', 'quiero',
]);

function tokens(q) {
  return normalizar(q).split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t));
}

function datasetDeToken(t) {
  for (const [tipo, lista] of Object.entries(SINONIMOS)) {
    if (lista.includes(t)) return tipo;
  }
  // Prefijo (>=3): "miner" → minería; evita que "m" secuestre la query.
  if (t.length >= 3) {
    for (const [tipo, lista] of Object.entries(SINONIMOS)) {
      if (lista.some((s) => s.startsWith(t))) return tipo;
    }
  }
  return null;
}

function relacionDeToken(t) {
  for (const [rel, lista] of Object.entries(RELACIONES)) {
    if (lista.includes(t)) return rel;
  }
  return null;
}

/** Índice en RAM de nombres normalizados (se arma una sola vez). */
let indice = null;
function getIndice() {
  if (indice) return indice;
  indice = getObjetos()
    .map((o) => {
      const n = normalizar(o.nombre_oficial);
      // nt: tokens unidos ("Salta (Capital)" → "salta capital") para que
      // la puntuación por palabra no dependa de la puntuación original.
      const nt = n.split(/[^a-z0-9]+/).filter(Boolean).join(' ');
      return { o, n, nt };
    })
    .filter((x) => x.n);
  return indice;
}

// Pesos: exacto < prefijo < inicio de palabra < contiene < todos los tokens.
// El inicio de palabra evita que "anta" traiga "Santa Cruz" arriba.
function puntuar(nombre, frase) {
  if (!frase) return Infinity;
  if (nombre === frase) return 0;
  if (nombre.startsWith(frase)) return 1;
  if (nombre.split(' ').some((p) => p.startsWith(frase))) return 2;
  if (nombre.includes(frase)) return 3;
  return Infinity;
}

/** Lugares por nombre (la frase ya viene sin palabras de dataset). */
export function buscarLugares(q, limite = 8) {
  const frase = tokens(q).join(' ');
  if (!frase) return [];
  const candidatos = [];
  for (const { o, n, nt } of getIndice()) {
    let s = puntuar(nt, frase);
    if (s === Infinity) {
      // Todos los tokens presentes (orden libre): "anta salta"
      const ts = frase.split(' ');
      if (ts.length > 1 && ts.every((t) => nt.includes(t))) s = 4;
    }
    if (s === Infinity) continue;
    // Desempate: nivel (país > provincia > depto > municipio) y población.
    const nivelPeso = { pais: 0, provincia: 1, depto: 2, municipio: 3 }[o.nivel] ?? 4;
    candidatos.push({ o, s, nivelPeso });
  }
  candidatos.sort((a, b) => a.s - b.s || a.nivelPeso - b.nivelPeso);
  return candidatos.slice(0, limite).map((x) => x.o);
}

/** Parseo de la frase completa: entidad + dataset + relación + sobrantes. */
export function parsear(q) {
  const ts = tokens(q);
  let dataset = null;
  let relacion = null;
  const resto = [];
  for (const t of ts) {
    const d = datasetDeToken(t);
    if (d && !dataset) { dataset = d; continue; }
    const r = relacionDeToken(t);
    if (r && !relacion) { relacion = r; continue; }
    resto.push(t);
  }
  const frase = resto.join(' ');
  let entidad = frase ? (buscarLugares(frase, 1)[0] || null) : null;
  if (!entidad) {
    // La entidad puede convivir con una palabra desconocida ("salta autos"):
    // se resuelve por el primer token que exista en el catálogo.
    for (const t of resto) {
      const hit = buscarLugares(t, 1)[0];
      if (hit) { entidad = hit; break; }
    }
  }
  const nEnt = entidad ? normalizar(entidad.nombre_oficial) : '';
  // Sobrantes REALES: tokens que no son parte de la entidad y que además
  // no existen en ningún nombre del catálogo ("capital" no es sobrante).
  const sobrantes = resto.filter((t) => !nEnt.includes(t) && !esPalabraDelCatalogo(t));
  return { entidad, dataset, relacion, sobrantes, frase };
}

/** ¿La palabra aparece en algún nombre del catálogo? (evita falsos "no tengo"). */
function esPalabraDelCatalogo(t) {
  if (!t) return false;
  return getIndice().some((x) => x.n.includes(t));
}

/** ¿El dataset tiene sentido para ese nivel? (rollups provincia/país). */
function aplica(nivel, niveles) {
  if (!nivel || !Array.isArray(niveles)) return false;
  if (niveles.includes(nivel)) return true;
  if (nivel === 'pais') return true;
  if (nivel === 'provincia') return niveles.includes('depto');
  return false;
}

const cacheAgregados = new Map();

function agregadoDe(tipo, yvyId) {
  const k = `${tipo}:${yvyId}`;
  if (!cacheAgregados.has(k)) cacheAgregados.set(k, getAgregado(tipo, yvyId));
  return cacheAgregados.get(k);
}

/**
 * Datasets reales disponibles para una entidad, con su conteo real.
 * Si el agregado no existe o no trae la métrica, NO se ofrece
 * (cero humo: la tarjeta solo muestra lo que se puede abrir).
 */
export async function datosDe(entidad) {
  if (!entidad) return [];
  const ds = getDatasets().filter((d) => aplica(entidad.nivel, d.niveles));
  const out = await Promise.all(ds.map(async (d) => {
    const meta = DATASET_META[d.tipo] || { nombre: d.tipo, metrica: null, plural: 'registros', orden: 9 };
    const ag = await agregadoDe(d.tipo, entidad.yvy_id);
    const valor = meta.metrica && ag && ag.metricas ? Number(ag.metricas[meta.metrica]) : 0;
    if (!valor) return null;
    return {
      tipo: d.tipo,
      nombre: meta.nombre,
      corto: meta.corto || meta.nombre,
      fuente: d.fuente || (ag && ag.fuente) || null,
      valor,
      texto: `${NUM.format(valor)} ${meta.plural}`,
      orden: meta.orden ?? 9,
    };
  }));
  return out.filter(Boolean).sort((a, b) => a.orden - b.orden);
}

/** Fuentes declaradas (panel de capacidades: expectativa calibrada). */
export function capacidades() {
  return getDatasets()
    .map((d) => {
      const meta = DATASET_META[d.tipo] || { nombre: d.tipo };
      return { tipo: d.tipo, nombre: meta.nombre, fuente: d.fuente || null };
    })
    .sort((a, b) => (DATASET_META[a.tipo]?.orden ?? 9) - (DATASET_META[b.tipo]?.orden ?? 9));
}

// Nombre humano y corto de la fuente (nada con forma de código/URL).
const FUENTE_CORTA = {
  'Censo 2022 - censo.gob.ar/gobiernos-locales': 'INDEC · Censo 2022',
  'DGI Salta': 'DGI Salta',
  'Secretaría de Minería de Salta': 'Sec. de Minería · Salta',
};

export function fuenteCorta(raw) {
  if (!raw) return '';
  return FUENTE_CORTA[raw] || String(raw);
}

export function fmtNum(n) {
  return NUM.format(Number(n) || 0);
}
