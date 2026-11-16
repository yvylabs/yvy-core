// ==============================================================
// layers.js — Capas de objetos Yvy
// Un PMTiles por nivel (provincias.pmtiles, departamentos.pmtiles…).
// Hay una sola source vectorial por nivel (minzoom/maxzoom/capa
// interna del header, vía manifest.json); el objeto elegido es una
// capa on-demand con filtro ["id"] === yvy_id. Solo pinta lo elegido:
// la jerarquía vive en el breadcrumb, no en el mapa.
// Estilo unificado (P2): TODOS los niveles contorno puro de 1.2 px
// (el mismo de la marca país), 2D y globo. Esmeralda = activo,
// gris neutro = cargado sin foco. Sin relleno en ningún nivel.
// El texto del basemap se oculta por completo: el único texto en el
// mapa es el de la ontología (una etiqueta por nodo, punto centro).
// ==============================================================

import { navegarA } from './manifest.js';

// Esmeralda único acento (var(--accent) en la UI): el borde de la
// jurisdicción activa. El gris neutro es para lo cargado sin foco.
const LINEA_ACTIVA = '#10B981';
const LINEA_INACTIVA = '#334155';
// El px de la marca país, unificado para todos los niveles.
const BORDE_PX = 1.2;
// La geometría es solo render (SPEC §1): el relleno no dice nada.
// La capa fill queda (in) porque sostiene el clic por objeto.
const SIN_RELLENO = 0;
// Texto del basemap: OCULTO en el globo lleno (feedback fase 1 — el único
// texto visible allí es el de la ontología, los nodos del grafo); en la
// TIRA del dossier se re-enciende para orientar (setEtiquetasBase).
const OPACIDAD_VECINOS = 0.3;

/**
 * Ocultar todas las capas de texto del basemap: lugar, agua, rutas,
 * POI, escudos ("5", "43" incluidos). Si es symbol y lleva text-field,
 * la capa se apaga. Los iconos sin texto no se tocan.
 * R5-d: guardo los ids para que setEtiquetasBase() pueda re-encender
 * SOLO la tira (dossier): en el globo lleno el único texto visible es
 * el de la ontología (SPEC §4).
 */
let etiquetasOn = false;

function aplicarEtiquetasBase(map, visible) {
  for (const id of map.__yvyTextosBase || []) {
    try {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    } catch { /* capa no consultable: ignorar */ }
  }
}

export function silenciarTextosBase(map) {
  const capas = (map.getStyle() && map.getStyle().layers) || [];
  const ids = [];
  for (const l of capas) {
    if (l.type !== 'symbol' || !l.layout || !('text-field' in l.layout)) continue;
    ids.push(l.id);
  }
  map.__yvyTextosBase = ids;
  aplicarEtiquetasBase(map, etiquetasOn);
}

/**
 * Etiquetas del basemap: visibles SOLO en la tira del dossier (el
 * mini-mapa orientación con nombres reales); ocultas en mapa lleno.
 * Puede llamarse antes de que el estilo cargue: el flag persiste y
 * silenciarTextosBase lo aplica al llegar el styledata.
 */
export function setEtiquetasBase(map, visible) {
  etiquetasOn = !!visible;
  if (map && map.__yvyTextosBase) aplicarEtiquetasBase(map, etiquetasOn);
}

// Geometría por nivel (SPEC §6: liviano en el deploy, pesado en R2):
// - municipio → R2 vía functions/tiles/* (único >25 MB, no entra a dist).
// - resto → estático de Pages vía /data/* (la Function de /data/* rebana
//   los rangos a 206 porque ASSETS.fetch devuelve 200-full ante Range).
// La capa interna se infiere del nombre igual que hace el build
// (capa === nombre del archivo: paises, provincias, departamentos…).
const PMTILES_R2_POR_NIVEL = { municipio: 'municipios.pmtiles' };

/** Nombre del archivo PMTiles del objeto (el nivel manda; fallback al manifest). */
function archivoPmtiles(obj) {
  if (PMTILES_R2_POR_NIVEL[obj.nivel]) return PMTILES_R2_POR_NIVEL[obj.nivel];
  if (obj.pmtiles) return obj.pmtiles;
  if (obj.capa_interna) return obj.capa_interna + '.pmtiles';
  return null;
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
 * Agrega las capas del objeto (fill invisible + contorno + etiqueta) si
 * no están cargadas. Un solo estilo para país/provincia/depto/municipio.
 * @param {import('maplibre-gl').Map} map
 * @param {object} obj - entrada del manifest
 */
export function agregarCapaObjeto(map, obj) {
  const id = `yvy-${obj.yvy_id}`;
  if (map.getLayer(`layer-${id}`)) return;

  // Barrio se desactiva temporalmente por cableado incorrecto de sus capas internas
  if (obj.nivel === 'barrio') return;

  const sourceId = cargarSourceNivel(map, obj);
  if (!sourceId) return;

  const capaInterna = obj.capa_interna || (archivoPmtiles(obj) || '').replace(/\.pmtiles$/, '');
  // On-demand: la capa ignora el min/max del header y pinta por overzoom
  // en cualquier zoom (el header solo limita el fetch en la source).
  // Sin esto, volar a un barrio (z15+) ocultaba su propia capa (max14).
  const minzoom = 0;
  const maxzoom = 22;
  // El id MVT no siempre existe (paises trae id como propiedad): se prueban
  // primero yvy_id, luego id como propiedad, y recién al final el id top-level.
  const filtro = ['==', ['to-number', ['coalesce', ['get', 'yvy_id'], ['get', 'id'], ['id']]], obj.yvy_id];

  // Relleno invisible: solo sostiene el hit-test del clic (el render
  // no muestra relleno en ningún nivel).
  map.addLayer({
    id: `layer-${id}`,
    type: 'fill',
    source: sourceId,
    'source-layer': capaInterna,
    minzoom,
    maxzoom,
    filter: filtro,
    paint: {
      'fill-color': LINEA_ACTIVA,
      'fill-opacity': SIN_RELLENO,
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
      'line-width': BORDE_PX,
      'line-opacity': 1,
    },
  });

  // Etiqueta del grafo: el nombre del objeto activo en esmeralda.
  // Las demás etiquetas (basemap) van atenuadas a OPACIDAD_VECINOS.
  // NO sale del source vectorial: un polígono vive recortado en cada
  // tesela y partido en islas, y cada fragmento pondría su propio label
  // (el bug de las múltiples "ARGENTINA"). Sale de un source GeoJSON de
  // UN solo punto (el `centro` del manifest, el mismo del flyTo):
  // una etiqueta por nodo, garantizado, 2D y globo.
  // El label sale SIEMPRE de un punto interior: centro_etiqueta es el
  // polylabel del build; sin él cae al centro normal (fallback).
  const punto = Array.isArray(obj.centro_etiqueta) ? obj.centro_etiqueta : obj.centro;
  map.addSource(`punto-` + id, {
    type: 'geojson',
    data: {
      type: 'Feature',
      properties: { yvy_id: obj.yvy_id },
      geometry: { type: 'Point', coordinates: punto },
    },
  });
  map.addLayer({
    id: `label-${id}`,
    type: 'symbol',
    source: `punto-${id}`,
    minzoom,
    maxzoom,
    layout: {
      'text-field': obj.nombre_oficial,
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.08,
      'text-anchor': 'center',
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': LINEA_ACTIVA,
      'text-halo-color': 'rgba(0,0,0,0.75)',
      'text-halo-width': 1.4,
      'text-opacity': 1,
    },
  });

  // Clic → navegar al objeto (vuelo + ficha + hash). El target es el
  // relleno invisible (policía por área); para país sigue el outline,
  // que ya funcionaba así.
  const capaEventos = obj.nivel === 'pais' ? `outline-${id}` : `layer-${id}`;

  map.on('click', capaEventos, (e) => {
    if (!e.features || e.features.length === 0) return;
    navegarA(obj.yvy_id);
  });
  configurarHover(map, obj, capaEventos);
  map.on('mouseenter', capaEventos, () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', capaEventos, () => {
    map.getCanvas().style.cursor = '';
  });
}

/**
 * Alterna la visibilidad de las capas de un objeto y aplica el estado:
 * activo → esmeralda 1.2 px + etiqueta brillante; inactivo → gris neutro
 * 1.2 px + etiqueta al 0.3. Presente en 2D y globo por igual (px line).
 */
export function setVisibilidadObjeto(map, yvyId, visible, esActivo) {
  const id = `yvy-${yvyId}`;
  const visibilidad = visible ? 'visible' : 'none';
  const lineaFoco = esActivo
    ? { 'line-color': LINEA_ACTIVA, 'line-width': BORDE_PX, 'line-opacity': 1 }
    : { 'line-color': LINEA_INACTIVA, 'line-width': BORDE_PX, 'line-opacity': 1 };
  const textoFoco = esActivo
    ? { 'text-color': LINEA_ACTIVA, 'text-opacity': 1 }
    : { 'text-color': LINEA_INACTIVA, 'text-opacity': OPACIDAD_VECINOS };
  for (const [layerId, props] of [
    [`layer-${id}`, { visibility: visibilidad }],
    [`outline-${id}`, { visibility: visibilidad, ...lineaFoco }],
    [`label-${id}`, { visibility: visibilidad, ...textoFoco }],
  ]) {
    if (!map.getLayer(layerId)) continue;
    map.setLayoutProperty(layerId, 'visibility', props.visibility);
    for (const k of Object.keys(props)) {
      if (k !== 'visibility') map.setPaintProperty(layerId, k, props[k]);
    }
  }
}
