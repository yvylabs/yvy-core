// ==============================================================
// statusbar.js
// Barra de producto: objeto activo + badge fps. Sin coords, sin zoom
// numérico (van en controles nativos).
// R12: la jerarquía vive en el breadcrumb del panel Grafo (único
// lugar). El chip suelto de la topbar se retiró: flotaba sin ancla.
// ==============================================================

import { formatKM2 } from './manifest.js';

// Debug explícito (?debug=1): fps y telemetría solo existen en ese modo.
// En prod no se renderizan (ni siquiera en el DOM).
const DEBUG = (() => {
  try {
    return new URLSearchParams(window.location.search).has('debug');
  } catch {
    return false;
  }
})();

/**
 * Actualiza el segmento "Objeto" de la barra.
 * @param {object|null} obj - objeto del manifest activo o null
 */
export function setObjetoBarra(obj) {
  const el = document.getElementById('st-objeto');
  if (!el) return;
  if (!obj) {
    el.textContent = 'Ningún lugar seleccionado';
    return;
  }
  const sup = obj.sup_oficial_km2 != null ? ` · ${formatKM2(obj.sup_oficial_km2)}` : '';
  el.textContent = `${obj.nombre_oficial}${sup}`;
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
