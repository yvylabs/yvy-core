// ==============================================================
// Contrato de datos sobre los agregados generados en el build.
//
// Corre DESPUÉS de `pnpm run build`: valida el árbol real que se
// publica (`public/data/agregados/{tipo}/{yvy_id}.json`).
//
// Regla que protege: un dato que no existe es `null`, nunca 0 de
// relleno, y su estado se declara. Un cero inventado es un dato falso
// y este test lo bloquea antes de llegar a producción.
// ==============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('../public/data/agregados/', import.meta.url).pathname;

function* archivos(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* archivos(p);
    else if (e.endsWith('.json')) yield p;
  }
}

const lista = [...archivos(DIR)];

test('hay agregados generados (el build corrió antes que este test)', () => {
  assert.ok(lista.length > 0, `sin agregados en ${DIR}`);
});

test('cada agregado declara estado coherente con sus métricas', () => {
  const malos = [];
  for (const f of lista) {
    const ag = JSON.parse(readFileSync(f, 'utf8'));
    const claves = Object.keys(ag.metricas || {});
    const faltan = claves.filter((k) => ag.metricas[k] == null);
    const esperado = !claves.length || faltan.length === claves.length
      ? 'missing'
      : (faltan.length ? 'parcial' : 'ok');
    if (ag.estado !== esperado) malos.push(`${f}: estado=${ag.estado} esperado=${esperado}`);
    const declaradas = ag.metricas_missing || [];
    if (declaradas.join('|') !== faltan.join('|')) {
      malos.push(`${f}: metricas_missing=${JSON.stringify(declaradas)} esperado=${JSON.stringify(faltan)}`);
    }
    if (!ag.fuente) malos.push(`${f}: sin fuente (no entra)`);
  }
  assert.deepEqual(malos.slice(0, 10), []);
});

test('ninguna métrica es el string vacío disfrazado de dato', () => {
  const malos = [];
  for (const f of lista) {
    const ag = JSON.parse(readFileSync(f, 'utf8'));
    for (const [k, v] of Object.entries(ag.metricas || {})) {
      if (v === '') malos.push(`${f}.${k}`);
    }
  }
  assert.deepEqual(malos.slice(0, 10), []);
});

test('el tipo vive como campo, nunca dentro del yvy_id', () => {
  const malos = [];
  for (const f of lista) {
    const ag = JSON.parse(readFileSync(f, 'utf8'));
    if (!Number.isInteger(ag.yvy_id)) malos.push(`${f}: yvy_id no entero`);
    if (!ag.tipo) malos.push(`${f}: sin tipo`);
  }
  assert.deepEqual(malos.slice(0, 10), []);
});
