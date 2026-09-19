# Registry — fuente de verdad (datos)

Los CSVs de esta carpeta alimentan `public/data/manifest.json` vía el plugin `yvyManifest` de `vite.config.js`. **No tocar sin SPEC.**

Contrato vigente: ver `SPEC.md` en la raíz (entity graph, conflación determinista, estados `ok/empty/missing`).

Formato actual: un CSV por nivel (`provincias.csv`, `departamentos.csv`, `municipios.csv`), columna obligatoria `yvy_id`. La geometría vive en `public/data/*.pmtiles` (un archivo por nivel, propiedad `id = yvy_id`).
