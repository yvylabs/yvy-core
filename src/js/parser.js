// ==============================================================
// parser.js — Núcleo determinista del buscador (S1.2).
//
// Puro: sin imports, sin red, sin I/O. Se testea con `node --test`.
// `intencion.js` lo conecta al manifest; los tests le pasan un
// catálogo mínimo.
//
// Reglas:
//  - No inventa entidades: solo devuelve lo que existe en el catálogo.
//  - Gentilicios explícitos (no inferidos).
//  - Desambiguación por provincia: "Capital salteña" ≠ "Capital chaqueña".
//  - Si no hay match, no hay entidad. El fallback honesto vive en la UI.
// ==============================================================

/** Normaliza: minúsculas, sin acentos, sin puntuación. */
export function normalizar(txt) {
  return String(txt || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export const STOP = new Set([
  'y', 'e', 'o', 'u', 'en', 'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'con', 'para', 'por', 'que', 'sobre', 'datos', 'dato', 'muestra', 'mostrar', 'ver', 'buscar', 'quiero',
  // S1.2: lenguaje natural de pregunta
  'cuanta', 'cuantas', 'cuanto', 'cuantos', 'cual', 'cuales', 'hay', 'tiene', 'tienen',
  'vive', 'viven', 'viviendo', 'es', 'son', 'esta', 'estan', 'como', 'donde', 'me',
]);

export function tokens(q) {
  return normalizar(q).split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t));
}

// Sinónimos → dataset.
export const SINONIMOS = {
  demografia: [
    'demografia', 'demografico', 'censo', 'poblacion', 'poblacional', 'habitantes', 'viviendas',
    'densidad', 'indec', 'gente', 'personas', 'pobladores', 'residentes', 'vecinos',
  ],
  catastro: [
    'catastro', 'catastral', 'parcela', 'parcelas', 'propiedad', 'propiedades', 'inmueble',
    'inmuebles', 'dgi', 'lotes', 'lote', 'manzana', 'manzanas',
  ],
  mineria: [
    'mineria', 'minero', 'minera', 'mineros', 'concesion', 'concesiones', 'litio', 'cobre', 'oro',
  ],
};

// Gentilicio normalizado → provincia normalizada.
// Tabla explícita: no se infiere morfología.
export const GENTILICIOS = {
  salteno: 'salta', saltena: 'salta',
  jujeno: 'jujuy', jujena: 'jujuy',
  tucumano: 'tucuman', tucumana: 'tucuman',
  mendocino: 'mendoza', mendocina: 'mendoza',
  cordobes: 'cordoba', cordobesa: 'cordoba',
  santiagueno: 'santiago del estero', santiaguena: 'santiago del estero',
  chaqueno: 'chaco', chaquena: 'chaco',
  correntino: 'corrientes', correntina: 'corrientes',
  entrerriano: 'entre rios', entrerriana: 'entre rios',
  misionero: 'misiones', misionera: 'misiones',
  neuquino: 'neuquen', neuquina: 'neuquen',
  rionegrino: 'rio negro', rionegrina: 'rio negro',
  chubutense: 'chubut',
  santacruceno: 'santa cruz', santacrucena: 'santa cruz',
  fueguino: 'tierra del fuego', fueguina: 'tierra del fuego',
  catamarqueno: 'catamarca', catamarquena: 'catamarca',
  riojano: 'la rioja', riojana: 'la rioja',
  sanjuanino: 'san juan', sanjuanina: 'san juan',
  puntano: 'san luis', puntana: 'san luis', sanluiseno: 'san luis', sanluisena: 'san luis',
  formoseno: 'formosa', formosena: 'formosa',
  pampeano: 'la pampa', pampeana: 'la pampa',
  bonaerense: 'buenos aires',
  porteno: 'ciudad autonoma de buenos aires', portena: 'ciudad autonoma de buenos aires',
};

// Alias que apuntan directo a una provincia (no son gentilicios: son
// nombres de uso corriente). El valor es el nombre normalizado completo.
export const ALIAS_PROVINCIA = {
  caba: 'ciudad autonoma de buenos aires',
  cfc: 'ciudad autonoma de buenos aires',
};

// Verbos de relación → relación real del catálogo.
export const RELACIONES = {
  lindero: ['limita', 'limitan', 'linda', 'lindan', 'lindero', 'linderos', 'vecino', 'vecinos', 'frontera', 'fronteras', 'colinda'],
  contiene: ['contiene', 'contienen', 'depto', 'deptos', 'departamento', 'departamentos', 'hijos', 'subdivision', 'subdivisiones', 'composicion', 'barrio', 'barrios', 'municipio', 'municipios'],
};

export function detectarDataset(t) {
  for (const [tipo, lista] of Object.entries(SINONIMOS)) {
    if (lista.includes(t)) return tipo;
  }
  // Prefijo (>=3): "miner" → minería. Evita que "m" secuestre la query.
  if (t.length >= 3) {
    for (const [tipo, lista] of Object.entries(SINONIMOS)) {
      if (lista.some((s) => s.startsWith(t))) return tipo;
    }
  }
  return null;
}

export function detectarRelacion(t) {
  for (const [rel, lista] of Object.entries(RELACIONES)) {
    if (lista.includes(t)) return rel;
  }
  return null;
}

/**
 * Índice en RAM sobre una lista de objetos del catálogo.
 * Cada objeto necesita: yvy_id, nivel, nombre_oficial, parent_yvy_id.
 */
export function crearIndice(objetos) {
  const porId = new Map();
  for (const o of objetos) porId.set(Number(o.yvy_id), o);
  const items = objetos
    .map((o) => {
      const n = normalizar(o.nombre_oficial);
      const nt = n.split(/[^a-z0-9]+/).filter(Boolean).join(' ');
      return { o, n, nt };
    })
    .filter((x) => x.n);
  return { items, porId };
}

/** Provincia ancestro (nombre normalizado) o null. */
export function provinciaDe(indice, o) {
  let cur = o;
  let guard = 0;
  while (cur && guard++ < 12) {
    if (cur.nivel === 'provincia') return normalizar(cur.nombre_oficial);
    cur = indice.porId.get(Number(cur.parent_yvy_id));
  }
  return null;
}

// Exacto < prefijo < inicio de palabra < contiene < una letra de diferencia.
function puntuar(nombre, frase) {
  if (!frase) return Infinity;
  if (nombre === frase) return 0;
  if (nombre.startsWith(frase)) return 1;
  if (nombre.split(' ').some((p) => p.startsWith(frase))) return 2;
  if (nombre.includes(frase)) return 3;
  if (!frase.includes(' ') && frase.length >= 6 && nombre.split(' ').some((p) => casiIgual(p, frase))) return 5;
  return Infinity;
}

/** Distancia de edición ≤ 1 (sin transposiciones). Solo para typos de una letra. */
function casiIgual(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const NIVEL_PESO = { pais: 0, provincia: 1, depto: 2, municipio: 3, barrio: 4 };

/** Lugares por nombre (la frase ya viene sin palabras de dataset). */
export function buscarLugares(indice, q, limite = 8) {
  const frase = Array.isArray(q) ? q.join(' ') : tokens(q).join(' ');
  if (!frase) return [];
  const candidatos = [];
  for (const { o, nt } of indice.items) {
    let s = puntuar(nt, frase);
    if (s === Infinity) {
      // Todos los tokens presentes, orden libre: "anta salta".
      const ts = frase.split(' ');
      if (ts.length > 1 && ts.every((t) => nt.includes(t))) s = 4;
    }
    if (s === Infinity) continue;
    candidatos.push({ o, s, nivelPeso: NIVEL_PESO[o.nivel] ?? 9 });
  }
  candidatos.sort((a, b) => a.s - b.s || a.nivelPeso - b.nivelPeso);
  return candidatos.slice(0, limite).map((x) => x.o);
}

/**
 * Parseo de la frase completa.
 * Devuelve { entidad, dataset, relacion, sobrantes, frase, provincia, ambiguos }.
 *
 * `ambiguos` es la lista de entidades homónimas del mismo nivel cuando el
 * nombre no alcanza para desambiguar (ej. "Capital" sin provincia).
 * Es la respuesta determinista: se muestran todas, no se adivina.
 */
/**
 * Una provincia nombrada dentro de la frase actúa como calificador, igual
 * que un gentilicio: "general güemes salta" no habla de la provincia, habla
 * del General Güemes salteño. Se detecta sobre tokens normalizados (con los
 * mismos STOP que el resto), así "Ciudad Autónoma de Buenos Aires" coincide
 * con la frase "ciudad autonoma buenos aires".
 */
export function quitarProvincia(indice, resto) {
  let mejor = null;
  for (const { o } of indice.items) {
    if (o.nivel !== 'provincia') continue;
    const palabras = tokens(o.nombre_oficial);
    if (!palabras.length || palabras.length > resto.length) continue;
    for (let i = 0; i + palabras.length <= resto.length; i++) {
      if (palabras.every((w, k) => resto[i + k] === w)) {
        if (!mejor || palabras.length > mejor.palabras.length) {
          mejor = { nombre: normalizar(o.nombre_oficial), palabras, i };
        }
        break;
      }
    }
  }
  if (!mejor) return { provincia: null, resto };
  return {
    provincia: mejor.nombre,
    resto: resto.slice(0, mejor.i).concat(resto.slice(mejor.i + mejor.palabras.length)),
  };
}

/**
 * "Salta capital" / "capital de Salta": el departamento Capital de esa
 * provincia. Si la provincia no tiene uno (Chaco), la respuesta es `null`:
 * nunca la Capital de otra provincia.
 */
export function capitalDe(indice, provincia) {
  const nombres = new Set(['capital', 'la capital']);
  return (
    indice.items.find(
      (x) =>
        x.o.nivel === 'depto' &&
        nombres.has(x.n) &&
        provinciaDe(indice, x.o) === provincia,
    )?.o || null
  );
}

export function parsearCon(indice, q) {
  // "Capital Federal" es CABA, no una consulta por un departamento Capital.
  const limpio = normalizar(q).replace(/\bcapital federal\b/g, 'caba');
  const ts = tokens(limpio);
  let dataset = null;
  let relacion = null;
  let provincia = null;
  const resto = [];

  for (const t of ts) {
    if (!dataset) {
      const d = detectarDataset(t);
      if (d) { dataset = d; continue; }
    }
    if (!relacion) {
      const r = detectarRelacion(t);
      if (r) { relacion = r; continue; }
    }
    if (!provincia && (GENTILICIOS[t] || ALIAS_PROVINCIA[t])) {
      provincia = GENTILICIOS[t] || ALIAS_PROVINCIA[t];
      continue;
    }
    resto.push(t);
  }

  // Provincia nombrada en la frase ("capital de mendoza", "general güemes
  // salta"): califica y sale de la frase de búsqueda.
  if (!provincia) {
    const sinProv = quitarProvincia(indice, resto);
    provincia = sinProv.provincia;
    if (provincia) resto.splice(0, resto.length, ...sinProv.resto);
  }

  const pideCapital = resto.includes('capital');
  const frase = resto.join(' ');

  let candidatos = [];

  // 1) "capital" + provincia: el departamento Capital de esa provincia.
  if (pideCapital && provincia) {
    const cap = capitalDe(indice, provincia);
    if (cap) candidatos = [cap];
  }

  // 2) Frase completa (siempre acotada a la provincia cuando se nombró).
  if (!candidatos.length && frase) {
    candidatos = buscarLugares(indice, frase, 24);
    if (provincia && candidatos.length) {
      candidatos = candidatos.filter((o) => provinciaDe(indice, o) === provincia);
    }
  }

  // 3) Sin match de frase, el token más específico que exista: primero los
  //    nombres exactos, después los largos. "barrios de salta" nunca cae en
  //    el municipio Barrios de Jujuy.
  if (!candidatos.length) {
    const orden = [...resto].sort((a, b) => b.length - a.length);
    for (const t of orden) {
      let hit = buscarLugares(indice, t, 24);
      if (provincia) hit = hit.filter((o) => provinciaDe(indice, o) === provincia);
      if (hit.length) { candidatos = hit; break; }
    }
  }

  // 4) Solo se pronunció una provincia ("salteña", "jujeña", "salta"): esa
  //    provincia. No aplica si se pidió una "capital" inexistente.
  if (!candidatos.length && provincia && !pideCapital) {
    const prov = indice.items.find((x) => x.o.nivel === 'provincia' && x.n === provincia);
    if (prov) candidatos = [prov.o];
  }

  const entidad = candidatos[0] || null;
  const ambiguos = entidad
    ? candidatos.filter((o) => normalizar(o.nombre_oficial) === normalizar(entidad.nombre_oficial))
    : [];

  const nEnt = entidad ? normalizar(entidad.nombre_oficial) : '';
  const palabrasEnt = nEnt.split(' ');
  const sobrantes = resto.filter(
    (t) =>
      !nEnt.includes(t) &&
      !palabrasEnt.some((w) => casiIgual(w, t)) &&
      !esPalabraDelCatalogo(indice, t),
  );

  return { entidad, dataset, relacion, sobrantes, frase, provincia, ambiguos, candidatos: candidatos.slice(0, 8) };
}

/** ¿La palabra aparece en algún nombre del catálogo? (evita falsos "no tengo"). */
export function esPalabraDelCatalogo(indice, t) {
  if (!t) return false;
  return indice.items.some((x) => x.n.includes(t));
}
