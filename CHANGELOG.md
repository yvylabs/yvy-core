# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/);
versionado SemVer. Las fechas son de merge a `master`.

## [0.4.0] — 2026-11-16

Contrato de datos con dientes: ontología publicada, validador que corta el
build y certificado de linaje verificado en el navegador.

### Added
- **Buscador determinista** (`src/js/parser.js`): núcleo puro con sinónimos,
  gentilicios y desambiguación por provincia. 22 frases doradas en CI.
  `capital de mendoza` ya no devuelve la Capital de Catamarca; `capital
  chaqueña` devuelve `null` (honesto); `cerillos` tolera el typo.
- **Jurisdicción visible en la lista**: `Capital (Salta)` ≠ `Capital (Mendoza)`.
- **`null` + `estado` en el contrato**: 4.411 ceros de relleno eliminados de
  los agregados publicados; cada uno declara `estado` (`ok|parcial|missing`)
  y `metricas_missing`.
- **`data/ontologia.json`**: tipos (con padre admitido), métricas con
  `unidad`, relaciones con `fuente`, reglas del contrato. Publicada junto al
  manifest y referenciada por él.
- **Validador de contrato en el build**: nivel no declarado, métrica sin
  unidad, agregado sin fuente o relación sin declarar **cortan el build**.
- **Certificado de linaje**: `hash_entidad` y `hash_linaje` (SHA-256 sobre
  JSON canónico RFC 8785) por agregado, calculados en build y
  **recalculados en el navegador** en la ficha (✓ verde si cierra, ⚠ si no).
- Tests: 43 (parser, contrato, canonización, certificado). Corren después
  del build en CI.
- G4: templates de PR e issues (`yvy_id` en el reporte), `SECURITY.md`.

### Changed
- CI: `build → test` (los tests de contrato validan el árbol recién
  generado); triggers sin `develop` (eliminada).
- Rebranding a **Yvy Core** (README, SPEC, AGENTS, NOTICE, metadatos).
- Repo renombrado a `yvylabs/yvy-core`.

### Fixed
- `gate-d` del CI apuntaba a `functions/data/[[fgb]].js` (eliminado).
- Ruleset de protección de `master` con la condición rota
  (`refs/heads/master y develop`).

## [0.3.0] — 2026-10

Portada R13 (una pantalla, una acción), grafo de decisiones, favicon/OG
generados con la geometría real, telemetría agregada opt-out.

## [0.2.0] — 2026-09

Manifest v3 (`yvy-manifest-v3`), PMTiles en modo tile vía Functions + R2
privado, ficha del objeto con `Copiar resumen` y JSON-LD.
