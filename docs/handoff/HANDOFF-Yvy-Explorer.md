# Yvy Explorer — Estado actual y límites (handoff)

> Brief para otro dev. Cada afirmación tiene archivo:línea para que se pueda verificar.
> Fecha: 2026-10-20.

## 1. Dónde estamos parados

- **Fuente de verdad: `SPEC.md`.** No es un doc más. Si algo lo contradice, el SPEC
  gana hasta que el SPEC se edite a propósito (§11: "Decisiones cerradas, no
  reabrir sin SPEC").
- Código en **Fase 1 v2**: 9 js + 1 css en `src/`, Functions en `functions/`.
- Stack local: `corepack enable` → `pnpm install --frozen-lockfile` →
  `pnpm run dev` (localhost:5173). Node 22.
- Deploy **solo** por Git integration (PR → preview, merge a `master` → prod).
  Prohibido deployar desde CI (SPEC §9).
- En local **no hay Cloudflare, R2 ni Pages** (SPEC §9). Todo con `data/registry/`
  y `public/data/` locales.

## 2. Qué YA está hecho (no rehacer)

| Pedido de `YVY-ACUERDOS-V2` | Estado |
|---|---|
| Panel fijo 380px, desktop, no 50/50 | Hecho — `src/css/main.css:1104` y `:1258` |
| Bottom sheet en mobile | Hecho — `main.css:1238-1249` |
| Auto-offset para que el panel no tape el objeto | Hecho — `src/js/main.js:222` y `:253` (padding left 440) |
| País centrado en `[-64,-50]`, zoom 2.3 | Hecho — `main.js:220` |
| `cameraForBounds` con `bounds_objeto` genérico | Hecho — `main.js:233` (mejor que un bbox hardcodeado) |
| Autoría del dossier en clases `dossier-*` | Empezado — `src/js/objeto.js:297-395` |

**Ojo con el permalink:** `#y=` es el **`yvy_id` del objeto**, no el bearing
(`src/js/share.js:19`, `:67`, y SPEC §4: `link #y=&c=&z=`). El país Argentina tiene
`yvy_id = 0`, así que el ejemplo `#y=0` del doc funciona por casualidad y hace
parecer que doc y código coinciden. **No tocar `y` sin decisión de SPEC.**

## 3. Qué SÍ se puede hacer hoy (sin tocar el SPEC)

Bugs y deuda reales, verificables:

1. **`renderFicha` borra el chrome del panel.** `objeto.js:301` hace
   `panel.innerHTML = ''`. Se pierde el `<header id="explorer-head-inspect">` con el
   botón ✕ (`index.html:125-131`) y el `#objeto-info`. Consecuencia: después de elegir
   un objeto el ✕ no existe (los listeners se bindearon una sola vez en `ui.js:51`), y
   `mostrarEstadoFalta()` (`objeto.js:106`) ya no tiene dónde escribir →
   **el estado `missing` queda roto**.

2. **El dossier muestra `–` en datos que sí tiene.** `objeto.js:349-350` hardcodea
   `'–'` para *Viviendas colectivas* y *Población en calle*. Los valores existen:
   `public/data/agregados/demografia/0.json` trae `pob_colectivas: 260572` y
   `pob_calle: 5638`.

3. **Código muerto en `objeto.js`** (~350 líneas, nadie las importa):
   `componerNarrativa`, las `frase*`, `textoResumen`, `botonCopiar`, `renderHijos`,
   `seccionHijos`, `renderDatasetsAplicables` (queda como `export` huérfano en
   `objeto.js:680`).

4. **CSS duplicado/muerto del mismo panel:** `#panel-explorador` está definido 3 veces
   con 3 anchos: 320px (`main.css:324`), 380px `left:56px` (`:1104`), 380px `left:0`
   (`:1258`). Más `.floating-panel` a 360px (`:311`). Y `.objeto-hero*` (`:1124`) es
   estilo huérfano (hoy es `.dossier-hero`). También sobra `@keyframes satPulse` +
   `.toolbar-btn.is-sugerido` (`:1230-1235`), del feature satélite que se borró.

5. **Briefing y grid del dossier son texto fijo.** `objeto.js:368` arma una sola frase
   con `'El ' + obj.nivel + ' de ' + nombre…` (queda "El pais de Argentina"). El pedido
   de V2 (briefing derivado de las propiedades, vigencia por propiedad) es una
   reescritura de `renderFicha`, sin dependencias nuevas.

## 4. Qué NO se puede hacer sin editar el SPEC antes

1. **`#y=` como bearing/yaw.** Rompe todos los links compartidos. Si se quiere bearing,
   va un param nuevo (`b=`), y eso es enmienda a SPEC §4.
2. **Satélite / toggle Híbrido.** SPEC §7 dice que `basemaps+control → ensureSatelite()`
   fue **eliminado** y marcado "hecho; no reabrir". `main.js:316` dice "Sin satélite".
   Además "ESRI World Imagery gratis" no aplica a producción: requiere key y
   atribución; MapTiler igual. Para marca blanca (comercial) eso es costo, no commodity.
3. **Capas en tiempo real (FIRMS, Open-Meteo, SMN).** Choca con tres cosas del SPEC:
   §0 "**no apila capas**", §0 "el mapa es opcional", §11 "**sin servidores**". Un worker
   con cron cada 3h + R2 + deploy separado contradice §9 (deploy único por Git). Y ojo:
   FIRMS pide `MAP_KEY`, y Open-Meteo free es **no comercial / con límites**. Si Yvy
   vende marca blanca, eso se decide antes de escribir una línea.
4. **No dejar el doc V2 como verdad paralela.** Si se adopta, se fusiona al SPEC.
   Dos docs = dos verdades.

## 5. Detalles del doc V2 a corregir antes de usarlo

- Dice `padding left 440` en un bloque y más abajo `padding 80`. ¿Cuál?
- Propone `fitBounds([[-73.5,-55.2],[-53.6,-21.8]])` hardcodeado para Argentina. El
  código ya es genérico (`main.js:233`) — hardcodear rompe Marca Blanca en otro país.
  El `bounds_objeto` real de país es `[-73.56, -59.46, -26.25, -21.78]`.
- Ese `-53.6` de longitud este no corresponde al territorio continental.
- "hace 12 min" no es lo mismo que `fecha_vigencia: "2022-05"`. Son dos semánticas de
  vigencia, y SPEC §4 exige snapshot + fecha en el copy. Si no se rotulan distinto
  (`Vigencia` vs `Actualizado hace`), el copy queda obsoleto y rompe "cero alucinación".

## 6. Desprolijidad de proceso

`AGENTS.md` §2 dice que `main.js` tiene `ensureSatelite()`. **No existe.** Está
desactualizado contra SPEC §7 y contra el código. No confiar en el AGENTS para
arquitectura; usar `SPEC.md`.

## 7. Cómo verificar todo esto en 5 minutos

```bash
grep -n "innerHTML = ''" src/js/objeto.js
grep -n "yvyIdActual\|&y=" src/js/share.js
grep -rn "renderDatasetsAplicables\|componerNarrativa" src/
grep -n "#panel-explorador" src/css/main.css
grep -rn "ensureSatelite" .
cat public/data/agregados/demografia/0.json
```

## 8. Orden sugerido de trabajo

1. Arreglar `renderFicha` para que no destruya el header ni `#objeto-info`
   (desbloquea ✕ y `missing`).
2. Completar grid + briefing derivados de datos (incluye colectivas/calle).
3. Borrar código muerto de `objeto.js` y CSS muerto/duplicado de `main.css`.
4. Un solo ancho de panel.
5. Recién después: llevar las enmiendas al SPEC (permalink `b=`, satélite,
   tiempo real) y decidir costos antes de implementar.
