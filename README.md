# Yvy Explorer

> Grafo de entidades + conflación determinista — el territorio es un insumo más entre +50 datasets. Free forever, sin login.

**No es** visor GIS, ni IDE, ni OSINT. Globo 3D vacío hasta que interactúas: eliges territorio → ves totales automáticos → drill solo si lo pides.

Modelo **entity graph**: cada jurisdicción es un nodo con `yvy_id` único, totales curados fuera (`Parquet = hechos`, `PMTiles = render`, `manifest = índice`). Ver `SPEC.md` (fuente de verdad).

## Cómo se arma el catálogo (fuente de verdad)

```
data/registry/                → parquets por nivel (un parquet = un nivel)
  provincias.parquet            yvy_id, nombre_oficial, sup_*,
  departamentos.parquet         + parent (pais_yvy_id / prov_yvy_id /
  municipios.parquet              depto_yvy_id)
public/data/                  → geometría: un PMTiles por nivel,
  provincias.pmtiles          con una propiedad única por feature:
  departamentos.pmtiles         id = yvy_id (los atributos viven en el parquet)
  municipios.pmtiles
  <nivel>_centros.json        → centro real por objeto (centroide del
                                build, cacheados; se regeneran si cambia
                                el archivo)
public/data/relaciones.json   → relaciones precomputadas (chips de la ficha)
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
- La ficha del objeto sale del manifest (cero fetch): click en el mapa o
  en el welcome → ficha + `Copiar resumen` (texto) + `window.print()`.

## Comandos (pnpm, Node 22)

\ash
corepack enable
pnpm install --frozen-lockfile
pnpm run dev      # desarrollo (localhost:5173)
pnpm run build    # build de producción en dist/ (+ regenera manifest)
pnpm run preview  # probar el build local
git config core.hooksPath scripts
\\n
## Deploy (Cloudflare Pages — Git integration, única vía)

PR → preview deploy, merge a master → production. Prohibido deployar desde CI.
Conectar el repo en el dashboard: build pnpm run build, output dist,
Node vía .nvmrc (22) o NODE_VERSION=22. R2 yvy-data enlazado en
production y preview. Ver SPEC.md §9.

## Notas

- La atribución `Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community`
  es obligatoria por licencia: no quitarla de la esquina inferior.
- El estado de la vista se comparte por URL (`#y=<yvy_id>&c=…&z=…`), sin
  backend. El botón de compartir copia el link al portapapeles.
- Salidas free: `Copiar resumen` (texto) + `window.print()`. PNG = screenshot OS.
  Sin export binario (va a Labs).
