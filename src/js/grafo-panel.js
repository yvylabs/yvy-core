// ==============================================================
// grafo-panel.js — PANEL GRAFO (R2): la lente por defecto.
// SVG propio con proyección equirectangular: los nodos NO son un
// layout de fuerza, son posiciones reales (capital_centro en nivel
// país, centro_etiqueta en los drills) → la silueta ES el grafo.
// - Vista país: 24 provincias + linderos reales (pares únicos).
// - Salta "viva": halo pulsante esmeralda + chip DATOS CARGADOS
//   (CSS, respeta prefers-reduced-motion).
// - Drill: provincia → departamentos → municipios, cada nodo con sus
//   relaciones (contiene + linderos + padre fantasma). Agrupación
//   "+ N más" (tope 12 visibles, clic expande: determinista).
// - Clic nodo → navegarA (dossier sync); clic fondo → sube un nivel;
//   breadcrumb Argentina › Salta › Anta.
// Zero-alucinación (SPEC §4): sin coordenada real no hay nodo; sin
// hijos no hay drill; el conteo "+ N más" es el resto real.
// ==============================================================

import { getObjeto, getObjetos, getHijos, getRelaciones, navegarA, etiquetaNivel } from './manifest.js';
import { track } from './telemetry.js';

const NS = 'http://www.w3.org/2000/svg';
const MAX_VISIBLE = 12; // nodos con etiqueta antes del grupo "+ N más"
const DEMO_ID = 1066; // Salta: nodo "vivo" (halo + chip)

let svg = null;
let gEnlaces = null;
let gNodos = null;
let gAccesorios = null;
let body = null;
let bc = null;
let vista = null; // { nivel: 'pais' } | { nivel: 'provincia'|'depto', id }
let expandidos = new Set(); // keys 'nivelPadre:id' con grupos "+N más" abiertos
let nodosById = new Map();

// --------------------------------------------------------------
// Carga de vistas
// --------------------------------------------------------------

/** Coordenada real del objeto: capital_centro > centro_etiqueta > centro. */
function coordsDe(obj) {
  if (Array.isArray(obj.capital_centro) && obj.capital_centro.length === 2) return [Number(obj.capital_centro[0]), Number(obj.capital_centro[1])];
  if (Array.isArray(obj.centro_etiqueta) && obj.centro_etiqueta.length === 2) return [Number(obj.centro_etiqueta[0]), Number(obj.centro_etiqueta[1])];
  if (Array.isArray(obj.centro) && obj.centro.length === 2) return [Number(obj.centro[0]), Number(obj.centro[1])];
  return null;
}

function datosNodo(obj, c, rol) {
  const n = nodosById.get(obj.yvy_id) || { id: obj.yvy_id };
  n.id = obj.yvy_id;
  n.nombre = obj.nombre_oficial;
  n.nivel = obj.nivel;
  n.lonlat = c;
  n.rol = rol; // 'central' | 'provincia' | 'depto' | 'municipio' | 'fantasma' | 'grupo'
  nodosById.set(n.id, n);
  return n;
}

/** Vista país: nodos provincia (capital_centro) + linderos únicos. */
function cargarVistaPais() {
  nodosById = new Map();
  const nodos = [];
  for (const o of getObjetos().filter((x) => x.nivel === 'provincia')) {
    const c = coordsDe(o);
    if (!c) continue; // missing explícito: sin coordenada no hay nodo
    nodos.push(datosNodo(o, c, 'provincia'));
  }
  const vistos = new Set();
  const enlaces = [];
  const enElGrafo = new Set(nodos.map((n) => n.id));
  for (const p of getObjetos().filter((x) => x.nivel === 'provincia')) {
    if (!enElGrafo.has(p.yvy_id)) continue;
    for (const r of getRelaciones(p.yvy_id)) {
      if (r.tipo !== 'lindero') continue;
      if (!enElGrafo.has(r.destino_yvy_id)) continue;
      const a = Math.min(p.yvy_id, r.destino_yvy_id);
      const b = Math.max(p.yvy_id, r.destino_yvy_id);
      const k = `${a}-${b}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      enlaces.push({ s: nodosById.get(p.yvy_id), t: nodosById.get(r.destino_yvy_id), tipo: 'lindero' });
    }
  }
  return { nodos, enlaces };
}

/** Vista ego de una jurisdicción: hijos @ centro + relaciones reales. */
function cargarEgo(id) {
  const centralObj = getObjeto(id);
  if (!centralObj) return cargarVistaPais();
  const c = coordsDe(centralObj);
  if (!c) return cargarVistaPais();
  nodosById = new Map();
  const central = datosNodo(centralObj, c, 'central');
  const nodos = [central];
  const enlaces = [];
  const hijos = getHijos(id) || [];

  const mostrarTodos = expandidos.has(`${centralObj.nivel}:${id}`);
  const visibles = mostrarTodos ? hijos : hijos.slice(0, MAX_VISIBLE);
  const porId = new Map();
  for (const h of visibles) {
    const ch = coordsDe(h);
    if (!ch) continue;
    const nodo = datosNodo(h, ch, h.nivel);
    nodos.push(nodo);
    porId.set(h.yvy_id, nodo);
    enlaces.push({ s: central, t: nodo, tipo: 'contiene' });
  }
  // Relaciones reales ENTRE hijos (linderos hermano-hermano, par único)
  const vistos = new Set();
  for (const h of visibles) {
    if (!porId.has(h.yvy_id)) continue;
    for (const r of getRelaciones(h.yvy_id)) {
      if (r.tipo !== 'lindero') continue;
      const vecinoNodo = porId.get(r.destino_yvy_id);
      if (!vecinoNodo) continue;
      const a = Math.min(h.yvy_id, r.destino_yvy_id);
      const b = Math.max(h.yvy_id, r.destino_yvy_id);
      const k = `${a}-${b}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      enlaces.push({ s: porId.get(h.yvy_id), t: vecinoNodo, tipo: 'lindero' });
    }
  }
  // Grupo "+ N más": centroide de los hijos ocultos, pseudo-nodo clicable
  const ocultos = hijos.slice(visibles.length);
  if (ocultos.length > 0) {
    const conCoord = ocultos.map((h) => coordsDe(h)).filter(Boolean);
    const pos = conCoord.length > 0
      ? [conCoord.reduce((s, p) => s + p[0], 0) / conCoord.length, conCoord.reduce((s, p) => s + p[1], 0) / conCoord.length]
      : c;
    const grupo = { id: `grupo:${id}`, nombre: `+${ocultos.length} más`, nivel: 'grupo', lonlat: pos, rol: 'grupo', ver: `${centralObj.nivel}:${id}` };
    nodos.push(grupo);
    enlaces.push({ s: central, t: grupo, tipo: 'contiene' });
  }
  // Contexto fantasma: el padre (nube leve, clicable → sube nivel).
  // Solo para depto (padre = provincia): en vista provincia el padre es
  // el país (yvy 0) que ya vive en el breadcrumb y el clic-fondo.
  if (centralObj.nivel === 'depto' && centralObj.parent_yvy_id != null) {
    const padreObj = getObjeto(centralObj.parent_yvy_id);
    if (padreObj) {
      const pc = coordsDe(padreObj);
      if (pc) {
        const fantasma = datosNodo(padreObj, pc, 'fantasma');
        nodos.unshift(fantasma);
        enlaces.push({ s: fantasma, t: central, tipo: 'broader' });
      }
    }
  }
  return { nodos, enlaces, central };
}

// --------------------------------------------------------------
// Proyección + pintura
// --------------------------------------------------------------

function proyectador(puntos, w, h) {
  const visibles = puntos.filter((p) => p && isFinite(p[0]) && isFinite(p[1]));
  if (visibles.length === 0) return () => [0, 0];
  const lngs = visibles.map((p) => p[0]);
  const lats = visibles.map((p) => p[1]);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const pad = 46;
  const spanLng = (maxLng - minLng) || 1e-6;
  const spanLat = (maxLat - minLat) || 1e-6;
  const esc = Math.min((w - pad * 2) / spanLng, (h - pad * 2) / spanLat);
  const cx = (minLng + maxLng) / 2;
  const cy = (minLat + maxLat) / 2;
  return ([lng, lat]) => [w / 2 + (lng - cx) * esc, h / 2 + (cy - lat) * esc];
}

const RADIO = { fantasma: 5, grupo: 4.5, municipio: 4, depto: 5, provincia: 6.5, central: 10 };

function pintar() {
  if (!svg || !body) return;
  const R = body.getBoundingClientRect();
  if (R.width < 60 || R.height < 60) return; // panel oculto/plegado: nada
  const red = (!vista || vista.nivel === 'pais') ? cargarVistaPais() : cargarEgo(vista.id);
  const proyectar = proyectador(red.nodos.filter((n) => n.rol !== 'grupo').map((n) => n.lonlat), R.width, R.height);
  for (const n of red.nodos) {
    const p = proyectar(n.lonlat);
    n.x = p[0];
    n.y = p[1];
  }
  gEnlaces.innerHTML = '';
  gNodos.innerHTML = '';
  gAccesorios.innerHTML = '';

  for (const e of red.enlaces) {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', Math.round(e.s.x));
    line.setAttribute('y1', Math.round(e.s.y));
    line.setAttribute('x2', Math.round(e.t.x));
    line.setAttribute('y2', Math.round(e.t.y));
    line.setAttribute('class', `gp-enlace gp-enlace--${e.tipo}`);
    gEnlaces.appendChild(line);
  }

  // Orden de capas: fantasma/grupo al fondo, central arriba
  const orden = ['fantasma', 'grupo', 'municipio', 'depto', 'provincia', 'central'];
  const capas = [...red.nodos].sort((a, b) => orden.indexOf(a.rol) - orden.indexOf(b.rol));
  for (const n of capas) gNodos.appendChild(renderNodo(n));

  // Salta "viva" solo en la vista país
  if ((!vista || vista.nivel === 'pais') && red.nodos.some((n) => n.id === DEMO_ID)) {
    accesoriosSalta(red.nodos.find((n) => n.id === DEMO_ID));
  }
  actualizarBC();
}

function renderNodo(n) {
  const g = document.createElementNS(NS, 'g');
  const esVivo = n.id === DEMO_ID && (!vista || vista.nivel === 'pais') && n.rol === 'provincia';
  g.setAttribute('class', `gp-nodo gp-nodo--${n.rol}${esVivo ? ' gp-nodo--vivo' : ''}`);
  g.setAttribute('transform', `translate(${Math.round(n.x)},${Math.round(n.y)})`);
  if (n.rol === 'grupo') {
    g.setAttribute('data-grupo-ver', n.ver);
  } else if (n.rol !== 'fantasma') {
    g.setAttribute('data-yvy', n.id);
  }
  if (esVivo) {
    const halo = document.createElementNS(NS, 'circle');
    halo.setAttribute('r', RADIO.central);
    halo.setAttribute('class', 'gp-halo');
    g.appendChild(halo);
  }
  const circ = document.createElementNS(NS, 'circle');
  circ.setAttribute('r', RADIO[n.rol] || 5);
  circ.setAttribute('class', 'gp-circulo');
  g.appendChild(circ);
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('class', 'gp-texto' + (esVivo ? ' gp-texto--acento' : ''));
  t.setAttribute('x', 0);
  t.setAttribute('y', (RADIO[n.rol] || 5) + 11);
  t.textContent = n.nombre;
  g.appendChild(t);
  if (n.rol !== 'central' && n.rol !== 'grupo' && n.rol !== 'fantasma' && n.nivel) {
    const badge = document.createElementNS(NS, 'text');
    badge.setAttribute('class', 'gp-tipo');
    badge.setAttribute('x', 0);
    badge.setAttribute('y', (RADIO[n.rol] || 5) + 21);
    badge.textContent = `· ${etiquetaNivel(n.nivel) || n.nivel}`;
    g.appendChild(badge);
  }
  return g;
}

/** Chip esmeralda [DATOS CARGADOS] junto al nodo vivo (Salta). */
function accesoriosSalta(nodo) {
  if (!nodo) return;
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'gp-chip');
  g.setAttribute('transform', `translate(${Math.round(nodo.x) + 14},${Math.round(nodo.y) - 26})`);
  const rect = document.createElementNS(NS, 'rect');
  rect.setAttribute('x', 0);
  rect.setAttribute('y', -9);
  rect.setAttribute('rx', 3);
  rect.setAttribute('ry', 3);
  rect.setAttribute('width', 118);
  rect.setAttribute('height', 16);
  rect.setAttribute('class', 'gp-chip__rect');
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('class', 'gp-chip__texto');
  t.setAttribute('x', 6);
  t.setAttribute('y', 3);
  t.textContent = 'DATOS CARGADOS';
  g.appendChild(rect);
  g.appendChild(t);
  gAccesorios.appendChild(g);
}

// --------------------------------------------------------------
// Breadcrumb + interacción
// --------------------------------------------------------------

function actualizarBC() {
  if (!bc) return;
  bc.innerHTML = '';
  const items = [{ nivel: 'pais', id: null, nombre: 'Argentina' }];
  if (vista && vista.nivel !== 'pais') {
    const actual = getObjeto(vista.id);
    if (actual && actual.parent_yvy_id != null) {
      const padre = getObjeto(actual.parent_yvy_id);
      // El país (yvy 0) ya es items[0]: no duplicar en el breadcrumb.
      if (padre && padre.nivel !== 'pais') items.push({ nivel: padre.nivel, id: padre.yvy_id, nombre: padre.nombre_oficial });
    }
    if (actual) items.push({ nivel: actual.nivel, id: actual.yvy_id, nombre: actual.nombre_oficial });
  }
  items.forEach((it, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'pg-sep';
      sep.textContent = '›';
      bc.appendChild(sep);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    const ultimo = i === items.length - 1;
    btn.className = 'pg-bc' + (ultimo ? ' pg-bc--actual' : '');
    if (!ultimo) {
      btn.addEventListener('click', () => ir(it.nivel === 'pais' ? { nivel: 'pais' } : { nivel: it.nivel, id: it.id }));
    }
    btn.textContent = it.nombre;
    bc.appendChild(btn);
  });
}

/** Interacción: grupo "+N más", nodo (drill + navegar) o fondo (subir). */
function onClicSvg(e) {
  const gGrupo = e.target.closest('[data-grupo-ver]');
  if (gGrupo) {
    expandidos.add(gGrupo.getAttribute('data-grupo-ver'));
    pintar();
    track('grafo_mas', { vista: vista ? vista.nivel : 'pais' });
    return;
  }
  const gNodo = e.target.closest('[data-yvy]');
  if (gNodo) {
    const id = Number(gNodo.getAttribute('data-yvy'));
    const n = nodosById.get(id);
    if (!n) return;
    track('grafo_nodo', { nivel: n.nivel, yvy_id: id });
    navegarA(id); // abre el dossier (y vuela el mapa)
    if (n.nivel === 'provincia') setVista({ nivel: 'provincia', id });
    else if (n.nivel === 'depto') setVista({ nivel: 'depto', id });
    return;
  }
  // Fondo del lienzo: subir un nivel (país ← provincia ← depto)
  if (!vista || vista.nivel === 'pais') return;
  const o = getObjeto(vista.id);
  const padreId = o ? o.parent_yvy_id : null;
  const padre = padreId != null ? getObjeto(padreId) : null;
  setVista(padre && padre.nivel === 'provincia' ? { nivel: 'provincia', id: padreId } : { nivel: 'pais' });
}

/** Cambia de vista y repinta. */
function setVista(nueva) {
  vista = nueva;
  pintar();
}

function ir(nueva) {
  setVista(nueva);
  if (nueva.id != null) navegarA(nueva.id);
}

// --------------------------------------------------------------
// Inicialización pública
// --------------------------------------------------------------

export function inicializarPanelGrafo() {
  body = document.getElementById('panel-grafo-body');
  bc = document.getElementById('panel-grafo-bc');
  if (!body || !bc) return;
  svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'panel-grafo-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Grafo de jurisdicciones argentinas');
  gEnlaces = document.createElementNS(NS, 'g');
  gNodos = document.createElementNS(NS, 'g');
  gAccesorios = document.createElementNS(NS, 'g');
  svg.appendChild(gEnlaces);
  svg.appendChild(gNodos);
  svg.appendChild(gAccesorios);
  svg.addEventListener('click', onClicSvg);
  body.innerHTML = '';
  body.appendChild(svg);
  setVista({ nivel: 'pais' });
  window.addEventListener('resize', () => pintar());
  // El catálogo puede llegar después del primer pintado (boot): repinta.
  setTimeout(() => { try { pintar(); } catch (e) { console.warn('[yvy] repintado grafo:', e?.message); } }, 600);
  track('grafo_panel', { ok: 1 });
}
