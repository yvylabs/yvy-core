#!/usr/bin/env node
// ==============================================================
// receta.mjs — Runner de la receta tabular (una sola implementación)
// ------------------------------------------------------------
// Cargar un municipio, una provincia o una cuenca nueva no debe
// requerir tocar código: se suelta el parquet en data/registry y se
// corre esta receta. Lo que la receta NO hace es cambiar hashes por
// su cuenta: toda la construcción (catálogo, agregados, certificados,
// ledger) es exactamente la misma función que usa el build
// (`escribirManifest` de vite.config.js). Si esta receta y
// `pnpm run build` dieran hashes distintos, habría dos
// implementaciones: el test tests/receta.test.mjs lo detecta.
//
// Uso:
//   node scripts/receta.mjs                      # regenera y verifica los pines
//   node scripts/receta.mjs --verificar 1660063  # agrega un id a la verificación
//   node scripts/receta.mjs --sin-regenerar      # verifica el build actual, sin tocar archivos
//   node scripts/receta.mjs --json               # salida legible por máquina
//
// Los pines viven en data/receta.verificacion.json: son el contrato de
// que "cargar datos nuevos no cambia lo que ya estaba publicado".
// ==============================================================

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { escribirManifest } from '../src/lib/catalogo.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PINES_SRC = path.join(RAIZ, 'data/receta.verificacion.json');
const DATA_DIR = path.join(RAIZ, 'public/data');

function parseArgs(argv) {
  const opciones = { verificar: [], json: false, regenerar: true, sinReporte: false, pines: PINES_SRC };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opciones.json = true;
    else if (a === '--sin-reporte') opciones.sinReporte = true;
    else if (a === '--sin-regenerar') opciones.regenerar = false;
    else if (a === '--pines') {
      const archivo = argv[++i];
      if (!archivo) throw new Error('--pines necesita una ruta');
      opciones.pines = path.resolve(archivo);
    } else if (a === '--verificar') {
      const id = Number(argv[++i]);
      if (!Number.isInteger(id)) throw new Error('--verificar necesita un yvy_id entero');
      opciones.verificar.push(id);
    } else if (a === '--help' || a === '-h') opciones.ayuda = true;
    else throw new Error(`argumento desconocido: ${a}`);
  }
  return opciones;
}

/** Certificado del agregado de una entidad (o null si no tiene). */
async function certificadoDe(yvyId, tipo) {
  const archivo = path.join(DATA_DIR, 'agregados', tipo, `${yvyId}.json`);
  try {
    const ag = JSON.parse(await readFile(archivo, 'utf8'));
    return ag.certificado || null;
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

async function main() {
  const opciones = parseArgs(process.argv);
  if (opciones.ayuda) {
    console.log('Uso: node scripts/receta.mjs [--verificar <yvy_id>]... [--sin-regenerar] [--sin-reporte] [--json]');
    return 0;
  }

  const pines = JSON.parse(await readFile(opciones.pines, 'utf8'));
  const inicio = Date.now();

  if (opciones.regenerar) {
    await escribirManifest();
  }

  const manifest = JSON.parse(await readFile(path.join(DATA_DIR, 'manifest.json'), 'utf8'));
  const porId = new Map(manifest.objetos.map((o) => [Number(o.yvy_id), o]));

  // Pines declarados + los ids pedidos por línea de comandos (sin hash
  // esperado: solo se reporta lo que el build produjo).
  const objetivos = [...(pines.entidades || [])];
  for (const id of opciones.verificar) {
    if (!objetivos.some((p) => Number(p.yvy_id) === id)) {
      objetivos.push({ yvy_id: id, tipo: 'demografia' });
    }
  }

  const resultados = [];
  for (const p of objetivos) {
    const id = Number(p.yvy_id);
    const objeto = porId.get(id) || null;
    const certificado = objeto ? await certificadoDe(id, p.tipo || 'demografia') : null;
    const problemas = [];
    if (!objeto) problemas.push(`el yvy_id ${id} no existe en el catálogo`);
    if (objeto && p.nombre_oficial && objeto.nombre_oficial !== p.nombre_oficial) {
      problemas.push(`nombre cambió: "${objeto.nombre_oficial}" ≠ "${p.nombre_oficial}"`);
    }
    if (p.hash_entidad && certificado?.hash_entidad !== p.hash_entidad) {
      problemas.push(`hash_entidad ${certificado?.hash_entidad || '(sin certificado)'} ≠ ${p.hash_entidad}`);
    }
    if (p.hash_linaje && certificado?.hash_linaje !== p.hash_linaje) {
      problemas.push(`hash_linaje ${certificado?.hash_linaje || '(sin certificado)'} ≠ ${p.hash_linaje}`);
    }
    resultados.push({
      yvy_id: id,
      nivel: objeto?.nivel || null,
      nombre_oficial: objeto?.nombre_oficial || null,
      tipo: p.tipo || 'demografia',
      hash_entidad: certificado?.hash_entidad || null,
      hash_linaje: certificado?.hash_linaje || null,
      pin: Boolean(p.hash_entidad || p.hash_linaje),
      ok: problemas.length === 0,
      problemas,
    });
  }

  const porNivel = {};
  for (const o of manifest.objetos) porNivel[o.nivel] = (porNivel[o.nivel] || 0) + 1;
  const fallidos = resultados.filter((r) => !r.ok);
  const resumen = {
    schema: 'yvy-receta-v1',
    generado: new Date().toISOString(),
    ms: Date.now() - inicio,
    catalogo: {
      total: manifest.objetos.length,
      por_nivel: porNivel,
      hash_catalogo: manifest.identidad?.hash_catalogo || null,
      migraciones: (manifest.identidad?.migraciones || []).length,
    },
    verificacion: resultados,
    ok: fallidos.length === 0,
  };

  // Reporte por archivo: queda como evidencia de cada corrida. Una
  // corrida con pines alternativos (tests) no pisa la evidencia real.
  const destino = path.join(DATA_DIR, 'receta.json');
  if (!opciones.sinReporte) await writeFile(destino, JSON.stringify(resumen, null, 2) + '\n', 'utf8');

  if (opciones.json) {
    console.log(JSON.stringify(resumen, null, 2));
  } else {
    console.log(`\n[yvy-receta] ${resumen.catalogo.total} entidades en ${Object.entries(porNivel).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    console.log(`[yvy-receta] hash_catalogo ${resumen.catalogo.hash_catalogo || '(sin ledger)'} · ${resumen.catalogo.migraciones} migración(es) · ${resumen.ms} ms`);
    for (const r of resultados) {
      const marca = r.ok ? 'ok  ' : 'FALLA';
      const hash = r.hash_entidad ? r.hash_entidad.slice(0, 12) + '…' : '(sin certificado)';
      console.log(`[yvy-receta] ${marca} ${String(r.yvy_id).padEnd(10)} ${(r.nivel || '?').padEnd(10)} ${(r.nombre_oficial || '?').padEnd(28)} ${r.tipo.padEnd(10)} ${hash}${r.pin ? ' (pin)' : ''}`);
      for (const p of r.problemas) console.log(`              ↳ ${p}`);
    }
    console.log(`[yvy-receta] reporte: public/data/receta.json · ${resumen.ok ? 'verificación OK' : `${fallidos.length} FALLA(S)`}\n`);
  }

  return resumen.ok ? 0 : 1;
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((err) => {
    console.error('[yvy-receta] error:', err?.message || err);
    process.exit(2);
  });
