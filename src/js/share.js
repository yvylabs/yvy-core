// share.js — Compartir vista: permalink 100% client-side
// Formato: #y=<yvy_id>&c=<lng>,<lat>&z=<zoom>

const COMPARTIR_ID = 'btn-compartir';

let mapa = null;
let restaurarObjeto = null;
let yvyIdActual = null;
let hashUltimo = '';

function getParametros() {
  if (!mapa) return '';
  const c = mapa.getCenter();
  const y = yvyIdActual != null ? `&y=${yvyIdActual}` : '';
  return `c=${c.lng.toFixed(5)},${c.lat.toFixed(5)}&z=${mapa.getZoom().toFixed(2)}${y}`;
}

function urlCompartir() {
  return `${window.location.origin}${window.location.pathname}#${getParametros()}`;
}

function actualizarHash() {
  const h = getParametros();
  if (!h || h === hashUltimo) return;
  hashUltimo = h;
  history.replaceState(null, '', `#${h}`);
}

function darFeedbackCopiado() {
  const btn = document.getElementById(COMPARTIR_ID);
  if (!btn) return;
  btn.classList.add('is-copiado');
  btn.setAttribute('aria-label', '¡Vista copiada!');
  setTimeout(() => {
    btn.classList.remove('is-copiado');
    btn.setAttribute('aria-label', 'Compartir vista');
  }, 2000);
}

async function copiarVista() {
  actualizarHash();
  const url = urlCompartir();
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // Fallback si el portapapeles no está disponible (http, permisos)
    const input = document.createElement('input');
    input.value = url;
    document.body.appendChild(input);
    input.select();
    try {
      document.execCommand('copy');
    } catch {
      window.prompt('Copiá este link:', url);
    }
    input.remove();
  }
  darFeedbackCopiado();
}

/** @param {number|null} yvyId Objeto activo (o null para el globo). */
export function setObjetoActual(yvyId) {
  yvyIdActual = yvyId != null ? Number(yvyId) : null;
  actualizarHash();
}

/**
 * Enlaza el botón de compartir y el seguimiento de la cámara.
 * @param {object} map Instancia de MapLibre
 * @param {(yvyId: number) => Promise<void>} onRestaurarObjeto
 */
export function inicializarCompartirVista(map, onRestaurarObjeto) {
  mapa = map;
  restaurarObjeto = onRestaurarObjeto;

  const btn = document.getElementById(COMPARTIR_ID);
  if (!btn) return;
  btn.addEventListener('click', copiarVista);
  mapa.on('moveend', actualizarHash);

  const restaurar = async () => {
    const q = new URLSearchParams(window.location.hash.slice(1));
    const y = q.get('y');
    const c = q.get('c');
    const z = q.get('z');
    if (y && restaurarObjeto) {
      try {
        await restaurarObjeto(Number(y));
      } catch (err) {
        console.error('No se pudo restaurar el objeto del link:', err);
      }
    }
    if (c && z) {
      const [lng, lat] = c.split(',').map(Number);
      if (Number.isFinite(lng) && Number.isFinite(lat) && Number.isFinite(Number(z))) {
        mapa.flyTo({ center: [lng, lat], zoom: Number(z), duration: 2200 });
      }
    }
  };
  if (mapa.loaded()) {
    restaurar();
  } else {
    mapa.once('load', restaurar);
  }
}
