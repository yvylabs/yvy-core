# Yvy Explorer — SPEC v1 (fuente de verdad)

> Grafo de entidades para la acción. Conflación determinista — el territorio es un insumo más. AI-ready por arriba (Labs).

**No es:** visor GIS, ni IDE, ni OSINT. No apila capas, no tiene query builder, no scrapea. Globo 3D vacío hasta interacción.

## 1. Modelo

* `Territorio`: pais 0-999, provincia 1000-1999, depto 10000+, municipio 100000+. Piloto: Salta 1016 + hijos (recorte fuera, no se toca `data/` en este repo).
* `Entidad`: escuela, hospital, tramo ruta/FFCC. `CONTIENE` precomputado fuera.
* `Parquet = hechos + agregados por yvy_id` / `PMTiles = solo render` / `manifest.json = índice` / detalle = lazy.

## 2. Reglas deterministas (cero alucinación)

* Estados: `ok | empty | missing`. `missing` = "No tengo ese dato todavía", `empty` = "No hay resultados en esta zona". Nunca silencio, nunca invento.
* `fetch` con base absoluta (`import.meta.env.BASE_URL`), tolerante a 404.
* Welcome exige click explícito (no `Enter` ciego). Búsqueda agrupa por nivel, Salta primero en piloto.
* Ficha: totales siempre, detalle solo on-click (acordeón colapsado).

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

KEEP: `main, manifest, layers(slim), objeto(slim), welcome, ui, share, statusbar(slim), main.css(slim)`.
DELETE: `assistant, measure, reasoner, datasets(stub→literal), geo.worker, atmosphereEffects, basemaps+control→ensureSatelite()`.
`vite.config`: no emite `tabla_*`, sin fallback carpetas por-objeto.

## 8. Done Fase 1

`src/` 18→9 files, `pnpm run build` limpio, `welcome→ficha→copiar→share-restore` en <2 clicks, fps solo `?debug=1`.

## 9. Deploy (única vía: Git integration)
PR → preview deploy, merge a `master` → production. Prohibido deployar desde CI. Node vía `.nvmrc` (22) o `NODE_VERSION=22` en dashboard. Output `dist`.
