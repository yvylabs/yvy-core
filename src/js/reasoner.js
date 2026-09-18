// ==============================================================
// reasoner.js — Motor de razonamiento ligero client-side
// Sin dependencias, ~3kB. Opera sobre el grafo de manifest.json
// ya cargado en memoria (2635 nodos). No requiere triplestore.
// Materializa cierre transitivo de skos:broader / yvy:contiene
// en memoria y expone API para el visor sin JOIN manual.
// Se inicializa de forma perezosa tras cargarDatos().
// ==============================================================

import { getObjeto, getObjetos } from './manifest.js';

let hijosIndex = null;
let ancestrosCache = new Map();
let descendientesCache = new Map();

function construirIndices() {
  if (hijosIndex) return;
  hijosIndex = new Map();
  for (const o of getObjetos()) {
    const p = o.parent_yvy_id;
    if (p == null) continue;
    const k = Number(p);
    if (!hijosIndex.has(k)) hijosIndex.set(k, []);
    hijosIndex.get(k).push(o.yvy_id);
  }
}

function getPadreId(yvyId) {
  const o = getObjeto(yvyId);
  return o ? o.parent_yvy_id : null;
}

/**
 * Ancestros transitivos (skos:broader+). Ej: La Cesira (100277)
 * → [10177, 1013, 0] == Sáenz Peña → Córdoba → Argentina
 * Memoizado.
 */
export function getAncestros(yvyId) {
  const id = Number(yvyId);
  if (ancestrosCache.has(id)) return ancestrosCache.get(id);
  const out = [];
  let cur = getPadreId(id);
  const visitados = new Set([id]);
  while (cur != null && !visitados.has(Number(cur))) {
    out.push(Number(cur));
    visitados.add(Number(cur));
    cur = getPadreId(Number(cur));
  }
  ancestrosCache.set(id, out);
  return out;
}

/**
 * Descendientes transitivos (skos:narrower+). BFS con cache por raíz.
 */
export function getDescendientes(yvyId) {
  const id = Number(yvyId);
  if (descendientesCache.has(id)) return descendientesCache.get(id);
  construirIndices();
  const out = [];
  const cola = [...(hijosIndex.get(id) || [])];
  const visitados = new Set(cola);
  while (cola.length) {
    const cur = cola.shift();
    out.push(cur);
    const hijos = hijosIndex.get(cur) || [];
    for (const h of hijos) if (!visitados.has(h)) { visitados.add(h); cola.push(h); }
  }
  descendientesCache.set(id, out);
  return out;
}

export function esAncestroDe(ancestroId, descendienteId) {
  return getAncestros(descendienteId).includes(Number(ancestroId));
}

export function esDescendienteDe(descendienteId, ancestroId) {
  return esAncestroDe(ancestroId, descendienteId);
}

export function esContenidoEn(aId, bId) {
  return esAncestroDe(bId, aId);
}

export function getJerarquiaCompleta(yvyId) {
  const anc = getAncestros(yvyId).slice().reverse();
  return [...anc, Number(yvyId)];
}

export function getNivelAncestro(yvyId, nivel) {
  for (const a of getAncestros(yvyId)) {
    const o = getObjeto(a);
    if (o && o.nivel === nivel) return o;
  }
  return null;
}

export function inicializarRazonador() {
  construirIndices();
  ancestrosCache.clear();
  descendientesCache.clear();
  if (typeof window !== 'undefined') {
    window.yvyReasoner = {
      getAncestros,
      getDescendientes,
      esAncestroDe,
      esDescendienteDe,
      esContenidoEn,
      getJerarquiaCompleta,
      getNivelAncestro,
    };
  }
}