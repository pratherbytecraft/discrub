import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFileSync } from 'fs'
import { launcherVersion } from './scripts/vite-launcher-version'

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));
const classicManifest = JSON.parse(
  readFileSync(path.resolve(__dirname, 'public/classic-chrome/manifest.json'), 'utf8'),
);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    launcherVersion({
      __APP_VERSION__: pkg.version,
      __CLASSIC_VERSION__: classicManifest.version,
    }),
  ],
  define: {
    '__APP_VERSION__': JSON.stringify(pkg.version),
    // Strip Discord token from production builds to prevent accidental exposure
    ...(process.env.NODE_ENV === 'production' ? { 'import.meta.env.VITE_DISCORD_TOKEN': JSON.stringify('') } : {}),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@features': path.resolve(__dirname, './src/features'),
      '@services': path.resolve(__dirname, './src/services'),
      '@theme': path.resolve(__dirname, './src/theme'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@containers': path.resolve(__dirname, './src/containers'),
      // Perf build only: the profiling build of react-dom so React.Profiler
      // reports render times (tooling/perf/render-count.cjs). Off otherwise.
      ...(process.env.VITE_PERF_HOOKS === 'true'
        ? { 'react-dom/client': path.resolve(__dirname, 'node_modules/react-dom/profiling.js'), 'react-dom$': path.resolve(__dirname, 'node_modules/react-dom/profiling.js') }
        : {}),
    },
  },
  optimizeDeps: {
    include: ['date-fns'],
  },
  server: {
    port: 3000,
    headers: {
      // Enables the JS self-profiling API (new Profiler(...)) in dev for
      // main-thread jank hunts (#183). No effect on production builds.
      'Document-Policy': 'js-profiling',
    },
  },
})
