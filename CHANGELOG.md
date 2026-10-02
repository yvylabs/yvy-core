# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/). Tags `v0.x`.

## [Unreleased]
### Added
- Esqueleto slim (9 js + 1 css), SPEC v1, telemetría privada stub.
- UI v2: topbar limpio, zoom único, badge fps tras `?debug=1`.
- Seguridad: CSP/HSTS/Permissions, CORS solo `yvylabs.com`, validación en Functions.
### Changed
- Registry CSV → Parquet (`hyparquet` en el build, validado end-to-end). CSV prohibido.
- Versionado inmutable: versión activa en manifest, historial en R2, evolución solo Labs.

## [0.2.0] - 2026-09-19
### Changed
- Lenguaje: grafo de entidades, `Soporte a la acción`.

## [0.1.0] - 2026-09-19
### Added
- Import privado inicial: esqueleto, SPEC v1, repo + CI (ver tag `v0.1.0`).
