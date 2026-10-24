// ==============================================================
// grafo.js — Grafo de relaciones estilo Obsidian, dentro del Dossier
// Nodo central + padre (skos:broader) + hijos (yvyont:contiene) +
// vecinos (lindero / cerca_de), todo desde el manifest (0 inventado).
// Layout: d3-force con tick SÍNCRONO (320 pasos) y posiciones de
// arranque por ángulo áureo — mismo input → mismo dibujo (determinista,
// sin animación ni jank; los datos son lo determinista, la geometría
// es solo render). Clic en nodo → navegar (vuelo + ficha).
// ==============================================================

import {
  forceCollide,
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
} from 'd3-force';
import { getHijos, getObjeto, getPadre, getRelaciones } from './manifest.js';

const NS = 'http://www.w3.org/2000/svg';
const RADIO = { central: 14, padre: 10, hijo: 6.5, vecino: 8 };
const DIST = { broader: 116, contiene: 80, lindero: 134, cerca_de: 134 };
const TRUNC = 16;

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
 * @param {{navegar: Function}} opts - navegar(yvy_id)
 * @returns {HTMLElement} contenedor del SVG del grafo
 */
export function crearGrafoRelaciones(obj, { navegar } = {}) {
  const ancho = 460;
  // El alto acompaña el volumen: 84 hijos (Salta) piden más aire que 3.
  const hijos = getHijos(obj.yvy_id);
  const alto = hijos.length > 50 ? 660 : hijos.length > 24 ? 540 : 420;

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

  // --- simulación determinista (sin timer, sin random visible) ---
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
  const sim = forceSimulation(nodos)
    .force('link', forceLink(enlaces).id((d) => d.id).distance((d) => DIST[d.tipo] || 90).strength(0.55))
    .force('charge', forceManyBody().strength(-260))
    .force('center', forceCenter(ancho / 2, alto / 2))
    .force('collide', forceCollide().radius((d) => RADIO[d.rol] + 11))
    .stop();
  sim.alpha(1);
  for (let i = 0; i < 320; i++) sim.tick();
  // Clamp al lienzo (con margen para el label)
  const M = 34;
  for (const n of nodos) {
    n.x = Math.max(M, Math.min(ancho - M, n.x));
    n.y = Math.max(M, Math.min(alto - M, n.y));
  }

  // --- SVG ---
  const svg = el('svg', {
    viewBox: `0 0 ${ancho} ${alto}`,
    class: 'grafo-svg',
    role: 'img',
    'aria-label': `Grafo de relaciones de ${obj.nombre_oficial}`,
  });

  const gEnlaces = el('g');
  for (const e of enlaces) {
    const clase = e.tipo === 'contiene' ? 'grafo-enlace--contiene' : e.tipo === 'broader' ? 'grafo-enlace--broader' : 'grafo-enlace--lindero';
    gEnlaces.appendChild(el('line', {
      x1: e.source.x.toFixed(1), y1: e.source.y.toFixed(1),
      x2: e.target.x.toFixed(1), y2: e.target.y.toFixed(1),
      class: `grafo-enlace ${clase}`,
    }));
  }
  svg.appendChild(gEnlaces);

  const gNodos = el('g');
  for (const n of nodos) {
    const g = el('g', { transform: `translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})` });
    if (n.rol !== 'central') {
      g.classList.add('grafo-nodo--link');
      g.addEventListener('click', () => {
        if (navegar) navegar(Number(n.id));
      });
    }
    g.appendChild(el('circle', {
      r: RADIO[n.rol],
      class: `grafo-circulo grafo-circulo--${n.rol}`,
      'data-yvy-id': n.id,
    }));
    g.appendChild(el('text', {
      y: RADIO[n.rol] + 10,
      class: `grafo-texto grafo-texto--${n.rol}`,
      'text-anchor': 'middle',
    }, truncar(n.nombre)));
    const tipoHumano = { broader: 'padre' }[n.rol] || n.nivel;
    g.appendChild(el('title', {}, `${n.nombre} · ${tipoHumano}${n.rol !== 'central' ? ' — clic para navegar' : ' (nodo actual)'}`));
    gNodos.appendChild(g);
  }
  svg.appendChild(gNodos);

  // --- contenedor con leyenda (los 3 tipos de arista del vocabulario) ---
  const wrap = document.createElement('div');
  wrap.className = 'grafo-wrap';
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
