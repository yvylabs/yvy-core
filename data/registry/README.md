# Registry — fuente de verdad (datos)

Los parquets de esta carpeta alimentan `public/data/manifest.json` vía el
plugin `yvyManifest` de `vite.config.js` (lector `hyparquet`).
**No tocar sin SPEC.**

Contrato vigente: ver `SPEC.md` en la raíz (grafo de decisiones conectadas,
conflación determinista, versionado inmutable, estados `ok/empty/missing`).

## Dos tipos de archivos en este directorio

### 1. Jurisdiccionales (un parquet por nivel)

Son los nodos del grafo. Uno por nivel, nombre en plural:

- `paises.parquet`
- `provincias.parquet`
- `departamentos.parquet`
- `municipios.parquet`
- `barrios.parquet`

**Columnas obligatorias:**
- `yvy_id` (INT64, único, en rango del nivel)
- `nivel` (país | provincia | departamento | municipio | barrio)
- `parent_yvy_id` (existe en el catálogo, o `0` para país)
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
- `public/data/*.pmtiles`: **<25 MB** al repo; **≥25 MB** a R2 (cuando
  exista). Ejemplos: `municipios.pmtiles` (48 MB) y `catastro.pmtiles`
  (164 MB) van a R2.
- `public/data/*.pmtiles` `<100 MB` es el límite duro de GitHub sin LFS.
  Por encima, no entran al repo de ninguna manera.

## Cómo se regenera

1. Los parquets vienen del pipeline de curación (Drive, Colab).
2. Se copian a `data/registry/` (sin tocar, tal cual salen).
3. `pnpm run build` lee los parquets vía `hyparquet` y genera
   `public/data/manifest.json` + `manifest.jsonld` + `<nivel>_centros.json`.

**No editar los parquets a mano.** No editar el manifest a mano. Todo se
regenera en cada build.

## Fuente

Pipeline: `/content/drive/MyDrive/YvyLabs/YvyExplorerProduction/`

- `05_curacion/jurisdicciones/*.parquet` → acá (5 parquets jurisdiccionales)
- `05_curacion/tipos/*.parquet` → acá (3 parquets de tipos)
- `07_manifest/relaciones.json` → `public/data/relaciones.json`
- `08_pmtiles/*.pmtiles` → `public/data/*.pmtiles`
- `06_agregados/<tipo>/*.json` → `public/data/agregados/<tipo>/*.json`

Los archivos de `07_manifest/catalogo.json` **no van al repo** (son QC
interno del pipeline).

## Estado actual

- Jurisdiccionales: 8 (5 de niveles + 3 de tipos).

Espera... son 5 jurisdiccionales + 3 de tipos = 8 totales. El conteo
"5 de niveles + 3 de tipos" = 8, ok.

- `paises.parquet` (1 fila)
- `provincias.parquet` (24)
- `departamentos.parquet` (529)
- `municipios.parquet` (2.106)
- `barrios.parquet` (434)
- `demografia.parquet` (4, ampliable a 60+)
- `mineria.parquet` (3.925)
- `catastro.parquet` (309.403)

Total: 3.094 nodos jurisdiccionales + 3 datasets.