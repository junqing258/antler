import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Avoid resolving the system `localhost` name when Vitest starts its Vite server.
  server: { host: '127.0.0.1' },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // PGlite (WASM Postgres) is CPU-heavy under parallel workers; default 5s is too tight.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts']
    }
  }
});
