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
import { inicializarRazonador } from './reasoner.js';
import { agregarCapaObjeto, setVisibilidadObjeto } from './layers.js';
import { inicializarUIPaneles } from './ui.js';
import { mostrarObjeto, limpiarFicha } from './objeto.js';
import { inicializarBarraTecnica, setObjetoBarra } from './statusbar.js';
import { inicializarMedicion } from './measure.js';
import { inicializarEfectosAtmosfera } from './atmosphereEffects.js';
import { inicializarCompartirVista, setObjetoActual } from './share.js';
import { inicializarControlCapaBase } from './basemapControl.js';
import { inicializarAsistente } from './assistant.js';
import { inicializarBienvenida } from './welcome.js';

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
    center: [-60, -20],
    zoom: 2.24,
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

// Efectos atmosféricos — solo con globe y WebGL activo
if (!globeFallback) {
  try { inicializarEfectosAtmosfera(map); } catch (e) { console.warn('[yvy] efectos atmósfera no iniciados (fallback):', e?.message); }
}

const basemapControlEl = document.getElementById('basemap-control');

// --------------------------------------------------------------
// Carga de objetos Yvy — load once, dibujar siempre
// --------------------------------------------------------------
const cargados = new Set(); // yvy_ids con geometría ya en el mapa

function cargarConContexto(obj) {
  // El objeto activo y sus ancestros (contexto jerárquico)
  let cur = obj;
  while (cur && !cargados.has(cur.yvy_id)) {
    if (cur.pmtiles) {
      agregarCapaObjeto(map, cur);
      cargados.add(cur.yvy_id);
    }
    cur = getPadre(cur);
  }
}

/**
 * Banda visible por foco: solo pintan el objeto activo (modo foco)
 * y su jerarquía como contexto tenue. Lo que quedó cargado de
 * antes se oculta al cambiar de objeto.
 */
function aplicarBandaVisible(yvyIdActivo) {
  const visibles = new Set();
  let cur = yvyIdActivo != null ? getObjeto(yvyIdActivo) : null;
  while (cur) {
    visibles.add(cur.yvy_id);
    cur = getPadre(cur);
  }
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
  map.flyTo({ center: centro, zoom: zoomObjetivo, duration: 1400 });

  // La ficha es fija a la izquierda. Si el objeto queda debajo del panel
  // (zona izquierda), se desplaza el mapa suavemente hacia la derecha lo
  // justo para que nunca quede tapado. Solo se aplica a los que quedarían
  // bajo la ficha; el resto no se mueve.
  map.once('moveend', () => {
    if (!obj || !Array.isArray(obj.centro)) return;
    try {
      const pt = map.project(obj.centro);
      const panelLimit = 320 + 24; // ancho de la ficha + aire
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
// Carga perezosa del Explorador (árbol desde el manifest)
// El árbol de jurisdicciones (miles de nodos) NO se construye en
// el load: solo globo 3D al iniciar. Se arma la primera vez que
// el usuario abre el panel Explorador.
// --------------------------------------------------------------
let datosGarantizados = false;

async function garantizarDatos() {
  if (datosGarantizados) return;
  await cargarDatos();
  inicializarRazonador();
  datosGarantizados = true;
}

// --------------------------------------------------------------
// Volver al globo: el logo/brand restablece la vista inicial
// --------------------------------------------------------------
const VISTA_INICIAL = { center: [-60, -20], zoom: 2.24, pitch: 0, bearing: 0 };

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

  // Globo 3D con imagen satelital (Esri World Imagery).
  inicializarControlCapaBase(map, basemapControlEl, 'AR', 'satelital');

  // Catálogo Yvy (manifest + relaciones) en background: no dibuja
  // ninguna capa ni bloquea el globo. El árbol se arma bajo demanda.
  try {
    await garantizarDatos();
  } catch (err) {
    console.error('No se pudo cargar el manifiesto territorial:', err);
  }

  // Bienvenida Palantir: buscar jurisdicción o elegir sugerida.
  // Al elegir navega (vuelo + ficha con hijos y padres). No tapa el globo.
  inicializarBienvenida(irAYvyId);

  // Medición (distancias y superficies)
  inicializarMedicion(map);

  // Compartir vista (permalink por yvy_id)
  inicializarCompartirVista(map, irAYvyId);

  // Barra de producto
  inicializarBarraTecnica(map);

  // Asistente de Geointeligencia (0ms Rule Engine sobre la ontología)
  inicializarAsistente(map, irAYvyId);

  // Ping al geo.worker SOLO en dev: valida el protocolo sin bloquear nada.
  // Si el Worker falla, se loguea y el visor sigue por el camino actual.
  if (import.meta.env && import.meta.env.DEV) {
    try {
      const geoWorker = new Worker(new URL('./workers/geo.worker.js', import.meta.url), { type: 'module' });
      const esperar = (msg) => new Promise((resolve) => {
        const t = setTimeout(() => resolve({ estado: 'timeout', datos: null, meta: {} }), 5000);
        geoWorker.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
        geoWorker.postMessage(msg);
      });
      (async () => {
        const r1 = await esperar({ tipo: 'cargar', datasetId: '__inexistente__', modo: 'full' });
        console.info('[yvy][geo-worker] ping missing:', r1 && r1.estado, '|', r1 && r1.meta && r1.meta.mensaje);
        const r2 = await esperar({ tipo: 'cargar', datasetId: 'jurisdicciones', modo: 'full' });
        console.info('[yvy][geo-worker] ping ok:', r2 && r2.estado);
        geoWorker.terminate();
      })().catch((e) => console.warn('[yvy][geo-worker] ping falló (no bloqueante):', e));
    } catch (e) {
      console.warn('[yvy][geo-worker] no se pudo crear en dev (no bloqueante):', e);
    }
  }

  // El botón de búsqueda del toolbar reabre la bienvenida (manejado en welcome.js).
});

window.addEventListener('resize', () => {
  map.resize();
});
