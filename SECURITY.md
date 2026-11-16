# Seguridad

## Alcance

Este repo es el **núcleo** de Yvy Core: el cliente (JS en el navegador) y las
Cloudflare Functions de `functions/`. Lo auditable es el dato y su linaje; el
código corre público en el navegador, así que el moat no está en ofuscar sino
en el dataset curado y el pipeline.

## Cómo reportar

Reportes de seguridad: **security@yvylabs.com** (o GitHub Security Advisories
en este repo). No abras un issue público con detalles explotables.

Respondemos en 72 h y coordinamos la publicación del fix.

## Suposiciones de diseño (qué es y qué no es vulnerable)

- **Sin backend de datos**: el catálogo vive en archivos estáticos
  (`public/data/`); no hay endpoints que acepten consultas arbitrarias.
- `functions/` expone solo:
  - `GET /tiles/*` y `GET /data/*` con **allowlist de origen** y método
    explícito (gate-d del CI);
  - `POST /api/event` con body limitado (2 KB), evento de una allowlist y
    **sin** datos personales (no guarda IP, lee `cf-ipcountry` como código
    ISO de 2 letras agregado).
- **No hay upload ni descarga binaria** en el carril free; la descarga va
  gated en el Worker por tenant (`descarga: true`), no en el frontend.
- Los PMTiles/parquet crudos viven en R2 **privado**; nunca se commitean ni
  se sirven desde `dist/` (gate-a del CI).
- Los hashes del certificado son SHA-256 sobre JSON canónico (RFC 8785);
  servir un agregado con el hash cambiado se detecta en el cliente y se
  marca con ⚠ en la ficha.

## Vulnerabilidades de dependencias

Dependabot abre PRs; se mergearon con el job `build + gates` verde. Updates
de seguridad se priorizan sobre cualquier feature.
