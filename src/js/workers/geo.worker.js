// ==============================================================
// geo.worker.js — Worker geoespacial (protocolo, sin motor todavía)
// Ejecuta decode/R-tree/Turf fuera del hilo principal cuando existan
// los artefactos (.fgb). Hoy solo implementa el PROTOCOLO: valida
// mensajes y responde siempre { estado, datos, meta } con el mismo
// vocabulario de 4 estados que src/js/datasets.js (ok | empty |
// missing | partition_unavailable). Sin Turf ni rbush: todo dataset
// no hardcodeado responde missing. Eso valida la interfaz.
// Motor (Turf v7 + rbush + .fgb): entra con el primer dataset real.
// ==============================================================

const ESTADOS = {
  ok: 'ok',
  empty: 'empty',
  missing: 'missing',
  partition_unavailable: 'partition_unavailable',
};

const MENSAJES = {
  ok: '',
  empty: 'No hay resultados en esta zona',
  missing: 'No tengo ese dato todavía',
  partition_unavailable: 'Esta zona todavía no está disponible',
};

// Datasets hardcodeados mínimos (espejo del registro interino de
// src/js/datasets.js). Cuando el manifest v2 exista, el hilo principal
// pasará la declaración y este mapa desaparecerá.
const DATASETS = {
  jurisdicciones: { estado: 'ok', particiones: null },
};

function resolver(datasetId, particionId = null) {
  const d = DATASETS[datasetId];
  if (!d) return { estado: ESTADOS.missing, mensaje: MENSAJES.missing };
  if (d.particiones && particionId != null && d.particiones[particionId] === ESTADOS.partition_unavailable) {
    return { estado: ESTADOS.partition_unavailable, mensaje: MENSAJES.partition_unavailable };
  }
  return { estado: ESTADOS.ok, mensaje: MENSAJES.ok };
}

function responder(estado, datos, meta = {}) {
  const mensaje = MENSAJES[estado] ?? '';
  self.postMessage({ estado, datos, meta: { ...meta, mensaje } });
}

self.onmessage = async (ev) => {
  const msg = ev && ev.data ? ev.data : {};
  const { tipo, datasetId, modo, bbox, geometria, datasetA, datasetB, particionId } = msg;

  try {
    if (tipo === 'cargar') {
      // Hoy: sin artefactos que bajar. Solo declara el estado.
      // Mañana: fetch del .fgb (full) / range por bbox (viewport) /
      // partición pedida (partition), parseo y cache en el Worker.
      const r = resolver(datasetId, particionId);
      responder(r.estado, null, { datasetId, modo: modo || null, mensaje: r.mensaje });
      return;
    }

    if (tipo === 'consultar-within') {
      // Hoy: sin motor geométrico. Si el dataset existe, no hay
      // features que evaluar -> empty es incorrecto sin datos; se
      // responde ok con datos null para no confundir con empty real.
      // Cuando entre Turf: within exacto sobre .fgb.
      const r = resolver(datasetId, particionId);
      if (r.estado !== ESTADOS.ok) {
        responder(r.estado, null, { datasetId, mensaje: r.mensaje });
        return;
      }
      responder(ESTADOS.ok, null, {
        datasetId,
        pendiente: 'motor-geometrico',
        mensaje: r.mensaje,
      });
      return;
    }

    if (tipo === 'consultar-interseccion') {
      const ra = resolver(datasetA, particionId);
      if (ra.estado !== ESTADOS.ok) {
        responder(ra.estado, null, { datasetA, datasetB, mensaje: ra.mensaje });
        return;
      }
      const rb = resolver(datasetB, particionId);
      if (rb.estado !== ESTADOS.ok) {
        responder(rb.estado, null, { datasetA, datasetB, mensaje: rb.mensaje });
        return;
      }
      responder(ESTADOS.ok, null, {
        datasetA,
        datasetB,
        pendiente: 'motor-geometrico',
        mensaje: '',
      });
      return;
    }

    // Tipo desconocido: se responde, nunca se cuelga.
    responder(ESTADOS.missing, null, { tipo, mensaje: MENSAJES.missing });
  } catch (e) {
    self.postMessage({ estado: ESTADOS.missing, datos: null, meta: { error: String((e && e.message) || e) } });
  }
};
