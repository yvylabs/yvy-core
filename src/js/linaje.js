// ==============================================================
// linaje.js — Árbol jerárquico del territorio (pestaña "Linaje")
// ------------------------------------------------------------
// Reemplaza al force graph de 24 nodos: sangría + líneas, sin
// etiquetas superpuestas. Cada nodo navega; cada relación se lee
// como una fila con su fuente y fecha.
// ==============================================================

import {
  getObjeto,
  getPadre,
  getHijos,
  getRelaciones,
  getObjetoActivo,
  navegarA,
} from './manifest.js';
import { cargarOntologia, relacionesDeclaradas } from './ontologia.js';

function nodo(obj, activo, cadena = [], expandir = true) {
  const li = document.createElement('li');
  const linea = document.createElement('span');
  linea.className = 'linaje-nodo';
  if (obj.yvy_id === activo) linea.classList.add('linaje-nodo--activo');
  const nombre = document.createElement('button');
  nombre.type = 'button';
  nombre.className = 'linaje-ir';
  nombre.textContent = obj.nombre_oficial || `Objeto ${obj.yvy_id}`;
  nombre.addEventListener('click', () => navegarA(obj.yvy_id));
  linea.appendChild(nombre);
  const meta = document.createElement('small');
  meta.textContent = obj.nivel;
  linea.appendChild(meta);
  li.appendChild(linea);

  const hijos = getHijos(obj.yvy_id);
  if (expandir && hijos.length) {
    const ul = document.createElement('ul');
    const siguiente = cadena[0];
    if (siguiente && hijos.some((h) => h.yvy_id === siguiente.yvy_id)) {
      // Solo la rama que lleva a la entidad activa + aviso del resto.
      ul.appendChild(nodo(siguiente, activo, cadena.slice(1), true));
      if (hijos.length > 1) {
        const mas = document.createElement('li');
        mas.className = 'linaje-mas';
        mas.textContent = `… y ${hijos.length - 1} ${hijos.length === 2 ? 'entidad más' : 'entidades más'}`;
        ul.appendChild(mas);
      }
    } else {
      for (const h of hijos.slice(0, 30)) ul.appendChild(nodo(h, activo, [], false));
      if (hijos.length > 30) {
        const mas = document.createElement('li');
        mas.className = 'linaje-mas';
        mas.textContent = `… y ${hijos.length - 30} más`;
        ul.appendChild(mas);
      }
    }
    li.appendChild(ul);
  }
  return li;
}

async function dibujar() {
  const body = document.getElementById('linaje-body');
  if (!body) return;
  const activo = Number(getObjetoActivo()?.yvy_id || 166028);
  const actual = getObjeto(activo) || getObjeto(166028);
  if (!actual) return;

  body.innerHTML = '';
  const cadena = [];
  let o = actual;
  const vistos = new Set();
  while (o && !vistos.has(o.yvy_id)) {
    cadena.unshift(o);
    vistos.add(o.yvy_id);
    o = getPadre(o);
  }
  const intro = document.createElement('p');
  intro.className = 'linaje-intro';
  intro.textContent = `${cadena.map((x) => x.nombre_oficial).join(' / ')} · ${actual.yvy_id}`;
  body.appendChild(intro);

  const ul = document.createElement('ul');
  ul.className = 'linaje-arbol';
  ul.appendChild(nodo(cadena[0], activo, cadena.slice(1)));
  body.appendChild(ul);

  const titulo = document.createElement('h3');
  titulo.textContent = `Relaciones de ${actual.nombre_oficial}`;
  body.appendChild(titulo);

  const rels = getRelaciones(actual.yvy_id);
  let declaradas = [];
  try { declaradas = relacionesDeclaradas(await cargarOntologia()); } catch { /* sin red: no es bloqueante */ }

  if (!rels.length) {
    const vacio = document.createElement('p');
    vacio.className = 'linaje-vacio';
    vacio.textContent = 'Sin relaciones registradas para esta entidad.';
    body.appendChild(vacio);
  } else {
    const lista = document.createElement('div');
    lista.className = 'linaje-rels';
    for (const r of rels) {
      const dest = getObjeto(r.destino_yvy_id);
      const fila = document.createElement('div');
      fila.className = 'linaje-rel';
      const tipo = document.createElement('span');
      tipo.className = `linaje-rel__tipo linaje-rel__tipo--${r.tipo}`;
      tipo.textContent = r.tipo;
      const nombre = document.createElement('button');
      nombre.type = 'button';
      nombre.textContent = dest ? dest.nombre_oficial : String(r.destino_yvy_id);
      nombre.addEventListener('click', () => navegarA(r.destino_yvy_id));
      const decl = declaradas.find((d) => d.clave === r.tipo);
      const fuente = document.createElement('small');
      fuente.textContent = decl ? `${decl.fuente || 'sin fuente'}${decl.fecha ? ` · ${decl.fecha}` : ''}` : 'sin fuente';
      fila.append(tipo, nombre, fuente);
      lista.appendChild(fila);
    }
    body.appendChild(lista);
  }

  const nota = document.createElement('p');
  nota.className = 'linaje-nota';
  nota.textContent = '0 documentos regulatorios cargados · la relación regula está declarada pero sin documentos.';
  body.appendChild(nota);
}

export function inicializarLinaje() {
  dibujar();
  document.addEventListener('yvy:objeto', () => dibujar());
  document.addEventListener('yvy:dock', () => dibujar());
}
