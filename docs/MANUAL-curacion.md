# MANUAL — Del Sheet al `data/registry/` (sin Colab)

Flujo vigente: editar en Google Sheet → Archivo → Descargar CSV →
validar y convertir con `tools/sheet_a_parquet.py` → copiar a
`data/registry/` → `pnpm run build`.

```bash
python tools/sheet_a_parquet.py jurisdicciones.csv data/registry/jurisdicciones.parquet
python tools/sheet_a_parquet.py demografia.csv data/registry/demografia.parquet
```

El script valida el contrato (columnas, `yvy_id` únicos y en rango,
padres existentes, métricas numéricas) y **solo escribe si da ok**
(`--force` para excepciones conocidas, ej. los 8 indeterminados
`9000000001..08`). Hace backup del parquet anterior en `02_backup/`.

## Paso 0 — Qué necesitas

- Python 3.10+ con `geopandas pyogrio pyarrow pyproj pandas pyyaml`.
- `tippecanoe` instalado **solo** si vas a generar PMTiles.
- Tu archivo en una carpeta de entrada (ej. `00_entrada/`).

## Paso 1 — Inventariar (qué tengo)

```python
from yvy_plantilla import inventario_gpkg, inventario_csv
print(inventario_gpkg("00_entrada/Municipios.gpkg"))  # UNA fila por CAPA
print(inventario_csv("00_entrada/cuadro_1.17.csv"))   # columnas + filas aprox
```

Reglas:
- Si el GPKG tiene varias capas, se lista cada una (nunca se toma “la primera” en silencio).
- Si falta el CRS, se marca — no se inventa. Asígnelo manual antes de seguir.
- CSV: se prueba `utf-8-sig` y `latin-1`; queda normalizado a UTF-8.

## Paso 2 — Curar geometría (solo GPKG)

```python
gdf, rep = curar_geometrias(gdf, familia="poligono")  # o "punto" / "linea"
print(rep)  # invalidas, vacias, nulas, tipos_inesperados
```

- **Polígono:** `make_valid` en inválidas; vacías/nulas se **marcan** (`geom_estado`), no se borran.
- **Punto/línea:** solo reporte (sin `buffer(0)` ni `make_valid` agresivo).
- Tipos mezclados (ej. un `LineString` entre polígonos) → se reportan en `tipos_inesperados`; se corrigen en origen, no acá.

## Paso 3 — Asignar `yvy_id` (estable, esquema `1+código`)

```python
from yvy_plantilla import yvy_id_municipio
gdf["yvy_id"] = gdf["in1"].apply(yvy_id_municipio)   # 660070 → 1660070
```

| Nivel | Fórmula | Ejemplo |
|---|---|---|
| País | fijo | `0` |
| Provincia | `1000 + in1` | `66` → `1066` |
| Departamento | `100000 + in1` | `66028` → `166028` |
| Municipio | `1000000 + in1` | `660070` → `1660070` |
| Barrio | `municipio*1000 + secuencia` | sobre orden por `nom_largo` |

Después valida siempre:

```python
from yvy_plantilla import validar_contrato
print(validar_contrato(df, nivel="municipio"))  # [] = ok
```

## Paso 4 — Convertir

**CSV → Parquet:**

```python
csv_a_parquet("00_entrada/cuadro.csv", "05_curacion/tipos/demografia.parquet",
    columnas={"Código de gobierno local": "cod_indec", "Población": "poblacion", ...},
    numericas_int=["poblacion", "viviendas"],
    null_es_cero=["viv_colectivas", "pob_calle"],
    join_yvy={"parquet": "05_curacion/jurisdicciones/municipios.parquet",
              "left_on": "cod_indec", "right_on": "cod_indec"})
```

Miles con `.`/`,`, coma decimal, `"-"` como ausencia: todo manejado. Nulos de conteo → `0`.

**GPKG capa → PMTiles:**

```python
gpkg_capa_a_pmtiles("01_work/local.gpkg", "barriosSalta",
    "08_pmtiles/barrios.pmtiles", col_id="yvy_id", zmin=10, zmax=14)
```

- `col_id` debe existir, sin nulos ni duplicados (se verifica antes de correr tippecanoe).
- Zoom por defecto según geometría: polígono `8-14`, punto `10-16`, línea `8-14` (ver `ZOOM_POR_GEOM`; ajústalos por caso).
- Bandera fija **`--use-attribute-for-id=id`** (la única válida en tippecanoe Felt).
- Escritura atómica + verificación de magic `PMTiles`; si falla, no queda archivo corrupto.
- `drop_densest=False` por defecto: **no se tira ningún feature sin tu orden explícita.**

## Paso 5 — Agregados + catálogo

```python
escribir_agregados("demografia", "Sociedad", filas, "06_agregados/demografia",
    "INDEC Censo 2022", "2022-05", "1.0",
    ["poblacion", "viviendas", "viv_particulares", ...])
escribir_catalogo(nodos, tipos, {"demografia": [1660063, ...]}, "07_manifest/catalogo.json")
```

## Qué hacer con cada salida (matriz de ruteo)

| Salida | Destino | Quién la usa |
|---|---|---|
| `{nivel}.parquet` jurisdicciones | `data/registry/` del repo | build → manifest |
| `tipos/<tipo>.parquet` | `data/registry/<tipo>.parquet` (input del build, sin límite salvo 100MB de GitHub) | build → agregados |
| `agregados/{tipo}/{yvy}.json` | los **regenera el build**; los de referencia son QC | portal (lazy) |
| `*.pmtiles` ≤50MB | `public/data/` del repo | portal directo |
| `*.pmtiles` >50MB | R2 + Functions (o local en dev) | portal vía proxy |

Funciones nuevas que tenés que conocer: `join_yvy` (trae `yvy_id` desde
jurisdicciones con reporte de no-matcheados), `filtro_geom_estado` en PMTiles,
`calcular_linderos` / `calcular_cercanos` + `escribir_relaciones` (solo
`lindero` + `cerca_de`; `contiene` se deriva), `registrar_tipo` (punto/línea/
polígono + categoría del vocabulario), `guardar_estado` / `fase_completada`
(checkpoint), `instalar_tippecanoe` (pin 2.79.0).

Ver **CABLEADO.md** para el lado portal (qué espera el repo de cada archivo).
