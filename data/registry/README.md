# Registry — fuente de verdad (datos)

Los parquets de esta carpeta alimentan `public/data/manifest.json` vía el plugin `yvyManifest` de `vite.config.js` (lector `hyparquet`). **No tocar sin SPEC.**

Contrato vigente: ver `SPEC.md` en la raíz (entity graph, conflación determinista, versionado inmutable, estados `ok/empty/missing`).

Formato: un parquet por nivel (`provincias.parquet`, `departamentos.parquet`, `municipios.parquet`), columna obligatoria `yvy_id` (INT64). Resto de columnas igual que el contrato registry (`nombre_oficial`, parents, `sup_*`, `Población`, `Viviendas`, `km_*`). La geometría vive en `public/data/*.pmtiles` (un archivo por nivel, propiedad `id = yvy_id` numérico).
