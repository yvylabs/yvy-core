// ==============================================================
// identidad.js — Identidad estable de entidades (yvy_id)
// ------------------------------------------------------------
// El yvy_id NO se inventa: se deriva del código oficial (INDEC/IGN)
// con un offset por nivel. Eso lo hace reproducible y citable.
//
// Lo que este módulo agrega es la otra mitad: GOBERNANZA.
//   - Un id emitido nunca se recicla ni se renumera.
//   - Si una entidad cambia de código oficial (recodificación) o
//     desaparece (fusión), queda registrada en el ledger: id_anterior
//     + estado. El permalink viejo sigue resolviendo.
//   - Los ids de relleno viven en rangos reservados DECLARADOS,
//     nunca inventados en el espacio de otro nivel.
//
// Mismo código en el build (vite.config.js), en los tests y —cuando
// exista runner— en la receta de ingesta. Una sola implementación.
// ==============================================================

export const IDS_SCHEMA = 'yvy-ids-excepciones-v1';

/** Rango válido por nivel. `barrio` admite además el bloque de desborde. */
export const RANGO_ID = {
  pais: [0, 999],
  provincia: [1000, 1999],
  depto: [100000, 199999],
  // 1.000.000–1.999.999 = derivados (1.000.000 + cod_indec de 6 dígitos).
  // 2.000.000–2.199.999 = bloques reservados (no derivables: ningún
  // cod_indec de 6 dígitos llega ahí, así que no pueden colisionar).
  municipio: [1000000, 2199999],
  barrio: [1000000000, 1999999999],
  concesion: [30000, 99999],
};

/**
 * Bloques reservados por nivel. Un id dentro de un bloque reservado
 * solo puede existir si una excepción lo declara (jamás por azar).
 */
export const RESERVADO = {
  municipio: {
    indeterminado: [2000000, 2049999], // INDEC sin cod_indec
    reasignado: [2050000, 2199999], // recodificación / id nuevo
  },
  barrio: {
    desborde: [2000000000, 2999999999], // municipio con más de 999 barrios
  },
};

/** Offset de derivación: yvy_id = OFFSET + cod_indec. */
export const OFFSET_ID = { provincia: 1000, depto: 100000, municipio: 1000000 };

/** Máximo de barrios por municipio con el esquema posicional del prefijo. */
export const TOPE_BARRIOS = 999;

/** Niveles con id derivable de un código oficial. */
export function nivelesDerivables() {
  return Object.keys(OFFSET_ID);
}

/** yvy_id derivado de un código oficial, o null si no aplica. */
export function idDerivado(nivel, codIndec) {
  const off = OFFSET_ID[nivel];
  if (off == null) return null;
  const txt = String(codIndec ?? '').trim();
  if (!txt) return null; // sin código no hay derivación (no es 0)
  const cod = Number(txt);
  if (!Number.isInteger(cod) || cod < 0) return null;
  return off + cod;
}

/** ¿El id cae en el rango de su nivel (incluye bloques de desborde)? */
export function enRango(nivel, yvyId) {
  const id = Number(yvyId);
  if (!Number.isInteger(id)) return false;
  const r = RANGO_ID[nivel];
  if (r && id >= r[0] && id <= r[1]) return true;
  if (nivel === 'barrio') {
    const d = RESERVADO.barrio.desborde;
    if (id >= d[0] && id <= d[1]) return true;
  }
  return false;
}

/** Bloque reservado que contiene al id, o null. */
export function bloqueReservado(nivel, yvyId) {
  const id = Number(yvyId);
  for (const [nombre, [lo, hi]] of Object.entries(RESERVADO[nivel] || {})) {
    if (id >= lo && id <= hi) return { nombre, desde: lo, hasta: hi };
  }
  return null;
}

/**
 * Asigna id a una entidad nueva. Reglas:
 *   1. Si el id derivado está libre, se usa (caso normal, la mayoría).
 *   2. Si está ocupado por OTRA entidad (recodificación), se toma el
 *      siguiente libre del bloque `reasignado` del nivel. Nunca se
 *      recicla el id de la entidad anterior.
 *   3. Si no hay bloque reservado para el nivel, devuelve null: hay que
 *      declarar el bloque en este módulo antes de ingerir.
 *        `ocupados` es un Set (o Map) de ids ya emitidos.
 */
export function asignarId(nivel, codIndec, ocupados) {
  const base = idDerivado(nivel, codIndec);
  if (base == null) return null;
  const libre = (id) => !(ocupados && (ocupados.has ? ocupados.has(id) : ocupados[id]));
  if (libre(base)) return base;
  const bloques = RESERVADO[nivel];
  const r = bloques && bloques.reasignado;
  if (!r) return null;
  for (let id = r[0]; id <= r[1]; id++) if (libre(id)) return id;
  return null;
}

/**
 * Asigna id a un barrio nuevo. Secuencia APPEND-ONLY: el siguiente
 * número libre del municipio. No es posicional (el orden alfabético
 * viejo renumeraba los barrios posteriores al insertar uno nuevo).
 * Si el municipio ya tiene 999 barrios, usa el bloque de desborde.
 */
export function asignarIdBarrio(yvyMunicipio, ocupados) {
  const muni = Number(yvyMunicipio);
  if (!Number.isInteger(muni) || muni <= 0) return null;
  const libre = (id) => !(ocupados && (ocupados.has ? ocupados.has(id) : ocupados[id]));
  for (let seq = 1; seq <= TOPE_BARRIOS; seq++) {
    const id = muni * 1000 + seq;
    if (libre(id)) return id;
  }
  const [lo, hi] = RESERVADO.barrio.desborde;
  for (let id = lo; id <= hi; id++) if (libre(id)) return id;
  return null;
}

/** Lista de violaciones de identidad. Vacía = contrato de ids cumplido. */
export function validarIdentidad(objetos, excepciones = {}) {
  const out = [];
  const vistos = new Map();
  const declarados = new Set((excepciones.migraciones || []).map((m) => Number(m.a)));

  for (const o of objetos) {
    const id = Number(o.yvy_id);
    if (!Number.isInteger(id)) {
      out.push(`identidad: ${o.nombre_oficial || 'objeto'} tiene yvy_id no entero (${o.yvy_id})`);
      continue;
    }
    if (!enRango(o.nivel, id)) {
      out.push(`identidad: ${id} (${o.nombre_oficial || '?'}, ${o.nivel}) fuera del rango de su nivel`);
    }
    if (vistos.has(id)) {
      out.push(`identidad: yvy_id duplicado ${id} (${vistos.get(id)} y ${o.nombre_oficial || '?'})`);
    } else {
      vistos.set(id, o.nombre_oficial || '?');
    }
    const bloque = bloqueReservado(o.nivel, id);
    if (bloque && !declarados.has(id)) {
      out.push(`identidad: ${id} (${o.nombre_oficial || '?'}) usa el bloque reservado "${bloque.nombre}" sin excepción declarada en data/ids.excepciones.json`);
    }
  }

  // Las migraciones declaradas tienen que ser aplicables y no pisar nada.
  for (const m of excepciones.migraciones || []) {
    const desde = Number(m.de);
    const hasta = Number(m.a);
    if (!enRango(m.nivel, hasta)) {
      out.push(`identidad: migración ${desde}→${hasta} apunta fuera del rango de "${m.nivel}"`);
    }
    const colision = objetos.find((o) => Number(o.yvy_id) === hasta && Number(o.id_anterior) !== desde);
    if (colision && Number(colision.yvy_id) !== desde) {
      out.push(`identidad: migración ${desde}→${hasta} colisiona con ${colision.nombre_oficial || '?'}`);
    }
  }

  return out;
}

/**
 * Aplica las migraciones declaradas ANTES de derivar agregados: si un
 * id cambia, todo lo que cuelga de él tiene que ver el id nuevo.
 * Devuelve los objetos (mutados) y el detalle de lo aplicado.
 */
export function aplicarMigraciones(objetos, excepciones = {}) {
  const porId = new Map(objetos.map((o) => [Number(o.yvy_id), o]));
  const aplicadas = [];
  const pendientes = [];

  for (const m of excepciones.migraciones || []) {
    const desde = Number(m.de);
    const hasta = Number(m.a);
    const obj = porId.get(desde);
    if (!obj) {
      // El registry ya trae el id nuevo (migración absorbida): no es error.
      pendientes.push({ desde, hasta });
      continue;
    }
    const ocupado = porId.get(hasta);
    if (ocupado) {
      throw new Error(
        `identidad: no puedo migrar ${desde}→${hasta}: el id destino ya lo usa "${ocupado.nombre_oficial}".`,
      );
    }
    obj.yvy_id = hasta;
    obj.id_anterior = desde;
    obj.id_motivo = m.motivo || null;
    porId.delete(desde);
    porId.set(hasta, obj);
    aplicadas.push({ desde, hasta });
  }
  return { objetos, aplicadas, pendientes };
}

/**
 * Ledger público: quién es quién, con historia. Se publica en
 * public/data/ids.json y su hash va al manifest. Es el artefacto que
 * convierte "confiá en mis ids" en "verificá mis ids".
 */
export function construirLedger(objetos, excepciones = {}) {
  const entidades = objetos
    .map((o) => {
      const e = {
        yvy_id: Number(o.yvy_id),
        nivel: o.nivel,
        cod_indec: o.cod_indec ? String(o.cod_indec) : null,
        estado: 'activo',
      };
      if (o.id_anterior != null) e.id_anterior = Number(o.id_anterior);
      if (o.id_motivo) e.id_motivo = o.id_motivo;
      return e;
    })
    .sort((a, b) => a.yvy_id - b.yvy_id);

  return {
    schema: 'yvy-ids-v1',
    total: entidades.length,
    reservados: excepciones.rangos_reservados || [],
    entidades,
  };
}
