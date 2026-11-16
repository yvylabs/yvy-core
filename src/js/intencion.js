// ==============================================================
// intencion.js — Búsqueda ontológica sobre el manifest (R14 · S1.2).
// No es "Google Suggest": el universo es el catálogo real (3.334
// objetos) + los datasets declarados. El usuario ve lo que EXISTE
// antes de dar Enter, y si pide algo que no tenemos, la respuesta
// es determinística: qué sí hay para esa entidad.
//
// La lógica pura vive en `parser.js` (testeable sin red ni manifest).
// Este módulo la conecta al catálogo en memoria y resuelve datasets.
// ==============================================================

import { getObjetos, getDatasets, getAgregado } from './manifest.js';
import {
  normalizar,
  buscarLugares as buscarLugaresEn,
  parsearCon,
  crearIndice,
} from './parser.js';

export { normalizar };

const NUM = new Intl.NumberFormat('es-AR');

// Metadatos de presentación por dataset (los datos vienen del manifest).
const DATASET_META = {
  demografia: { nombre: 'Demografía', corto: 'Censo 2022', metrica: 'poblacion', plural: 'habitantes', orden: 0 },
  catastro: { nombre: 'Catastro', corto: 'Catastro', metrica: 'total_parcelas', plural: 'parcelas', orden: 1 },
  mineria: { nombre: 'Minería', corto: 'Minería', metrica: 'total_concesiones', plural: 'concesiones', orden: 2 },
};

/** Índice en RAM de nombres normalizados (se arma una sola vez). */
let indice = null;
function getIndice() {
  if (!indice) indice = crearIndice(getObjetos());
  return indice;
}

/** Lugares por nombre (la frase ya viene sin palabras de dataset). */
export function buscarLugares(q, limite = 8) {
  return buscarLugaresEn(getIndice(), q, limite);
}

/** Parseo de la frase completa: entidad + dataset + relación + sobrantes. */
export function parsear(q) {
  return parsearCon(getIndice(), q);
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
