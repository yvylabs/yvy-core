import { defineConfig } from 'vite';
import { ErrorDeContrato, escribirManifest } from './src/lib/catalogo.js';

/** Plugin de Vite: regenera manifest.json en cada buildStart. */
function yvyManifest() {
  return {
    name: 'yvy-manifest',
    async buildStart() {
      try {
        await escribirManifest();
      } catch (err) {
        // Una violación del contrato no es un aviso: corta el build.
        if (err instanceof ErrorDeContrato) throw err;
        console.error('[yvy-manifest] error:', err);
      }
    },
  };
}

// El catálogo lo construye src/lib/catalogo.js: este archivo solo lo
// dispara en el build. La receta (scripts/receta.mjs) llama a la misma
// función, así que no puede haber dos implementaciones divergiendo.
export default defineConfig({
  base: '/',
  plugins: [yvyManifest()],
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
