# Yvy Explorer — Arquitectura Ontológica & Guía para Agentes de IA

**Yvy Explorer** no es un mapa con un chatbot: es un **Grafo de Conocimiento Geoespacial** donde el modelo de datos es la ontología misma. La geometría es únicamente la proyección visual del grafo.

## 1. Separación de Responsabilidades ("Lo que pesa de lo que piensa")
- **GPU (Geometría)**: Archivos `.pmtiles` en `public/data/`. Decodificados en worker thread. Cero bloqueo del hilo principal (60fps garantizados).
- **RAM (Ontología)**: `public/data/manifest.json` (~5MB). Catálogo completo cacheados en memoria con lookups $O(1)$ por `yvy_id`.
- **Fetch Lazy (Relaciones)**: Atributos extendidos y relaciones tipadas (`FFCC → territorio`) cargados bajo demanda.
- **Inferencia (0ms)**: Parser de 4 intenciones determinístico en `src/js/assistant.js` (`NAVEGAR`, `FICHA`, `FFCC`, `COMPARAR`). Sin LLMs ni alucinaciones.

## 2. Mapa de Archivos Clave
- `vite.config.js`: Plugin `yvyManifest` lee CSVs en `data/registry/` y emite `manifest.json` normalizando encabezados (sin acentos). Preserva `...c` asegurando el índice `yvy_id`.
- `src/js/manifest.js`: Fuente de verdad en el cliente (`cargarDatos`, `getObjeto`, `getPadre`, `getHijos`).
- `src/js/layers.js`: Capas on-demand filtradas por `yvy_id` y gestor genérico `toggleCapaTematica(map, id, pmtiles, opts)`.
- `src/js/objeto.js`: Renderizado de Ficha Premium con números a 38px, labels a 11px y `compararObjetos()`.
- `src/js/assistant.js`: Parser de ontología 4 intenciones y render de tarjetas de respuesta/comparación.
- `src/css/assistant.css`: Interfaz glassmorphism aislada en capa de composición GPU (`will-change: transform`).

## 3. Comandos de Desarrollo
```bash
npm run dev      # Servidor local (localhost:5173)
npm run build    # Build de producción en dist/ + regenera manifest.json
npm run preview  # Prueba del build local
```
