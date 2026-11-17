# Ingesta de un cliente nuevo — Paso 0 (esqueleto)

`scripts/ingesta.py` es el primer paso del SLA de 72 h. **Hoy no genera
Parquet ni PMTiles**: genera el *plan* para generarlos, con las decisiones
de contrato ya tomadas. Eso es deliberado: generar un Parquet sin
unidades ni fuente declaradas es la manera más rápida de publicar un
dato falso.

## Uso

```bash
python3 scripts/ingesta.py cliente/ --out salida/ingesta/ --dry-run
python3 scripts/ingesta.py cliente/ --out salida/ingesta/
python3 -m unittest tools.test_ingesta -v      # 10 tests, stdlib
```

`cliente/` puede contener `.geojson`, `.csv`, `.xlsx`, `.xls`, `.pdf`.
El escáner es recursivo y determinista (rutas ordenadas, JSON con
`sort_keys`). Libre de dependencias: usa solo la stdlib de Python.

## Salidas

| Archivo | Para qué |
|---|---|
| `inventario.json` | inventario + inspección + resumen; un archivo roto no detiene el proceso |
| `ontologia.csv` | plantilla auditable que el cliente puede completar |
| `ontologia.json` | conversión de la plantilla al formato que **sí** lee la receta |
| `plan.json` | columnas obligatorias del Parquet y receta de PMTiles por nivel |

## Contrato que el esqueleto ya respeta

- **Ontología**: la fuente de verdad sigue siendo `data/ontologia.json`.
  El CSV es una plantilla; `csv_a_ontologia()` preserva `schema`, `version`
  y `reglas` y **no deja pasar una métrica sin `unidad`**.
- **`yvy_id`**: `offset(nivel) + cod_indec`; el tipo va como columna, nunca
  dentro del id. Los ids de relleno van a bloques reservados declarados en
  `data/ids.excepciones.json`.
- **Dato faltante**: `null` + `estado: missing`, nunca `0` de relleno.
- **Fuente obligatoria** en métricas y relaciones; fecha explícita cuando
  no está.
- **Geometría**: el build filtra por `id` de feature MVT (o propiedad
  `yvy_id`/`id`), por eso `plan_pmtiles()` sugiere `--use-attribute-for-id`.
  Los bounds detectados en el GeoJSON se publican en el plan.

## Lo que falta para completar el pipeline (SLA 72 h)

1. **PDF** (`leer_pdf`): extraer texto/tablas con `pypdf`/`pdfplumber`
   *declarando fuente y fecha de corte*; hoy es TODO explícito.
2. **Excel** (`leer_excel`): hoja → CSV con encabezado en fila 1 con
   `openpyxl`; hoy es TODO explícito.
3. **Parquet**: escribir `data/registry/jurisdicciones.parquet` con las
   columnas de `plan.json` (requiere `pyarrow`, no instalado acá).
4. **PMTiles**: ejecutar `tippecanoe` con el comando sugerido y registrar
   el artefacto en `data/pmtiles.json` con `pnpm run pmtiles verificar`.
5. Recién ahí: `pnpm run receta` y verificar los pines (Capital
   `1660063`: `48812c29…` / `1dd79167…`).

Nada de esto se ejecuta automáticamente: el esqueleto **describe** el
trabajo y valida que la entrada tenga lo necesario para hacerlo sin
improvisar el contrato.
