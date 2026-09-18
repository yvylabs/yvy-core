// ==============================================================
// assistant.js — Motor de Inferencia sobre la Ontología Geoespacial (0ms)
// Parser determinístico de 4 intenciones: NAVEGAR | FICHA | FFCC | COMPARAR
// Cero latencia, cero costo, cero alucinaciones de LLM.
// ==============================================================

import { getObjetos, getObjeto } from './manifest.js';
import { mostrarObjeto, compararObjetos } from './objeto.js';
import { resolverEstado } from './datasets.js';

let mapInstance = null;
let navegarHandler = null;

function normalizarTexto(txt) {
  return String(txt || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Busca el objeto Yvy que mejor coincida con el nombre.
 */
function buscarObjetoPorNombre(query) {
  const q = normalizarTexto(query);
  if (!q) return null;
  const objetos = getObjetos();

  // 1. Coincidencia exacta
  let match = objetos.find((o) => normalizarTexto(o.nombre_oficial) === q);
  if (match) return match;

  // 2. Coincidencia por palabra/token exacto (ej: "Anta" no matchea "Santa Fe")
  match = objetos.find((o) => {
    const tokens = normalizarTexto(o.nombre_oficial).split(/\s+/);
    return tokens.includes(q);
  });
  if (match) return match;

  // 3. Comienza con
  match = objetos.find((o) => normalizarTexto(o.nombre_oficial).startsWith(q));
  if (match) return match;

  // 4. Substring
  return objetos.find((o) => normalizarTexto(o.nombre_oficial).includes(q));
}

/**
 * Parser de intenciones sobre la ontología.
 * @param {string} prompt 
 * @returns {{ intent: string, mensaje: string, datos?: any }}
 */
export function parsearIntencion(prompt) {
  const p = normalizarTexto(prompt);

  // Intent 3: FFCC — solo dato (sin render, a pedido del usuario)
  if (p.includes('ffcc') || p.includes('tren') || p.includes('ferrocarril') || p.includes('vias') || p.includes('ferrovia')) {
    // Si el usuario menciona una jurisdicción junto a ffcc, mostrar su dato km
    const sinFFCC = p.replace(/ffcc|trenes?|ferrocarril|vias|ferrovia/g, '').trim();
    const obj = sinFFCC ? buscarObjetoPorNombre(sinFFCC) : null;
    if (obj) {
      const km = obj.km_ffcc_total ? `${Number(String(obj.km_ffcc_total).replace(',','.')).toLocaleString('es-AR')} km` : 'sin dato';
      return { intent: 'FFCC', mensaje: `**${obj.nombre_oficial}** — Red ferroviaria: **${km}** (dato oficial, sin trazo en mapa).` };
    }
    return { intent: 'FFCC', mensaje: 'Dato de red ferroviaria disponible en la ficha de cada jurisdicción (ej: `ficha de Córdoba` muestra `RED FERROVIARIA`). El trazo en mapa está desactivado a pedido.' };
  }

  // Intent 4: COMPARAR (dos entidades)
  if (p.includes('comparar') || p.includes('diferencia entre') || p.includes('vs')) {
    // Extraer nombres divididos por "y", "con", "vs"
    const partes = p.replace(/comparar|diferencia entre|vs/g, '').split(/\s+(?:y|con|vs)\s+/);
    if (partes.length >= 2) {
      const objA = buscarObjetoPorNombre(partes[0]);
      const objB = buscarObjetoPorNombre(partes[1]);
      if (objA && objB) {
        const comp = compararObjetos(objA.yvy_id, objB.yvy_id);
        return {
          intent: 'COMPARAR',
          mensaje: `Comparación entre **${objA.nombre_oficial}** y **${objB.nombre_oficial}**:`,
          datos: comp,
        };
      }
    }
  }

  // Intent 2: FICHA (Detalle de entidad)
  if (p.includes('ficha') || p.includes('datos de') || p.includes('info de') || p.includes('informacion de')) {
    const limpio = p.replace(/ficha de|ficha|datos de|info de|informacion de/g, '').trim();
    const obj = buscarObjetoPorNombre(limpio);
    if (obj) {
      mostrarObjeto(obj.yvy_id);
      if (navegarHandler) navegarHandler(obj.yvy_id);
      return {
        intent: 'FICHA',
        mensaje: `Ficha de **${obj.nombre_oficial}** desplegada en el panel.`,
      };
    }
  }

  // Intent 1: NAVEGAR (Vuelo / Foco en mapa)
  const busquedaLimpia = p.replace(/ir a|ver|volar a|buscar/g, '').trim();
  const obj = buscarObjetoPorNombre(busquedaLimpia || p);
  if (obj) {
    if (navegarHandler) navegarHandler(obj.yvy_id);
    return {
      intent: 'NAVEGAR',
      mensaje: `Navegando a **${obj.nombre_oficial}** (${obj.nivel.toUpperCase()}).`,
    };
  }

  // Sin match: no genérico. Si no existe como jurisdicción ni como
  // dataset declarado, es missing ("No tengo ese dato todavía").
  const { mensaje } = resolverEstado('__desconocido__');
  return {
    intent: 'DESCONOCIDO',
    mensaje,
  };
}

/**
 * Inicializa la UI del Asistente y sus listeners.
 */
export function inicializarAsistente(map, fnNavegar) {
  mapInstance = map;
  navegarHandler = fnNavegar;

  const panel = document.getElementById('panel-asistente');
  const input = document.getElementById('assistant-input');
  const sendBtn = document.getElementById('assistant-send');
  const body = document.getElementById('assistant-body');

  if (!panel || !input || !body) return;

  function agregarMensaje(usuarioText, resultado) {
    if (usuarioText) {
      const userMsg = document.createElement('div');
      userMsg.className = 'assistant-message assistant-message--user';
      userMsg.textContent = usuarioText;
      body.appendChild(userMsg);
    }

    const sysMsg = document.createElement('div');
    sysMsg.className = 'assistant-message assistant-message--system';

    const intentTag = document.createElement('div');
    intentTag.className = 'assistant-message__intent';
    intentTag.textContent = `[INTENT: ${resultado.intent}]`;
    sysMsg.appendChild(intentTag);

    const txt = document.createElement('div');
    txt.innerHTML = resultado.mensaje.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    sysMsg.appendChild(txt);

    if (resultado.intent === 'COMPARAR' && resultado.datos) {
      const compCard = document.createElement('div');
      compCard.className = 'comparison-card';
      const d = resultado.datos;
      compCard.innerHTML = `
        <div class="comparison-col">
          <div class="comparison-col__title">${d.a.nombre}</div>
          <div><span class="comparison-col__lbl">POB:</span> <span class="comparison-col__val">${d.a.poblacion}</span></div>
          <div><span class="comparison-col__lbl">SUP:</span> ${d.a.sup}</div>
          <div><span class="comparison-col__lbl">FFCC:</span> ${d.a.ffcc} km</div>
        </div>
        <div class="comparison-col">
          <div class="comparison-col__title">${d.b.nombre}</div>
          <div><span class="comparison-col__lbl">POB:</span> <span class="comparison-col__val">${d.b.poblacion}</span></div>
          <div><span class="comparison-col__lbl">SUP:</span> ${d.b.sup}</div>
          <div><span class="comparison-col__lbl">FFCC:</span> ${d.b.ffcc} km</div>
        </div>
      `;
      sysMsg.appendChild(compCard);
    }

    body.appendChild(sysMsg);
    body.scrollTop = body.scrollHeight;
  }

  function procesarConsulta(text) {
    if (!text || !text.trim()) return;
    const res = parsearIntencion(text);
    agregarMensaje(text, res);
    input.value = '';
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      procesarConsulta(input.value);
    }
  });

  if (sendBtn) {
    sendBtn.addEventListener('click', () => procesarConsulta(input.value));
  }

  // Chips de acciones rápidas
  const chips = document.querySelectorAll('[data-assistant-prompt]');
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-assistant-prompt');
      if (prompt) procesarConsulta(prompt);
    });
  });
}
