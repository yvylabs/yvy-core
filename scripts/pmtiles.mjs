#!/usr/bin/env node
// ==============================================================
// pmtiles.mjs — Verifica un PMTiles publicado y actualiza el registro
// ------------------------------------------------------------
// El manifest no puede decir "este nivel no tiene geometría" cuando
// el artefacto está publicado: eso es un dato falso. Pero tampoco
// puede decir "tiene geometría" por fe. La verdad se lee del archivo:
// 127 bytes de header por HTTP Range, sin descargarlo.
//
//   node scripts/pmtiles.mjs listar
//   node scripts/pmtiles.mjs verificar --nivel municipio \
//     --url https://yvy-explorer.pages.dev/data/municipios.pmtiles \
//     --sha256 --escribir
//
// --sha256 descarga el artefacto una vez y lo hashea (evidencia de que
// el archivo servido es el que se declara). Sin red no hay verificación:
// el registro queda como está y el build avisa si está viejo.
// ==============================================================

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { HEADER_BYTES, aplicarMetadatosJSON, leerHeaderPMTiles } from '../src/lib/pmtiles-header.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const REGISTRO = path.join(RAIZ, 'data/pmtiles.json');
const SCHEMA = 'yvy-pmtiles-v1';

function parseArgs(argv) {
  const opciones = { comando: argv[2] || 'listar', sha256: false, escribir: false, json: false };
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--nivel') opciones.nivel = argv[++i];
    else if (a === '--url') opciones.url = argv[++i];
    else if (a === '--archivo') opciones.archivo = argv[++i];
    else if (a === '--sha256') opciones.sha256 = true;
    else if (a === '--escribir') opciones.escribir = true;
    else if (a === '--json') opciones.json = true;
    else throw new Error(`argumento desconocido: ${a}`);
  }
  return opciones;
}

async function leerRegistro() {
  try {
    const reg = JSON.parse(await readFile(REGISTRO, 'utf8'));
    if (reg.schema !== SCHEMA) throw new Error(`registro con schema "${reg.schema}" (se esperaba ${SCHEMA})`);
    reg.artefactos = reg.artefactos || [];
    return reg;
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
    return { schema: SCHEMA, artefactos: [] };
  }
}

/** GET por rango de bytes. `identity` es obligatorio: con gzip los offsets mienten. */
async function pedirRango(url, desde, hasta) {
  const res = await fetch(url, { headers: { Range: `bytes=${desde}-${hasta}`, 'Accept-Encoding': 'identity' } });
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} al pedir bytes ${desde}-${hasta}`);
  return Buffer.from(await res.arrayBuffer());
}

async function sha256Remoto(url) {
  const res = await fetch(url, { headers: { 'Accept-Encoding': 'identity' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
  const h = createHash('sha256');
  let bytes = 0;
  for await (const trozo of res.body) {
    h.update(trozo);
    bytes += trozo.length;
  }
  return { sha256: h.digest('hex'), bytes };
}

async function verificar(opciones) {
  if (!opciones.nivel) throw new Error('falta --nivel (pais, provincia, depto, municipio, barrio, concesion)');
  if (!opciones.url) throw new Error('falta --url del .pmtiles publicado');

  const headerBuf = await pedirRango(opciones.url, 0, HEADER_BYTES - 1);
  let header = leerHeaderPMTiles(headerBuf);
  if (!header) throw new Error('el archivo no es un PMTiles v3 válido (header de 127 bytes)');

  // Metadatos JSON (vector_layers, bounds, center) por rango, si están.
  if (header.metadataLength > 0) {
    try {
      const raw = await pedirRango(opciones.url, header.metadataOffset, header.metadataOffset + header.metadataLength - 1);
      let json;
      try {
        json = JSON.parse(gunzipSync(raw).toString('utf8'));
      } catch {
        json = JSON.parse(raw.toString('utf8'));
      }
      header = aplicarMetadatosJSON(header, json);
    } catch (err) {
      console.warn(`[yvy-pmtiles] ⚠ metadatos ilegibles: ${err?.message || err}`);
    }
  }

  let sha256 = null;
  let bytes = null;
  if (opciones.sha256) {
    ({ sha256, bytes } = await sha256Remoto(opciones.url));
  }

  return {
    nivel: opciones.nivel,
    archivo: opciones.archivo || path.basename(new URL(opciones.url).pathname),
    url: opciones.url,
    bytes,
    sha256,
    tile_entries: header.tileEntries,
    addressed_tiles: header.addressedTiles,
    min_zoom: header.minZoom,
    max_zoom: header.maxZoom,
    bounds: header.bounds,
    center: header.center || [(header.bounds[0] + header.bounds[2]) / 2, (header.bounds[1] + header.bounds[3]) / 2],
    center_zoom: header.centerZoom,
    capa_interna: header.capaInterna || null,
    version: header.version,
    verificado_en: new Date().toISOString(),
    verificado_como: `Range bytes=0-${HEADER_BYTES - 1} (header PMTiles v3)${sha256 ? ' + sha256 del cuerpo completo' : ''}`,
  };
}

async function main() {
  const opciones = parseArgs(process.argv);

  if (opciones.comando === 'listar') {
    const reg = await leerRegistro();
    if (opciones.json) {
      console.log(JSON.stringify(reg, null, 2));
      return 0;
    }
    for (const a of reg.artefactos) {
      const b = a.bounds ? a.bounds.map((n) => Number(n).toFixed(2)).join(', ') : 'sin bounds';
      console.log(`[yvy-pmtiles] ${a.nivel.padEnd(10)} ${a.archivo.padEnd(26)} z${a.min_zoom}-${a.max_zoom} ${a.tile_entries ?? '?'} tiles · bounds ${b} · ${a.verificado_en}`);
    }
    console.log(`[yvy-pmtiles] ${reg.artefactos.length} artefacto(s) declarados en data/pmtiles.json`);
    return 0;
  }

  if (opciones.comando !== 'verificar') throw new Error(`comando desconocido: ${opciones.comando} (usá listar o verificar)`);

  const artefacto = await verificar(opciones);
  const reg = await leerRegistro();
  const i = reg.artefactos.findIndex((a) => a.nivel === artefacto.nivel && a.archivo === artefacto.archivo);
  const anterior = i >= 0 ? reg.artefactos[i] : null;
  if (anterior && anterior.sha256 && artefacto.sha256 && anterior.sha256 !== artefacto.sha256) {
    console.log(`[yvy-pmtiles] ⚠ cambió el artefacto ${artefacto.archivo}: sha256 ${anterior.sha256.slice(0, 12)}… → ${artefacto.sha256.slice(0, 12)}…`);
  }
  if (i >= 0) reg.artefactos[i] = artefacto;
  else reg.artefactos.push(artefacto);
  reg.artefactos.sort((a, b) => a.nivel.localeCompare(b.nivel) || a.archivo.localeCompare(b.archivo));

  if (opciones.escribir) {
    await writeFile(REGISTRO, JSON.stringify(reg, null, 2) + '\n', 'utf8');
    console.log(`[yvy-pmtiles] registro actualizado: data/pmtiles.json (${reg.artefactos.length} artefacto(s))`);
  }

  if (opciones.json) console.log(JSON.stringify(artefacto, null, 2));
  else {
    console.log(`[yvy-pmtiles] ${artefacto.nivel} ${artefacto.archivo}: PMTiles v${artefacto.version}, z${artefacto.min_zoom}-${artefacto.max_zoom}`);
    console.log(`[yvy-pmtiles]   bounds ${artefacto.bounds.map((n) => n.toFixed(4)).join(', ')}`);
    console.log(`[yvy-pmtiles]   ${artefacto.tile_entries} tile entries · ${artefacto.bytes ?? '?'} bytes · sha256 ${artefacto.sha256 ? artefacto.sha256.slice(0, 16) + '…' : '(no calculado)'}`);
    if (!opciones.escribir) console.log('[yvy-pmtiles] (sin --escribir: no se tocó el registro)');
  }
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((err) => {
    console.error('[yvy-pmtiles] error:', err?.message || err);
    process.exit(2);
  });
