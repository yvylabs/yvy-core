// ==============================================================
// welcome.js — Portada / Command (R13: una pantalla, una acción).
// Una frase, un buscador grande, fuentes reales y accesos reales.
// R14: autocompletado ontológico (Lugares + Datos) y fallback
// honesto: si no tenemos el dato, decimos qué sí hay y con qué fuente.
// Sin jerga de dev en la primera impresión (SPEC §4: cero alucinación).
// ==============================================================

import { getObjetos, getInfoCarga } from './manifest.js';
import { abrirPanelObjeto, sincronizarLayout } from './ui.js';
import { enfocarDataset } from './objeto.js';
import { normalizar, buscarLugares, parsear, datosDe, capacidades, fuenteCorta, fmtNum } from './intencion.js';
import { track } from './telemetry.js';

let navegarHandler = null;
// marcado cuando abrir() esconde una ficha ya mostrada; cerrar() se la
// devuelve (el buscador nunca deja pantalla vacía: ese era el bug B3).
let fichaOcultaPorBuscador = false;
let overlay, input, results, hint, suggestions, fuentesEl, metaEl;
// Token anti-carrera: la respuesta de datosDe() vieja no pinta.
let renderToken = 0;
// Fecha de corte real del manifest (para las fuentes del fallback).
let fechaCorte = '';
// Puente al cerrar() interno: las filas se construyen en scope de módulo.
let cerrarUI = null;

function pick(yvyId) {
  if (cerrarUI) cerrarUI();
  track('pick', { yvy_id: yvyId });
  if (navegarHandler) navegarHandler(yvyId);
}

function abrirDato(entidad, tipo) {
  track('pick', { yvy_id: entidad.yvy_id, dataset: tipo });
  enfocarDataset(tipo);
  if (cerrarUI) cerrarUI();
  if (navegarHandler) navegarHandler(entidad.yvy_id);
}

const NOMBRE_NIVEL = {
  pais: 'País', provincia: 'Provincia', depto: 'Departamento', municipio: 'Municipio', barrio: 'Barrio', concesion: 'Concesión',
};
const NOMBRE_DATO = { demografia: 'Demografía', catastro: 'Catastro', mineria: 'Minería' };

function escapar(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function metaLugar(o) {
  const partes = [NOMBRE_NIVEL[o.nivel] || o.nivel];
  if (o.sup_oficial_km2 != null) partes.push(`${fmtNum(Math.round(Number(o.sup_oficial_km2)))} km²`);
  return partes.join(' · ');
}

function fila(html, onClick, extraClass = '') {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `welcome-result${extraClass ? ` ${extraClass}` : ''}`;
  el.innerHTML = html;
  el.addEventListener('click', onClick);
  return el;
}

function filaLugar(o) {
  return fila(`
    <span class="welcome-result__main">
      <span class="welcome-result__nombre">${escapar(o.nombre_oficial)}</span>
      <span class="welcome-result__meta">${escapar(metaLugar(o))}</span>
    </span>
    <span class="welcome-result__go" aria-hidden="true">↵</span>
  `, () => pick(o.yvy_id));
}

function filaDato(entidad, d) {
  const fuente = d.fuente ? ` · ${fuenteCorta(d.fuente)}` : '';
  return fila(`
    <span class="welcome-result__main">
      <span class="welcome-result__nombre"><i class="welcome-dot" aria-hidden="true"></i>${escapar(d.nombre)} en ${escapar(entidad.nombre_oficial)}</span>
      <span class="welcome-result__meta">${escapar(d.texto)}${escapar(fuente)}</span>
    </span>
    <span class="welcome-result__go" aria-hidden="true">↗</span>
  `, () => abrirDato(entidad, d.tipo), 'welcome-result--dato');
}

function filaRelacion(entidad, relacion) {
  const esLindero = relacion === 'lindero';
  return fila(`
    <span class="welcome-result__main">
      <span class="welcome-result__nombre">${esLindero ? 'Limita con' : 'Contiene'} · ${escapar(entidad.nombre_oficial)}</span>
      <span class="welcome-result__meta">${esLindero ? 'Ver los límites reales del catálogo' : 'Ver las subdivisiones reales'}</span>
    </span>
    <span class="welcome-result__go" aria-hidden="true">↵</span>
  `, () => pick(entidad.yvy_id), 'welcome-result--dato');
}

function grupo(titulo, filas) {
  const g = document.createElement('div');
  g.className = 'welcome-group';
  const l = document.createElement('span');
  l.className = 'welcome-group__label';
  l.textContent = titulo;
  g.appendChild(l);
  for (const f of filas) g.appendChild(f);
  return g;
}

function chipDato(entidad, d) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'welcome-chip welcome-chip--dato';
  b.innerHTML = `<span class="welcome-chip__nombre">${escapar(d.nombre)}</span><span class="welcome-chip__meta">${escapar(d.texto)}</span>`;
  b.addEventListener('click', () => abrirDato(entidad, d.tipo));
  return b;
}

function tarjetaFallback(titulo, detalle, chips = [], pie = null) {
  const c = document.createElement('div');
  c.className = 'welcome-fallback';
  const h = document.createElement('p');
  h.className = 'welcome-fallback__title';
  h.textContent = titulo;
  c.appendChild(h);
  if (detalle) {
    const p = document.createElement('p');
    p.className = 'welcome-fallback__detalle';
    p.textContent = detalle;
    c.appendChild(p);
  }
  if (chips.length) {
    const row = document.createElement('div');
    row.className = 'welcome-fallback__chips';
    for (const ch of chips) row.appendChild(ch);
    c.appendChild(row);
  }
  if (pie) {
    const p = document.createElement('p');
    p.className = 'welcome-fallback__pie';
    p.textContent = pie;
    c.appendChild(p);
  }
  return c;
}

export function inicializarBienvenida(fnNavegar) {
  navegarHandler = fnNavegar;

  overlay = document.getElementById('welcome');
  input = document.getElementById('welcome-input');
  results = document.getElementById('welcome-results');
  hint = document.getElementById('welcome-hint');
  suggestions = document.getElementById('welcome-suggestions');
  fuentesEl = document.getElementById('welcome-fuentes');
  metaEl = document.getElementById('welcome-meta');

  if (!overlay || !input || !results || !hint) return;

  // Accesos a cosas REALES del manifest (nada inventado).
  const objetos = getObjetos();
  const sugeridos = ['Salta', 'Jujuy']
    .map((n) => objetos.find((o) => o.nombre_oficial === n))
    .filter(Boolean);

  suggestions.innerHTML = '';
  for (const s of sugeridos) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'welcome-chip';
    chip.textContent = `Explorar ${s.nombre_oficial}`;
    chip.addEventListener('click', () => pick(s.yvy_id));
    suggestions.appendChild(chip);
  }
  const salta = sugeridos.find((o) => o.nombre_oficial === 'Salta');
  if (salta) {
    const chipM = document.createElement('button');
    chipM.type = 'button';
    chipM.className = 'welcome-chip welcome-chip--dato';
    chipM.textContent = 'Minería en Salta';
    chipM.addEventListener('click', () => abrirDato(salta, 'mineria'));
    suggestions.appendChild(chipM);
  }

  // Panel de capacidades (R14): fuentes declaradas en el manifest.
  // Calibra la expectativa ANTES de que el usuario escriba.
  if (fuentesEl) {
    const caps = capacidades();
    fuentesEl.innerHTML = '<span class="welcome__fuentes-label">Fuentes integradas</span>'
      + caps.map((c) => `<span class="welcome__fuente">${escapar(c.nombre)}${c.fuente ? ` <em>${escapar(fuenteCorta(c.fuente))}</em>` : ''}</span>`).join('')
      + '<span class="welcome__fuente welcome__fuente--prox">Próximamente: Escuelas, Salud</span>';
  }

  // Meta discreta al pie (dato real, no grito de portada).
  const info = getInfoCarga();
  if (info && info.generado) {
    const d = new Date(info.generado);
    fechaCorte = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    if (metaEl) {
      metaEl.textContent = `${fmtNum(info.nObjetos)} nodos · actualizado ${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    }
  }

  cerrarUI = cerrar;

  function marcarModo(modo) {
    if (!overlay) return;
    overlay.classList.toggle('welcome--command', modo === 'command');
    if (modo) document.documentElement.dataset.welcome = modo;
    else delete document.documentElement.dataset.welcome;
  }

  function cerrar() {
    const devolverFicha = fichaOcultaPorBuscador;
    fichaOcultaPorBuscador = false;
    const bBuscar = document.getElementById('btn-buscar');
    if (bBuscar) bBuscar.setAttribute('aria-expanded', 'false');
    overlay.classList.add('welcome--hide');
    setTimeout(() => {
      overlay.setAttribute('hidden', '');
      marcarModo(null);
      if (devolverFicha) abrirPanelObjeto();
      else sincronizarLayout(); // sin ficha: el dock se oculta (mapa completo)
    }, 220);
    sincronizarLayout();
  }

  function abrir(modo = 'command') {
    // Al abrir el buscador se apaga la ficha (nunca ambas prendidas).
    // Si había ficha mostrada, cerrar() se la devuelve al usuario.
    const pEl = document.getElementById('panel-explorador');
    fichaOcultaPorBuscador = !!(pEl && !pEl.hidden);
    if (pEl) pEl.hidden = true;
    const bFicha = document.getElementById('btn-ficha');
    if (bFicha) {
      bFicha.setAttribute('aria-expanded', 'false');
      bFicha.classList.remove('is-active');
    }
    const bBuscar = document.getElementById('btn-buscar');
    if (bBuscar) bBuscar.setAttribute('aria-expanded', 'true');
    overlay.removeAttribute('hidden');
    overlay.classList.remove('welcome--hide');
    marcarModo(modo);
    input.focus();
    render(input.value.trim());
    sincronizarLayout();
  }

  async function render(q) {
    const token = ++renderToken;
    const limpio = q.trim();
    results.innerHTML = '';
    if (overlay) overlay.classList.toggle('welcome--buscando', !!limpio);
    if (!limpio) {
      results.hidden = true;
      hint.textContent = '';
      return;
    }
    results.hidden = false;

    const p = parsear(limpio);
    const lugares = buscarLugares(p.frase || limpio, 6);
    const entidad = p.entidad || lugares[0] || null;
    const datos = entidad ? await datosDe(entidad) : [];
    if (token !== renderToken) return; // otra tecla ganó

    // Lugares: sin repetir la entidad ya usada como contexto (mismo id o
    // mismo nombre: provincia y municipio homónimos son objetos distintos).
    // Sin intención de dato, la entidad va PRIMERO: Enter abre el lugar,
    // no un dataset (escribir "salta" y caer en Demografía era un bug).
    const nEnt = entidad ? normalizar(entidad.nombre_oficial) : '';
    const otros = lugares.filter((o) => o.yvy_id !== entidad?.yvy_id && normalizar(o.nombre_oficial) !== nEnt);
    const lugaresVisibles = p.dataset || p.relacion
      ? otros.slice(0, 2)
      : (entidad ? [entidad, ...otros] : otros).slice(0, 6);

    // Palabra desconocida ("salta autos"): la respuesta honesta ES la
    // tarjeta con lo que sí hay; no se mezcla con filas de datos sueltas.
    if (entidad && p.sobrantes.length) {
      const fuentes = [...new Set(datos.map((d) => fuenteCorta(d.fuente)).filter(Boolean))];
      results.appendChild(tarjetaFallback(
        `No tengo «${p.sobrantes.join(' ')}» para ${entidad.nombre_oficial}.`,
        datos.length ? `Para ${entidad.nombre_oficial} tengo:` : `Todavía no tengo datasets para ${entidad.nombre_oficial}.`,
        datos.map((d) => chipDato(entidad, d)),
        fuentes.length ? `Fuentes: ${fuentes.join(' · ')}${fechaCorte ? ` · actualizado ${fechaCorte}` : ''}` : null,
      ));
      if (lugaresVisibles.length) results.appendChild(grupo('Lugares', lugaresVisibles.map(filaLugar)));
      hint.textContent = '';
      track('search_miss', { q_len: limpio.length, motivo: 'sin_dataset', dataset: p.dataset || undefined });
      return;
    }

    const datosPedidos = p.dataset ? datos.filter((d) => d.tipo === p.dataset) : datos;
    const bloques = [];

    // 1) Dataset pedido explícitamente ("salta minería"): primero.
    if (p.dataset && entidad && datosPedidos.length) {
      bloques.push(grupo(`Datos de ${entidad.nombre_oficial}`, datosPedidos.map((d) => filaDato(entidad, d))));
    }

    // 1b) Relación explícita ("anta limita" / "salta contiene"): el
    // dossier ya muestra linderos y subdivisiones reales.
    if (p.relacion && entidad) {
      bloques.push(grupo('Relaciones', [filaRelacion(entidad, p.relacion)]));
    }

    // 2) Lugares.
    if (lugaresVisibles.length) bloques.push(grupo('Lugares', lugaresVisibles.map(filaLugar)));

    // 3) Resto de datasets de la entidad (si no pidió uno puntual).
    if (!p.dataset && entidad && datos.length) {
      bloques.push(grupo(`Datos de ${entidad.nombre_oficial}`, datos.map((d) => filaDato(entidad, d))));
    }

    const total = bloques.reduce((s, b) => s + b.querySelectorAll('.welcome-result').length, 0);
    hint.textContent = total ? `${total} resultado${total === 1 ? '' : 's'}` : '';

    if (total > 0) {
      for (const b of bloques) results.appendChild(b);
      return;
    }

    // Fallback determinístico (R14): nunca "no encontré" a secas.
    let motivo = 'sin_lugar';
    let tarjeta;
    if (entidad && p.sobrantes.length) {
      motivo = 'sin_dataset';
      tarjeta = tarjetaFallback(
        `No tengo «${p.sobrantes.join(' ')}» para ${entidad.nombre_oficial}.`,
        datos.length ? `Para ${entidad.nombre_oficial} tengo:` : `Todavía no tengo datasets para ${entidad.nombre_oficial}.`,
        datos.map((d) => chipDato(entidad, d)),
      );
    } else if (entidad && p.dataset && !datosPedidos.length) {
      motivo = 'sin_dato';
      tarjeta = tarjetaFallback(
        `No tengo ${NOMBRE_DATO[p.dataset] || p.dataset} para ${entidad.nombre_oficial}.`,
        datos.length ? `Para ${entidad.nombre_oficial} tengo:` : null,
        datos.map((d) => chipDato(entidad, d)),
      );
    } else if (p.dataset && !entidad) {
      motivo = 'sin_lugar';
      tarjeta = tarjetaFallback(
        `¿${NOMBRE_DATO[p.dataset] || p.dataset} de dónde?`,
        'Elegí una jurisdicción para ver ese dataset.',
      );
    } else {
      tarjeta = tarjetaFallback(
        `No encontré «${limpio}».`,
        'Probá con una provincia, un departamento o un municipio.',
      );
    }
    results.appendChild(tarjeta);
    track('search_miss', { q_len: limpio.length, motivo, dataset: p.dataset || undefined });
  }

  input.addEventListener('input', () => render(input.value.trim()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = results.querySelector('.welcome-result');
      if (first) first.click();
    }
  });

  const btnGo = document.getElementById('welcome-go');
  if (btnGo) {
    btnGo.addEventListener('click', () => {
      const first = results.querySelector('.welcome-result');
      if (first) first.click();
      else input.focus();
    });
  }

  // Esc cierra
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hasAttribute('hidden')) cerrar();
  });

  // Tocar fuera de la tarjeta también cierra (en móvil no hay Esc).
  const scrim = overlay.querySelector('.welcome__scrim');
  if (scrim) scrim.addEventListener('click', cerrar);

  // Foco atrapado: la portada cubre la app, así que Tab no debe irse
  // al mapa o al grafo que están detrás del velo.
  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const foco = [...overlay.querySelectorAll('button, input, [href]')]
      .filter((el) => el.offsetParent !== null && !el.disabled);
    if (!foco.length) return;
    const primero = foco[0];
    const ultimo = foco[foco.length - 1];
    if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  });

  // Reabrir con botón del toolbar (modo command: sin scrim pesado)
  const btnBuscar = document.getElementById('btn-buscar');
  if (btnBuscar) btnBuscar.addEventListener('click', () => abrir('command'));

  // Shortcut ctrl/⌘ + K
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      abrir('command');
    }
  });

  // PORTADA (R13): una sola pantalla al arranque. Al elegir, pick() la
  // cierra; Ctrl+K / btn-buscar la reabren en modo command.
  // Con permalink a un objeto la ficha ya manda: la portada no la tapa.
  const conObjeto = /[#&]y=\d+/.test(location.hash);
  if (!conObjeto) abrir('portada');
}

/**
 * Cierra la bienvenida si está abierta (ej. al restaurar un permalink, donde
 * la ficha ya muestra el objeto y el modal solo tapa). Idempotente.
 */
export function cerrarBienvenida() {
  if (!overlay || overlay.hasAttribute('hidden')) return;
  overlay.classList.add('welcome--hide');
  setTimeout(() => {
    overlay.setAttribute('hidden', '');
    delete document.documentElement.dataset.welcome;
    // El dock re-evalúa al ocultarse el overlay: dossier abierto → 'dossier',
    // sin ficha → 'oculto' (nunca queda clavado en el valor transitorio).
    sincronizarLayout();
  }, 220);
}

/** Reabre el start screen (logo/brand: volver al globo + panel inicial). */
export function mostrarBienvenida() {
  if (!overlay) return;
  overlay.classList.remove('welcome--hide');
  overlay.removeAttribute('hidden');
  overlay.classList.remove('welcome--command');
  document.documentElement.dataset.welcome = 'portada';
  if (input) input.focus();
  sincronizarLayout();
}
