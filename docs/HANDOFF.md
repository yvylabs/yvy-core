# HANDOFF — Estructura Drive v3 (referencia, no se ejecuta)

Raíz: `/content/drive/MyDrive/YvyLabs/YvyExplorerProduction/`

```
YvyExplorerProduction/
├── 00_entrada/          # crudos (GPKG + CSV)
├── 01_work/             # work GPKG por banda (EPSG:5345)
│   ├── nacional.gpkg    # capa: pais
│   ├── provincial.gpkg  # capas: provincias, departamentos, catMinero, catastroUR
│   ├── municipal.gpkg   # capa: municipios
│   └── local.gpkg       # capa: barriosSalCap
├── 02_backup/           # snapshots
├── 03_config/
│   ├── bandas.yaml / datasets.yaml / estado.json / inventario.csv
│   ├── tools/           # yvy_estado.py, yvy_runner.py, yvy_plantilla.py, yvy_salta.py
│   └── .bin/tippecanoe  # cacheado (2.79.0)
├── 04_logs/             # YYYY-MM-DD.log + topologia_<ts>.json
├── 05_curacion/
│   ├── jurisdicciones/  # jurisdicciones.parquet (pais+prov+depto+gob+barrios)
│   └── tipos/           # demografia, barrios, mineria, catastro.parquet (sin fecha)
├── 06_agregados/<tipo>/<yvy_id>.json
├── 07_manifest/
│   ├── catalogo.json    # índice QC (NO va al repo, D3=A)
│   └── relaciones.json  # lindero + cerca_de → public/data/relaciones.json (D4=A)
├── 08_pmtiles/          # provincias, departamentos, municipios, barrios, mineria, catastro
└── 99_legacy/           # solo lectura
```

Runner: Colab con checkpoint por celda (`yvy_runner.py` orquesta `celda_N(ctx)`,
`yvy_estado.py` persiste fases). Handoff al repo: ver SPEC §7c.
