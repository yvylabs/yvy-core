# Yvy Core — SPEC (fuente de verdad)

> Infraestructura de datos territoriales con linaje auditable.
> El producto es el dossier de una entidad, no el mapa.
> Todo en navegador, instantáneo, sin servidores, listo para marca blanca.

**No es:** visor GIS, IDE, dashboard, OSINT, Google Maps/Earth/Engine.
No apila capas. No tiene query builder. No scrapea. No compite por "ver el territorio".

---

## Actualización nov-2026 — modelo de entidades

> Este bloque **prevalece** sobre el resto del documento donde haya conflicto,
> hasta la reescritura completa como SPEC v3. Plan y decisiones:
> `docs/PLAN-MAESTRO.md`.

Seis piezas: **entidad · tipo · métrica · relación · documento · linaje**.

- La unidad del producto es la **entidad**, no el nivel administrativo. Un municipio
  es un tipo entre varios (barrio, cuenca, región, documento).
- El **tipo** define el contrato (métricas, unidades, relaciones, cardinalidad) y vive
  en `ontologia.json`, **no** en el manifest.
- Dato faltante = `null` + `estado: missing`. **Nunca `0`.** La UI no renderiza
  bloques sin dato.
- `fuente` obligatoria en métricas **y relaciones**. Sin fuente no entra.
- `unidad` y `visibilidad` (`public | tenant | private`) obligatorias.
- Relaciones N:M (`interseca`) para cuencas y radios censales: el modelo no es un árbol.
- Certificado con **dos hashes** (RFC 8785, calculados en build):
  `hash_entidad` (métricas + linaje) y `hash_linaje` (relaciones + documentos).
- `yvy_id` numérico es la clave interna; el tipo nunca va dentro del ID.
- Multi-tenant: un cliente es configuración (namespace + R2 prefijo), no infraestructura.

**Nuevos tipos previstos:** `cuenca`, `region`, `radio_censal`, `documento`.
Se agregan al `ontologia.json` sin migrar lo existente.

---

## 0. Modelo conceptual (crítico)

**Grafo de decisiones conectadas, no de entidades.**

- **Nodos jurisdiccionales**: país, provincia, depto, municipio, barrio.
  Son los nodos del grafo (cobertura nacional; barrios solo Salta ciudad).
- **Ficha**: el contenido que aparece cuando seleccionás un nodo. Agregados
  (demografía, escuelas, rutas, etc.) + relaciones del nodo.
- **Agregados**: NO son nodos. Son atributos de las fichas, colgando del
  nodo contenedor según `nivel_agregacion` del tipo.
- **Entidades buscables** (escuelas, rutas, parcelas individuales): fase 9,
  no MVP. Van a ser nodos propios con `yvy_id`, buscables por fuzzy,
  con relaciones propias. NO rompen el grafo jurisdiccional.

**Diferencia con GIS**: la unidad mínima es la ficha, no la entidad.
**Diferencia con dashboard**: navegación jerárquica, no widgets.
**Diferencia con mapa**: el mapa es opcional (capa que se prende).

## 1. Esquema yvy_id (congelado)

    País:         0
    Provincia:    1000 + in1 (2 díg)
    Departamento: 100000 + in1 (5 díg)
    Municipio:    1000000 + in1 (6 díg)
    Barrio:       municipio_yvy_id * 1000 + secuencia (3 díg)

`in1` es string con padding. Un solo `parent_yvy_id` por objeto
(municipio → 1 depto, sin excepciones).

Parent:
- Provincia → país (0)
- Departamento → provincia (in1[:2])
- Municipio → departamento (in1[:5])
- Barrio → municipio contenedor (ej. 1660063)

Barrios: orden alfabético de `nom_largo`, secuencia 3 dígitos.

Rango de barrios: `1.000.000.000 - 1.999.999.999`. Ejemplo:
`1660063001` = 1.660.063.001 (municipio 1660063 + secuencia 001).
El build además valida estructura (prefijo == padre), no solo intervalo.

## 1b. Cobertura (nacional desde v2)

**Jurisdicciones** (`data/registry/jurisdicciones.parquet`, 3334 nodos):
- Argentina (0)
- 24 provincias (`1000 + in1`: CABA 1002 … Salta 1066 … TDF 1094)
- 529 departamentos (`100000 + in1`)
- 2348 gobiernos locales (`1000000 + in1`; incluye 10 "Sin gobierno
  local" provinciales + 8 indeterminados `9000000001..08` como raíces)
- 432 barrios de Salta ciudad (con superficie calculada en ha al mostrar)
- Superficie (`sup_oficial_km2` + `sup_fuente`) donde hay dato oficial;
  en blanco = sin dato. La ficha deriva densidad (hab/km²).

Etiquetas de `nivel` en el parquet: `pais, provincia, departamento,
gobierno_local, barrio` (el build las mapea a su canónico
`pais, provincia, depto, municipio, barrio`).

**Tipos (agregados):**
- `demografia` — nacional (2843 filas: país + 24 prov + 527 depto +
  2291 gobiernos; pre-agregada por nivel, el rollup del build solo
  rellena huecos). Fuente: Censo 2022.
- `barrios` — nivel_agregacion = municipio (no es dataset propio,
  es nivel; su agregado cuelga de Salta muni)
- `mineria` — nivel_agregacion = departamento (depto-directo)
- `catastro` — nivel_agregacion = departamento (depto-directo)

## 1c. Versionado (nunca se sobrescribe)

- Snapshot inmutable = **campo `version` en el catálogo**, no fecha en
  el nombre del archivo. Los parquets del registry se llaman
  `<tipo>.parquet` (ej. `demografia.parquet`).
- R2 con versionado activado (cuando exista): cada versión es un archivo
  inmutable con fecha; el repo siempre copia la activa como `<tipo>.parquet`.
- `manifest.json` lleva **solo la versión activa** por dataset.
- La ficha muestra vigencia siempre.
- Historial duerme en R2 (pérdida cero, costo cero en browser).
- Evolución/comparar años = Labs pago (`?version=` con key).
  El free nunca paga la historia (60fps intacto).

## 2. Reglas deterministas (cero alucinación)

- Estados: `ok | empty | missing`.
  - `missing` = "No tengo ese dato todavía"
  - `empty` = "No hay resultados en esta zona"
  - Nunca silencio, nunca invento.
- `fetch` con base absoluta (`import.meta.env.BASE_URL`), tolerante a 404.
- Welcome exige click explícito (Enter elige el primer resultado). Búsqueda agrupa por
  nivel; sugerencias iniciales Salta/Jujuy/Buenos Aires.
- Ficha: totales siempre (Fase 1 = solo manifest), detalle lazy por
  dataset (Fase 3 = +agregados on-click con acordeón colapsado).

## 3. conflation.spec

- `id` estable = `yvy_id` (PMTiles: `--use-attribute-for-id`), tolerancia 0,
  desempate documentado.
- Sin match → `missing`.
- Test Salta: 0 slivers (polígono real, fallback bbox solo visual,
  nunca numérico).

## 4. copy.spec (free)

- Copiar = snapshot visible, nunca consulta cruda. Dos modos:
  - **Territorio**: `nombre · breadcrumb · yvy:id + totales visibles +
    fuente + fecha + link #y=&c=&z=`.
  - **Entidad**: `nombre · territorio · top 5-6 campos + fuente + fecha +
    link`.
- `missing` se escribe explícito, no se omite.

## 5. telemetry.spec (privada, para el dueño)

- Solo agregados: `{day, country(cf-ipcountry), event, yvy_id, nivel}`.
  Nunca texto libre, IP, coords exactas.
- Eventos: `app_load, search_miss(q_hash), pick, report_copy`.
- `DNT` + `?telemetry=0` opt-out. En dev no se emite.
- Stack free: Pages + Web Analytics + Zaraz + 1 Worker → D1.
- `functions/api/event.js`: POST validado, allowlist de eventos,
  límite de body, `Cache-Control: no-store`.
- Futuro firmador R2 (URLs cortas piloto Salta) = Labs: endpoint con
  allowlist + método explícito (gate d).

## 6. Non-goals Explorer free-forever

- No MCP (va a Labs).
- No upload.
- No download binario (PNG/PDF/Excel). PNG = screenshot OS.
- `window.print()` + CSS print + `Copiar resumen` son las únicas salidas.
- Todo lo premium va a Eyes/Labs.

## 7. Esqueleto

KEEP: `main, manifest, layers(slim), objeto(slim), welcome, ui, share,
statusbar(slim), telemetry, main.css(slim)` (9 js + 1 css).

DELETE: `assistant, measure, reasoner, datasets(stub→literal),
geo.worker, atmosphereEffects, basemaps+control→ensureSatelite()`
(hecho; no reabrir).

`vite.config`: plugin `yvyManifest` (parquet → `manifest.json` +
`manifest.jsonld` vía `hyparquet`); no emite `tabla_*`, sin fallback
carpetas por-objeto. Datasets `{tipo}.parquet` → versión activa +
`public/data/agregados/{tipo}/{yvy_id}.json` con rollup a ancestros.

## 7b. Artefactos derivados (generados, con contrato mínimo)

- **`manifest.json`**: índice del portal. Lo genera el build desde
  `data/registry/*.parquet` (D3=A; `catalogo.json` es QC interno, no entra).
- **`manifest.jsonld`**: mismo grafo en JSON-LD
  (`context.jsonld` = ontología ejecutable). Se regenera en cada build.
- **`public/data/<nivel>_centros.json`**: `{v, archivo, size, mtimeMs,
  porId: {yvy_id: {c:[lng,lat], b:[w,s,e,n]}}, observados[]}`.
  Cache por mtime+size; se recalcula si cambia el PMTiles.
- **`public/data/relaciones.json`**: `[{origen_yvy_id, destino_yvy_id,
  tipo, dist_m?}]`, solo `lindero` + `cerca_de` (D4=A). `contiene` se
  deriva de `parent_yvy_id` (no se duplica). Carga async al arranque,
  tolerante a 404.
- **`functions/`**: vive en este repo y deploya con Pages (mismo deploy,
  `pages_build_output_dir=dist`).
- **Firmador R2** (URLs cortas) = Labs, no Explorer free.

## 7c. Contrato de archivos para el build (handoff Sheet → repo)

**Copias del Drive al repo (rutas exactas):**

| Origen (Drive) | Destino (repo) | Consumidor |
|---|---|---|
| `05_curacion/jurisdicciones.parquet` | `data/registry/jurisdicciones.parquet` | build → manifest |
| `05_curacion/tipos/*.parquet` | `data/registry/*.parquet` | build → agregados |
| `07_manifest/relaciones.json` | `public/data/relaciones.json` | portal (ficha: Limita con) |
| `08_pmtiles/*.pmtiles` | `public/data/*.pmtiles` | portal |
| `06_agregados/<tipo>/*.json` | *(los regenera el build; referencia = QC)* | portal (Fase 3, lazy) |
| `07_manifest/catalogo.json` | **No entra** (QC interno, D3=A) | — |

**NO se copian:**
- `07_manifest/catalogo.json` → QC interno (D3=A).
- `estado.json`, `inventario.csv`, `topologia_<ts>.json` → solo Drive.
- `01_work/*.gpkg` → intermedios.
- `04_logs/` → operativos.

## 8. Done Fase 1

- `src/` 18→9 files.
- `pnpm run build` limpio.
- `welcome→ficha→copiar→share-restore` en <2 clicks.
- fps solo `?debug=1`.

## 9. Deploy (única vía: Git integration)

- PR → preview deploy.
- Merge a `master` → production.
- Prohibido deployar desde CI.
- Node vía `.nvmrc` (22) o `NODE_VERSION=22` en dashboard.
- Output `dist`.

**Fase local (sin R2, para probar):**
- `pnpm run dev` con todos los archivos en `data/registry/` y
  `public/data/` locales.
- Sin Cloudflare, sin R2, sin Pages. Todo en la máquina.

## 10. Contrato datasets v1 (cobertura nacional, congelado)

**Niveles:**
- País 0, 24 provincias (`1000 + in1`), 529 departamentos, 2348 gobiernos,
  432 barrios (solo Salta ciudad).

**Tipos:**

| Tipo | nivel_agregacion | nivel_visual | geometria | categoria | buscable |
|---|---|---|---|---|---|
| demografia | municipio | [provincia, departamento, municipio] | tabla | Sociedad | false |
| barrios | municipio | [municipio] | poligono | Sociedad | false |
| mineria | departamento | [departamento] | poligono | Economía | false |
| catastro | departamento | [departamento] | poligono | Infraestructura | false |

Notas:
- `nivel_agregacion`: de qué nivel cuelga el agregado (dónde aparece en la ficha).
- `nivel_visual`: dónde se puede prender el PMTiles (decisión UX, no performance).
- `buscable` y `campos_busqueda`: preparados para fase 9 (entidades).
- Todos los tipos actuales: `buscable: false`.
- minería/catastro son **depto-directo**: publican su agregado en origen;
  el rollup del build solo aplica donde hay filas hoja (demografía).

**Agregado:** `{tipo, categoria, yvy_id, yvy_id_contenedor, fuente,
fecha_vigencia, version, metricas{...}}`.

**Métricas por tipo:**
- demografia: poblacion, viviendas, viv_particulares, pob_particulares,
  viv_colectivas, pob_colectivas, pob_calle.
- barrios: total_barrios, formales, asentamientos, otros_tipos,
  con_geometria_valida, sin_geometria, por_estado.
- mineria: total_concesiones, area_total_ha, por_estado,
  por_mineral (por_tipo solo si el parquet trae columna `tipo`).
- catastro: total_parcelas, area_total_m2, area_total_ha, por_categoria,
  por_localidad (top 20).

**Categorías:** Sociedad, Economía, Ambiente, Infraestructura.
(territorio = eje, no categoría)

**Territorio:**
- `cod_indec` + `georef_id` separados.
- `clase_municipio` (M1/M2/M3, glosario INDEC Censo 2022 cuadro 1.17).
- `clase_barrio` (Barrio/Asentamiento) + `formalidad`.

**Versionado:**
- R2 guarda snapshots inmutables con fecha; el repo copia la activa
  como `<tipo>.parquet` (sin fecha, versión en columna).
- Solo versión activa en manifest. Evolución = Labs.

**Superficies:** `sup_oficial_km2` + `sup_fuente` (+ `sup_oficial_tipo`
opcional) por objeto; en blanco = sin dato. IGN oficial donde existe,
cálculo propio donde no. La ficha deriva densidad (hab/km²).
Geometrías en 4326.

## 10b. Pipeline curación (Sheet, sin Colab)

Fuente: Google Sheet (edición) → CSV → `tools/sheet_a_parquet.py`
(valida contrato, solo escribe si da ok) → `data/registry/`.
Etapas Drive históricas: `00_entrada` → `01_work` (GPKG por banda) →
`08_pmtiles/` (tippecanoe 2.79.0). Sin runner con estado: el contrato
vive en el CLI + el build.

Handoff al repo: ver §7c.

Excepción: `08` es un archivo por nivel de jurisdicción; tipos con
geometría propia (minería) van como `{tipo}.pmtiles` documentado.

Relaciones: `lindero` + `cerca_de` computadas
(`tools/yvy_plantilla.py`) van a `public/data/relaciones.json`;
`contiene` se deriva de `parent_yvy_id` (no se duplica en archivo).

## 11. Decisiones cerradas (no reabrir sin SPEC)

- Explorer free = navegador, sin cuenta, sin login, sin descarga.
- Marca blanca = mismo Explorer con datos del cliente.
- Eyes = raster + drones + vision AI (parte de Labs).
- MCP = no en Explorer free (va a Labs).
- Manifest = build desde registry (D3=A); `catalogo.json` = QC (D5=C).
- `relaciones.json` sí al free (D4=A); `contiene` derivado.
- Parquets de tipos sin fecha en registry (D2=A); versión en columna.
- Demografía nacional con 2843 filas pre-agregadas por nivel (D1=A superada).
- Registry jurisdiccional en un solo `jurisdicciones.parquet` (manda sobre
  por-nivel). Nodos "Sin gobierno local" e "Indeterminado" entran como
  raíces honestas (estado parcial, nunca invento).
- Barrios = nodos jurisdiccionales delgados (opción C).
- Rollup en build (rellena huecos; el directo manda).
- Curación sin Colab: Sheet -> CSV -> `tools/sheet_a_parquet.py`
  (valida contrato, solo escribe si da ok).
- Curación = CLI (`tools/sheet_a_parquet.py`), no ipywidgets.
- Tippecanoe pinneado a 2.79.0.
- Catastro y minería cuelgan de depto. Demografía de municipio.
- Barrios cuelgan de Salta muni (1660063).
- Snap = solo reporta. Cercanos = solo intra-nivel.
- Centroides = `representative_point()`.
- Pitch: grafo de decisiones conectadas; territorio/jurisdicción/
  conocimiento/acción; navegador, instantáneo, sin servidores, marca blanca.
- Modelo: Forward Deployed Engineer. Infra que habla sola.
