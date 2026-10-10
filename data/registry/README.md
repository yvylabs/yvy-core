# Registry — fuente de verdad (datos)

Los parquets de esta carpeta alimentan `public/data/manifest.json` vía el
plugin `yvyManifest` de `vite.config.js` (lector `hyparquet`).
**No tocar sin SPEC.**

Contrato vigente: ver `SPEC.md` en la raíz (grafo de decisiones conectadas,
conflación determinista, versionado inmutable, estados `ok/empty/missing`).

## Dos tipos de archivos en este directorio

### 1. Jurisdiccionales (un solo parquet)

Son los nodos del grafo. Un solo archivo con todos los niveles:

- `jurisdicciones.parquet` (columna `nivel`: `pais, provincia,
  departamento, gobierno_local, barrio`; el build los mapea a su
  canónico `pais, provincia, depto, municipio, barrio`)

**Columnas obligatorias:**
- `yvy_id` (INT64, único, en rango del nivel)
- `nivel` (país | provincia | departamento | municipio | barrio)
- `parent_yvy_id` (existe en el catálogo, o nulo para país y
  nodos indeterminados)
- `nombre_oficial` (string)

**Columnas opcionales por nivel:**
- `cod_indec` (string)
- `nombre_corto`, `tipo_barrio` (solo barrios)
- `geom_estado` (ok | reparada | degradada | vacía | nula)

Contrato completo en SPEC §1 y §10.

### 2. Datasets (uno por tipo)

Son agregados que cuelgan de las fichas (no son nodos). Un parquet por
tipo, nombre en singular:

- `demografia.parquet` (nivel_agregacion: municipio)
- `mineria.parquet` (nivel_agregacion: departamento)
- `catastro.parquet` (nivel_agregacion: departamento)

**Columnas obligatorias:**
- `yvy_id` (INT64, del nodo contenedor según `nivel_agregacion`)
- métricas propias del tipo
- `fuente` (string)
- `fecha_vigencia` (string, `YYYY-MM`)
- `version` (string)

El build los parte a `public/data/agregados/<tipo>/<yvy_id>.json` con forma
`{tipo, categoria, yvy_id, yvy_id_contenedor, fuente, fecha_vigencia,
version, metricas{...}}`.

Contrato completo en SPEC §10.

## Geometría

La geometría **NO vive acá**. Vive en `public/data/*.pmtiles` (un archivo
por nivel o por tipo), con propiedad `id = yvy_id` numérico
(tippecanoe `--use-attribute-for-id=id`).

## Umbrales

- `data/registry/*.parquet`: **sin límite de tamaño** en el repo (son
  inputs del build, el tamaño lo decide el dato).
- `public/data/*.pmtiles`: **≤50 MB** al repo; **>50 MB** a R2 (cuando
  exista). Ejemplo: `catastro.pmtiles` (164 MB) va a R2.
- `public/data/*.pmtiles` `<100 MB` es el límite duro de GitHub sin LFS.
  Por encima, no entran al repo de ninguna manera.

## Cómo se regenera

1. Los parquets vienen del Sheet (export CSV) validados con
   `tools/sheet_a_parquet.py` (solo escribe si el contrato da ok).
2. Se copian a `data/registry/` (sin tocar, tal cual salen).
3. `pnpm run build` lee los parquets vía `hyparquet` y genera
   `public/data/manifest.json` + `manifest.jsonld` + `<nivel>_centros.json`.

**No editar los parquets a mano.** No editar el manifest a mano. Todo se
regenera en cada build.

## Fuente

Pipeline: Google Sheet (edición) → CSV → `tools/sheet_a_parquet.py` → acá.

- `jurisdicciones.parquet` → acá (1 parquet: 1 país + 24 prov + 529 depto + 2348 gob + 434 barrios)
- `tipos/*.parquet` → acá (3 parquets de tipos)
- `07_manifest/relaciones.json` → `public/data/relaciones.json`
- `08_pmtiles/*.pmtiles` → `public/data/*.pmtiles`
- `06_agregados/<tipo>/*.json` → `public/data/agregados/<tipo>/*.json`

Los archivos de `07_manifest/catalogo.json` **no van al repo** (son QC
interno del pipeline).

## Estado actual

- `jurisdicciones.parquet` (3334: 1 + 24 + 529 + 2348 + 432; con
  `sup_oficial_km2` + `sup_fuente` donde hay dato)
- `demografia.parquet` (2843, nacional Censo 2022)
- `mineria.parquet` (3927)
- `catastro.parquet` (309405)

Total: 3336 nodos jurisdiccionales + 3 datasets.