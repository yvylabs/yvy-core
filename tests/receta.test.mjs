// ==============================================================
// Receta tabular: una sola implementación y pines de verificación.
//
// La receta (scripts/receta.mjs) NO reimplementa el build: llama a
// escribirManifest(), la misma función del plugin de Vite. Este test
// protege las dos mitades:
//   1. Los pines (data/receta.verificacion.json) tienen que cerrar
//      contra el build real: si un hash se mueve sin cambiar el pin,
//      falla.
//   2. La receta tiene que DETECTAR ese movimiento (exit 1), no
//      imprimir un OK optimista.
//
// Corre después de `pnpm run build` o `pnpm run receta`.
// ==============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const leer = (rel) => new URL(`../${rel}`, import.meta.url).pathname;
const PINES = leer('data/receta.verificacion.json');
const hayBuild = existsSync(leer('public/data/manifest.json'));

test('los pines están bien formados y al menos uno fija hashes', () => {
  const pines = JSON.parse(readFileSync(PINES, 'utf8'));
  assert.equal(pines.schema, 'yvy-receta-v1');
  assert.ok(Array.isArray(pines.entidades) && pines.entidades.length > 0);
  for (const p of pines.entidades) {
    assert.ok(Number.isInteger(Number(p.yvy_id)), `pin sin yvy_id entero: ${JSON.stringify(p)}`);
    assert.ok(p.tipo, `pin ${p.yvy_id} sin tipo`);
    if (p.hash_entidad) assert.match(p.hash_entidad, /^[0-9a-f]{64}$/);
    if (p.hash_linaje) assert.match(p.hash_linaje, /^[0-9a-f]{64}$/);
  }
  assert.ok(pines.entidades.some((p) => p.hash_entidad && p.hash_linaje), 'ningún pin fija entidad y linaje');
});

test('cada pin cierra contra el build real (nombre y certificado)', { skip: !hayBuild && 'requiere pnpm run build' }, () => {
  const pines = JSON.parse(readFileSync(PINES, 'utf8'));
  const manifest = JSON.parse(readFileSync(leer('public/data/manifest.json'), 'utf8'));
  const porId = new Map(manifest.objetos.map((o) => [Number(o.yvy_id), o]));

  for (const p of pines.entidades) {
    const id = Number(p.yvy_id);
    const objeto = porId.get(id);
    assert.ok(objeto, `el pin ${id} no existe en el catálogo`);
    if (p.nombre_oficial) assert.equal(objeto.nombre_oficial, p.nombre_oficial, `cambió el nombre de ${id}`);

    const archivo = leer(`public/data/agregados/${p.tipo}/${id}.json`);
    assert.ok(existsSync(archivo), `el pin ${id} apunta a un agregado inexistente (${p.tipo})`);
    const { certificado } = JSON.parse(readFileSync(archivo, 'utf8'));

    // El certificado se recalcula desde el agregado, no se cree.
    assert.match(certificado.hash_entidad, /^[0-9a-f]{64}$/);
    assert.match(certificado.hash_linaje, /^[0-9a-f]{64}$/);
    assert.equal(certificado.canonico, 'RFC8785');
    assert.equal(certificado.algoritmo, 'sha256');
    if (p.hash_entidad) assert.equal(certificado.hash_entidad, p.hash_entidad, `hash_entidad de ${id} se movió`);
    if (p.hash_linaje) assert.equal(certificado.hash_linaje, p.hash_linaje, `hash_linaje de ${id} se movió`);
  }
});

test('reporte de la receta: schema y hash_catalogo coherentes con el manifest', { skip: !existsSync(leer('public/data/receta.json')) && 'requiere pnpm run receta' }, () => {
  const reporte = JSON.parse(readFileSync(leer('public/data/receta.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(leer('public/data/manifest.json'), 'utf8'));
  assert.equal(reporte.schema, 'yvy-receta-v1');
  assert.equal(reporte.catalogo.total, manifest.objetos.length);
  assert.equal(reporte.catalogo.hash_catalogo, manifest.identidad?.hash_catalogo || null);
  assert.equal(reporte.ok, true, 'el último reporte de receta tiene fallas');
});

test('la receta detecta un pin movido y sale con código 1', { skip: !hayBuild && 'requiere pnpm run build' }, () => {
  const pines = JSON.parse(readFileSync(PINES, 'utf8'));
  const primero = pines.entidades.find((p) => p.hash_entidad);
  const alterado = {
    ...pines,
    entidades: [{ ...primero, hash_entidad: '0'.repeat(64) }],
  };
  const dir = mkdtempSync(join(tmpdir(), 'yvy-receta-'));
  const archivo = join(dir, 'pines.json');
  writeFileSync(archivo, JSON.stringify(alterado), 'utf8');

  let codigo = 0;
  let salida = '';
  try {
    salida = execFileSync(process.execPath, [join(RAIZ, 'scripts/receta.mjs'), '--sin-regenerar', '--pines', archivo, '--sin-reporte', '--json'], {
      cwd: RAIZ,
      encoding: 'utf8',
    });
  } catch (err) {
    codigo = err.status;
    salida = err.stdout || '';
  }
  assert.equal(codigo, 1, 'un pin movido tiene que fallar, no pasar');
  const reporte = JSON.parse(salida);
  assert.equal(reporte.ok, false);
  assert.match(reporte.verificacion[0].problemas.join(' | '), /hash_entidad .* ≠ 0000/);
});
