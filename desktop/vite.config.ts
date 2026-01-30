import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Ensure worklet files are copied correctly
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.worklet.js')) {
            return 'assets/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  server: {
    port: 5173,
  },
  assetsInclude: ['**/*.worklet.js'],
});
