// ==============================================================
// grafo-panel.js — PANEL GRAFO (R2 + R6-b "segundo cerebro").
// SVG propio con proyección equirectangular: los nodos NO son un
// layout de fuerza, son posiciones reales (capital_centro en nivel
// país, centro_etiqueta en los drills) → la silueta ES el grafo.
// - Vista país: 24 provincias (radio = densidad real de deptos) +
//   529 deptos como puntos en su centro real con hilos tenues: el
//   enjambre DIBUJA el territorio (sin polígonos inventados).
// - Objeto activo (R5): el nodo de la ficha abierta lleva halo
//   pulsante esmeralda + chip DATOS CARGADOS (CSS, reduced-motion).
// - Anti-solape de etiquetas (R6-b): cajas greedy con stagger; la
//   que pierde se oculta y queda en el <title> (hover nativo).
// - Hover-focus estilo Obsidian: el nodo + sus vecinos quedan
//   vivos, el resto se atenúa (1-hop).
// - Drill: provincia → departamentos → municipios, cada nodo con sus
//   relaciones reales. Grupo "+ N más" (tope 12, expandible).
// - Clic nodo → navegarA (dossier sync); clic fondo → sube un nivel;
//   breadcrumb Argentina › Salta › Anta.
// Zero-alucinación (SPEC §4): sin coordenada real no hay nodo; sin
// hijos no hay drill; el conteo "+ N más" es el resto real.
// ==============================================================

import { getObjeto, getObjetos, getHijos, getRelaciones, navegarA, etiquetaNivel, getObjetoActivo } from './manifest.js';
import { track } from './telemetry.js';

const NS = 'http://www.w3.org/2000/svg';
const MAX_VISIBLE = 12; // nodos con etiqueta antes del grupo "+ N más"

let svg = null;
let gEnlaces = null;
let gNodos = null;
let gAccesorios = null;
let body = null;
let bc = null;
let vista = null; // { nivel: 'pais' } | { nivel: 'provincia'|'depto', id }
let expandidos = new Set(); // keys 'nivelPadre:id' con grupos "+N más" abiertos
let nodosById = new Map();
let vivoId = null; // objeto activo de la ficha: halo + chip lo siguen
// Estado del catálogo (R10): 'cargando' | 'ok' | 'error'. El estado vacío
// del grafo lo dice con honestidad (antes "cargando" eterno si fallaba).
let estadoCatalogo = 'cargando';

/** main.js avisa cómo va el catálogo; repinta el vacío si hace falta. */
export function setEstadoCatalogo(estado) {
  if (estadoCatalogo === estado) return;
  estadoCatalogo = estado;
  if (!svg || !body) return;
  try { pintar(); } catch { /* panel aún sin medidas */ }
}

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

/** Vista país (R6-b "segundo cerebro"): 24 provincias (capital_centro)
 * + 529 deptos como puntos reales (la densidad DIBUJA la silueta del
 * territorio: cero geometría inventada, SPEC §4) + hilos contiene
 * tenues + linderos sólidos. Radio de provincia = densidad real
 * (sqrt de deptos). */
function cargarVistaPais() {
  nodosById = new Map();
  const nodos = [];
  const enlaces = [];
  const provincias = getObjetos().filter((x) => x.nivel === 'provincia');
  const enElGrafo = new Set();
  for (const o of provincias) {
    const c = coordsDe(o);
    if (!c) continue; // missing explícito: sin coordenada no hay nodo
    enElGrafo.add(o.yvy_id);
    const n = datosNodo(o, c, 'provincia');
    // Densidad visible: radio por sqrt(#deptos) — más subdivisión, más masa
    const nHijos = (getHijos(o.yvy_id) || []).length;
    n.r = 4.5 + Math.min(6.5, Math.sqrt(nHijos) * 0.6);
    n.hijos = getHijos(o.yvy_id) || [];
    nodos.push(n);
  }
  // Deptos: puntos en su centro real, hilo tenue hacia la provincia.
  // El enjambre dibuja la forma del país sin dibujar ningún polígono.
  // (copia: el loop agrega al array mientras itera)
  for (const p of [...nodos]) {
    for (const h of (p.hijos || [])) {
      const ch = coordsDe(h);
      if (!ch) continue;
      const d = datosNodo(h, ch, 'depto-dot');
      d.r = 1.7;
      d.padreId = p.id;
      nodos.push(d);
      enlaces.push({ s: p, t: d, tipo: 'hilo' });
    }
  }
  const vistos = new Set();
  for (const p of provincias) {
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
  // Padding asimétrico (R6-b "segundo cerebro"): la red LLENA el panel.
  // Abro solo lo que hace falta: abajo etiquetas de provincias grandes,
  // arriba el halo/chip del nodo activo.
  const PAD_X = 26, PAD_TOP = 46, PAD_BOTTOM = 52;
  const despY = (PAD_TOP - PAD_BOTTOM) / 2;
  const spanLng = (maxLng - minLng) || 1e-6;
  const spanLat = (maxLat - minLat) || 1e-6;
  const esc = Math.min((w - PAD_X * 2) / spanLng, (h - PAD_TOP - PAD_BOTTOM) / spanLat);
  const cx = (minLng + maxLng) / 2;
  const cy = (minLat + maxLat) / 2;
  return ([lng, lat]) => [w / 2 + (lng - cx) * esc, h / 2 + despY + (cy - lat) * esc];
}

const RADIO = { fantasma: 5, grupo: 4.5, municipio: 4, depto: 5, provincia: 6.5, central: 10 };

function pintar() {
  if (!svg || !body) return;
  const R = body.getBoundingClientRect();
  if (R.width < 60 || R.height < 60) return; // panel oculto/plegado: nada
  // viewBox explícito (R5-b): con CSS 100%/100% basta, pero un SVG sin
  // caja (300x150 default) recorta el mapa si el sheet todavía no aplica.
  svg.setAttribute('viewBox', `0 0 ${Math.round(R.width)} ${Math.round(R.height)}`);
  if (!svg.getAttribute('preserveAspectRatio')) svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  // Nodo "vivo" (R5): el objeto activo de la ficha (NO una decoración
  // fija). En cualquier vista: halo pulsante + chip DATOS CARGADOS.
  vivoId = (() => { const o = getObjetoActivo(); return o ? Number(o.yvy_id) : null; })();
  const red = (!vista || vista.nivel === 'pais') ? cargarVistaPais() : cargarEgo(vista.id);
  // Estado vacío honesto (R9): si el catálogo todavía no llegó, el panel
  // lo DICE (antes quedaba un lienzo mudo que parecía roto).
  const vacio = red.nodos.length === 0;
  let elVacio = body.querySelector('.panel-grafo__vacio');
  if (vacio) {
    gEnlaces.innerHTML = '';
    gNodos.innerHTML = '';
    gAccesorios.innerHTML = '';
    const error = estadoCatalogo === 'error';
    const html = error
      ? '<strong>No se pudo cargar el catálogo</strong><span>Revisá la conexión y recargá la página. El mapa sigue funcionando.</span>'
      : '<strong>Cargando el catálogo…</strong><span>El grafo aparece en cuanto llegan las entidades.</span>';
    if (!elVacio) {
      elVacio = document.createElement('div');
      elVacio.className = 'panel-grafo__vacio';
      elVacio.innerHTML = html;
      body.appendChild(elVacio);
    } else if (elVacio.innerHTML !== html) {
      elVacio.innerHTML = html;
    }
    elVacio.classList.toggle('panel-grafo__vacio--error', error);
    actualizarBC();
    return;
  }
  if (elVacio) elVacio.remove();
  const proyectar = proyectador(red.nodos.filter((n) => n.rol !== 'grupo').map((n) => n.lonlat), R.width, R.height);
  for (const n of red.nodos) {
    const p = proyectar(n.lonlat);
    n.x = p[0];
    n.y = p[1];
  }
  acomodarEtiquetas(red.nodos);
  gEnlaces.innerHTML = '';
  gNodos.innerHTML = '';
  gAccesorios.innerHTML = '';
  redActual = red;

  for (const e of red.enlaces) {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', Math.round(e.s.x));
    line.setAttribute('y1', Math.round(e.s.y));
    line.setAttribute('x2', Math.round(e.t.x));
    line.setAttribute('y2', Math.round(e.t.y));
    line.setAttribute('class', `gp-enlace gp-enlace--${e.tipo}`);
    gEnlaces.appendChild(line);
  }

  // Orden de capas: enjambre de deptos al fondo, central arriba
  const orden = ['depto-dot', 'fantasma', 'grupo', 'municipio', 'depto', 'provincia', 'central'];
  const capas = [...red.nodos].sort((a, b) => orden.indexOf(a.rol) - orden.indexOf(b.rol));
  for (const n of capas) gNodos.appendChild(renderNodo(n));

  const nodoVivo = vivoId != null ? red.nodos.find((n) => n.id === vivoId) : null;
  if (nodoVivo) accesoriosNodoVivo(nodoVivo);
  actualizarBC();
  aplicarFoco(null); // repintado: el hover-focus se re-evalúa solo
}

/**
 * Anti-solape (R6-b): cajas greedy con stagger vertical. La etiqueta
 * que no encuentra lugar se oculta (labelY=null) y queda accesible en
 * el <title> del nodo (hover nativo). Determinista: orden por Y.
 */
function acomodarEtiquetas(nodos) {
  const cajas = [];
  const conTexto = nodos.filter((n) => n.rol !== 'depto-dot' && n.rol !== 'grupo' && n.rol !== 'fantasma');
  conTexto.sort((a, b) => a.y - b.y);
  for (const n of conTexto) {
    n.labelY = null;
    const r = n.r || RADIO[n.rol] || 5;
    const w = (n.nombre ? n.nombre.length : 0) * 5.6 + 10;
    const h = 11;
    const base = n.y + r + 11;
    for (const dy of [0, -13, 13, -23, 23, -33]) {
      const yy = base + dy;
      const box = { x1: n.x - w / 2, x2: n.x + w / 2, y1: yy - h, y2: yy + 3 };
      const choca = cajas.some((c) => !(box.x2 < c.x1 || box.x1 > c.x2 || box.y2 < c.y1 || box.y1 > c.y2));
      if (!choca) {
        cajas.push(box);
        n.labelY = yy;
        break;
      }
    }
  }
}

function renderNodo(n) {
  const g = document.createElementNS(NS, 'g');
  const esVivo = n.id === vivoId && n.rol !== 'fantasma';
  const r = n.r || RADIO[n.rol] || 5;
  g.setAttribute('class', `gp-nodo gp-nodo--${n.rol}${esVivo ? ' gp-nodo--vivo' : ''}`);
  g.setAttribute('transform', `translate(${Math.round(n.x)},${Math.round(n.y)})`);
  if (n.rol === 'grupo') {
    g.setAttribute('data-grupo-ver', n.ver);
  } else if (n.rol !== 'fantasma') {
    g.setAttribute('data-yvy', n.id);
  }
  // Accesibilidad (R10): nodos alcanzables con teclado (roving tabindex),
  // con nombre y acción anunciados. El fantasma no es interactivo.
  if (n.rol !== 'fantasma') {
    g.setAttribute('tabindex', '-1');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', n.rol === 'grupo'
      ? `${n.nombre}. Mostrar el resto.`
      : `${n.nombre}, ${etiquetaNivel(n.nivel) || n.nivel}. Abrir dossier.`);
  }
  // Hover nativo accesible: siempre el nombre real en <title>
  const titulo = document.createElementNS(NS, 'title');
  titulo.textContent = n.rol === 'grupo' ? 'Expandir grupo' : `${n.nombre} · ${etiquetaNivel(n.nivel) || n.nivel}`;
  g.appendChild(titulo);
  if (esVivo) {
    const halo = document.createElementNS(NS, 'circle');
    halo.setAttribute('r', r + 4);
    halo.setAttribute('class', 'gp-halo');
    g.appendChild(halo);
  }
  const circ = document.createElementNS(NS, 'circle');
  circ.setAttribute('r', r);
  circ.setAttribute('class', 'gp-circulo');
  g.appendChild(circ);
  // Etiqueta: solo roles con texto, solo si el anti-solape encontró
  // lugar (los perdedores viven en el <title>).
  if (n.rol !== 'depto-dot' && n.rol !== 'grupo' && n.rol !== 'fantasma' && n.labelY != null) {
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('class', 'gp-texto' + (esVivo ? ' gp-texto--acento' : ''));
    t.setAttribute('x', 0);
    t.setAttribute('y', Math.round(n.labelY - n.y));
    t.textContent = n.nombre;
    g.appendChild(t);
  }
  return g;
}

/** Chip esmeralda [DATOS CARGADOS] junto al nodo del objeto activo. */
function accesoriosNodoVivo(nodo) {
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
    const ultimo = i === items.length - 1;
    // R11: el nivel actual NO es una acción. Antes era un <button> que no
    // hacía nada (tab-stop muerto); ahora es texto con aria-current.
    if (ultimo) {
      const actual = document.createElement('span');
      actual.className = 'pg-bc pg-bc--actual';
      actual.setAttribute('aria-current', 'true');
      actual.textContent = it.nombre;
      bc.appendChild(actual);
      return;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pg-bc';
    btn.addEventListener('click', () => ir(it.nivel === 'pais' ? { nivel: 'pais' } : { nivel: it.nivel, id: it.id }));
    btn.textContent = it.nombre;
    bc.appendChild(btn);
  });
}

/** Interacción: grupo "+N más", nodo (drill + navegar) o fondo (subir). */
function activarNodo(gNodo, desdeTeclado) {
  if (!gNodo) return;
  if (gNodo.hasAttribute('data-grupo-ver')) {
    expandidos.add(gNodo.getAttribute('data-grupo-ver'));
    pintar();
    if (desdeTeclado && svg) { try { svg.focus(); } catch { /* sin foco */ } }
    track('grafo_mas', { vista: vista ? vista.nivel : 'pais' });
    return;
  }
  const id = Number(gNodo.getAttribute('data-yvy'));
  const n = nodosById.get(id);
  if (!n) return;
  track('grafo_nodo', { nivel: n.nivel, yvy_id: id });
  navegarA(id); // abre el dossier (y vuela el mapa)
  if (n.nivel === 'provincia') setVista({ nivel: 'provincia', id });
  else if (n.nivel === 'depto') setVista({ nivel: 'depto', id });
  // Teclado (R11): el repintado borra el nodo enfocado; devolvemos el foco
  // al lienzo para no expulsar al usuario del grafo.
  if (desdeTeclado && svg) { try { svg.focus(); } catch { /* sin foco */ } }
}

function onClicSvg(e) {
  const gNodo = e.target.closest ? e.target.closest('[data-grupo-ver],[data-yvy]') : null;
  if (gNodo) {
    activarNodo(gNodo);
    return;
  }
  // Fondo del lienzo: subir un nivel (país ← provincia ← depto)
  if (!vista || vista.nivel === 'pais') return;
  const o = getObjeto(vista.id);
  const padreId = o ? o.parent_yvy_id : null;
  const padre = padreId != null ? getObjeto(padreId) : null;
  setVista(padre && padre.nivel === 'provincia' ? { nivel: 'provincia', id: padreId } : { nivel: 'pais' });
}

/**
 * Teclado (R10): roving tabindex. Tab entra al grafo UNA vez; flechas
 * recorren los nodos en orden de lectura; Enter/Espacio activan el nodo
 * (mismo camino que el clic). Sin 565 tab-stops inútiles.
 */
function onTecladoSvg(e) {
  const activo = document.activeElement;
  const g = activo && activo.closest ? activo.closest('[data-yvy],[data-grupo-ver]') : null;
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
    if (g) { e.preventDefault(); activarNodo(g, true); }
    return;
  }
  const paso = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1
    : (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 0;
  if (!paso) return;
  // Orden de lectura: central → provincias → deptos → grupos (no el orden
  // de capas del DOM, que pone el enjambre de deptos primero).
  const prioridad = (n) => n.classList.contains('gp-nodo--central') ? 0
    : n.classList.contains('gp-nodo--provincia') ? 1
    : n.classList.contains('gp-nodo--depto-dot') ? 4 : 3;
  const pos = (n) => {
    const m = (n.getAttribute('transform') || '').match(/translate\(([-\d.]+),([-\d.]+)\)/);
    return m ? [Number(m[2]), Number(m[1])] : [0, 0];
  };
  const lista = [...gNodos.querySelectorAll('[data-yvy],[data-grupo-ver]')].sort((a, b) =>
    prioridad(a) - prioridad(b) || pos(a)[0] - pos(b)[0] || pos(a)[1] - pos(b)[1]);
  if (!lista.length) return;
  e.preventDefault();
  const i = lista.indexOf(g);
  const siguiente = lista[Math.max(0, Math.min(lista.length - 1, i + paso))];
  for (const n of lista) n.setAttribute('tabindex', '-1');
  siguiente.setAttribute('tabindex', '0');
  siguiente.focus();
  // El foco enciende el vecindario aunque el motor no emita focusin.
  const yvy = siguiente.getAttribute('data-yvy');
  aplicarFoco(yvy != null ? Number(yvy) : null);
}

/** Cambia de vista y repinta. */
function setVista(nueva) {
  vista = nueva;
  pintar();
}

// --------------------------------------------------------------
// Hover-focus estilo Obsidian (R6-b): al pasar un nodo quedan vivos
// él + sus vecinos 1-hop (y sus enlaces); el resto se atenúa. El
// trabajo visual lo hace CSS (.gp-focus); acá solo se marcan clases.
// --------------------------------------------------------------
let redActual = null;
let focoId = null;

function aplicarFoco(id) {
  if (!svg) return;
  if (focoId === id) return;
  focoId = id;
  const enfocar = id != null;
  svg.classList.toggle('gp-focus', enfocar);
  if (!redActual) return;
  const vecinos = enfocar ? new Set([id]) : null;
  const lineas = gEnlaces.children;
  redActual.enlaces.forEach((e, i) => {
    const line = lineas[i];
    if (!line) return;
    const toca = enfocar && (e.s.id === id || e.t.id === id);
    line.classList.toggle('gp-enlace--foco', toca);
    if (toca) { vecinos.add(e.s.id); vecinos.add(e.t.id); }
  });
  if (!enfocar) {
    for (const g of gNodos.children) g.classList.remove('gp-nodo--foco');
    return;
  }
  for (const g of gNodos.children) {
    const yvy = g.getAttribute('data-yvy');
    if (yvy == null) continue;
    g.classList.toggle('gp-nodo--foco', vecinos.has(Number(yvy)));
  }
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
  svg.setAttribute('role', 'group');
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-label', 'Grafo de jurisdicciones argentinas. Usá las flechas para recorrer y Enter para abrir.');
  gEnlaces = document.createElementNS(NS, 'g');
  gNodos = document.createElementNS(NS, 'g');
  gAccesorios = document.createElementNS(NS, 'g');
  svg.appendChild(gEnlaces);
  svg.appendChild(gNodos);
  svg.appendChild(gAccesorios);
  svg.addEventListener('click', onClicSvg);
  svg.addEventListener('keydown', onTecladoSvg);
  // Hover-focus Obsidian: el nodo + vecinos quedan vivos, resto atenúa.
  svg.addEventListener('mouseover', (e) => {
    const g = e.target.closest ? e.target.closest('[data-yvy]') : null;
    aplicarFoco(g ? Number(g.getAttribute('data-yvy')) : null);
  });
  svg.addEventListener('mouseleave', () => aplicarFoco(null));
  // Teclado: el foco también enciende el vecindario (mismo lenguaje visual)
  svg.addEventListener('focusin', (e) => {
    const g = e.target.closest ? e.target.closest('[data-yvy]') : null;
    if (g) aplicarFoco(Number(g.getAttribute('data-yvy')));
  });
  svg.addEventListener('focusout', (e) => {
    if (!svg.contains(e.relatedTarget)) aplicarFoco(null);
  });
  body.innerHTML = '';
  body.appendChild(svg);
  setVista({ nivel: 'pais' });
  // R5-b: reencuadre sintomático del PANEL REAL (no window): el layout R
  // cambia el alto del panel con el estado (tira/dossier/tabs) y el
  // window no se mueve. Fallback window.resize para entornos sin RO.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => pintar()).observe(body);
  } else {
    window.addEventListener('resize', () => pintar());
  }
  // El catálogo puede llegar después del primer pintado (boot): repinta.
  setTimeout(() => { try { pintar(); } catch (e) { console.warn('[yvy] repintado grafo:', e?.message); } }, 600);
  track('grafo_panel', { ok: 1 });
}

/**
 * Repintado externo (R5): main.js lo llama al cambiar el objeto activo
 * para que halo + chip "DATOS CARGADOS" sigan a la ficha. Seguro si el
 * panel aún no existe.
 */
export function refrescarGrafo() {
  if (!svg || !body) return;
  try { pintar(); } catch (e) { console.warn('[yvy] repintado grafo:', e?.message); }
}
