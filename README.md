# Yvy Core

> Infraestructura de datos territoriales con linaje auditable. Dossiers por entidad, no mapas.

**Yvy Core** unifica datos territoriales dispersos (INDEC, IGN, catastro provincial, documentos municipales) en una ontología de entidades y entrega **dossiers ejecutivos con linaje**: cada cifra con su fuente, su fecha de corte y una huella verificable.

**No es** un visor GIS, ni un IDE, ni un catálogo tipo Wikipedia. **No** apila capas: buscás una entidad y recibís su ficha con relaciones.

**Demo:** <https://explorer.yvylabs.com> · **Docs:** [`SPEC.md`](SPEC.md) · [`AGENTS.md`](AGENTS.md) · [`docs/PLAN-MAESTRO.md`](docs/PLAN-MAESTRO.md)

---

## Modelo de datos

Seis piezas, sin ambigüedad:

| Pieza | Qué es |
|---|---|
| **Entidad** | objeto con identidad estable (`yvy_id`), tipo, vigencia y visibilidad |
| **Tipo** | clase y contrato de la entidad (`municipio`, `barrio`, `cuenca`, `documento`). Vive en `ontologia.json`, no en el manifest |
| **Métrica** | valor + unidad + estado + fuente + fecha de corte + versión del dataset |
| **Relación** | vínculo tipado y direccional (`parte_de`, `interseca`, `regula`, `limita_con`) con fuente obligatoria |
| **Documento** | entidad de tipo documento, con hash de archivo y hash de texto |
| **Linaje** | metadata de auditoría inyectada en métricas, relaciones y documentos |

Reglas que no se negocian:

1. Dato faltante = `null` + `estado: missing`. **Nunca `0` de relleno.**
2. Sin `fuente` no entra. Sin `fecha` se marca explícitamente.
3. La UI no muestra ceros ni bloques vacíos: si no hay dato, el bloque no existe.
4. El tipo nunca va dentro del `yvy_id`.

El certificado de cada entidad tiene **dos hashes**: `hash_entidad` (métricas + linaje) y `hash_linaje` (relaciones + documentos). Se calculan en el build sobre JSON canónico (RFC 8785) y se pueden recalcular en el cliente.

---

## Estado

- Catálogo nacional: **3.334 entidades** (1 país, 24 provincias, 529 departamentos, 2.348 municipios, 432 barrios).
- Datasets: demografía (Censo 2022), catastro (DGI Salta, corte 2026-06), minería.
- Barrios con geometría: Salta Capital.
- **Pendiente:** geometría municipal (0/2.348 PMTiles), pipeline PDF→Markdown, capa documental.

---

## Cómo se arma el catálogo

```
data/registry/                → jurisdicciones.parquet (1 país + 24 prov +
                                  529 depto + 2348 municipios + 432 barrios)
                                  y parquets por tipo (demografia, mineria,
                                  catastro): yvy_id, nombre_oficial, parent
public/data/                  → geometría: un PMTiles por nivel o tipo
                                (`paises`, `provincias`, `departamentos`,
                                `municipios`, `barrios`, `mineria`,
                                `catastro`), con una propiedad única por
                                feature: id = yvy_id (los atributos viven
                                en el parquet)
public/data/agregados/        → JSON por tipo y yvy_id (lazy):
                                `demografia/{yvy_id}.json`, etc.
public/data/relaciones.json   → relaciones precomputadas (si falta, la ficha
                                lo tolera)
```

El plugin `yvyManifest` de `vite.config.js` lee los parquets en cada build y emite `manifest.json` + `manifest.jsonld` (catálogo: nivel, `yvy_id`, parent, nombre, superficie, fuente, pmtiles, centro real por objeto).

Sin parquet o sin PMTiles el build **no rompe**: avisa por consola qué falta y el resto sigue funcionando. Sin base de datos: todo el estado vive en el cliente, un solo fetch de manifest al abrir.

---

## Cargar ≠ Dibujar

- Cada nivel se **carga una sola vez** (su PMTiles queda cacheado en memoria); el pan/zoom solo **dibuja** triángulos ya cargados.
- El objeto activo y sus ancestros pintan (una source por nivel + capas on-demand filtradas por `id`); los niveles inferiores nunca se cargan.
- La ficha sale del manifest + agregados lazy: click en el mapa o en el buscador → dossier + `Copiar resumen`.

---

## Comandos (pnpm, Node 22)

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run dev      # desarrollo (localhost:5173)
pnpm run build    # build de producción en dist/ (+ regenera manifest)
pnpm run preview  # probar el build local
git config core.hooksPath scripts
```

## Deploy

Cloudflare Pages por **integración Git**, única vía. PR → preview deploy; merge a `master` → producción. Prohibido deployar desde CI.

- Build: `pnpm run build` · Output: `dist` · Node: `.nvmrc` (22)
- Proyecto Pages: `yvy-explorer` · Dominio: `explorer.yvylabs.com`
- R2 privado para `.pmtiles` y `.parquet`; el repo nunca sirve binarios crudos.

## Notas

- La atribución `OpenFreeMap © OpenMapTiles © OpenStreetMap` es obligatoria por licencia.
- El estado de la vista se comparte por URL (`#y=<yvy_id>&c=…&z=…`), sin backend.
- Salidas free: `Copiar resumen` (texto) + `window.print()`. PNG = screenshot del sistema.
- El repositorio es privado. Lo auditable es el dato y su linaje, no el código.
