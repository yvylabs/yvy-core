# TRL — Evidencia de madurez tecnológica

Objetivo: **TRL-4** (validación en laboratorio/entorno relevante), camino a TRL-6 (piloto).

| Criterio CFI | Evidencia | Dónde verlo |
|---|---|---|
| TRL-4: validado en lab | Portal funcional con datos reales curados (INDEC, IGN, Minería, DGI) | deploy preview + tag `v0.1.0` |
| I+D en Argentina | 100% del equipo y la curación en Salta, AR; datos oficiales nacionales | este repo + `tools/yvy_plantilla.py` |
| Desafío productivo | 5 dolores documentados (quién manda, qué datos existen, de dónde sale el número, comparar, escalar Latam) | README + SPEC §1 |
| Conocimiento local → impacto | Cobertura nacional (3334 nodos, 3 tipos) con receta replicable por provincia | `docs/CABLEADO.md`, checklist pre-subida |
| Reproducibilidad | Build determinista + CI con 4 gates + validaciones de contrato | `.github/workflows/ci.yml`, `pnpm run build` |
| Uso real medido | Telemetría privada agregada (D1 `eventos` + Web Analytics): cargas, territorios consultados, copias — sin PII | `functions/api/event.js`, `migrations/0001_eventos.sql` |

## Qué NO es todavía (honesto)
- TRL-6 requiere piloto con usuario institucional (municipio/provincia usando el portal en gestión real). En roadmap meses 6-12.
- Drill fila-a-fila (escuelas, parcelas) y D1 real son Fase 3, no parte de esta evidencia.
