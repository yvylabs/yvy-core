// ==============================================================
// datasets.js — Registro único de datasets (fuente de verdad
// para el contrato de 4 estados). Interino: cuando el plugin de
// build genere el manifest v2 por dataset, este módulo leerá de
// ahí y este registro hardcodeado desaparecerá. Nada más debe
// decidir estados por su cuenta: ficha, asistente y Worker usan
// resolverEstado().
// Estados: ok | empty | missing | partition_unavailable
// ==============================================================

export const ESTADOS = {
  ok: 'ok',
  empty: 'empty',
  missing: 'missing',
  partition_unavailable: 'partition_unavailable',
};

export const MENSAJES_ESTADO = {
  ok: '',
  empty: 'No hay resultados en esta zona',
  missing: 'No tengo ese dato todavía',
  partition_unavailable: 'Esta zona todavía no está disponible',
};

// Registro interino. 'jurisdicciones' es el único dataset real
// (N1–N4 en el manifest actual). Todo lo demás resuelve missing
// hasta que se declare en el manifest v2 con sus 3 artefactos.
// particiones: mapa particionId -> 'ok' | 'partition_unavailable'.
// Si un dataset no lista particiones, todas sus particiones son ok.
const REGISTRY = {
  jurisdicciones: { estado: 'ok', particiones: null },
};

/**
 * Resuelve el estado de un dataset (y opcionalmente una partición).
 * @param {string} datasetId
 * @param {string|null} particionId
 * @param {{count?: number}} opts - si count === 0, el resultado es empty
 * @returns {{estado: string, mensaje: string}}
 */
export function resolverEstado(datasetId, particionId = null, opts = {}) {
  const d = REGISTRY[datasetId];
  if (!d) return { estado: ESTADOS.missing, mensaje: MENSAJES_ESTADO.missing };
  if (opts && opts.count === 0) {
    return { estado: ESTADOS.empty, mensaje: MENSAJES_ESTADO.empty };
  }
  if (d.particiones && particionId != null && d.particiones[particionId] === ESTADOS.partition_unavailable) {
    return { estado: ESTADOS.partition_unavailable, mensaje: MENSAJES_ESTADO.partition_unavailable };
  }
  return { estado: ESTADOS.ok, mensaje: MENSAJES_ESTADO.ok };
}

/** ¿Existe el dataset declarado? (atajo para guards rápidos) */
export function existeDataset(datasetId) {
  return !!REGISTRY[datasetId];
}
