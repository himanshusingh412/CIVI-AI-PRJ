import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  /**
   * Same-origin proxy. This is what lets the httpOnly session cookie work
   * without CORS or SameSite=None — the browser only ever talks to :3000.
   *
   * Vite keeps `server` and `preview` config SEPARATE, and a proxy declared
   * under `server` does NOT apply to `vite preview`. Omitting it there means
   * a production preview has no route to the API at all: every /api call
   * returns Vite's HTML fallback, which the client reads as "service
   * unavailable" and "Google sign-in not configured" — symptoms that look
   * like broken auth but are really a missing proxy. Declared once, used by
   * both.
   */
  const apiProxy = {
    '/api': {
      target: `http://localhost:${env.PORT || 8787}`,
      changeOrigin: false,
    },
  };

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(__dirname, '.') },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: env.DISABLE_HMR !== 'true',
      proxy: apiProxy,
    },
    preview: {
      port: 3000,
      proxy: apiProxy,
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
            // ogl must get its OWN chunk, not fall through to `vendor`.
            // `vendor` is pulled in by the entry, so bundling ogl there
            // would ship the WebGL library to every visitor eagerly and
            // silently undo the lazy import in PageBackground.
            if (/[\\/]node_modules[\\/]ogl[\\/]/.test(id)) return 'backgrounds';
            if (/[\\/]node_modules[\\/](motion|framer-motion)/.test(id)) return 'motion';
            if (/[\\/]node_modules[\\/]lucide-react/.test(id)) return 'icons';
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
            // Same reasoning as ogl above: firebase + @firebase-oss/ui-* are
            // only ever imported, transitively via lib/firebase.ts, by the
            // lazy SignInPage/LoginScreen chunk - along with everything
            // *those* pull in. The modern Firebase SDK is itself a scattering
            // of scoped @firebase/* packages (not just top-level `firebase`),
            // and FirebaseUI's phone-auth form drags in a form library,
            // schema validation, and a full phone-number-formatting library
            // (libphonenumber-js) on top. None of it is used anywhere else in
            // CivicAI (verified against package.json and a repo-wide grep) -
            // left unmatched it would land in `vendor`, which the entry point
            // also reaches, quietly shipping the whole payload to every
            // anonymous landing-page visit again.
            //
            // clsx and es-toolkit are deliberately NOT included here even
            // though FirebaseUI also uses them: recharts (the `charts`
            // chunk, above) depends on both too, and splitting a shared
            // module across two lazy chunks makes them mutually import each
            // other - Rollup calls this out as a "circular chunk" and it
            // defeats the point of the split. Leaving them unmatched keeps
            // them in the shared `vendor` pool, which is where they already
            // landed before this chunk existed.
            if (/[\\/]node_modules[\\/](firebase|@firebase(-oss)?|@tanstack|@nanostores|@radix-ui|zod|tailwind-merge|libphonenumber-js)[\\/]/.test(id)) return 'firebase';
            return 'vendor';
          },
        },
      },
      chunkSizeWarningLimit: 700,
    },
  };
});
