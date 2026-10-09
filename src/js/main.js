// ==============================================================
// main.js — Yvy Explorer v3 (objeto-céntrico)
// Visor globular con PMTiles 3.x + MapLibre GL 5.x
// Cargar ≠ Dibujar: cada yvy_id se carga una sola vez (caché
// en memoria) y el pan/zoom solo dibuja. El catálogo (manifest)
// llega de los CSVs de data/registry via el plugin yvyManifest.
// ==============================================================

import '@fontsource-variable/inter';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as pmtiles from 'pmtiles';

import { cargarDatos, getObjeto, getPadre, setObjetoActivo, setNavegador } from './manifest.js';
import { agregarCapaObjeto, setVisibilidadObjeto } from './layers.js';
import { inicializarUIPaneles } from './ui.js';
import { mostrarObjeto, limpiarFicha } from './objeto.js';
import { inicializarBarraTecnica, setObjetoBarra } from './statusbar.js';
import { inicializarCompartirVista, setObjetoActual } from './share.js';
import { inicializarBienvenida } from './welcome.js';
import { track } from './telemetry.js';

const YVY_STYLE = './styles/yvy-dark.json';
// Atribución del basemap (la pone MapLibre desde el style): OpenFreeMap © OpenMapTiles © OpenStreetMap.

/** Basemap vectorial oscuro (fork OpenFreeMap, etiquetas en español). Con fallback a fondo plano. */
let estiloAplicado = false;
function aplicarEstiloBase(map) {
  if (estiloAplicado) return;
  estiloAplicado = true;
  // setStyle resetea la proyección a mercator: re-aplicar globo al cargar.
  map.once('styledata', () => {
    try {
      if (!globeFallback && map.setProjection) map.setProjection({ type: 'globe' });
    } catch (e) {
      console.warn('[yvy] proyección no aplicada:', e?.message);
    }
  });
  try {
    map.setStyle(YVY_STYLE);
  } catch (e) {
    console.warn('[yvy] style base no aplicado, fondo plano:', e?.message);
  }
}

// Expone maplibregl globalmente para popups en otros módulos
window.maplibregl = maplibregl;

// --------------------------------------------------------------
// Registro del protocolo PMTiles 3.x para MapLibre 5.x
// --------------------------------------------------------------
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));

// --------------------------------------------------------------
// Interfaz de controles nativos de MapLibre en español
// --------------------------------------------------------------
const LOCALE_ES = {
  'AttributionControl.ToggleAttribution': 'Alternar atribución',
  'AttributionControl.MapFeedback': 'Reportar un problema del mapa',
  'FullscreenControl.Enter': 'Pantalla completa',
  'FullscreenControl.Exit': 'Salir de pantalla completa',
  'GeolocateControl.FindMyLocation': 'Ubicarme',
  'GeolocateControl.LocationNotAvailable': 'Ubicación no disponible',
  'LogoControl.Title': 'Logo de MapLibre',
  'Map.Title': 'Mapa',
  'Marker.Title': 'Marcador del mapa',
  'NavigationControl.ResetBearing': 'Arrastrá para rotar el mapa, clic para restablecer el norte',
  'NavigationControl.ZoomIn': 'Acercar',
  'NavigationControl.ZoomOut': 'Alejar',
  'Popup.Close': 'Cerrar popup',
  'ScaleControl.Feet': 'pies',
  'ScaleControl.Meters': 'm',
  'ScaleControl.Kilometers': 'km',
  'ScaleControl.Miles': 'mi',
  'ScaleControl.NauticalMiles': 'mn',
  'GlobeControl.Enable': 'Vista globo',
  'GlobeControl.Disable': 'Vista plano',
  'TerrainControl.Enable': 'Activar relieve',
  'TerrainControl.Disable': 'Desactivar relieve',
  'CooperativeGesturesHandler.WindowsHelpText': 'Usá Ctrl + rueda para acercar y alejar',
  'CooperativeGesturesHandler.MacHelpText': 'Usá ⌘ + rueda para acercar y alejar',
  'CooperativeGesturesHandler.MobileHelpText': 'Usá dos dedos para mover el mapa',
};

// --------------------------------------------------------------
// Inicialización del mapa — globo 3D con fallback si WebGL está deshabilitado
// (sandbox, VM sin GPU). Evita el crash "Failed to initialize WebGL".
// --------------------------------------------------------------
function crearMapa(projectionType) {
  return new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {},
      layers: [],
      projection: { type: projectionType },
    },
    locale: LOCALE_ES,
    center: [-60, -24],
    zoom: 2.2,
    attributionControl: true,
    failIfMajorPerformanceCaveat: false,
  });
}

let map;
let globeFallback = false;

// Detectar si WebGL está disponible antes de intentar globe
function webglDisponible() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl') || c.getContext('webgl2') || c.getContext('experimental-webgl'));
  } catch { return false; }
}

const intentoGlobo = webglDisponible() ? 'globe' : 'mercator';
try {
  map = crearMapa(intentoGlobo);
  if (intentoGlobo !== 'globe') globeFallback = true;
} catch (e) {
  console.warn('[yvy] WebGL globe falló, usando mercator:', e?.message);
  map = crearMapa('mercator');
  globeFallback = true;
}

window.yvyMap = map;

// Capturar errores de creación de contexto WebGL en runtime (sandbox)
map.on('error', (e) => {
  if (e?.error?.message?.includes('WebGL') || e?.type === 'webglcontextcreationerror') {
    console.error('[yvy] WebGL error:', e.error?.message || e.message);
  }
});
const mapCanvas = document.getElementById('map');
if (mapCanvas) {
  mapCanvas.addEventListener('webglcontextcreationerror', (e) => {
    e.preventDefault();
    console.warn('[yvy] webglcontextcreationerror capturado, se usará fallback mercator si es necesario');
  });
}

// Controles nativos (toolbar derecho)
map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'top-right');
if (!globeFallback) map.addControl(new maplibregl.GlobeControl(), 'top-right');
map.addControl(new maplibregl.FullscreenControl(), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 120 }), 'bottom-right');

// --------------------------------------------------------------
// Carga de objetos Yvy — load once, dibujar siempre
// --------------------------------------------------------------
const cargados = new Set(); // yvy_ids con geometría ya en el mapa

function cargarConContexto(obj) {
  // Solo el objeto elegido pinta. Los ancestros viven en el breadcrumb,
  // no en el mapa. Un addLayer nunca aborta la navegación.
  if (obj.pmtiles && !cargados.has(obj.yvy_id)) {
    try {
      agregarCapaObjeto(map, obj);
    } catch (e) {
      console.warn('[yvy] capa no creada para', obj.yvy_id, e?.message);
    }
    cargados.add(obj.yvy_id);
  }
}

/**
 * Banda visible por foco: solo pinta el objeto activo.
 * La jerarquía vive en el breadcrumb, no en el mapa.
 */
function aplicarBandaVisible(yvyIdActivo) {
  const visibles = new Set(yvyIdActivo != null ? [Number(yvyIdActivo)] : []);
  for (const id of cargados) {
    setVisibilidadObjeto(map, id, visibles.has(id), id === yvyIdActivo);
  }
}

async function irAYvyId(yvyId) {
  // Asegura el catálogo antes de resolver el objeto (idempotente)
  await garantizarDatos();

  if (yvyId == null) {
    // Deseleccionar: ocultar todo el contexto y limpiar la UI
    setObjetoActual(null);
    aplicarBandaVisible(null);
    setObjetoBarra(null);
    limpiarFicha();
    return;
  }
  const obj = getObjeto(yvyId);
  if (!obj) return;
  setObjetoActivo(obj);
  setObjetoActual(yvyId);
  setObjetoBarra(obj);
  cargarConContexto(obj);
  aplicarBandaVisible(yvyId);

  // Vuelo: si el build calculó los límites reales del objeto, se ajusta
  // el zoom para que entre entero (con padding); si no, centro/zoom fijos
  let centro = obj.centro || (getPadre(obj)?.centro) || [-60, -20];
  let zoomObjetivo = obj.zoom ?? 7;
  try {
    if (Array.isArray(obj.bounds_objeto) && obj.bounds_objeto.length === 4) {
      const b = obj.bounds_objeto;
      const cam = map.cameraForBounds(
        [
          [b[0], b[1]],
          [b[2], b[3]],
        ],
        {
          padding: 80,
          maxZoom: (obj.maxzoom ?? 22) + 3,
          minZoom: Math.min(obj.minzoom ?? 0, 6),
        }
      );
      if (cam) {
        centro = cam.center;
        zoomObjetivo = cam.zoom;
      }
    }
  } catch {
    // bounds degenerados: se vuela a centro/zoom fijos, nunca se aborta la ficha
  }
  map.flyTo({ center: centro, zoom: zoomObjetivo, duration: 1400 });

  // La ficha es fija a la izquierda. Si el objeto queda debajo del panel
  // (zona izquierda), se desplaza el mapa suavemente hacia la derecha lo
  // justo para que nunca quede tapado. Solo se aplica a los que quedarían
  // bajo la ficha; el resto no se mueve.
  map.once('moveend', () => {
    if (!obj || !Array.isArray(obj.centro)) return;
    try {
      const pt = map.project(obj.centro);
      const panel = document.getElementById('panel-explorador');
      const panelLimit = (panel && !panel.hidden ? panel.offsetWidth : 320) + 24;
      if (pt.x < panelLimit) {
        const nc = map.unproject([pt.x + (panelLimit - pt.x), pt.y]);
        map.easeTo({ center: [nc.lng, nc.lat], duration: 700 });
      }
    } catch { /* no desplaza si falla la proyección */ }
  });

  mostrarObjeto(yvyId);
}

// El navegador de la ficha (padre/hijos/chips) usa la misma ruta
setNavegador(irAYvyId);

// --------------------------------------------------------------
// Carga perezosa del catálogo (una vez, en memoria).
// El globo 3D arranca solo; la ficha navega por padre/hijos.
// --------------------------------------------------------------
let datosGarantizados = false;

async function garantizarDatos() {
  if (datosGarantizados) return;
  await cargarDatos();
  datosGarantizados = true;
}

// --------------------------------------------------------------
// Volver al globo: el logo/brand restablece la vista inicial
// --------------------------------------------------------------
const VISTA_INICIAL = { center: [-60, -24], zoom: 2.2, pitch: 0, bearing: 0 };

function volverAlInicio() {
  setObjetoActual(null);
  setObjetoBarra(null);
  limpiarFicha();
  aplicarBandaVisible(null);
  map.stop();
  map.flyTo({ ...VISTA_INICIAL, duration: 2600 });
}

const brandEl = document.querySelector('.topbar__brand');
if (brandEl) {
  brandEl.addEventListener('click', (e) => {
    e.preventDefault();
    volverAlInicio();
  });
}

// --------------------------------------------------------------
// Evento load del mapa
// --------------------------------------------------------------
inicializarUIPaneles();

map.on('load', async () => {
  map.resize();

  // Basemap vectorial oscuro (OpenFreeMap forkeado, español). Sin satélite.
  aplicarEstiloBase(map);

  // Catálogo Yvy (manifest + relaciones) en background: no dibuja
  // ninguna capa ni bloquea el globo. El árbol se arma bajo demanda.
  try {
    await garantizarDatos();
  } catch (err) {
    console.error('No se pudo cargar el manifiesto territorial:', err);
  }

  // Bienvenida: buscar jurisdicción o elegir sugerida.
  // Al elegir navega (vuelo + ficha con hijos y padres). No tapa el globo.
  inicializarBienvenida(irAYvyId);

  // Compartir vista (permalink por yvy_id)
  inicializarCompartirVista(map, irAYvyId);

  // Barra de producto
  inicializarBarraTecnica(map);

  track('app_load', { globe_fallback: globeFallback });

  // El botón de búsqueda del toolbar reabre la bienvenida (manejado en welcome.js).
});

window.addEventListener('resize', () => {
  map.resize();
});
