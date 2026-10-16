// share.js — Compartir vista: permalink 100% client-side
// Formato: #y=<yvy_id>&c=<lng>,<lat>&z=<zoom>

// El hash de entrada se congela al importar el módulo (antes de que el
// mapa exista): un moveend previo al 'load' reescribe el hash con solo
// c&z y borraría el y=<id> antes de que restaurar() lo lea.
const HASH_INICIAL = typeof window !== 'undefined' ? window.location.hash : '';

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
    const q = new URLSearchParams(HASH_INICIAL.slice(1));
    const y = q.get('y');
    const c = q.get('c');
    const z = q.get('z');
    if (y && restaurarObjeto) {
      try {
        await restaurarObjeto(Number(y));
      } catch (err) {
        console.error('No se pudo restaurar el objeto del link:', err);
      }
      return; // el objeto ya voló a sus bounds: el c&z viejo no lo pisa
    }
    if (c && z) {
      const [lng, lat] = c.split(',').map(Number);
      const zm = Number(z);
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      if (Number.isFinite(lng) && Number.isFinite(lat) && Number.isFinite(zm)) {
        mapa.flyTo({ center: [clamp(lng, -180, 180), clamp(lat, -90, 90)], zoom: clamp(zm, 0, 22), duration: 2200 });
      }
    }
  };
  // Restaurar el permalink: si el 'load' del estilo ya se disparó durante
  // el await del catálogo, loaded() puede estar en falso transitorio y el
  // once('load') quedaría esperando un evento que no vuelve. Por eso se
  // intenta ya, ante 'load' y ante 'idle' (lo primero que ocurra con el
  // mapa cargado gana; el flag evita doble restauración).
  let restaurado = false;
  const intentarRestaurar = () => {
    if (restaurado || !mapa.loaded()) return;
    restaurado = true;
    mapa.off('load', intentarRestaurar);
    mapa.off('idle', intentarRestaurar);
    restaurar();
  };
  mapa.on('load', intentarRestaurar);
  mapa.on('idle', intentarRestaurar);
  intentarRestaurar();
}
