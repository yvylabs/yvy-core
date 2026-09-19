# Yvy Explorer — Grafo de entidades & Guía para Agentes de IA

**Yvy Explorer** es un **grafo de entidades para la acción** (no visor GIS, ni IDE, ni OSINT). El territorio es un insumo más entre +50 datasets curados fuera. La geometría es solo render; los hechos viven en agregados por `yvy_id`. Fuente de verdad: `SPEC.md`.

## 1. Separación de responsabilidades
- **GPU (Geometría)**: `.pmtiles` servidos en modo tile (`/tiles/{z}/{x}/{y}` + TileJSON vía Functions + R2 privado). Nunca el archivo crudo en `dist/`.
- **RAM (Catálogo)**: `public/data/manifest.json` en memoria con lookups $O(1)$ por `yvy_id` (`getObjeto/getPadre/getHijos`).
- **Detalle lazy**: agregados por `yvy_id` primero; drill fila-a-fila solo on-click (Fase 2 con key).
- **Determinismo**: estados `ok/empty/missing`, copiar = snapshot visible, telemetría privada agregada. Cero alucinación.

## 2. Mapa de archivos (Fase 1 v2: 9 js + 1 css)
- `vite.config.js`: plugin `yvyManifest` (CSV → `manifest.json` + `manifest.jsonld`). Sin emit `tabla_*`, sin fallback por-objeto.
- `src/js/manifest.js`: catálogo + navegación (`cargarDatos`, `setNavegador/navegarA`).
- `src/js/layers.js`: 1 source por nivel + capa on-demand filtrada `==yvy_id`.
- `src/js/objeto.js`: ficha resumen + breadcrumb + dependencias + `Copiar resumen`.
- `src/js/welcome.js`: búsqueda contextual + `pick/search_miss` anónimos.
- `src/js/ui.js`: 1 panel (`panel-explorador`). `share.js`: permalink `#y&c&z` con clamp. `statusbar.js`: objeto + breadcrumb + fps solo `?debug=1`. `telemetry.js`: beacon agregado opt-out. `main.js`: `ensureSatelite()` único + atribución solo proveedores.
- `functions/`: `tiles/`, `data/` (solo GET + allowlist + R2), `api/event.js` (POST validado, `cf-ipcountry`).

## 3. Comandos (pnpm, Node 22)
```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run dev      # localhost:5173
pnpm run build    # dist/ + regenera manifest
pnpm run preview  # valida el build
git config core.hooksPath scripts
```

## 4. Non-goals free-forever
No MCP, no upload, no download binario. PNG = screenshot OS. Premium (MCP-BYOK, LLM, export) va a Labs.
