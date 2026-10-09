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
const fmt1dec = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Token anti-carrera: si el usuario navega antes de que vuelva el fetch,
// la respuesta vieja no pinta.
let renderToken = 0;

// --------------------------------------------------------------
// Etiquetas humanas (nada con forma de código, nada de siglas)
// --------------------------------------------------------------
const TITULO_TIPO = {
  demografia: 'Demografía',
  mineria: 'Minería',
  catastro: 'Catastro',
  barrios: 'Barrios',
};

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

function tituloTipo(tipo) {
  return TITULO_TIPO[tipo] || (tipo ? tipo.charAt(0).toUpperCase() + tipo.slice(1) : 'Datos');
}

function plural(n, sing, plur) {
  return `${fmtInt.format(n)} ${n === 1 ? sing : plur}`;
}

function fmtHa(v) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return `${fmt1dec.format(Math.round(n * 10) / 10)} hectáreas`;
}

// --------------------------------------------------------------
// Estructura DOM mínima
// --------------------------------------------------------------
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
  if (idEl && obj) idEl.textContent = obj.nombre_oficial;
}

/**
 * Muestra el estado missing en la ficha (nunca silencio, nunca genérico).
 */
export function mostrarEstadoFalta() {
  const detalle = document.getElementById('explorer-detalle');
  if (detalle) detalle.hidden = false;
  const idEl = document.getElementById('explorer-inspect-id');
  if (idEl) idEl.textContent = 'Sin datos';
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
    mostrarEstadoFalta();
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

// --------------------------------------------------------------
// Reporte textual: plantilla fija, cambian jurisdicción + hijos + padres
// --------------------------------------------------------------
const ORDEN_HIJOS = ['provincia', 'depto', 'municipio', 'barrio'];

function gruposHijos(obj) {
  const grupos = [];
  for (const nivel of ORDEN_HIJOS) {
    const items = getHijos(obj.yvy_id).filter((h) => h.nivel === nivel);
    if (items.length > 0) grupos.push({ nivel, items });
  }
  return grupos;
}

function todosMunicipios(obj) {
  if (obj.nivel !== 'provincia') return [];
  const out = [];
  for (const d of getHijos(obj.yvy_id)) {
    if (d.nivel === 'depto') out.push(...getHijos(d.yvy_id).filter((m) => m.nivel === 'municipio'));
  }
  return out;
}

function frasePertenencia(obj) {
  const padre = getPadre(obj);
  if (obj.nivel === 'municipio' && padre && padre.nivel === 'depto') {
    const abuelo = getPadre(padre);
    return `Municipio del departamento ${padre.nombre_oficial}${abuelo ? `, ${abuelo.nombre_oficial}` : ''}.`;
  }
  if (obj.nivel === 'depto' && padre) return `Departamento de ${padre.nombre_oficial}.`;
  return null;
}

function fraseEstructura(obj) {
  if (obj.nivel === 'pais') {
    const n = getHijos(obj.yvy_id).length;
    return n > 0 ? `Se organiza en ${plural(n, 'provincia', 'provincias')}.` : null;
  }
  if (obj.nivel === 'provincia') {
    const deptos = getHijos(obj.yvy_id).filter((h) => h.nivel === 'depto');
    const munis = todosMunicipios(obj);
    if (deptos.length === 0 && munis.length === 0) return null;
    return `Se organiza en ${plural(deptos.length, 'departamento', 'departamentos')} y ${plural(munis.length, 'municipio', 'municipios')}.`;
  }
  if (obj.nivel === 'depto') {
    const munis = getHijos(obj.yvy_id).filter((h) => h.nivel === 'municipio');
    if (munis.length === 0) return 'Sin municipios registrados.';
    return `Tiene ${plural(munis.length, 'municipio', 'municipios')}.`;
  }
  if (obj.nivel === 'municipio') {
    const barrios = getHijos(obj.yvy_id).filter((h) => h.nivel === 'barrio');
    if (barrios.length === 0) return null;
    return `Tiene ${plural(barrios.length, 'barrio', 'barrios')}.`;
  }
  return null;
}

function fraseResto(m) {
  if (!m) return null;
  const partes = [];
  const col = Number(m.pob_colectivas) || 0;
  const calle = Number(m.pob_calle) || 0;
  if (col > 0) partes.push(`${fmtInt.format(col)} personas en viviendas colectivas`);
  if (calle > 0) partes.push(`${fmtInt.format(calle)} en situación de calle`);
  if (partes.length === 0) return null;
  return `Viven ${partes.join(' y ')}.`;
}

async function componerNarrativa(obj) {
  const aplicables = getDatasets().filter((ds) => (ds.niveles || []).includes(obj.nivel));
  const ags = {};
  await Promise.all(
    aplicables.map(async (ds) => {
      ags[ds.tipo] = await getAgregado(ds.tipo, obj.yvy_id);
    })
  );
  const frases = [];
  const refs = [];
  const demo = ags.demografia;
  if (demo && demo.metricas) {
    const m = demo.metricas;
    const pob = Number(m.poblacion) || 0;
    const viv = Number(m.viviendas) || 0;
    const f = fuenteHumana(demo.fuente);
    const vig = demo.fecha_vigencia ? ` · vigencia ${demo.fecha_vigencia}` : '';
    let s1;
    if (obj.nivel === 'pais') s1 = `${obj.nombre_oficial} tiene ${fmtInt.format(pob)} habitantes y ${fmtInt.format(viv)} viviendas.`;
    else if (obj.nivel === 'provincia') s1 = `La provincia de ${obj.nombre_oficial} tiene ${fmtInt.format(pob)} habitantes y ${fmtInt.format(viv)} viviendas.`;
    else if (obj.nivel === 'depto') s1 = `El departamento ${obj.nombre_oficial} tiene ${fmtInt.format(pob)} habitantes y ${fmtInt.format(viv)} viviendas.`;
    else if (/sin gobierno local/i.test(obj.nombre_oficial || '')) {
      const prov = getPadre(obj);
      s1 = `El área sin gobierno local${prov ? ` de ${prov.nombre_oficial}` : ''} tiene ${fmtInt.format(pob)} habitantes y ${fmtInt.format(viv)} viviendas.`;
    } else s1 = `El municipio de ${obj.nombre_oficial} tiene ${fmtInt.format(pob)} habitantes y ${fmtInt.format(viv)} viviendas.`;
    frases.push(`${s1} (${f.corto}${vig}).`);
    refs.push({ ...f, fecha: demo.fecha_vigencia });
    const resto = fraseResto(m);
    if (resto) frases.push(resto);
  } else if (aplicables.some((ds) => ds.tipo === 'demografia')) {
    if (/sin gobierno local/i.test(obj.nombre_oficial || '')) {
      const padre = getPadre(obj);
      frases.push(`Área sin gobierno local${padre ? ` de ${padre.nombre_oficial}` : ''}: todavía no hay datos censales registrados.`);
    } else if (obj.nivel === 'municipio' || obj.nivel === 'depto' || obj.nivel === 'provincia' || obj.nivel === 'pais') {
      frases.push('Todavía no hay datos censales registrados.');
    }
  }
  if (obj.nivel === 'barrio') {
    const padre = getPadre(obj);
    const clase = obj.clase_barrio ? String(obj.clase_barrio).toLowerCase() : 'barrio';
    frases.push(padre ? `Es un ${clase} de ${padre.nombre_oficial}.` : `Es un ${clase}.`);
  }
  const est = fraseEstructura(obj);
  if (est) frases.push(est);
  const min = ags.mineria;
  if (min && min.metricas && Number(min.metricas.total_concesiones) > 0) {
    const area = fmtHa(min.metricas.area_total_ha);
    frases.push(`La minería registra ${plural(Number(min.metricas.total_concesiones), 'concesión', 'concesiones')}${area ? ` en ${area}` : ''}.`);
    refs.push({ ...fuenteHumana(min.fuente), fecha: min.fecha_vigencia });
  }
  const cat = ags.catastro;
  if (cat && cat.metricas && Number(cat.metricas.total_parcelas) > 0) {
    const area = fmtHa(cat.metricas.area_total_ha);
    frases.push(`El catastro registra ${plural(Number(cat.metricas.total_parcelas), 'parcela', 'parcelas')}${area ? ` (${area})` : ''}.`);
    refs.push({ ...fuenteHumana(cat.fuente), fecha: cat.fecha_vigencia });
  }
  return { frases, refs, ags };
}

function renderFicha(obj) {
  const token = ++renderToken;
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
  const pert = frasePertenencia(obj);
  const sup = obj.sup_oficial_km2 != null ? formatKM2(obj.sup_oficial_km2) : null;
  if (pert || sup) {
    const subtitle = document.createElement('div');
    subtitle.className = 'objeto-subtitle';
    subtitle.textContent = [pert, sup].filter(Boolean).join(' ');
    identidad.appendChild(subtitle);
  }
  contenedor.appendChild(identidad);

  const narrativa = document.createElement('div');
  narrativa.className = 'objeto-narrativa';
  const sk = document.createElement('p');
  sk.className = 'skeleton';
  sk.textContent = 'Cargando datos…';
  narrativa.appendChild(sk);
  contenedor.appendChild(narrativa);

  renderBreadcrumbInline(contenedor, obj);
  renderHijos(contenedor, obj, null);
  renderDatasetsAplicables(contenedor, obj);

  componerNarrativa(obj).then(({ frases, refs }) => {
    if (token !== renderToken) return;
    narrativa.innerHTML = '';
    for (const f of frases) {
      const p = document.createElement('p');
      p.textContent = f;
      narrativa.appendChild(p);
    }
    if (refs.length > 0) {
      const r = document.createElement('div');
      r.className = 'objeto-referencias';
      const lab = document.createElement('span');
      lab.className = 'objeto-referencias__label';
      lab.textContent = 'Referencias · ';
      r.appendChild(lab);
      refs.forEach((ref, i) => {
        if (i > 0) {
          const sep = document.createElement('span');
          sep.textContent = ' · ';
          r.appendChild(sep);
        }
        if (ref.url) {
          const a = document.createElement('a');
          a.href = ref.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = ref.nombre;
          r.appendChild(a);
        } else {
          const s = document.createElement('span');
          s.textContent = ref.nombre;
          r.appendChild(s);
        }
        if (ref.fecha) {
          const v = document.createElement('span');
          v.textContent = ` (vigencia ${ref.fecha})`;
          r.appendChild(v);
        }
      });
      contenedor.appendChild(r);
    }
    obj._narrativa = frases;
    obj._refs = refs;
    contenedor.appendChild(botonCopiar(obj));
  });
}

const LIMITE_HIJOS = 8;

function renderHijos(contenedor, obj, filtroNivel) {
  const grupos = gruposHijos(obj);
  let extras = [];
  if (!filtroNivel && obj.nivel === 'provincia') {
    const munis = todosMunicipios(obj);
    if (munis.length > 0) extras.push({ nivel: 'municipio', items: munis, titulo: `Municipios · ${munis.length}` });
  }
  const lista = filtroNivel ? grupos.filter((g) => g.nivel === filtroNivel) : grupos;
  for (const g of lista) {
    contenedor.appendChild(seccionHijos(obj, g.nivel, g.items, g.titulo));
  }
  for (const g of extras) {
    if (filtroNivel && g.nivel !== filtroNivel) continue;
    contenedor.appendChild(seccionHijos(obj, g.nivel, g.items, g.titulo));
  }
}

function etiquetaPlural(nivel, n) {
  const base = { provincia: 'Provincias', depto: 'Departamentos', municipio: 'Municipios', barrio: 'Barrios' }[nivel] || nivel;
  return `${base} · ${n}`;
}

function seccionHijos(obj, nivel, items, tituloForzado) {
  const d = seccion(tituloForzado || etiquetaPlural(nivel, items.length));
  const visibles = items.slice(0, LIMITE_HIJOS);
  for (const h of visibles) d.appendChild(btnNavegar(null, h.nombre_oficial, h.yvy_id));
  if (items.length > LIMITE_HIJOS) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'objeto-more-btn';
    more.textContent = `Ver los ${items.length} →`;
    more.addEventListener('click', () => renderDetalleHijos(obj, nivel, items, tituloForzado));
    d.appendChild(more);
  }
  return d;
}

function renderDetalleHijos(obj, nivel, items, tituloForzado) {
  renderToken++;
  const contenedor = document.getElementById('objeto-info');
  if (!contenedor) return;
  contenedor.innerHTML = '';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'objeto-volver';
  back.textContent = `← ${obj.nombre_oficial}`;
  back.addEventListener('click', () => renderFicha(obj));
  contenedor.appendChild(back);
  const d = seccion(tituloForzado || etiquetaPlural(nivel, items.length));
  for (const h of items) d.appendChild(btnNavegar(null, h.nombre_oficial, h.yvy_id));
  contenedor.appendChild(d);
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

// Breadcrumb inline (el del topbar se oculta en móvil).
function renderBreadcrumbInline(contenedor, obj) {
  const ruta = [];
  let cur = obj;
  while (cur) {
    ruta.push(cur);
    cur = getPadre(cur);
  }
  if (ruta.length > 1) contenedor.appendChild(renderBreadcrumb(ruta.reverse()));
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

function btnNavegar(tipo, nombre, yvyId) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'objeto-nav';
  const left = document.createElement('span');
  left.style.display = 'flex';
  left.style.flexDirection = 'column';
  left.style.minWidth = '0';
  if (tipo) {
    const t = document.createElement('span');
    t.className = 'objeto-nav__tipo';
    t.textContent = tipo;
    left.appendChild(t);
  }
  const n = document.createElement('span');
  n.className = 'objeto-nav__nombre';
  n.textContent = nombre;
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
  const líneas = [`${obj.nombre_oficial} · ${etiquetaNivel(obj.nivel)}`];
  for (const f of obj._narrativa || []) líneas.push(f);
  líneas.push(ruta.join(' › '));
  const refs = (obj._refs || []).map((r) => `${r.nombre}${r.fecha ? ` (vigencia ${r.fecha})` : ''}`);
  if (refs.length > 0) líneas.push(`Referencias: ${refs.join(' · ')}`);
  líneas.push(location.href);
  return líneas.join('\n');
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
  const d = seccion(tituloTipo(ds.tipo));
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'objeto-dataset-btn';
  const f = fuenteHumana(ds.fuente);
  const vig = [f.corto, ds.fecha_vigencia].filter(Boolean).join(' · ');
  head.textContent = vig ? `${tituloTipo(ds.tipo)} · ${vig}` : tituloTipo(ds.tipo);
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
    const foot = document.createElement('div');
    foot.className = 'objeto-fuente';
    const af = fuenteHumana(ag.fuente);
    foot.textContent = '';
    const fl = document.createElement('span');
    fl.textContent = `Fuente: ${af.nombre}${ag.fecha_vigencia ? ` · Vigencia: ${ag.fecha_vigencia}` : ''}`;
    foot.appendChild(fl);
    if (af.url) {
      const sp = document.createElement('span');
      sp.textContent = ' · ';
      foot.appendChild(sp);
      const a = document.createElement('a');
      a.href = af.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'sitio oficial';
      foot.appendChild(a);
    }
    body.appendChild(foot);
  });
  d.appendChild(head);
  d.appendChild(body);
  return d;
}

// Detalle por dataset (acordeones): solo donde el tipo aplica al nivel.
function renderDatasetsAplicables(contenedor, obj) {
  const aplicables = getDatasets().filter((ds) => (ds.niveles || []).includes(obj.nivel));
  for (const ds of aplicables) {
    contenedor.appendChild(seccionDataset(obj, ds));
  }
  return aplicables.length;
}

export { renderDatasetsAplicables };
