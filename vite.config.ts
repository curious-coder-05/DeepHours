import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

function precacheManifestPlugin(): Plugin {
  return {
    name: 'deep-hours-precache-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const precacheExtRe = /\.(js|css|woff2?|ttf|otf)$/i;
      const assets = Object.values(bundle)
        .filter((item) => precacheExtRe.test(item.fileName))
        .map((item) => `/${item.fileName}`)
        .sort();

      this.emitFile({
        type: 'asset',
        fileName: 'precache-manifest.json',
        source: JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            assets,
          },
          null,
          2,
        ),
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), precacheManifestPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (
              id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/scheduler/')
            ) {
              return 'react-vendor';
            }
            if (
              id.includes('node_modules/firebase') ||
              id.includes('node_modules/@firebase')
            ) {
              return 'firebase';
            }
            if (
              id.includes('node_modules/recharts') ||
              id.includes('node_modules/d3-') ||
              id.includes('node_modules/victory-vendor')
            ) {
              return 'recharts';
            }
            if (id.includes('node_modules/three')) {
              return 'three';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
