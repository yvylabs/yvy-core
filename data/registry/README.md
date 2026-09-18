# Registry Yvy — fuente de verdad

Acá viven los CSVs que alimentan el catálogo. El plugin `yvyManifest`
de `vite.config.js` los lee en cada build y genera
`public/data/manifest.json` + `public/data/tabla_provincias_yvy_join.json`.

## Regla de oro

**1 CSV por nivel, 1 PMTiles por objeto, conectados por yvy_id.**

| Nivel    | Archivo                          | Rango yvy_id | Carpeta PMTiles |
|----------|----------------------------------|--------------|-----------------|
| País     | `tabla_pais_yvy_join.csv`        | 0-999        | `public/data/paises/` |
| Provincia| `tabla_provincias_yvy_join.csv`  | 1000-1999    | `public/data/provincias/` |
| Depto    | `tabla_deptos_yvy_join.csv`      | 10000-19999  | `public/data/deptos/` |
| Municipio| `tabla_municipios_yvy_join.csv`  | 20000-29999  | `public/data/municipios/` |
| Concesión| `tabla_concesiones_yvy_join.csv` | 30000+       | `public/data/concesiones/` |

## Columnas (todas opcionales salvo yvy_id)

- `yvy_id` — clave primaria (obligatoria).
- `georef_id` — id de georreferencia del dataset origen (ej: AR-S).
- `parent_yvy_id` — padre jerárquico; para provincias se acepta
  `pais_yvy_id`, para deptos `provincia_yvy_id`, etc. Sin columna de
  padre, el objeto es raíz del árbol.
- `nombre_oficial` — nombre para el árbol y la ficha.
- `sup_oficial_km2` — superficie oficial en km² (con punto decimal).
- `sup_fuente` — organismo/dataset de la superficie (ej: IGN 2022).
- `sup_fuente_url` — link trazable de la fuente.
- `sup_oficial_tipo` — `oficial` | `referencial`, etc.
- `prov_id_ign` — id del dataset IGN (provincias).
- `capa_interna` — nombre de la capa dentro del PMTiles (si no se
  detecta sola del header).
- `visible_en_dashboard` — `true`/`false` (default `true`).

## Ejemplo

`tabla_pais_yvy_join.csv`:

```csv
yvy_id,georef_id,nombre_oficial,sup_oficial_km2,sup_fuente,sup_fuente_url,sup_oficial_tipo
0,ARG,Argentina,2780400.0,IGN 2022,https://www.ign.gob.ar/...,oficial
```

`tabla_provincias_yvy_join.csv`:

```csv
yvy_id,georef_id,pais_yvy_id,pais_georef_id,prov_id_ign,nombre_oficial,sup_oficial_km2,sup_fuente,sup_fuente_url,sup_oficial_tipo
1016,AR-S,0,ARG,66,Salta,155340.5,IGN 2022,https://www.ign.gob.ar/...,oficial
```

## Notas

- Sin CSVs o sin PMTiles el build **no rompe**: genera un manifest
  vacío y avisa por consola qué falta.
- Los PMTiles deben ser PMTiles v3. El build lee su header (127 bytes)
  para autocompletar centro/zoom/minzoom/maxzoom y la capa interna.
- Para agregar un territorio: fila en el CSV + `.pmtiles` en su carpeta,
  y `npm run build`. Nada más.
