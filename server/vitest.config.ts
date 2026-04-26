import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests are colocated next to the source they cover (e.g.
    // src/lib/crypto.test.ts) so refactors keep them within reach.
    include: ['src/**/*.test.ts'],
    // Don't pull in the dev DB during unit tests; integration tests can opt
    // in by importing prisma explicitly.
    environment: 'node',
    // No global setup — tests stay self-contained.
  },
});
