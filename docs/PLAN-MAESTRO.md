# Yvy Core — Plan Maestro de Ejecución

**Fecha:** 14 de noviembre de 2026
**Estado:** decisiones cerradas, listo para ejecutar S0.
**Alcance:** rescate del deploy, contrato de datos, pipeline white-label, UI, GitHub.
**Fuente de verdad técnica:** este documento + `SPEC.md` del repo (a actualizar).

> Documento de diseño y decisiones. Se actualiza cuando cambia una decisión,
> no cuando cambia el código.

> **Estado (15-nov-2026):** S0 completado y deployado. G1/G2/G6 en curso.

---

## 1. Decisiones cerradas

| # | Decisión | Valor |
|---|---|---|
| D1 | Nombre del producto | **Yvy Core** (empresa: Yvy Labs) |
| D2 | Tagline del `<title>` | `Yvy Core \| Infraestructura de Datos` |
| D3 | Visibilidad del repo | **Privado** hasta definir modelo comercial |
| D4 | Unidad del producto | **Entidad**, no municipio ni nivel |
| D5 | Demo público | **Salta Capital** (la entidad con más datos ya cargados) |
| D6 | Demo secundario | **Cerrillos / La Merced** como prueba de escala (Dossier Comparativo) |
| D7 | Verticales (ambiente, minería, agro, urbanismo) | **No son productos**: son dominios de datos |
| D8 | Tema claro | **Fuera de S1**; commit aislado al inicio de S3 |
| D9 | Worker en el pipeline | **Solo firma URLs y orquesta**; no ejecuta Python |
| D10 | MCP v1 | Solo `buscar_jurisdiccion`, `obtener_metrica`, `listar_relaciones`. `comparar` afuera |
| D11 | Hash del certificado | **Dos**: `hash_entidad` (métricas) y `hash_linaje` (relaciones + documentos) |
| D12 | Ceros | Dato faltante = `null` + `estado`, nunca `0` |
| D13 | Descarga por carril | Gate en el Worker, no en el frontend |
| D14 | Multi-cliente | 1 cuenta, 1 repo, 1 Pages, 1 Worker, R2 por prefijos |

---

## 2. Diagnóstico del estado real

### 2.1 Deploy
- `https://yvy-explorer.pages.dev/` sirve **`master`** (`b6dc77b`, 15-oct) con título viejo *"Visor Territorial"*.
- `explorer.yvylabs.com` → **NXDOMAIN**.
- `yvylabs.com` tiene zona en Cloudflare (NS `jewel` / `nitin`) **sin registro A**.
- Pages deploya por integración Git desde `master`.

### 2.2 Ramas
| Rama | Commit | Estado |
|---|---|---|
| `master` | `b6dc77b` | vieja, en producción |
| `develop` | `d89affc` | vieja, 74 commits atrás de `fix`, PR #11 ya mergeado |
| `fix/indec-demografia-render-argentina` | `f5d71b8` | **portada R13 completa**, 69 commits adelante de master |
| `feat/ux-ficha-panel` | `f5d71b8` | duplicada |
| `fix/tiles-r2-cors` | `697e9f3` | mergeada, sin borrar |

`master` es **ancestro** de `fix` → fast-forward posible.

### 2.3 CI (roto)
`.github/workflows/ci.yml`, gate-d exige:
```bash
grep -q "onRequestGet" "functions/data/[[fgb]].js"
```
Ese archivo **no existe** en `fix` (solo `[[path]].js`; en `master` están ambos). El PR a master fallaría.

### 2.4 GitHub
- Repo **público** + `LICENSE` que dice *"confidencial y propietario"* → contradicción legal.
- Descripción desactualizada ("Grafo de entidades para la acción").
- Homepage vacía. Topics incompletos.
- PR template obsoleto (menciona "repo privado", "Atribución Esri", "Fase 1 v2").
- Sin issue templates, sin CodeQL, sin secret scanning.
- Dependabot semanal sin grupos → 6 PRs por 2 dependencias.
- 0 issues abiertas. PRs abiertos: #16 (hyparquet), #17 (vite), ambos con CI verde.
- Tags: `v0.1.0`, `v0.3.0`, `pre-reporte`. Última release `v0.3.0` (11-oct).

### 2.5 Código
- 6.494 líneas JS + 2.316 CSS, sin framework. Inter instalado; **Lora no existe**.
- Tema **oscuro** por defecto; claro es opt-in.
- Sin drawers; dock izquierdo + panel de grafo fijo.
- Sin tests. Sin runner de test.
- Bundle JS ~1,1 MB (315 KB gzip).

### 2.6 Datos (manifest `yvy-manifest-v3`, 3.334 objetos, 3,3 MB)

| Nivel | Filas | PMTiles | Faltantes |
|---|---|---|---|
| país | 1 | 1 | 0 |
| provincia | 24 | 24 | 0 |
| depto | 529 | 529 | 0 |
| **municipio** | **2.348** | **0** | **2.348** |
| barrio | 432 | 432 | 0 |

- **Catastro**: 309.405 parcelas, DGI Salta, corte 2026-06, **agregado a nivel depto** (no municipio).
- **Demografía**: 2.843 registros, Censo 2022, niveles país→municipio.
- **Minería**: 3.927, nivel depto.
- **Barrios**: los 432 pertenecen a **un solo padre**: `1660063` = Salta Capital.
- Municipios de Salta: **60**. Capital 594.772 · Orán 91.215 · Tartagal 79.580 → **top 3 = 53,1%** de la población municipal.
- Cerrillos: depto 55.949 hab, 12.968 parcelas, 52.448 ha; municipio San José de los Cerrillos 41.646 hab.

### 2.7 Defectos de datos confirmados
1. `vite.config.js:882`: *"Null/'' en métricas = 0 (no hay), nunca missing"* → no distingue 0 real de ausencia.
2. Catastro guarda `area_total_m2` y `area_total_ha` duplicados.
3. `por_categoria` es **JSON dentro de un string** → no consultable ni hasheable limpio.
4. **Dos "General Güemes"**: uno de Salta y otro de Chaco (`122063`). El buscador devuelve el primero.
5. Municipios sin geometría → "Ver en mapa" inválido a nivel municipal.

---

## 3. Modelo de datos (ontología)

### 3.1 Piezas

| Pieza | Qué es | Reglas |
|---|---|---|
| **Entidad** | objeto con identidad | `yvy_id` numérico + `tipo` + `nombre` + `vigencia` + `visibilidad` |
| **Tipo** | clase y contrato | Vive en `ontologia.json` (una sola vez), **no** en el manifest. Define métricas, unidades, relaciones y cardinalidad |
| **Métrica** | valor con linaje | `valor`, `unidad`, `estado`, `fuente`, `fecha_corte`, `version_dataset` |
| **Relación** | vínculo tipado y direccional | `origen`, `tipo`, `destino`, **`fuente`**, `fecha`, `vigencia`. Declarar inversa (`parte_de` ↔ `contiene`) |
| **Documento** | entidad de tipo documento | `hash_archivo` + `hash_texto` + `vigente` + `reemplaza_a` |
| **Linaje** | metadata de auditoría | En métricas, relaciones y documentos + bloque de build |

### 3.2 Reglas congeladas

1. `yvy_id` numérico como clave interna. **El tipo nunca va en el ID.**
2. Tenant = espacio de nombres del catálogo; la API expone `tenant/yvy_id`.
3. Todo valor ausente → `null` + `estado: missing`. Cero real → `0` + `estado: ok`.
4. `unidad` obligatoria en toda métrica.
5. `fuente` obligatoria en métricas **y relaciones**. Sin fuente, no entra.
6. `visibilidad` (`public | tenant | private`) en entidad, métrica y documento.
7. `ontologia.json` separado de `manifest.json`.
8. Relaciones N:M (`interseca` para cuencas y radios) — no se fuerza nada a árbol.
9. Desgloses como estructura, nunca JSON dentro de string.

### 3.3 Ejemplo canónico

```json
{
  "yvy_id": 1660063,
  "tipo": "municipio",
  "nombre": "Salta",
  "visibilidad": "public",
  "vigencia": { "desde": "1861-01-01", "hasta": null },
  "metricas": {
    "poblacion": {
      "valor": 594772, "unidad": "habitantes", "estado": "ok",
      "fuente": "Censo 2022 - INDEC", "fecha_corte": "2022-05",
      "version_dataset": "1.1"
    },
    "km_ruta_nacional": {
      "valor": null, "unidad": "km", "estado": "missing",
      "fuente": null, "fecha_corte": null
    }
  },
  "relaciones": [
    { "tipo": "parte_de", "destino": 166028, "fuente": "IGN", "fecha": "2025-09" }
  ],
  "documentos": [
    { "id": "doc_4412", "tipo": "ordenanza", "hash_archivo": "sha256:…",
      "hash_texto": "sha256:…", "vigente": true, "visibilidad": "tenant" }
  ]
}
```

### 3.4 Certificado de Linaje

- **`hash_entidad`**: JSON canónico RFC 8785 de `{yvy_id, métricas, linaje}`. Recalculable por el cliente.
- **`hash_linaje`**: relaciones + documentos.
- Se calculan **en el build**, por entidad.
- Hashear el payload completo del agregado, **no** el subconjunto visible.
- Dos hashes separados porque el de linaje cambia al agregar una cuenca u ordenanza.

### 3.5 Crecimiento de la ontología

Agregar un tipo de entidad (`cuenca`, `region`, `radio_censal`) **no** modifica lo existente: se declara en `ontologia.json` y todas las entidades pueden conectarse. Ese es el mecanismo de "agrandar la ontología".

---

## 4. Principios de UI

### 4.1 La regla
**Achicar la UI, agrandar la ontología.**

- La entidad es la pantalla. El contexto se invoca.
- El estado inicial es el **buscador**, no el mapa.
- Máximo **3 ejes de contexto** visibles y **3 métricas por bloque**; el resto detrás de "ver todas".
- Contexto **colapsado por defecto**.
- Un solo nivel "arriba" visible en el header (el breadcrumb completo ya existe).

### 4.2 Layout del dossier

```
[ENTIDAD · tipo]                       fuente + fecha
   en: jurisdicción padre ← clickeable

[5 categorías]   solo con datos · máx 3 métricas cada una

[Contexto]       (colapsado)
   Dónde se inserta: depto → provincia → país
   Comparables: 3 entidades del mismo nivel
   Relacionado: documentos / cuencas (cuando exista)

[Certificado]    hash + Copiar Markdown + Copiar JSON-LD
```

### 4.3 Reglas de render
- Métrica `missing` → **el bloque no existe**. No se muestra "0" ni "sin datos" salvo que el usuario lo pida.
- Cada entidad muestra su **profundidad de cobertura** ("perfil completo" vs "perfil básico: 3 datasets"). Sin fingir cobertura nacional.
- Mapa y grafo se abren en **drawers** (S3), no paneles fijos. Grafo limitado a 1 salto por defecto.
- "Ver en mapa" solo si `tiene_geometria: true` **y** existe el PMTiles.

---

## 5. Buscador determinista v2

### 5.1 Lo que falla hoy
`"gente en capital salteña"` → tokens `gente`, `capital`, `saltena` → no detecta demografía, no reconoce el gentilicio, y el fallback devuelve **"Los Surgentes"**.

### 5.2 Lo que hay que construir
1. **Sinónimos**: `gente`, `habitantes` → `demografia` / `poblacion`.
2. **Gentilicios**: tabla explícita (`salteña → Salta`, `jujeña → Jujuy`, …). No inferir.
3. **Patrones de pregunta**: `cuánta gente vive en`, `cuántas parcelas tiene`, `qué ordenanzas regulan`.
4. **Desambiguación determinista**: nunca un modal. Lista de resultados con nivel y jurisdicción: `Capital (Salta)`, `Capital (Mendoza)`, `Capital (Chaco)`.
5. **Banco de frases doradas** como test de regresión en CI.

### 5.3 Caso de prueba obligatorio
La colisión **General Güemes (Salta) vs General Güemes (Chaco)** debe resolverse por provincia. Es la prueba de que el sistema no adivina.

---

## 6. Pipeline white-label (48 horas)

### 6.1 Principio
El primer municipio **no se arma a mano**: se arma pasando por la receta, aunque la receta sea manual. El demo es el primer producto del pipeline, no un caso especial.

### 6.2 Insumos del cliente
```
cliente/
  raw/               caos original: PDFs, Excel, GeoJSON, shapefiles
  ontologia.csv      la única pieza escrita a mano
  salida/            lo que genera el pipeline
```

`ontologia.csv`:
```csv
entidad,tipo,padre,relacion,destino,fuente,fecha
San Benito,barrio,Salta,parte_de,Salta,IGN,2025-09
San Benito,barrio,,interseca,Cuenca Mojotoro,IGN,2024-06
Ordenanza 4412,documento,,regula,San Benito,DGI,2026-06
```

### 6.3 Los 6 pasos
1. **Subida** → presigned PUT a R2 (`tenant/.../raw/`).
2. **Parseo** → Docling/Marker: PDF → Markdown + metadatos (hash, páginas, OCR sí/no). Excel → Parquet.
3. **Geometría** → GeoJSON → tippecanoe → PMTiles.
4. **Mapeo** → `ontologia.csv` → `manifest.json`, `relaciones/{yvy_id}.json`, `documentos/{id}.json`.
5. **Validación** → sin fuente no entra; sin fecha se marca; `null` en vez de 0.
6. **Publicación** → R2 + invalidación de caché.

### 6.4 Dónde corre
- **Runner**: GitHub Actions (`workflow_dispatch`) o VPS. No Worker.
- **Worker**: solo firma URLs y orquesta. Sin Python, sin disco.

### 6.5 SLA honesto
- 48 h si los datos son tabulares o georreferenciados y están limpios.
- **Se rompe** con: PDFs escaneados sin OCR decente, datos sin fuente/fecha, geometrías sucias, nombres colisionados, ambigüedad ontológica del cliente.
- Los 5 puntos se responden **antes** de aceptar el trabajo.

### 6.6 Validación previa obligatoria
**Spike de 3 PDFs reales** (ordenanza escaneada, Excel de catastro, texto simple) en el **día 1**, en paralelo. Define si el SLA es real.

---

## 7. Carriles y permisos

| | Free | Premium | Marca Blanca |
|---|---|---|---|
| Ver dossier | ✅ | ✅ | ✅ |
| Ver mapa | ✅ | ✅ | ✅ |
| Copiar Markdown | ✅ | ✅ | ✅ |
| Descargar PMTiles / Parquet / MD | ❌ | ❌ | ✅ |
| Datos privados del cliente | ❌ | ✅ | ✅ |

- **El gate está en el Worker**: si el tenant no tiene `descarga: true`, no firma URL. El frontend solo oculta el botón.
- "El mapa que quieran" = **export bajo demanda** (recorte del área) como job + URL firmada de 5 min.

### 7.1 Protección del código
- El JS del navegador siempre es legible. Minificar/ofuscar sube el costo, no lo impide.
- Medidas reales: repo privado, sin source maps, lógica sensible en el Worker, ofuscación solo en build de marca blanca.
- **El moat es el dataset curado + el pipeline**, no el código.

---

## 8. Multi-cliente (20 clientes sin 20 Cloudflares)

```
1 cuenta Cloudflare
1 repo (monorepo)
1 proyecto Pages (mismo build para todos)
1 Worker (rutea por Host)
1 bucket R2 con prefijos: tenants/{tenant}/…
1 catálogo de tenants (D1 o JSON en R2)
```

Un cliente es **una fila de configuración**, no una infraestructura. El Worker lee el `Host`, resuelve el tenant, inyecta branding y decide permisos.

- Dominio propio del cliente → **Cloudflare for SaaS** (custom hostnames).
- Subdominio `cliente.yvylabs.com` → gratis.

---

## 9. Datos: cobertura y plan electoral

### 9.1 Lo que hay
Ver §2.6. En resumen: catastro y minería a nivel depto, demografía a nivel municipio, barrios solo en Capital, geometría municipal inexistente.

### 9.2 Lo que falta para el demo completo
1. Geometría municipal (o usar los barrios de Capital, que ya la tienen).
2. Escuelas, universidades, hospitales.
3. Rutas, tren, caminos.
4. Cuenca / hidrografía.
5. Ordenanzas y documentos.

### 9.3 Calendario electoral (mayo)
- Ventana de venta: **febrero–abril**. Construcción: **diciembre–enero**.
- Paquete comercial: **Capital + Orán + Tartagal** (53,1% del electorado municipal), cargados con la receta.
- Capa electoral nueva: **mesas, circuitos, participación y resultados por circuito**.
- **Límite legal:** agregado sí, individual no. El padrón a nivel persona está restringido (Ley 25.326 + normativa electoral).
- **Neutralidad:** el demo no se asocia a partido ni candidato. Si se percibe partidario, se pierde la venta institucional.

---

## 10. Calendario comprimido

| Fase | Días | Qué |
|---|---|---|
| **S0 — Rescate** | **0 (hoy, ~2 h)** | Fix CI · 2 commits · PR/FF a master · verificar Pages · CNAME · title |
| **S1 — Contrato + receta + demo** | 1–5 | Contrato de entidad · `ontologia.csv` · validador · hash · buscador v2 + tests · cargar Capital **a través de la receta** · dossier 5 categorías · Certificado · Lora |
| **S2 — Automatización** | 5–8 | PDF→MD · GeoJSON→PMTiles · spike 3 PDFs · publicación · `municipios.pmtiles` |
| **S3 — UI definitiva** | 7–9 | Tema claro default + AA · drawers · mapa condicionado · feature flags |
| **S4 — MCP** | 9–10 | 2–3 tools: `buscar_jurisdiccion`, `obtener_metrica`, `listar_relaciones` |
| **S1.5 — Electoral** | dic–ene | Capa agregada + Orán + Tartagal |
| **GitHub** | paralelo | G1–G6 (§11) |

**Hitos:** producto visible hoy · demo vendible día 5 · pipeline automatizado día 8 · producto completo día 10.

---

## 11. Mejora integral de GitHub (G1–G6)

### G0 — Urgente: contradicción legal
Repo público + LICENSE propietario. **Decidido: pasar a privado.** Antes de cambiar visibilidad, verificar que la GitHub App de Cloudflare Pages tenga acceso al repo o se cortan los deploys.

### G1 — Identidad
Description nueva (*"Yvy Core — infraestructura de datos territoriales con linaje auditable"*), homepage `https://explorer.yvylabs.com`, topics (`parquet`, `data-lineage`, `dossier`, `cloudflare-pages`), social preview, README con screenshot y demo.

### G2 — Protección y flujo
Ruleset en `master`: PR obligatorio, check `build + gates`, no force-push. `delete_branch_on_merge`, auto-merge, squash por defecto. Borrar `develop`, `feat/ux-ficha-panel`, `fix/tiles-r2-cors`. Activar `core.hooksPath scripts`.

### G3 — CI/CD
`concurrency: cancel-in-progress`, `timeout-minutes: 15`, job `test` real, `dependency-review` + CodeQL, artefacto de `dist/`, verificación post-deploy del commit vivo. Dependabot con grupos + auto-merge.

### G4 — Templates
PR template nuevo (contrato, `null`, hash, captura visual). Issue templates `bug.yml` / `feature.yml` con campo `yvy_id`. `SECURITY.md`, `CHANGELOG.md`.

### G5 — Releases
Milestone `v0.4.0 — Yvy Core`, release al mergear S1 con hash del build.

### G6 — Higiene
`.editorconfig` (migración Windows→Linux), README reescrito, `SPEC.md` y `AGENTS.md` actualizados al nuevo nombre y contrato.

---

## 12. Deuda silenciosa a saldar

1. Telemetría `dossier_copy` (KPI del pitch).
2. CORS dinámico por tenant en `public/_headers`.
3. Docs: `SPEC.md`, `AGENTS.md`, `README.md`.
4. Bundle: code-splitting al sumar drawers + Lora + certificado.
5. Atribución de mapas (OSM/OpenFreeMap) definida antes de vender marca blanca.
6. `develop` eliminada.

---

## 13. Decisiones abiertas

| # | Pregunta | Bloquea |
|---|---|---|
| A1 | Credenciales de escritura GitHub (`gh auth login` + `gh auth setup-git`) | **S0 completo** |
| A2 | CNAME `explorer.yvylabs.com` en Cloudflare (o token) | DNS |
| A3 | Nombre exacto del proyecto Pages | Verificación post-deploy |
| A4 | ¿Los 432 barrios son solo de Capital o de toda la provincia? | Alcance del demo |
| A5 | ¿Se suma la capa electoral en S1.5 o se espera? | Plan de campaña |
| A6 | ¿Dossier Comparativo entra en S1 como feature? | MCP `comparar` |

---

## 14. Registro de decisiones (por qué)

- **Yvy Core** y no Yvy Evidence: extensible a servicios, más corto en UI.
- **Repo privado**: la IP es del estudio; lo auditable es el dato.
- **Capital como demo**: es la entidad con más datos ya cargados → la más barata de completar. La elección es de costo, no de estrategia.
- **Municipio no es la unidad**: la entidad lo es. Eso es lo que hace real la promesa de 48 h.
- **Pipeline desde el día 1**: construir el demo a mano y automatizar después implica construir dos veces.
- **Tema claro fuera de S1**: toca portada, mapa, grafo, contraste y print; mezclarlo con el rediseño hace que S1 no termine.
- **Worker no ejecuta Python**: límites de CPU, tiempo y disco.
- **Dos hashes**: uno solo se invalida cada vez que se agrega un vínculo.
- **Verticales degradadas a dominios**: como menú reproducen el visor de capas que se quiere evitar.

---

## 15. Próximo paso

1. `gh auth login` + `gh auth setup-git` + `git config core.filemode true`.
2. Confirmar proyecto Pages y acceso de la GitHub App.
3. Ejecutar **S0**:
   - commit `fix/ci` (gate-d → `[[path]].js`, borrar `[[fgb]].js`),
   - commit `fix/portada` (CSS + title),
   - push + PR + merge,
   - verificar `pages.dev` (title, pill, H1, Ctrl K, footer, fondo animado),
   - CNAME y verificación en `explorer.yvylabs.com`.
4. Pasar el repo a privado y ejecutar G1/G6.
5. Arrancar S1 con el contrato de datos.


---

## 16. Progreso de ejecución

### S0 — completado (15-nov-2026)

| Paso | Estado |
|---|---|
| CI gate-d corregido | ✅ commit `a9fba49` |
| Portada + marca Yvy Core | ✅ commit `4be44f9` |
| PR #18 con CI verde | ✅ |
| Merge a `master` (squash) | ✅ `1446bb6` |
| Deploy verificado en `pages.dev` | ✅ título nuevo + R13 vivo |
| Ruleset de protección arreglado | ✅ (la condición decía `refs/heads/master y develop`) |
| `develop` y `feat/ux-ficha-panel` eliminadas | ✅ |
| Metadata del repo (description, homepage, topics) | ✅ |
| Repo renombrado a `yvylabs/yvy-core` | ✅ (Pages sigue deployando) |
| README / AGENTS / SPEC / CONTRIBUTING / NOTICE | ✅ |

### S1.2 — buscador determinista (16-nov-2026)

`src/js/parser.js` es el núcleo puro (sin red, sin manifest); `intencion.js`
lo conecta al catálogo. `tests/parser.test.mjs` corre con `pnpm run test`
en el CI, antes del build (22 frases doradas sobre un fixture de 52 entidades).

Lo que resolvió, medido contra el catálogo real (3.334 entidades):

| Antes | Ahora |
|---|---|
| `capital de mendoza` → Capital de Catamarca | depto Capital de Mendoza |
| `general guemes salta` → General Alvarado (Buenos Aires) | depto General Güemes de Salta |
| `barrios de salta` → municipio Barrios (Jujuy) | provincia Salta, relación `contiene` |
| `capital federal` / `caba` → Capital de Catamarca | CABA |
| `cerillos` (typo) → nada | depto Cerrillos |
| `capital chaqueña` → Capital de otra provincia | `null` (Chaco no tiene Capital) |

Reglas: la provincia nombrada en la frase califica (y se saca de la
búsqueda); `capital` + provincia = ese departamento Capital o `null`;
tolera un typo de una letra en palabras de ≥6 letras.

### S1.2b — desambiguación visible (16-nov-2026)

El parser ya desambiguaba; la lista de resultados lo perdía. Escribir
`capital` devolvía once filas idénticas con el texto "Capital".

Ahora cada lugar muestra su provincia (`Capital (Salta)`, `Capital
(Mendoza)`) y la lista usa `p.candidatos` (ya filtrados) en vez de
re-consultar por la frase. Se excluye solo la entidad activa por `yvy_id`:
las homónimas de otras provincias son la respuesta honesta (§5.2.4).

### S1.4 — ontología, validador y certificado (16-nov-2026)

`data/ontologia.json` es el contrato: tipos (con `padre` declarado),
métricas con `unidad` y `tipo`, relaciones con `fuente` y reglas. El build
lo publica en `public/data/ontologia.json` y referencia desde el manifest.

**Validador** (`vite.config.js`): corta el build (`ErrorDeContrato`) si un
objeto usa un nivel no declarado, si el padre real no está admitido, si una
métrica no está declarada o no tiene unidad, si un agregado o dataset queda
sin fuente, o si aparece una relación no declarada. Las advertencias siguen
siendo advertencias; una violación de contrato no.

**Certificado** (`src/js/canonico.js`): `hash_entidad` (métricas + linaje
de datos) y `hash_linaje` (relaciones + documentos) sobre JSON canónico
RFC 8785 con SHA-256, calculados en build y re-calculables en el cliente con
el mismo módulo (WebCrypto, sin dependencias). Determinismo verificado: dos
builds seguidos dan hashes idénticos.

Estado actual del linaje: 16.858 relaciones (`lindero`, `cerca_de`), 2.429
entidades con relaciones; documentos todavía 0.

### S1.5 — Certificado en la ficha (16-nov-2026)

La sección `Certificado de linaje` (colapsada, al pie del dossier) lista
cada dataset con su `hash_entidad` / `hash_linaje` y los **verifica en el
navegador**: recalcula ambos con `canonico.js` (mismo módulo del build,
WebCrypto) y muestra ✓ verde si cierra, ⚠ rojo con el hash esperado si no.
`Copiar certificado` exporta el JSON completo. Si ningún dataset trae
certificado, el bloque no existe.

### GitHub (G3, G4) — completado (16-nov-2026)

| Ítem | Estado |
|---|---|
| G4: PR template con checklist de contrato | ✅ |
| G4: issue templates (`yvy_id`, severidad "dato falso") | ✅ |
| G4: SECURITY.md + CHANGELOG.md 0.4.0 | ✅ |
| G3: concurrencia + `timeout-minutes: 15` + artefacto `dist/` | ✅ |
| G3: `dependency-review` (CVE high+ no entra) | ✅ |
| G3: CodeQL `security-extended`, semanal, workflow separado | ✅ |
| G3: dependabot con grupos + auto-merge acotado a `deps-dev` minor/patch | ✅ |
| Dependabot #16 (hyparquet 1.33.0) y #17 (vite 6.4.6) mergeados | ✅ |

**Deuda de G3 anotada:** verificación post-deploy del commit vivo en
Actions. Pages deploya async después del workflow; hacerlo desde CI
implica sondear y acoplar CI a Pages. Hoy se verifica a mano con `curl`.

### Pendiente inmediato
- CNAME `explorer.yvylabs.com` (Custom domains del proyecto Pages).
- Repo a privado (después de confirmar que el CNAME funciona).
- `fix/tiles-r2-cors`: rama vieja no mergeada — decidir (borrar o rescatar).
- S1 restante: dossier de 5 categorías, fuente Lora, cargar Capital **a
  través de la receta** (es el primer caso del pipeline, S2).
