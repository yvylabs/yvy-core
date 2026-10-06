# CABLEADO — De tus salidas al portal (qué espera el repo de cada archivo)

El portal **no lee tus archivos de curación directamente**: lee lo que el build publica.
Este manual define el contrato entre `Yvy_v2/` (Drive) y `yvyexplorer/` (repo).

## Mapa de ruteo (origen → destino → consumidor)

| Origen (Drive `Yvy_v2/`) | Destino (repo) | Consumidor portal |
|---|---|---|
| `05_curacion/jurisdicciones/*.parquet` | `data/registry/*.parquet` (mismo nombre) | build → `manifest.json` |
| `05_curacion/tipos/*.parquet` | `data/registry/*.parquet` (mismo nombre, sin límite de tamaño) | build → `public/data/agregados/{tipo}/{yvy_id}.json` |
| `08_pmtiles/*.pmtiles` ≤50MB | `public/data/*.pmtiles` (mismo nombre) | `pmtiles://data/…` directo |
| `08_pmtiles/*.pmtiles` >50MB | R2 `yvy-data` + Functions | `/tiles/*` vía proxy |
| `07_manifest/catalogo.json` | **No entra al repo** (es tu índice QC) | el build genera el manifest real |

## Contratos por archivo

### 1. Registry parquets (`data/registry/`)
- Nombre = nivel en plural: `paises|provincias|departamentos|municipios|barrios.parquet`.
- Son **input del build**, no output: **sin límite de tamaño** salvo el 100MB duro de GitHub.
- Columnas obligatorias: `yvy_id` (INT64, único, en rango del nivel), `nivel`, `parent_yvy_id` (existe en catálogo), `nombre_oficial`.
- El build advierte (no bloquea): fuera de rango, padres huérfanos, columnas sin `yvy_id`.

### 2. Dataset versions (`data/registry/<tipo>.parquet`)
- Sin fecha en el nombre (D2=A); la versión vive en la columna `version`.
- Columnas obligatorias: `yvy_id` + métricas + `fuente` + `fecha_vigencia` + `version`.
- El build publica **versión activa** en `manifest.datasets` y parte por `yvy_id` a `public/data/agregados/{tipo}/{yvy_id}.json` con forma `{tipo,categoria,yvy_id,yvy_id_contenedor,fuente,fecha_vigencia,version,metricas{...}}`.
- Nulos en métricas → `0`. Rollup automático a ancestros (suma numérica; el directo manda).
- Vocabulario fijo de categorías: Sociedad, Economía, Ambiente, Infraestructura.

### 3. PMTiles (`public/data/*.pmtiles`)
- Un archivo por nivel/tipo, nombre en minúsculas = nivel o tipo.
- **Umbral 50MB**: ≤50MB entra al repo; >50MB queda en R2 (o local en dev). El gate-a bloquea >50MB.
- Cada feature con **`id` numérico = `yvy_id`** (tippecanoe `--use-attribute-for-id=id`). Sin esto: capas vacías + centros fallback.
- El build verifica `X/Y con id coincidente` y calcula centroides + `bounds_objeto` reales.

### 4. Agregados (`public/data/agregados/{tipo}/{yvy_id}.json`)
- **Los genera el build** desde el registry. Los JSON de Colab (`06_agregados/`) son referencia QC: si difieren del build, manda el build (fuente única).
- El portal los trae lazy on-click (`getAgregado(tipo, yvy_id)`); ausente = “Sin datos registrados todavía.”

### 4b. Relaciones (`public/data/relaciones.json`)
- Solo `lindero` + `cerca_de`, generadas por `tools/yvy_plantilla.py` (`calcular_linderos`, `calcular_cercanos`).
- `contiene` **no** va al archivo: se deriva de `parent_yvy_id` en el manifest.

### 5. Lo que NUNCA entra al repo
`*.fgb` siempre. `*.pmtiles` >50MB. `*.parquet` fuera de `data/registry/` o >100MB. `*.zip/*.7z` de backup. `node_modules/`, `dist/`, `.env*`, `.dev.vars`. El CI (gate-a) bloquea el diff si aparecen.

## Checklist pre-subida (antes de copiar al repo)
1. `validar_contrato()` vacío para cada parquet (rangos, padres, dupes).
2. `id` únicos = features en cada PMTiles (verificación del template).
3. `catalogo.json` de curación con 0 huérfanos.
4. Nombres de archivo según §1-3 (plural, minúsculas, `<tipo>.parquet` sin fecha).
5. Build local verde (`pnpm run build`) → commit → push `develop` → PR → `master` → tag.
