// ==============================================================
// basemapControl.js
// Renderiza y maneja el control de capas base en la esquina
// inferior izquierda, según las capas disponibles para el
// territorio actualmente seleccionado.
// ==============================================================

import { getBasemapsForCountry, BASEMAPS } from './basemaps.js';

const CAPA_BASE_ID = 'yvy-basemap';

/**
 * Agrega (o reemplaza) la capa base activa en el mapa.
 * @param {import('maplibre-gl').Map} map
 * @param {object} basemapDef - una entrada de BASEMAPS
 */
function aplicarCapaBase(map, basemapDef) {
  // Si ya existe una capa base previa, se elimina antes de agregar la nueva
  if (map.getLayer(CAPA_BASE_ID)) map.removeLayer(CAPA_BASE_ID);
  if (map.getSource(CAPA_BASE_ID)) map.removeSource(CAPA_BASE_ID);

  map.addSource(CAPA_BASE_ID, {
    type: 'raster',
    tiles: basemapDef.tiles,
    tileSize: basemapDef.tileSize,
    attribution: basemapDef.attribution,
  });

  // La capa base siempre va al fondo (primer slot), para que las
  // capas institucionales y de límites se dibujen siempre por encima
  const primeraCapaExistente = map.getStyle().layers[0]?.id;
  map.addLayer(
    {
      id: CAPA_BASE_ID,
      type: 'raster',
      source: CAPA_BASE_ID,
    },
    primeraCapaExistente
  );
}

/**
 * Inicializa el control de capa base para un territorio dado.
 * Reemplaza el contenido del contenedor cada vez que cambia el
 * territorio activo, ya que las capas disponibles pueden variar
 * (ej. IGN solo aparece para municipios argentinos).
 *
 * @param {import('maplibre-gl').Map} map
 * @param {HTMLElement} contenedor
 * @param {string} codigoPais
 */
export function inicializarControlCapaBase(map, contenedor, codigoPais, idActivo) {
  const disponibles = getBasemapsForCountry(codigoPais);
  const btnPrevio = contenedor.querySelector('.basemap-btn[aria-pressed="true"]');
  const idPrevio = btnPrevio?.dataset.basemapId;
  contenedor.innerHTML = '';

  const activaId = idActivo ?? idPrevio ?? disponibles[0]?.id;
  let activa = disponibles.find((bm) => bm.id === activaId) ?? disponibles[0];

  disponibles.forEach((bm) => {
    const btn = document.createElement('button');
    btn.className = 'basemap-btn';
    btn.setAttribute('aria-pressed', bm.id === activa.id ? 'true' : 'false');
    btn.dataset.basemapId = bm.id;
    btn.innerHTML = `<span class="basemap-btn__marker"></span><span>${bm.label}</span>`;

    btn.addEventListener('click', () => {
      if (bm.id === activa.id) return; // ya está activa, no hacer nada
      activa = bm;
      aplicarCapaBase(map, bm);

      // Actualiza el estado visual de todos los botones del grupo
      contenedor.querySelectorAll('.basemap-btn').forEach((otroBtn) => {
        otroBtn.setAttribute('aria-pressed', 'false');
      });
      btn.setAttribute('aria-pressed', 'true');
    });

    contenedor.appendChild(btn);
  });

  // Aplica la capa base inicial al mapa
  if (activa) aplicarCapaBase(map, activa);
}
