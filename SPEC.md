# Yvy Explorer — SPEC v1 (fuente de verdad)

> Grafo de entidades para la acción. Conflación determinista — el territorio es un insumo más. AI-ready por arriba (Labs).

**No es:** visor GIS, ni IDE, ni OSINT. No apila capas, no tiene query builder, no scrapea. Globo 3D vacío hasta interacción.

## 1. Modelo

* `Territorio`: pais 0-999, provincia 1000-1999, depto 100000-199999, municipio 1000000-1999999, barrio 1000000000-1999999999. Esquema `yvy_id = 1 + código oficial`; un solo `parent_yvy_id` por objeto (municipio → 1 depto, sin excepciones).
* Piloto: Argentina 0 + Salta 1066 + Capital 166028 + Los Andes 166105 + municipios 1660063/1660070/1660245/1660252 + barrios de Salta ciudad (`1660063xxx`, orden por `nom_largo`).
* `Entidad`: escuela, hospital, tramo ruta/FFCC, concesión minera, parcela. `CONTIENE` precomputado fuera.
* `Parquet = hechos + agregados por yvy_id` / `PMTiles = solo render` / `manifest.json = índice` / detalle = lazy.
* Registry: `data/registry/*.parquet` (un parquet por nivel). CSV prohibido.

## 1b. Versionado (nunca se sobrescribe)
* Archivos inmutables con versión: `escuelas_2025-09.parquet`. R2 con versionado activado.
* `manifest.json` lleva **solo la versión activa** por dataset (`version + source_date`); la ficha muestra vigencia siempre.
* Historial duerme en R2 (pérdida cero, costo cero en browser). Evolución/comparar años = **Labs pago** (`?version=` con key). El free nunca paga la historia (60fps intacto).

## 2. Reglas deterministas (cero alucinación)

* Estados: `ok | empty | missing`. `missing` = "No tengo ese dato todavía", `empty` = "No hay resultados en esta zona". Nunca silencio, nunca invento.
* `fetch` con base absoluta (`import.meta.env.BASE_URL`), tolerante a 404.
* Welcome exige click explícito (no `Enter` ciego). Búsqueda agrupa por nivel, Salta primero en piloto.
* Ficha: totales siempre (Fase 1 = solo manifest), detalle lazy por dataset (Fase 3 = +agregados on-click con acordeón colapsado).

## 3. conflation.spec

* `id estable = yvy_id`, tolerancia 0, desempate documentado. Sin match → `missing`.
* Test Salta: 0 slivers (polígono real, fallback bbox solo visual, nunca numérico).

## 4. copy.spec (free)

* Copiar = snapshot visible, nunca consulta cruda. Dos modos:
  * Territorio: `nombre · breadcrumb · yvy:id + totales visibles + fuente + fecha + link #y=&c=&z=`.
  * Entidad: `nombre · territorio · top 5-6 campos + fuente + fecha + link`.
* `missing` se escribe explícito, no se omite.

## 5. telemetry.spec (privada, para el dueño)

* Solo agregados: `{day, country(cf-ipcountry), event, yvy_id, nivel}`. Nunca texto libre, IP, coords exactas.
* Eventos: `app_load, search_miss(q_hash), pick, ficha_view, report_copy`.
* `DNT` + `?telemetry=0` opt-out. Stack free: Pages + Web Analytics + Zaraz + 1 Worker → D1.
* Futuro firmador R2 (URLs cortas piloto Salta): endpoint con allowlist + método explícito (gate d).

## 6. Non-goals Explorer free-forever

No MCP, no upload, no download binario (PNG/PDF/Excel). PNG = screenshot OS. `window.print()` + CSS print + `Copiar resumen` son las únicas salidas. Todo lo premium va a Eyes/Labs.

## 7. Esqueleto

KEEP: `main, manifest, layers(slim), objeto(slim), welcome, ui, share, statusbar(slim), telemetry, main.css(slim)` (9 js + 1 css).
DELETE: `assistant, measure, reasoner, datasets(stub→literal), geo.worker, atmosphereEffects, basemaps+control→ensureSatelite()`.
`vite.config`: no emite `tabla_*`, sin fallback carpetas por-objeto.

## 7b. Artefactos derivados (generados, con contrato mínimo)
* `manifest.jsonld`: mismo grafo que `manifest.json` en JSON-LD (`context.jsonld` = ontología ejecutable). Se regenera en cada build.
* `public/data/<nivel>_centros.json`: `{v, archivo, size, mtimeMs, porId: {yvy_id: {c:[lng,lat], b:[w,s,e,n]}}, observados[]}`. Cache por mtime+size; se recalcula si cambia el PMTiles.
* `public/data/relaciones.json`: `[{origen_yvy_id, destino_yvy_id, tipo}]` (Fase 3: links cruzados; hoy puede no existir → la ficha lo tolera).
* `functions/` vive en este repo y deploya con Pages (mismo deploy, `pages_build_output_dir=dist`).
* Firmador R2 (URLs cortas) = Labs, no Explorer free.

## 8. Done Fase 1

`src/` 18→9 files, `pnpm run build` limpio, `welcome→ficha→copiar→share-restore` en <2 clicks, fps solo `?debug=1`.

## 10. Contrato datasets v1 (piloto Salta, congelado)
* Niveles: país 0, Salta 1066, Capital 166028, Los Andes 166105, 4 municipios, barrios `1660063xxx` (solo Salta ciudad).
* Tipos: `demografia` (municipio + rollup), `mineria` (depto directo, clave `tipo+expediente`), `catastro` inmuebles (depto directo, clave `parcela_id`), `barrios` (nivel, no dataset). El rollup a ancestros solo aplica donde hay filas hoja (demografía); minería/catastro publican su agregado depto en origen.
* Agregado: `{tipo, categoria, yvy_id, yvy_id_contenedor, fuente, fecha_vigencia, version, metricas{...}}`. Categorías: Sociedad, Economía, Ambiente, Infraestructura (territorio = eje, no categoría).
* Territorio: `cod_indec` + `georef_id` separados; `clase_municipio` (M1/M2/M3, glosario INDEC Censo 2022 cuadro 1.17); `clase_barrio` (Barrio/Asentamiento) + `formalidad`.
* Versionado: snapshots `tipo_YYYY-MM.parquet` inmutables en R2; solo versión activa en manifest; evolución = Labs.
* Superficies municipio: calculadas GK faja 3 POSGAR 2007 (`sup_oficial_tipo: calculada`). Geometrías en 4326.

## 10b. Pipeline curación (Drive Yvy_v2, fuera del repo)
Herramienta canónica versionada en `tools/yvy_plantilla.py` (la copia de trabajo vive en Drive; el repo manda). Runner oficial: Colab con checkpoint por celda (ver `tools/`). Etapas numeradas: `00_entrada` (crudo) → `01_work` (GPKG por banda) → `02_backup` → `03_config` → `04_logs` → `05_curacion/{tipo}/{tipo}_{fecha}.parquet` → `06_agregados/{tipo}/{yvy_id}.json` → `07_manifest/manifest.json` (vigente; versionados `manifest_<ts>.json`) → `08_pmtiles/{nivel}.pmtiles` → `99_legacy/` (solo lectura).
Handoff al repo: `05` jurisdicciones → `data/registry/*.parquet`; `06` → `public/data/agregados/{tipo}/{yvy_id}.json` (Fase 3); `08` → `public/data/*.pmtiles`; `07` lo regenera el build (no se copia).
Excepción: `08` es un archivo por nivel de jurisdicción; tipos con geometría propia (minería) van como `{tipo}.pmtiles` documentado.

## 9. Deploy (única vía: Git integration)
PR → preview deploy, merge a `master` → production. Prohibido deployar desde CI. Node vía `.nvmrc` (22) o `NODE_VERSION=22` en dashboard. Output `dist`.
