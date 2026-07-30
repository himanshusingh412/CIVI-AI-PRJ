import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(__dirname, '.') },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: env.DISABLE_HMR !== 'true',
      proxy: {
        // Same-origin proxy is what makes the httpOnly session cookie work
        // in development without any CORS or SameSite=None relaxation.
        '/api': {
          target: `http://localhost:${env.PORT || 8787}`,
          changeOrigin: false,
        },
      },
    },
    build: {
      target: 'es2022',
      sourcemap: false,
      // The app shipped as one ~970 kB chunk. Splitting the heavy, rarely
      // changing vendors lets the browser cache them across deploys and
      // parse them in parallel with app code.
      rollupOptions: {
        output: {
          // Path-based matching is more reliable than the object form here:
          // Vite pre-bundles deps, so bare specifiers like 'react' don't
          // always match and silently produce an empty chunk.
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (/[\\/]node_modules[\\/](recharts|d3-|victory|internmap|delaunator|robust-predicates)/.test(id)) return 'charts';
            if (/[\\/]node_modules[\\/](leaflet|react-leaflet|@react-leaflet)/.test(id)) return 'maps';
            if (/[\\/]node_modules[\\/](motion|framer-motion)/.test(id)) return 'motion';
            if (/[\\/]node_modules[\\/]lucide-react/.test(id)) return 'icons';
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
            return 'vendor';
          },
        },
      },
      chunkSizeWarningLimit: 700,
    },
  };
});
