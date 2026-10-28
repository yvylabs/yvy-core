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

import { cargarDatos, getObjeto, getPadre, getObjetoActivo, setObjetoActivo, setNavegador } from './manifest.js';
import { agregarCapaObjeto, silenciarTextosBase, setEtiquetasBase, setVisibilidadObjeto, rutaPmtiles } from './layers.js';
import { inicializarUIPaneles, inicializarTabsMobile } from './ui.js';
import { mostrarObjeto, limpiarFicha } from './objeto.js';
import { inicializarBarraTecnica, setObjetoBarra } from './statusbar.js';
import { inicializarCompartirVista, setObjetoActual } from './share.js';
import { inicializarBienvenida, cerrarBienvenida, mostrarBienvenida } from './welcome.js';
import { inicializarPanelGrafo, refrescarGrafo } from './grafo-panel.js';
import { inicializarTema } from './tema.js';
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
      // Texto del basemap fuera: el único texto del mapa es el de la
      // ontología (una etiqueta por nodo, en esmeralda — layers.js).
      silenciarTextosBase(map);
    } catch (e) {
      console.warn('[yvy] proyección o silenciado no aplicado:', e?.message);
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
    // Bicontinental: continente + Malvinas/Georgias/Sandwich + Antártida
    // (el sector antártico 25°W–74°W llega al polo: cover por geometría).
    center: [-64, -56],
    zoom: 2.4,
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

// --------------------------------------------------------------
// Controles de la izquierda (zoom in/out + ubicación)
// --------------------------------------------------------------
function agregarControlIzquierda() {
  const btnIn = document.getElementById('btn-zoom-in');
  const btnOut = document.getElementById('btn-zoom-out');
  const btnLoc = document.getElementById('btn-location');

  if (btnIn) btnIn.addEventListener('click', () => map.zoomIn());
  if (btnOut) btnOut.addEventListener('click', () => map.zoomOut());
  if (btnLoc) btnLoc.addEventListener('click', () => {
    if (!navigator.geolocation) return alert('Geolocalización no disponible');
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords;
      map.flyTo({ center: [longitude, latitude], zoom: 13, duration: 1400 });
    }, (err) => {
      console.warn('Geolocalización denegada o no disponible:', err);
    });
  });
}

// --------------------------------------------------------------
// Mapa incrustado (R1): tira superior del dossier.
// La tira nunca roba el scroll del dossier: sin scrollZoom ni doble
// click ni teclado; al expandir (⤢) se activa la navegación completa.
// --------------------------------------------------------------
function inicializarModoMapa() {
  const btnFull = document.getElementById('btn-mapa-full');
  const btnCerrar = document.getElementById('btn-mapa-cerrar');
  if (!btnFull) return;

  const gestos = (full) => {
    const modo = full ? 'enable' : 'disable';
    try { map.scrollZoom[modo](); } catch { /* sin handler */ }
    try { map.keyboard[modo](); } catch { /* sin handler */ }
    try { map.doubleClickZoom[modo](); } catch { /* sin handler */ }
  };

  function aplicarModo(full) {
    gestos(full);
    document.documentElement.toggleAttribute('data-mapa-full', full);
    btnFull.setAttribute('aria-expanded', String(full));
    if (btnCerrar) btnCerrar.hidden = !full;
    // Encuadre por estado (R5-c/R5-d): mapa lleno = bicontinental sin
    // etiquetas de basemap; tira = fit del objeto activo + etiquetas ON.
    if (full) {
      encuadrarLleno();
      setEtiquetasBase(map, false);
    } else {
      encuadrarDossier();
      setEtiquetasBase(map, true);
    }
  }

  btnFull.addEventListener('click', () => {
    // Expandir cierra welcome si estuviera abierto (nunca ambos activos).
    cerrarBienvenida();
    aplicarModo(!document.documentElement.hasAttribute('data-mapa-full'));
  });
  if (btnCerrar) btnCerrar.addEventListener('click', () => aplicarModo(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.documentElement.hasAttribute('data-mapa-full')) aplicarModo(false);
  });
  gestos(false); // estado incrustado desde el arranque
}

// --------------------------------------------------------------
// Swap ⇄ (R1): dossier y grafo alternan lados (persistente en
// localStorage; FOUC evitado por el script inicial del head).
// --------------------------------------------------------------
function inicializarSwap() {
  const btn = document.getElementById('btn-swap');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const swap = !document.documentElement.classList.contains('layout--swap');
    document.documentElement.classList.toggle('layout--swap', swap);
    btn.setAttribute('aria-pressed', String(swap));
    try { localStorage.setItem('yvy:swap', swap ? '1' : '0'); } catch { /* storage bloqueado */ }
  });
  btn.setAttribute('aria-pressed', String(document.documentElement.classList.contains('layout--swap')));
  // Affordance de primera vez (R7): la pill se expande sola 2.6s para
  // que TODO usuario descubra el swap. Una sola vez, desktop, sin
  // reduced-motion (persistencia honesta en localStorage).
  try {
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!localStorage.getItem('yvy:swap-hint') && !reduce && innerWidth > 768) {
      localStorage.setItem('yvy:swap-hint', '1');
      btn.classList.add('swap-pill--hint');
      setTimeout(() => btn.classList.remove('swap-pill--hint'), 2600);
    }
  } catch { /* storage bloqueado */ }
}

// --------------------------------------------------------------
// Carga de objetos Yvy — load once, dibujar siempre
// Carga de objetos Yvy — load once, dibujar siempre
// --------------------------------------------------------------
const cargados = new Set(); // yvy_ids con geometría ya en el mapa

// Punto de capital (R7): dato real del manifest (capital_centro), DOM
// marker — la tira muestra dónde vive el gobierno de la jurisdicción.
let marcadorCapital = null;
function pintarCapital(obj) {
  if (marcadorCapital) { try { marcadorCapital.remove(); } catch { /* mapa reciclado */ } marcadorCapital = null; }
  if (!map || !obj || !Array.isArray(obj.capital_centro) || obj.capital_centro.length !== 2) return;
  try {
    const el = document.createElement('div');
    el.className = 'yvy-capital';
    marcadorCapital = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([Number(obj.capital_centro[0]), Number(obj.capital_centro[1])])
      .addTo(map);
  } catch (e) {
    console.warn('[yvy] marcador de capital no creado:', e?.message);
  }
}

function cargarConContexto(obj) {
  // Solo el objeto elegido pinta. Los ancestros viven en el breadcrumb,
  // no en el mapa. Un addLayer nunca aborta la navegación.
  // La geometría puede venir de Pages (obj.pmtiles) o de R2 (fallback
  // por nivel en rutaPmtiles): el gate usa el resolver, no el campo crudo.
  if (rutaPmtiles(obj) && !cargados.has(obj.yvy_id)) {
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
    setObjetoActivo(null);
    aplicarBandaVisible(null);
    setObjetoBarra(null);
    limpiarFicha();
    refrescarGrafo();
    pintarCapital(null);
    // Sin ficha el mapa llena la columna (oculto): encuadre bicontinental.
    encuadrarLleno();
    return;
  }
  const obj = getObjeto(yvyId);
  if (!obj) return;
  setObjetoActivo(obj);
  setObjetoActual(yvyId);
  cerrarBienvenida();
  setObjetoBarra(obj);
  cargarConContexto(obj);
  aplicarBandaVisible(yvyId);
  pintarCapital(obj);

  // Vuelo país (R6-b): bicontinental — continente + islas + Antártida
  // (el usuario elige "Argentina", no solo la parte continental).
  if (obj.nivel === 'pais') {
    map.flyTo({ ...VISTA_INICIAL, duration: 1400 });
    mostrarObjeto(yvyId);
    return;
  }

  // Vuelo normal para provincias, departamentos y municipios.
  // Sin padding de MapLibre: el contenedor del mapa ES el área visible
  // (flex), el centro del canvas es el centro de lo que se ve.
  let centro = obj.centro || (getPadre(obj)?.centro) || [-60, -20];
  let zoomObjetivo = obj.zoom ?? 7;
  try {
    if (Array.isArray(obj.bounds_objeto) && obj.bounds_objeto.length === 4) {
      const b = obj.bounds_objeto;
      const cam = map.cameraForBounds(
        [[b[0], b[1]], [b[2], b[3]]],
        { padding: { top: 80, bottom: 80, right: 80, left: 80 }, maxZoom: (obj.maxzoom ?? 22) + 3, minZoom: Math.min(obj.minzoom ?? 0, 6) }
      );
      if (cam) {
        centro = cam.center;
        zoomObjetivo = cam.zoom;
      }
    }
  } catch {
    // bounds degenerados: se vuela a centro/zoom fijos
  }
  map.flyTo({ center: centro, zoom: zoomObjetivo, duration: 1400 });

  mostrarObjeto(yvyId);
  refrescarGrafo(); // halo + chip "DATOS CARGADOS" siguen al objeto activo
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
// (bicontinental: continente + sector antártico; sin ficha → mapa lleno).
const VISTA_INICIAL = { center: [-64, -56], zoom: 2.4, pitch: 0, bearing: 0 };

// --------------------------------------------------------------
// Encuadre por estado (R5): la tira (dossier) SIEMPRE fitBounds del
// objeto activo; el mapa lleno (oculto, welcome sin objeto, fullscreen ⤢)
// SIEMPRE la vista bicontinental. El boot Welcome no navega: el mapa
// nace en VISTA_INICIAL y ningún estado inicial pisa ese encuadre.
// --------------------------------------------------------------
function encuadrarLleno() {
  if (!map || !map.flyTo) return;
  map.stop();
  map.flyTo({ ...VISTA_INICIAL, duration: 1200 });
}

function encuadrarDossier() {
  if (!map || !map.flyTo) return;
  const obj = getObjetoActivo();
  if (!obj) return;
  // País: bicontinental también en la tira (honesto, aunque compacto)
  if (obj.nivel === 'pais') {
    map.flyTo({ ...VISTA_INICIAL, duration: 1200 });
    return;
  }
  let centro = obj.centro || (getPadre(obj)?.centro) || [-60, -20];
  let zoomObjetivo = obj.zoom ?? 7;
  try {
    if (Array.isArray(obj.bounds_objeto) && obj.bounds_objeto.length === 4) {
      const b = obj.bounds_objeto;
      const cam = map.cameraForBounds(
        [[b[0], b[1]], [b[2], b[3]]],
        { padding: { top: 80, bottom: 80, right: 80, left: 80 }, maxZoom: (obj.maxzoom ?? 22) + 3, minZoom: Math.min(obj.minzoom ?? 0, 6) }
      );
      if (cam) {
        centro = cam.center;
        zoomObjetivo = cam.zoom;
      }
    }
  } catch {
    // bounds degenerados: se vuela a centro/zoom fijos
  }
  map.flyTo({ center: centro, zoom: zoomObjetivo, duration: 1200 });
}

function volverAlInicio() {
  setObjetoActual(null);
  setObjetoActivo(null);
  setObjetoBarra(null);
  limpiarFicha();
  aplicarBandaVisible(null);
  refrescarGrafo();
  pintarCapital(null);
  map.stop();
  map.flyTo({ ...VISTA_INICIAL, duration: 2600 });
  // limpiarFicha deja el panel oculto: el mapa llena la columna (oculto).
  // El welcome solo se abre por Ctrl+K o botón buscar (ya no al arrancar).
}

const brandEl = document.querySelector('.topbar__brand');
if (brandEl) {
  brandEl.addEventListener('click', (e) => {
    e.preventDefault();
    volverAlInicio();
    mostrarBienvenida(); // portada: el globo + la tarjeta de consulta
  });
}

// Encuadre por estado (R5): cada cambio de vista del dock releva la cámara.
// dossier (tira) → fit del objeto activo + etiquetas del basemap ON;
// oculto (mapa lleno) → bicontinental + etiquetas OFF (el único texto
// del globo es el de la ontología). welcome → no toca la cámara.
document.addEventListener('yvy:dock', (e) => {
  const vista = e.detail?.vista;
  const lleno = document.documentElement.hasAttribute('data-mapa-full') || vista !== 'dossier';
  if (vista === 'oculto') encuadrarLleno();
  else if (vista === 'dossier' && !document.documentElement.hasAttribute('data-mapa-full')) encuadrarDossier();
  setEtiquetasBase(map, !lleno);
});

// --------------------------------------------------------------
// Evento load del mapa
// --------------------------------------------------------------
inicializarUIPaneles();

// Tema claro/oscuro (persistente; el globo permanece widget dark)
inicializarTema();

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

  // Controles de la izquierda (zoom in/out + ubicación)
  agregarControlIzquierda();

  // Mapa incrustado (tira del dossier, ⤢ expandible) + swap de lados
  inicializarModoMapa();
  inicializarSwap();

  // PANEL GRAFO (R2): la lente por defecto (24 capitales + drill).
  inicializarPanelGrafo();

  // TABS MOBILE (R4): [Dossier | Grafo] en <=768px.
  inicializarTabsMobile();

  // Bienvenida: buscar jurisdicción o elegir sugerida.
  // Al elegir navega (vuelo + ficha con hijos y padres). No tapa el globo.
  inicializarBienvenida(irAYvyId);

  // Compartir vista (permalink por yvy_id)
  inicializarCompartirVista(map, irAYvyId);

  // PORTADA PAÍS (R6-b): sin permalink el arranque ES Argentina — globo
  // bicontinental (Sudamérica + Antártida) + tarjeta con sus números
  // reales + grafo país denso. El dossier NO existe hasta que el
  // cliente elige una jurisdicción (cero espacio vacío). Con permalink,
  // share.js navega directo (irAYvyId cierra la tarjeta y abre ficha).
  if (!location.hash) {
    try {
      const obj = getObjeto(0);
      if (obj) {
        setObjetoActivo(obj);
        setObjetoBarra(obj); // "Argentina · 3.669.710,7 km²"
        refrescarGrafo();
      }
    } catch (err) {
      console.warn('[yvy] portada país falló:', err?.message || err);
    }
  }

  // Barra de producto
  inicializarBarraTecnica(map);

  track('app_load', { globe_fallback: globeFallback });

  // El botón de búsqueda del toolbar reabre la bienvenida (manejado en welcome.js).
});

window.addEventListener('resize', () => {
  map.resize();
});

// ResizeObserver sobre el contenedor REAL del mapa: cualquier cambio
// de ancho de la columna (dock abre/cierra colapsando, viewport, etc.)
// dispara resize() solo — sin timers adivinando el layout.
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => { try { map.resize(); } catch { /* mapa sin canvas */ } })
    .observe(document.getElementById('map'));
}
