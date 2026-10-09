// ==============================================================
// welcome.js — Bienvenida / Command (estilo Palantir)
// Overlay inicial: buscar una jurisdicción o elegir una sugerida.
// Tras elegir, cierra el overlay, navega y abre el árbol.
// ==============================================================

import { getObjetos } from './manifest.js';
import { track } from './telemetry.js';

let navegarHandler = null;
let overlay, input, results, hint, suggestions;

function normalizar(txt) {
  return String(txt || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function escapar(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Busca jurisdicciones por nombre (coincidencia por token/prefix/substring). */
function buscar(q) {
  const nq = normalizar(q);
  if (!nq) return [];
  const objetos = getObjetos();
  const scored = [];
  for (const o of objetos) {
    const nombre = normalizar(o.nombre_oficial);
    if (!nombre) continue;
    if (nombre === nq) scored.push({ o, s: 0 });
    else if (nombre.startsWith(nq)) scored.push({ o, s: 1 });
    else if (nombre.includes(nq)) scored.push({ o, s: 2 });
    else if (String(o.yvy_id).startsWith(nq)) scored.push({ o, s: 1 });
  }
  scored.sort((a, b) => a.s - b.s);
  return scored.slice(0, 12).map((x) => x.o);
}

function etiquetaNivel(nivel) {
  const map = { pais: 'País', provincia: 'Provincia', depto: 'Departamento', municipio: 'Municipio', barrio: 'Barrio', concesion: 'Concesión' };
  return map[nivel] || nivel;
}

function renderResultado(o, onPick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'welcome-result';
  const tipo = etiquetaNivel(o.nivel).toUpperCase();
  const sup = o.sup_oficial_km2 != null ? `${Number(o.sup_oficial_km2).toLocaleString('es-AR', { maximumFractionDigits: 0 })} km²` : '';
  el.innerHTML = `
    <span class="welcome-result__main">
      <span class="welcome-result__nombre">${escapar(o.nombre_oficial)}</span>
      <span class="welcome-result__meta">${escapar(tipo)}${sup ? ` · ${escapar(sup)}` : ''}</span>
    </span>
    <span class="welcome-result__id">yvy:${Number(o.yvy_id)}</span>
  `;
  el.addEventListener('click', () => onPick(o.yvy_id));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onPick(o.yvy_id); } });
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  return el;
}

export function inicializarBienvenida(fnNavegar) {
  navegarHandler = fnNavegar;

  overlay = document.getElementById('welcome');
  input = document.getElementById('welcome-input');
  results = document.getElementById('welcome-results');
  hint = document.getElementById('welcome-hint');
  suggestions = document.getElementById('welcome-suggestions');

  if (!overlay || !input || !results || !hint) return;

  // Provincias sugeridas (ejemplos)
  const sugerencias = ['Salta', 'Jujuy', 'Buenos Aires'];
  const objetos = getObjetos();
  const sugeridos = sugerencias
    .map((n) => objetos.find((o) => normalizar(o.nombre_oficial) === normalizar(n)))
    .filter(Boolean);

  suggestions.innerHTML = '';
  for (const s of sugeridos) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'welcome-chip';
    chip.textContent = s.nombre_oficial;
    chip.addEventListener('click', () => pick(s.yvy_id));
    suggestions.appendChild(chip);
  }

  function pick(yvyId) {
    cerrar();
    // Al elegir: navega (vuelo + ficha con hijos y padres)
    track('pick', { yvy_id: yvyId });
    if (navegarHandler) navegarHandler(yvyId);
  }

  function cerrar() {
    overlay.classList.add('welcome--hide');
    setTimeout(() => overlay.setAttribute('hidden', ''), 220);
  }

  function abrir() {
    // Al abrir el buscador se apaga la ficha (nunca ambas prendidas)
    const pEl = document.getElementById('panel-explorador');
    if (pEl) pEl.hidden = true;
    const bFicha = document.getElementById('btn-ficha');
    if (bFicha) {
      bFicha.setAttribute('aria-expanded', 'false');
      bFicha.classList.remove('is-active');
    }
    overlay.removeAttribute('hidden');
    overlay.classList.remove('welcome--hide');
    input.focus();
    render(input.value.trim());
  }

  function render(q) {
    results.innerHTML = '';
    const found = buscar(q);
    hint.textContent = q ? `${found.length} resultado${found.length === 1 ? '' : 's'}` : '';
    for (const o of found) results.appendChild(renderResultado(o, pick));
    if (q && found.length === 0) {
      track('search_miss', { q_len: q.length });
      const empty = document.createElement('div');
      empty.className = 'welcome-empty';
      empty.textContent = 'Sin coincidencias. Probá con otra jurisdicción o una sugerencia.';
      results.appendChild(empty);
    }
  }

  input.addEventListener('input', () => render(input.value.trim()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = results.querySelector('.welcome-result');
      if (first) first.click();
    }
  });

  // Esc cierra
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hasAttribute('hidden')) cerrar();
  });

  // Reabrir con botón del toolbar
  const btnBuscar = document.getElementById('btn-buscar');
  if (btnBuscar) btnBuscar.addEventListener('click', abrir);

  // Shortcut ctrl/⌘ + K
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      abrir();
    }
  });

  render('');
  abrir();
}