// ==============================================================
// JSON canónico RFC 8785 (JCS) + SHA-256.
//
// El certificado del build tiene que poder recalcularse en el cliente.
// Si estos vectores cambian, cambian todos los hashes publicados.
// ==============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizar, hashCanonico, payloadEntidad, payloadLinaje } from '../src/js/canonico.js';

test('ordena las claves y no emite espacios', () => {
  assert.equal(canonicalizar({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalizar({ z: { b: 1, a: 2 } }), '{"z":{"a":2,"b":1}}');
  assert.equal(canonicalizar({}), '{}');
});

test('los arrays conservan el orden', () => {
  assert.equal(canonicalizar([3, 1, 2]), '[3,1,2]');
  assert.equal(canonicalizar([{ b: 1, a: 2 }]), '[{"a":2,"b":1}]');
});

test('texto no ASCII no se escapa', () => {
  assert.equal(canonicalizar({ nombre: 'Orán' }), '{"nombre":"Orán"}');
  assert.equal(canonicalizar('ñandú'), '"ñandú"');
});

test('caracteres de control con el escapado mínimo', () => {
  assert.equal(canonicalizar('a\u0007'), '"a\\u0007"');
  assert.equal(canonicalizar('línea\nnueva'), '"línea\\nnueva"');
  assert.equal(canonicalizar('comillas "x"'), '"comillas \\"x\\""');
});

test('números según Number::toString de ES', () => {
  assert.equal(canonicalizar(1.0), '1');
  assert.equal(canonicalizar(-0), '0');
  assert.equal(canonicalizar(1e30), '1e+30');
  assert.equal(canonicalizar(1e-7), '1e-7');
  assert.equal(canonicalizar(0.000001), '0.000001');
  assert.equal(canonicalizar(1.5), '1.5');
});

test('null, booleanos y undefined', () => {
  assert.equal(canonicalizar(null), 'null');
  assert.equal(canonicalizar(true), 'true');
  assert.equal(canonicalizar({ a: undefined, b: 1 }), '{"b":1}');
});

test('un número no finito rompe el hash (no se inventa)', () => {
  assert.throws(() => canonicalizar({ x: NaN }), TypeError);
  assert.throws(() => canonicalizar({ x: Infinity }), TypeError);
});

test('hash SHA-256 de vectores fijos', async () => {
  assert.equal(
    await hashCanonico({ a: 1 }),
    '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862',
  );
  assert.equal(
    await hashCanonico({ nombre: 'Orán' }),
    'f1200e89dd0a6b0a289097e022f56d4587944416618595fdb811bec3a4902f61',
  );
});

test('el orden de inserción no cambia el hash', async () => {
  const a = await hashCanonico({ b: 2, a: 1, c: { z: 1, y: 2 } });
  const b = await hashCanonico({ c: { y: 2, z: 1 }, a: 1, b: 2 });
  assert.equal(a, b);
});

test('payloadEntidad deja fuera el certificado (no es circular)', () => {
  const ag = {
    yvy_id: 1, tipo: 'demografia', fuente: 'INDEC', fecha_vigencia: '2022-05',
    version: '1.1', metricas: { poblacion: 10 }, estado: 'ok', metricas_missing: [],
    certificado: { hash_entidad: 'x' },
  };
  const p = payloadEntidad(ag);
  assert.equal('certificado' in p, false);
  assert.deepEqual(Object.keys(p).sort(), [
    'estado', 'fecha_vigencia', 'fuente', 'metricas', 'metricas_missing', 'tipo', 'version', 'yvy_id',
  ]);
});

test('payloadLinaje siempre lleva las dos listas', () => {
  assert.deepEqual(payloadLinaje(7), { yvy_id: 7, relaciones: [], documentos: [] });
});
