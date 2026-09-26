// ==============================================================
// layers.js — Capas de objetos Yvy
// Un PMTiles por nivel (provincias.pmtiles, departamentos.pmtiles…).
// Hay una sola source vectorial por nivel (minzoom/maxzoom/capa
// interna del header, vía manifest.json); cada objeto visible
// (activo + ancestros) es una capa on-demand con filtro
// ["get","id"] === yvy_id, así no pintamos objetos ajenos.
// Clic sobre un objeto → abre la ficha (panel Objeto).
// ==============================================================

import { mostrarObjeto } from './objeto.js';

const OPACIDAD_ACTIVO = 0.35;
const OPACIDAD_CONTEXTO = 0.15;

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
  if (!obj.pmtiles) return null;

  map.addSource(sourceId, {
    type: 'vector',
    tiles: [`pmtiles://data/${obj.pmtiles}/{z}/{x}/{y}`],
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

  const capaInterna = obj.capa_interna || obj.pmtiles.replace(/\.pmtiles$/, '');
  // Provincias (y TDF con Antártida) deben pintarse incluso a zoom bajo
  // para que el encuadre completo del bounds sea visible.
  const minzoom = obj.nivel === 'provincia' ? Math.min(obj.minzoom ?? 4, 1.5) : (obj.minzoom ?? 0);
  const maxzoom = obj.maxzoom ?? 22;
  const filtro = ['==', ['to-number', ['coalesce', ['id'], ['get', 'id'], ['get', 'yvy_id']]], obj.yvy_id];

  map.addLayer({
    id: `layer-${id}`,
    type: 'fill',
    source: sourceId,
    'source-layer': capaInterna,
    minzoom,
    maxzoom,
    filter: filtro,
    paint: {
      'fill-color': '#9ca3af',
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
      'line-color': '#111111',
      'line-width': obj.nivel === 'pais' ? 2.4 : 2,
      'line-opacity': 1,
    },
  });

  // Clic → ficha del objeto (nada de tabla de atributos).
  map.on('click', `layer-${id}`, (e) => {
    if (!e.features || e.features.length === 0) return;
    mostrarObjeto(obj.yvy_id);
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
