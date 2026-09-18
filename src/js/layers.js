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
import { medicionActiva } from './measure.js';

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
  const filtro = ['==', ['to-number', ['coalesce', ['get', 'id'], ['get', 'yvy_id']]], obj.yvy_id];

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
      'line-color': '#111111',
      'line-width': obj.nivel === 'pais' ? 2.4 : 2,
      'line-opacity': 0.9,
    },
  });

  // Clic → ficha del objeto (nada de tabla de atributos).
  // Si se está midiendo, el clic agrega un punto y no abre la ficha.
  map.on('click', `layer-${id}`, (e) => {
    if (!e.features || e.features.length === 0) return;
    if (medicionActiva()) return;
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
        'line-opacity': 0.9 }
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

/**
 * Firma genérica para alternar capas temáticas (FFCC, Rutas, Hidro, etc.).
 * Escala a 50+ capas temáticas a 60fps sin duplicar código.
 */
export function toggleCapaTematica(map, idCapa, pmtilesFile, opts = {}) {
  const sourceId = `source-tematica-${idCapa}`;
  const layerId = `layer-tematica-${idCapa}`;

  const minzoom = opts.minzoom ?? 4.5;
  const type = opts.type ?? 'line';
  const color = opts.color ?? '#10b981';

  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: 'vector',
      tiles: [`pmtiles://data/${pmtilesFile}/{z}/{x}/{y}`],
      minzoom,
      maxzoom: 16,
    });
  }

  if (!map.getLayer(layerId)) {
    const layerDef = {
      id: layerId,
      type,
      source: sourceId,
      'source-layer': opts.capaInterna || idCapa,
      minzoom,
      paint: type === 'line'
        ? { 'line-color': color, 'line-width': opts.lineWidth ?? 2.2, 'line-opacity': 0.85 }
        : { 'fill-color': color, 'fill-opacity': 0.35 },
    };
    map.addLayer(layerDef);
    return true; // activada
  }

  const curVis = map.getLayoutProperty(layerId, 'visibility');
  const nextVis = curVis === 'none' ? 'visible' : 'none';
  map.setLayoutProperty(layerId, 'visibility', nextVis);
  return nextVis === 'visible';
}

export function toggleCapaFFCC(map) {
  return toggleCapaTematica(map, 'ffcc', 'FFCC.pmtiles', {
    minzoom: 4.5,
    type: 'line',
    color: '#10b981',
    capaInterna: 'FFCC',
  });
}

export function isFFCCVisible(map) {
  return !!(map.getLayer('layer-tematica-ffcc') && map.getLayoutProperty('layer-tematica-ffcc', 'visibility') !== 'none');
}

/**
 * Extrae el anillo exterior (coordenadas lng/lat) del polígono más
 * grande de un conjunto de features de `querySourceFeatures`.
 * Devuelve null si no hay ninguna geometría de polígono válida.
 */
function anilloMayorDeFeatures(features) {
  let mejor = null;
  let mejorArea = -1;
  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    const polys =
      g.type === 'Polygon' ? [g.coordinates]
        : g.type === 'MultiPolygon' ? g.coordinates
          : [];
    for (const poly of polys) {
      const ring = poly && poly[0];
      if (!ring || ring.length < 4) continue;
      let area = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      }
      area = Math.abs(area / 2);
      if (area > mejorArea) {
        mejorArea = area;
        mejor = ring;
      }
    }
  }
  return mejor;
}

/**
 * Reintenta aplicar el filtro de FFCC por polígono real cuando el mapa
 * quede idle (los tiles de la jurisdicción ya habrán cargado). Límite
 * por objeto para no reintentar indefinidamente.
 */
const reintentosFFCC = new WeakMap();

function reintentarFFCC(map, obj) {
  const n = reintentosFFCC.get(obj) || 0;
  if (n >= 3) return;
  reintentosFFCC.set(obj, n + 1);
  map.once('idle', () => {
    if (map.getLayer('layer-tematica-ffcc')) fitrarFFCCPorObjeto(map, obj);
  });
}

/**
 * Filtra la capa de FFCC por el polígono real del objeto activo
 * (provincia / depto / municipio). Cuando obj es null, elimina el
 * filtro y muestra la red nacional completa.
 *
 * Usa la geometría exacta de la jurisdicción (via querySourceFeatures
 * de su source vectorial) para que solo se vean las vías dentro del
 * límite real. Si la geometría aún no está cargada o no se dispone,
 * cae al bbox del objeto (bounds_objeto) como respaldo seguro.
 *
 * @param {import('maplibre-gl').Map} map
 * @param {object|null} obj - objeto del manifest con bounds_objeto ([w,s,e,n])
 */
export function fitrarFFCCPorObjeto(map, obj) {
  const layerId = 'layer-tematica-ffcc';
  if (!map.getLayer(layerId)) return; // capa no activa

  if (!obj || !Array.isArray(obj.bounds_objeto) || obj.bounds_objeto.length !== 4) {
    // Sin objeto activo → red nacional completa
    map.setFilter(layerId, null);
    return;
  }

  // Polígono real del objeto desde su source vectorial ya cargada
  const sourceId = `source-yvy-${obj.nivel}`;
  let polygonCoords = null;
  if (map.getSource(sourceId)) {
    try {
      const features = map.querySourceFeatures(sourceId, {
        filter: ['==', ['coalesce', ['get', 'id'], ['get', 'yvy_id']], obj.yvy_id],
      });
      polygonCoords = anilloMayorDeFeatures(features);
    } catch {
      polygonCoords = null;
    }
  }

  if (polygonCoords) {
    map.setFilter(layerId, ['within', { type: 'Polygon', coordinates: [polygonCoords] }]);
    return;
  }

  // La geometría de la jurisdicción aún no está cargada en el mapa:
  // reintentamos el polígono real cuando el mapa quede idle, sin bucles.
  reintentarFFCC(map, obj);

  // Respaldo: polígono del bbox del objeto (comportamiento vigente)
  const [minLng, minLat, maxLng, maxLat] = obj.bounds_objeto;
  const bboxPolygon = {
    type: 'Polygon',
    coordinates: [[
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat],
    ]],
  };
  map.setFilter(layerId, ['within', bboxPolygon]);
}