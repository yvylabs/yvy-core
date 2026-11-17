// ==============================================================
// ontologia.js — La ontología también es parte del producto
// ------------------------------------------------------------
// `data/ontologia.json` se publica con el manifest y la UI lo carga
// lazy (una vez). No va en el bundle: el dossier no necesita el
// esquema completo para pintar una métrica.
// ==============================================================

let cache = null;
let pendiente = null;

/** Ontología publicada por el build (se sirve desde data/ontologia.json). */
export function cargarOntologia() {
  if (cache) return Promise.resolve(cache);
  if (pendiente) return pendiente;
  const base = import.meta.env?.BASE_URL || './';
  pendiente = fetch(`${base}data/ontologia.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`ontologia.json HTTP ${r.status}`);
      return r.json();
    })
    .then((ont) => {
      cache = ont;
      pendiente = null;
      return ont;
    })
    .catch((err) => {
      pendiente = null;
      throw err;
    });
  return pendiente;
}

/** Ficha de un tipo (nivel) del modelo. */
export function tipoDe(ontologia, nivel) {
  return (ontologia?.tipos || {})[nivel] || null;
}

/** Tipos de relación declarados con su fuente y fecha. */
export function relacionesDeclaradas(ontologia) {
  return Object.entries(ontologia?.relaciones || {}).map(([clave, info]) => ({
    clave,
    descripcion: info?.descripcion || clave,
    fuente: info?.fuente || null,
    fecha: info?.fecha || null,
    simetrica: Boolean(info?.simetrica),
    previsto: Boolean(info?.previsto),
    derivadaDe: info?.derivada_de || null,
  }));
}

/** Métricas del modelo con unidad y dataset: la unidad es obligatoria. */
export function metricasDeclaradas(ontologia) {
  return Object.entries(ontologia?.metricas || {}).map(([clave, info]) => ({
    clave,
    etiqueta: info?.etiqueta || clave,
    unidad: info?.unidad || null,
    dataset: info?.dataset || null,
    visibilidad: info?.visibilidad || 'public',
    previsto: Boolean(info?.previsto),
  }));
}
