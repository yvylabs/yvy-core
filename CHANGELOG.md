# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/). Tags `v0.x`.

## [Unreleased]
### Added
- Ficha reporte textual: narrativa en prosa (población, viviendas, resto),
  hijos linkeados con vista detalle, frase "Limita con", densidad (hab/km²),
  referencias al pie, copiar con narrativa.
- Superficies (`sup_oficial_km2` + `sup_fuente`): IGN oficial + cálculo propio;
  en blanco = sin dato. Barrios se muestran en ha.
- `relaciones.json` limpio (16858, 0 puntas rotas) y visible en ficha.
- `tools/sheet_a_parquet.py`: flujo Sheet → CSV → parquet validado (sin Colab).
- Notebook Colab `tools/yvy_pmtiles_colab.ipynb`: GPKG → PMTiles en sesión
  (tippecanoe 2.79.0, ids por nivel, join de barrios al catálogo).
- Cobertura nacional: 3334 nodos (1 + 24 + 529 + 2348 + 432),
  demografía Censo 2022 pre-agregada por nivel (2843 filas).
### Changed
- Registry jurisdiccional en un solo `jurisdicciones.parquet` (manda sobre
  por-nivel); etiquetas `departamento`/`gobierno_local` mapeadas en build.
- Agregación curada por SPEC §10 (conteo + sumas + top-20): fin del last-wins
  y de las sumas de códigos en minería/catastro.
- Jargon-strip visible: sin `yvy:`, títulos en español, fuentes expandidas.
- Basemap aclarado (fork OpenFreeMap); paneles sin código muerto
  (asistente/medición/árbol fuera de HTML+CSS+JS).
### Fixed
- Cruce depto/municipio (parents reales INDEC); provincias `1000+in1`;
  país renderiza (`paises.pmtiles`); vuelo no aborta con bounds degenerados;
  ficha no tapa jurisdicción (ancho dinámico).

## [0.2.0] - 2026-09-19
### Changed
- Lenguaje: grafo de entidades, `Soporte a la acción`.

## [0.1.0] - 2026-09-19
### Added
- Import privado inicial: esqueleto, SPEC v1, repo + CI (ver tag `v0.1.0`).
