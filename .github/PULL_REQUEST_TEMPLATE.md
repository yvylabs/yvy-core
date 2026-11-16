<!-- PR a master: squash merge. El check obligatorio es `build + gates`. -->

## Qué hace

<!-- Una frase. Si son dos cambios distintos, son dos PRs. -->

## Contrato de datos (marcar lo que aplica)

- [ ] No toca datos → dejar el resto en `n/a`
- [ ] Dato faltante = `null` + `estado` (`ok|parcial|missing`), **nunca `0` de relleno**
- [ ] Toda métrica nueva está declarada en `data/ontologia.json` **con `unidad`**
- [ ] Toda fuente presente (métricas **y** relaciones); sin fuente no entra
- [ ] El tipo va como campo, **nunca** dentro del `yvy_id`
- [ ] Si toca el certificado: `hash_entidad` y `hash_linaje` recalculables desde el JSON publicado (tests de `tests/certificado.test.mjs` verdes)

## Reglas de repo

- [ ] Sin derivados commiteados (`manifest.json*`, `*_centros.json`, `.pmtiles`, `.parquet` fuera de `data/registry/`), salvo regeneración determinista etiquetada como `data:`
- [ ] `wrangler.toml` (`name`), bindings (`YVY_DATA`/`YVY_TELEMETRY`) y `yvy-manifest-v3` intocables

## Verificación

- [ ] `pnpm run build` verde
- [ ] `pnpm run test` verde (el CI lo corre después del build)
- [ ] Verificado en deploy/preview (decir dónde)

## Captura

<!-- Si toca UI: captura antes/después. Si no: n/a -->
