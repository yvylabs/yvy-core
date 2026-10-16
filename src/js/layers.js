// ==============================================================
// layers.js — Capas de objetos Yvy
// Un PMTiles por nivel (provincias.pmtiles, departamentos.pmtiles…).
// Hay una sola source vectorial por nivel (minzoom/maxzoom/capa
// interna del header, vía manifest.json); el objeto elegido es una
// capa on-demand con filtro ["id"] === yvy_id. Solo pinta lo elegido:
// la jerarquía vive en el breadcrumb, no en el mapa.
// Clic sobre un objeto → abre la ficha (panel Objeto).
// ==============================================================

import { navegarA } from './manifest.js';

const OPACIDAD_ACTIVO = 0.22;
const OPACIDAD_CONTEXTO = 0.15;
const FILL_ACTIVO = '#10B981';
const LINEA_ACTIVA = '#34D399';

// Geometría por nivel (SPEC §6: liviano en el deploy, pesado en R2):
// - municipio → R2 vía functions/tiles/* (único >25 MB, no entra a dist).
// - resto → estático de Pages vía /data/* (la Function de /data/* rebana
//   los rangos a 206 porque ASSETS.fetch devuelve 200-full ante Range).
// La capa interna se infiere del nombre igual que hace el build
// (capa === nombre del archivo: paises, provincias, departamentos…).
const PMTILES_R2_POR_NIVEL = { municipio: 'municipios.pmtiles' };

/** Nombre del archivo PMTiles del objeto (el nivel manda; fallback al manifest). */
function archivoPmtiles(obj) {
  return PMTILES_R2_POR_NIVEL[obj.nivel] || obj.pmtiles || null;
}

/** Ruta del archivo: tiles/* (R2 vía Function) o data/* (legado estático). */
export function rutaPmtiles(obj) {
  const archivo = archivoPmtiles(obj);
  if (!archivo) return null;
  return PMTILES_R2_POR_NIVEL[obj.nivel] ? `tiles/${archivo}` : `data/${archivo}`;
}

// --------------------------------------------------------------
// Tooltip de hover: nombre del objeto bajo el cursor.
// Sale del manifest (cada PMTiles = un objeto), no de las
// propiedades del GeoJSON: cero dependencia de atributos.
// --------------------------------------------------------------
let tooltip = null;

function obtenerTooltip(map) {
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'yvy-tooltip';
    tooltip.style.display = 'none';
    map.getContainer().appendChild(tooltip);
  }
  return tooltip;
}

function ocultarTooltip(map) {
  const t = obtenerTooltip(map);
  t.style.display = 'none';
}

function muestrearTooltip(map, obj, e) {
  const t = obtenerTooltip(map);
  t.textContent = obj.nombre_oficial;
  const cont = map.getContainer();
  const x = Math.min(Math.max(e.point.x, 70), cont.clientWidth - 70);
  t.style.left = `${x}px`;
  t.style.top = `${e.point.y - 12}px`;
  t.style.display = 'block';
}

function configurarHover(map, obj, layerId) {
  map.on('mouseenter', layerId, (e) => muestrearTooltip(map, obj, e));
  map.on('mousemove', layerId, (e) => muestrearTooltip(map, obj, e));
  map.on('mouseleave', layerId, () => ocultarTooltip(map));
}

/**
 * Crea la source vectorial del nivel (una por nivel, idempotente).
 * @param {import('maplibre-gl').Map} map
 * @param {object} obj - entrada del manifest (cualquier objeto del nivel)
 * @returns {string|null} id de la source
 */
function cargarSourceNivel(map, obj) {
  const sourceId = `source-yvy-${obj.nivel}`;
  if (map.getSource(sourceId)) return sourceId;
  const ruta = rutaPmtiles(obj);
  if (!ruta) return null;

  map.addSource(sourceId, {
    type: 'vector',
    tiles: [`pmtiles://${ruta}/{z}/{x}/{y}`],
    // Provincias (TDF con Antártida) permiten zoom bajo para encuadre completo
    minzoom: obj.nivel === 'provincia' ? Math.min(obj.minzoom ?? 4, 1.5) : (obj.minzoom ?? 0),
    maxzoom: obj.maxzoom ?? 22,
  });
  return sourceId;
}

/**
 * Agrega la capa del objeto (fill + outline) si no está cargada.
 * @param {import('maplibre-gl').Map} map
 * @param {object} obj - entrada del manifest
 */
export function agregarCapaObjeto(map, obj) {
  const id = `yvy-${obj.yvy_id}`;
  if (map.getLayer(`layer-${id}`)) return;

  const sourceId = cargarSourceNivel(map, obj);
  if (!sourceId) return;

  const capaInterna = obj.capa_interna || (archivoPmtiles(obj) || '').replace(/\.pmtiles$/, '');
  // On-demand: la capa ignora el min/max del header y pinta por overzoom
  // en cualquier zoom (el header solo limita el fetch en la source).
  // Sin esto, volar a un barrio (z15+) ocultaba su propia capa (max14).
  const minzoom = 0;
  const maxzoom = 22;
  // El id MVT no siempre existe (paises trae id como propiedad): se prueban
  // primero las propiedades (yvy_id, id) y recién al final el id top-level.
  // Con ['id'] primero, MapLibre hace to-number(undefined) → error y el
  // filtro da null (el país nunca pintaba, sin ningún error visible).
  const filtro = ['==', ['to-number', ['coalesce', ['get', 'yvy_id'], ['get', 'id'], ['id']]], obj.yvy_id];

  map.addLayer({
    id: `layer-${id}`,
    type: 'fill',
    source: sourceId,
    'source-layer': capaInterna,
    minzoom,
    maxzoom,
    filter: filtro,
    paint: {
      'fill-color': FILL_ACTIVO,
      'fill-opacity': OPACIDAD_ACTIVO,
    },
  });

  map.addLayer({
    id: `outline-${id}`,
    type: 'line',
    source: sourceId,
    'source-layer': capaInterna,
    minzoom,
    maxzoom,
    filter: filtro,
    paint: {
      // Opacidad 1.0 a propósito: los bordes compartidos entre tiles se
      // pintan 2 veces; con <1 se oscurecen y aparece la "costura".
      'line-color': LINEA_ACTIVA,
      'line-width': obj.nivel === 'pais' ? 3 : 2.5,
      'line-opacity': 1,
    },
  });

  // Clic → navegar al objeto (vuelo + ficha + hash), igual que el resto.
  map.on('click', `layer-${id}`, (e) => {
    if (!e.features || e.features.length === 0) return;
    navegarA(obj.yvy_id);
  });
  configurarHover(map, obj, `layer-${id}`);
  map.on('mouseenter', `layer-${id}`, () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', `layer-${id}`, () => {
    map.getCanvas().style.cursor = '';
  });
}

/**
 * Alterna la visibilidad de la capa de un objeto y aplica el modo
 * foco: el activo se pinta fuerte (fill opaco + borde grueso), los
 * ancestros quedan como contexto tenue.
 */
export function setVisibilidadObjeto(map, yvyId, visible, esActivo) {
  const id = `yvy-${yvyId}`;
  const paint = esActivo
    ? { 'fill-opacity': OPACIDAD_ACTIVO,
        'line-width': 3,
        'line-opacity': 1 }
    : { 'fill-opacity': OPACIDAD_CONTEXTO,
        'line-width': 1.5,
        'line-opacity': 0.5 };
  for (const [layerId, props] of [
    [`layer-${id}`, { visibility: visible ? 'visible' : 'none', 'fill-opacity': paint['fill-opacity'] }],
    [`outline-${id}`, { visibility: visible ? 'visible' : 'none', 'line-width': paint['line-width'], 'line-opacity': paint['line-opacity'] }],
  ]) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', props.visibility);
      for (const k of Object.keys(props)) {
        if (k !== 'visibility') map.setPaintProperty(layerId, k, props[k]);
      }
    }
  }
}
