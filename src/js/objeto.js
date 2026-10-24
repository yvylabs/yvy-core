// ==============================================================
// objeto.js — Dossier del nodo (grafo de jurisdicciones)
// Un nodo = identidad + métricas + su lugar en el grafo:
// breadcrumb de padres, Contiene (hijos), Limita con / cerca de
// (relaciones laterales), agregados con fuente y JSON-LD.
// Sin vigencia en la UI (decisión de producto): el valor + la fuente.
// ==============================================================

import {
  getObjeto,
  getPadre,
  getHijos,
  getRelaciones,
  getDatasets,
  getAgregado,
  setObjetoActivo,
  etiquetaNivel,
  navegarA,
} from './manifest.js';
import { abrirPanelObjeto, sincronizarLayout } from './ui.js';
import { track } from './telemetry.js';

// Foco pos-navegación del start screen ("Minería en Salta"): el tipo
// pedirá abrirse y resaltarse en la próxima ficha renderizada.
let focoDatasetPendiente = null;

/** Marca un dataset para abrirse y resaltarse en la próxima ficha. */
export function enfocarDataset(tipo) {
  focoDatasetPendiente = tipo;
}

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

function fmtHa(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${fmtInt.format(Math.round(n))} ha`;
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
  if (detalle) detalle.hidden = false; // próxima renderFicha arranca limpio
  setTituloPanel('—');
  const pEl = document.getElementById('panel-explorador');
  if (pEl) pEl.hidden = true; // el dock vuelve al start screen (nunca vacío)
  const contenedor = document.getElementById('objeto-info');
  if (!contenedor) return;
  contenedor.innerHTML = `
    <div class="objeto-empty-state">
      <p>Sin objeto seleccionado.</p>
    </div>`;
  sincronizarLayout();
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

// --------------------------------------------------------------
// Síntesis: EL LUGAR DEL NODO EN EL GRAFO
// Los números ya viven en el hero y en la grilla: la síntesis dice
// con quién se relaciona el nodo (hacia arriba, hacia abajo, lateral),
// sin repetir métricas. El valor está en la relación, no en el dato.
// --------------------------------------------------------------
function frasePertenencia(obj) {
  const padre = getPadre(obj);
  if (!padre) return null;
  if (/sin gobierno local/i.test(obj.nombre_oficial || '')) {
    return `Área de la provincia de ${padre.nombre_oficial} sin gobierno local.`;
  }
  switch (obj.nivel) {
    case 'provincia': return `Provincia que integra ${padre.nombre_oficial}.`;
    case 'depto': return `Departamento de la provincia de ${padre.nombre_oficial}.`;
    case 'municipio':
      if (padre.nivel === 'depto') {
        const abuelo = getPadre(padre);
        return `Municipio del departamento ${padre.nombre_oficial}${abuelo ? `, ${abuelo.nombre_oficial}` : ''}.`;
      }
      return `Municipio de la provincia de ${padre.nombre_oficial}.`;
    case 'barrio': return `Barrio de ${padre.nombre_oficial}.`;
    default: return `Integra ${padre.nombre_oficial}.`;
  }
}

function fraseEstructura(obj) {
  if (obj.nivel === 'pais') {
    const provs = getHijos(obj.yvy_id).filter((h) => h.nivel === 'provincia');
    return provs.length > 0 ? `Se organiza en ${provs.length} ${provs.length === 1 ? 'provincia' : 'provincias'}.` : null;
  }
  if (obj.nivel === 'provincia') {
    const deptos = getHijos(obj.yvy_id).filter((h) => h.nivel === 'depto');
    const munisDirectos = getHijos(obj.yvy_id).filter((h) => h.nivel === 'municipio');
    const vistos = new Set(munisDirectos.map((m) => m.yvy_id));
    const munis = [...munisDirectos, ...todosMunicipios(obj).filter((m) => !vistos.has(m.yvy_id))];
    const partes = [];
    if (deptos.length > 0) partes.push(`${deptos.length} ${deptos.length === 1 ? 'departamento' : 'departamentos'}`);
    if (munis.length > 0) partes.push(`${munis.length} ${munis.length === 1 ? 'municipio' : 'municipios'}`);
    if (partes.length === 0) return null;
    return `Contiene ${partes.join(' y ')}.`;
  }
  if (obj.nivel === 'depto') {
    const munis = getHijos(obj.yvy_id).filter((h) => h.nivel === 'municipio');
    return munis.length > 0 ? `Contiene ${munis.length} ${munis.length === 1 ? 'municipio' : 'municipios'}.` : 'Sin municipios registrados.';
  }
  if (obj.nivel === 'municipio') {
    const barrios = getHijos(obj.yvy_id).filter((h) => h.nivel === 'barrio');
    return barrios.length > 0 ? `Contiene ${barrios.length} ${barrios.length === 1 ? 'barrio' : 'barrios'}.` : null;
  }
  return null;
}

function bloqueSintesis(obj, m, limitaTexto) {
  const div = document.createElement('div');
  div.className = 'dossier-briefing';
  const label = document.createElement('div');
  label.className = 'dossier-briefing__label';
  label.textContent = 'Síntesis';
  const texto = document.createElement('div');
  texto.className = 'dossier-briefing__texto';
  texto.textContent = sintesisTexto(obj, m, limitaTexto);
  div.appendChild(label);
  div.appendChild(texto);
  return div;
}

function sintesisTexto(obj, m, limitaTexto) {
  const frases = [];
  const pert = frasePertenencia(obj);
  if (pert) frases.push(pert);
  const est = fraseEstructura(obj);
  if (est) frases.push(est);
  if (limitaTexto) frases.push(limitaTexto);
  if (frases.length === 0) return 'Todavía no hay relaciones registradas para este nodo.';
  return frases.join(' ');
}

// "Limita con Jujuy, Formosa y 2 más." — nombres reales del grafo.
function fraseLimita(obj) {
  const nombres = [];
  const vistos = new Set();
  for (const r of getRelaciones(obj.yvy_id)) {
    if (r.tipo !== 'lindero') continue;
    const dest = getObjeto(r.destino_yvy_id);
    if (!dest || vistos.has(dest.yvy_id)) continue;
    vistos.add(dest.yvy_id);
    nombres.push(dest.nombre_oficial);
  }
  if (nombres.length === 0) return null;
  const tope = nombres.slice(0, 6);
  const resto = nombres.length - tope.length;
  return `Limita con ${tope.join(', ')}${resto > 0 ? ` y ${resto} más` : ''}.`;
}

function bloqueReferencias(refs) {
  const cont = document.createElement('div');
  cont.className = 'dossier-ref';
  const label = document.createElement('span');
  label.className = 'dossier-ref__label';
  label.textContent = 'Referencias:';
  cont.appendChild(label);
  const items = refs.map((r) => r.nombre);
  if (items.length === 0) items.push('Sin fuentes registradas');
  items.forEach((txt, i) => {
    const ref = refs[i];
    if (i > 0) cont.appendChild(document.createTextNode(' · '));
    if (ref && ref.url) {
      const a = document.createElement('a');
      a.href = ref.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = txt;
      a.className = 'dossier-ref__item';
      cont.appendChild(a);
    } else {
      const s = document.createElement('span');
      s.className = 'dossier-ref__item';
      s.textContent = txt;
      cont.appendChild(s);
    }
  });
  return cont;
}

// Texto del portapapeles: dossier accionable, sin párrafos.
// `missing` se escribe explícito, nunca se omite (SPEC §4).
function textoDossier(obj, m, extras) {
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
  } else {
    lineas.push('DATOS: no tengo ese dato todavía');
  }
  lineas.push('');
  lineas.push(`Síntesis: ${sintesisTexto(obj, m, extras.limita || null)}`);
  const ruta = ExtrasRuta(obj);
  if (ruta.length > 1) lineas.push(`RUTA: ${ruta.join(' › ')}`);
  if (extras.contiene) lineas.push(`CONTIENE: ${extras.contiene}`);
  if (extras.limita) lineas.push(`LINDERA CON: ${extras.limitaNombres}`);
  if (extras.datasetLineas.length > 0) {
    lineas.push('');
    for (const l of extras.datasetLineas) lineas.push(l);
  }
  const refs = extras.refs.map((r) => r.nombre);
  if (refs.length > 0) {
    lineas.push('');
    lineas.push(`Referencias: ${refs.join(' · ')}`);
  }
  lineas.push(`Ver en Yvy: ${location.href}`);
  return lineas.join('\n');
}

// Ruta jerárquica completa hasta el país ("Argentina › Salta › Anta").
function ExtrasRuta(obj) {
  const ruta = [obj.nombre_oficial];
  let cur = getPadre(obj);
  while (cur) {
    ruta.unshift(cur.nombre_oficial);
    cur = getPadre(cur);
  }
  return ruta;
}

function bloqueCopiar(obj, m, extras) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'dossier-copy';
  b.textContent = 'Copiar dossier';
  b.addEventListener('click', async () => {
    const txt = textoDossier(obj, m, extras);
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

// --------------------------------------------------------------
// EL GRAFO — breadcrumb de padres (clicable)
// --------------------------------------------------------------
function breadcrumbNodo(obj) {
  const rutaObjs = [];
  let cur = obj;
  while (cur) {
    rutaObjs.unshift(cur);
    cur = getPadre(cur);
  }
  if (rutaObjs.length < 2) return null; // el país no lleva breadcrumb

  const bc = document.createElement('nav');
  bc.className = 'objeto-breadcrumb';
  bc.setAttribute('aria-label', 'Jerarquía');
  rutaObjs.forEach((o, i) => {
    const ultimo = i === rutaObjs.length - 1;
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'objeto-breadcrumb__sep';
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = '›';
      bc.appendChild(sep);
    }
    if (ultimo) {
      const chip = document.createElement('span');
      chip.className = 'objeto-breadcrumb__final';
      chip.textContent = o.nombre_oficial;
      bc.appendChild(chip);
    } else {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'objeto-breadcrumb__btn';
      b.textContent = o.nombre_oficial;
      b.title = `Ir a ${o.nombre_oficial}`;
      b.addEventListener('click', () => navegarA(o.yvy_id));
      bc.appendChild(b);
    }
  });
  return bc;
}

// --------------------------------------------------------------
// Acordeón generico (estilo dossier): plegable, con contador
// --------------------------------------------------------------
function crearSeccion(titulo, conteo, abierto) {
  const wrap = document.createElement('div');
  wrap.className = 'dossier-acc';
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'dossier-acc__head';
  head.setAttribute('aria-expanded', abierto ? 'true' : 'false');
  const t = document.createElement('span');
  t.className = 'dossier-acc__titulo';
  t.textContent = titulo;
  head.appendChild(t);
  if (conteo != null) {
    const c = document.createElement('span');
    c.className = 'dossier-acc__conteo';
    c.textContent = String(conteo);
    head.appendChild(c);
  }
  const chev = document.createElement('span');
  chev.className = 'dossier-acc__chevron';
  chev.setAttribute('aria-hidden', 'true');
  head.appendChild(chev);
  const body = document.createElement('div');
  body.className = 'dossier-acc__body';
  body.hidden = !abierto;
  head.addEventListener('click', () => {
    body.hidden = !body.hidden;
    head.setAttribute('aria-expanded', String(!body.hidden));
  });
  wrap.appendChild(head);
  wrap.appendChild(body);
  return { wrap, body, head };
}

function itemNavegable(o) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'dossier-nav-item';
  const nombre = document.createElement('span');
  nombre.className = 'dossier-nav-item__nombre';
  nombre.textContent = o.nombre_oficial;
  const tipo = document.createElement('span');
  tipo.className = 'dossier-nav-item__tipo';
  tipo.textContent = etiquetaNivel(o.nivel);
  b.appendChild(nombre);
  b.appendChild(tipo);
  b.addEventListener('click', () => navegarA(o.yvy_id));
  return b;
}

// --------------------------------------------------------------
// CONTIENE — hijos agrupados por nivel, 8 visibles + "Ver los N →"
// --------------------------------------------------------------
const LIMITE_HIJOS = 8;

function gruposHijos(obj) {
  const orden = ['provincia', 'depto', 'municipio', 'barrio'];
  const grupos = [];
  for (const nivel of orden) {
    const items = getHijos(obj.yvy_id).filter((h) => h.nivel === nivel);
    if (items.length > 0) grupos.push({ nivel, items });
  }
  return grupos;
}

// Municipios reales de la provincia: hijos de los deptos (tree decorrido).
function todosMunicipios(obj) {
  if (obj.nivel !== 'provincia') return [];
  const out = [];
  for (const d of getHijos(obj.yvy_id)) {
    if (d.nivel === 'depto') out.push(...getHijos(d.yvy_id).filter((m) => m.nivel === 'municipio'));
  }
  return out;
}

function grupoHijosEnBody(body, nivel, items, tituloForzado) {
  const [, plur] = ETIQUETA_HIJO[nivel] || [nivel, `${nivel}s`];
  const label = document.createElement('div');
  label.className = 'dossier-acc__grupo';
  label.textContent = (tituloForzado || `${plur} · ${items.length}`).toUpperCase();
  body.appendChild(label);
  // Todos los ítems viven en el DOM en orden; los que pasan el tope quedan
  // ocultos hasta el "Ver los N →" (determinista, sin re-render).
  for (const h of items) {
    const btn = itemNavegable(h);
    btn.hidden = items.indexOf(h) >= LIMITE_HIJOS;
    body.appendChild(btn);
  }
  if (items.length > LIMITE_HIJOS) {
    const accion = document.createElement('button');
    accion.type = 'button';
    accion.className = 'dossier-more';
    accion.textContent = `Ver los ${items.length} →`;
    accion.addEventListener('click', () => {
      const ocultos = [...body.querySelectorAll('.dossier-nav-item')].filter((el) => el.hidden);
      const desplegable = ocultos.length > 0;
      ocultos.forEach((el) => { el.hidden = !desplegable; });
      accion.textContent = desplegable ? 'Ver menos ↑' : `Ver los ${items.length} →`;
    });
    body.appendChild(accion);
  }
}

// Devuelve null si el nodo no tiene hijos que mostrar.
function seccionContiene(obj) {
  const grupos = gruposHijos(obj);
  const extras = [];
  if (obj.nivel === 'provincia') {
    // Municipios de la provincia: los colgados de deptos + los directos,
    // unificados (el manifiesto reparado puede dejarlos en ambos lados).
    const munis = todosMunicipios(obj);
    if (munis.length > 0) extras.push({ nivel: 'municipio', items: munis });
  }
  if (grupos.length === 0 && extras.length === 0) return null;
  // Fusionar el grupo directo de municipios con el extras (dedup por id):
  // una sola sección "MUNICIPIOS · N", nunca dos grupos iguales.
  if (obj.nivel === 'provincia') {
    const grupoDirecto = grupos.find((g) => g.nivel === 'municipio');
    const extra = extras.find((g) => g.nivel === 'municipio');
    if (grupoDirecto && extra) {
      const vistos = new Set(grupoDirecto.items.map((h) => h.yvy_id));
      for (const m of extra.items) {
        if (!vistos.has(m.yvy_id)) { grupoDirecto.items.push(m); vistos.add(m.yvy_id); }
      }
      grupoDirecto.items.sort((a, b) => a.nombre_oficial.localeCompare(b.nombre_oficial, 'es'));
      extras.splice(extras.indexOf(extra), 1);
    }
  }
  const total = grupos.reduce((a, g) => a + g.items.length, 0)
    + extras.reduce((a, g) => a + g.items.length, 0);
  const { wrap, body } = crearSeccion('Contiene', total, true);
  for (const g of grupos) grupoHijosEnBody(body, g.nivel, g.items);
  for (const g of extras) grupoHijosEnBody(body, g.nivel, g.items, g.titulo);
  return wrap;
}

// --------------------------------------------------------------
// RELACIONES LATERALES — Limita con (lindero) / Cerca de
// Plegadas por defecto (decisión cerrada).
// --------------------------------------------------------------
function seccionesVecinos(obj) {
  const rels = getRelaciones(obj.yvy_id);
  const secciones = [];
  for (const tipo of ['lindero', 'cerca_de']) {
    const vecinos = [];
    const vistos = new Set();
    for (const r of rels) {
      if (r.tipo !== tipo) continue;
      const dest = getObjeto(r.destino_yvy_id);
      if (!dest || vistos.has(dest.yvy_id)) continue;
      vistos.add(dest.yvy_id);
      vecinos.push(dest);
    }
    if (vecinos.length === 0) continue;
    const titulo = tipo === 'lindero' ? 'Limita con' : 'Cerca de';
    const { wrap, body } = crearSeccion(titulo, vecinos.length, false); // plegado
    vecinos.forEach((v) => body.appendChild(itemNavegable(v)));
    secciones.push(wrap);
  }
  return secciones;
}

// --------------------------------------------------------------
// DATASETS — catastro / minería donde aplica, con dct:source visible
// --------------------------------------------------------------
// Catálogo → etiqueta cabecera
const TITULO_DATASET = { catastro: 'Catastro', mineria: 'Minería' };

function parseMapaJson(s) {
  try {
    const o = JSON.parse(s);
    return Object.entries(o).map(([k, v]) => ({ k, v: Number(v) || 0 }));
  } catch {
    return [];
  }
}

// Acordeón de un dataset con su agregado ya resuelto (o null si 404).
function seccionDataset(ds, ag) {
  const titulo = TITULO_DATASET[ds.tipo] || ds.tipo;
  const f = fuenteHumana(ag && ag.fuente ? ag.fuente : ds.fuente);
  // dct:source visible en el header (nunca solo en el cuerpo).
  const { wrap, body } = crearSeccion(titulo, null, false);
  wrap.dataset.tipo = ds.tipo; // acceso directo start screen (enfocarDataset)
  const headT = wrap.querySelector('.dossier-acc__titulo');
  headT.textContent = `${titulo} · ${f.corto}`;

  if (!ag || !ag.metricas) {
    const p = document.createElement('p');
    p.className = 'dossier-acc__vacio';
    p.textContent = 'Sin datos registrados todavía.';
    body.appendChild(p);
    return wrap;
  }
  const m = ag.metricas;
  const grid = document.createElement('div');
  grid.className = 'dossier-grid';
  if (ds.tipo === 'catastro') {
    const n = Number(m.total_parcelas) || 0;
    grid.appendChild(metrica(n ? fmtInt.format(n) : '–', 'Parcelas'));
    const ha = fmtHa(m.area_total_ha);
    grid.appendChild(metrica(ha || '–', 'Área catastrada'));
    const cats = parseMapaJson(m.por_categoria);
    for (const { k, v } of cats) {
      grid.appendChild(metrica(fmtInt.format(v), `Parcelas en ${String(k).toLowerCase()}`));
    }
  } else if (ds.tipo === 'mineria') {
    const n = Number(m.total_concesiones) || 0;
    grid.appendChild(metrica(n ? fmtInt.format(n) : '–', 'Concesiones'));
    const ha = fmtHa(m.area_total_ha);
    grid.appendChild(metrica(ha || '–', 'Área concesionada'));
  } else {
    // Dataset futuro: métricas genéricas con etiqueta humana.
    for (const [k, v] of Object.entries(m)) {
      const n = Number(v);
      grid.appendChild(metrica(Number.isFinite(n) ? fmtInt.format(n) : String(v), k.replace(/_/g, ' ')));
    }
  }
  body.appendChild(grid);

  // Fuente (dct:source) al pie del cuerpo, con link si la hay.
  const foot = document.createElement('div');
  foot.className = 'dossier-fuente';
  agregarFuentePie(foot, f);
  body.appendChild(foot);
  return wrap;
}

function agregarFuentePie(foot, f) {
  const fl = document.createElement('span');
  fl.textContent = `Fuente: ${f.nombre}`;
  foot.appendChild(fl);
  if (f.url) {
    const a = document.createElement('a');
    a.href = f.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = ' · sitio oficial';
    foot.appendChild(a);
  }
}

// --------------------------------------------------------------
// Grafo de relaciones (EL nodo como pieza del grafo, estilo Obsidian)
// Vista visual: nodo central + padre + hijos + vecinos con d3-force.
// Clic en un nodo → navegar. El JSON-LD crudo queda detrás del botón
// secundario (el grafo es para usuarios; el código, para la ficha).
// --------------------------------------------------------------
const TIPO_NIVEL = {
  pais: 'Pais',
  provincia: 'Provincia',
  depto: 'Departamento',
  municipio: 'Municipio',
  barrio: 'Barrio',
};

function nodoJsonLd(obj, ags) {
  const base = import.meta.env.BASE_URL || './';
  const tipo = `yvyont:${TIPO_NIVEL[obj.nivel] || obj.nivel}`;
  const nodo = {
    '@id': `yvy:${obj.yvy_id}`,
    '@type': tipo,
    yvy_id: Number(obj.yvy_id),
    nombre_oficial: obj.nombre_oficial,
    nivel: tipo,
  };
  const padre = getPadre(obj);
  if (padre) nodo.parent_yvy_id = { '@id': `yvy:${padre.yvy_id}` };
  const hijos = getHijos(obj.yvy_id);
  if (hijos.length > 0) {
    nodo['yvyont:contiene'] = hijos.map((h) => ({ '@id': `yvy:${h.yvy_id}` }));
  }
  const rels = getRelaciones(obj.yvy_id);
  for (const tipoRel of ['lindero', 'cerca_de']) {
    const dest = [...new Set(rels.filter((r) => r.tipo === tipoRel).map((r) => r.destino_yvy_id))];
    if (dest.length > 0) {
      nodo[`yvyont:${tipoRel}`] = dest.map((id) => ({ '@id': `yvy:${id}` }));
    }
  }
  if (obj.sup_oficial_km2 != null) nodo.sup_oficial_km2 = Number(obj.sup_oficial_km2);
  if (obj.sup_fuente) nodo.sup_fuente = obj.sup_fuente;
  if (obj.sup_fuente_corta) nodo.sup_fuente_corta = obj.sup_fuente_corta;
  if (obj.centro && Array.isArray(obj.centro)) {
    nodo.centro = `POINT(${obj.centro[0]} ${obj.centro[1]})`;
  } else if (typeof obj.centro === 'string') {
    nodo.centro = obj.centro;
  }
  if (Array.isArray(obj.bounds_objeto) && obj.bounds_objeto.length === 4) {
    const b = obj.bounds_objeto;
    nodo.bounds_objeto = `BOX(${b[0]} ${b[1]} ${b[2]} ${b[3]})`;
  }
  if (obj.pmtiles) nodo.pmtiles = obj.pmtiles;
  nodo.tiene_geometria = obj.pmtiles != null;
  // dct:source del nodo: fuentes reales de los agregados resueltos.
  const sources = [];
  for (const ag of Object.values(ags)) {
    if (ag && ag.fuente && !sources.includes(ag.fuente)) sources.push(ag.fuente);
  }
  if (sources.length > 0) nodo['dct:source'] = sources;
  return { '@context': new URL(`${base}data/context.jsonld`, location.href).toString(), ...nodo };
}

function bloqueJSONLD(obj, ags) {
  const wrap = document.createElement('div');
  wrap.className = 'dossier-json-bloque';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dossier-copy dossier-copy--sec';
  btn.textContent = 'Ver código fuente (JSON-LD)';
  const pre = document.createElement('pre');
  pre.className = 'dossier-json';
  pre.hidden = true; // el código arranca cerrado: el grafo es la superficie
  const nodo = nodoJsonLd(obj, ags);
  pre.textContent = JSON.stringify(nodo, null, 2);
  btn.addEventListener('click', async () => {
    pre.hidden = !pre.hidden;
    btn.textContent = pre.hidden ? 'Ver código fuente (JSON-LD)' : 'Ocultar código fuente (JSON-LD)';
  });
  wrap.appendChild(btn);
  wrap.appendChild(pre);
  return wrap;
}

/**
 * Bloque principal del grafo: "Ver Grafo de Relaciones".
 * Abre/cierra la vista visual; el SVG se monta LA PRIMERA vez que se
 * abre (lazy) con el estado del nodo vigente en ese momento.
 */
function bloqueGrafo(obj, navegar) {
  const wrap = document.createElement('div');
  wrap.className = 'dossier-json-bloque';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dossier-copy dossier-copy--grafo';
  btn.textContent = 'Ver Grafo de Relaciones';
  const cont = document.createElement('div');
  cont.className = 'dossier-grafo';
  cont.hidden = true;
  let montado = false;
  btn.addEventListener('click', () => {
    cont.hidden = !cont.hidden;
    btn.textContent = cont.hidden ? 'Ver Grafo de Relaciones' : 'Ocultar Grafo de Relaciones';
    if (!cont.hidden && !montado && navegar) {
      montado = true;
      import('./grafo.js')
        .then((m) => m.crearGrafoRelaciones(obj, { navegar }))
        .then((svg) => { cont.hidden = true; cont.appendChild(svg); cont.hidden = false; })
        .catch((e) => {
          montado = false;
          cont.hidden = true;
          console.warn('[yvy] grafo no montado:', e?.message);
        });
    }
  });
  wrap.appendChild(btn);
  wrap.appendChild(cont);
  return wrap;
}

// --------------------------------------------------------------
// Orquestación: fetch de agregados aplicables + composición del nodo
// --------------------------------------------------------------
/**
 * Pinta el dossier del objeto. Async: los agregados vienen por fetch (lazy),
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

  const bc = breadcrumbNodo(obj);
  if (bc) contenedor.appendChild(bc); // el país no lleva breadcrumb
  contenedor.appendChild(bloqueHeader(obj));

  // Agregados aplicables: demografía siempre; catastro/minería según nivel
  // declarado (depto) o rollup existente (provincia). 404 = no se muestra.
  const tipos = ['demografia'];
  if (obj.nivel === 'depto' || obj.nivel === 'provincia') tipos.push('catastro', 'mineria');
  const ags = {};
  await Promise.all(tipos.map(async (t) => { ags[t] = await getAgregado(t, obj.yvy_id); }));
  if (token !== renderToken) return; // llegó tarde: el objeto activo ya cambió

  const ds = Object.fromEntries(getDatasets().map((d) => [d.tipo, d]));
  const m = ags.demografia && ags.demografia.metricas ? ags.demografia.metricas : null;
  const d = m ? densidad(obj, Number(m.poblacion)) : null;
  const limita = fraseLimita(obj);

  // Extras para síntesis, copia y referencias (nada inventado).
  const extras = { contiene: null, limita: limita, limitaNombres: null, refs: [], datasetLineas: [] };
  if (m && m.fuente) extras.refs.push(fuenteHumana(m.fuente));
  if (obj.sup_oficial_km2 != null) extras.refs.push({ nombre: obj.sup_fuente ? `Superficie (${obj.sup_fuente})` : 'Superficie' });

  contenedor.appendChild(bloqueHero(m, d));
  contenedor.appendChild(bloqueGrid(obj, m));
  // La síntesis ya no depende del censo: habla del lugar del nodo en
  // el grafo (padre, contiene, vecinos) aunque falte el dato demográfico.
  contenedor.appendChild(bloqueSintesis(obj, m, limita));

  // ---- Contiene ----
  const cont = seccionContiene(obj);
  if (cont) {
    contenedor.appendChild(cont);
    const partes = [];
    const grupos = gruposHijos(obj);
    for (const g of grupos) {
      const [, plur] = ETIQUETA_HIJO[g.nivel];
      partes.push(`${g.items.length} ${plur}`);
    }
    if (obj.nivel === 'provincia') {
      const munis = todosMunicipios(obj);
      if (munis.length > 0) partes.push(`${munis.length} municipios`);
    }
    if (partes.length > 0) extras.contiene = partes.join(' · ');
  }

  // ---- Vecinos (lindero / cerca de) ----
  for (const s of seccionesVecinos(obj)) contenedor.appendChild(s);
  if (limita) {
    const nombres = [];
    const vistos = new Set();
    for (const r of getRelaciones(obj.yvy_id)) {
      if (r.tipo !== 'lindero') continue;
      const dest = getObjeto(r.destino_yvy_id);
      if (!dest || vistos.has(dest.yvy_id)) continue;
      vistos.add(dest.yvy_id);
      nombres.push(dest.nombre_oficial);
    }
    extras.limitaNombres = nombres.join(', ');
  }

  // ---- Agregados (catastro / minería) ----
  // En provincia solo si existe agregado rollup; en depto según catálogo.
  for (const tipoD of ['catastro', 'mineria']) {
    const dsMeta = ds[tipoD];
    if (!dsMeta) continue;
    const aplicableNivel = (dsMeta.niveles || []).includes(obj.nivel);
    const ag = ags[tipoD];
    if (!aplicableNivel && !(obj.nivel === 'provincia' && ag)) continue;
    if (!ag) continue; // 404: sin datos, no se muestra (no se grita)
    const wrap = seccionDataset(dsMeta, ag);
    if (wrap) {
      contenedor.appendChild(wrap);
      const f = fuenteHumana(ag.fuente || dsMeta.fuente);
      extras.refs.push({ nombre: `${TITULO_DATASET[tipoD]}: ${f.nombre}` });
      const mA = ag.metricas || {};
      if (tipoD === 'catastro' && Number(mA.total_parcelas)) {
        extras.datasetLineas.push(`CATASTRO: ${fmtInt.format(Number(mA.total_parcelas))} parcelas${fmtHa(mA.area_total_ha) ? ` (${fmtHa(mA.area_total_ha)})` : ''}`);
      }
      if (tipoD === 'mineria' && Number(mA.total_concesiones)) {
        extras.datasetLineas.push(`MINERÍA: ${fmtInt.format(Number(mA.total_concesiones))} concesiones${fmtHa(mA.area_total_ha) ? ` (${fmtHa(mA.area_total_ha)})` : ''}`);
      }
    }
  }

  // ---- Grafo de relaciones (visual) + JSON-LD crudo (secundario) ----
  contenedor.appendChild(bloqueGrafo(obj, navegarA));
  contenedor.appendChild(bloqueJSONLD(obj, ags));

  contenedor.appendChild(bloqueReferencias(extras.refs));
  contenedor.appendChild(bloqueCopiar(obj, m, extras));

  // Foco pos-navegación del start screen ("Minería en Salta"): el
  // pendiente lo pone enfocarDataset() ANTES de navegar; si la sección
  // existe (depto/provincia con rollup), se abre y se resalta.
  const foco = focoDatasetPendiente;
  focoDatasetPendiente = null;
  if (foco) {
    const s = contenedor.querySelector(`.dossier-acc[data-tipo="${foco}"]`);
    if (s) {
      const head = s.querySelector('.dossier-acc__head');
      if (head) head.click();
      s.classList.add('dossier-acc--foco');
      s.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }
}
