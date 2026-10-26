// ==============================================================
// ui.js
// Gestiona la apertura/cierre de los paneles flotantes
// (Explorador, Objeto, Medición) desde el toolbar izquierdo,
// y sincroniza el layout: el DOCK (panel protagonista) ocupa la
// izquierda y el mapa cede su espacio (map.resize(), no superposición).
// ==============================================================

const PANEL_DEFS = [
  { btn: 'btn-ficha',       panel: 'panel-explorador', cerrarFuera: false },
];

let abiertoActual = null;

// Listener del cambio de layout (lo registra main.js para re-centrar el mapa).
let layoutListener = null;

/** Registra el callback que corre en cada transición de estado del dock. */
export function onLayoutChange(fn) {
  layoutListener = fn;
}

/**
 * Sincroniza el estado del dock con el DOM: welcome visible → 'welcome',
 * dossier visible → 'dossier', nada → 'oculto' (mapa a pantalla completa).
 * Luego redimensiona el mapa dos veces (inmediato + post-transición).
 */
export function sincronizarLayout() {
  const w = document.getElementById('welcome');
  const p = document.getElementById('panel-explorador');
  const dock = document.getElementById('dock');
  if (!dock) return;
  const welcomeVisible = !!(w && !w.hasAttribute('hidden'));
  const panelVisible = !!(p && !p.hidden);
  const vista = welcomeVisible ? 'welcome' : (panelVisible ? 'dossier' : 'oculto');
  document.documentElement.setAttribute('data-dock', vista);
  dock.setAttribute('data-vista', vista);
  dock.classList.toggle('dock--oculto', vista === 'oculto');
  const map = window.yvyMap;
  if (map && map.resize) {
    const resize = () => { try { map.resize(); } catch { /* mapa sin canvas */ } };
    resize();
    setTimeout(resize, 120); // mid transición
    setTimeout(resize, 320); // post transición
  }
  // Avisar el re-centrado: inmediato y post-transición (el easeTo alcanza
  // el encuadre final en ambos casos).
  const avisar = () => { try { if (layoutListener) layoutListener(vista); } catch { /* hook roto no bloquea */ } };
  avisar();
  setTimeout(avisar, 330);
}

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
    sincronizarLayout();
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
  sincronizarLayout();
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

  // Botones ✕ dentro de cada panel
  document.querySelectorAll('.floating-panel__close').forEach((c) => {
    c.addEventListener('click', () => {
      const pEl = c.closest('.floating-panel');
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

  // Esc cierra el panel abierto (salvo cuando el buscador está abierto:
  // ese Esc es del buscador, no del dossier — Evita la pantalla atrapada)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !abiertoActual) return;
    const w = document.getElementById('welcome');
    if (w && !w.hasAttribute('hidden')) return;
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
  sincronizarLayout();
}
