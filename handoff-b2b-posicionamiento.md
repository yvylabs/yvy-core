# Handoff — Pivote de posicionamiento: Yvy Explorer

**De:** Consultoría de Estrategia de Producto y Branding B2B
**Fecha:** 03 de noviembre de 2026
**Alcance de este documento:** traspaso del diagnóstico de posicionamiento y del plan de acción para otro consultor. No incluye datos técnicos que no estén implementados; todo lo citado como "evidencia" existe hoy en el producto.

---

## 1. Resumen del Posicionamiento Actual

Yvy Explorer es un **grafo de decisiones** sobre entidades jurisdiccionales de Argentina (país, provincias, departamentos, municipios) que **corre 100% en el navegador**: es un producto estático, sin backend, sin login y sinUPLOAD por parte del usuario.

La promesa que el producto ya cumple (aunque todavía no comunica bien) es de **trazabilidad y auditabilidad**:

- Ecada objeto existe en un catálogo en memoria (`manifest.json` + su versión JSON-LD) que funciona como **contrato de datos**: declara datasets, niveles donde aplican y la fuente.
- Los datos se leen en el cliente desde archivos Parquet; la geometría es un insumo de render (PMTiles), no el producto.
- **Cero alucinación por diseño:** la búsqueda que no encuentra responde con un fallback determinístico y honesto ("No tengo X para Y; para Y tengo…", con chips clickeables, fuentes y fecha de corte). copiar es snapshot: la evidencia que sale es la misma que ve el usuario.
- **Salidas audibles ya implementadas:** "Copiar dossier" (Markdown con list de fuentes al pie) y "Copiar JSON-LD" (schema.org, `AdministrativeArea`). El dossier muestra la fuente de cada bloque (INDEC · Censo 2022, IGN, DGI Salta, Secretaría de Minería).
- Acceso abierto, sin registro, gratuito en core.

Falta declarar: el posicionamiento **comunicado** hoy sigue siendo técnico/territorial ("grafo de entidades del territorio argentino", "visor", globo 3D). El gap es de discurso, no de producto.

---

## 2. Inventario de Activos Actuales

Estos activos ya existen y son la base sobre la que hay que re-escribir el discurso.

### 2.1 Producto visible
- **El Dossier por jurisdicción** — la ficha con jerarquía completa, números reales y acordeones de datasets (Demografía, Catastro, Minería). Es el producto según el dueño; hoy vive detrás de un icono de lupa/ficha, mientras el globo y el grafo dominan la primera impresión.
- **Grafo de jerarquía y relaciones** — nodos ponderados con población real (Censo 2022), linderos reales, drill por provincia. Insumo de navegación, no el deliverable.
- **Portada de una pantalla** — una sola acción (elegir jurisdicción o buscar), mapa y grafo como textura de fondo, buscador con intención (`parser` entidad + dataset: "Salta y minería" → dossier Salta con Minería enfocada).
- **Búsqueda honesta** — autocompletado sobre el manifest, sin Google-Suggest; fallback determinístico con chips.

### 2.2 Motor de trazabilidad
- **El manifest como contrato de datos** (`manifest.json` / `manifest.jsonld`): fuentes integradas declaradas; el panel "Fuentes integradas" de la portada se **genera** desde ahí (no hardcodeado).
- **Catalogación por `yvy_id`**: jerarquía paíss→provincia→departamento→municipio con relaciones (`lindero`, `contiene`) armadas a demanda.
- **JSON-LD en el head** (schema.org, `DataCatalog`) y por objeto (`AdministrativeArea` con `@id`, `containedInPlace`, superficie).

### 2.3 Salidas del trabajo del usuario
- **Copiar dossier (Markdown)** con fuentes al pie — pegable en un informe.
- **Copiar JSON-LD** — encadenable en pipelines/AAA del cliente.
- **Permalink** (`#…&y=<id>`) — vista compartible y reproducible.
- Pantallazo del navegador como única imagen (decisión de diseño).

### 2.4 Infraestructura y límites deliberados
- **100% estático**: hosting de assets estáticos + funciones solo GET con allowlist para tiles/catálogo; datos públicos de Parquet en_BUCKET privado servidos por rutas controladas.
- Sin registro, sin cookies identificativas; telemetría anónima y agregada con opt-out (`pick`, `search_miss`, etc.), nunca el texto de búsqueda del usuario.
- Core gratis para siempre (non- goals: no MCP en core, no dump, no download binario). **Labs** (marca separada) es el espacio premium futuro: MCP con BYOK, LLM, export.
- Accesibilidad y determinismo como patron: focus trap, reduced-motion, estados `ok/empty/missing` en vez de pantallas vacías mudas.

---

## 3. El Gap

Brechas entre lo que el producto ES (trazabilidad) y lo que SUENA (GIS/tecología). Cada gap incluye la evidencia.

### Gap 1 — El titular vende un mapa, no un resultado de negocio
La meta description / OG dice: *"Grafo de entidades del territorio argentino. Dossier por jurisdicción con datos oficiales (Censo 2022, IGN): población, viviendas y superficie. En el navegador, sin login, gratis."*
Es una descripción de **contenido** (qué hay), no un **outcome** (qué le resuelve a quién). Las palabras que definen el nuevo posicionamiento — trazabilidad, auditabilidad, decisiones, evidencia — aparecen cero veces en el discurso externo.

### Gap 2 — La primera pantalla es una experiencia gIS, la conversión es un documento
El visitante ve un globo 3D al 19% y un grafo de fondo; el Dossier (el producto real) aparece recién después de buscar/elegir. La salía auditable (Copiar MD/JSON-LD) está más abajo, adentro de la ficha. La secuencia de descubrimiento no acompaña el pivote: "look like GIS, convert like analysis".

### Gap 3 — Jerga de arquitecto en lugar de lenguaje de cliente
- Pill de la portada: **"Capa semántica operativa"** (palabra de ontologio, no de comprador).
- Etiqueta del panel central: **"GRAFO DEL TERRITORIO"** (territorial = el posicionamiento que se abandona).
- Meta visible: **"3.334 nodos"** (métrica de build, no de valor).
- Homenaje al producto: H1 "Grafo de decisiones." está bien, pero el subtítulo habla de "infraestructura que conecta cada objeto…" — sigue explicando el mecanismo antes que el beneficio.

### Gap 4 — El argumento "100% en el navegador" está implícito, no argumentado
Correr client-side es la prueba más fuerte del nuevo posicionamiento: **nadie puede alterar los números; la consulta es reproducible; no hay agenda opaca en el medio**. Hoy ese hecho solo aparece como un dato técnico ("En el navegador, sin login, gratis") y nunca como el argumento de confianza/auditoría que un comprador B2B necesita.

### Gap 5 — Inconsistencias internas del copy
El footer de la portada ya dice **"Acceso abierto · Sin registro · Trazabilidad"**, pero la status bar de la app sigue en **"Acceso abierto · Sin registro · Fuente oficial"**. Mismo concepto, dos frases, cero sistema de mensajing. Eso resignifica cada página: la trazabilidad se menciona una vez y desaparece.

### Gap 6 — No hay "para quién"
No existen en ningún lado: segmentos (gobierno local/provincial, consultoras, legales/ambiental, prensa de datos), casos de uso narrados, ni una definición del comprador. Un visitante B2B no puede ubicarse en el producto. "Labs (Beta) →" además remite a una marca nueva sin contexto.

### Gap 7 — La prueba social/visual no muestra el deliverable
La imagen OG es el grafo (visual GIS). El asset que debería regenerarse para el pivote es **el Dossier con fuentes al pie** — la imagen del preview de un link compartido debería ser "la captura de la evidencia", no "la captura del mapa".

---

## 4. Oportunidades de Mejora (To-Do)

Ordenado por impacto/esfuerzo. Nada de estas acciones requiere construir features nuevas salvo donde se indica.

### 4.1 Copy externo (rápido, alto impacto)
- [ ] **Reescribir `<title>`, meta description y OG** con promesa de negocio, ej.: *"Trazabilidad de datos oficiales para decisiones territoriales. Cada cifra con su fuente a la vista, repoducía en tu navegador."*. Mantener Censo 2022/IGN como prueba, no como titular.
- [ ] **Regenerar la imagen OG** con el Dossier abierto y las fuentes visibles (incluye panel de referencias). Es la prueba visual del pivote.
- [ ] **Unificar el statement legal/trust en un solo texto**: "Acceso abierto · Sin registro · Trazabilidad" en status bar, portada, README y meta. Un mensaje, una formula.

### 4.2 UI copy (retoces quirúrgicos, no rediseño)
- [ ] Pill de portada: "Capa semántica operativa" → algo de promesa, ej. **"Cada cifra, con su fuente."** o **"Datos verificables en tu navegador."**
- [ ] Etiqueta del panel: "GRAFO DEL TERRITORIO" → **"Jerarquía y relaciones"** (o "Trazado de la decisión"; elegir una voz y no dos).
- [ ] Subtítulo del H1: pasar de mecanismo a beneficio, ej.: *"Cada decisión sobre un territorio respaldada por la fuente, la fecha y la jerarquía del dato."*
- [ ] En la ficha del Dossier, **mostrar la fuente arriba** (badge "INDEC · Censo 2022") y no solo en los acordeones: es el sell del nuevo discurso en el lugar donde el usuario pasa más tiempo.
- [ ] **"3.334 nodos"** → reciclar como prueba de cobertura, no de tamaño: *"3.334 jurisdicciones trazadas"*.

### 4.3 Aparecer el argumento de confianza (100% en navegador)
- [ ] Agregar **una línea de "por qué confiable"** en portada y en el dossier: correr 100% en tu navegador = la auditoría es tuya, reproducible, y nadie intermedia tus datos. Es el gap 4; es una frase y un micro-bloque (ej. footnote de portada), no una página nueva.
- [ ] **One-pager "Cómo se audita"** (3 pasos): 1) elegí la jurisdicción; 2) leé el número y su fuente; 3) copiá el dossier o el JSON-LD y conservá la evidencia. Puede living en la portada o en un modal nico.

### 4.4 Comercial / narrativa B2B
- [ ] **Definir ICP y 3 segmentos** (sugeridos para validar, no impuestos: a) áreas de datos/estadística de estados y municipios; b) consultoras de riesgo y ESG territorial; c) medios/universidades que publican cifras). Para cada uno: problema → cómo se usa Yvy → ejemplo real disponible hoy.
- [ ] **Pitch de 30 segundos reescrito** (borrador para iterar):*"Yvy Explorer es trazabilidad de datos oficiales sobre el territorio argentino. Escribís una jurisdicción, leés el número y la fuente al pie; copiás el dossier en Markdown o JSON-LD y queda auditable en tu informe. Corre 100% en tu navegador: no hay back-office que altere lo que ves. El core es abierto y gratis; Labs lo conecta a tus procesos."*
- [ ] **Articular core-vs-Labs en términos de negocio** usando lo que ya existe: core = consulta libre, trazabilidad, salidas auditables; Labs (futuro) = MCP con BYOK, LLM y export — "cuando la trazabilidad tiene que escalar a tus sistemas".
- [ ] **Ejemplo obvio en el buscador que demuestre la honestidad**: mantener la búsqueda sin resultados con chips con conteos reales como demo pública del "cero alucinación" (hoy es una feature invisible; es un diferenciador que se puede narrar).

### 4.5 Medición del pivote
- [ ] Definir la métrica de éxito **del discurso nuevo**: no "visitas", sino **dossiers copiados** (ya existe el botón) y % de sesiones con fallback honesto interactuado. Si nadie copia, el pitch está repicando en la pared equivocada.
- [ ] Re-auditar en 2 semanas con este doc: marcar qué gaps quedaron y cuál copy ganó.

### 4.6 Qué NO tocar
- El fallback honesto y el manifiesto como contrato (son la razón de ser del nuevo posicionamiento).
- El core gratuito y los non-goals (no upload, no download binario, no bg) — son la barrera que sostiene "cada cifra con su fuente".
- La estética actual de la portada: es de las pocas homes de datos que no parece un dashboard; solo cambia el copy y el orden de aparición del Dossier.

---

*Cierre del consultor entrante: el producto ya hizo la parte difícil (evidencia verificable, salidas auditable, honesto por diseño). Este pivote no exige construir; exige declarar. Prioridad 1: copia externa y OG. Prioridad 2: fuente visible arriba del Dossier. El resto sigue.*
