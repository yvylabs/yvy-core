// ==============================================================
// measure.js — Medición de distancias y superficies
// Marcado de puntos y polígonos con doble clic para finalizar.
// Matemática propia (haversine + área esférica), sin dependencias.
// ==============================================================

const SOURCE_ID = 'yvy-measure';

const R_TIERRA = 6371008.8; // radio medio terrestre (m)

let dibujoActivo = false;

/** True mientras se está dibujando una medición (lo consultan las capas). */
export function medicionActiva() {
  return dibujoActivo;
}

function haversineM(a, b) {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R_TIERRA * Math.asin(Math.sqrt(h));
}

function areaM2(puntos) {
  const n = puntos.length;
  if (n < 3) return 0;
  let suma = 0;
  for (let i = 0; i < n; i++) {
    const prev = puntos[(i - 1 + n) % n];
    const act = puntos[i];
    const sig = puntos[(i + 1) % n];
    suma += (sig[0] - prev[0]) * Math.sin((act[1] * Math.PI) / 180);
  }
  return (Math.abs(suma) * R_TIERRA * R_TIERRA * Math.PI) / 180 / 2;
}

function fmtDist(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

function fmtArea(m2) {
  if (m2 >= 10000) return `${(m2 / 10000).toFixed(2)} ha`;
  return `${Math.round(m2)} m²`;
}

function fcVacia() {
  return { type: 'FeatureCollection', features: [] };
}

export function inicializarMedicion(map) {
  const panel = document.getElementById('panel-medir');
  const btn = document.getElementById('btn-medir');
  const btnLimpiar = document.getElementById('measure-clear');
  const btnListo = document.getElementById('measure-close');
  const elDist = document.getElementById('measure-dist');
  const elArea = document.getElementById('measure-area');
  if (!panel || !btn) return;

  const COLOR = '#3ddc97';

  map.addSource(SOURCE_ID, { type: 'geojson', data: fcVacia() });
  map.addLayer({
    id: 'yvy-measure-fill', type: 'fill', source: SOURCE_ID,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': COLOR, 'fill-opacity': 0.15 },
  });
  map.addLayer({
    id: 'yvy-measure-line', type: 'line', source: SOURCE_ID,
    paint: { 'line-color': COLOR, 'line-width': 2 },
  });
  map.addLayer({
    id: 'yvy-measure-points', type: 'circle', source: SOURCE_ID,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-color': COLOR,
      'circle-radius': 4.5,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#000000',
    },
  });

  let dibujando = false;
  let puntos = [];
  let preview = null;

  function refrescar() {
    const features = [];
    const linea = [...puntos];
    if (dibujando && preview) linea.push(preview);
    if (linea.length >= 2) {
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: linea } });
    }
    if (puntos.length >= 3) {
      features.push({
        type: 'Feature', properties: {},
        geometry: { type: 'Polygon', coordinates: [[...puntos, puntos[0]]] },
      });
    }
    puntos.forEach((c) => features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } }));
    map.getSource(SOURCE_ID).setData({ type: 'FeatureCollection', features });
  }

  function limpiar() {
    puntos = [];
    preview = null;
    refrescar();
    if (elDist) elDist.textContent = '–';
    if (elArea) elArea.textContent = '–';
  }

  function setDibujando(activo) {
    dibujando = activo;
    dibujoActivo = activo;
    map.getCanvas().style.cursor = activo ? 'crosshair' : '';
    if (!activo) {
      preview = null;
      refrescar();
    }
  }

  function finalizar() {
    if (puntos.length >= 2 && elDist) {
      let dist = 0;
      for (let i = 1; i < puntos.length; i++) dist += haversineM(puntos[i - 1], puntos[i]);
      elDist.textContent = fmtDist(dist);
    }
    if (puntos.length >= 3 && elArea) elArea.textContent = fmtArea(areaM2(puntos));
    setDibujando(false);
  }

  map.on('click', (e) => {
    if (!dibujando) return;
    puntos.push([e.lngLat.lng, e.lngLat.lat]);
    refrescar();
  });

  map.on('dblclick', () => {
    if (dibujando && puntos.length >= 2) finalizar();
  });

  map.on('mousemove', (e) => {
    if (!dibujando || puntos.length === 0) return;
    preview = [e.lngLat.lng, e.lngLat.lat];
    refrescar();
  });

  // ESC cancela el trazo en curso (sin cerrar paneles)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dibujando && puntos.length) {
      puntos = [];
      preview = null;
      refrescar();
      e.stopPropagation();
    }
  });

  // Apertura/cierre del panel: el listener de ui.js corre primero,
  // así que acá ya está decidido si quedó abierto o cerrado.
  btn.addEventListener('click', () => {
    if (!panel.hidden) {
      limpiar();
      setDibujando(true);
    } else {
      setDibujando(false);
    }
  });

  // Cualquier otra vía de cierre (✕, clic fuera, ESC del panel)
  new MutationObserver(() => {
    if (panel.hidden) setDibujando(false);
  }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });

  if (btnLimpiar) btnLimpiar.addEventListener('click', () => {
    limpiar();
    setDibujando(true);
  });

  if (btnListo) btnListo.addEventListener('click', finalizar);
}