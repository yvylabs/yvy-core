// ==============================================================
// Identidad (yvy_id): contrato de ids.
//
// Dos capas:
//   1. Unitarias sobre src/lib/identidad.js — la lógica pura que usa
//      el build y que usará la receta de ingesta.
//   2. Sobre el build real (public/data/ids.json + manifest.json) —
//      el ledger publicado tiene que cerrar con el catálogo y con su
//      propio hash. Corre DESPUÉS de `pnpm run build`.
//
// Regla que protege: un id emitido nunca se recicla ni se renumera.
// Si mañana entra un municipio nuevo, ningún id existente cambia.
// ==============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  aplicarMigraciones,
  asignarId,
  asignarIdBarrio,
  bloqueReservado,
  construirLedger,
  enRango,
  idDerivado,
  validarIdentidad,
} from '../src/lib/identidad.js';
import { hashCanonico } from '../src/js/canonico.js';

const leer = (rel) => new URL(`../${rel}`, import.meta.url).pathname;

// ---------- 1. Derivación ----------

test('id derivado = offset + código oficial', () => {
  assert.equal(idDerivado('provincia', '66'), 1066); // Salta
  assert.equal(idDerivado('depto', '66028'), 166028); // Capital, Salta
  assert.equal(idDerivado('municipio', '660063'), 1660063); // Salta
  assert.equal(idDerivado('municipio', '022007'), 1022007); // Comuna 1, CABA
  assert.equal(idDerivado('barrio', '1'), null); // el barrio no se deriva de código
  assert.equal(idDerivado('municipio', ''), null);
});

test('rango: el id de relleno viejo no era un municipio válido', () => {
  assert.equal(enRango('municipio', 1660063), true);
  assert.equal(enRango('municipio', 9000000001), false);
  assert.equal(enRango('barrio', 1660063001), true);
  assert.equal(enRango('barrio', 2000000001), true); // bloque de desborde
  assert.equal(enRango('municipio', '1660063'), true);
  assert.equal(enRango('municipio', 1.5), false);
});

test('bloque reservado se reconoce por nivel', () => {
  assert.equal(bloqueReservado('municipio', 2000001)?.nombre, 'indeterminado');
  assert.equal(bloqueReservado('municipio', 2050001)?.nombre, 'reasignado');
  assert.equal(bloqueReservado('municipio', 1660063), null);
});

// ---------- 2. Asignación (no regresión) ----------

test('alta normal: usa el id derivado y no toca nada', () => {
  const ocupados = new Set([1660063, 166028, 1066]);
  // Municipio nuevo de Salta (cod 660999): id derivado libre.
  assert.equal(asignarId('municipio', '660999', ocupados), 1660999);
  // El set no se mutó: ningún id existente cambió.
  assert.deepEqual([...ocupados].sort((a, b) => a - b), [1066, 166028, 1660063]);
});

test('recodificación: no pisa el id de otra entidad, usa el bloque reasignado', () => {
  const ocupados = new Set([1660063]);
  // El mismo código derivaría 1660063, ya ocupado por otra entidad.
  const nuevo = asignarId('municipio', '660063', ocupados);
  assert.equal(nuevo, 2050000);
  assert.ok(enRango('municipio', nuevo));
  assert.equal(bloqueReservado('municipio', nuevo).nombre, 'reasignado');
});

test('nivel sin bloque reservado: no inventa, devuelve null', () => {
  assert.equal(asignarId('provincia', '66', new Set([1066])), null);
});

test('barrio: secuencia append-only, no posicional', () => {
  const muni = 1660063;
  // Municipio con los barrios 1, 2 y 3 ocupados → el próximo es 4.
  const ocupados = new Set([muni * 1000 + 1, muni * 1000 + 2, muni * 1000 + 3]);
  assert.equal(asignarIdBarrio(muni, ocupados), muni * 1000 + 4);
  // Insertar "en el medio" (alfabéticamente) no renumera: el nuevo toma
  // el siguiente libre, nunca el lugar que le tocaría por orden.
  const conHueco = new Set([muni * 1000 + 1, muni * 1000 + 3]);
  assert.equal(asignarIdBarrio(muni, conHueco), muni * 1000 + 2);
});

test('barrio: con 999 ocupados pasa al bloque de desborde', () => {
  const muni = 1660063;
  const ocupados = new Set();
  for (let s = 1; s <= 999; s++) ocupados.add(muni * 1000 + s);
  const nuevo = asignarIdBarrio(muni, ocupados);
  assert.ok(nuevo >= 2000000000 && nuevo <= 2999999999, `esperaba desborde, vino ${nuevo}`);
});

// ---------- 3. Validación ----------

const EXC = {
  range: true,
  migraciones: [{ de: 9000000001, a: 2000001, nivel: 'municipio', motivo: 'test' }],
};

test('validarIdentidad detecta duplicado, fuera de rango y reservado sin excepción', () => {
  const casos = [
    { yvy_id: 1660063, nivel: 'municipio', nombre_oficial: 'Salta' },
    { yvy_id: 1660063, nivel: 'municipio', nombre_oficial: 'Repetido' },
    { yvy_id: 9000000001, nivel: 'municipio', nombre_oficial: 'Relleno' },
    { yvy_id: 2000002, nivel: 'municipio', nombre_oficial: 'Reservado sin declarar' },
  ];
  const v = validarIdentidad(casos, EXC).join(' | ');
  assert.match(v, /duplicado 1660063/);
  assert.match(v, /9000000001.*fuera del rango/);
  assert.match(v, /2000002.*bloque reservado/);
});

test('validarIdentidad acepta el catálogo limpio', () => {
  const casos = [
    { yvy_id: 0, nivel: 'pais', nombre_oficial: 'Argentina' },
    { yvy_id: 1660063, nivel: 'municipio', nombre_oficial: 'Salta' },
    { yvy_id: 2000001, nivel: 'municipio', nombre_oficial: 'Sin código', id_anterior: 9000000001 },
  ];
  assert.deepEqual(validarIdentidad(casos, EXC), []);
});

test('aplicarMigraciones renombra, deja rastro y falla si pisa un id', () => {
  const objetos = [
    { yvy_id: 9000000001, nivel: 'municipio', nombre_oficial: 'Colonia Cerrito' },
    { yvy_id: 1660063, nivel: 'municipio', nombre_oficial: 'Salta' },
  ];
  const r = aplicarMigraciones(objetos, EXC);
  assert.deepEqual(r.aplicadas, [{ desde: 9000000001, hasta: 2000001 }]);
  assert.equal(objetos[0].yvy_id, 2000001);
  assert.equal(objetos[0].id_anterior, 9000000001);

  assert.throws(
    () => aplicarMigraciones([{ yvy_id: 9000000001, nivel: 'municipio' }, { yvy_id: 2000001, nivel: 'municipio' }], EXC),
    /ya lo usa/,
  );
});

test('migración ya absorbida por el registry no rompe el build', () => {
  const r = aplicarMigraciones([{ yvy_id: 2000001, nivel: 'municipio' }], EXC);
  assert.deepEqual(r.aplicadas, []);
  assert.equal(r.pendientes.length, 1);
});

test('ledger: ordenado por id y con historia de migración', () => {
  const ledger = construirLedger(
    [
      { yvy_id: 1660063, nivel: 'municipio', cod_indec: '660063' },
      { yvy_id: 2000001, nivel: 'municipio', cod_indec: null, id_anterior: 9000000001, id_motivo: 'sin código' },
    ],
    EXC,
  );
  assert.equal(ledger.total, 2);
  assert.deepEqual(ledger.entidades.map((e) => e.yvy_id), [1660063, 2000001]);
  assert.equal(ledger.entidades[1].id_anterior, 9000000001);
  assert.equal(ledger.entidades[1].cod_indec, null);
});

// ---------- 4. Contra el build real ----------

const hayBuild = existsSync(leer('public/data/ids.json')) && existsSync(leer('public/data/manifest.json'));

test('ledger publicado: cierra con el manifest y con su propio hash', { skip: !hayBuild && 'requiere pnpm run build' }, async () => {
  const ids = JSON.parse(readFileSync(leer('public/data/ids.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(leer('public/data/manifest.json'), 'utf8'));

  assert.equal(ids.schema, 'yvy-ids-v1');
  assert.equal(manifest.identidad?.schema, 'yvy-ids-v1');
  assert.equal(ids.total, manifest.objetos.length);
  assert.equal(ids.hash_catalogo, manifest.identidad.hash_catalogo);

  // El hash se recalcula desde el archivo publicado, no se cree.
  const recalculado = await hashCanonico({ schema: ids.schema, total: ids.total, entidades: ids.entidades });
  assert.equal(recalculado, ids.hash_catalogo);

  // Ningún id duplicado y todos dentro del rango de su nivel.
  const vistos = new Set();
  for (const e of ids.entidades) {
    assert.ok(!vistos.has(e.yvy_id), `id duplicado en el ledger: ${e.yvy_id}`);
    vistos.add(e.yvy_id);
    assert.ok(enRango(e.nivel, e.yvy_id), `${e.yvy_id} (${e.nivel}) fuera de rango`);
  }
});

test('los 8 ids de relleno ya no existen y su migración está registrada', { skip: !hayBuild && 'requiere pnpm run build' }, () => {
  const ids = JSON.parse(readFileSync(leer('public/data/ids.json'), 'utf8'));
  const porId = new Map(ids.entidades.map((e) => [e.yvy_id, e]));

  for (let n = 1; n <= 8; n++) {
    assert.equal(porId.has(9000000000 + n), false, `el id de relleno ${9000000000 + n} sigue publicado`);
    const nuevo = porId.get(2000000 + n);
    assert.ok(nuevo, `falta la entidad migrada 200000${n}`);
    assert.equal(nuevo.id_anterior, 9000000000 + n);
  }
});

test('no regresión: cargar un municipio nuevo no cambia ningún id existente', { skip: !hayBuild && 'requiere pnpm run build' }, () => {
  const ids = JSON.parse(readFileSync(leer('public/data/ids.json'), 'utf8'));
  const antes = new Map(ids.entidades.map((e) => [e.yvy_id, `${e.nivel}|${e.cod_indec}`]));
  const ocupados = new Set(antes.keys());

  const nuevo = asignarId('municipio', '660999', ocupados);
  assert.ok(nuevo, 'un alta normal tiene que obtener id');
  assert.equal(ocupados.has(nuevo), false, 'el id nuevo no puede pisar uno existente');

  // El catálogo existente queda byte a byte igual.
  const despues = new Map(ids.entidades.map((e) => [e.yvy_id, `${e.nivel}|${e.cod_indec}`]));
  assert.equal(despues.size, antes.size);
  for (const [id, desc] of antes) assert.equal(despues.get(id), desc, `cambió ${id}`);
});
