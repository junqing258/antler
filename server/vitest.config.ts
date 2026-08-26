import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Avoid resolving the system `localhost` name when Vitest starts its Vite server.
  server: { host: '127.0.0.1' },
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts']
    }
  }
});
