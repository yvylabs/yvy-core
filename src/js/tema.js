// ==============================================================
// tema.js — Yvy Core es un INFORME: tema claro fijo, sin modo oscuro.
// El mapa permanece widget dark (tokens --map-widget-*) por diseño R7;
// eso no es un "tema", es la superficie de datos del globo.
// El primer paint ya lo fija el script inline del <head> (sin FOUC).
// ==============================================================

/** Fuerza el tema claro y sincroniza el meta theme-color. */
export function aplicarTema() {
  document.documentElement.setAttribute('data-theme', 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', '#FAFAFA');
}

export function inicializarTema() {
  aplicarTema();
}
