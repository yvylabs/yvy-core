// ==============================================================
// grafo.js — Grafo de relaciones estilo Obsidian, dentro del Dossier
// Nodo central + padre (skos:broader) + hijos (yvyont:contiene) +
// vecinos (lindero / cerca_de), todo desde el manifest (0 inventado).
// Layout: d3-force VIVO (simulación con su propio timer, alphaDecay
// natural ⇒ se asienta sola en ~4s y deja de consumir CPU). Nada de
// pre-ticks síncronos que congelaran la física en un rombo colapsado.
// Estabilización: charge(-200) para que los nodos se repelan y
// ocupen TODO el lienzo, collision(radio + padding de etiqueta) para
// que no se pisen, forceX/forceY suaves + clamp al bbox (constelación
// acotada, no mar abierta). ResizeObserver: si el contenedor cambia de
// ancho (panel clamp 500–650px), recalcula el viewBox y reinicia la sim.
// Clic en nodo → navegar (vuelo + ficha).
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
const RADIO = { central: 14, padre: 10, hijo: 6.5, vecino: 8 };
const DIST = { broader: 116, contiene: 80, lindero: 134, cerca_de: 134 };
const TRUNC = 16;
// Padding de colisión: radio + holgura para que la ETIQUETA no pise.
const HOLGURA = { central: 22, padre: 18, hijo: 13, vecino: 15 };
const MARGEN = 30;

function truncar(s) {
  return s.length > TRUNC ? `${s.slice(0, TRUNC - 1)}…` : s;
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
 * @param {{navegar: Function, ancho?: number}} opts - navegar(yvy_id), ancho real del contenedor
 * @returns {HTMLElement} contenedor del SVG del grafo
 */
export function crearGrafoRelaciones(obj, { navegar, ancho: anchoIni = 460 } = {}) {
  let ancho = Math.max(360, anchoIni);
  // El alto acompaña el volumen, piso 450 (constelación con aire).
  const hijos = getHijos(obj.yvy_id);
  let alto = hijos.length > 50 ? 640 : hijos.length > 24 ? 530 : 450;

  // --- datos del grafo ---
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

  const padre = getPadre(obj);
  const np = padre ? agregar(padre, 'padre') : null;
  if (np) enlaces.push({ source: dicente, target: np, tipo: 'broader' });
  for (const h of hijos) {
    const n = agregar(h, 'hijo');
    if (n) enlaces.push({ source: dicente, target: n, tipo: 'contiene' });
  }
  for (const r of getRelaciones(obj.yvy_id)) {
    const o = getObjeto(r.destino_yvy_id);
    if (!o) continue;
    const n = agregar(o, 'vecino');
    if (n) enlaces.push({ source: dicente, target: n, tipo: r.tipo === 'cerca_de' ? 'cerca_de' : 'lindero' });
  }

  // --- SVG ---
  const svg = el('svg', {
    viewBox: `0 0 ${ancho} ${alto}`,
    class: `grafo-svg${hijos.length > 30 ? ' grafo--denso' : ''}`,
    role: 'img',
    'aria-label': `Grafo de relaciones de ${obj.nombre_oficial}`,
  });
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
    g.appendChild(el('text', {
      y: RADIO[n.rol] + 10,
      class: `grafo-texto grafo-texto--${n.rol}`,
      'text-anchor': 'middle',
    }, truncar(n.nombre)));
    const tipoHumano = { broader: 'padre' }[n.rol] || n.nivel;
    g.appendChild(el('title', {}, `${n.nombre} · ${tipoHumano}${n.rol !== 'central' ? ' — clic para navegar' : ' (nodo actual)'}`));
    gNodos.appendChild(g);
    nodoEls.push(g);
  }
  svg.appendChild(gNodos);

  // --- simulación VIVA: arranca dispersa (ángulo áureo) y se asienta sola ---
  const GOLDEN = 2.39996;
  nodos.forEach((n, i) => {
    if (n.rol === 'central') {
      n.x = ancho / 2;
      n.y = alto / 2;
      return;
    }
    const r = 100 + (i % 4) * 30;
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
    .force('link', forceLink(enlaces).id((d) => d.id).distance((d) => DIST[d.tipo] || 90).strength(0.55))
    .force('charge', forceManyBody().strength(-200)) // repelen y ocupan todo el lienzo
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

  // --- contenedor con leyenda (los 3 tipos de arista del vocabulario) ---
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
    ['grafo-leyenda__trazo--broader', 'skos:broader — padre'],
    ['grafo-leyenda__trazo--contiene', 'yvyont:contiene — hijos'],
    ['grafo-leyenda__trazo--lindero', 'yvyont:lindero — vecinos'],
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
