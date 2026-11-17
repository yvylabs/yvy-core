// ==============================================================
// modelo.js — Explorador de la ontología (pestaña "Modelo" del drawer)
// ------------------------------------------------------------
// Muestra lo mismo que valida el build: tipos, métricas con unidad,
// relaciones declaradas y reglas. Si acá no está, el dato no entra.
// ==============================================================

import { cargarOntologia } from './ontologia.js';

function grupo(titulo, items, nota) {
  const sec = document.createElement('section');
  sec.className = 'modelo-grupo';
  const h = document.createElement('h4');
  h.textContent = `${titulo} · ${items.length}`;
  sec.appendChild(h);
  for (const item of items) {
    const fila = document.createElement('div');
    fila.className = 'modelo-item';
    const label = document.createElement('span');
    label.className = 'modelo-item__k';
    label.textContent = item.titulo;
    const meta = document.createElement('span');
    meta.textContent = item.meta || '';
    fila.appendChild(label);
    if (item.meta) fila.appendChild(meta);
    sec.appendChild(fila);
  }
  if (nota) {
    const p = document.createElement('p');
    p.className = 'modelo-nota';
    p.textContent = nota;
    sec.appendChild(p);
  }
  return sec;
}

export async function inicializarModelo() {
  const body = document.getElementById('modelo-body');
  if (!body) return;
  body.textContent = 'cargando esquema…';
  try {
    const ont = await cargarOntologia();
    body.innerHTML = '';
    body.appendChild(grupo(
      'Tipos',
      Object.entries(ont.tipos || {}).map(([k, v]) => ({
        titulo: k,
        meta: `nivel ${v.nivel ?? '?'} · padre ${(v.padre || []).join(',') || '—'}`,
      })),
      'El tipo va como campo, nunca dentro del yvy_id.',
    ));
    body.appendChild(grupo(
      'Métricas',
      Object.entries(ont.metricas || {}).map(([k, v]) => ({
        titulo: v.etiqueta || k,
        meta: `${v.unidad || 'sin unidad'} · ${v.dataset || 'general'}${v.previsto ? ' · previsto' : ''}`,
      })),
      'Sin unidad no entra: la unidad es obligatoria en toda métrica.',
    ));
    body.appendChild(grupo(
      'Relaciones',
      Object.entries(ont.relaciones || {}).map(([k, v]) => ({
        titulo: k,
        meta: `${v.fuente || 'sin fuente'}${v.fecha ? ` · ${v.fecha}` : ''}${v.simetrica ? ' · simétrica' : ''}`,
      })),
      'Toda relación declara fuente. N:M se modela como interseca, no como árbol.',
    ));
    const reglas = ont.reglas || {};
    if (Object.keys(reglas).length) {
      body.appendChild(grupo('Reglas', Object.entries(reglas).map(([k, v]) => ({
        titulo: k,
        meta: typeof v === 'string' ? v.slice(0, 90) : JSON.stringify(v).slice(0, 90),
      }))));
    }
  } catch (err) {
    body.textContent = `No se pudo cargar la ontología: ${err?.message || err}`;
  }
}
