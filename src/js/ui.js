// ==============================================================
// ui.js
// Gestiona la apertura/cierre de los paneles flotantes
// (Explorador, Objeto, Medición) desde el toolbar izquierdo.
// ==============================================================

const PANEL_DEFS = [
  { btn: 'btn-ficha',       panel: 'panel-explorador', cerrarFuera: false },
  { btn: 'btn-asistente',   panel: 'panel-asistente'   },
  { btn: 'btn-medir',       panel: 'panel-medir', cerrarFuera: false },
];

let abiertoActual = null;

function setPanelAbierto(panelId, btnId) {
  // Cerrar todo y re-abrir el pedido (toggle si ya estaba abierto)
  const yaAbierto = abiertoActual === panelId;

  PANEL_DEFS.forEach(({ btn, panel }) => {
    const bEl = document.getElementById(btn);
    const pEl = document.getElementById(panel);
    if (bEl) bEl.setAttribute('aria-expanded', 'false');
    if (bEl) bEl.classList.remove('is-active');
    if (pEl) pEl.hidden = true;
  });

  if (yaAbierto) {
    abiertoActual = null;
    return;
  }

  const bEl = document.getElementById(btnId);
  const pEl = document.getElementById(panelId);
  if (bEl) {
    bEl.setAttribute('aria-expanded', 'true');
    bEl.classList.add('is-active');
  }
  if (pEl) pEl.hidden = false;
  abiertoActual = panelId;
}

/**
 * Inicializa el comportamiento de los botones del toolbar izq,
 * el cierre (✕) de los paneles, click fuera y Esc.
 */
export function inicializarUIPaneles() {
  PANEL_DEFS.forEach(({ btn, panel }) => {
    const bEl = document.getElementById(btn);
    if (bEl) bEl.addEventListener('click', () => setPanelAbierto(panel, btn));
  });

  // Botones ✕ dentro de cada panel (.floating-panel__close o .assistant-panel__close)
  document.querySelectorAll('.floating-panel__close, .assistant-panel__close').forEach((c) => {
    c.addEventListener('click', () => {
      const pEl = c.closest('.floating-panel, .assistant-panel');
      if (!pEl) return;
      const def = PANEL_DEFS.find((d) => d.panel === pEl.id);
      if (def) setPanelAbierto(def.panel, def.btn); // toggle => cierra
    });
  });

  // Cerrar paneles al clickear fuera (mapa / resto del body)
  document.addEventListener('click', (e) => {
    if (!abiertoActual) return;
    const pEl = document.getElementById(abiertoActual);
    if (pEl && pEl.contains(e.target)) return;
    if (e.target.closest('.toolbar')) return;
    const def = PANEL_DEFS.find((d) => d.panel === abiertoActual);
    if (!def || def.cerrarFuera === false) return;
    setPanelAbierto(abiertoActual, def.btn); // toggle => cierra
  });

  // Esc cierra el panel abierto
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !abiertoActual) return;
    const def = PANEL_DEFS.find((d) => d.panel === abiertoActual);
    if (def) setPanelAbierto(abiertoActual, def.btn);
  });
}

/**
 * Asegura que el panel Explorador (ahora con detalle inline) quede
 * visible. Reemplaza al viejo abrirPanelObjeto() — el detalle vive
 * dentro del mismo panel, no en uno separado.
 */
export function abrirPanelObjeto() {
  const pEl = document.getElementById('panel-explorador');
  if (pEl) pEl.hidden = false;
  // Marcar el botón ficha como activo si existe
  const bEl = document.getElementById('btn-ficha');
  if (bEl) {
    bEl.setAttribute('aria-expanded', 'true');
    bEl.classList.add('is-active');
  }
  abiertoActual = 'panel-explorador';
}

export function asegurarPanelExplorador() {
  abrirPanelObjeto();
}
