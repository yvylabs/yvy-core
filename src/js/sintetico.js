// ==============================================================
// sintetico.js — Red sintética del welcome (solo render).
// Las 24 provincias proyectadas sobre sus centro_etiqueta reales,
// girando con el globo: la red de linderos dibuja la silueta de
// Argentina sobre la Tierra. PURAMENTE VISUAL: nodo + nombre, sin
// números ni métricas (el inicio no es un dashboard; el dato se
// descubre al buscar o hacer clic, SPEC §4 determinismo).
// d3-force solo RELAJA etiquetas colisionadas al descansar el
// vuelo; la posición geográfica manda (candidate: no constelación).
// ==============================================================

import { getObjetos, getRelaciones, navegarA } from './manifest.js';
import { forceSimulation, forceCollide, forceManyBody, forceX, forceY } from 'd3-force';
import { track } from './telemetry.js';

const NS = 'http://www.w3.org/2000/svg';
const ZONA_NOMBRES = 190; // px de bbox de provincias para mostrar nombres

let svg = null;
let gEnlaces = null;
let gNodos = null;
let nodos = [];
let enlaces = [];
let mapa = null;
let observer = null;
let sim = null;
let relajadoTimer = null;
let activo = false;
let pinturaOceanoOriginal = null;

/** Construye nodos (24 provincias) y aristas (linderos reales, pares únicos). */
function construirRed() {
  const provs = getObjetos().filter((o) => o.nivel === 'provincia');
  nodos = provs.map((o) => {
    const c = Array.isArray(o.centro_etiqueta) && o.centro_etiqueta.length === 2 ? o.centro_etiqueta : o.centro;
    return {
      id: o.yvy_id,
      nombre: o.nombre_oficial,
      lonlat: Array.isArray(c) ? [Number(c[0]), Number(c[1])] : null,
      x: 0, y: 0, // ancla geográfica proyectada (la fuente de verdad)
      g: null, nucleo: null, halo: null, linea: null,
    };
  }).filter((n) => n.lonlat && isFinite(n.lonlat[0]) && isFinite(n.lonlat[1]));
  const porId = new Map(nodos.map((n) => [n.id, n]));
  const vistos = new Set();
  enlaces = [];
  for (const p of provs) {
    for (const r of getRelaciones(p.yvy_id)) {
      if (r.tipo !== 'lindero') continue;
      if (!porId.has(r.destino_yvy_id)) continue;
      const a = Math.min(p.yvy_id, r.destino_yvy_id);
      const b = Math.max(p.yvy_id, r.destino_yvy_id);
      const k = `${a}-${b}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      enlaces.push({ s: porId.get(p.yvy_id), t: porId.get(r.destino_yvy_id), line: null });
    }
  }
}

/** Monta el SVG sobre la columna del mapa (bajo el toolbar, junto al canvas). */
function montarSVG() {
  svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'sintetico-red');
  svg.setAttribute('aria-hidden', 'true');
  gEnlaces = document.createElementNS(NS, 'g');
  gNodos = document.createElementNS(NS, 'g');
  svg.appendChild(gEnlaces);
  svg.appendChild(gNodos);
  for (const e of enlaces) {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('class', 'sintetico__enlace');
    e.line = line;
    gEnlaces.appendChild(line);
  }
  for (const n of nodos) {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'sintetico__nodo');
    const halo = document.createElementNS(NS, 'circle');
    halo.setAttribute('class', 'sintetico__halo');
    halo.setAttribute('r', '10.8'); // fallback: CSS r (var) lo gana
    const nucleo = document.createElementNS(NS, 'circle');
    nucleo.setAttribute('class', 'sintetico__nucleo');
    nucleo.setAttribute('r', '4.5'); // fallback: CSS r (var) lo gana
    const texto = document.createElementNS(NS, 'text');
    texto.setAttribute('class', 'sintetico__etiqueta');
    texto.setAttribute('text-anchor', 'middle');
    texto.setAttribute('dy', '-9');
    texto.textContent = n.nombre;
    const title = document.createElementNS(NS, 'title');
    title.textContent = n.nombre; // tooltip accesible: SOLO el nombre
    g.appendChild(halo);
    g.appendChild(nucleo);
    g.appendChild(texto);
    g.appendChild(title);
    g.addEventListener('click', () => {
      ocultar(); // la red se desvanece y el globo vuela al territorio
      track('pick', { yvy_id: n.id, origen: 'grafo_sintetico' });
      navegarA(n.id);
    });
    n.g = g;
    n.nucleo = nucleo;
    n.halo = halo;
    n.linea = texto;
    gNodos.appendChild(g);
  }
}

/** ¿Está el punto en el hemisferio visible del globo (cara opuesta oculta)? */
function visible(lonlat) {
  try {
    const c = mapa.getCenter();
    const r1 = (lonlat[1] * Math.PI) / 180;
    const r2 = (c.lat * Math.PI) / 180;
    const dLat = r1 - r2;
    const dLon = ((lonlat[0] - c.lng) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(r1) * Math.cos(r2) * Math.sin(dLon / 2) ** 2;
    return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) < Math.PI / 2;
  } catch {
    return true;
  }
}

/** Re-proyecta todo en cada frame del globo (la red gira con la Tierra). */
function ensamblar() {
  if (!activo || !mapa || !svg) return;
  const z = mapa.getZoom();
  const radio = Math.max(2.2, Math.min(5.5, 2.2 + (z - 2) * 1.2));
  const anchoEnlace = Math.max(0.7, Math.min(1.5, (z - 1) * 0.45));
  svg.style.setProperty('--sint-radio', radio.toFixed(2));
  svg.style.setProperty('--sint-enlace', anchoEnlace.toFixed(2));
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const n of nodos) {
    const p = mapa.project(n.lonlat);
    n.x = p.x;
    n.y = p.y;
    const aLaVista = visible(n.lonlat);
    n.enVista = aLaVista;
    n.g.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
    n.g.style.opacity = aLaVista ? '1' : '0';
    n.g.style.pointerEvents = aLaVista && activo ? 'auto' : 'none';
    if (aLaVista) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  // Nombres solo cuando la geografía entra en pantalla: red fina al
  // abrir, nombres al acercar (transición CSS de opacidad por clase).
  const cajaAlta = maxY > -1e8 ? maxY - minY : 0;
  svg.classList.toggle('sintetico-red--lejos', cajaAlta < ZONA_NOMBRES);
  for (const e of enlaces) {
    const losDos = e.s.enVista && e.t.enVista;
    e.line.setAttribute('x1', e.s.x.toFixed(1));
    e.line.setAttribute('y1', e.s.y.toFixed(1));
    e.line.setAttribute('x2', e.t.x.toFixed(1));
    e.line.setAttribute('y2', e.t.y.toFixed(1));
    e.line.style.opacity = losDos ? '1' : '0';
  }
}

/** Radio de colisión por nodo: núcleo + ancho de su etiqueta (aprox mono). */
function radioCol(d) {
  const lejos = svg.classList.contains('sintetico-red--lejos');
  if (lejos) return 10;
  return Math.max(12, 6 + d.n.nombre.length * 2.6);
}

/**
 * Relajación d3-force al descansar el vuelo: afloja etiquetas colisionadas
 * con anclas fuertes hacia la posición proyectada (poca deriva, sin
 * constelación). En cada 'move' se re-ensambla a geografía pura.
 */
function relajar() {
  if (!activo || !svg) return;
  if (relajadoTimer) clearTimeout(relajadoTimer);
  relajadoTimer = setTimeout(() => {
    if (!activo || !svg) return;
    if (sim) sim.stop();
    const piezas = nodos.map((n) => ({ n, ax: n.x, ay: n.y, x: n.x, y: n.y }));
    sim = forceSimulation(piezas)
      .force('x', forceX((d) => d.ax).strength(0.7))
      .force('y', forceY((d) => d.ay).strength(0.7))
      .force('col', forceCollide((d) => radioCol(d)).strength(0.6))
      .force('rep', forceManyBody().strength(-16).distanceMax(46))
      .alphaDecay(0.08);
    sim.on('tick', () => {
      for (const p of piezas) {
        p.n.g.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
      }
      for (const e of enlaces) {
        // Las aristas siguen los nodos relajados (mantienen la topología)
        const ps = piezas.find((p) => p.n === e.s);
        const pt = piezas.find((p) => p.n === e.t);
        if (!ps || !pt) continue;
        e.line.setAttribute('x1', ps.x.toFixed(1));
        e.line.setAttribute('y1', ps.y.toFixed(1));
        e.line.setAttribute('x2', pt.x.toFixed(1));
        e.line.setAttribute('y2', pt.y.toFixed(1));
      }
    });
  }, 120);
}

/** Océano azul-noche SOLO mientras la red vuela encima (render temporal). */
function pintarOceano(noche) {
  if (!mapa) return;
  try {
    if (noche) {
      if (pinturaOceanoOriginal) return; // ya en noche
      const fondo = mapa.getLayer('background') ? mapa.getPaintProperty('background', 'background-color') : null;
      const agua = mapa.getLayer('water') ? mapa.getPaintProperty('water', 'fill-color') : null;
      if (!mapa.getLayer('background') && !mapa.getLayer('water')) return; // estilo sin océano dibujable: como está
      pinturaOceanoOriginal = { fondo, agua };
      if (mapa.getLayer('background')) mapa.setPaintProperty('background', 'background-color', '#0E1526');
      if (mapa.getLayer('water')) mapa.setPaintProperty('water', 'fill-color', '#0E1526');
    } else if (pinturaOceanoOriginal) {
      if (mapa.getLayer('background') && pinturaOceanoOriginal.fondo != null) {
        mapa.setPaintProperty('background', 'background-color', pinturaOceanoOriginal.fondo);
      }
      if (mapa.getLayer('water') && pinturaOceanoOriginal.agua != null) {
        mapa.setPaintProperty('water', 'fill-color', pinturaOceanoOriginal.agua);
      }
      pinturaOceanoOriginal = null;
    }
  } catch { /* estilo sin esas capas: quedar como está, determinista */ }
}

function mostrar() {
  if (!svg || !mapa || activo) return;
  activo = true;
  svg.classList.remove('sintetico-red--off');
  pintarOceano(true);
  mapa.on('move', ensamblar);
  mapa.on('moveend', relajar);
  mapa.on('resize', ensamblar);
  ensamblar();
  relajar();
}

function ocultar() {
  if (!svg || !activo) return;
  activo = false;
  svg.classList.add('sintetico-red--off');
  if (sim) sim.stop();
  if (relajadoTimer) clearTimeout(relajadoTimer);
  if (mapa) {
    mapa.off('move', ensamblar);
    mapa.off('moveend', relajar);
    mapa.off('resize', ensamblar);
  }
  pintarOceano(false);
}

/** Punto de entrada: monta la red y observa el estado del dock. */
export function inicializarSintetico() {
  if (svg) return; // idempotente
  const col = document.getElementById('mapa-col');
  if (!col) return;
  construirRed();
  montarSVG();
  col.appendChild(svg);

  observer = new MutationObserver(() => {
    const estado = document.documentElement.getAttribute('data-dock');
    if (estado === 'welcome') mostrar();
    else ocultar();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-dock'] });

  // Mapa: puede estar cargando el estilo; reintento acotado, determinista.
  let intentos = 0;
  const esperarMapa = () => {
    mapa = window.yvyMap || null;
    if (mapa) {
      if (document.documentElement.getAttribute('data-dock') === 'welcome') mostrar();
      return;
    }
    if (intentos++ < 40) setTimeout(esperarMapa, 250);
  };
  esperarMapa();
}
