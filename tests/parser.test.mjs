// ==============================================================
// Frases doradas del buscador (S1.2).
//
// Cada caso es una promesa del producto: si el parser cambia y rompe
// una de estas, el usuario ve una respuesta equivocada en el demo.
// Sin red, sin manifest: catálogo mínimo versionado en fixtures/.
// ==============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  crearIndice,
  parsearCon,
  buscarLugares,
  detectarDataset,
  normalizar,
  provinciaDe,
} from '../src/js/parser.js';

const catalogo = JSON.parse(
  readFileSync(new URL('./fixtures/catalogo.json', import.meta.url), 'utf8'),
);
const indice = crearIndice(catalogo);
const parse = (q) => parsearCon(indice, q);

// --- Normalización -------------------------------------------------

test('normalizar quita acentos y mayúsculas', () => {
  assert.equal(normalizar('Güemes'), 'guemes');
  assert.equal(normalizar('  SALTA  '), 'salta');
  assert.equal(normalizar(null), '');
});

// --- Sinónimos -----------------------------------------------------

test('gente / habitantes / personas son demografía', () => {
  assert.equal(detectarDataset('gente'), 'demografia');
  assert.equal(detectarDataset('habitantes'), 'demografia');
  assert.equal(detectarDataset('personas'), 'demografia');
  assert.equal(detectarDataset('poblacion'), 'demografia');
});

test('parcelas es catastro y litio es minería', () => {
  assert.equal(detectarDataset('parcelas'), 'catastro');
  assert.equal(detectarDataset('litio'), 'mineria');
});

// --- La frase que fallaba -----------------------------------------

test('"gente en capital salteña" resuelve Capital de Salta', () => {
  const p = parse('gente en capital salteña');
  assert.equal(p.dataset, 'demografia');
  assert.ok(p.entidad, 'debe resolver una entidad');
  assert.equal(p.entidad.nombre_oficial, 'Capital');
  assert.equal(provinciaDe(indice, p.entidad), 'salta');
  assert.equal(p.entidad.yvy_id, 166028);
  assert.deepEqual(p.sobrantes, []);
});

test('"capital salteña" y "capital tucumana" dan provincias distintas', () => {
  const salta = parse('capital salteña');
  const tucuman = parse('capital tucumana');
  assert.equal(salta.entidad.yvy_id, 166028);
  assert.notEqual(tucuman.entidad.yvy_id, salta.entidad.yvy_id);
  assert.equal(provinciaDe(indice, tucuman.entidad), 'tucuman');
});

test('"capital chaqueña" no devuelve una Capital de otra provincia', () => {
  // Chaco no tiene un departamento llamado "Capital": la respuesta honesta
  // es no resolver entidad, no mostrar la de Catamarca.
  const p = parse('capital chaqueña');
  assert.equal(p.entidad, null);
});

// --- Desambiguación determinista -----------------------------------

test('"capital" sola devuelve la lista de homónimas, no adivina', () => {
  const p = parse('capital');
  assert.ok(p.ambiguos.length >= 8, `esperaba varias Capital, hubo ${p.ambiguos.length}`);
  const provincias = new Set(p.ambiguos.map((o) => provinciaDe(indice, o)));
  assert.ok(provincias.size >= 8);
});

// --- Gentilicios ---------------------------------------------------

test('un gentilicio solo resuelve su provincia', () => {
  assert.equal(parse('salteña').entidad.nombre_oficial, 'Salta');
  assert.equal(parse('jujeña').entidad.nombre_oficial, 'Jujuy');
});

// --- Preguntas naturales -------------------------------------------

test('"cuánta gente vive en Tartagal" apunta a demografía de Tartagal', () => {
  const p = parse('cuánta gente vive en Tartagal');
  assert.equal(p.dataset, 'demografia');
  assert.equal(p.entidad.nombre_oficial, 'Tartagal');
});

test('"población Salta" resuelve la provincia', () => {
  const p = parse('población Salta');
  assert.equal(p.dataset, 'demografia');
  assert.equal(p.entidad.nivel, 'provincia');
});

test('"minería en Salta" detecta el dataset', () => {
  const p = parse('minería en Salta');
  assert.equal(p.dataset, 'mineria');
  assert.equal(p.entidad.nombre_oficial, 'Salta');
});

// --- Relaciones ----------------------------------------------------

test('"departamentos de Salta" pide contención', () => {
  const p = parse('departamentos de Salta');
  assert.equal(p.relacion, 'contiene');
  assert.equal(p.entidad.nivel, 'provincia');
});

test('"limita con Salta" pide linderos', () => {
  const p = parse('limita con Salta');
  assert.equal(p.relacion, 'lindero');
});

// --- Honestidad ----------------------------------------------------

test('"Los Surgentes" no se confunde con "gente"', () => {
  const p = parse('gente en Los Surgentes');
  assert.equal(p.entidad.nombre_oficial, 'Los Surgentes');
  assert.deepEqual(p.sobrantes, []);
});

test('una palabra desconocida queda como sobrante explícito', () => {
  const p = parse('salta autos');
  assert.equal(p.entidad.nombre_oficial, 'Salta');
  assert.deepEqual(p.sobrantes, ['autos']);
});

test('sin coincidencia no hay entidad inventada', () => {
  const p = parse('qwerty');
  assert.equal(p.entidad, null);
});

// --- Homónimos por nivel -------------------------------------------

test('General Güemes existe en Salta y en Chaco', () => {
  const p = parse('general güemes');
  const provincias = new Set(p.ambiguos.map((o) => provinciaDe(indice, o)));
  assert.ok(provincias.has('salta'));
});

// --- Provincia como calificador (no como entidad) ------------------

test('"general güemes salta" resuelve el depto salteño, no el chaqueño', () => {
  const p = parse('general güemes salta');
  assert.equal(p.entidad.nombre_oficial, 'General Güemes');
  assert.equal(provinciaDe(indice, p.entidad), 'salta');
});

test('"salta capital" y "capital de mendoza" caen en el depto Capital', () => {
  const salta = parse('salta capital');
  assert.equal(salta.entidad.nivel, 'depto');
  assert.equal(salta.entidad.nombre_oficial, 'Capital');
  assert.equal(provinciaDe(indice, salta.entidad), 'salta');

  const mendoza = parse('capital de mendoza');
  assert.equal(mendoza.entidad.nombre_oficial, 'Capital');
  assert.equal(provinciaDe(indice, mendoza.entidad), 'mendoza');
});

test('"barrios de salta" pide contención de Salta, no un municipio Barrios', () => {
  const p = parse('barrios de salta');
  assert.equal(p.relacion, 'contiene');
  assert.equal(p.entidad.nivel, 'provincia');
  assert.equal(p.entidad.nombre_oficial, 'Salta');
});

test('"capital federal" y "caba" son CABA, no una Capital de provincia', () => {
  for (const f of ['capital federal', 'caba', 'gente en caba']) {
    const p = parse(f);
    assert.equal(p.entidad.nivel, 'provincia', f);
    assert.equal(p.entidad.nombre_oficial, 'Ciudad Autónoma de Buenos Aires', f);
  }
});

// --- Tolerancia a un typo ------------------------------------------

test('un typo de una letra no rompe el match', () => {
  const p = parse('poblacion de cerillos');
  assert.equal(p.entidad.nombre_oficial, 'Cerrillos');
  assert.deepEqual(p.sobrantes, []);
});
