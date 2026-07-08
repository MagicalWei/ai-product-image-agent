import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'react/jsx-dev-runtime': path.resolve(__dirname, '../node_modules/react/jsx-dev-runtime'),
      'react/jsx-runtime': path.resolve(__dirname, '../node_modules/react/jsx-runtime'),
      'react': path.resolve(__dirname, '../node_modules/react'),
      'react-dom/client': path.resolve(__dirname, '../node_modules/react-dom/client'),
      'react-dom/server': path.resolve(__dirname, '../node_modules/react-dom/server'),
      'react-dom': path.resolve(__dirname, '../node_modules/react-dom'),
      'lucide-react': path.resolve(__dirname, '../node_modules/lucide-react'),
    },
  },
  test: {
    server: {
      deps: {
        inline: [
          'react',
          'react-dom',
          '@testing-library/react',
          'lucide-react',
        ],
      },
    },
    include: [
      'tests/unit/**/*.test.{js,jsx}',
      'tests/api/**/*.test.js',
    ],
    testTimeout: 15000,
    globals: true,
    environment: 'node',
    watch: false,
  },
});
