// ==============================================================
// statusbar.js
// Barra de producto: objeto activo + breadcrumb + badge fps.
// Sin coords, sin zoom numérico (van en controles nativos).
// ==============================================================

import { formatKM2, getPadre, navegarA } from './manifest.js';

// Debug explícito (?debug=1): fps y telemetría solo existen en ese modo.
// En prod no se renderizan (ni siquiera en el DOM).
const DEBUG = (() => {
  try {
    return new URLSearchParams(window.location.search).has('debug');
  } catch {
    return false;
  }
})();

/** Breadcrumb vivo Salta › ... › objeto (clicable, usa el navegador registrado). */
function pintarBreadcrumb(obj) {
  const nav = document.getElementById('topbar-crumbs');
  if (!nav) return;
  nav.textContent = '';
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
    el.textContent = 'Ninguna jurisdicción seleccionada';
    pintarBreadcrumb(null);
    return;
  }
  const sup = obj.sup_oficial_km2 != null ? ` · ${formatKM2(obj.sup_oficial_km2)}` : '';
  el.textContent = `${obj.nombre_oficial}${sup}`;
  pintarBreadcrumb(obj);
}

/** Badge fps honesto: rAF agregado 1 vez/seg, solo en ?debug=1. */
function iniciarFps() {
  const el = document.getElementById('topbar-fps');
  if (!el) return;
  if (!DEBUG) {
    el.remove();
    return;
  }
  el.hidden = false;
  let frames = 0;
  let t0 = performance.now();
  const loop = (t) => {
    frames++;
    if (t - t0 >= 1000) {
      el.textContent = `${Math.min(frames, 99)} fps`;
      frames = 0;
      t0 = t;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/**
 * Inicializa la barra sobre un mapa MapLibre.
 * @param {import('maplibre-gl').Map} map
 */
export function inicializarBarraTecnica(map) {
  iniciarFps();
  if (map && typeof map.on === 'function') {
    map.on('load', () => {});
  }
}
