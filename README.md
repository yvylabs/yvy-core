# Yvy Explorer

> Grafo de entidades para la acción — del dato público roto a la decisión auditable. Free forever, sin login.

**Problema:** intendentes, periodistas y funcionarios no saben quién manda dónde ni de dónde sale cada número (INDEC, IGN y ministerios dispersos, formatos incompatibles). **Solución:** grafo determinista curado — eliges territorio → ves totales con fuente+fecha → drill solo si lo pides. **No es** visor GIS, ni IDE, ni OSINT.

**Estado:** cobertura nacional (3334 nodos, 3 tipos de dato) en `develop`; `master` estable. I+D en Argentina. Ver `SPEC.md` (fuente de verdad), `docs/TRL.md` (evidencia) y `docs/ROADMAP.md` (plan 24 meses).

## Cómo se arma el catálogo (fuente de verdad)

```
data/registry/                → jurisdicciones.parquet (1 país + 24 prov +
                                  529 depto + 2348 gob + 432 barrios,
                                  con sup_oficial_km2 donde hay dato) y
                                  parquets por tipo (demografia, mineria,
                                  catastro): yvy_id, nombre_oficial, parent
public/data/                  → geometría: un PMTiles por nivel o tipo
                                (`paises`, `provincias`,
                                `departamentos`, `municipios`, `barrios`,
                                `mineria`, `catastro`),
                                con una propiedad única por feature:
                                id = yvy_id (los atributos viven en el parquet)
public/data/agregados/        → JSON por tipo y yvy_id (Fase 3, lazy):
                                `demografia/{yvy_id}.json`, etc.
public/data/relaciones.json   → relaciones precomputadas (Fase 3; si falta,
                                la ficha lo tolera)
```

El plugin `yvyManifest` de `vite.config.js` lee los parquets en cada build y
emite `public/data/manifest.json` + `manifest.jsonld` (catálogo: nivel,
yvy_id, parent, nombre, superficie, fuente, pmtiles, centro real por objeto).

El build avisa por consola cuántos features de cada PMTiles tienen `id`
coincidente con el yvy_id del parquet (si falta el id o es otro código, el
objeto queda con el centro del archivo como fallback y sale el aviso).

**Para agregar un territorio** solo hay que tirar la fila al parquet y su
`.pmtiles` a la carpeta (o regenerar el archivo del nivel). Sin parquet o sin
PMTiles el build no rompe: avisa por consola qué falta y el resto sigue
funcionando. Sin base de datos: todo el estado vive en el cliente, un solo
fetch de manifest al abrir.

## Cargar ≠ Dibujar

- Cada nivel se **carga una sola vez** (su PMTiles queda cacheado en
  memoria); el pan/zoom solo **dibuja** triángulos ya cargados.
- El objeto activo y sus ancestros pintan (una source por nivel + capas
  on-demand filtradas por `id`); los niveles inferiores nunca se cargan
  (banda visible por contexto).
- La ficha del objeto sale del manifest + agregados lazy por tipo
  (narrativa en prosa, hijos linkeados, referencias): click en el mapa o
  en el welcome → ficha + `Copiar resumen` (texto) + `window.print()`.

## Comandos (pnpm, Node 22)

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run dev      # desarrollo (localhost:5173)
pnpm run build    # build de producción en dist/ (+ regenera manifest)
pnpm run preview  # probar el build local
git config core.hooksPath scripts
```
## Deploy (Cloudflare Pages — Git integration, única vía)

PR → preview deploy, merge a master → production. Prohibido deployar desde CI.
Conectar el repo en el dashboard: build pnpm run build, output dist,
Node vía .nvmrc (22) o NODE_VERSION=22. R2 `yvy-data` (cuando exista)
enlazado en production y preview. Ver SPEC.md §9.

## Notas

- La atribución `OpenFreeMap © OpenMapTiles © OpenStreetMap`
  es obligatoria por licencia: no quitarla de la esquina inferior.
- El estado de la vista se comparte por URL (`#y=<yvy_id>&c=…&z=…`), sin
  backend. El botón de compartir copia el link al portapapeles.
- Salidas free: `Copiar resumen` (texto) + `window.print()`. PNG = screenshot OS.
  Sin export binario (va a Labs).
