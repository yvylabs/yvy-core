// ==============================================================
// drawer.js — Drawer único: Linaje (grafo) + Mapa
// ------------------------------------------------------------
// El panel de grafo fijo y la tira de mapa se mueven al drawer
// cuando se abren y vuelven a su sitio al cerrarse. El motor no
// cambia: grafo-panel.js y main.js siguen dibujando en los mismos
// elementos y con los mismos ids.
// ==============================================================

const ABIERTA = new Set(['linaje', 'mapa', 'modelo']);
let actual = null;
let movido = null; // { nodo, padre, siguiente }

function retornar() {
  if (!movido) return;
  const { nodo, padre, siguiente } = movido;
  const slot = document.getElementById('drawer-slot');
  if (slot && nodo.parentNode === slot) {
    if (siguiente && siguiente.parentNode === padre) padre.insertBefore(nodo, siguiente);
    else padre.appendChild(nodo);
  }
  movido = null;
}

function resizeMapa() {
  const map = window.yvyMap;
  if (map && typeof map.resize === 'function') requestAnimationFrame(() => map.resize());
}

export function cerrarDrawer() {
  if (!actual) return;
  const drawer = document.getElementById('drawer');
  retornar();
  actual = null;
  document.documentElement.removeAttribute('data-drawer');
  if (drawer) drawer.hidden = true;
  for (const b of document.querySelectorAll('[data-drawer-tab]')) b.setAttribute('aria-pressed', 'false');
  resizeMapa();
}

export function abrirDrawer(cual) {
  if (!ABIERTA.has(cual)) return;
  const drawer = document.getElementById('drawer');
  const slot = document.getElementById('drawer-slot');
  if (!drawer || !slot) return;

  if (actual === cual) { cerrarDrawer(); return; }
  if (actual) retornar();

  const idNodo = cual === 'linaje' ? 'panel-linaje' : cual === 'modelo' ? 'panel-modelo' : 'mapa-col';
  const nodo = document.getElementById(idNodo);
  if (!nodo) return;
  movido = { nodo, padre: nodo.parentNode, siguiente: nodo.nextSibling };
  slot.appendChild(nodo);

  actual = cual;
  drawer.hidden = false;
  document.documentElement.setAttribute('data-drawer', cual);
  for (const b of document.querySelectorAll('[data-drawer-tab]')) {
    b.setAttribute('aria-pressed', String(b.dataset.drawerTab === cual));
  }
  resizeMapa();
}

export function inicializarDrawer() {
  const drawer = document.getElementById('drawer');
  if (!drawer) return;

  for (const b of document.querySelectorAll('[data-drawer-tab]')) {
    b.addEventListener('click', () => abrirDrawer(b.dataset.drawerTab));
  }
  for (const b of document.querySelectorAll('[data-drawer-close]')) {
    b.addEventListener('click', cerrarDrawer);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && actual) cerrarDrawer();
  });
  // La ficha se re-renderiza al navegar: si el botón que abrió el
  // drawer desaparece, el drawer sigue vivo (el nodo está en el slot).
  window.yvyDrawer = { open: abrirDrawer, close: cerrarDrawer };
}
