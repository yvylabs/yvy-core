// ==============================================================
// basemaps.js
// Catálogo de capas base. La versión free usa exclusivamente
// Esri World Imagery (satélite), sin OSM ni otros mapas.
// ==============================================================

/**
 * Catálogo de capas base. La disponibilidad real para un
 * territorio dado se filtra según su código de país (ver
 * getBasemapsForCountry). Hoy solo hay satélite global.
 */
export const BASEMAPS = {
  satelital: {
    id: 'satelital',
    label: 'Satélite',
    type: 'raster',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    attribution: '© Esri — Islas Malvinas (RA) — territorio argentino',
    paisesDisponibles: null, // cobertura global
  },
};

/**
 * Devuelve la lista de capas base disponibles para un país dado.
 * @param {string} codigoPais - código ISO simple, ej. "AR", "CL"
 * @returns {Array} lista de objetos de BASEMAPS filtrados
 */
export function getBasemapsForCountry(codigoPais) {
  return Object.values(BASEMAPS).filter((bm) => {
    if (bm.paisesDisponibles === null) return true; // disponible siempre
    return bm.paisesDisponibles.includes(codigoPais);
  });
}
