# Contributing — Yvy Core (privado)

1. **SPEC primero:** todo cambio nace de `SPEC.md` + `docs/PLAN-MAESTRO.md`. Sin SPEC no hay PR.
2. **`data/` intocable** salvo SPEC explícito (el recorte Salta lo hace el dueño fuera).
3. **No commitear derivados ni raw:** `manifest.json`, `manifest.jsonld`, `*_centros.json`, `.pmtiles`, `.parquet` (solo `data/registry/`). Van a R2 privado.
4. **Contrato de datos:** `null` + `estado` para faltantes, nunca `0`; `fuente` obligatoria en métricas y relaciones; `unidad` y `visibilidad` obligatorias.
5. **Sin CSP/validación no hay merge.** Todo endpoint nuevo con allowlist + método explícito (incluye el futuro firmador de URLs R2).
6. Flujo: `feat/<tema>` o `fix/<tema>` → PR a **`master`** → CI `build + gates` verde → **squash merge**.
7. Hooks locales: `git config core.hooksPath scripts` (el gate real es el CI).
8. Toolchain: `corepack enable` + `pnpm install --frozen-lockfile` (Node 22, pnpm 12.4.2).
