// ==============================================================
// objeto.js — Dossier del nodo (grafo de jurisdicciones)
// Un nodo = identidad + métricas + su lugar en el grafo:
// grafo de relaciones, breadcrumb de padres, Contiene (hijos),
// Limita con / cerca de (relaciones laterales), agregados con fuente.
// Sin vigencia en la UI (decisión de producto): el valor + la fuente.
// Sin JSON-LD en la UI: el dato crudo vive en data/manifest.jsonld.
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
import { hashCanonico, payloadEntidad, payloadLinaje } from './canonico.js';
import { track } from './telemetry.js';
import { cargarOntologia, metricasDeclaradas, relacionesDeclaradas, tipoDe } from './ontologia.js';

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
  const izq = document.createElement('div');
  izq.className = 'dossier-header__izq';
  const titulo = document.createElement('span');
  titulo.className = 'dossier-header__titulo';
  titulo.textContent = obj.nombre_oficial || '—';
  const chip = document.createElement('span');
  chip.className = 'dossier-chip';
  chip.textContent = etiquetaNivel(obj.nivel).toUpperCase();
  izq.appendChild(titulo);
  izq.appendChild(chip);
  header.appendChild(izq);

  const acciones = document.createElement('div');
  acciones.className = 'dossier-acciones';
  const boton = (texto, cls, icono, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `report-btn ${cls || ''}`;
    b.innerHTML = icono;
    b.appendChild(document.createTextNode(texto));
    b.addEventListener('click', fn);
    return b;
  };
  const icoLinaje = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="12" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.2 7.4 15.8 10.8M8.2 16.6l7.6-3.4"/></svg>';
  const icoMapa = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  const icoExport = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  acciones.appendChild(boton('Ver Linaje', '', icoLinaje, () => window.yvyDrawer?.open('linaje')));
  acciones.appendChild(boton('Ver Mapa', '', icoMapa, () => window.yvyDrawer?.open('mapa')));
  acciones.appendChild(boton('Exportar Reporte', 'report-btn--primary', icoExport, () => window.print()));
  header.appendChild(acciones);
  return header;
}

/** Fuente y fecha de corte del dataset demográfico (nada inventado). */
function fuenteDemografia() {
  const d = getDatasets().find((x) => x.tipo === 'demografia');
  if (!d) return null;
  return { fuente: fuenteHumana(d.fuente).corto || d.fuente || null, fecha: d.fecha_vigencia || null };
}

function metrica(valor, label, origen, yvyId) {
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
  if (origen) {
    const src = document.createElement('div');
    src.className = 'dossier-metrica__source';
    src.textContent = origen;
    item.appendChild(src);
    // Linaje de campo: fuente → métrica → hash, sin salir del dossier.
    if (yvyId != null) {
      const det = document.createElement('details');
      det.className = 'dossier-metrica__linaje';
      const sum = document.createElement('summary');
      sum.textContent = 'ver origen';
      det.appendChild(sum);
      const cuerpo = document.createElement('div');
      cuerpo.className = 'dossier-metrica__linaje-cuerpo';
      cuerpo.textContent = 'consultando…';
      det.appendChild(cuerpo);
      det.addEventListener('toggle', async () => {
        if (!det.open || cuerpo.dataset.cargado) return;
        cuerpo.dataset.cargado = '1';
        try {
          const ag = await getAgregado('demografia', yvyId);
          const c = ag?.certificado;
          cuerpo.textContent = [
            `Dataset: ${ag?.tipo || 'demografia'}${ag?.version ? ` v${ag.version}` : ''}`,
            `Fuente: ${ag?.fuente || 'sin fuente'}`,
            `Fecha de corte: ${ag?.fecha_vigencia || 'no declarada'}`,
            c ? `hash_entidad: ${c.hash_entidad}` : 'sin certificado',
            c ? `hash_linaje: ${c.hash_linaje}` : '',
          ].filter(Boolean).join(' · ');
        } catch (err) {
          cuerpo.textContent = `No se pudo cargar el linaje: ${err?.message || err}`;
        }
      });
      item.appendChild(det);
    }
  }
  return item;
}

function bloqueHero(m, densidadTexto) {
  const hero = document.createElement('div');
  hero.className = 'dossier-hero';
  const num = document.createElement('div');
  num.className = 'dossier-hero-num';
  // R11: el estado `missing` se DICE (SPEC §4). Un guion solo no alcanza:
  // el hero lo declara y la nota dice por qué, sin inventar un cero.
  const sinDatos = !m || m.poblacion == null || m.poblacion === '';
  num.textContent = sinDatos ? 'Sin dato' : fmtInt.format(Number(m.poblacion) || 0);
  num.classList.toggle('dossier-hero-num--vacio', sinDatos);
  const lab = document.createElement('div');
  lab.className = 'dossier-hero-label';
  lab.textContent = sinDatos
    ? 'Población · sin datos del Censo 2022'
    : (densidadTexto ? `Habitantes · ${densidadTexto} hab/km²` : 'Habitantes');
  hero.appendChild(num);
  hero.appendChild(lab);
  if (sinDatos) {
    const nota = document.createElement('div');
    nota.className = 'dossier-hero-nota';
    nota.textContent = 'El Censo 2022 no publica datos para este objeto.';
    hero.appendChild(nota);
  }
  const origen = fuenteDemografia();
  if (origen && !sinDatos) {
    const src = document.createElement('div');
    src.className = 'dossier-hero__source';
    src.textContent = `Fuente: ${origen.fuente}${origen.fecha ? ` · Fecha de corte: ${origen.fecha}` : ''}`;
    hero.appendChild(src);
  }
  return hero;
}

function bloqueGrid(obj, m) {
  const grid = document.createElement('div');
  grid.className = 'dossier-grid';
  // SPEC §4: el dato que no existe es null/missing. Un CERO REAL (p. ej.
  // 0 concesiones) se muestra como 0: ocultarlo sería un dato falso.
  const sinDato = 'Sin dato';
  const num = (v) => (v == null || v === '' || v === 'missing' ? sinDato : fmtInt.format(Number(v)));
  const origen = fuenteDemografia();
  const src = origen ? `Fuente: ${origen.fuente}${origen.fecha ? ` · ${origen.fecha}` : ''}` : null;
  const hijos = resumenHijos(obj);
  grid.appendChild(metrica(num(m && m.poblacion), 'Población', src, obj.yvy_id));
  grid.appendChild(metrica(num(m && m.viviendas), 'Viviendas', src, obj.yvy_id));
  const dens = m && m.poblacion != null ? densidad(obj, Number(m.poblacion)) : null;
  grid.appendChild(metrica(dens ? `${dens} hab/km²` : sinDato, 'Densidad', dens && obj.sup_fuente ? `Cálculo propio sobre superficie ${obj.sup_fuente}` : src, obj.yvy_id));
  grid.appendChild(metrica(num(m && m.pob_colectivas), 'Población en viviendas colectivas', src, obj.yvy_id));
  grid.appendChild(metrica(num(m && m.pob_calle), 'Población en situación de calle', src, obj.yvy_id));
  grid.appendChild(metrica(hijos ? hijos.texto : sinDato, 'Jurisdicción', 'Fuente: registro de jurisdicciones', obj.yvy_id));
  return grid;
}

/**
 * Modelo de datos de la entidad: tipo, posición en el árbol, relaciones
 * declaradas y unidades. La ontología es dato público del producto, no
 * un archivo de desarrollador escondido.
 */
function bloqueModelo(obj) {
  const sec = document.createElement('section');
  sec.className = 'dossier-modelo';
  sec.innerHTML = '<h3>Modelo de datos</h3><p class="dossier-modelo__cargando">cargando esquema…</p>';
  cargarOntologia().then((ont) => {
    const tipo = tipoDe(ont, obj.nivel);
    const padre = getPadre(obj);
    const hijos = getHijos(obj.yvy_id);
    const rels = relacionesDeclaradas(ont);
    const metrics = metricasDeclaradas(ont).filter((m) => !m.previsto).slice(0, 8);
    const fila = (k, v) => `<div class="dossier-modelo__fila"><span>${k}</span><strong>${v}</strong></div>`;
    sec.innerHTML = [
      '<h3>Modelo de datos</h3>',
      '<div class="dossier-modelo__grid">',
      fila('Tipo', tipo?.nivel != null ? `nivel ${tipo.nivel}` : etiquetaNivel(obj.nivel)),
      fila('Padre', padre ? padre.nombre_oficial : 'ninguno (raíz)'),
      fila('Contiene', hijos.length ? `${hijos.length} entidades hijas` : 'sin hijos'),
      fila('Visibilidad', tipo?.visibilidad || 'public'),
      '</div>',
      `<p class="dossier-modelo__titulo">Relaciones declaradas <span>${rels.length}</span></p>`,
      `<p class="dossier-modelo__texto">${rels.map((r) => `${r.clave}${r.fuente ? ` (${r.fuente}${r.fecha ? `, ${r.fecha}` : ''})` : ''}`).join(' · ')}</p>`,
      `<p class="dossier-modelo__titulo">Métricas y unidad <span>${metrics.length}</span></p>`,
      `<p class="dossier-modelo__texto">${metrics.map((m) => `${m.etiqueta}: ${m.unidad || 'sin unidad'}`).join(' · ')}</p>`,
      '<p class="dossier-modelo__nota">Esquema publicado en <code>data/ontologia.json</code> · el mismo modelo que consume el Dossier.</p>',
    ].join('');
  }).catch((err) => {
    sec.innerHTML = `<h3>Modelo de datos</h3><p class="dossier-modelo__nota">No se pudo cargar el esquema: ${err?.message || err}</p>`;
  });
  return sec;
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

// Tooltip enterprise: "Fuente oficial: [Nombre] — [Año]".
function titleFuente(f) {
  const anio = (String(f && f.nombre || '').match(/\d{4}/) || [])[0];
  return `Fuente oficial: ${f ? f.nombre : '—'}${anio ? ` — ${anio}` : ''}`;
}

// Un ítem de referencia, con tooltip de fuente oficial.
function refItem(ref) {
  const node = document.createElement(ref && ref.url ? 'a' : 'span');
  if (ref && ref.url) {
    node.href = ref.url;
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
  }
  node.textContent = ref ? ref.nombre : 'Sin fuentes registradas';
  node.className = 'dossier-ref__item';
  if (ref && ref.nombre) node.title = titleFuente(ref);
  return node;
}

function bloqueReferencias(refs) {
  const cont = document.createElement('div');
  cont.className = 'dossier-ref';
  const label = document.createElement('span');
  label.className = 'dossier-ref__label';
  label.textContent = 'Referencias:';
  cont.appendChild(label);
  if (!refs || refs.length === 0) cont.appendChild(refItem(null));
  else refs.forEach((ref) => cont.appendChild(refItem(ref)));
  return cont;
}

// Quita el placeholder "Sin fuentes registradas" si algo resuelve tarde.
function limpiarRefsVacias(refsEl) {
  const vacio = refsEl.querySelector('.dossier-ref__item');
  if (vacio && vacio.textContent === 'Sin fuentes registradas') vacio.remove();
}

// Referencia resuelta tarde (demografía) al frente, con separador.
function insertarRefItem(refsEl, ref) {
  limpiarRefsVacias(refsEl);
  const item = refItem(ref);
  const label = refsEl.querySelector('.dossier-ref__label');
  refsEl.insertBefore(item, label ? label.nextSibling : null);
  refsEl.insertBefore(document.createTextNode(' · '), item.nextSibling);
}

// Referencia de dataset resuelto tarde, al final.
function agregarRefItem(refsEl, ref) {
  limpiarRefsVacias(refsEl);
  if (refsEl.querySelector('.dossier-ref__item')) {
    refsEl.appendChild(document.createTextNode(' · '));
  }
  refsEl.appendChild(refItem(ref));
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

/**
 * Pie del dossier: "Copiar dossier" (primaria) + "Fuentes ↗" (secundaria).
 * Fuentes scrollea la línea de Referencias con un flash breve: invita,
 * no obliga (acordeones y contenido son los protagonistas).
 */
function bloqueCopiarFooter(refsEl, obj, estadoAg, extras) {
  const row = document.createElement('div');
  row.className = 'dossier-footer';
  row.appendChild(bloqueCopiar(obj, estadoAg, extras, refsEl));
  row.appendChild(bloqueCopiarJsonLd(obj));
  const fn = document.createElement('button');
  fn.type = 'button';
  fn.className = 'dossier-copy dossier-copy--fuentes';
  fn.textContent = 'Fuentes ↗';
  fn.title = 'Ver las referencias del dossier';
  fn.addEventListener('click', () => {
    refsEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    refsEl.classList.add('dossier-ref--foco');
    setTimeout(() => refsEl.classList.remove('dossier-ref--foco'), 1600);
  });
  row.appendChild(fn);
  return row;
}

// JSON-LD mínimo y verificable: mismos campos del manifest, sin inventar.
// Es la ficha que un cliente puede pegar en su CMS o en un LLM.
function textoJsonLd(obj) {
  const padre = getPadre(obj.yvy_id);
  const doc = {
    '@context': 'https://schema.org',
    '@type': 'AdministrativeArea',
    '@id': `https://explorer.yvylabs.com/#yvy:${obj.yvy_id}`,
    identifier: `yvy:${obj.yvy_id}`,
    name: obj.nombre_oficial,
    additionalType: obj.nivel,
  };
  if (padre) {
    doc.containedInPlace = {
      '@type': 'AdministrativeArea',
      '@id': `https://explorer.yvylabs.com/#yvy:${padre.yvy_id}`,
      name: padre.nombre_oficial,
    };
  }
  const sup = Number(obj.sup_oficial_km2);
  if (Number.isFinite(sup) && sup > 0) {
    doc.area = { '@type': 'QuantitativeValue', value: Math.round(sup * 10) / 10, unitCode: 'KMK' };
  }
  return JSON.stringify(doc, null, 2);
}

function bloqueCopiarJsonLd(obj) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'dossier-copy dossier-copy--fuentes';
  b.textContent = 'Copiar JSON-LD';
  b.title = 'Copiar la ficha como JSON-LD (schema.org)';
  b.addEventListener('click', async () => {
    const txt = textoJsonLd(obj);
    try {
      await navigator.clipboard.writeText(txt);
      b.textContent = 'Copiado';
    } catch {
      window.prompt('Copiá este JSON-LD:', txt);
    }
    track('report_copy', { yvy_id: obj.yvy_id, nivel: obj.nivel, formato: 'jsonld' });
    setTimeout(() => { b.textContent = 'Copiar JSON-LD'; }, 2000);
  });
  return b;
}

// --------------------------------------------------------------
// CERTIFICADO — dos hashes por dataset, verificados en el cliente
// --------------------------------------------------------------
// El build publica hash_entidad (métricas + linaje de datos) y
// hash_linaje (relaciones + documentos) con JSON canónico RFC 8785.
// Acá se RECALCULAN con el mismo módulo: si no cierra, se dice.
// Un certificado que solo se muestra nunca se verificó.

/** Payload de linaje reconstruido igual que en el build (orden determinista). */
function linajeDelCliente(obj) {
  const rels = getRelaciones(obj.yvy_id)
    .map((r) => {
      const item = { tipo: r.tipo, destino: Number(r.destino_yvy_id) };
      if (r.dist_m != null) item.dist_m = r.dist_m;
      return item;
    })
    .sort((a, b) => (a.tipo === b.tipo ? a.destino - b.destino : a.tipo < b.tipo ? -1 : 1));
  return payloadLinaje(obj.yvy_id, rels, []);
}

/**
 * Sección colapsada "Certificado de linaje". `registrar(ag)` se llama
 * cuando cada agregado resuelve; recalcula y actualiza el badge del head.
 */
function bloqueCertificado(obj, token, contenedor) {
  const { wrap, body, head } = crearSeccion('Certificado de linaje', null, false);
  wrap.classList.add('dossier-cert');
  const badge = document.createElement('span');
  badge.className = 'dossier-cert__badge';
  badge.textContent = 'verificando…';
  head.appendChild(badge);

  const estado = { total: 0, ok: 0, filas: [] };
  const lista = document.createElement('div');
  lista.className = 'dossier-cert__lista';
  body.appendChild(lista);

  const nota = document.createElement('p');
  nota.className = 'dossier-cert__nota';
  nota.textContent = 'SHA-256 sobre JSON canónico (RFC 8785), recalculado en tu navegador. Si el dato cambia, el hash cambia.';
  body.appendChild(nota);

  const copiar = document.createElement('button');
  copiar.type = 'button';
  copiar.className = 'dossier-copy dossier-copy--fuentes';
  copiar.textContent = 'Copiar certificado';
  copiar.hidden = true;
  copiar.addEventListener('click', async () => {
    const txt = JSON.stringify({ yvy_id: obj.yvy_id, datasets: estado.filas }, null, 2);
    try {
      await navigator.clipboard.writeText(txt);
      copiar.textContent = 'Copiado';
    } catch {
      window.prompt('Copiá este certificado:', txt);
    }
    track('report_copy', { yvy_id: obj.yvy_id, nivel: obj.nivel, formato: 'certificado' });
    setTimeout(() => { copiar.textContent = 'Copiar certificado'; }, 2000);
  });
  body.appendChild(copiar);

  function pintar() {
    if (!estado.total) return;
    if (estado.ok === estado.total) {
      badge.textContent = `✓ ${estado.total} verificado${estado.total === 1 ? '' : 's'}`;
      badge.classList.add('dossier-cert__badge--ok');
      badge.classList.remove('dossier-cert__badge--mal');
    } else {
      badge.textContent = `⚠ ${estado.ok}/${estado.total} verificados`;
      badge.classList.add('dossier-cert__badge--mal');
      badge.classList.remove('dossier-cert__badge--ok');
    }
    copiar.hidden = false;
  }

  async function registrar(ag) {
    if (!ag || !ag.certificado) return;
    if (token !== renderToken) return;
    const f = fuenteHumana(ag.fuente);
    const fila = document.createElement('div');
    fila.className = 'dossier-cert__fila';

    const nombre = document.createElement('span');
    nombre.className = 'dossier-cert__nombre';
    nombre.textContent = f.corto;
    fila.appendChild(nombre);

    const hashes = document.createElement('span');
    hashes.className = 'dossier-cert__hash';
    hashes.textContent = `${String(ag.certificado.hash_entidad).slice(0, 12)}… · ${String(ag.certificado.hash_linaje).slice(0, 12)}…`;
    hashes.title = `hash_entidad ${ag.certificado.hash_entidad}\nhash_linaje ${ag.certificado.hash_linaje}`;
    fila.appendChild(hashes);

    const marca = document.createElement('span');
    marca.className = 'dossier-cert__estado';
    fila.appendChild(marca);
    lista.appendChild(fila);

    estado.total += 1;
    const [he, hl] = await Promise.all([
      hashCanonico(payloadEntidad(ag)),
      hashCanonico(linajeDelCliente(obj)),
    ]);
    if (token !== renderToken) return;
    const cierra = he === ag.certificado.hash_entidad && hl === ag.certificado.hash_linaje;
    marca.textContent = cierra ? '✓' : '⚠';
    marca.title = cierra
      ? 'Recalculado en el navegador: coincide con el publicado'
      : `No coincide. Publicado ${ag.certificado.hash_entidad} · recalculado ${he}`;
    marca.classList.add(cierra ? 'dossier-cert__estado--ok' : 'dossier-cert__estado--mal');
    if (cierra) estado.ok += 1;
    estado.filas.push({
      dataset: ag.tipo,
      fuente: ag.fuente ?? null,
      fecha: ag.fecha_vigencia ?? null,
      hash_entidad: ag.certificado.hash_entidad,
      hash_linaje: ag.certificado.hash_linaje,
      verificado: cierra,
    });
    pintar();
  }

  // Sin ningún dataset con certificado: el bloque no existe (no se grita).
  const cerrarSiVacio = () => {
    if (!estado.total && wrap.isConnected) wrap.remove();
  };

  if (contenedor) contenedor.appendChild(wrap);
  return { el: wrap, registrar, cerrarSiVacio };
}

function bloqueCopiar(obj, estadoAg, extras, refsEl) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'dossier-copy';
  b.textContent = 'Copiar dossier';
  b.addEventListener('click', async () => {
    // Lee el estado AL CLICKEAR: refleja lo visible (los agregados
    // async llenan el estado cuando resuelven, nunca después del clic).
    // Las referencias también se leen del DOM: el censo y los datasets
    // se agregan tarde y el MD tiene que salir con TODAS las fuentes.
    const refsDom = refsEl
      ? [...refsEl.querySelectorAll('.dossier-ref__item')]
        .map((el) => el.textContent.trim())
        .filter((t) => t && t !== 'Sin fuentes registradas')
      : [];
    const extrasVivos = refsDom.length
      ? { ...extras, refs: refsDom.map((nombre) => ({ nombre })) }
      : extras;
    const txt = textoDossier(obj, estadoAg && estadoAg.m, extrasVivos);
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
  // Micro-copy humana: "23 departamentos" / "23 departamentos · 64 municipios".
  const partes = [];
  for (const g of grupos) partes.push(`${g.items.length} ${ETIQUETA_HIJO[g.nivel][1]}`);
  for (const g of extras) partes.push(`${g.items.length} ${ETIQUETA_HIJO[g.nivel][1]}`);
  const conteoTexto = partes.join(' · ');
  const { wrap, body } = crearSeccion('Contiene', conteoTexto, false); // cerrado: la invitación silenciosa
  wrap.dataset.grupo = 'contiene'; // destino del clic en nodo grupo "+ N más"
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
    // Micro-copy humana: "6 provincias" / "1 provincia · 2 departamentos".
    const porNivel = new Map();
    for (const v of vecinos) porNivel.set(v.nivel, (porNivel.get(v.nivel) || 0) + 1);
    const conteo = [...porNivel.entries()]
      .map(([n, c]) => `${c} ${(ETIQUETA_HIJO[n] || [null, `${n}s`])[1]}`)
      .join(' · ');
    const { wrap, body } = crearSeccion(titulo, conteo, false); // plegado
    wrap.dataset.grupo = tipo === 'lindero' ? 'limita' : 'cerca'; // destino del nodo grupo
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

// --------------------------------------------------------------
// SKELETON — pulso mientras getAgregado resuelve (fetch lazy).
// -----------------------
function bloquePulso(claseExtra) {
  const b = document.createElement('div');
  b.className = `skeleton-bloque${claseExtra ? ` ${claseExtra}` : ''}`;
  return b;
}

/** N bloques grises que pulsan (el reemplazo del panel vacío). */
function bloqueSkeleton(n) {
  const g = document.createElement('div');
  g.className = 'dossier-grupo-skeleton';
  for (let i = 0; i < n; i++) g.appendChild(bloquePulso());
  return g;
}

/** Hero en esqueleto: pulso donde va el número; etiqueta fija y honesta. */
function bloqueHeroSkeleton() {
  const hero = document.createElement('div');
  hero.className = 'dossier-hero dossier-hero--cargando';
  hero.appendChild(bloquePulso('skeleton-bloque--num'));
  const lab = document.createElement('div');
  lab.className = 'dossier-hero-label';
  lab.textContent = 'Habitantes';
  hero.appendChild(lab);
  return hero;
}

// Badge [Oficial]: la fuente viene del catálogo (verificable). La
// fecha SOLO se muestra si el manifest la declara (fecha_vigencia);
// sin fecha, el badge queda corto y no se inventa "Actualizado".
function badgeOficial(dsMeta) {
  const b = document.createElement('span');
  b.className = 'dossier-acc__badge';
  const fecha = dsMeta && dsMeta.fecha_vigencia ? String(dsMeta.fecha_vigencia).trim() : null;
  b.textContent = fecha ? `Oficial · ${fecha}` : 'Oficial';
  b.title = fecha ? 'Fuente oficial · vigencia declarada en el catálogo' : 'Fuente oficial (sin fecha declarada en el catálogo)';
  return b;
}

// Acordeón de dataset en carga: se pinta al toque con pulso, se llena
// cuando responde (o se elimina en 404 = sin datos, nunca se grita).
function seccionDatasetSkeleton(ds) {
  const titulo = TITULO_DATASET[ds.tipo] || ds.tipo;
  const f = fuenteHumana(ds.fuente);
  const { wrap, body, head } = crearSeccion(titulo, null, false);
  wrap.dataset.tipo = ds.tipo; // acceso directo start screen (enfocarDataset)
  const headT = wrap.querySelector('.dossier-acc__titulo');
  if (headT) headT.textContent = `${titulo} · ${f.corto}`;
  head.appendChild(badgeOficial(ds));
  body.appendChild(bloqueSkeleton(3));
  return wrap;
}

// Acordeón de un dataset con su agregado ya resuelto (o null si 404).
function seccionDataset(ds, ag) {
  const titulo = TITULO_DATASET[ds.tipo] || ds.tipo;
  const f = fuenteHumana(ag && ag.fuente ? ag.fuente : ds.fuente);
  // dct:source visible en el header (nunca solo en el cuerpo).
  const { wrap, body, head } = crearSeccion(titulo, null, false);
  wrap.dataset.tipo = ds.tipo; // acceso directo start screen (enfocarDataset)
  const headT = wrap.querySelector('.dossier-acc__titulo');
  headT.textContent = `${titulo} · ${f.corto}`;
  head.appendChild(badgeOficial(ds));

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
      if (v == null) continue; // missing: el bloque no existe (no es un 0)
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
  fl.title = titleFuente(f);
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
// Clic en un nodo → navegar. Sin JSON-LD en la UI (decisión producto:
// el dato crudo vive en data/manifest.jsonld + context.jsonld, servido
// para consumo programático, no para personas).
// --------------------------------------------------------------

/**
 * Bloque del grafo: SIEMPRE visible (bloque compacto de 220px, sin
 * acordeón). Se re-monta en cada render (el nodo central es nuevo) con
 * selección humanizada: central + padre + primeros 6 relacionados +
 * grupo "+ N más" cuyo clic abre el acordeón correspondiente.
 */
function bloqueGrafo(obj, navegar) {
  const wrap = document.createElement('div');
  wrap.className = 'dossier-grafo-bloque';
  const cont = document.createElement('div');
  cont.className = 'dossier-grafo';
  const montar = () => {
    const ancho = Math.max(360, cont.clientWidth || 460);
    import('./grafo.js')
      .then((m) => m.crearGrafoRelaciones(obj, { navegar, abreGrupo: abrirGrupoAcordeon, ancho }))
      .then((el) => { cont.appendChild(el); })
      .catch((e) => {
        cont.hidden = true;
        console.warn('[yvy] grafo no montado:', e?.message);
      });
  };
  // Monta al toque con ancho estimado; el ResizeObserver del SVG corrige
  // el viewBox con el ancho real del panel (clamp 500–650px).
  montar();
  wrap.appendChild(cont);
  return wrap;
}

/**
 * Clic en nodo grupo ("+ N más" / "+ M vecinos"): abre el acordeón
 * correspondiente y lo resalta + scrollea (misma mecánica que el foco
 * del start screen, determinista).
 */
function abrirGrupoAcordeon(grupo) {
  const cont = contenedorFicha();
  if (!cont) return;
  const sec = cont.querySelector(`.dossier-acc[data-grupo="${grupo}"]`)
    || (grupo === 'limita' ? cont.querySelector('.dossier-acc[data-grupo="cerca"]') : null);
  if (!sec) return;
  const head = sec.querySelector('.dossier-acc__head');
  if (head && head.getAttribute('aria-expanded') !== 'true') head.click();
  sec.classList.add('dossier-acc--foco');
  head.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
  contenedor.classList.add('dossier--report');
  const token = ++renderToken;
  contenedor.innerHTML = '';

  if (!obj) {
    contenedor.innerHTML = '<div class="objeto-empty-state"><p>Sin jurisdicción seleccionada.</p></div>';
    return;
  }

  const bc = breadcrumbNodo(obj);
  if (bc) contenedor.appendChild(bc); // el país no lleva breadcrumb
  contenedor.appendChild(bloqueHeader(obj));

  // Pinta YA lo estructural con skeleton donde hay datos lazy y, al
  // resolver cada agregado, llena su lugar: tiempo percibido mínimo,
  // y el token descarta respuestas de un objeto que ya no está activo.
  const ds = Object.fromEntries(getDatasets().map((d) => [d.tipo, d]));
  const limita = fraseLimita(obj);

  // Estado mutable que lee "Copiar dossier" AL CLICKEAR (refleja lo
  // visible) y extras para síntesis, copia y referencias (nada inventado).
  const estadoAg = { m: null };
  const extras = { contiene: null, limita: limita, limitaNombres: null, refs: [], datasetLineas: [] };
  if (obj.sup_oficial_km2 != null) extras.refs.push({ nombre: obj.sup_fuente ? `Superficie (${obj.sup_fuente})` : 'Superficie' });

  // Hero + grid: pulso mientras responde el censo (fetch lazy).
  const heroEl = bloqueHeroSkeleton();
  const gridSkeleton = bloqueSkeleton(3);
  contenedor.appendChild(heroEl);
  contenedor.appendChild(gridSkeleton);
  contenedor.appendChild(bloqueModelo(obj));

  // La síntesis ya no depende del censo: habla del lugar del nodo en
  // el grafo (padre, contiene, vecinos) aunque falte el dato demográfico.
  contenedor.appendChild(bloqueSintesis(obj, null, limita));

  // El mini-grafo y los acordeones sueltos del visor viejo se fueron:
  // las relaciones se ven en el drawer (Linaje) y en la Ficha del modelo.
  const cont = null;  // se conserva el cálculo de extras para síntesis/copia
  if (cont) {
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

  // ---- Vecinos (lindero / cerca de): se reportan en síntesis y Linaje ----
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

  // ---- Agregados (catastro / minería): skeleton al toque, fill async ----
  // En provincia solo si existe agregado rollup; en depto según catálogo.
  // provincia: el rollup puede existir aunque el nivel no lo declare.
  let focoHecho = false;
  const foco = focoDatasetPendiente;
  focoDatasetPendiente = null;

  // Foco pos-navegación del start screen ("Minería en Salta"): se aplica
  // solo cuando el acordeón tiene datos reales (nunca sobre el skeleton,
  // que se rebota al llenarse). Si 404 lo eliminó, no hay foco (como hoy).
  const aplicarFoco = () => {
    if (!foco || focoHecho) return;
    const s = contenedor.querySelector(`.dossier-acc[data-tipo="${foco}"]`);
    if (!s || s.querySelector('.skeleton-bloque')) return;
    const head = s.querySelector('.dossier-acc__head');
    if (head) head.click();
    s.classList.add('dossier-acc--foco');
    s.scrollIntoView({ block: 'start', behavior: 'smooth' });
    focoHecho = true;
  };

  for (const tipoD of ['catastro', 'mineria']) {
    const dsMeta = ds[tipoD];
    if (!dsMeta) continue;
    const aplicableNivel = (dsMeta.niveles || []).includes(obj.nivel);
    if (!aplicableNivel && obj.nivel !== 'provincia') continue;
    contenedor.appendChild(seccionDatasetSkeleton(dsMeta));
  }

  const refsEl = bloqueReferencias(extras.refs);
  contenedor.appendChild(refsEl);
  // Pie: acción primaria (copiar) + invitación silenciosa a las fuentes.
  contenedor.appendChild(bloqueCopiarFooter(refsEl, obj, estadoAg, extras));

  // Certificado: se crea colapsado y se verifica solo a medida que los
  // agregados resuelven. Si ninguno trae certificado, se elimina.
  const cert = bloqueCertificado(obj, token, contenedor);

  // ---- Resolución async por agregado (token guarda contra cambio de activo) ----

  // Demografía → hero y grid reales + primera referencia (al frente).
  getAgregado('demografia', obj.yvy_id).then((ag) => {
    if (token !== renderToken) return;
    if (ag && ag.metricas) {
      estadoAg.m = ag.metricas;
      const m = ag.metricas;
      heroEl.replaceWith(bloqueHero(m, densidad(obj, Number(m.poblacion))));
      gridSkeleton.replaceWith(bloqueGrid(obj, m));
      if (ag.fuente) insertarRefItem(refsEl, fuenteHumana(ag.fuente));
    } else {
      // Censo sin datos: el pulso sale y la huella honesta queda.
      heroEl.replaceWith(bloqueHero(null, null));
      gridSkeleton.replaceWith(bloqueGrid(obj, null));
    }
    cert.registrar(ag).catch(() => {});
    cert.cerrarSiVacio();
  });

  // Datasets → el skeleton se llena con el acordeón real (o se elimina).
  for (const tipoD of ['catastro', 'mineria']) {
    const dsMeta = ds[tipoD];
    if (!dsMeta) continue;
    const aplicableNivel = (dsMeta.niveles || []).includes(obj.nivel);
    if (!aplicableNivel && obj.nivel !== 'provincia') continue;
    getAgregado(tipoD, obj.yvy_id).then((ag) => {
      if (token !== renderToken) return;
      const sk = contenedor.querySelector(`.dossier-acc[data-tipo="${tipoD}"]`);
      if (!ag) {
        if (sk) sk.remove(); // 404: sin datos, no se muestra (no se grita)
        return;
      }
      const real = seccionDataset(dsMeta, ag);
      if (sk && real) sk.replaceWith(real);
      else if (real) contenedor.appendChild(real);
      const f = fuenteHumana(ag.fuente || dsMeta.fuente);
      agregarRefItem(refsEl, { nombre: `${TITULO_DATASET[tipoD]}: ${f.nombre}` });
      const mA = ag.metricas || {};
      if (tipoD === 'catastro' && Number(mA.total_parcelas)) {
        extras.datasetLineas.push(`CATASTRO: ${fmtInt.format(Number(mA.total_parcelas))} parcelas${fmtHa(mA.area_total_ha) ? ` (${fmtHa(mA.area_total_ha)})` : ''}`);
      }
      if (tipoD === 'mineria' && Number(mA.total_concesiones)) {
        extras.datasetLineas.push(`MINERÍA: ${fmtInt.format(Number(mA.total_concesiones))} concesiones${fmtHa(mA.area_total_ha) ? ` (${fmtHa(mA.area_total_ha)})` : ''}`);
      }
      cert.registrar(ag).catch(() => {});
      aplicarFoco();
    });
  }
}
