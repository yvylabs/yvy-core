// ==============================================================
// Certificado de linaje sobre los artefactos publicados.
//
// Corre DESPUÉS del build. Verifica tres cosas:
//  1. la ontología se publica y declara todo lo que los agregados usan;
//  2. cada agregado trae sus dos hashes en formato correcto;
//  3. el hash se puede RECALCULAR desde el JSON publicado (es lo que
//     promete el certificado al cliente: mismos datos, mismo hash).
// ==============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { hashCanonico, payloadEntidad, payloadLinaje } from '../src/js/canonico.js';

const DATA = new URL('../public/data/', import.meta.url).pathname;
const AGREGADOS = join(DATA, 'agregados');
const HEX64 = /^[0-9a-f]{64}$/;

const leerJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));

const agregados = existsSync(AGREGADOS)
  ? readdirSync(AGREGADOS).flatMap((tipo) =>
      readdirSync(join(AGREGADOS, tipo))
        .filter((f) => f.endsWith('.json'))
        .map((f) => ({ tipo, archivo: join(AGREGADOS, tipo, f) })))
  : [];

test('la ontología se publica con el build', () => {
  const p = join(DATA, 'ontologia.json');
  assert.ok(existsSync(p), 'falta public/data/ontologia.json (¿corrió el build?)');
  const o = leerJSON(p);
  assert.equal(o.schema, 'yvy-ontologia-v1');
  assert.ok(o.tipos && o.metricas && o.relaciones);
});

test('toda métrica publicada está declarada con unidad en la ontología', () => {
  const ont = leerJSON(join(DATA, 'ontologia.json'));
  const sinDeclarar = new Set();
  const sinUnidad = new Set();
  for (const { archivo } of agregados) {
    const ag = leerJSON(archivo);
    for (const k of Object.keys(ag.metricas || {})) {
      const def = ont.metricas[k];
      if (!def) sinDeclarar.add(k);
      else if (!def.unidad) sinUnidad.add(k);
    }
  }
  assert.deepEqual([...sinDeclarar], []);
  assert.deepEqual([...sinUnidad], []);
});

test('toda relación declarada tiene fuente en la ontología', () => {
  const ont = leerJSON(join(DATA, 'ontologia.json'));
  const rel = join(DATA, 'relaciones.json');
  if (!existsSync(rel)) return;
  const tipos = new Set(leerJSON(rel).relaciones.map((r) => r.tipo));
  for (const tipo of tipos) {
    assert.ok(ont.relaciones[tipo], `relación "${tipo}" sin declarar`);
    assert.ok(ont.relaciones[tipo].fuente, `relación "${tipo}" sin fuente`);
  }
});

test('cada agregado publica sus dos hashes', () => {
  const malos = [];
  for (const { archivo } of agregados) {
    const ag = leerJSON(archivo);
    const c = ag.certificado;
    if (!c) { malos.push(`${archivo}: sin certificado`); continue; }
    if (!HEX64.test(c.hash_entidad)) malos.push(`${archivo}: hash_entidad inválido`);
    if (!HEX64.test(c.hash_linaje)) malos.push(`${archivo}: hash_linaje inválido`);
    if (c.canonico !== 'RFC8785') malos.push(`${archivo}: canonico=${c.canonico}`);
    if (c.algoritmo !== 'sha256') malos.push(`${archivo}: algoritmo=${c.algoritmo}`);
  }
  assert.deepEqual(malos.slice(0, 10), []);
});

test('el hash_entidad se recalcula desde el JSON publicado', async () => {
  // Muestra amplia: primeros de cada tipo + el país, la provincia y el
  // municipio del demo (Salta), que son los que se miran a ojo.
  const muestra = [
    ...new Set([
      ...['demografia', 'catastro', 'mineria'].flatMap((tipo) =>
        readdirSync(join(AGREGADOS, tipo)).filter((f) => f.endsWith('.json')).slice(0, 20)
          .map((f) => join(AGREGADOS, tipo, f))),
      join(AGREGADOS, 'demografia', '0.json'),
      join(AGREGADOS, 'demografia', '1066.json'),
      join(AGREGADOS, 'demografia', '1660063.json'),
      join(AGREGADOS, 'demografia', '166028.json'),
    ]),
  ].filter(existsSync);
  assert.ok(muestra.length > 10, 'sin agregados para verificar');
  for (const p of muestra) {
    const ag = leerJSON(p);
    const recalculado = await hashCanonico(payloadEntidad(ag));
    assert.equal(recalculado, ag.certificado.hash_entidad, `${p}: hash_entidad no cierra`);
  }
});

test('el hash_linaje se recalcula desde relaciones.json', async () => {
  const rel = join(DATA, 'relaciones.json');
  if (!existsSync(rel)) return;
  const porOrigen = new Map();
  for (const r of leerJSON(rel).relaciones) {
    const item = { tipo: r.tipo, destino: r.destino_yvy_id };
    if (r.dist_m != null) item.dist_m = r.dist_m;
    if (!porOrigen.has(r.origen_yvy_id)) porOrigen.set(r.origen_yvy_id, []);
    porOrigen.get(r.origen_yvy_id).push(item);
  }
  // Mismo orden determinista que el build.
  for (const lista of porOrigen.values()) {
    lista.sort((a, b) => (a.tipo === b.tipo ? a.destino - b.destino : a.tipo < b.tipo ? -1 : 1));
  }
  let verificados = 0;
  for (const [, originId] of [...porOrigen.keys()].slice(0, 40).entries()) {
    const p = join(AGREGADOS, 'demografia', `${originId}.json`);
    if (!existsSync(p)) continue;
    const ag = leerJSON(p);
    const recalculado = await hashCanonico(payloadLinaje(originId, porOrigen.get(originId), []));
    assert.equal(recalculado, ag.certificado.hash_linaje, `${p}: hash_linaje no cierra`);
    verificados++;
  }
  assert.ok(verificados > 5, `solo ${verificados} entidades con linaje verificadas`);
});
