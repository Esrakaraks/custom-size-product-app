import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': {}
  },
  build: {
    outDir: 'extensions/custom-size-selector/assets',
    emptyOutDir: true,
    minify: 'terser',
    lib: {
      entry: resolve(__dirname, 'app/theme-extensions/custom-size-selector.jsx'),
      name: 'CustomSizeApp',
      formats: ['es'],
      fileName: () => 'custom-size-bundle.js'
    },
    rollupOptions: {
      external: [],
      output: {
        manualChunks: undefined,
        inlineDynamicImports: true,
        format: 'es',
        globals: {}
      }
    },
    commonjsOptions: {
      transformMixedEsModules: true
    }
  },
  optimizeDeps: {
    include: ['react', 'react-dom']
  }
});