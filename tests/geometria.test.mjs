// ==============================================================
// Verdad sobre la geometría.
//
// El manifest no puede decir "sin geometría" sobre datos que el
// runtime sí pinta, ni "tiene geometría" por fe. Este test cruza el
// registro verificado (data/pmtiles.json) con el build publicado:
//   - el artefacto declara qué se verificó (sha256, zooms, bounds);
//   - cada objeto dice de dónde sale su geometría (local/remota/missing);
//   - los centroides publicados caen dentro de los bounds del artefacto.
//
// Corre después de `pnpm run build`.
// ==============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const leer = (rel) => new URL(`../${rel}`, import.meta.url).pathname;
const REGISTRO = leer('data/pmtiles.json');
const hayBuild = existsSync(leer('public/data/manifest.json'));

const registro = JSON.parse(readFileSync(REGISTRO, 'utf8'));

test('el registro de artefactos declara solo lo verificado', () => {
  assert.equal(registro.schema, 'yvy-pmtiles-v1');
  assert.ok(Array.isArray(registro.artefactos) && registro.artefactos.length > 0);

  for (const a of registro.artefactos) {
    assert.ok(a.nivel, 'artefacto sin nivel');
    assert.match(a.archivo, /\.pmtiles$/, `archivo inválido: ${a.archivo}`);
    assert.match(a.url, /^https:\/\//, `url inválida en ${a.archivo}`);
    assert.ok(Number.isInteger(a.bytes) && a.bytes > 0, `${a.archivo}: bytes inválidos`);
    assert.match(a.sha256 || '', /^[0-9a-f]{64}$/, `${a.archivo}: sha256 ausente o inválido`);
    assert.ok(a.min_zoom >= 0 && a.max_zoom <= 22 && a.max_zoom >= a.min_zoom, `${a.archivo}: zooms inválidos`);
    assert.ok(Array.isArray(a.bounds) && a.bounds.length === 4, `${a.archivo}: bounds inválidos`);
    const [minLon, minLat, maxLon, maxLat] = a.bounds.map(Number);
    assert.ok(minLon < maxLon && minLat < maxLat, `${a.archivo}: bounds invertidos`);
    assert.ok(minLon >= -180 && maxLon <= 180 && minLat >= -90 && maxLat <= 90, `${a.archivo}: bounds fuera del mundo`);
    assert.ok(Number.isFinite(Date.parse(a.verificado_en)), `${a.archivo}: sin fecha de verificación`);
    assert.equal(a.version, 3);
  }
});

const manifest = hayBuild ? JSON.parse(readFileSync(leer('public/data/manifest.json'), 'utf8')) : null;
const skip = !hayBuild && 'requiere pnpm run build';

test('el manifest publica los mismos artefactos que el registro', { skip }, () => {
  assert.ok(manifest.geometria, 'el manifest no declara geometría');
  assert.equal(manifest.geometria.schema, 'yvy-pmtiles-v1');
  assert.equal(manifest.geometria.archivo, 'data/pmtiles.json');

  const porArchivo = new Map(manifest.geometria.artefactos.map((a) => [a.archivo, a]));
  for (const a of registro.artefactos) {
    const m = porArchivo.get(a.archivo);
    assert.ok(m, `el manifest no publica ${a.archivo}`);
    assert.equal(m.nivel, a.nivel);
    assert.equal(m.sha256, a.sha256, `${a.archivo}: el sha256 publicado no es el verificado`);
    assert.equal(m.bytes, a.bytes);
    assert.deepEqual(m.bounds, a.bounds);
    assert.equal(m.min_zoom, a.min_zoom);
    assert.equal(m.max_zoom, a.max_zoom);
  }
});

test('cada objeto declara el estado de su geometría, sin contradicciones', { skip }, () => {
  const artefactos = new Set((manifest.geometria?.artefactos || []).map((a) => a.archivo));
  const estados = new Set(['local', 'remota', 'missing']);

  for (const o of manifest.objetos) {
    const g = o.geometria;
    assert.ok(g, `objeto ${o.yvy_id} sin campo geometria`);
    assert.ok(estados.has(g.estado), `objeto ${o.yvy_id}: estado "${g.estado}" inválido`);

    // tiene_geometria y pmtiles tienen que contar la misma historia.
    assert.equal(o.tiene_geometria, g.estado !== 'missing', `objeto ${o.yvy_id}: tiene_geometria contradice geometria.estado`);
    if (g.estado === 'missing') {
      assert.equal(o.pmtiles, null, `objeto ${o.yvy_id}: missing con pmtiles`);
    } else {
      assert.ok(o.pmtiles, `objeto ${o.yvy_id}: ${g.estado} sin archivo`);
      assert.equal(g.artefacto, o.pmtiles, `objeto ${o.yvy_id}: artefacto declarado ≠ pmtiles`);
      if (g.estado === 'remota') {
        // La geometría remota tiene que estar declarada y verificada en el manifest.
        assert.ok(artefactos.has(g.artefacto), `objeto ${o.yvy_id}: artefacto ${g.artefacto} no está en manifest.geometria`);
      } else {
        // Local: el archivo existe en el repo (no hace falta verificarlo por red).
        assert.ok(existsSync(leer(`public/data/${g.artefacto}`)), `objeto ${o.yvy_id}: falta public/data/${g.artefacto}`);
      }
    }
    assert.ok(o.minzoom <= o.maxzoom, `objeto ${o.yvy_id}: zooms invertidos`);
  }
});

test('municipios: faltantes declarados, con motivo y sin inventar cámara', { skip }, () => {
  const municipios = manifest.objetos.filter((o) => o.nivel === 'municipio');
  assert.ok(municipios.length > 0);

  const faltantes = municipios.filter((o) => o.geometria.estado === 'missing');
  for (const o of faltantes) {
    assert.equal(o.geometria.motivo, 'sin_feature_en_artefacto', `objeto ${o.yvy_id}: falta motivo`);
    assert.equal(o.tiene_geometria, false);
    assert.equal(o.pmtiles, null);
    assert.equal(o.centro, null, `objeto ${o.yvy_id}: sin feature no puede tener centro`);
  }

  const fuente = manifest.fuentes.find((f) => f.nivel === 'municipio');
  assert.equal(fuente.faltantes, faltantes.length);
  assert.equal(fuente.pmtiles, municipios.length - faltantes.length);
  assert.equal(fuente.geometria, 'remota');

  // El registro tiene que decir lo mismo que los objetos: nada de "0 faltantes".
  const artefacto = manifest.geometria.artefactos.find((a) => a.nivel === 'municipio');
  assert.ok(artefacto?.cobertura, 'el artefacto no publica cobertura');
  assert.equal(artefacto.cobertura.entidades_sin_feature, faltantes.length);
});

test('cobertura del artefacto: cada feature tiene entidad o está declarada huérfana', { skip }, () => {
  for (const a of manifest.geometria?.artefactos || []) {
    const c = a.cobertura;
    if (!c) continue;
    const nivel = manifest.objetos.filter((o) => o.nivel === a.nivel);
    const ids = new Set(nivel.flatMap((o) => [o.yvy_id, ...(o.centro_id_origen ? [o.centro_id_origen] : [])]));
    // features = entidades con feature + huérfanas, sin solapamiento.
    assert.equal(c.features_con_id, c.entidades_con_feature + c.ids_huerfanos.length, `${a.archivo}: la cuenta de cobertura no cierra`);
    for (const id of c.ids_huerfanos) {
      assert.ok(!ids.has(id), `${a.archivo}: el "huérfano" ${id} sí es una entidad del catálogo`);
    }
    for (const o of nivel) {
      if (o.geometria.estado !== 'missing') continue;
      assert.equal(c.entidades_sin_feature > 0, true, `${a.archivo}: declara faltantes pero la cobertura dice 0`);
    }
  }
});

test('los centroides no salen del artefacto que los contiene', { skip }, () => {
  const bounds = new Map((manifest.geometria?.artefactos || []).map((a) => [a.archivo, a.bounds]));
  const margen = 0.5; // grados: el centroide de un objeto no puede estar lejos de su artefacto

  for (const o of manifest.objetos) {
    const b = o.pmtiles ? bounds.get(o.pmtiles) : null;
    if (!b) continue;
    for (const [campo, coords] of [['centro', o.centro], ['centro_etiqueta', o.centro_etiqueta], ['bounds_objeto', o.bounds_objeto]]) {
      if (!Array.isArray(coords)) continue;
      const [x, y] = coords;
      const dentro = Array.isArray(o.bounds_objeto) && campo === 'bounds_objeto'
        ? x >= b[0] - margen && x <= b[2] + margen && y >= b[1] - margen && y <= b[3] + margen
        : x >= b[0] - margen && x <= b[2] + margen && y >= b[1] - margen && y <= b[3] + margen;
      assert.ok(dentro, `objeto ${o.yvy_id} (${o.nombre_oficial}): ${campo} [${coords}] fuera de ${o.pmtiles}`);
    }
  }
});

test('ningún centro es el centro del artefacto por relleno', { skip }, () => {
  // El bug anterior: a los municipios sin centroide se les ponía el centro
  // del artefacto nacional. Es una coordenada inventada sobre el objeto.
  const artefactos = manifest.geometria?.artefactos || [];
  for (const a of artefactos) {
    if (!Array.isArray(a.center)) continue;
    const conRelleno = manifest.objetos.filter(
      (o) => o.pmtiles === a.archivo && Array.isArray(o.centro) && o.centro[0] === a.center[0] && o.centro[1] === a.center[1],
    );
    assert.equal(conRelleno.length, 0, `${conRelleno.length} objetos de ${a.archivo} usan el centro del artefacto como propio`);
  }
});
