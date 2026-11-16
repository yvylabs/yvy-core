# HANDOFF MAESTRO — Yvy Explorer (v4.2, consolidación final)

**Fecha:** 04 de noviembre de 2026 · **Estado:** para aprobación del norte final (no se ejecuta código hasta el OK).
**Consolida:** v2.0 (paradigma y terminología) · v3.0 (layout, negocio, ICP) · Actualización Multinivel · v4.0 (reglas de oro) · Ajuste IaaS/DaaS · **Dirección nov-2026: Buscador Determinista, MCP y Navegación UI (drawers)**.
**Changelog v4.2:** + §3.4 Buscador determinista (sin LLM) · + §4.1 spec del Drawer lateral · + A5 MCP Worker y C4.4 · + C2.7 buscador alimenta la vista principal · + C5.3 mensaje AI-ready · + D6.
**Fuente de verdad técnica:** `SPEC.md` + estado real del repo (rama `fix/indec-demografia-render-argentina` = `feat/ux-ficha-panel`).

---

## 1. El Norte

Yvy Explorer **no es** un GIS, ni un visor, ni un catálogo tipo Wikipedia. Es una **infraestructura de datos con componente espacial** (DaaS/IaaS de linaje): procesa, conecta y audita datos territoriales y entrega **Dossiers Ejecutivos con linaje completo** (Markdown + JSON-LD). El mapa y el grafo son herramientas de contexto que se invocan a demanda; **el producto es la evidencia auditable**.

- Competidor real: no Power BI ni Google Maps — **las horas de un equipo de datos** integrando y conciliando fuentes.
- Ventaja estructural: corre 100% en el navegador (core) → la auditoría es reproducible y nadie intermedia lo que el cliente ve.
- El frontend es la ventana; la inteligencia vive en el **pipeline de build** (Node: plugin `yvyManifest` + scripts que generan `manifest.json`/`manifest.jsonld` desde Parquet) y en el **manifest como contrato**. *Nota para el arquitecto: el pipeline actual es Node/JS, no Python — no diseñar contra un backend Python inexistente.*

**Pitch externo (v4.1):** *"Yvy Explorer es infraestructura de linaje de datos. Cruzamos tus datos con fuentes oficiales (IGN, INDEC) y te entregamos un Dossier auditable — en Markdown y JSON-LD — listo para tu sistema. No te damos un mapa: te damos la evidencia, con su fuente y su fecha de corte."*

---

## 2. Terminología final

| Registro | Usar | Prohibido (pitch externo) |
|---|---|---|
| Interno / tech brief | Motor ontológico, grafo de decisiones, manifest, yvy_id, Estructura Multinivel | — |
| Extern o / pitch | Linaje de datos, Dossier Ejecutivo, Certificado de Linaje, Ventaja decisoria, Estructura Multinivel / Explorador Jerárquico, fecha de corte | GIS, visor, capas, shapefile, mapa interactivo, inteligencia (geo/territorial), "jurisdiccional" (adjetivo), "datos crudos" en UI |
| UI visible | Jerarquía y relaciones, Dossier, Certificado de Linaje, "3.334 jurisdicciones trazadas" | "GRAFO DEL TERRITORIO", "nodos" como métrica de portada, "Capa semántica operativa" |

El sustantivo **"jurisdicción" queda habilitado** (v4.0 lo usa: "3.334 jurisdicciones trazadas"; status bar "Ninguna jurisdicción seleccionada" se mantiene).

---

## 3. Estructura Multinivel del Dossier

### 3.1 Las 5 categorías (arquitectura de información objetivo)
1. **Demografía y Sociedad** — Población, Densidad, Viviendas · roadmap: Escuelas, Salud, Seguridad.
2. **Límites y Territorio** — Linderos (provincias/internacionales), cantidad de departamentos y municipios.
3. **Hidrografía** — roadmap (no existe en el manifest hoy).
4. **Economía y Activos** — Catastro (DGI), Minería (concesiones) · roadmap: OTBN, proyectos.
5. **Infraestructura** — roadmap: FFCC, vías.

### 3.2 Reglas de oro (inquebrantables, v4.0)
- **R1 — Render 100% manifest-driven:** una categoría existe solo si `manifest.datasets` declara ≥1 dataset con datos para ese nivel. Sin cobertura → la categoría no se renderiza (o estado "sin cobertura" con fuente esperada). **Prohibido inventar ceros o acordeones vacíos.**
- **R2 — Botón de mapa condicionado:** si el dataset no declara geometría (ej. Catastro = conteo agregado), no existe "Ver en Mapa". El agregado basta.
- **R3 — Conteo primero:** el número es el texto principal; la acción de mapa es secundaria y silenciosa.
- **R4 — Progresión de niveles:** provincia/país = agregados; **solo municipio** permite nodos/líneas individuales en el mapa (puntos de escuelas, ríos) — y solo cuando ese dataset exista.
- **R5 — Linaje en todo:** cada bloque lleva fuente + fecha de corte; el bloque final es el **Certificado de Linaje** con las salidas Copiar Dossier (MD) y Copiar JSON-LD.

### 3.3 Cobertura real HOY (grounding para no prometer fantasmas)
| Dataset | Niveles | Fuente | Geometría |
|---|---|---|---|
| Demografía (Censo 2022) | país / provincia / depto / municipio | INDEC | límites jurisdiccionales (PMTiles) |
| Catastro | depto (Salta) | DGI Salta | agregado (total_parcelas) — sin geometría propia |
| Minería | depto (Salta) | Sec. de Minería | agregado (total_concesiones) — sin geometría propia |
| Relaciones | lindero (43), contiene | IGN | — |
| Escuelas, Salud | **"Próximamente"** declarado en manifest | — | — |
| Hidrografía, FFCC, OTBN, Seguridad | **no existen** | — | — |

*Acción previa obligatoria del Sprint 2: auditar los campos reales de `manifest.datasets` (fecha de corte por dataset, flag de geometría, niveles) antes de escribir el render.*

### 3.4 Buscador determinista (lenguaje natural, SIN IA generativa)
- **Cero LLMs en el core** (OpenAI/Gemini jamás): el motor es el parser ontológico determinista existente (`src/js/intencion.js`).
- Objetivo: preguntas simples y sinónimos → `{ yvy_id, metrica }`. Ejemplo norte: *"cuánta gente vive en la capital salteña"* → Salta (Capital) + demografía/población.
- Si el manifest no tiene el dato → **Fallback Honesto** (chips con conteos reales). Argumento de venta para auditores e investigadores: *"la IA te miente, Yvy no"*.
- El resultado **alimenta la vista principal** (abre el Dossier enfocando la métrica), no un chat ni una burbuja de IA.
- Extensión sin dependencias externas: patrones de pregunta + sinónimos ("gente/habitantes" → población; "capital salteña" → Salta (Capital) — el índice ya tokeniza nombres). Antes de codear: **banco de frases doradas** como regresión determinista.

---

## 4. UX/UI (v3.0 aprobado)

- **Layout:** Dossier al centro (100% si hace falta). Mapa y grafo = **drawers laterales** abiertos a demanda. Reverso declarado del "grafo siempre visible".
- **Tema claro** `#F8F9FA` por defecto, paneles blancos, bordes finos; verde reservado al sello Oficial/Auditado (Certificado de Linaje).
- **Tipografía:** Lora (serif) **solo** para el título del Dossier y el Certificado ("aire de informe oficial"); Inter para todo lo demás. La portada premium dark (R13) se adapta a tokens light existentes (`--w-edge`, variantes light ya construidas).
- **Portada:** una acción, mapa/grafo como textura al 19% + float (ya implementado). Copia según §5 y §8.
- Accesibilidad no negociable: focus visible, reduced-motion, foco atrapado en overlays, estados `ok/empty/missing`.

### 4.1 Drawer lateral (spec de navegación, dirección nov-2026)
- El Dossier queda al centro; **"Ver Mapa / Ver Grafo" desliza un panel desde la derecha** (overlay sobre el Dossier, sin reflow del contenido).
- **Retorno elegante:** "X" arriba a la derecha del drawer + Esc + (mobile) gesto estándar; el foco vuelve al botón que lo abrió (patrón ya implementado en la ficha y la portada).
- **Estado preservado:** cerrar el drawer NO resetea cámara del mapa ni selección del grafo.
- **Breadcrumb de retorno:** la barra superior refleja la vista activa — `Argentina > Salta > Dossier`; el último segmento funciona como **switcher de vista** (Dossier | Mapa | Grafo): un clic vuelve al Dossier sin perder estado. *(Nota de diseño: es un segmento de vista, no una entidad de la jerarquía — se estiliza distinto a los crumb de entidad.)*

---

## 5. Modelo de negocio: dos carriles (encuadre DaaS/IaaS)

| | **Carril Free (Core)** | **Carril Enterprise (White-Label)** |
|---|---|---|
| Datos | Oficiales públicos (INDEC, IGN, DGI, Minería) en R2 servido por Functions GET + allowlist | Datos privados del cliente en **R2 privado** |
| Acceso | Abierto, sin registro, sin auth | Presigned URLs (TTL 5 min) + CORS por dominio del tenant; Auth/DB (Supabase: Auth + Postgres + RLS) **solo si el cliente la exige** |
| Código | **Sin ofuscar** (es la prueba de transparencia) | Ofuscado (protege el entregable comercial) |
| Precio | Gratis para siempre | Setup 48hs + suscripción (por integración y actualización, no por asientos) |
| Producto entregado | El Dossier y sus salidas auditables | Su propio Yvy Explorer (logo/dominio/datos) con la misma lógica de linaje; etiqueta "Origen: Dataset Interno del Cliente" cuando el dato no es oficial |

**Regla de venta:** no vendemos software para que el cliente aprenda; vendemos el resultado (el Dossier/JSON-LD inyectable en su flujo). La UI es el escaparate del pipeline.

**Mensaje AI-ready (v4.2):** *"Yvy Explorer es AI-ready. El buscador del core es determinista — cero alucinación — y vía MCP conectás tus propios agentes (Claude, Cursor, etc.) a datos oficiales auditables. Tu IA consume el mismo linaje que ves en el Dossier."* (No construimos un chatbot: construimos la fuente que las IAs ajenas consultan.)

---

## 6. Arquitectura: hoy y ruta Enterprise

**Hoy (core):** assets estáticos + Functions GET con allowlist (tiles, data) + R2; manifest en RAM con lookup O(1); agotes por `yvy_id`; drill on-click; cero alucinación (estados `ok/empty/missing`).

**Preparación Enterprise (migración sin tocar UI):**
- **A1 — Puerta única de datos:** envolver todo fetch de R2/manifest/functions en un módulo servicio (`dataService`). La UI nunca sabe de dónde viene el byte.
- **A2 — Swap de fuente por tenant:** mismo `dataService` apuntando a bucket privado con presigned GET firmado por Worker (TTL 5 min, CORS por dominio) o a Supabase (RLS) si piden auth. El Dossier no cambia una línea.
- **A3 — Build por tenant:** el white-label es un *rebuild* con los Parquet del cliente (48hs): misma estructura de manifest, etiqueta de origen "Dataset Interno del Cliente".
- **A4 — Ofuscación solo en build enterprise** (plugin de Vite); nunca en core.
- **A5 — MCP Worker (Labs, desacoplado):** Cloudflare Worker serverless (free tier) que expone **3 tools**: `buscar_jurisdiccion`, `obtener_metrica`, `listar_relaciones`. Read-only público sobre los mismos datos del core (el manifest ya es la API). **Deployable separado** (worker propio): jamás en el bundle del core. Sin auth en v1; BYOK/auth después. *Coherente con el non-goal histórico: el MCP nunca vivió en el core, va a Labs.*

---

## 7. PLAN DE COMMITS NUMERADO (protocolo por fase: build → patch stub → sandbox → commit limpio → `git branch -f feat/ux-ficha-panel HEAD` → push ambas ramas → verificar deploy por marcadores)

> **Estado de partida:** `index.html` ya tiene aplicados (sin commitear) el nuevo `<title>` y la `<meta name="description">` del sprint copy. C1.1 los completa y commitea juntos (decidir: conservar). Archivos protegidos intocables: `scripts/prune-large-assets.mjs`, `replace_render.cjs`.

### Sprint 0 — Higiene (5 min)
- **C0.1** `chore`: decidir conservar o revertir los edits parciales de `index.html`; limpiar churn de `manifest.json*` antes de cada commit (`git checkout -- public/data/manifest.json*`).

### Sprint 1 — Copy y terminología (15 min)
- **C1.1** `copy/head`: `<title>`, `meta description`, `og:title`/`og:description`, JSON-LD `description` con el pitch v4.1. (`og:image:alt` queda hasta regenerar la imagen — C5.1.)
- **C1.2** `copy/ui`: status bar "Fuente oficial" → "Trazabilidad" (unifica con la portada); label "GRAFO DEL TERRITORIO" → "JERARQUÍA Y RELACIONES"; `aria-label="Consulta territorial"` → "Consulta".
- **C1.3** `copy/portada`: pill → **"Cada cifra, con su fuente."**; `welcome.js` meta → **"3.334 jurisdicciones trazadas · actualizado …"**.
- Verificación: sandbox (marcadores: título, pill, meta, status bar, label) → deploy → marcadores en Pages.

### Sprint 2 — Dossier IA (el gordo; empieza con auditoría read-only del manifest)
- **C2.0** `chore/audit-manifest`: volcar campos reales de `manifest.datasets` (niveles, fuentes, fecha de corte, geometría) a un snapshot de trabajo. Define qué puede renderizarse.
- **C2.1** `feat/dossier-ia`: categorías manifest-driven (R1) — Demografía y Sociedad / Límites y Territorio / Economía y Activos hoy; sin cobertura no renderiza.
- **C2.2** `feat/dossier-details`: acordeones nativos `<details>` (R3): conteo = protagonista, fuente en la misma línea; reutilizar foco por dataset existente.
- **C2.3** `feat/certificado-linaje`: bloque final verde (sello Oficial/Auditado) con fuentes + fecha de corte + Copiar MD / JSON-LD (botones ya existen: re-cascarón visual).
- **C2.4** `feat/mapa-condicionado`: "Ver en mapa" solo con geometría declarada (R2); sin geometría → sin botón.
- **C2.5** `feat/lora`: Lora self-host (woff2 subset) solo título del Dossier + Certificado.
- **C2.6** `feat/telemetria-dossier`: evento agregado `dossier_copy` (opt-out) para la métrica de éxito (§8).
- **C2.7** `feat/buscador-natural`: extender `intencion.js` (patrones de pregunta + sinónimos → `{yvy_id, metrica}`); el resultado abre el Dossier enfocando la métrica (§3.4). Incluye el banco de frases doradas como regresión. Sin dependencias externas.
- Deploy al cierre del sprint con marcadores (acordeones dinámicos, certificado, Lora).

### Sprint 3 — Layout (drawers + tema claro; el más invasivo, va último)
- **C3.1** `feat/tema-claro`: default `#F8F9FA` + pulido de tokens light en portada/dossier/grafo/widgets del mapa (AA en ambos temas).
- **C3.2** `feat/layout-drawers`: Dossier centro; mapa/grafo **drawer derecho deslizante según §4.1** (X/Esc, estado preservado, breadcrumb `Argentina > Salta > Dossier` como switcher de vista). Toca: `ui.js` (estados de vista), encuadres de `main.js` (asumen dock 55%), tabs mobile, print CSS y los selectores de portada (`html[data-welcome="portada"]` apunta hoy a `.mapa-col/.panel-grafo`). Detrás de una clase para rollback rápido.
- **C3.3** `feat/portada-light`: re-verificar scrim/edge light y contraste del float.

### Sprint 4 — Enterprise-ready (preparación, sin features nuevas visibles)
- **C4.1** `refactor/data-service`: puerta única de datos (A1) — mismo comportamiento, fetch envuelto.
- **C4.2** `feat/tenant-config` (opcional): config por tenant (logo/dominio/etiqueta de origen) para white-label.
- **C4.3** `build/obfuscacion-enterprise`: plugin de ofuscación activable solo en build de tenant (A4).
- **C4.4** `feat/mcp-worker` (Labs): Worker MCP con 3 tools — `buscar_jurisdiccion`, `obtener_metrica`, `listar_relaciones` (§6 A5). Deployable separado, read-only público en v1, sin auth. **En cola: no bloquea el core.**

### Sprint 5 — Comunicación (paralelo al 3)
- **C5.1** `assets/og`: regenerar `og-yvy.jpg` mostrando el Dossier con fuentes al pie + actualizar `og:image:alt`.
- **C5.2** `copy/como-se-audita`: micro-bloque de 3 pasos en portada ("elegí → leé fuente → copiá evidencia").
- **C5.3** `copy/ai-ready`: mensaje AI-ready (§5) en portada/Labs — "el buscador del core es determinista; tu IA consume el mismo linaje vía MCP".

---

## 8. Métrica de éxito
**Dossiers copiados (MD/JSON-LD) por sesión** (evento `dossier_copy`, telemetría agregada opt-out). Si el usuario no se lleva la evidencia, el pitch falló. Secundarias: % de sesiones que interactúan con el fallback honesto; dossiers por jurisdicción (demanda de cobertura); llamadas MCP por tool (cuando exista el Worker, §6 A5).

## 9. Decisiones abiertas (bloquean ejecución)
1. **D1:** conservar o revertir los 2 edits parciales de `index.html` (recomiendo conservar: ya son el copy aprobado).
2. **D2:** nombre UI definitivo: "Estructura Multinivel" vs "Explorador Jerárquico" (elegir uno).
3. **D3:** ¿tema claro default recién en Sprint 3 (recomendado) o adelantado?
4. **D4:** confirmar Lora self-host (peso ~2 fuentes woff2) vs. fallback serif del sistema.
5. **D5:** TTL de presigned (5 min) y dominios por tenant: confirmar que habrá 1 dominio por cliente (afecta CORS y C4.2).
6. **D6:** MCP v1 read-only público (sin auth, sobre datos oficiales free) — confirmar; BYOK/auth por tenant queda para una iteración posterior de Labs.

## 10. Qué NO tocar
- Manifest como contrato; fallback honesto; estados `ok/empty/missing`; cero ceros inventados.
- Core gratis para siempre, sin registro, código sin ofuscar (prueba de transparencia).
- Non-goals del core: sin MCP, sin upload, sin download binario (van a Enterprise/Labs).
- La honestidad del telemetría: agregada, opt-out, jamás el texto de búsqueda.
