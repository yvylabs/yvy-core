# Yvy Explorer

Visor territorial de alto rendimiento: globo 3D con datos vectoriales
y satelitales en formato [PMTiles](https://pmtiles.io/) (v3) sobre
[MapLibre GL](https://maplibre.org/) v5. Geointeligencia para minería,
agro y gobierno.

Modelo **objeto-céntrico**: cada jurisdicción es un objeto Yvy con un
`yvy_id` único (0-999 países, 1000-1999 provincias, 10000+ deptos),
identidad, superficie oficial y relaciones espaciales precomputadas.

## Cómo se arma el catálogo (fuente de verdad)

```
data/registry/                → CSVs por nivel (un CSV = un nivel)
  paises.csv                    yvy_id, georef_id, nombre_oficial,
  provincias.csv               sup_oficial_km2, sup_fuente,
  departamentos.csv            sup_fuente_url, sup_oficial_tipo,
  municipios.csv               + parent (pais_yvy_id / prov_yvy_id /
                                depto_yvy_id)
public/data/                  → geometría: un PMTiles por nivel,
  provincias.pmtiles          con una propiedad única por feature:
  departamentos.pmtiles         id = yvy_id (los atributos viven en el CSV)
  municipios.pmtiles
  <nivel>_centros.json        → centro real por objeto (centroide del
                                build, cacheados; se regeneran si cambia
                                el archivo)
public/data/relaciones.json   → relaciones precomputadas (chips de la ficha)
```

El plugin `yvyManifest` de `vite.config.js` lee los CSVs en cada build y
emite:

- `public/data/manifest.json` — catálogo completo (nivel, yvy_id,
  parent_yvy_id, nombre, superficie, fuente, pmtiles, minzoom/maxzoom,
  **centro real por objeto** — centroide calculado en el build decodificando
  los tiles del nivel y cruzándolo contra el `id` de cada feature).
- `public/data/tabla_provincias_yvy_join.json` — provincias derivadas del
  CSV (yvy_id 1000-1023, pais_yvy_id=0, pais_georef_id=ARG).

El build avisa por consola cuántos features de cada PMTiles tienen `id`
coincidente con el yvy_id del CSV (si falta el id o es otro código, el
objeto queda con el centro del archivo como fallback y sale el aviso).

**Para agregar un territorio** solo hay que tirar la fila al CSV y su
`.pmtiles` a la carpeta (o regenerar el archivo del nivel). Sin CSV o sin
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
  en el Explorador → panel Objeto → PNG de la ficha con banda de marca.

## Comandos

```bash
npm install        # instalar dependencias
npm run dev        # desarrollo (localhost:5173)
npm run build      # build de producción en dist/ (+ regenera manifest)
npm run preview    # probar el build local
```

## Deploy (Cloudflare Pages)

1. Build: `npm run build`
2. Carpeta de salida: `dist`
3. Recomendado: compressión Brotli/Gzip activa, HTTPS.

O directo con Wrangler:

```bash
npx wrangler pages deploy dist
```

## Notas

- La atribución de imágenes satelitales (Esri, Maxar, Airbus, etc.) es
  obligatoria por licencia: no quitarla de la esquina inferior.
- El estado de la vista se comparte por URL (`#y=<yvy_id>&c=…&z=…`), sin
  backend. El botón de compartir copia el link al portapapeles.
- La exportación PNG baja la vista actual o la ficha del objeto con banda
  de marca (logo + objeto + fecha + coordenadas).
