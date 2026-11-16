# Yvy Core — Ontología territorial & guía para agentes

**Yvy Core** es una **infraestructura de datos territoriales con linaje auditable** (no visor GIS, ni IDE, ni OSINT). Se busca una **entidad** y se recibe un **dossier** con sus métricas, relaciones y documentos. La geometría es solo render: los hechos viven en agregados por `yvy_id`.

**Fuente de verdad:** `SPEC.md` (contrato) + `docs/PLAN-MAESTRO.md` (plan y decisiones).

## 1. Modelo (no negociable)

Seis piezas: **entidad, tipo, métrica, relación, documento, linaje**.

1. Dato faltante = `null` + `estado: missing`. Nunca `0` de relleno.
2. Sin `fuente` no entra; sin `fecha` se marca explícitamente.
3. El tipo va como campo, **nunca** dentro del `yvy_id`.
4. `unidad` obligatoria en toda métrica.
5. `visibilidad` (`public | tenant | private`) en entidad, métrica y documento.
6. Relaciones N:M (`interseca`) para cuencas y radios: no todo es árbol.
7. `ontologia.json` (tipos y reglas) separado de `manifest.json` (instancias).
8. Certificado = dos hashes: `hash_entidad` (métricas) y `hash_linaje` (relaciones + documentos), JSON canónico RFC 8785, calculados en build.

## 2. Separación de responsabilidades

- **GPU (geometría):** `.pmtiles` en modo tile (`/tiles/{z}/{x}/{y}` + TileJSON vía Functions + R2 privado). Nunca el archivo crudo en `dist/`.
- **RAM (catálogo):** `public/data/manifest.json` en memoria con lookups $O(1)$ por `yvy_id` (`getObjeto/getPadre/getHijos`).
- **Detalle lazy:** agregados por `yvy_id` primero; relaciones y documentos on-demand.
- **Determinismo:** estados `ok/empty/missing`, copiar = snapshot visible, telemetría privada agregada. Cero alucinación.
- **IA:** determinista para **afirmar**; probabilístico solo para **clasificar** en ingesta, con confirmación humana.

## 3. Mapa de archivos

- `vite.config.js`: plugin `yvyManifest` (parquet → `manifest.json` + `manifest.jsonld` vía `hyparquet`).
- `src/js/manifest.js`: catálogo + navegación (`cargarDatos`, `setNavegador/navegarA`).
- `src/js/intencion.js`: parser determinista (sinónimos, gentilicios, desambiguación por provincia).
- `src/js/layers.js`: 1 source por nivel + capa on-demand filtrada `==yvy_id`.
- `src/js/objeto.js`: dossier + breadcrumb + dependencias + `Copiar resumen`.
- `src/js/welcome.js`: buscador/portada + fallback honesto.
- `src/js/ui.js`: paneles. `share.js`: permalink `#y&c&z`. `statusbar.js`: objeto + breadcrumb + fps con `?debug=1`. `telemetry.js`: beacon agregado opt-out. `main.js`: `ensureSatelite()` único + atribución solo proveedores.
- `functions/`: `tiles/`, `data/` (solo GET + allowlist + R2), `api/event.js` (POST validado, `cf-ipcountry`).

## 4. Comandos (pnpm, Node 22)

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run dev      # localhost:5173
pnpm run build    # dist/ + regenera manifest
pnpm run preview  # valida el build
git config core.hooksPath scripts
```

## 5. Reglas de trabajo

- **No commitear derivados:** `manifest.json`, `manifest.jsonld`, `*_centros.json`, `.pmtiles`, `.parquet` (solo `data/registry/`).
- **No romper el contrato:** `yvy-manifest-v3`, `yvy_id`, bindings `YVY_DATA`/`YVY_TELEMETRY` y el `name` de `wrangler.toml` (atado al proyecto Pages) no se renombran.
- **PR a `master`** (protegida: PR + check `build + gates`).
- Flujo: `feat/<tema>` o `fix/<tema>` → PR → CI verde → squash merge.

## 6. Non-goals

Sin shapefiles, sin servidor de mapas, sin instalación. Sin upload ni descarga binaria en el carril free. PNG = screenshot del sistema. MCP y export van a los carriles pagos.
