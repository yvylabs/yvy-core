import {
  getObjeto,
  getPadre,
  getHijos,
  setObjetoActivo,
  etiquetaNivel,
  getAgregado,
} from './manifest.js';
import { abrirPanelObjeto } from './ui.js';
import { track } from './telemetry.js';

const fmtInt = new Intl.NumberFormat('es-AR');
const fmt1dec = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt2dec = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

// Superficie legible: bajo 1 km² se muestra en hectáreas (barrios,
// comunas chicas). Si no hay dato, null (se omite, no se grita).
function fmtSup(km2) {
  const n = Number(km2);
  if (!Number.isFinite(n)) return null;
  if (n < 1) return `${fmt2dec.format(Math.round(n * 100 * 100) / 100)} ha`;
  return `${fmt1dec.format(Math.round(n * 10) / 10)} km²`;
}

// Token anti-carrera: si el usuario navega antes de que vuelva el fetch,
// la respuesta vieja no pinta.
let renderToken = 0;

// --------------------------------------------------------------
// Fuentes humanas (nada con forma de código)
// --------------------------------------------------------------
const FUENTE = {
  'Censo 2022 - censo.gob.ar/gobiernos-locales': {
    nombre: 'Censo Nacional 2022 (INDEC)',
    corto: 'Censo 2022',
    url: 'https://censo.gob.ar',
  },
  'DGI Salta': { nombre: 'Dirección General de Inmuebles · Salta', corto: 'DGI Salta', url: null },
  'Secretaría de Minería de Salta': { nombre: 'Secretaría de Minería · Salta', corto: 'Minería Salta', url: null },
};

function fuenteHumana(raw) {
  if (raw != null && FUENTE[raw]) return FUENTE[raw];
  const nombre = raw == null || raw === '' ? 'Fuente pendiente' : String(raw);
  return { nombre, corto: nombre, url: null };
}

// --------------------------------------------------------------
// Nombre, hijos y superficie del objeto
// --------------------------------------------------------------
function nombreConArticulo(obj) {
  if (/sin gobierno local/i.test(obj.nombre_oficial || '')) {
    const padre = getPadre(obj);
    return `El área sin gobierno local${padre ? ` de ${padre.nombre_oficial}` : ''}`;
  }
  switch (obj.nivel) {
    case 'pais': return obj.nombre_oficial;
    case 'provincia': return `La provincia de ${obj.nombre_oficial}`;
    case 'depto': return `El departamento ${obj.nombre_oficial}`;
    case 'municipio': return `El municipio de ${obj.nombre_oficial}`;
    case 'barrio': return `El barrio ${obj.nombre_oficial}`;
    default: return obj.nombre_oficial;
  }
}

const HIJO_POR_NIVEL = { pais: 'provincia', provincia: 'depto', depto: 'municipio', municipio: 'barrio' };
const ETIQUETA_HIJO = { provincia: ['provincia', 'provincias'], depto: ['departamento', 'departamentos'], municipio: ['municipio', 'municipios'], barrio: ['barrio', 'barrios'] };

/** Conteo de hijos directos + etiqueta ("24 provincias"), o null si no aplica. */
function resumenHijos(obj) {
  const nivelHijo = HIJO_POR_NIVEL[obj.nivel];
  if (!nivelHijo) return null;
  const n = getHijos(obj.yvy_id).filter((h) => h.nivel === nivelHijo).length;
  if (n === 0) return null;
  const [sing, plur] = ETIQUETA_HIJO[nivelHijo];
  return { n, texto: `${fmtInt.format(n)} ${n === 1 ? sing : plur}` };
}

function densidad(obj, poblacion) {
  const sup = Number(obj.sup_oficial_km2);
  if (!Number.isFinite(sup) || sup <= 0 || !poblacion) return null;
  return fmt1dec.format(Math.round((poblacion / sup) * 10) / 10);
}

// --------------------------------------------------------------
// Panel: helpers de estado
// --------------------------------------------------------------
function setTituloPanel(texto) {
  const idEl = document.getElementById('explorer-inspect-id');
  if (idEl) idEl.textContent = texto;
}

function contenedorFicha() {
  const detalle = document.getElementById('explorer-detalle');
  if (detalle) detalle.hidden = false;
  return document.getElementById('objeto-info');
}

export function mostrarEstadoFalta() {
  const contenedor = contenedorFicha();
  setTituloPanel('Sin datos');
  if (contenedor) {
    contenedor.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'objeto-empty-state';
    const p = document.createElement('p');
    p.textContent = 'No tengo ese dato todavía';
    d.appendChild(p);
    contenedor.appendChild(d);
  }
  abrirPanelObjeto();
}

export function limpiarFicha() {
  const detalle = document.getElementById('explorer-detalle');
  if (detalle) detalle.hidden = true;
  setTituloPanel('—');
  const contenedor = document.getElementById('objeto-info');
  if (!contenedor) return;
  contenedor.innerHTML = `
    <div class="objeto-empty-state">
      <p>Sin objeto seleccionado.</p>
    </div>`;
}

export function mostrarObjeto(yvyId) {
  const obj = getObjeto(yvyId);
  if (!obj) {
    mostrarEstadoFalta();
    return;
  }
  setObjetoActivo(obj);
  setTituloPanel(obj.nombre_oficial);
  abrirPanelObjeto();
  renderFicha(obj).catch((err) => console.warn('[yvy] dossier no pintado:', err));
}

// --------------------------------------------------------------
// Dossier: header + hero + grilla atómica + síntesis + referencias
// Sin vigencia (decisión de producto): el dato es el valor + la fuente.
// --------------------------------------------------------------
function bloqueHeader(obj) {
  const header = document.createElement('div');
  header.className = 'dossier-header';
  const chip = document.createElement('span');
  chip.className = 'dossier-chip';
  chip.textContent = etiquetaNivel(obj.nivel).toUpperCase();
  const sup = document.createElement('span');
  sup.className = 'dossier-superficie';
  sup.textContent = fmtSup(obj.sup_oficial_km2) || 'Sin superficie';
  header.appendChild(chip);
  header.appendChild(sup);
  return header;
}

function metrica(valor, label) {
  const item = document.createElement('div');
  item.className = 'dossier-metrica';
  const v = document.createElement('div');
  v.className = 'dossier-metrica__valor';
  v.textContent = valor;
  const l = document.createElement('div');
  l.className = 'dossier-metrica__label';
  l.textContent = label;
  item.appendChild(v);
  item.appendChild(l);
  return item;
}

function bloqueHero(m, densidadTexto) {
  const hero = document.createElement('div');
  hero.className = 'dossier-hero';
  const num = document.createElement('div');
  num.className = 'dossier-hero-num';
  num.textContent = m ? fmtInt.format(Number(m.poblacion) || 0) : '–';
  const lab = document.createElement('div');
  lab.className = 'dossier-hero-label';
  lab.textContent = densidadTexto ? `Habitantes · ${densidadTexto} hab/km²` : 'Habitantes';
  hero.appendChild(num);
  hero.appendChild(lab);
  return hero;
}

function bloqueGrid(obj, m) {
  const grid = document.createElement('div');
  grid.className = 'dossier-grid';
  const num = (v) => (v == null || v === '' || Number(v) === 0 ? '–' : fmtInt.format(Number(v)));
  const hijos = resumenHijos(obj);
  grid.appendChild(metrica(num(m && m.poblacion), 'Población'));
  grid.appendChild(metrica(num(m && m.viviendas), 'Viviendas'));
  grid.appendChild(metrica(densidad(obj, Number(m && m.poblacion)) ? `${densidad(obj, Number(m && m.poblacion))} hab/km²` : '–', 'Densidad'));
  grid.appendChild(metrica(num(m && m.pob_colectivas), 'Población en viviendas colectivas'));
  grid.appendChild(metrica(num(m && m.pob_calle), 'Población en situación de calle'));
  grid.appendChild(metrica(hijos ? hijos.texto : '–', 'Jurisdicción'));
  return grid;
}

function bloqueSintesis(obj, m) {
  const div = document.createElement('div');
  div.className = 'dossier-briefing';
  const label = document.createElement('div');
  label.className = 'dossier-briefing__label';
  label.textContent = 'Síntesis';
  const texto = document.createElement('div');
  texto.className = 'dossier-briefing__texto';
  texto.textContent = sintesisTexto(obj, m);
  div.appendChild(label);
  div.appendChild(texto);
  return div;
}

function sintesisTexto(obj, m) {
  const pob = Number(m && m.poblacion) || 0;
  if (!pob) return 'Todavía no hay datos censales registrados.';
  const viv = Number(m && m.viviendas) || 0;
  const frases = [`${nombreConArticulo(obj)} tiene ${fmtInt.format(pob)} habitantes y ${fmtInt.format(viv)} viviendas.`];
  const d = densidad(obj, pob);
  const hijos = resumenHijos(obj);
  const seg = [];
  if (d) seg.push(`La densidad es de ${d} hab/km²`);
  if (hijos) seg.push(`se organiza en ${hijos.texto}`);
  if (seg.length > 0) frases.push(`${seg.join(' y ')}.`);
  return frases.join(' ');
}

function bloqueReferencias(obj, ag) {
  const refs = document.createElement('div');
  refs.className = 'dossier-ref';
  const label = document.createElement('span');
  label.className = 'dossier-ref__label';
  label.textContent = 'Referencias:';
  refs.appendChild(label);
  const items = [];
  if (ag && ag.fuente) items.push(fuenteHumana(ag.fuente).nombre);
  if (obj.sup_oficial_km2 != null) items.push(obj.sup_fuente ? `Superficie (${obj.sup_fuente})` : 'Superficie');
  if (items.length === 0) items.push('Sin fuentes registradas');
  items.forEach((txt, i) => {
    if (i > 0) refs.appendChild(document.createTextNode(' · '));
    const s = document.createElement('span');
    s.className = 'dossier-ref__item';
    s.textContent = txt;
    refs.appendChild(s);
  });
  return refs;
}

// Texto del portapapeles: dossier accionable, sin párrafos.
// `missing` se escribe explícito, nunca se omite (SPEC §4).
function textoDossier(obj, m) {
  const lineas = [];
  const sup = fmtSup(obj.sup_oficial_km2);
  lineas.push(`${obj.nombre_oficial} · ${etiquetaNivel(obj.nivel)}${sup ? ` · ${sup}` : ''}`);
  lineas.push('---');
  if (m && Number(m.poblacion)) {
    const hijos = resumenHijos(obj);
    lineas.push(`POBLACIÓN: ${fmtInt.format(Number(m.poblacion))}`);
    lineas.push(`VIVIENDAS: ${fmtInt.format(Number(m.viviendas) || 0)}`);
    const d = densidad(obj, Number(m.poblacion));
    if (d) lineas.push(`DENSIDAD: ${d} hab/km²`);
    if (Number(m.pob_colectivas)) lineas.push(`POBLACIÓN EN VIVIENDAS COLECTIVAS: ${fmtInt.format(Number(m.pob_colectivas))}`);
    if (Number(m.pob_calle)) lineas.push(`POBLACIÓN EN SITUACIÓN DE CALLE: ${fmtInt.format(Number(m.pob_calle))}`);
    if (hijos) lineas.push(`JURISDICCIÓN: ${hijos.texto}`);
    lineas.push('');
    lineas.push(`Síntesis: ${sintesisTexto(obj, m)}`);
  } else {
    lineas.push('DATOS: no tengo ese dato todavía');
  }
  const refs = [];
  if (m && m.fuente) refs.push(fuenteHumana(m.fuente).nombre);
  if (obj.sup_oficial_km2 != null) refs.push(obj.sup_fuente ? `Superficie (${obj.sup_fuente})` : 'Superficie');
  if (refs.length > 0) {
    lineas.push('');
    lineas.push(`Referencias: ${refs.join(' · ')}`);
  }
  lineas.push(`Ver en Yvy: ${location.href}`);
  return lineas.join('\n');
}

function bloqueCopiar(obj, m) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'dossier-copy';
  b.textContent = 'Copiar dossier';
  b.addEventListener('click', async () => {
    const txt = textoDossier(obj, m);
    try {
      await navigator.clipboard.writeText(txt);
      b.textContent = 'Copiado';
    } catch {
      window.prompt('Copiá este dossier:', txt);
    }
    track('report_copy', { yvy_id: obj.yvy_id, nivel: obj.nivel });
    setTimeout(() => { b.textContent = 'Copiar dossier'; }, 2000);
  });
  return b;
}

/**
 * Pinta el dossier del objeto. Async: el agregado viene por fetch (lazy),
 * y el token descarta la respuesta si el usuario ya navegó a otro objeto.
 */
export async function renderFicha(obj) {
  const contenedor = contenedorFicha();
  if (!contenedor) return;
  const token = ++renderToken;
  contenedor.innerHTML = '';

  if (!obj) {
    contenedor.innerHTML = '<div class="objeto-empty-state"><p>Sin jurisdicción seleccionada.</p></div>';
    return;
  }

  contenedor.appendChild(bloqueHeader(obj));

  const ag = await getAgregado('demografia', obj.yvy_id);
  if (token !== renderToken) return; // llegó tarde: el objeto activo ya cambió

  const m = ag && ag.metricas ? ag.metricas : null;
  const d = m ? densidad(obj, Number(m.poblacion)) : null;

  contenedor.appendChild(bloqueHero(m, d));
  contenedor.appendChild(bloqueGrid(obj, m));
  if (m && Number(m.poblacion)) contenedor.appendChild(bloqueSintesis(obj, m));
  contenedor.appendChild(bloqueReferencias(obj, ag));
  contenedor.appendChild(bloqueCopiar(obj, m));
}
