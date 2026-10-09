import {
  getObjeto,
  getPadre,
  getHijos,
  setObjetoActivo,
  navegarA,
  formatKM2,
  etiquetaNivel,
  getDatasets,
  getAgregado,
} from './manifest.js';
import { abrirPanelObjeto } from './ui.js';
import { track } from './telemetry.js';

const fmtInt = new Intl.NumberFormat('es-AR');
const fmtKm1 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function prop(obj, key) {
  if (obj[key] != null && obj[key] !== '') return obj[key];
  const lo = key.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === lo) {
      const v = obj[k];
      if (v != null && v !== '') return v;
    }
  }
  return null;
}

function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
  if (Number.isFinite(n)) return n;
  const m = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(m) ? m : null;
}

function fmtEntero(v) {
  const n = toNum(v);
  if (n == null) return null;
  return fmtInt.format(Math.round(n));
}

function fmtKm(v) {
  const n = toNum(v);
  if (n == null) return null;
  return `${fmtKm1.format(n)} km`;
}

function metrica(valor, label, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = opts.small ? 'objeto-metrica objeto-metrica--sm' : 'objeto-metrica';
  const numEl = document.createElement('div');
  numEl.className = opts.accent ? 'objeto-metrica__num objeto-metrica__num--accent' : 'objeto-metrica__num';
  numEl.textContent = valor;
  wrap.appendChild(numEl);
  const lbl = document.createElement('div');
  lbl.className = 'objeto-metrica__label';
  lbl.textContent = label;
  wrap.appendChild(lbl);
  return wrap;
}

function setModoInspect(obj) {
  const headInspect = document.getElementById('explorer-head-inspect');
  const detalle = document.getElementById('explorer-detalle');
  const idEl = document.getElementById('explorer-inspect-id');
  if (headInspect) headInspect.hidden = false;
  if (detalle) detalle.hidden = false;
  if (idEl && obj) idEl.textContent = `${obj.nombre_oficial} · yvy:${obj.yvy_id}`;
}

/**
 * Muestra el estado missing en la ficha (nunca silencio, nunca genérico).
 */
export function mostrarEstadoFalta(yvyId) {
  const detalle = document.getElementById('explorer-detalle');
  if (detalle) detalle.hidden = false;
  const idEl = document.getElementById('explorer-inspect-id');
  if (idEl) idEl.textContent = `yvy:${yvyId}`;
  const contenedor = document.getElementById('objeto-info');
  if (contenedor) {
    contenedor.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'objeto-empty-state';
    const p = document.createElement('p');
    p.textContent = 'No tengo ese dato todavía';
    d.appendChild(p);
    contenedor.appendChild(d);
  }
  const headInspect = document.getElementById('explorer-head-inspect');
  if (headInspect) headInspect.hidden = false;
  abrirPanelObjeto();
}

export function mostrarObjeto(yvyId) {
  const obj = getObjeto(yvyId);
  if (!obj) {
    mostrarEstadoFalta(yvyId);
    return;
  }
  setObjetoActivo(obj);
  renderFicha(obj);
  setModoInspect(obj);
  abrirPanelObjeto();
}

export function limpiarFicha() {
  const detalle = document.getElementById('explorer-detalle');
  if (detalle) detalle.hidden = true;
  const contenedor = document.getElementById('objeto-info');
  if (!contenedor) return;
  contenedor.innerHTML = `
    <div class="objeto-empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z" stroke-linejoin="round"/><circle cx="12" cy="9" r="2.5"/></svg>
      <p>Sin objeto seleccionado.</p>
    </div>`;
}

function renderFicha(obj) {
  const detalle = document.getElementById('explorer-detalle');
  if (detalle) detalle.hidden = false;
  const contenedor = document.getElementById('objeto-info');
  if (!contenedor) return;
  contenedor.innerHTML = '';

  const identidad = document.createElement('div');
  identidad.className = 'objeto-identidad';
  const filaTitulo = document.createElement('div');
  filaTitulo.className = 'objeto-titulo';
  const nombre = document.createElement('h3');
  nombre.className = 'objeto-nombre';
  nombre.textContent = obj.nombre_oficial;
  filaTitulo.appendChild(nombre);
  const badge = document.createElement('span');
  badge.className = 'objeto-badge';
  badge.textContent = etiquetaNivel(obj.nivel).toUpperCase();
  filaTitulo.appendChild(badge);
  identidad.appendChild(filaTitulo);
  const subtitle = document.createElement('div');
  subtitle.className = 'objeto-subtitle';
  const nivelLabel = etiquetaNivel(obj.nivel);
  const extras = [];
  if (obj.cod_indec) extras.push(`Código INDEC ${obj.cod_indec}`);
  if (obj.clase_municipio) extras.push(obj.clase_municipio);
  if (obj.clase_barrio) extras.push(obj.clase_barrio);
  const supLabel = obj.sup_oficial_km2 != null ? formatKM2(obj.sup_oficial_km2) : 'Sin dato oficial todavía';
  subtitle.textContent = [nivelLabel, ...extras, supLabel].join(' · ');
  identidad.appendChild(subtitle);
  const fuenteTexto = obj.sup_fuente_corta || obj.sup_fuente;
  if (fuenteTexto || obj.sup_fuente_url) {
    const fuente = document.createElement('div');
    fuente.className = 'objeto-fuente';
    if (obj.sup_fuente_url) {
      const a = document.createElement('a');
      a.href = obj.sup_fuente_url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = fuenteTexto || obj.sup_fuente_url;
      fuente.appendChild(a);
    } else {
      fuente.textContent = fuenteTexto;
    }
    identidad.appendChild(fuente);
  }
  contenedor.appendChild(identidad);

  const poblacion = prop(obj, 'población') ?? prop(obj, 'poblacion');
  const viviendas = prop(obj, 'viviendas');
  const vivParticulares = prop(obj, 'viviendas_particulares');
  const vivColectivas = prop(obj, 'viviendas_colectivas');
  const kmFfcc = prop(obj, 'km_ffcc_total');
  const metricas = [];

  const popFmt = fmtEntero(poblacion);
  if (popFmt) metricas.push(metrica(popFmt, 'POBLACI\u00D3N \u00B7 CENSO 2022'));

  const vivFmt = fmtEntero(viviendas);
  if (vivFmt) metricas.push(metrica(vivFmt, 'TOTAL DE VIVIENDAS'));

  // Viviendas particulares y colectivas: solo en municipios
  if (obj.nivel === 'municipio') {
    const vivPrtFmt = fmtEntero(vivParticulares);
    if (vivPrtFmt) metricas.push(metrica(vivPrtFmt, 'VIVIENDAS PARTICULARES', { small: true }));
    const vivColFmt = fmtEntero(vivColectivas);
    if (vivColFmt) metricas.push(metrica(vivColFmt, 'VIVIENDAS COLECTIVAS', { small: true }));
  }

  const ffccFmt = fmtKm(kmFfcc);
  // FFCC ocupa ancho completo en el grid con acento
  if (ffccFmt) {
    const m = metrica(ffccFmt, 'RED FERROVIARIA', { accent: true });
    m.classList.add('objeto-metrica--accent');
    metricas.push(m);
  }

  if (metricas.length > 0) {
    const grid = document.createElement('div');
    grid.className = 'objeto-metricas-grid';
    for (const m of metricas) grid.appendChild(m);
    contenedor.appendChild(grid);
  }

  // Datasets (Fase 3): una sección colapsada por tipo con vigencia.
  // El detalle se trae lazy por yvy_id; null/0 en colectivas/calle = "–".
  const datasets = getDatasets();
  for (const ds of datasets) {
    contenedor.appendChild(seccionDataset(obj, ds));
  }

  const ruta = [];
  let cur = obj;
  while (cur) {
    ruta.push(cur);
    cur = getPadre(cur);
  }
  if (ruta.length > 1) contenedor.appendChild(renderBreadcrumb(ruta.reverse()));

  const dep = seccionDependencias(obj);
  if (dep) contenedor.appendChild(dep);
  if (metricas.length === 0 && !dep && datasets.length === 0) {
    const vacio = document.createElement('div');
    vacio.className = 'objeto-empty-state';
    const p = document.createElement('p');
    p.textContent = 'Sin datos registrados todavía.';
    vacio.appendChild(p);
    contenedor.appendChild(vacio);
  }
  contenedor.appendChild(botonCopiar(obj));
}

const METRICA_LABEL = {
  poblacion: 'POBLACIÓN',
  viviendas: 'VIVIENDAS',
  viv_particulares: 'VIVIENDAS PARTICULARES',
  pob_particulares: 'POBLACIÓN EN VIVIENDAS PARTICULARES',
  viv_colectivas: 'VIVIENDAS COLECTIVAS',
  pob_colectivas: 'POBLACIÓN EN VIVIENDAS COLECTIVAS',
  pob_calle: 'POBLACIÓN EN SITUACIÓN DE CALLE',
};
// Métricas colapsadas (siempre visibles) y las que muestran "–" en 0 (no hay)
const METRICA_TOP = ['poblacion', 'viviendas'];
const METRICA_GUION_EN_CERO = new Set(['viv_colectivas', 'pob_colectivas', 'pob_calle']);

function etiquetaMetrica(key) {
  return METRICA_LABEL[key] || String(key).replace(/_/g, ' ').toUpperCase();
}

function valorMetrica(key, v) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return v == null || v === '' ? '–' : String(v);
  if (n === 0 && METRICA_GUION_EN_CERO.has(key)) return '–';
  return fmtInt.format(Math.round(n));
}

/** Sección colapsada por dataset: header con vigencia + detalle lazy por yvy_id. */
function seccionDataset(obj, ds) {
  const d = seccion(ds.tipo.toUpperCase());
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'objeto-dataset-btn';
  const vig = [ds.fuente, ds.fecha_vigencia].filter(Boolean).join(' · ');
  head.textContent = vig ? `${ds.tipo} · ${vig}` : ds.tipo;
  const body = document.createElement('div');
  body.className = 'objeto-dataset-body';
  body.hidden = true;
  let cargado = false;
  head.addEventListener('click', async () => {
    body.hidden = !body.hidden;
    head.setAttribute('aria-expanded', String(!body.hidden));
    if (body.hidden || cargado) return;
    cargado = true;
    const ag = await getAgregado(ds.tipo, obj.yvy_id);
    body.innerHTML = '';
    if (!ag || !ag.metricas) {
      const p = document.createElement('p');
      p.className = 'objeto-empty-state';
      p.textContent = 'Sin datos registrados todavía.';
      body.appendChild(p);
      return;
    }
    const keys = Object.keys(ag.metricas);
    const top = keys.filter((k) => METRICA_TOP.includes(k));
    const resto = keys.filter((k) => !METRICA_TOP.includes(k));
    const grid = document.createElement('div');
    grid.className = 'objeto-metricas-grid';
    for (const k of top) grid.appendChild(metrica(valorMetrica(k, ag.metricas[k]), etiquetaMetrica(k)));
    body.appendChild(grid);
    if (resto.length > 0) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'objeto-more-btn';
      btn.textContent = 'Ver todas las métricas →';
      const gridResto = document.createElement('div');
      gridResto.className = 'objeto-metricas-grid';
      gridResto.hidden = true;
      for (const k of resto) gridResto.appendChild(metrica(valorMetrica(k, ag.metricas[k]), etiquetaMetrica(k), { small: true }));
      btn.addEventListener('click', () => {
        gridResto.hidden = !gridResto.hidden;
        btn.textContent = gridResto.hidden ? 'Ver todas las métricas →' : 'Ver menos';
      });
      body.appendChild(btn);
      body.appendChild(gridResto);
    }
    const f = document.createElement('div');
    f.className = 'objeto-fuente';
    f.textContent = `Fuente: ${ag.fuente || 'pendiente'} · Vigencia: ${ag.fecha_vigencia || 'pendiente'}`;
    body.appendChild(f);
  });
  d.appendChild(head);
  d.appendChild(body);
  return d;
}

function renderBreadcrumb(ruta) {
  const bc = document.createElement('nav');
  bc.className = 'objeto-breadcrumb';
  bc.setAttribute('aria-label', 'Jerarquía');
  ruta.forEach((o, i) => {
    const ultimo = i === ruta.length - 1;
    const chip = document.createElement('span');
    if (ultimo) {
      chip.className = 'objeto-breadcrumb__final';
      chip.textContent = o.nombre_oficial;
    } else {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'objeto-breadcrumb__btn';
      b.textContent = o.nombre_oficial;
      b.title = `Ir a ${o.nombre_oficial}`;
      b.addEventListener('click', () => navegarA(o.yvy_id));
      chip.appendChild(b);
    }
    bc.appendChild(chip);
    if (!ultimo) {
      const sep = document.createElement('span');
      sep.className = 'objeto-breadcrumb__sep';
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = '›';
      bc.appendChild(sep);
    }
  });
  return bc;
}

function seccion(title) {
  const d = document.createElement('div');
  d.className = 'objeto-section';
  const t = document.createElement('h4');
  t.className = 'objeto-section__title';
  t.textContent = title;
  d.appendChild(t);
  return d;
}

function seccionDependencias(obj) {
  const hijos = getHijos(obj.yvy_id);
  if (hijos.length === 0) return null;
  const d = seccion(`Dependencias \u00B7 ${hijos.length}`);
  const LIMITE = 4;
  const visibles = hijos.slice(0, LIMITE);
  visibles.forEach((h) => d.appendChild(btnNavegar(etiquetaNivel(h.nivel), h.nombre_oficial, h.yvy_id)));
  if (hijos.length > LIMITE) {
    const more = document.createElement('div');
    more.className = 'objeto-more';
    more.textContent = `+ ${hijos.length - LIMITE} más — filtrá en el explorador`;
    d.appendChild(more);
  }
  return d;
}

function btnNavegar(tipo, nombre, yvyId) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'objeto-nav';
  const left = document.createElement('span');
  left.style.display = 'flex';
  left.style.flexDirection = 'column';
  left.style.minWidth = '0';
  const t = document.createElement('span');
  t.className = 'objeto-nav__tipo';
  t.textContent = tipo;
  const n = document.createElement('span');
  n.className = 'objeto-nav__nombre';
  n.textContent = nombre;
  left.appendChild(t);
  left.appendChild(n);
  b.appendChild(left);
  b.addEventListener('click', () => navegarA(yvyId));
  return b;
}

function textoResumen(obj) {
  const ruta = [];
  let cur = obj;
  while (cur) {
    ruta.push(cur.nombre_oficial);
    cur = getPadre(cur);
  }
  ruta.reverse();
  const sup = obj.sup_oficial_km2 != null ? formatKM2(obj.sup_oficial_km2) : 'Sin dato';
  const fuente = obj.sup_fuente_corta || obj.sup_fuente || 'Fuente pendiente';
  return `${obj.nombre_oficial} · ${ruta.join(' › ')} · yvy:${obj.yvy_id}
${etiquetaNivel(obj.nivel)} · ${sup}
Fuente: ${fuente}
Link: ${location.href}`;
}

function botonCopiar(obj) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'objeto-copy';
  b.textContent = 'Copiar resumen';
  b.addEventListener('click', async () => {
    const txt = textoResumen(obj);
    try {
      await navigator.clipboard.writeText(txt);
      b.textContent = 'Copiado';
    } catch {
      window.prompt('Copia este resumen:', txt);
    }
    track('report_copy', { yvy_id: obj.yvy_id, nivel: obj.nivel });
    setTimeout(() => { b.textContent = 'Copiar resumen'; }, 2000);
  });
  return b;
}

