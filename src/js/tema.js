// ==============================================================
// tema.js — Modo claro/oscuro de la UI (persistente).
// El GLOBO permanece oscuro en ambos temas: es un widget de datos;
// el tema solo cambia superficies de UI (--bg/--surface/--text...).
// Persistencia: localStorage('yvy:tema'); el primer paint lo aplica
// un script inline en <head> (sin FOUC).
// ==============================================================

const CLAVE = 'yvy:tema';

/** Aplica el tema al documento y sincroniza control + meta theme-color. */
export function aplicarTema(tema) {
  const claro = tema === 'light';
  document.documentElement.setAttribute('data-theme', claro ? 'light' : 'dark');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', claro ? '#F3F4F6' : '#0B0E14');
  const btn = document.getElementById('btn-tema');
  if (btn) {
    btn.setAttribute('aria-pressed', String(claro));
    btn.setAttribute('aria-label', claro ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
    btn.dataset.tooltip = claro ? 'Modo oscuro' : 'Modo claro';
  }
}

export function inicializarTema() {
  // Yvy Core es un informe: tema claro fijo, sin toggle. El globo
  // permanece widget dark (sus tokens --map-widget-* no cambian).
  aplicarTema('light');

  const btn = document.getElementById('btn-tema');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const claro = document.documentElement.getAttribute('data-theme') === 'light';
    const nuevo = claro ? 'dark' : 'light';
    aplicarTema(nuevo);
    try {
      localStorage.setItem(CLAVE, nuevo);
    } catch { /* persistir es best-effort; la sesión queda coherente */ }
  });
}
