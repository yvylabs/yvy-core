// La ontología visible en la UI no puede relajar el contrato del build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cargarOntologia, metricasDeclaradas, relacionesDeclaradas, tipoDe } from '../src/js/ontologia.js';

const rutaOnt = new URL('../data/ontologia.json', import.meta.url);
const ont = JSON.parse(readFileSync(rutaOnt, 'utf8'));
// En Node no hay servidor: el test inyecta el archivo publicado.
globalThis.fetch = async () => new Response(readFileSync(rutaOnt, 'utf8'), { status: 200 });

test('cargarOntologia devuelve el esquema publicado', async () => {
  const cargada = await cargarOntologia();
  assert.equal(cargada.schema, ont.schema);
  assert.deepEqual(Object.keys(cargada.tipos), Object.keys(ont.tipos));
});

test('tipoDe: la ficha del nivel existe y declara padres', () => {
  const municipio = tipoDe(ont, 'municipio');
  assert.ok(municipio);
  assert.ok(Array.isArray(municipio.padre));
  assert.equal(tipoDe(ont, 'no_existe'), null);
});

test('toda métrica del modelo tiene unidad (SPEC §4)', () => {
  const metricas = metricasDeclaradas(ont);
  assert.ok(metricas.length > 0);
  for (const m of metricas) {
    assert.ok(m.unidad, `métrica ${m.clave} sin unidad`);
    assert.ok(m.clave);
  }
});

test('toda relación declara fuente', () => {
  const rels = relacionesDeclaradas(ont);
  assert.ok(rels.length > 0);
  for (const r of rels) {
    assert.ok(r.clave);
    assert.equal(typeof r.simetrica, 'boolean');
    if (r.previsto) {
      // "regula" es prevista: su fuente es el propio documento, se
      // declara en derivada_de en vez de una fuente externa fija.
      assert.ok(r.derivadaDe, `relación prevista ${r.clave} sin derivada_de`);
    } else {
      assert.ok(r.fuente, `relación ${r.clave} sin fuente`);
    }
  }
});
