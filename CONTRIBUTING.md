# Contributing — Yvy Explorer (privado)

1. **SPEC primero:** todo cambio nace de `SPEC.md`. Sin SPEC no hay PR.
2. **`data/` intocable** salvo SPEC explícito (el recorte Salta lo hace el dueño fuera).
3. **No commitear raw:** `.pmtiles/.parquet/.fgb` ni manifests derivados. Van a R2 privado.
4. **Sin CSP/validación no hay merge.** Todo endpoint nuevo con allowlist + método explícito (incluye futuro firmador R2).
5. Flujo: `feat/<tema>` → PR a `develop` con checklist del template → CI verde → merge.
6. Hooks locales: `git config core.hooksPath scripts` (el gate real es el CI).
7. Toolchain: `corepack enable + pnpm install --frozen-lockfile` (Node 22, pnpm 12.4.2).
