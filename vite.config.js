import {defineConfig} from 'vite';

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  appType: 'mpa',
  // The build script copies the runtime anatomy and exercise assets explicitly.
  publicDir: false,
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT || 4173),
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rolldownOptions: {
      output: {manualChunks: id => id.includes('/node_modules/three/') ? 'three' : undefined},
    },
  },
});
