// ==============================================================
// manifest.js — Catálogo Yvy en el cliente
// Carga UNA vez data/manifest.json + data/relaciones.json
// (generados por el plugin yvyManifest de vite.config.js desde
// los CSVs de data/registry). Todo lo demás lee de esta cache:
// el Explorador, la ficha del objeto y el mapa no hacen más
// fetches por objeto: cero trabajo en frame.
// ==============================================================

let datos = null;
let objetoActivo = null;
let navigator = null;
let hijosIndex = null; // Map<parent_yvy_id, objeto[]>

export const NIVEL_LABEL = {
  pais: 'País',
  provincia: 'Provincia',
  depto: 'Departamento',
  municipio: 'Municipio',
  concesion: 'Concesión',
};

export const NIVEL_ORDEN = ['pais', 'provincia', 'depto', 'municipio', 'concesion'];

/** Carga (una vez) el manifest y las relaciones. Tolerante a archivos faltantes. */
export async function cargarDatos() {
  if (datos) return datos;

  const [mr, rr] = await Promise.all([
    fetch('data/manifest.json')
      .then((r) => (r.ok ? r.json() : { objetos: [] }))
      .catch(() => ({ objetos: [] })),
    fetch('data/relaciones.json')
      .then((r) => (r.ok ? r.json() : { relaciones: [] }))
      .catch(() => ({ relaciones: [] })),
  ]);

  const objetos = new Map();
  for (const o of mr.objetos || []) objetos.set(o.yvy_id, o);
  // Reparar huérfanos: municipios/provincias con parent null pero con prov_yvy_id
  // deben colgar de su provincia para no aparecer como raíces sueltas.
  for (const o of objetos.values()) {
    if ((o.parent_yvy_id == null || o.parent_yvy_id === '') && o.prov_yvy_id != null && String(o.prov_yvy_id).trim() !== '') {
      const provId = Number(o.prov_yvy_id);
      if (objetos.has(provId) && provId !== o.yvy_id) {
        o.parent_yvy_id = provId;
      }
    }
  }
  datos = {
    generado: mr.generado,
    objetos,
    relaciones: (rr.relaciones || []).map((r) => ({
      ...r,
      origen_yvy_id: Number(r.origen_yvy_id),
      destino_yvy_id: Number(r.destino_yvy_id),
    })),
  };
  // Índice O(1) para getHijos — evita filter O(n) por cada nodo del árbol
  hijosIndex = new Map();
  for (const o of datos.objetos.values()) {
    const p = o.parent_yvy_id;
    if (p == null || p === '') continue;
    const k = Number(p);
    if (!hijosIndex.has(k)) hijosIndex.set(k, []);
    hijosIndex.get(k).push(o);
  }
  return datos;
}

export function getObjetos() {
  return datos ? [...datos.objetos.values()] : [];
}

export function getObjeto(yvyId) {
  return datos ? datos.objetos.get(Number(yvyId)) : undefined;
}

/** Raíces del árbol (países / objetos sin padre presente en el catálogo). */
export function getRaices() {
  const objetos = getObjetos();
  const ids = new Set(objetos.map((o) => o.yvy_id));
  return objetos.filter((o) => o.parent_yvy_id == null || !ids.has(Number(o.parent_yvy_id)));
}

export function getHijos(yvyId) {
  if (hijosIndex) return hijosIndex.get(Number(yvyId)) || [];
  // Fallback antes de cargar (no debería ocurrir en uso normal)
  return getObjetos().filter((o) => o.parent_yvy_id === Number(yvyId));
}

export function getPadre(objeto) {
  if (!objeto || objeto.parent_yvy_id == null) return null;
  return getObjeto(objeto.parent_yvy_id);
}

/** Relaciones donde el objeto es origen (chips de la ficha). */
export function getRelaciones(yvyId) {
  const id = Number(yvyId);
  return (datos?.relaciones || []).filter((r) => r.origen_yvy_id === id);
}

// --------------------------------------------------------------
// Objeto activo (ficha + banda visible + compartir)
// --------------------------------------------------------------
export function setObjetoActivo(objeto) {
  objetoActivo = objeto || null;
}

export function getObjetoActivo() {
  return objetoActivo;
}

/**
 * Registra la función que navega el mapa a un objeto (la inyecta
 * main.js para evitar import circular).
 */
export function setNavegador(fn) {
  navigator = fn;
}

export function navegarA(yvyId) {
  if (navigator) navigator(Number(yvyId));
}

// --------------------------------------------------------------
// Formato
// --------------------------------------------------------------
export function formatKM2(km2) {
  if (km2 == null || !Number.isFinite(Number(km2))) return '–';
  return `${Number(km2).toLocaleString('es-AR', { maximumFractionDigits: 1 })} km²`;
}

export function etiquetaNivel(nivel) {
  return NIVEL_LABEL[nivel] || nivel;
}
