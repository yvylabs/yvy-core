// ==============================================================
// grafo.js — Grafo de relaciones, SIEMPRE visible en el dossier
// (bloque compacto de 220px, sin acordeón ni scroll). Selección
// humanizada: nodo central + padre ("Pertenece a") + primeros 6
// relacionados (hijos alfabéticos, luego vecinos) + nodos grupo
// "+ N más" / "+ M vecinos" que abren el acordeón correspondiente.
// Leyenda en texto humano (skos:/yvyont: quedan solo como data-).
// Layout: d3-force VIVO con distancias ajustadas al lienzo chico;
// clamp al bbox; nada colapsado. Clic en nodo nombre → navegar.
// ==============================================================

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from 'd3-force';
import { getHijos, getObjeto, getPadre, getRelaciones } from './manifest.js';

const NS = 'http://www.w3.org/2000/svg';
const ALTO = 200; // compacto: el dossier no genera scroll por el grafo
const MAX_RELACIONADOS = 6; // el resto se agrupa en "+ N más" / "+ M vecinos"
const RADIO = { central: 10, padre: 8, hijo: 5.5, vecino: 6.5, grupo: 7 };
const DIST = { broader: 64, contiene: 52, lindero: 80, cerca_de: 80 };
// Padding de colisión: radio + holgura para que la ETIQUETA no pise.
const HOLGURA = { central: 19, padre: 17, hijo: 16, vecino: 16, grupo: 15 };
const MARGEN = 26;
const NIVEL_HUMANO = {
  pais: 'País',
  provincia: 'Provincia',
  depto: 'Departamento',
  municipio: 'Municipio',
  barrio: 'Barrio',
};

function truncar(s, max = 12) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function el(tag, attrs, texto) {
  const e = document.createElementNS(NS, tag);
  for (const k of Object.keys(attrs || {})) e.setAttribute(k, attrs[k]);
  if (texto != null) e.textContent = texto;
  return e;
}

/**
 * Construye y devuelve el elemento con el grafo de la ficha.
 * @param {object} obj - nodo activo (manifest)
 * @param {{navegar: Function, abreGrupo?: Function, ancho?: number}} opts
 *   navegar(yvy_id) para nodos rol nombre; abreGrupo('contiene'|'limita')
 *   para nodos grupo (+ N más / + M vecinos).
 * @returns {HTMLElement} contenedor del SVG del grafo
 */
export function crearGrafoRelaciones(obj, { navegar, abreGrupo, ancho: anchoIni = 460 } = {}) {
  let ancho = Math.max(360, Math.round(anchoIni));
  const alto = ALTO;
  const hijos = getHijos(obj.yvy_id);

  // --- datos del grafo: selección humanizada (cero constelación) ---
  const dicente = { id: String(obj.yvy_id), nombre: obj.nombre_oficial, nivel: obj.nivel, rol: 'central' };
  const nodos = [dicente];
  const enlaces = [];
  const vistos = new Set([dicente.id]);
  const agregar = (o, rol) => {
    const id = String(o.yvy_id);
    if (!o || vistos.has(id)) return null;
    vistos.add(id);
    const n = { id, nombre: o.nombre_oficial, nivel: o.nivel, rol };
    nodos.push(n);
    return n;
  };

  // Pertenece a: 1 ranura fija (no compite con los 6 relacionados).
  const padre = getPadre(obj);
  const np = padre ? agregar(padre, 'padre') : null;
  if (np) enlaces.push({ source: dicente, target: np, tipo: 'broader' });

  // Hijos alfabéticos primero; vecinos llenan ranuras libres.
  const hijosOrdenados = [...hijos].sort((a, b) => a.nombre_oficial.localeCompare(b.nombre_oficial, 'es'));
  const hijosVisibles = hijosOrdenados.slice(0, MAX_RELACIONADOS);
  for (const h of hijosVisibles) {
    const n = agregar(h, 'hijo');
    if (n) enlaces.push({ source: dicente, target: n, tipo: 'contiene' });
  }
  const hijosOcultos = hijosOrdenados.length - hijosVisibles.length;
  const slotsVecinos = MAX_RELACIONADOS - hijosVisibles.length;
  const vecinosOrdenados = getRelaciones(obj.yvy_id)
    .filter((r) => r.tipo === 'lindero' || r.tipo === 'cerca_de')
    .map((r) => getObjeto(r.destino_yvy_id))
    .filter(Boolean)
    .sort((a, b) => a.nombre_oficial.localeCompare(b.nombre_oficial, 'es'));
  const vecinosVisibles = vecinosOrdenados.slice(0, slotsVecinos);
  for (const o of vecinosVisibles) {
    const n = agregar(o, 'vecino');
    if (n) enlaces.push({ source: dicente, target: n, tipo: 'lindero' });
  }
  const vecinosOcultos = vecinosOrdenados.length - vecinosVisibles.length;

  // Nodos grupo: el acordeón detallado es el destino del clic.
  if (hijosOcultos > 0) {
    nodos.push({ id: 'grupo-contiene', nombre: `+ ${hijosOcultos} más`, rol: 'grupo', grupo: 'contiene' });
  }
  if (vecinosOcultos > 0) {
    nodos.push({ id: 'grupo-vecinos', nombre: `+ ${vecinosOcultos} vecinos`, rol: 'grupo', grupo: 'limita' });
  }

  // Aislar (sin relaciones de ningún tipo): honesto, sin constelación de uno.
  const sinRelaciones = nodos.length === 1 && vecinosOcultos === 0 && hijosOcultos === 0;

  // --- SVG ---
  const svg = el('svg', {
    viewBox: `0 0 ${ancho} ${alto}`,
    class: 'grafo-svg',
    role: 'img',
    'aria-label': `Grafo de relaciones de ${obj.nombre_oficial}`,
  });
  if (sinRelaciones) {
    const wrap = document.createElement('div');
    wrap.className = 'grafo-wrap';
    const vacio = document.createElement('p');
    vacio.className = 'grafo-vacio';
    vacio.textContent = 'Sin relaciones registradas todavía.';
    wrap.appendChild(vacio);
    return wrap;
  }
  const gEnlaces = el('g');
  const lineEls = [];
  for (const e of enlaces) {
    const clase = e.tipo === 'contiene' ? 'grafo-enlace--contiene' : e.tipo === 'broader' ? 'grafo-enlace--broader' : 'grafo-enlace--lindero';
    const l = el('line', { class: `grafo-enlace ${clase}` });
    gEnlaces.appendChild(l);
    lineEls.push(l);
  }
  svg.appendChild(gEnlaces);

  const gNodos = el('g');
  const nodoEls = [];
  for (const n of nodos) {
    const g = el('g');
    if (n.rol === 'grupo') {
      // Nodo grupo: abre el acordeón correspondiente (Contiene / Limita con).
      g.classList.add('grafo-nodo--grupo');
      g.addEventListener('click', () => {
        if (abreGrupo) abreGrupo(n.grupo);
      });
      g.appendChild(el('circle', { r: RADIO.grupo, class: 'grafo-circulo grafo-circulo--grupo' }));
      g.appendChild(el('text', {
        y: RADIO.grupo + 10,
        class: 'grafo-texto grafo-texto--grupo',
        'text-anchor': 'middle',
      }, n.nombre));
      g.appendChild(el('title', {}, `${n.nombre} — abrir la sección correspondiente`));
      gNodos.appendChild(g);
      nodoEls.push(g);
      continue;
    }
    if (n.rol !== 'central') {
      g.classList.add('grafo-nodo--link');
      g.addEventListener('click', () => {
        if (navegar) navegar(Number(n.id));
      });
    }
    g.appendChild(el('circle', {
      r: RADIO[n.rol],
      class: `grafo-circulo grafo-circulo--${n.rol}`,
    }));
    const t = el('text', {
      y: RADIO[n.rol] + 9,
      class: `grafo-texto grafo-texto--${n.rol}`,
      'text-anchor': 'middle',
    });
    t.appendChild(document.createTextNode(truncar(n.nombre, n.rol === 'central' ? 18 : 12)));
    if (n.rol !== 'central') {
      // Etiqueta de tipo junto al nombre (decisión humanizada).
      const tipoN = NIVEL_HUMANO[n.nivel] || n.nivel;
      const b = el('tspan', { class: 'grafo-texto--tipo', dx: '2' }, `· ${tipoN}`);
      t.appendChild(b);
    }
    const tipoHumano = NIVEL_HUMANO[n.nivel] || n.nivel;
    g.appendChild(t);
    g.appendChild(el('title', {}, `${n.nombre} · ${tipoHumano}${n.rol !== 'central' ? ' — clic para navegar' : ' (nodo actual)'}`));
    gNodos.appendChild(g);
    nodoEls.push(g);
  }
  svg.appendChild(gNodos);

  // --- simulación VIVA ajustada al lienzo compacto ---
  const GOLDEN = 2.39996;
  nodos.forEach((n, i) => {
    if (n.rol === 'central') {
      n.x = ancho / 2;
      n.y = alto / 2;
      return;
    }
    const r = 55 + (i % 4) * 18;
    n.x = ancho / 2 + Math.cos(i * GOLDEN) * r;
    n.y = alto / 2 + Math.sin(i * GOLDEN) * r;
  });

  // Render por tick: clamp al lienzo + actualización de coords (≤90 nodos).
  const renderTick = () => {
    const mx = MARGEN;
    for (const n of nodos) {
      if (n.x < mx) n.x = mx;
      else if (n.x > ancho - mx) n.x = ancho - mx;
      if (n.y < mx) n.y = mx;
      else if (n.y > alto - mx) n.y = alto - mx;
    }
    for (let i = 0; i < enlaces.length; i++) {
      const e = enlaces[i];
      lineEls[i].setAttribute('x1', e.source.x.toFixed(1));
      lineEls[i].setAttribute('y1', e.source.y.toFixed(1));
      lineEls[i].setAttribute('x2', e.target.x.toFixed(1));
      lineEls[i].setAttribute('y2', e.target.y.toFixed(1));
    }
    for (let i = 0; i < nodos.length; i++) {
      nodoEls[i].setAttribute('transform', `translate(${nodos[i].x.toFixed(1)} ${nodos[i].y.toFixed(1)})`);
    }
  };

  const fx = forceX(ancho / 2);
  const fy = forceY(alto / 2);
  const sim = forceSimulation(nodos)
    .force('link', forceLink(enlaces).id((d) => d.id).distance((d) => DIST[d.tipo] || 55).strength(0.55))
    .force('charge', forceManyBody().strength(-110)) // repelen con aire, roles compactos
    .force('collide', forceCollide().radius((d) => RADIO[d.rol] + HOLGURA[d.rol]))
    .force('x', fx.strength(0.04))
    .force('y', fy.strength(0.05))
    .on('tick', renderTick);
  renderTick(); // posición inicial visible antes del primer tick

  // --- ResizeObserver: el panel es clamp(500px,40vw,650px) → el ancho cambia ---
  let rect = null; // último width visto
  let timerRo = null;
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver((entries) => {
      const w = entries && entries[0] ? entries[0].contentRect.width : 0;
      if (!w || w < 200) return;
      if (rect == null) { rect = w; return; } // primera lectura: no reinicia
      if (Math.abs(w - rect) < 8) return; // throttle: solo cambios reales
      rect = w;
      if (timerRo) clearTimeout(timerRo);
      timerRo = setTimeout(() => {
        ancho = Math.max(360, Math.floor(w));
        svg.setAttribute('viewBox', `0 0 ${ancho} ${alto}`);
        fx.x(ancho / 2);
        fy.y(alto / 2);
        sim.alpha(0.35).restart(); // re-asienta en el nuevo bbox
      }, 150);
    });
    ro.observe(svg);
  }

  // --- contenedor con leyenda humana (texto claro, sin vocabulario RDF) ---
  const wrap = document.createElement('div');
  wrap.className = 'grafo-wrap';
  // Si el wrap sale del DOM (navegación dentro del dossier → re-render),
  // frenar la simulación: sin rAF zombi consumiendo CPU tras desmontar.
  new MutationObserver(() => {
    if (!wrap.isConnected && sim.alpha() > 0) sim.stop();
  }).observe(document.body, { childList: true, subtree: true });
  wrap.appendChild(svg);
  const leyenda = document.createElement('div');
  leyenda.className = 'grafo-leyenda';
  const legendItems = [
    ['grafo-leyenda__trazo--broader', 'Pertenece a'],
    ['grafo-leyenda__trazo--contiene', 'Contiene'],
    ['grafo-leyenda__trazo--lindero', 'Limita con'],
  ];
  for (const [c, txt] of legendItems) {
    const i = document.createElement('span');
    i.className = 'grafo-leyenda__item';
    const s = document.createElement('span');
    s.className = `grafo-leyenda__trazo ${c}`;
    i.appendChild(s);
    i.appendChild(document.createTextNode(txt));
    leyenda.appendChild(i);
  }
  wrap.appendChild(leyenda);
  return wrap;
}
