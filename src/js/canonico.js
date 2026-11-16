// ==============================================================
// canonico.js — JSON canónico RFC 8785 (JCS) + hash SHA-256.
//
// Es el mismo código en el build (Node) y en el navegador (WebCrypto):
// el certificado que emite el build se puede recalcular en el cliente
// y tiene que dar idéntico. Por eso no hay dependencias.
//
// Reglas JCS que importan acá:
//  - claves de objeto ordenadas por unidades de código UTF-16;
//  - sin espacios ni saltos de línea;
//  - números con Number::toString de ES (JSON.stringify ya lo hace);
//  - strings con el escapado mínimo de JSON (JSON.stringify ya lo hace).
// ==============================================================

/**
 * Serializa un valor a JSON canónico RFC 8785.
 * Lanza si hay números no finitos: NaN/Infinity no tienen representación
 * canónica y no deben llegar a un hash.
 */
export function canonicalizar(valor) {
  if (valor === null) return 'null';
  const t = typeof valor;
  if (t === 'boolean') return valor ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(valor)) throw new TypeError(`número no finito en JSON canónico: ${valor}`);
    return JSON.stringify(valor);
  }
  if (t === 'string') return JSON.stringify(valor);
  if (Array.isArray(valor)) {
    return `[${valor.map((v) => (v === undefined ? 'null' : canonicalizar(v))).join(',')}]`;
  }
  if (t === 'object') {
    const claves = Object.keys(valor)
      .filter((k) => valor[k] !== undefined)
      .sort(); // UTF-16 code units: el orden que exige JCS
    return `{${claves.map((k) => `${JSON.stringify(k)}:${canonicalizar(valor[k])}`).join(',')}}`;
  }
  throw new TypeError(`tipo no serializable en JSON canónico: ${t}`);
}

const codificar = (texto) => new TextEncoder().encode(texto);

/** SHA-256 en hex (minúsculas) del JSON canónico de `valor`. */
export async function hashCanonico(valor) {
  const bytes = codificar(canonicalizar(valor));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Payload del `hash_entidad`: métricas + su linaje de datos. */
export function payloadEntidad(ag) {
  return {
    yvy_id: ag.yvy_id,
    tipo: ag.tipo,
    fuente: ag.fuente ?? null,
    fecha_vigencia: ag.fecha_vigencia ?? null,
    version: ag.version ?? null,
    metricas: ag.metricas ?? {},
    estado: ag.estado ?? null,
    metricas_missing: ag.metricas_missing ?? [],
  };
}

/** Payload del `hash_linaje`: relaciones + documentos de la entidad. */
export function payloadLinaje(yvyId, relaciones = [], documentos = []) {
  return { yvy_id: yvyId, relaciones, documentos };
}
