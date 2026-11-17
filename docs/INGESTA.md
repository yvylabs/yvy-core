# Ingesta de un cliente — paso 0 (functional)

`scripts/ingesta.py` toma una carpeta `cliente/` con PDFs, Excels, GeoJSONs y
CSVs y genera los artefactos que necesita `pnpm run receta`: **Parquet del
registry, Parquet de datasets, PMTiles y ontología**. No toca los datos del
repo: todo sale en `--out`.

## Instalación (una vez)

```bash
python3 -m venv /tmp/venv-ingesta
/tmp/venv-ingesta/bin/python -m pip install -r requirements-ingesta.txt
```

Sin esas librerías el esqueleto sigue funcionando en modo inspección y
marca los pasos que no puede ejecutar (`pendiente`), nunca los finge.

## Uso

```bash
/tmp/venv-ingesta/bin/python scripts/ingesta.py cliente/ --out salida/
/tmp/venv-ingesta/bin/python scripts/ingesta.py cliente/ --out salida/ --dry-run
/tmp/venv-ingesta/bin/python -m unittest tools.test_ingesta -v   # 14 tests
```

## Salidas

```
salida/
  inventario.json                       qué había y qué se pudo leer
  ontologia.csv                         plantilla para el cliente
  ontologia.json                        la que lee la receta (CSV no alcanza)
  plan.json                             columnas + comandos sugeridos
  data/ontologia.json
  data/registry/jurisdicciones.parquet  entidades → catálogo
  data/registry/demografia.parquet      métricas → agregados certificados
  public/data/<nivel>s.pmtiles          geometría MVT (id de feature = yvy_id)
  public/data/relaciones.json
```

## Contrato aplicado

- **Vocabulario del registry:** `nivel` usa el diccionario INDEC/IGN que
  espera `src/lib/catalogo.js`: `municipio → gobierno_local`,
  `depto → departamento`. Escribir `"municipio"` hace que el build
  descarte las filas por "nivel desconocido".
- **`yvy_id`**: se lee de la propiedad `yvy_id`/`id` del GeoJSON o de la
  columna del CSV. Sin él, el archivo se reporta pero no se convierte.
- **Geometría**: se generan MVT con un polígono pequeño alrededor del
  centroide de cada feature, con `id` y `yvy_id` como propiedades. El
  build filtra por feature-id (o propiedad), por eso funciona sin
  `tippecanoe`. Es geometría de **demo**, no la oficial del cliente.
- **Dato faltante**: celda vacía → `null` en el Parquet. Nunca `0`.
- **Fuente y fecha** del CSV pasan al agregado y al `hash_entidad`.
- **Certificados**: NO se escriben a mano. El build los calcula al derivar
  los agregados desde `demografia.parquet`.

## Demostración punta a punta (ya ejecutada)

Con un fixture sintético de 3 municipios, un CSV, un XLSX y un PDF real:

```
[ingesta] 4 archivos · excel:1, geojson:1, pdf:1, tabular:1
[ingesta] ontología: 30 filas · roundtrip OK
[ingesta] ⚠ boletin.pdf: texto extraído: declarar fuente y fecha de corte…
[ingesta] construido: 3 entidades, 1 agregados, 1 PMTiles
```

Copiando esos artefactos a un sandbox con `src/` y `scripts/` del repo:

```
[yvy-manifest] centros reales de municipios.pmtiles calculados: 3 features con id.
[yvy-manifest] municipio jurisdicciones.parquet: 3 objetos, 3/3 con geometría
[yvy-manifest] dataset demografia 0.1: 3 agregados (Censo 2022)
[yvy-receta] 3 entidades en 3 municipio ... verificación OK
```

Un agregado generado trae `hash_entidad` / `hash_linaje` calculados por el
build, no copiados.

**regla de oro:** nunca correr la receta sobre `data/` y `public/data/` del
repo con datos de un cliente. Usar `--out` y un sandbox; el contrato del
producto se demuestra con fixture, se publica con dato oficial.

## Límites

- El PDF se extrae con `pypdf`; no se inventan tablas: si el archivo solo
  tiene texto, queda como texto y avisa que hay que declarar fuente/fecha.
- El Excel se lee con `openpyxl` (primera hoja).
- La geometría sintética es para probar el pipeline; para producción se
  usa la fuente oficial del cliente y se registra en `data/pmtiles.json`.
