// ==============================================================
// statusbar.js
// Barra de producto inferior: coordenadas del cursor, zoom y el
// objeto activo (nombre + superficie). Cero telemetría: el usuario
// final no ve FPS, tiles ni bbox.
// ==============================================================

import { formatKM2, getPadre, navegarA } from './manifest.js';

function fmt(n, dec = 4) {
  return Number(n).toFixed(dec);
}

let ultimoYvy = null;
let ultimoZoomTxt = null;

function pintarTelemetria() {
  const el = document.getElementById('topbar-telemetry');
  if (!el) return;
  el.textContent = `Z ${ultimoZoomTxt || '–'} · YVY ${ultimoYvy != null ? ultimoYvy : '–'}`;
}

/** Breadcrumb vivo ARG › ... › objeto (clicable, usa el navegador registrado). */
function pintarBreadcrumb(obj) {
  const nav = document.getElementById('topbar-crumbs');
  if (!nav) return;
  nav.innerHTML = '';
  if (!obj) return;
  const ruta = [];
  let cur = obj;
  while (cur) {
    ruta.push(cur);
    cur = getPadre(cur);
  }
  ruta.reverse();
  ruta.forEach((o, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'topbar__crumb topbar__crumb--sep';
      sep.textContent = '›';
      nav.appendChild(sep);
    }
    const ultimo = i === ruta.length - 1;
    if (ultimo) {
      const s = document.createElement('span');
      s.className = 'topbar__crumb topbar__crumb--active';
      s.textContent = o.nombre_oficial;
      nav.appendChild(s);
    } else {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'topbar__crumb';
      b.textContent = o.nombre_oficial;
      b.addEventListener('click', () => navegarA(o.yvy_id));
      nav.appendChild(b);
    }
  });
}

/**
 * Actualiza el segmento "Objeto" de la barra.
 * @param {object|null} obj - objeto del manifest activo o null
 */
export function setObjetoBarra(obj) {
  const el = document.getElementById('st-objeto');
  if (!el) return;
  if (!obj) {
    el.textContent = '–';
    ultimoYvy = null;
    pintarTelemetria();
    pintarBreadcrumb(null);
    return;
  }
  const sup = obj.sup_oficial_km2 != null ? ` · ${formatKM2(obj.sup_oficial_km2)}` : '';
  el.textContent = `${obj.nombre_oficial}${sup}`;
  ultimoYvy = obj.yvy_id;
  pintarTelemetria();
  pintarBreadcrumb(obj);
}

/**
 * Inicializa la barra sobre un mapa MapLibre.
 * @param {import('maplibre-gl').Map} map
 */
export function inicializarBarraTecnica(map) {
  const elCoords = document.getElementById('st-coords');
  const elZoom = document.getElementById('st-zoom');

  function actualizarEstaticos() {
    const z = fmt(map.getZoom(), 2);
    elZoom.textContent = z;
    ultimoZoomTxt = z;
    pintarTelemetria();
  }

  map.on('mousemove', (e) => {
    if (e && e.lngLat) {
      elCoords.textContent = `${fmt(e.lngLat.lng)}, ${fmt(e.lngLat.lat)}`;
    }
  });
  map.on('move', actualizarEstaticos);
  map.on('load', actualizarEstaticos);
}